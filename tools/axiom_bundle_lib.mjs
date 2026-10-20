// OSAP bundle for AXIOM Analyst Work Station (format "osap-bundle/1"). AXIOM imports this one file, offline, instead of reading a
// checkout of this repository (AXIOM: src/osap/bundle_import.py, ADR-OSAP-INTEGRATION). Plan: /mnt/project-files/axiom/osap-aws-integration.md.
//
// What crosses over is awareness, never evidence: every record is a pointer to someone else's report. AXIOM stores each as a
// discovery outside every case, and only an analyst's "Add to case" brings one into a case, as a proposal.
//
// File: JSON Lines, UTF-8, one object per line.
//   line 1      {"t":"header","format":"osap-bundle/1","built_at","osap_commit","nc_included":false,"feeds":[...]}
//   lines 2..n  {"t":"record","area","origin","layer_from_file","licence","record":{...}}
//   last line   {"t":"trailer","records":N,"records_sha256":hex}
// records_sha256 is SHA-256 over the record lines' exact bytes, each followed by "\n", so a truncated or edited bundle is refused.
//
// Curated records (source/countries, source/thailand) are passed through exactly as stored, so AXIOM's own fingerprint for each is
// the same whether it was imported from a checkout or from a bundle. Live feed items are mapped onto the same record format
// (docs/RECORD-FORMAT.md), keeping the original-language text in title/detail and any machine translation as separate fields.
// Fields that change between refresh runs of the same item (first seen, corroboration counts, alert flags) are left out, so the
// same item gives the same record in every bundle.
//
// Non-commercial sources (an item's "nc" tag) are left out unless includeNc is set: AXIOM is the product that is sold
// (Shane, 2026-10-20). Hidden areas (tools/hidden-areas.json) are always left out.
import crypto from "node:crypto";

export const FORMAT = "osap-bundle/1";
export const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

const TITLE_MAX = 300, DETAIL_MAX = 2000;
const clip = (s, n) => { const t = String(s == null ? "" : s).replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const day = (v) => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v || "")); return m ? m[1] : null; };
const isLink = (u) => /^https?:\/\/\S{4,}$/.test(String(u || ""));
const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
const count = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
const AREA = /^[a-z]{2,8}$/;

/** Location fields from an OSAP geo object ({n, la, lo, p, prov}); none when it has no usable point. */
function where(geo) {
  const lat = num(geo && geo.la), lon = num(geo && geo.lo);
  const prec = geo && (geo.p === "exact" || geo.p === "approx" || geo.p === "province") ? geo.p : null;
  if (lat == null || lon == null || !prec || Math.abs(lat) > 90 || Math.abs(lon) > 180) return { place: (geo && geo.n) || null, prov: (geo && geo.prov) || null, lat: null, lon: null, prec: "none" };
  return { place: geo.n || null, prov: geo.prov || null, lat, lon, prec };
}
/** A point reported by the source itself (USGS, UCDP, GDACS ...). */
function point(lat, lon, place, prec = "exact") {
  lat = num(lat); lon = num(lon);
  if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return { place: place || null, prov: null, lat: null, lon: null, prec: "none" };
  return { place: place || null, prov: null, lat, lon, prec };
}
/** Original text, plus the machine translation as its own fields when there is one. */
function texts(i, titleKey = "title", detailKey = "summary") {
  const out = { title: clip(i[titleKey], TITLE_MAX), detail: clip(i[detailKey], DETAIL_MAX) };
  if (i.lang) out.lang = i.lang;
  const translated = i.mt && i.mt !== "untranslated" && !/^en\b/i.test(i.lang || "");
  if (translated && i.title_en) out.title_en = clip(i.title_en, TITLE_MAX);
  if (translated && i.summary_en) out.detail_en = clip(i.summary_en, DETAIL_MAX);
  if (translated) out.mt = i.mt;
  if (!out.title && out.title_en) out.title = out.title_en;
  return out;
}
function rec(layer, date, datePub, kind, t, loc, extra) {
  return {
    layer, date, date_is_pub: !!datePub, kind, title: t.title, detail: t.detail,
    place: loc.place, district: null, prov: loc.prov, lat: loc.lat, lon: loc.lon, prec: loc.prec,
    killed: count(extra.killed), injured: count(extra.injured), arrested: null,
    agency: extra.agency || null, src: extra.src, srcname: extra.srcname, attribution: extra.attribution || "",
    ...(t.lang ? { lang: t.lang } : {}), ...(t.title_en ? { title_en: t.title_en } : {}), ...(t.detail_en ? { detail_en: t.detail_en } : {}),
    ...(t.mt ? { mt: t.mt } : {}), feed: extra.feed, ...(extra.more || {}),
  };
}
const GDACS_KIND = { EQ: "earthquake", TC: "tropical_cyclone", FL: "flood", VO: "volcano", WF: "wildfire", DR: "drought", TS: "tsunami" };

