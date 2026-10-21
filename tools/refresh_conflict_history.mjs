// History of violence for every conflict tab (run by .github/workflows/refresh-conflicts.yml, the weekly slot or only=history;
// or by hand with Node 20+ and Python 3).
// Source: UCDP Georeferenced Event Dataset (GED), the yearly release (1989 to the end of the year before it), CC BY 4.0, no key.
// Events after the release ends come from the UCDP candidate events the hourly conflict job already keeps (<id>.js / .older.js).
// For each conflict in tools/conflicts.json with a "ucdp" filter: the events that fit the same filter (countries, match, exclude)
// from the conflict's own start ("since"; UCDP begins in 1989), split by UCDP type of violence:
//   1 state-based (a government is one side), 2 non-state (armed groups against each other), 3 one-sided (against civilians).
// Death figures are UCDP's reported estimates (low, best, high), never counts. Nothing here is an analyst judgement.
// Writes data/live/conflicts/history/<id>.js (per-year totals, a 0.5-degree density grid, the chunk list) and
// history/<id>.<from>-<to>.js (the events, in chunks of years, each with the SHA-256 of its rows). The page loads a conflict's
// index only when its History of violence layer is switched on, and a chunk only when its years are shown as pins.
// Every country (tools/geo_cc.mjs, the page's country list) gets the same history of its own, from 1989: every event UCDP
// placed inside the country's outline as the page draws it today (so Gaza and the West Bank are Palestine, Western Sahara is
// Western Sahara), and an event placed outside every outline (offshore, a rough position) goes by UCDP's own country name.
// Written to data/live/conflicts/history/cc/<cc>.js and cc/<cc>.<from>-<to>.js in the same format; a country UCDP recorded
// nothing for still gets its index (no events), so the page can say so. COUNTRIES=th,mm limits them, COUNTRIES=none skips them.
// Skips the work when nothing changed: same GED release, same filters, built within the past 6 days (FORCE=1 rebuilds).
// The CSV is read by tools/ged_extract.py (Python standard library) and handed over as one line per event.
// Env: UCDP_CACHE (default .cache/ucdp) holds the downloaded release zip; CONFLICTS=a,b limits the run.
import fs from "node:fs";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { createHash } from "node:crypto";
import { sha256 } from "./conflict_lib.mjs";
import { COUNTRIES as CCLIST, ccsAt, ccsInText, outlineOf } from "./geo_cc.mjs";

const OUT = "data/live/conflicts", HOUT = OUT + "/history", CACHE = process.env.UCDP_CACHE || ".cache/ucdp";
const FORCE = process.env.FORCE === "1", ONLY = (process.env.CONFLICTS || "").split(",").filter(Boolean);
const CFG = JSON.parse(fs.readFileSync("tools/conflicts.json", "utf8"));
const LIST = CFG.conflicts.filter((c) => c.ucdp && (!ONLY.length || ONLY.includes(c.id)));
// the countries: all of them on a full run; on a run limited to some conflicts (CONFLICTS=...) none unless COUNTRIES names them
const CONLY = (process.env.COUNTRIES || "").split(",").filter(Boolean);
const CLIST = CONLY.includes("none") || (ONLY.length && !CONLY.length) ? [] : CCLIST.filter((c) => !CONLY.length || CONLY.includes(c.id));
const CDIR = HOUT + "/cc", CC_KEY = "cc-v1";
// UCDP country names the page's own names and aliases do not catch
const GED_NAMES = { "Bosnia-Herzegovina": "ba" };
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";
const UA = "Mozilla/5.0 (AXIOM-OSAP conflict history refresh; +https://01shane89-jpg.github.io/AXIOM-APSAP/)";
const CHUNK_BYTES = 450000, GRID = 0.5, FIRST_UCDP = "1989-01-01";
const readJs = (f) => { try { const t = fs.readFileSync(f, "utf8"), i = t.indexOf("={"); return JSON.parse(t.slice(i + 1).trim().replace(/;\s*$/, "")); } catch (e) { return null; } };
const js = (name, o) => name + "=" + JSON.stringify(o).replace(/<\//g, "<\\/") + ";\n";
// a file is rewritten only when its content changes, so a weekly run touches only the chunks that moved
function put(f, txt) { try { if (fs.readFileSync(f, "utf8") === txt) return false; } catch (e) {} fs.writeFileSync(f, txt); return true; }
function out(k, v) { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, k + "=" + v + "\n"); }

