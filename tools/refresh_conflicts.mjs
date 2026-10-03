// Conflict tabs refresh (run by .github/workflows/refresh-flood.yml, step "conflicts", after the news step; or by hand with Node 20+).
// One job for every conflict in tools/conflicts.json. For each conflict:
//   1. Reports: the news step's items for the conflict's countries (data/live/news/<cc>.js, no second fetch), the conflict's own
//      feeds and Bing News searches (read only where robots.txt allows), kept when they name the conflict (its terms) and carry a
//      security word. Non-English text is machine-translated (tools/translate.mjs). Each report gets a machine-sorted kind, casualty
//      figures only where an English headline states them, a place from the text (tools/gazetteer.mjs) and a SHA-256 fingerprint.
//      Reports are unverified; statements by any party are claims. Kept 180 days (merged by link).
//   2. UCDP candidate events (the monthly files, the past 13 months), read once for all conflicts; also counts events that fit
//      no listed conflict, so countries with other deadly violence get an automatic basic tab.
//   3. Front line or areas of control, from the sources in the conflict's "front" list (see data/live/conflicts/SCHEMA.txt).
//      A new version is kept only when the geometry changes; each version keeps its date, source and SHA-256, with what changed.
//      Where no source works the tab says so; nothing is drawn from guesswork.
// Writes data/live/conflicts/index.js, <id>.js and front/<id>.js. PROBE=1 prints what each source returns and writes nothing
// under data/ (probe-out/conflicts.json instead).
import fs from "node:fs";
import { parseFeed } from "./feedparse.mjs";
import { termRe, isSecurity, classify, figure, KILLED, INJURED, sha256, shrink, fcKm2, KIND_NAMES, staleSearchResult } from "./conflict_lib.mjs";
import { ccsAt } from "./geo_cc.mjs";
import { zonesFront } from "./front_zones.mjs";
import { tgItems } from "./tg_preview.mjs";

const PROBE = process.env.PROBE === "1", ONLY = (process.env.CONFLICTS || "").split(",").filter(Boolean);
const TIMEOUT = 25000, KEEP_DAYS = 180, CAP = 900, UCDP_DAYS = 400, OUT = "data/live/conflicts";
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z", NOW = Date.now();
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 (AXIOM-OSAP conflict refresh; +https://osap-app.github.io/)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (d) => { const t = new Date(d); return isNaN(t) ? "" : t.toISOString().slice(0, 16); };
const errMsg = (e) => (e.name === "AbortError" ? "timed out" : String(e.cause?.code || e.message || e).slice(0, 160));
const readJs = (f) => { try { const t = fs.readFileSync(f, "utf8"), i = t.indexOf("={"); return JSON.parse(t.slice(i + 1).trim().replace(/;\s*$/, "")); } catch (e) { return null; } };
// feeds and the news step sometimes pass HTML entities through (&#8216; &amp;#038;): shown as the characters they stand for
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "\u2026", ndash: "\u2013", mdash: "\u2014", lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201c", rdquo: "\u201d", laquo: "\u00ab", raquo: "\u00bb" };
const unent = (s) => { let t = String(s || ""); for (let k = 0; k < 2; k++) t = t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m); return t; };
const writeJs = (f, name, o) => fs.writeFileSync(f, name + "=" + JSON.stringify(o).replace(/<\//g, "<\\/") + ";\n");
// A conflict's own file holds what its tab shows first: the past 90 days (at most 300 reports). Older reports and UCDP
// events go to <id>.older.js, which the page loads only when a longer period or more reports are asked for.
const RECENT_DAYS = 90, RECENT_ITEMS = 300;
const readCf = (id) => {
  const p = readJs(OUT + "/" + id + ".js"); if (!p) return p;
  const o = readJs(OUT + "/" + id + ".older.js");
  if (o) { p.items = (p.items || []).concat(o.items || []); p.ucdp = (p.ucdp || []).concat(o.ucdp || []); }
  return p;
};

async function get(url, accept, asBuf) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": UA, accept: accept || "application/rss+xml, application/xml, text/xml, */*" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return asBuf ? Buffer.from(await r.arrayBuffer()) : await r.text();
  } finally { clearTimeout(t); }
}
// Conditional download: the ETag / Last-Modified of each large file read before are kept in _http.json, and a file the server
// says is unchanged (HTTP 304) is not downloaded again. Returns null when unchanged.
const HTTP_CACHE_FILE = OUT + "/_http.json";
let httpCache = {};
try { httpCache = JSON.parse(fs.readFileSync(HTTP_CACHE_FILE, "utf8")); } catch (e) {}
async function getIfChanged(url, accept) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT), v = httpCache[url] || {}, h = { "user-agent": UA, accept: accept || "*/*" };
  if (v.etag) h["if-none-match"] = v.etag;
  if (v.lm) h["if-modified-since"] = v.lm;
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: h });
    if (r.status === 304) return null;
    if (!r.ok) throw new Error("HTTP " + r.status);
    const txt = await r.text();
    httpCache[url] = { etag: r.headers.get("etag") || undefined, lm: r.headers.get("last-modified") || undefined, seen: new Date().toISOString().slice(0, 16) + "Z" };
    return txt;
  } finally { clearTimeout(t); }
}
// robots.txt: a path is read only when the rules for every agent ("*") allow it (longest match wins; unreachable robots = no)
const robotsCache = {};
async function robotsAllow(url) {
  const u = new URL(url);
  if (!(u.origin in robotsCache)) robotsCache[u.origin] = get(u.origin + "/robots.txt", "text/plain").catch((e) => (/HTTP 4/.test(e.message) ? "" : null));
  const txt = await robotsCache[u.origin];
  if (txt === null) return false;
  let on = false, grp = false, best = { len: -1, allow: true };
  const path = u.pathname + u.search;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim(), m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") { if (!grp) on = false; grp = true; if (v === "*") on = true; continue; }
    grp = false;
    if (!on || (k !== "allow" && k !== "disallow") || !v) continue;
    const re = new RegExp("^" + v.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    if (re.test(path) && v.length > best.len) best = { len: v.length, allow: k === "allow" };
  }
  return best.allow;
}
function unwrap(link) {
  try { const u = new URL(link); if (/bing\.com$/.test(u.hostname) && u.searchParams.get("url")) return u.searchParams.get("url"); } catch (e) {}
  return link;
}