/** Every live feed the bundle carries: file, window name, and (doc, helpers) -> [{ area, nc, record }]. */
export const FEEDS = [
  { id: "deepsouth", file: "data/live/deepsouth.js", map(doc) {
    // Thai Deep South incidents and reporting; a few are on the Malaysian side of the border (geo.side "my").
    return (doc.items || []).map((i) => {
      const date = day(i.date) || day(i.date_seen);
      if (!date || !isLink(i.link)) return null;
      const side = i.geo && i.geo.side;
      return { area: side && AREA.test(side) ? side : "th", nc: !!i.nc, record: rec("insurgency", date, true, i.kind || "other", texts(i), where(i.geo),
        { killed: i.killed, injured: i.injured, src: i.link, srcname: i.outlet || "unknown outlet", attribution: (i.outlet || "The outlet") + " reports", feed: "deepsouth",
          more: { ...(i.via === "search" ? { discovery: true } : {}), ...(i.state ? { state_media: true } : {}), ...(i.undated ? { undated: true } : {}) } }) };
    });
  } },
  { id: "news", file: "data/live/news.js", map(doc) {
    const out = [];
    for (const [cc, list] of Object.entries(doc.items || {})) for (const i of list || []) {
      const date = day(i.date) || day(i.date_seen);
      if (!date || !isLink(i.link)) { out.push(null); continue; }
      out.push({ area: cc, nc: !!i.nc, record: rec("news", date, true, "news", texts(i), where(i.geo),
        { src: i.link, srcname: i.outlet || "unknown outlet", attribution: (i.outlet || "The outlet") + " reports", feed: "news",
          more: { ...(i.via === "search" ? { discovery: true } : {}), ...(i.state ? { state_media: true } : {}) } }) });
    }
    return out;
  } },
  { id: "ucdp", file: "data/live/ucdp.js", map(doc) {
    // UCDP candidate events: one row per event, coded by UCDP from media reports; no page per event, so the link is the dataset.
    const src = isLink(doc.src) ? doc.src : "https://ucdp.uu.se/downloads/";
    return (doc.items || []).flatMap((i) => {
      const date = day(i.date);
      if (!date) return [null];
      const r = rec("conflict", date, false, i.type || "conflict_event", { title: clip((i.type || "Conflict event") + ": " + (i.where || "location not given"), TITLE_MAX),
        detail: clip("UCDP candidate event " + i.id + ", best estimate " + (i.best == null ? "not given" : i.best) + " deaths.", DETAIL_MAX) },
        point(i.lat, i.lon, i.where, "approx"), { killed: i.best, src, srcname: "UCDP Candidate Events Dataset", attribution: "Uppsala Conflict Data Program (candidate data, may be revised)", feed: "ucdp", more: { ucdp_id: String(i.id) } });
      return (i.ccs && i.ccs.length ? i.ccs : ["world"]).map((cc) => ({ area: cc, nc: false, record: r }));
    });
  } },
  { id: "quakes", file: "data/live/quakes.js", map(doc, h) {
    return (doc.features || []).flatMap((q) => {
      const date = q.time ? new Date(q.time).toISOString().slice(0, 10) : null;
      if (!date || !isLink(q.url)) return [null];
      const r = rec("hazard", date, false, q.type || "earthquake", { title: clip("M" + q.mag + " " + (q.type || "earthquake") + " - " + (q.place || ""), TITLE_MAX),
        detail: clip("Magnitude " + q.mag + ", depth " + q.depth + " km, USGS status " + (q.status || "unknown") + (q.alert ? ", PAGER alert " + q.alert : "") + ".", DETAIL_MAX) },
        point(q.lat, q.lon, q.place), { src: q.url, srcname: "USGS Earthquake Hazards Program", agency: "U.S. Geological Survey", attribution: "USGS reports", feed: "quakes", more: { magnitude: q.mag, usgs_id: q.id } });
      const ccs = h.ccsAt(q.lat, q.lon);
      return (ccs.length ? ccs : ["world"]).map((cc) => ({ area: cc, nc: false, record: r }));
    });
  } },
  { id: "gdacs", file: "data/live/gdacs.js", map(doc, h) {
    return (doc.events || []).flatMap((e) => {
      const date = day(e.from) || day(e.mod);
      if (!date || !isLink(e.url)) return [null];
      const r = rec("hazard", date, false, GDACS_KIND[e.type] || "hazard", { title: clip(e.name, TITLE_MAX), detail: clip([e.severity, e.alert ? "GDACS alert level " + e.alert : ""].filter(Boolean).join(". "), DETAIL_MAX) },
        point(e.lat, e.lon, null, "approx"), { src: e.url, srcname: "GDACS", agency: "Global Disaster Alert and Coordination System", attribution: "GDACS (modelled impact estimate)", feed: "gdacs", more: { gdacs_id: e.id, alert: e.alert || null } });
      const ccs = (e.iso3 || []).map(h.ccFromA3).filter(Boolean);
      return (ccs.length ? ccs : ["world"]).map((cc) => ({ area: cc, nc: false, record: r }));
    });
  } },
  { id: "warnings", file: "data/live/warnings.js", map(doc) {
    // a warning is a claim by the agency that issued it; items are filed by the country they are for
    const out = [];
    for (const [cc, list] of Object.entries(doc.items || {})) for (const i of list || []) {
      const date = day(i.date);
      if (!date || !isLink(i.link)) { out.push(null); continue; }
      out.push({ area: cc, nc: false, record: rec("weather", date, true, "warning", texts(i), { place: null, prov: null, lat: null, lon: null, prec: "none" },
        { src: i.link, srcname: i.agency || "unknown agency", agency: i.agency || null, attribution: (i.agency || "The issuing agency") + " (warning issued by the agency)", feed: "warnings",
          more: i.severity ? { severity: i.severity } : {} }) });
    }
    return out;
  } },
  { id: "tsunami", file: "data/live/tsunami.js", map(doc) {
    return (doc.items || []).flatMap((i) => {
      const date = day(i.date);
      if (!date || !isLink(i.link)) return [null];
      const r = rec("hazard", date, true, "tsunami_bulletin", { title: clip(i.title, TITLE_MAX), detail: clip(i.summary, DETAIL_MAX) }, point(i.lat, i.lon, i.title),
        { src: i.link, srcname: "NOAA Tsunami Warning Center" + (i.center ? " (" + i.center + ")" : ""), agency: "NOAA " + (i.center || ""), attribution: "Bulletin issued by the warning centre", feed: "tsunami" });
      return (i.ccs && i.ccs.length ? i.ccs : ["world"]).map((cc) => ({ area: cc, nc: false, record: r }));
    });
  } },
  { id: "outbreaks", file: "data/live/outbreaks.js", map(doc) {
    return (doc.items || []).flatMap((i) => {
      const date = day(i.date);
      if (!date || !isLink(i.link)) return [null];
      const r = rec("health", date, true, "outbreak", { title: clip(i.title, TITLE_MAX), detail: clip(i.summary, DETAIL_MAX) }, { place: null, prov: null, lat: null, lon: null, prec: "none" },
        { src: i.link, srcname: "WHO Disease Outbreak News", agency: "World Health Organization", attribution: "WHO reports", feed: "outbreaks" });
      return (i.ccs && i.ccs.length ? i.ccs : ["world"]).map((cc) => ({ area: cc, nc: false, record: r }));
    });
  } },
  { id: "eonet", file: "data/live/eonet.js", map(doc) {
    return (doc.items || []).flatMap((i) => {
      const last = i.last || {};
      const date = day(last.date);
      if (!date || !isLink(i.link)) return [null];
      const kind = String(i.cat || "hazard").toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "") || "hazard";
      const r = rec("hazard", date, false, kind, { title: clip(i.title, TITLE_MAX), detail: clip([i.cat, last.mag].filter(Boolean).join(", "), DETAIL_MAX) }, point(last.lat, last.lon, i.title, "approx"),
        { src: i.link, srcname: "NASA EONET" + (i.srcs ? " (" + i.srcs + ")" : ""), agency: i.srcs || null, attribution: "Listed by NASA EONET from " + (i.srcs || "its sources"), feed: "eonet", more: { eonet_id: i.id } });
      return (i.ccs && i.ccs.length ? i.ccs : ["world"]).map((cc) => ({ area: cc, nc: false, record: r }));
    });
  } },
];