async function get(url, asBuf, ms = 30000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": UA } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return asBuf ? Buffer.from(await r.arrayBuffer()) : await r.text();
  } finally { clearTimeout(t); }
}

// the monthly candidate files are small (a few MB): read whole, quoted cells may hold commas and line breaks
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

/* ---------- which GED release ---------- */
// the downloads page links the newest release as ged<YY><N>-csv.zip (e.g. ged251-csv.zip = version 25.1, events to the end of 2024)
async function findRelease() {
  let names = [];
  try {
    const h = await get("https://ucdp.uu.se/downloads/");
    names = [...new Set([...h.matchAll(/ged\/(ged(\d{2})(\d)-csv\.zip)/gi)].map((m) => m[1].toLowerCase()))];
  } catch (e) { console.log("downloads page:", e.message); }
  // the page not reachable or changed: try the likely names, newest first
  const yy = new Date().getUTCFullYear() % 100;
  for (const y of [yy, yy - 1, yy - 2]) names.push("ged" + y + "1-csv.zip");
  names = [...new Set(names)].sort((a, b) => b.localeCompare(a));
  for (const n of names) {
    const url = "https://ucdp.uu.se/downloads/ged/" + n;
    try {
      const r = await fetch(url, { method: "HEAD", redirect: "follow", headers: { "user-agent": UA } });
      if (r.ok) { const m = n.match(/ged(\d{2})(\d)/); return { name: n, url, version: m[1] + "." + m[2], etag: r.headers.get("etag") || "", size: +r.headers.get("content-length") || 0 }; }
    } catch (e) {}
  }
  throw new Error("no GED release found (tried " + names.join(", ") + ")");
}

/* ---------- the release's events, one JSON array per line from tools/ged_extract.py (Python's csv reader, streamed) ---------- */
async function readLines(stream, onRow) {
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) if (line) onRow(JSON.parse(line));
}