const CFG = JSON.parse(fs.readFileSync("tools/conflicts.json", "utf8"));
const LIST = CFG.conflicts.filter((c) => !ONLY.length || ONLY.includes(c.id));
const prevIndex = readJs(OUT + "/index.js") || {};
const probe = { at: stamp, conflicts: {} };

/* ---------- 1. reports ---------- */
const newsByCc = {};
function news(cc) {
  if (!(cc in newsByCc)) { const n = readJs("data/live/news/" + cc + ".js"); newsByCc[cc] = (n && n.items && n.items[cc]) || []; }
  return newsByCc[cc];
}
const feedCache = {};
async function feedItems(url, search, tg) {
  if (!(url in feedCache)) feedCache[url] = (async () => {
    if ((search || tg) && !(await robotsAllow(url))) throw new Error("robots.txt does not allow " + (tg ? "this channel preview" : "this search"));
    if (tg) { const h = await get(url, "text/html"), x = tgItems(h, tg); if (!x.length && !/tgme_widget_message/.test(h)) throw new Error("no public preview"); await sleep(1200); return x; }
    // Bing sometimes answers a quick run of searches with a short empty page instead of the feed: one more try after a pause
    let body = await get(url);
    if (search && !/<item[\s>]/.test(body)) { await sleep(4000); body = await get(url); }
    const x = parseFeed(body); if (search) await sleep(1200); return x;
  })();
  return feedCache[url];
}
const collected = {};   // id -> { fresh, status }
for (const c of LIST) {
  const terms = termRe(c.terms), excl = termRe(c.exclude), strong = termRe(c.strong), status = [], fresh = [];
  // "strong" terms (optional) name the conflict so plainly that a report is kept without a violence word (a strait, a blockade, the war's own talks)
  const fits = (text, all) => !!text && (isSecurity(text) || !!(strong && strong.test(text))) && (all || (terms && terms.test(text))) && !(excl && excl.test(text));
  // the news step's items for each country of the conflict
  for (const cc of c.countries) {
    const items = news(cc);
    const kept = items.filter((i) => fits([i.title, i.summary, i.title_en, i.summary_en].filter(Boolean).join(" ")))
      .map((i) => ({ title: i.title, summary: (i.summary || "").slice(0, 300), date: i.date, link: i.link, outlet: i.outlet, lang: i.lang, via: "news step", cc,
        ...(i.title_en && i.title_en !== i.title ? { title_en: i.title_en } : {}), ...(i.summary_en && i.summary_en !== i.summary ? { summary_en: i.summary_en.slice(0, 400) } : {}),
        ...(i.mt ? { mt: i.mt } : {}), ...(i.state ? { state: true } : {}), ...(i.nc ? { nc: true } : {}), ...(i.img ? { img: i.img } : {}),
        ...(i.geo && i.geo.la != null ? { geo: { n: i.geo.n, la: i.geo.la, lo: i.geo.lo, p: i.geo.p || "approx" } } : {}), feed: "news:" + cc }));
    fresh.push(...kept);
    status.push({ id: "news:" + cc, source: "National outlets of " + cc.toUpperCase() + " (news step)", ok: true, n: items.length, kept: kept.length });
  }
  // a Telegram channel (type "telegram", channel name only) is read through its public web preview
  const srcs = [...(c.feeds || []).map((f) => f.type === "telegram" ? { ...f, id: f.id || "tg-" + f.channel, outlet: f.outlet || "@" + f.channel, url: "https://t.me/s/" + f.channel, search: false, tg: f.channel } : { ...f, search: false }),
    ...(c.searches || []).map((s, k) => ({ id: "bing-" + (s.lang || "en") + "-" + k, outlet: "Bing News search", lang: s.lang || "en", q: s.q, search: true, nc: true,
      url: "https://www.bing.com/news/search?q=" + encodeURIComponent(s.q) + "&format=rss" + (s.lang && s.lang !== "en" ? "&setlang=" + s.lang : "") }))];
  for (const f of srcs) {
    try {
      const raw = await feedItems(f.url, f.search, f.tg), kept = [];
      for (const i of raw.slice(0, 60)) {
        if (!fits(i.title + " " + i.summary, f.all)) continue;
        const link = f.search ? unwrap(i.link) : i.link;
        if (!/^https?:\/\//.test(link || "")) continue;
        if (!iso(i.date)) continue;   // an undated item cannot be placed in time
        let outlet = f.outlet;
        if (f.search) { try { outlet = (i.source || new URL(link).hostname.replace(/^www\./, "")) + " (via Bing News)"; } catch (e) {} }
        kept.push({ title: i.title, summary: i.summary.slice(0, 300), date: iso(i.date), link, outlet, lang: f.lang, via: f.search ? "search" : f.tg ? "Telegram" : "RSS",
          ...(f.side ? { side: f.side } : {}),
          ...(f.state ? { state: true } : {}), ...(f.nc ? { nc: true } : {}), feed: f.id });
      }
      fresh.push(...kept);
      status.push({ id: f.id, source: f.search ? "Bing News: " + f.q : f.outlet, url: f.url, ok: true, n: raw.length, kept: kept.length, ...(f.nc ? { nc: true } : {}) });
      if (PROBE) (probe.conflicts[c.id] = probe.conflicts[c.id] || { feeds: [] }).feeds.push({ id: f.id, ok: true, n: raw.length, kept: kept.length,
        newest: raw.map((i) => iso(i.date)).sort().pop() || "", kept_sample: kept.slice(0, 4).map((i) => i.title.slice(0, 120)) });
    } catch (e) {
      status.push({ id: f.id, source: f.search ? "Bing News: " + f.q : f.outlet, url: f.url, ok: false, error: errMsg(e) });
      if (PROBE) (probe.conflicts[c.id] = probe.conflicts[c.id] || { feeds: [] }).feeds.push({ id: f.id, ok: false, error: errMsg(e) });
    }
  }
  collected[c.id] = { fresh, status };
  if (PROBE) { const p = (probe.conflicts[c.id] = probe.conflicts[c.id] || { feeds: [] }); p.news_kept = status.filter((s) => /^news:/.test(s.id)).map((s) => s.id + " " + s.kept + "/" + s.n); p.fresh = fresh.length;
    p.fresh_sample = fresh.slice(0, 6).map((i) => (i.title_en || i.title).slice(0, 120)); }
}

/* ---------- 2. UCDP candidate events ---------- */
function csvRows(t) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true; else if (ch === ",") { row.push(cell); cell = ""; } else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; } else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const UF = LIST.map((c) => ({ id: c.id, cfg: c.ucdp || null, key: sha256(JSON.stringify(c.ucdp || null)).slice(0, 12),
  cre: c.ucdp && new RegExp(c.ucdp.countries, "i"), mre: c.ucdp && c.ucdp.match && new RegExp(c.ucdp.match), xre: c.ucdp && c.ucdp.exclude && new RegExp(c.ucdp.exclude) }));   // side names as UCDP writes them: case matters ("IS" is not "is")