/** The curated record files, chosen exactly as AXIOM's checkout importer chooses them (src/osap/importer.py _record_files). */
export function curatedFiles(list) {
  const out = [];
  for (const name of list("source/countries").sort()) {
    const m = /^([a-z]{2,8})\.json$/.exec(name);
    if (m && !name.endsWith(".cfg.json")) out.push({ path: "source/countries/" + name, area: m[1], layer: null });
  }
  for (const name of list("source/thailand").sort()) {
    if (name.endsWith(".json") && !name.endsWith(".cfg.json")) out.push({ path: "source/thailand/" + name, area: "th", layer: name.slice(0, -5) });
  }
  return out;
}

/**
 * The elements of a JSON array as their original text, with only the whitespace between tokens taken out. A curated record has
 * to reach AXIOM exactly as OSAP stored it: JSON.parse then JSON.stringify would write 47.0 as 47, and AXIOM's fingerprint, made
 * from the stored text as Python reads it, would then differ from a checkout import. Call only on text JSON.parse accepted.
 */
export function arrayElements(text) {
  const s = String(text), out = [];
  let i = s.indexOf("[") + 1, depth = 0, cur = "", inStr = false;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      cur += ch;
      if (ch === "\\") { cur += s[++i]; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; cur += ch; continue; }
    if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t") continue;
    if (depth === 0 && (ch === "," || ch === "]")) { if (cur) out.push(cur); cur = ""; if (ch === "]") break; continue; }
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
    cur += ch;
  }
  return out;
}