/* ---------- main ---------- */
fs.mkdirSync(HOUT, { recursive: true }); fs.mkdirSync(CACHE, { recursive: true });
const STATE_FILE = HOUT + "/_state.json";
let state = {}; try { state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch (e) {}
// UCDP_ZIP=<path to gedNNN-csv.zip> uses a local copy (tests); otherwise the newest release on the UCDP downloads page
const rel = process.env.UCDP_ZIP ? { name: process.env.UCDP_ZIP.split("/").pop(), url: "https://ucdp.uu.se/downloads/", version: (process.env.UCDP_ZIP.match(/ged(\d{2})(\d)/) || [0, "0", "0"]).slice(1).join("."), size: 0, local: process.env.UCDP_ZIP }
  : await findRelease();
out("release", rel.name.replace(/-csv\.zip$/, ""));
const keyOf = (c) => sha256(JSON.stringify({ u: c.ucdp, s: c.since || "" })).slice(0, 12);
const ageDays = state.built ? (Date.now() - Date.parse(state.built.replace(" ", "T"))) / 864e5 : 1e9;
const stale = LIST.filter((c) => !state.conflicts || !state.conflicts[c.id] || state.conflicts[c.id].key !== keyOf(c) || !fs.existsSync(HOUT + "/" + c.id + ".js"));
const cstale = CLIST.filter((c) => !state.countries || !state.countries[c.id] || state.countries[c.id].key !== CC_KEY || !fs.existsSync(CDIR + "/" + c.id + ".js"));
if (!FORCE && state.release === rel.name && ageDays < 6 && !stale.length && !cstale.length) {
  console.log("history: " + rel.name + " built " + state.built + ", filters unchanged: nothing to do");
  out("fresh", "0"); process.exit(0);
}

// the release zip, downloaded once and kept in the Actions cache (UCDP_CACHE) until a new release appears
const zip = rel.local || CACHE + "/" + rel.name;
let fresh = false;
if (!fs.existsSync(zip) || (rel.size && fs.statSync(zip).size !== rel.size)) {
  for (const f of fs.readdirSync(CACHE)) if (/^ged\d+-csv\.zip$/.test(f)) fs.unlinkSync(CACHE + "/" + f);
  console.log("downloading", rel.url, rel.size ? (rel.size / 1e6).toFixed(1) + " MB" : "");
  fs.writeFileSync(zip, await get(rel.url, true, 300000)); fresh = true;
}
out("fresh", fresh ? "1" : "0");
// the release file itself (a Buffer: hashed as bytes, not through sha256(), which would treat it as an object)
const zipSha = createHash("sha256").update(fs.readFileSync(zip)).digest("hex");

const F = LIST.map((c) => ({ c, since: (c.since && c.since > FIRST_UCDP ? c.since : FIRST_UCDP), cre: new RegExp(c.ucdp.countries, "i"),
  mre: c.ucdp.match && new RegExp(c.ucdp.match), xre: c.ucdp.exclude && new RegExp(c.ucdp.exclude), ev: [] }));
// the countries: an event goes to the country whose outline holds its position (Okinawa also to Japan), else by UCDP's name
const CF = {}; for (const c of CLIST) CF[c.id] = { c, ev: [] };
const CLISTF = CLIST.map((c) => CF[c.id]);
const nameCc = {}, unnamed = {};
// the page's outlines, each with a box worked out from its own points (the country list's boxes leave out some parts, Gaza
// among them). Where two outlines overlap (Morocco's holds Western Sahara, Serbia's Kosovo, Russia's Crimea) the smaller
// country wins, which is the one the overlap is about.
const ring = (x, y, r) => { let ins = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins; } return ins; };
const OUT_CC = CCLIST.filter((c) => c.id !== "oki").map((c) => {
  const polys = outlineOf(c.id).flatMap((g) => (g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []));
  const b = [180, 90, -180, -90]; for (const p of polys) for (const [x, y] of p[0]) { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; }
  return { id: c.id, polys, b, area: (b[2] - b[0]) * (b[3] - b[1]) };
}).filter((c) => c.polys.length);
const OKI_B = (CCLIST.find((c) => c.id === "oki") || {}).bounds;
function placeCc(lat, lon) {
  let best = null;
  for (const c of OUT_CC) {
    if (lon < c.b[0] || lon > c.b[2] || lat < c.b[1] || lat > c.b[3] || (best && c.area >= best.area)) continue;
    if (c.polys.some((p) => ring(lon, lat, p[0]) && !p.slice(1).some((h) => ring(lon, lat, h)))) best = c;
  }
  if (!best) return [];
  return best.id === "jp" && OKI_B && lat >= OKI_B[0][0] - 0.3 && lat <= OKI_B[1][0] + 0.3 && lon >= OKI_B[0][1] - 0.3 && lon <= OKI_B[1][1] + 0.3 ? ["jp", "oki"] : [best.id];
}
// places UCDP files under another state (its countries are the Gleditsch-Ward list: Gaza and the West Bank under Israel,
// Western Sahara under Morocco, Kosovo and Montenegro under Serbia before they left, South Sudan, Timor-Leste and Eritrea under
// the state they split from): an event inside one of these outlines belongs to it
const OWN_PLACE = new Set(["ps", "eh", "xk", "me", "ss", "tl", "er"]);
// and the other way round: the page's outline of Russia holds Crimea, which UCDP files under Ukraine (as the UN does)
const NAME_WINS = { ua: ["ru"] };
function ccsOf(lat, lon, country) {
  if (!(country in nameCc)) nameCc[country] = GED_NAMES[country] || ccsInText(country)[0] || null;
  const named = nameCc[country], ok = isFinite(lat) && isFinite(lon), at = ok ? placeCc(lat, lon) : [];
  // inside an outline: that country, unless UCDP names a neighbour whose outline is within about 30 km (the page's outlines
  // are simplified, so an event at a border town can fall a little across it)
  if (at.length && (OWN_PLACE.has(at[0]) || !named || at[0] === named)) return at;
  if (at.length && (NAME_WINS[named] || []).includes(at[0])) return [named];
  const near = ok ? ccsAt(lat, lon, 0.3).filter((c) => c !== "oki") : [];
  if (at.length && !near.includes(named)) return at;
  // offshore or placed roughly: the country UCDP names, if its outline is near; else the nearest outline
  if (named && (near.includes(named) || !near.length)) return named === "jp" && near.includes("oki") ? ["jp", "oki"] : [named];
  if (near.length) return [near[0]];
  if (!named) unnamed[country] = (unnamed[country] || 0) + 1;
  return named ? [named] : [];
}
let head = null, ix = {}, rows = 0, gedLast = "";
const unz = spawn("python3", ["tools/ged_extract.py", zip], { stdio: ["ignore", "pipe", "inherit"] });
const unzDone = new Promise((ok) => unz.on("close", (code) => ok(code)));
await readLines(unz.stdout, (r) => {
  if (!head) { head = r; head.forEach((k, i) => { ix[k] = i; });
    const need = ["id", "latitude", "longitude", "date_start", "type_of_violence", "best", "country", "side_a", "side_b"];
    const miss = need.filter((k) => ix[k] == null); if (miss.length) throw new Error("GED columns missing: " + miss.join(", ")); return; }
  rows++;
  if (rows % 100000 === 0) console.log("  ", rows, "rows,", Math.round(process.memoryUsage().heapUsed / 1e6), "MB heap");
  const date = (r[ix.date_start] || "").slice(0, 10); if (date > gedLast) gedLast = date;
  const country = r[ix.country] || "", names = [r[ix.conflict_name], r[ix.side_a], r[ix.side_b], r[ix.dyad_name]].filter(Boolean).join(" | ");
  let e = null;
  const mk = () => e || (e = { id: r[ix.id], date: date, end: (r[ix.date_end] || "").slice(0, 10), lat: +r[ix.latitude], lon: +r[ix.longitude], type: +r[ix.type_of_violence] || 0,
    best: +r[ix.best] || 0, low: +r[ix.low] || 0, high: +r[ix.high] || 0, civ: +r[ix.deaths_civilians] || 0, a: r[ix.side_a] || "", b: r[ix.side_b] || "",
    where: String(r[ix.where_description] || "").replace(/\s+/g, " ").trim().slice(0, 80), adm1: r[ix.adm_1] || "", prec: +r[ix.where_prec] || 0, country: country, s: 0 });
  for (const f of F) {
    if (date < f.since || !f.cre.test(country) || (f.mre && !f.mre.test(names)) || (f.xre && f.xre.test(names))) continue;
    f.ev.push(mk());
  }
  // one shared object per event: a conflict and its country hold the same record
  if (CLIST.length) for (const cc of ccsOf(+r[ix.latitude], +r[ix.longitude], country)) if (CF[cc]) CF[cc].ev.push(mk());
});
const code = await unzDone;
if (code || !rows) throw new Error("reading " + rel.name + " failed (exit " + code + ", " + rows + " rows)");
console.log("GED", rel.version, rows, "events, last", gedLast);