const prevUcdp = {}, ucdpFilesDone = {};
for (const u of UF) {
  const p = readCf(u.id);
  const same = p && p.ucdp_key === u.key;
  prevUcdp[u.id] = new Map(same ? (p.ucdp || []).map((e) => [e.id, e]) : []);
  ucdpFilesDone[u.id] = new Set(same ? p.ucdp_files || [] : []);
}
const ucdpStatus = { id: "ucdp", source: "UCDP candidate events (monthly files)", ok: false, n: 0 };
const unassigned = new Map();   // UCDP rows that fit no listed conflict (for automatic tabs)
const prevAutoFile = readJs(OUT + "/auto.js") || {};
const prevAuto = new Map((prevAutoFile.events || []).map((e) => [e.id, e]));
let ucdpFileList = [];
try {
  const h = await get("https://ucdp.uu.se/downloads/", "text/html");
  const since = new Date(NOW - UCDP_DAYS * 864e5);
  const names = [...new Set([...h.matchAll(/candidateged\/(GEDEvent_v(\d+)_0_(\d+)\.csv)/g)].map((m) => m[1]))]
    .map((n) => { const m = n.match(/v(\d+)_0_(\d+)/); return { n, d: new Date(Date.UTC(2000 + +m[1], +m[2] - 1, 28)) }; }).filter((x) => x.d >= since);
  // the downloads page links only the newest months; earlier monthly files keep the same name pattern
  for (let t = new Date(since); t < new Date(); t.setUTCMonth(t.getUTCMonth() + 1)) {
    const n = "GEDEvent_v" + String(t.getUTCFullYear()).slice(2) + "_0_" + (t.getUTCMonth() + 1) + ".csv";
    if (!names.some((x) => x.n === n)) names.push({ n, d: new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 28)), guess: true });
  }
  names.sort((a, b) => a.d - b.d);
  const listed = names.filter((x) => !x.guess), newest = listed.length ? listed[listed.length - 1].n : "", missing = [];
  const autoDone = new Set(prevIndex.auto_files || []);
  let read = 0, unchanged = 0;
  for (const { n } of names) {
    const need = UF.filter((u) => u.cfg && (!ucdpFilesDone[u.id].has(n) || n === newest)), autoNeed = !autoDone.has(n) || n === newest;
    if (!need.length && !autoNeed) continue;
    let csv = "";
    try { csv = await getIfChanged("https://ucdp.uu.se/downloads/candidateged/" + n, "text/csv"); } catch (e) { missing.push(n + " (" + e.message + ")"); continue; }
    // unchanged since it was last read: every conflict that has read it keeps its events; one that has not must download it in full
    if (csv === null) {
      if (need.every((u) => ucdpFilesDone[u.id].has(n)) && (!autoNeed || autoDone.has(n))) { unchanged++; continue; }
      delete httpCache["https://ucdp.uu.se/downloads/candidateged/" + n];
      try { csv = await getIfChanged("https://ucdp.uu.se/downloads/candidateged/" + n, "text/csv"); } catch (e) { missing.push(n + " (" + e.message + ")"); continue; }
    }
    const rows = csvRows(csv), head = rows.shift().map((x) => x.trim()), ix = (k) => head.indexOf(k);
    if (["latitude", "longitude", "date_start", "best", "country"].some((k) => ix(k) < 0)) throw new Error("unexpected columns in " + n);
    for (const r of rows) {
      if (r.length < head.length - 2) continue;
      const country = r[ix("country")] || "", names3 = [r[ix("conflict_name")], r[ix("side_a")], r[ix("side_b")], r[ix("dyad_name")]].filter(Boolean).join(" | ");
      const lat = +r[ix("latitude")], lon = +r[ix("longitude")];
      const ev = { id: r[ix("id")], date: (r[ix("date_start")] || "").slice(0, 10), end: (r[ix("date_end")] || "").slice(0, 10), lat, lon,
        where: (r[ix("where_description")] || "").slice(0, 120), adm1: r[ix("adm_1")] || "", country, conflict: r[ix("conflict_name")] || "",
        sideA: r[ix("side_a")] || "", sideB: r[ix("side_b")] || "", type: +r[ix("type_of_violence")] || null,
        best: +r[ix("best")] || 0, low: +r[ix("low")] || 0, high: +r[ix("high")] || 0, civ: +r[ix("deaths_civilians")] || 0,
        prec: +r[ix("where_prec")] || null, headline: (r[ix("source_headline")] || "").slice(0, 140), file: n };
      let hit = false;
      for (const u of UF) {
        if (!u.cfg || !u.cre.test(country) || (u.mre && !u.mre.test(names3)) || (u.xre && u.xre.test(names3))) continue;
        hit = true;
        if (need.includes(u)) prevUcdp[u.id].set(ev.id, ev);
      }
      // every configured conflict counts, even those left out by CONFLICTS=..., so a partial run never invents automatic tabs
      if (!hit && !ONLY.length && CFG.conflicts.every((c) => !c.ucdp || !new RegExp(c.ucdp.countries, "i").test(country) ||
          (c.ucdp.match && !new RegExp(c.ucdp.match).test(names3)) || (c.ucdp.exclude && new RegExp(c.ucdp.exclude).test(names3)))) {
        if (autoNeed) prevAuto.set(ev.id, ev);
      }
    }
    for (const u of need) ucdpFilesDone[u.id].add(n);
    if (autoNeed) autoDone.add(n);
    read++;
  }
  prevIndex.auto_files = [...autoDone];
  ucdpFileList = names.map((x) => x.n);
  Object.assign(ucdpStatus, { ok: true, read, unchanged, missing, newest });
} catch (e) { ucdpStatus.error = errMsg(e); }
const cutoffDay = new Date(NOW - 365 * 864e5).toISOString().slice(0, 10);
for (const [id, e] of prevAuto) if (e.date < cutoffDay) prevAuto.delete(id); else unassigned.set(id, e);

