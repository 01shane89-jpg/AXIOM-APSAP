// Coded event history, protests and riots (milestone 2 of the coded event history): the Mass Mobilization Protest Data
// (Clark and Regan, Harvard Dataverse doi:10.7910/DVN/HTTWYL, CC0 1.0, no key): every protest against a government its
// coders found in 162 countries, 1990 to 2020, with the protesters' demands and the state's response. UCDP (the History of
// violence) counts only deadly organized violence, so these are the events it leaves out.
// Each protest is coded into the incident record's ACLED-style categories (assets/osap-cf-code.js fromMm, rules "mm-acled-v1"):
//   protesters used violence -> Riots · Violent demonstration; the state shot, killed or beat protesters -> Protests · Excessive
//   force against protesters; arrests or crowd dispersal -> Protests · Protest with intervention; else Protests · Peaceful protest.
// These are DATASET CODINGS of source claims, never analyst-confirmed incidents. Mass Mobilization gives no death figures.
// The place: the first town the dataset's location names inside the country (tools/gazetteer.mjs, GeoNames towns of 15,000 or
// more), precision 2 ("near a town": the dataset names a city, not a spot); "national" or no town found -> no position (precision 3).
// Writes data/live/conflicts/history/mm/<cc>.js (window.OSAP_CF_CODED["mm/<cc>"]) and mm/_index.js (counts per country).
// The dataset ended in 2020 and does not change, so the job runs only when the file's checksum or the rules change (FORCE=1 rebuilds).
// Env: MM_CSV=<path> uses a local copy (tests); MM_NOGEO=1 skips the gazetteer (tests); MM_CACHE (default .cache/mm).
import fs from "node:fs";
import { createHash } from "node:crypto";
import CODE from "../assets/osap-cf-code.js";
import { COUNTRIES, ccFromName, ccsInText } from "./geo_cc.mjs";
import { loadGazetteer, placeIn } from "./gazetteer.mjs";

const OUT = "data/live/conflicts/history/mm", CACHE = process.env.MM_CACHE || ".cache/mm", FORCE = process.env.FORCE === "1";
// the dataset's main file on Harvard Dataverse (the original CSV, not Dataverse's tab export)
const FILE_ID = 4291456, URL = "https://dataverse.harvard.edu/api/access/datafile/" + FILE_ID + "?format=original";
const UA = "Mozilla/5.0 (AXIOM-OSAP coded event history; +https://axiom-osap.netlify.app/)";
// Correlates-of-War country names the page's own names and aliases do not catch (states that no longer exist go to their successor
// only where the place is unambiguous today; the others are left out and counted)
export const MM_NAMES = { "Congo Kinshasa": "cd", "Congo Brazzaville": "cg", "Bosnia": "ba", "Ivory Coast": "ci", "Serbia and Montenegro": "rs", "Yugoslavia": "rs",
  "Germany East": "de", "Germany West": "de", "Kyrgyzstan": "kg", "Taiwan": "tw", "Timor Leste": "tl", "Macedonia": "mk", "Swaziland": "sz", "Cape Verde": "cv",
  "Kosovo": "xk", "Slovak Republic": "sk", "Czech Republic": "cz", "Burma": "mm", "Myanmar": "mm", "South Sudan": "ss", "Gambia": "gm", "Laos": "la" };
const CCS = new Set(COUNTRIES.map((c) => c.id));
export function ccOf(name) {
  const n = String(name || "").trim();
  const c = MM_NAMES[n] || ccFromName(n) || ccsInText(n)[0] || null;
  return c && CCS.has(c) ? c : null;
}
const sha = (s) => createHash("sha256").update(s).digest("hex");
const js = (name, o) => name + "=" + JSON.stringify(o).replace(/<\//g, "<\\/") + ";\n";
function put(f, txt) { try { if (fs.readFileSync(f, "utf8") === txt) return false; } catch (e) {} fs.writeFileSync(f, txt); return true; }

// a CSV reader for quoted cells that may hold commas and line breaks
export function csvRows(t) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true; else if (ch === ",") { row.push(cell); cell = ""; } else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; } else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const pad = (n) => String(n).padStart(2, "0");
function ymd(y, m, d) { y = +y; m = +m; d = +d; return y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? y + "-" + pad(m) + "-" + pad(d) : ""; }

/** Reads the dataset's CSV text into protest records (protest == 1 only). Returns { recs, skipped }. */
export function readMm(text) {
  const rs = csvRows(text.replace(/^﻿/, "")), head = (rs.shift() || []).map((h) => h.trim().toLowerCase()), k = (x) => head.indexOf(x);
  const need = ["id", "country", "protest", "startday", "startmonth", "startyear", "endday", "endmonth", "endyear", "protesterviolence", "location"];
  const miss = need.filter((x) => k(x) < 0); if (miss.length) throw new Error("Mass Mobilization columns missing: " + miss.join(", ") + " (have " + head.slice(0, 40).join(", ") + ")");
  const resp = head.map((h, i) => (/^stateresponse\d$/.test(h) ? i : -1)).filter((i) => i >= 0), dem = head.map((h, i) => (/^protesterdemand\d$/.test(h) ? i : -1)).filter((i) => i >= 0);
  const recs = [], skipped = { not_protest: 0, no_date: 0, no_country: {} };
  for (const r of rs) {
    if (r.length < head.length - 2) continue;
    if (String(r[k("protest")]).trim() !== "1") { skipped.not_protest++; continue; }
    const date = ymd(r[k("startyear")], r[k("startmonth")], r[k("startday")]); if (!date) { skipped.no_date++; continue; }
    const end = ymd(r[k("endyear")], r[k("endmonth")], r[k("endday")]);
    const country = String(r[k("country")]).trim(), cc = ccOf(country);
    if (!cc) { skipped.no_country[country] = (skipped.no_country[country] || 0) + 1; continue; }
    const words = (ix) => [...new Set(ix.map((i) => String(r[i] || "").trim().toLowerCase()).filter((x) => x && x !== "." && x !== "na"))];
    recs.push({ id: String(r[k("id")]).trim(), cc, country, date, end: end && end !== date ? end : "", violence: String(r[k("protesterviolence")]).trim() === "1" ? 1 : 0,
      location: String(r[k("location")] || "").replace(/\s+/g, " ").trim().slice(0, 80),
      participants: k("participants_category") >= 0 ? String(r[k("participants_category")] || "").trim().slice(0, 30) : "",
      identity: k("protesteridentity") >= 0 ? String(r[k("protesteridentity")] || "").replace(/\s+/g, " ").trim().slice(0, 80) : "",
      demands: words(dem), responses: words(resp) });
  }
  return { recs, skipped };
}