// after the release: the candidate events the hourly job keeps for each conflict (provisional; UCDP revises them)
const cand = (e) => ({ id: String(e.id), date: e.date, end: e.end || "", lat: +e.lat, lon: +e.lon, type: +e.type || 0, best: +e.best || 0, low: +e.low || 0, high: +e.high || 0,
  civ: +e.civ || 0, a: e.sideA || "", b: e.sideB || "", where: String(e.where || "").slice(0, 80), adm1: e.adm1 || "", prec: +e.prec || 0, country: e.country || "", s: 1 });
let candFiles = null;
const allCand = new Map();   // every candidate event the conflict job holds (listed conflicts and automatic tabs), for the countries
for (const f of F) {
  const p = readJs(OUT + "/" + f.c.id + ".js") || {}, o = readJs(OUT + "/" + f.c.id + ".older.js") || {};
  const seen = new Set();
  for (const e of [...(p.ucdp || []), ...(o.ucdp || [])]) {
    if (!e || !e.date || e.date <= gedLast || e.date < f.since || seen.has(e.id)) continue; seen.add(e.id);
    f.ev.push(cand(e));
  }
}
if (CLIST.length) {
  // the conflict job's files hold the candidate events of the past 13 months: those that fit a listed conflict in <id>.js and
  // <id>.older.js, the rest in auto.js; the open country's newest monthly file (data/live/ucdp/<cc>.js) fills any gap
  const add = (e, ccs) => { if (e && e.id && e.date && e.date > gedLast && !allCand.has(String(e.id))) allCand.set(String(e.id), [e, ccs]); };
  for (const c of CFG.conflicts) for (const x of [".js", ".older.js"]) for (const e of (readJs(OUT + "/" + c.id + x) || {}).ucdp || []) add(e);
  for (const e of (readJs(OUT + "/auto.js") || {}).events || []) add(e);
  // the monthly candidate files themselves, every month after the release (GEDEvent_v26_0_1.csv = January 2026): the conflict
  // job keeps only events that fit a conflict or an automatic tab, so a country with a few deaths a month would miss them
  const files = { read: [], missing: [] };
  for (let t = new Date(Date.parse(gedLast + "T00:00:00Z") + 864e5); t < new Date(); t.setUTCMonth(t.getUTCMonth() + 1)) {
    const n = "GEDEvent_v" + String(t.getUTCFullYear()).slice(2) + "_0_" + (t.getUTCMonth() + 1) + ".csv";
    let csv = ""; try { csv = await get("https://ucdp.uu.se/downloads/candidateged/" + n, false, 120000); } catch (e) { files.missing.push(n + " (" + e.message + ")"); continue; }
    const rs = csvRows(csv), h = (rs.shift() || []).map((x) => x.trim()), k = (x) => h.indexOf(x);
    if (["id", "latitude", "longitude", "date_start", "best", "country"].some((x) => k(x) < 0)) { files.missing.push(n + " (unexpected columns)"); continue; }
    for (const r of rs) if (r.length >= h.length - 2) add({ id: r[k("id")], date: (r[k("date_start")] || "").slice(0, 10), end: (r[k("date_end")] || "").slice(0, 10), lat: +r[k("latitude")], lon: +r[k("longitude")],
      type: +r[k("type_of_violence")] || 0, best: +r[k("best")] || 0, low: +r[k("low")] || 0, high: +r[k("high")] || 0, civ: +r[k("deaths_civilians")] || 0, sideA: r[k("side_a")] || "", sideB: r[k("side_b")] || "",
      where: String(r[k("where_description")] || "").replace(/\s+/g, " ").trim(), adm1: r[k("adm_1")] || "", prec: +r[k("where_prec")] || 0, country: r[k("country")] || "" });
    files.read.push(n);
  }
  candFiles = files;
  for (const [, [e]] of allCand) for (const cc of ccsOf(+e.lat, +e.lon, e.country || "")) if (CF[cc]) CF[cc].ev.push(cand(e));
  console.log("countries:", CLIST.length, "candidate events after the release:", allCand.size, Object.keys(unnamed).length ? "UCDP country names not matched: " + JSON.stringify(unnamed) : "");
}