/* ---------- 3. front line / areas of control ---------- */
// Wikipedia "detailed map" modules and templates: town markers with coordinates, a marker image whose colour stands for the
// side holding the town, and a label. Read as the raw wikitext (CC BY-SA 4.0), only where robots.txt allows.
function parseWikimap(txt) {
  const out = [];
  const num = (s) => { const x = parseFloat(s); return isFinite(x) ? x : null; };
  const pick = (blk, k) => { const m = blk.match(new RegExp("(?:^|[\\s,{|])" + k + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^,|}\\n]*))", "i")); return m ? (m[1] ?? m[2] ?? m[3] ?? "").trim() : ""; };
  // Lua tables { lat = .., long = .., mark = "..", label = ".." } and template calls {{Location map~ | lat = .. | long = .. | mark = .. }}
  const blocks = txt.match(/\{[^{}]*\blat(?:_deg)?\s*=[^{}]*\}/g) || [];
  for (const b of blocks) {
    let lat = num(pick(b, "lat")), lon = num(pick(b, "long")) ?? num(pick(b, "lon"));
    if (lat == null && pick(b, "lat_deg")) {
      lat = (num(pick(b, "lat_deg")) || 0) + (num(pick(b, "lat_min")) || 0) / 60 + (num(pick(b, "lat_sec")) || 0) / 3600; if (/S/i.test(pick(b, "lat_dir"))) lat = -lat;
      lon = (num(pick(b, "lon_deg")) || 0) + (num(pick(b, "lon_min")) || 0) / 60 + (num(pick(b, "lon_sec")) || 0) / 3600; if (/W/i.test(pick(b, "lon_dir"))) lon = -lon;
    }
    const mark = pick(b, "mark"), label = pick(b, "label").replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1").replace(/<[^>]+>|'''?/g, "").trim();
    if (lat == null || lon == null || !mark || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    out.push({ n: label || "", la: +lat.toFixed(4), lo: +lon.toFixed(4), mark: mark.replace(/^(?:File|Image):/i, "").trim() });
  }
  return out;
}
// marker colour word from the image name ("Red pog.svg", "Map-circle-green.svg"; "80x80-red-blue-anim.gif" and "Map-ctl2-red+blue.svg" = contested)
const COLS = ["red", "green", "yellow", "blue", "black", "white", "grey", "gray", "orange", "purple", "pink", "brown", "lime", "cyan", "teal", "olive", "maroon", "navy", "gold", "magenta", "violet", "ochre"];
function markColour(mark) {
  const m = mark.toLowerCase().replace(/\.(svg|png|gif)$/, "").replace(/[_-]/g, " ");
  const hit = []; for (const w of m.split(/[\s+]+/)) for (const c of COLS) if (w === c || (w.startsWith(c) && /^\d/.test(w.slice(c.length)))) hit.push(c === "gray" ? "grey" : c);
  const uniq = [...new Set(hit)];
  return uniq.length > 1 ? "contested:" + uniq.join("+") : uniq[0] || "other";
}
// what a marker image stands for besides control: a town, or a base, airfield, port, hill and so on (the colour still gives the side)
function markType(mark) {
  const m = mark.toLowerCase();
  return /fighter|jet|airport/.test(m) ? "airfield" : /helicopter/.test(m) ? "heliport" : /abm/.test(m) ? "base" : /anchor/.test(m) ? "port" : /peak/.test(m) ? "hill" :
    /nuclear|industrial/.test(m) ? "industrial" : /gota|oil/.test(m) ? "oil_gas" : /dam\b|bsicon str/.test(m) ? "dam" : /pass/.test(m) ? "border_post" : /anim|ctl2/.test(m) ? "contested" :
    /arc|circle/.test(m) ? "besieged" : /\dx\ddot/.test(m) ? "rural" : "town";
}
const SKIP_MARK = /roadmap|overlay|situation in|cursor|pointing hand|location map|transparen/i;
// The legend a map page shows: "[[File:Location dot red.svg|8px]] Under control of the [[Houthis]]" -> { "Location dot red.svg": "Under control of the Houthis" }
function legendOf(txt) {
  const out = {};
  for (const m of txt.matchAll(/\[\[(?:File|Image):([^|\]]+)[^\]]*\]\]((?:[^\n<;{\[]|\[\[[^\]]*\]\]|\{\{[^}]*\}\})*)/g)) {
    const file = m[1].trim().replace(/_/g, " ");
    const lbl = m[2].replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1").replace(/\{\{[^}]*\}\}/g, "").replace(/'{2,3}|&nbsp;|\]=\]|-->/g, " ")
      .replace(/\s+/g, " ").replace(/^[\s:\-\u2013,]+|[\s:;,(]+$/g, "").trim();
    if (lbl.length < 3 || /^(if not|\)\.)/i.test(lbl)) continue;
    if (!out[file]) out[file] = lbl.slice(0, 90);
  }
  return out;
}
async function wikiRaw(page) {
  const url = "https://en.wikipedia.org/wiki/" + encodeURIComponent(page.replace(/ /g, "_")).replace(/%3A/g, ":").replace(/%2F/g, "/") + "?action=raw";
  if (!(await robotsAllow(url))) throw new Error("robots.txt does not allow the raw page");
  return get(url, "text/plain");
}
async function readFront(c, prev, items) {
  const res = { sources: [], current: null };
  for (const s of c.front || []) {
    const st = { id: s.id, type: s.type, name: s.name || (s.type === "wikimap" ? "Wikipedia: " + s.page.replace(/_/g, " ") : s.id), licence: s.licence || (s.type === "wikimap" ? "CC BY-SA 4.0" : ""),
      ...(s.nc ? { nc: true } : {}), home: s.home || (s.type === "wikimap" ? "https://en.wikipedia.org/wiki/" + s.page : s.url), ok: false };
    try {
      if (s.type === "wikimap") {
        // a template names the data module it draws ({{#invoke:Location map/multi|load|Module:...}}); read that module and any module it builds on
        let txt = await wikiRaw(s.page), all = txt, module = s.page;
        const load = txt.match(/#invoke:\s*Location map\/multi\s*\|\s*load\s*\|\s*(Module:[^|}\n]+)/i);
        if (load) { module = load[1].trim().replace(/_/g, " "); txt = await wikiRaw(module); all += "\n" + txt; }
        for (const r of [...txt.matchAll(/require\(\s*['"](Module:[^'"]+)['"]\s*\)/g)].map((m) => m[1]).filter((m) => !/Arguments|Location map|Yesno|String/i.test(m)).slice(0, 2)) {
          try { all += "\n" + (await wikiRaw(r)); } catch (e) {}
        }
        // short names for marker images ("ukr = 'Location dot blue.svg'"), used as mk.ukr in the marker list
        const alias = {}; for (const m of all.matchAll(/\b([A-Za-z]\w{1,7})\s*=\s*["']([^"'\n]+\.(?:svg|png|gif))["']/g)) if (!/^(mark|image|file)$/i.test(m[1])) alias[m[1]] = m[2];
        const legendFiles = legendOf(all);
        const places = parseWikimap(txt).map((p) => { const a = p.mark.match(/^\w+\.(\w+)$/); if (a && alias[a[1]]) p.mark = alias[a[1]]; return p; })
          .filter((p) => !SKIP_MARK.test(p.mark) && /\.(svg|png|gif)$/i.test(p.mark));
        places.forEach((p) => { p.ctl = markColour(p.mark); p.t = markType(p.mark); });
        // the side each colour stands for, in the source's own legend words (town-marker lines, then contested pairs); config can override
        const legend = {};
        for (const [file, lbl] of Object.entries(legendFiles)) {
          const col = markColour(file), t = markType(file); if (col === "other") continue;
          if ((t === "town" || t === "contested") && !legend[col]) legend[col] = lbl;
        }
        Object.assign(legend, s.legend || {});
        if (PROBE) { const cnt = {}; places.forEach((p) => { cnt[p.ctl + " " + p.t] = (cnt[p.ctl + " " + p.t] || 0) + 1; });
          (probe.conflicts[c.id] = probe.conflicts[c.id] || {}).front = (probe.conflicts[c.id].front || []).concat([{ id: s.id, module, len: txt.length, places: places.length,
            marks: Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 25), aliases: Object.keys(alias).length, legend }]); }
        if (places.length < 5) throw new Error("no town markers found (" + places.length + ")");
        places.sort((a, b) => (a.n + a.la + a.lo < b.n + b.la + b.lo ? -1 : 1));
        places.forEach((p) => { delete p.mark; });
        res.current = res.current || { kind: "places", source: s.id, module, places, legend, taken: stamp, sha256: sha256(places.map((p) => [p.n, p.la, p.lo, p.ctl, p.t])) };
        Object.assign(st, { ok: true, n: places.length, home: "https://en.wikipedia.org/wiki/" + module.replace(/ /g, "_") });
      } else if (s.type === "zones") {
        // no ground front: reported strike zones from this conflict's own placed reports, plus announced or reported areas (tools/front_zones.mjs)
        const z = zonesFront(c, s, items, stamp);
        if (!z.areas.features.length) throw new Error("no strike reports placed and no areas listed");
        res.current = res.current || z;
        Object.assign(st, { ok: true, n: z.areas.features.length, zones: z.zones, curated: z.curated, licence: "AXIOM OSAP, drawn from the reports and sources linked on each zone" });
      } else if (s.type === "geojson") {
        let txt = "", used = "";
        const urls = s.dated ? [0, 1, 2, 3, 4].map((d) => { const t = new Date(NOW - d * 864e5); return s.url.replace("{YYYYMMDD}", t.toISOString().slice(0, 10).replace(/-/g, "")); }) : [s.url];
        let same = false;
        for (const u of urls) {
          try {
            // the file the current version was drawn from, unchanged on the server: keep that version without downloading it again
            const pc = prev && prev.current && prev.current.source === s.id && prev.current.file === u ? prev.current : null;
            txt = await getIfChanged(pc ? u : (delete httpCache[u], u), "application/geo+json, application/json, */*"); used = u;
            if (txt === null && pc) { same = true; res.current = res.current || pc; Object.assign(st, { ok: true, n: pc.areas.features.length, file: u, km2: Object.values(pc.km2 || {})[0], unchanged: true }); }
            break;
          } catch (e) { st.error = errMsg(e); }
        }
        if (same) { res.sources.push(Object.assign(st, { error: undefined })); continue; }
        if (!txt) throw new Error(st.error || "no file");
        const fc = JSON.parse(txt), small = shrink(fc.type === "FeatureCollection" ? fc : { type: "FeatureCollection", features: [fc.type === "Feature" ? fc : { type: "Feature", geometry: fc }] });
        small.features.forEach((f) => { f.properties = { ctl: s.control || "control" }; });
        const km2 = fcKm2(small);
        if (PROBE) (probe.conflicts[c.id] = probe.conflicts[c.id] || {}).front = (probe.conflicts[c.id].front || []).concat([{ id: s.id, url: used, bytes: txt.length, features: small.features.length, km2 }]);
        if (!small.features.length) throw new Error("no polygons in the file");
        res.current = res.current || { kind: "areas", source: s.id, areas: small, km2: { [s.control || "control"]: km2 }, taken: stamp, file: used,
          sha256: sha256(JSON.stringify(small.features.map((f) => f.geometry.coordinates))) };
        Object.assign(st, { ok: true, n: small.features.length, file: used, km2 });
      }
    } catch (e) { st.error = errMsg(e); }
    delete st.error_if_ok;
    if (st.ok) delete st.error;
    res.sources.push(st);
  }
  return res;
}