/** Parse a data/live "window.X = {...};" file without running it. */
export function parseLive(text) {
  const t = String(text);
  const body = t.slice(t.indexOf("=") + 1).trim().replace(/;\s*$/, "");
  return JSON.parse(body);
}

/**
 * Build the bundle text.
 * io: { read(path) -> string|null, list(dir) -> [names], commit, now: Date, hidden: Set, includeNc: bool, helpers: { ccsAt, ccFromA3 } }
 * Returns { text, stats }.
 */
export function buildBundle(io) {
  const hidden = io.hidden || new Set();
  const lines = [];
  const seen = new Set();
  const feeds = [];
  const add = (area, origin, layerFromFile, licence, record) => {
    if (!AREA.test(area)) return "unusable";
    if (hidden.has(area)) return "hidden";
    // a curated record arrives as its original JSON text (see arrayElements), so it is spliced in rather than re-serialised
    const head = JSON.stringify({ t: "record", area, origin, layer_from_file: layerFromFile, licence });
    const line = head.slice(0, -1) + ',"record":' + (typeof record === "string" ? record : JSON.stringify(record)) + "}";
    if (seen.has(line)) return "duplicate";
    seen.add(line); lines.push(line); return "kept";
  };

  const tally = (stat, outcome) => { stat[outcome] = (stat[outcome] || 0) + 1; };
  const curated = { id: "curated", read: 0, kept: 0, dropped_nc: 0, unusable: 0 };
  feeds.push(curated);
  for (const f of curatedFiles(io.list)) {
    const text = io.read(f.path);
    if (text == null) continue;
    let list;
    try { if (!Array.isArray(JSON.parse(text))) continue; list = arrayElements(text); } catch (e) { continue; }
    for (const r of list) { curated.read++; tally(curated, r[0] === "{" ? add(f.area, f.path, f.layer, "osap-curated", r) : "unusable"); }
  }

  for (const feed of FEEDS) {
    const stat = { id: feed.id, asof: null, read: 0, kept: 0, dropped_nc: 0, unusable: 0 };
    feeds.push(stat);
    const text = io.read(feed.file);
    if (text == null) { stat.error = "missing"; continue; }
    let doc;
    try { doc = parseLive(text); } catch (e) { stat.error = "unreadable"; continue; }
    if (!doc) { stat.error = "empty"; continue; }
    stat.asof = doc.asof || null;
    for (const item of feed.map(doc, io.helpers)) {
      stat.read++;
      if (!item) { stat.unusable++; continue; }
      if (item.nc && !io.includeNc) { stat.dropped_nc++; continue; }
      tally(stat, add(item.area, "live:" + feed.id, null, item.nc ? "nc" : "pending", item.record));
    }
  }

  const header = { t: "header", format: FORMAT, built_at: (io.now || new Date()).toISOString(), osap_commit: io.commit || null, nc_included: !!io.includeNc, feeds };
  const body = lines.map((l) => l + "\n").join("");
  const trailer = { t: "trailer", records: lines.length, records_sha256: sha256(body) };
  return { text: JSON.stringify(header) + "\n" + body + JSON.stringify(trailer) + "\n", stats: { records: lines.length, feeds } };
}

/** Check a bundle's framing and digest (the same checks AXIOM makes). Returns null when sound, otherwise the reason. */
export function verifyBundle(text) {
  const all = String(text).split("\n");
  if (all[all.length - 1] !== "") return "the bundle does not end with a newline (truncated?)";
  all.pop();
  if (all.length < 2) return "too short";
  let header, trailer;
  try { header = JSON.parse(all[0]); trailer = JSON.parse(all[all.length - 1]); } catch (e) { return "header or trailer is not JSON"; }
  if (header.t !== "header" || header.format !== FORMAT) return "not an " + FORMAT + " bundle";
  if (trailer.t !== "trailer") return "no trailer (truncated?)";
  const body = all.slice(1, -1);
  if (body.length !== trailer.records) return "trailer says " + trailer.records + " records, found " + body.length;
  if (sha256(body.map((l) => l + "\n").join("")) !== trailer.records_sha256) return "records digest does not match";
  return null;
}