/* ---------- main (skipped when imported by a test) ---------- */
if (process.argv[1] && process.argv[1].endsWith("refresh_coded_protests.mjs")) {
  fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CACHE, { recursive: true });
  let text;
  if (process.env.MM_CSV) text = fs.readFileSync(process.env.MM_CSV, "utf8");
  else {
    const f = CACHE + "/mm.csv";
    if (!fs.existsSync(f)) {
      console.log("downloading", URL);
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 300000);
      const r = await fetch(URL, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": UA } }); clearTimeout(t);
      if (!r.ok) throw new Error("Mass Mobilization download: HTTP " + r.status);
      fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
    }
    text = fs.readFileSync(f, "utf8");
  }
  const fileSha = sha(text);
  const STATE = OUT + "/_state.json"; let state = {}; try { state = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch (e) {}
  const key = fileSha.slice(0, 16) + "|" + CODE.MM_RULES + "|" + (process.env.MM_NOGEO === "1" ? "nogeo" : "geo");
  if (!FORCE && state.key === key && fs.existsSync(OUT + "/_index.js")) { console.log("protest history: unchanged (" + key + ")"); process.exit(0); }
  const { recs, skipped } = readMm(text);
  console.log("Mass Mobilization:", recs.length, "protests;", "skipped", JSON.stringify(skipped));
  const gz = process.env.MM_NOGEO === "1" ? null : await loadGazetteer();
  const by = {}, stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";
  let placed = 0;
  for (const e of recs) {
    const p = gz && e.location && !/^national/i.test(e.location) ? placeIn(gz, e.location, [e.cc]) : null;
    if (p && p.prec !== "province") { e.lat = p.lat; e.lon = p.lon; e.place = p.name; e.prec = 2; placed++; }
    else if (p) { e.lat = p.lat; e.lon = p.lon; e.place = p.name; e.prec = 3; placed++; }
    else { e.lat = null; e.lon = null; e.place = ""; e.prec = 3; }
    (by[e.cc] = by[e.cc] || []).push(e);
  }
  const ds = CODE.DATASETS.mm_protest, lic = { id: ds.id, name: ds.name, licence: ds.licence, licence_url: ds.licence_url, nc: ds.nc, url: ds.url, cite: ds.cite };
  const index = { schema: "osap-cf-coded-index/1", dataset: lic, coding_rules: CODE.MM_RULES, asof: stamp, file_sha256: fileSha, n: recs.length, placed, countries: {} };
  let changed = 0; const keep = new Set(["_index.js", "_state.json"]);
  for (const cc of Object.keys(by).sort()) {
    const ev = by[cc].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
    // row: id, date, end, lat, lon, precision, protester violence, location (as the dataset gives it), place found, participants, identity, demands, state responses
    const rows = ev.map((e) => [e.id, e.date, e.end, e.lat, e.lon, e.prec, e.violence, e.location, e.place, e.participants, e.identity, e.demands.join("; "), e.responses.join("; ")]);
    const body = { rows }, h = sha(JSON.stringify(body));
    const o = Object.assign({ schema: "osap-cf-coded/1", id: "mm/" + cc, cc, dataset: lic, coding_rules: CODE.MM_RULES, asof: stamp, n: rows.length, first: ev[0].date, last: ev[ev.length - 1].date, sha256: h,
      cols: ["id", "date", "end", "lat", "lon", "prec", "violence", "location", "place", "participants", "identity", "demands", "responses"],
      fp: "SHA-256 of each event: mm|<id>|<date>|<end>|<location>|<violence>|<state responses>" }, body);
    if (put(OUT + "/" + cc + ".js", js('(window.OSAP_CF_CODED=window.OSAP_CF_CODED||{})["mm/' + cc + '"]', o))) changed++;
    keep.add(cc + ".js");
    index.countries[cc] = { n: rows.length, first: o.first, last: o.last, placed: ev.filter((e) => e.lat != null).length, sha256: h };
  }
  for (const f of fs.readdirSync(OUT)) if (!keep.has(f)) { fs.unlinkSync(OUT + "/" + f); changed++; }
  if (put(OUT + "/_index.js", js('(window.OSAP_CF_CODED=window.OSAP_CF_CODED||{})["mm/_index"]', index))) changed++;
  fs.writeFileSync(STATE, JSON.stringify({ key, built: stamp, n: recs.length, placed, skipped }, null, 1) + "\n");
  console.log("countries:", Object.keys(by).length, "placed on a town:", placed, "of", recs.length, "files changed:", changed);
}