/* ---------- translate, sort, place, fingerprint ---------- */
let translateAll = null, saveCache = () => {}, gz = null, placeIn = null;
if (!PROBE) {
  try { ({ translateAll, saveCache } = await import("./translate.mjs")); } catch (e) { console.error("translation unavailable:", e.message); }
  try { const g = await import("./gazetteer.mjs"); placeIn = g.placeIn; gz = await g.loadGazetteer(); } catch (e) { console.error("gazetteer unavailable:", errMsg(e)); }
}
// a conflict may keep its reports longer than the default (keep_days in tools/conflicts.json); older ones load only on request
const cutoffOf = (c) => new Date(NOW - (c.keep_days || KEEP_DAYS) * 864e5).toISOString().slice(0, 16);
const index = [], autoTabs = [];
fs.mkdirSync(OUT + "/front", { recursive: true });
for (const c of LIST) {
  const { fresh, status } = collected[c.id];
  const prev = readCf(c.id) || {};
  const byLink = new Map();
  for (const i of prev.items || []) if (i && i.link) byLink.set(i.link, i);
  for (const i of fresh) { const o = byLink.get(i.link); byLink.set(i.link, { ...(o || {}), ...i, first_seen: (o && o.first_seen) || stamp }); }
  let items = [...byLink.values()].filter((i) => i.date && i.date >= cutoffOf(c) && i.date <= new Date(NOW + 36e5).toISOString().slice(0, 16))
    .sort((a, b) => (b.date > a.date ? 1 : -1)).slice(0, c.cap || CAP);
  // an old story that a search listed with a fresh date (its link or its own text dates it earlier) is left out
  const oldRe = c.old_stories && c.old_stories.length ? new RegExp(c.old_stories.join("|"), "i") : null;
  const stale = items.filter((i) => i.via === "search" && staleSearchResult([i.title, i.summary].join(" "), i.date, 60, { link: i.link, old: oldRe }));
  if (stale.length) { const st = new Set(stale); items = items.filter((i) => !st.has(i)); console.log(c.id + ": " + stale.length + " search results dropped as old stories re-dated: " + stale.map((i) => i.link).join(" ")); }
  if (!PROBE && translateAll) {
    const todo = items.filter((i) => !/^en\b/i.test(i.lang || "") && !i.title_en && !i.mt_rejected);
    if (todo.length) {
      const tr = await translateAll([...todo.map((i) => ({ text: i.title, lang: i.lang })), ...todo.map((i) => ({ text: i.summary, lang: i.lang }))]);
      todo.forEach((i, n) => { if (tr[n].en) { i.title_en = tr[n].en.slice(0, 300); i.mt = tr[n].tool; } if (tr[todo.length + n].en) i.summary_en = tr[todo.length + n].en.slice(0, 400); });
    }
  }
  for (const i of items) for (const k of ["title", "summary", "title_en", "summary_en", "outlet"]) if (i[k]) i[k] = unent(i[k]);
  for (const i of items) {
    const en = /^en\b/i.test(i.lang || "") ? i.title : i.title_en || "";
    i.kind = classify(en || i.title);
    if (i.kind === "statement" || i.kind === "other") { const k2 = classify([en || i.title, i.summary_en || i.summary].join(" ")); if (k2 !== "other") i.kind = k2; }
    i.killed = en ? figure(en, KILLED) : null; i.injured = en ? figure(en, INJURED) : null;
    // placed by the places the text names inside this conflict's countries (the news step placed it within one country only)
    if (gz && placeIn && !i.geo_c) {
      const p = placeIn(gz, [i.title_en, i.title, i.summary_en, i.summary].filter(Boolean).join(" \u2022 "), c.countries);
      if (p) i.geo = { n: p.name, la: p.lat, lo: p.lon, p: p.prec, b: "gazetteer" };
      i.geo_c = 1;
    }
    if (i.geo && i.geo.la != null) { const inCc = ccsAt(i.geo.la, i.geo.lo, 0.3); i.cc = i.cc && inCc.includes(i.cc) ? i.cc : inCc.find((x) => c.countries.includes(x)) || i.cc || null; }
    i.fp = sha256({ link: i.link, title: i.title, date: i.date, outlet: i.outlet });
  }
  // UCDP events for this conflict, the past 13 months, newest first
  const ucdp = [...(prevUcdp[c.id] || new Map()).values()].filter((e) => e.date >= new Date(NOW - UCDP_DAYS * 864e5).toISOString().slice(0, 10))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  ucdp.forEach((e) => {
    e.fp = e.fp || sha256({ ucdp: e.id, date: e.date, lat: e.lat, lon: e.lon, best: e.best, file: e.file });
    // descriptive text only (not part of the fingerprint): one line, shortened
    e.where = String(e.where || "").replace(/\s+/g, " ").trim().slice(0, 120); e.headline = String(e.headline || "").replace(/\s+/g, " ").trim().slice(0, 140);
    if (e.end === e.date) delete e.end;
  });
  // front line / control: keep a version only when it changed
  const fprev = readJs(OUT + "/front/" + c.id + ".js") || {};
  const fr = (c.front || []).length ? await readFront(c, fprev, items) : { sources: [], current: null };
  let versions = fprev.versions || [], current = fprev.current || null, previous = fprev.previous || null;
  if (fr.current) {
    const last = versions[0];
    if (!last || last.sha256 !== fr.current.sha256 || last.source !== fr.current.source) {
      const v = { sha256: fr.current.sha256, source: fr.current.source, taken: stamp, kind: fr.current.kind };
      if (fr.current.kind === "places") {
        const old = new Map(((current && current.kind === "places" && current.places) || []).map((p) => [p.n + "@" + p.la.toFixed(2) + "," + p.lo.toFixed(2), p]));
        const changes = [];
        if (old.size) for (const p of fr.current.places) { const o = old.get(p.n + "@" + p.la.toFixed(2) + "," + p.lo.toFixed(2)); if (!o) changes.push({ n: p.n, la: p.la, lo: p.lo, from: null, to: p.ctl }); else if (o.ctl !== p.ctl) changes.push({ n: p.n, la: p.la, lo: p.lo, from: o.ctl, to: p.ctl }); }
        const cnt = {}; fr.current.places.forEach((p) => { cnt[p.ctl] = (cnt[p.ctl] || 0) + 1; });
        Object.assign(v, { counts: cnt, changes: changes.slice(0, 200), first: !old.size });
      } else {
        const km2 = fr.current.km2, pk = current && current.km2;
        Object.assign(v, { km2, delta_km2: pk ? Object.fromEntries(Object.keys(km2).map((k) => [k, km2[k] - (pk[k] || 0)])) : null, file: fr.current.file });
      }
      versions = [v, ...versions].slice(0, 180);
      if (current && current.sha256 !== fr.current.sha256) previous = current;
      current = fr.current;
    } else current = { ...fr.current, taken: current.taken, checked: stamp };
  }
  // posts that publish a control or situation map (an image or article, linked, never redrawn)
  const maps = items.filter((i) => /\b(?:control|territorial|situation|frontline|front-line|front line) maps?\b|\bmap of (?:control|the front)/i.test((i.title_en || i.title) + " " + (i.summary_en || "")))
    .slice(0, 12).map((i) => ({ title: i.title_en || i.title, link: i.link, outlet: i.outlet, date: i.date, fp: i.fp }));
  const front = { schema: "osap-front/1", maps, id: c.id, asof: stamp, sources: fr.sources, status: current ? "ok" : (c.front || []).length ? "sources failed" : "no machine-readable source",
    note: "Reported, not verified. Lines and control markers are the named source's own depiction; AXIOM OSAP does not draw or adjust them.", current, previous: previous && previous.kind === "areas" ? previous : null, versions };
  // headline figures (counts of reports and of UCDP-coded events; UCDP figures are its provisional best estimates)
  const ago = (d) => new Date(NOW - d * 864e5).toISOString().slice(0, 16);
  const st = { reports: { d1: items.filter((i) => i.date >= ago(1)).length, d7: items.filter((i) => i.date >= ago(7)).length, d30: items.filter((i) => i.date >= ago(30)).length, all: items.length },
    kinds7: {}, ucdp30: { events: 0, best: 0, civ: 0 }, ucdp365: { events: 0, best: 0, civ: 0 }, weeks: [], by_cc: {} };
  items.filter((i) => i.date >= ago(7)).forEach((i) => { st.kinds7[i.kind] = (st.kinds7[i.kind] || 0) + 1; });
  const wk = (d) => Math.floor((NOW - Date.parse(d + "T12:00:00Z")) / (7 * 864e5));
  const W = Array.from({ length: 53 }, (_, k) => ({ w: k, events: 0, best: 0, reports: 0 }));
  for (const e of ucdp) {
    const a = (NOW - Date.parse(e.date + "T12:00:00Z")) / 864e5;
    if (a <= 30) { st.ucdp30.events++; st.ucdp30.best += e.best; st.ucdp30.civ += e.civ; }
    if (a <= 365) { st.ucdp365.events++; st.ucdp365.best += e.best; st.ucdp365.civ += e.civ; const k = wk(e.date); if (W[k]) { W[k].events++; W[k].best += e.best; } }
    const cc = (ccsAt(e.lat, e.lon, 0.1)[0]) || "?"; e.cc = cc; st.by_cc[cc] = (st.by_cc[cc] || 0) + e.best;
  }
  items.forEach((i) => { const k = wk(i.date.slice(0, 10)); if (W[k]) W[k].reports++; });
  st.weeks = W.reverse();
  st.ucdp_latest = ucdp.length ? ucdp[0].date : null;
  const pub = { id: c.id, name: c.name, short: c.short, countries: c.countries, since: c.since, kind: c.kind, parties: c.parties, bounds: c.bounds, tier: c.tier || 2, ...(c.note_data ? { note_data: c.note_data } : {}), ...(c.merge_tabs ? { merge_tabs: c.merge_tabs } : {}) };
  const data = { ...pub, asof: stamp, keep_days: c.keep_days || KEEP_DAYS, sources: [...status, { ...ucdpStatus, n: ucdp.length }], stats: st, items, ucdp,
    ucdp_key: UF.find((u) => u.id === c.id).key, ucdp_files: [...(ucdpFilesDone[c.id] || [])], kind_names: KIND_NAMES };
  if (!PROBE) {
    const edge = new Date(NOW - RECENT_DAYS * 864e5).toISOString().slice(0, 16);
    const recentItems = items.filter((i, k) => k < RECENT_ITEMS && i.date >= edge), recentUcdp = ucdp.filter((e) => e.date >= edge.slice(0, 10));
    const older = { items: items.slice(recentItems.length), ucdp: ucdp.slice(recentUcdp.length) };
    data.items = recentItems; data.ucdp = recentUcdp;
    data.older = { from: edge.slice(0, 10), items: older.items.length, ucdp: older.ucdp.length };
    writeJs(OUT + "/" + c.id + ".older.js", "(window.OSAP_CF_OLDER=window.OSAP_CF_OLDER||{})[" + JSON.stringify(c.id) + "]", { id: c.id, asof: stamp, ...older });
    writeJs(OUT + "/" + c.id + ".js", "(window.OSAP_CF=window.OSAP_CF||{})[" + JSON.stringify(c.id) + "]", data); writeJs(OUT + "/front/" + c.id + ".js", "(window.OSAP_FRONT=window.OSAP_FRONT||{})[" + JSON.stringify(c.id) + "]", front); }
  index.push({ ...pub, reports7: st.reports.d7, reports1: st.reports.d1, ucdp30: st.ucdp30, ucdp365: st.ucdp365.best, ucdp_latest: st.ucdp_latest,
    front: front.status, front_taken: current ? current.taken : null, front_changed: versions[0] ? versions[0].taken : null, sources_ok: status.filter((s) => s.ok).length, sources_n: status.length });
  console.log((current ? "front ok " : "front -- ") + c.id.padEnd(22), "reports", items.length, "(new " + fresh.length + ", 7d " + st.reports.d7 + ")", "UCDP", ucdp.length, "events,", st.ucdp365.best, "deaths/yr",
    "| sources ok", status.filter((s) => s.ok).length + "/" + status.length, fr.sources.map((s) => s.id + ":" + (s.ok ? "ok " + s.n : s.error)).join(" "));
}