const newState = { schema: "osap-cf-history-state/1", release: rel.name, version: rel.version, zip_sha256: zipSha, ged_last: gedLast, built: stamp,
  conflicts: Object.assign({}, state.conflicts || {}), countries: Object.assign({}, state.countries || {}) };
if (candFiles) newState.candidate_files = candFiles;
let changed = 0;
// one history: id is its key on the page (a conflict id, or "cc/<cc>" for a country), sub the folder under history/ ("" or "cc/")
// and base the file name the files start with
function writeHist(o) {
  const ev = o.ev.filter((e) => isFinite(e.lat) && isFinite(e.lon)).sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.id < y.id ? -1 : 1));
  // lookup tables keep the rows short: sides and provinces are named once per chunk
  const years = {}, grid = {};
  for (const e of ev) {
    const y = e.date.slice(0, 4), t = e.type >= 1 && e.type <= 3 ? e.type : 1;
    const Y = (years[y] = years[y] || [0, 0, 0, 0, 0, 0, 0, 0]);   // events, best, events by type 1-3, best by type 1-3
    Y[0]++; Y[1] += e.best; Y[1 + t]++; Y[4 + t] += e.best;
    const k = Math.floor(e.lat / GRID) + "," + Math.floor(e.lon / GRID), G = (grid[y] = grid[y] || {});
    const g = (G[k] = G[k] || [0, 0, 0, 0, 0]); g[0]++; g[1] += e.best; g[1 + t]++;
  }
  const gridOut = {};
  for (const y of Object.keys(grid)) gridOut[y] = Object.entries(grid[y]).map(([k, g]) => { const [a, b] = k.split(",").map(Number); return [a, b, g[0], g[1], g[2], g[3], g[4]]; });
  // chunks: consecutive years, greedily from the first, cut near CHUNK_BYTES (a year is never split), so a weekly run
  // changes only the last chunk
  const byYear = {}; for (const e of ev) (byYear[e.date.slice(0, 4)] = byYear[e.date.slice(0, 4)] || []).push(e);
  const ys = Object.keys(byYear).sort(), groups = []; let cur = null;
  for (const y of ys) {
    const sz = byYear[y].length * 95;
    if (!cur || (cur.sz + sz > CHUNK_BYTES && cur.sz > 0)) { cur = { ys: [], sz: 0 }; groups.push(cur); }
    cur.ys.push(y); cur.sz += sz;
  }
  const dir = HOUT + "/" + o.sub, chunks = [], keep = new Set([o.base + ".js"]);
  for (const g of groups) {
    const from = g.ys[0], to = g.ys[g.ys.length - 1], file = o.base + "." + from + (to !== from ? "-" + to : "") + ".js";
    const sides = [], sIx = {}, adm = [], aIx = {};
    const si = (s) => (sIx[s] ??= sides.push(s) - 1), ai = (s) => (aIx[s] ??= adm.push(s) - 1);
    // row: id, date, end ("" = same day), lat, lon, type, best, low, high, civilians, side A, side B, place, province, where_prec, 1 = candidate
    const rowsOut = g.ys.flatMap((y) => byYear[y]).map((e) => [e.id, e.date, e.end && e.end !== e.date ? e.end : "", +e.lat.toFixed(4), +e.lon.toFixed(4), e.type, e.best, e.low, e.high, e.civ,
      si(e.a), si(e.b), e.where, ai(e.adm1), e.prec, e.s]);
    const body = { sides, adm, rows: rowsOut };
    const h = sha256(JSON.stringify(body));
    const txt = js('(window.OSAP_CF_HIST=window.OSAP_CF_HIST||{})["' + (o.sub + file).replace(/\.js$/, "") + '"]', Object.assign({ id: o.id, from, to, release: rel.version, sha256: h }, body));
    if (put(dir + file, txt)) changed++;
    keep.add(file);
    chunks.push({ f: o.sub + file, from, to, n: rowsOut.length, sha256: h });
  }
  const idx = Object.assign({ schema: "osap-cf-history/1", id: o.id, name: o.name, asof: stamp, since: o.since || "", start: o.start, ucdp_start: FIRST_UCDP,
    release: { name: rel.name, version: rel.version, url: rel.url, sha256: zipSha, last: gedLast }, candidate_after: gedLast,
    n: ev.length, best: ev.reduce((s, e) => s + e.best, 0), first: ev.length ? ev[0].date : "", last: ev.length ? ev[ev.length - 1].date : "",
    years, grid: gridOut, grid_deg: GRID, chunks }, o.extra,
    { cols: ["id", "date", "end", "lat", "lon", "type", "best", "low", "high", "civ", "sideA", "sideB", "where", "adm1", "prec", "candidate"],
      fp: "SHA-256 of each event: ucdp|<release or 'candidate'>|<id>|<date>|<lat>|<lon>|<type>|<best>|<low>|<high>" });
  if (put(dir + o.base + ".js", js('(window.OSAP_CF_HIST=window.OSAP_CF_HIST||{})["' + o.id + '"]', idx))) changed++;
  // chunks of years that no longer exist (a new release re-cut them) are removed
  for (const x of fs.readdirSync(dir)) if (x.startsWith(o.base + ".") && /\.\d{4}(-\d{4})?\.js$/.test(x) && !keep.has(x)) { fs.unlinkSync(dir + x); changed++; }
  console.log(o.id.padEnd(22), String(ev.length).padStart(7), "events", String(idx.best).padStart(8), "deaths (best)", chunks.length, "chunks", idx.first, "to", idx.last);
  return { n: ev.length, best: idx.best, chunks: chunks.length, first: idx.first, last: idx.last };
}
for (const f of F) {
  const c = f.c, r = writeHist({ id: c.id, sub: "", base: c.id, name: c.name, since: c.since, start: f.since, ev: f.ev, extra: { filter: c.ucdp } });
  newState.conflicts[c.id] = Object.assign({ key: keyOf(c) }, r);
}
// the countries: every event placed inside the country (see the top of this file), from 1989
if (CLIST.length) fs.mkdirSync(CDIR, { recursive: true });
for (const c of CLISTF) {
  const r = writeHist({ id: "cc/" + c.c.id, sub: "cc/", base: c.c.id, name: c.c.name, since: "", start: FIRST_UCDP, ev: CF[c.c.id].ev, extra: { cc: c.c.id, scope: "country" } });
  newState.countries[c.c.id] = Object.assign({ key: CC_KEY }, r);
}
if (CLIST.length) newState.unmatched_names = unnamed;
fs.writeFileSync(STATE_FILE, JSON.stringify(newState, null, 1) + "\n");
console.log("history files changed:", changed);