/* ---------- automatic tabs: countries where UCDP records deadly violence that fits no listed conflict ---------- */
const byCc = {};
for (const e of unassigned.values()) {
  const cc = ccsAt(e.lat, e.lon, 0.1)[0]; if (!cc) continue;
  (byCc[cc] = byCc[cc] || []).push(e);
}
const autoEvents = [];
for (const [cc, evs] of Object.entries(byCc)) {
  const best = evs.reduce((s, e) => s + e.best, 0);
  if (best < 25) continue;
  const cnt = {}; evs.forEach((e) => { cnt[e.conflict] = (cnt[e.conflict] || 0) + e.best; });
  autoTabs.push({ id: "auto-" + cc, cc, events: evs.length, best, top: Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, b]) => ({ n, best: b })), latest: evs.map((e) => e.date).sort().pop() });
  evs.sort((a, b) => (a.date < b.date ? 1 : -1)).forEach((e) => { e.cc = cc; e.fp = e.fp || sha256({ ucdp: e.id, date: e.date, lat: e.lat, lon: e.lon, best: e.best, file: e.file }); autoEvents.push(e); });
}
autoTabs.sort((a, b) => b.best - a.best);

if (PROBE) {
  // which UCDP conflicts are deadliest over the past year (to check the list), and what each source returned
  const tally = {};
  for (const u of UF) for (const e of (prevUcdp[u.id] || new Map()).values()) { const k = u.id; tally[k] = (tally[k] || 0) + e.best; }
  probe.ucdp = ucdpStatus; probe.ucdp_by_conflict = tally; probe.auto = autoTabs.slice(0, 40);
  fs.mkdirSync("probe-out", { recursive: true }); fs.writeFileSync("probe-out/conflicts.json", JSON.stringify(probe, null, 1));
  console.log(JSON.stringify(probe, null, 1).slice(0, 60000));
  process.exit(0);
}
const merged = ONLY.length ? [...(prevIndex.conflicts || []).filter((x) => !ONLY.includes(x.id)), ...index] : index;
const order = CFG.conflicts.map((c) => c.id);
merged.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
if (!PROBE) fs.writeFileSync(HTTP_CACHE_FILE, JSON.stringify(httpCache, null, 0) + "\n");
writeJs(OUT + "/index.js", "window.OSAP_CONFLICTS", { schema: "osap-conflicts/1", asof: stamp, conflicts: merged,
  auto: ONLY.length ? prevIndex.auto || [] : autoTabs, auto_files: prevIndex.auto_files || [], ucdp: ucdpStatus, kind_names: KIND_NAMES });
// the automatic tabs' UCDP events, loaded only when one of those tabs is opened
if (!ONLY.length) writeJs(OUT + "/auto.js", "window.OSAP_CF_AUTO", { asof: stamp, events: autoEvents.slice(0, 6000) });
saveCache();
console.log("conflicts:", index.length, "automatic tabs:", autoTabs.length, autoTabs.slice(0, 12).map((a) => a.cc + " " + a.best).join(", "));
