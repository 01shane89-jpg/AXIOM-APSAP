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
// Skips the work when nothing changed: same GED release, same filters, built within the past 6 days (FORCE=1 rebuilds).
// The CSV is read by tools/ged_extract.py (Python standard library) and handed over as one line per event.
// Env: UCDP_CACHE (default .cache/ucdp) holds the downloaded release zip; CONFLICTS=a,b limits the run.
import fs from "node:fs";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { sha256 } from "./conflict_lib.mjs";

const OUT = "data/live/conflicts", HOUT = OUT + "/history", CACHE = process.env.UCDP_CACHE || ".cache/ucdp";
const FORCE = process.env.FORCE === "1", ONLY = (process.env.CONFLICTS || "").split(",").filter(Boolean);
const CFG = JSON.parse(fs.readFileSync("tools/conflicts.json", "utf8"));
const LIST = CFG.conflicts.filter((c) => c.ucdp && (!ONLY.length || ONLY.includes(c.id)));
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
if (!FORCE && state.release === rel.name && ageDays < 6 && !stale.length) {
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
const zipSha = sha256(fs.readFileSync(zip));

const F = LIST.map((c) => ({ c, since: (c.since && c.since > FIRST_UCDP ? c.since : FIRST_UCDP), cre: new RegExp(c.ucdp.countries, "i"),
  mre: c.ucdp.match && new RegExp(c.ucdp.match), xre: c.ucdp.exclude && new RegExp(c.ucdp.exclude), ev: [] }));
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
  for (const f of F) {
    if (date < f.since || !f.cre.test(country) || (f.mre && !f.mre.test(names)) || (f.xre && f.xre.test(names))) continue;
    f.ev.push({ id: r[ix.id], date: date, end: (r[ix.date_end] || "").slice(0, 10), lat: +r[ix.latitude], lon: +r[ix.longitude], type: +r[ix.type_of_violence] || 0,
      best: +r[ix.best] || 0, low: +r[ix.low] || 0, high: +r[ix.high] || 0, civ: +r[ix.deaths_civilians] || 0, a: r[ix.side_a] || "", b: r[ix.side_b] || "",
      where: String(r[ix.where_description] || "").replace(/\s+/g, " ").trim().slice(0, 80), adm1: r[ix.adm_1] || "", prec: +r[ix.where_prec] || 0, country: country, s: 0 });
  }
});
const code = await unzDone;
if (code || !rows) throw new Error("reading " + rel.name + " failed (exit " + code + ", " + rows + " rows)");
console.log("GED", rel.version, rows, "events, last", gedLast);

// after the release: the candidate events the hourly job keeps for each conflict (provisional; UCDP revises them)
for (const f of F) {
  const p = readJs(OUT + "/" + f.c.id + ".js") || {}, o = readJs(OUT + "/" + f.c.id + ".older.js") || {};
  const seen = new Set();
  for (const e of [...(p.ucdp || []), ...(o.ucdp || [])]) {
    if (!e || !e.date || e.date <= gedLast || e.date < f.since || seen.has(e.id)) continue; seen.add(e.id);
    f.ev.push({ id: String(e.id), date: e.date, end: e.end || "", lat: +e.lat, lon: +e.lon, type: +e.type || 0, best: +e.best || 0, low: +e.low || 0, high: +e.high || 0,
      civ: +e.civ || 0, a: e.sideA || "", b: e.sideB || "", where: String(e.where || "").slice(0, 80), adm1: e.adm1 || "", prec: +e.prec || 0, country: e.country || "", s: 1 });
  }
}

const newState = { schema: "osap-cf-history-state/1", release: rel.name, version: rel.version, zip_sha256: zipSha, ged_last: gedLast, built: stamp, conflicts: Object.assign({}, state.conflicts || {}) };
let changed = 0;
for (const f of F) {
  const c = f.c, ev = f.ev.filter((e) => isFinite(e.lat) && isFinite(e.lon)).sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.id < y.id ? -1 : 1));
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
  const chunks = [], keep = new Set([c.id + ".js"]);
  for (const g of groups) {
    const from = g.ys[0], to = g.ys[g.ys.length - 1], file = c.id + "." + from + (to !== from ? "-" + to : "") + ".js";
    const sides = [], sIx = {}, adm = [], aIx = {};
    const si = (s) => (sIx[s] ??= sides.push(s) - 1), ai = (s) => (aIx[s] ??= adm.push(s) - 1);
    // row: id, date, end ("" = same day), lat, lon, type, best, low, high, civilians, side A, side B, place, province, where_prec, 1 = candidate
    const rowsOut = g.ys.flatMap((y) => byYear[y]).map((e) => [e.id, e.date, e.end && e.end !== e.date ? e.end : "", +e.lat.toFixed(4), +e.lon.toFixed(4), e.type, e.best, e.low, e.high, e.civ,
      si(e.a), si(e.b), e.where, ai(e.adm1), e.prec, e.s]);
    const body = { sides, adm, rows: rowsOut };
    const h = sha256(JSON.stringify(body));
    const txt = js('(window.OSAP_CF_HIST=window.OSAP_CF_HIST||{})["' + file.replace(/\.js$/, "") + '"]', Object.assign({ id: c.id, from, to, release: rel.version, sha256: h }, body));
    if (put(HOUT + "/" + file, txt)) changed++;
    keep.add(file);
    chunks.push({ f: file, from, to, n: rowsOut.length, sha256: h });
  }
  const idx = { schema: "osap-cf-history/1", id: c.id, name: c.name, asof: stamp, since: c.since || "", start: f.since, ucdp_start: FIRST_UCDP,
    release: { name: rel.name, version: rel.version, url: rel.url, sha256: zipSha, last: gedLast }, candidate_after: gedLast,
    n: ev.length, best: ev.reduce((s, e) => s + e.best, 0), first: ev.length ? ev[0].date : "", last: ev.length ? ev[ev.length - 1].date : "",
    years, grid: gridOut, grid_deg: GRID, chunks,
    filter: c.ucdp, cols: ["id", "date", "end", "lat", "lon", "type", "best", "low", "high", "civ", "sideA", "sideB", "where", "adm1", "prec", "candidate"],
    fp: "SHA-256 of each event: ucdp|<release or 'candidate'>|<id>|<date>|<lat>|<lon>|<type>|<best>|<low>|<high>" };
  if (put(HOUT + "/" + c.id + ".js", js('(window.OSAP_CF_HIST=window.OSAP_CF_HIST||{})["' + c.id + '"]', idx))) changed++;
  // chunks of years that no longer exist (a new release re-cut them) are removed
  for (const x of fs.readdirSync(HOUT)) if (x.startsWith(c.id + ".") && /\.\d{4}(-\d{4})?\.js$/.test(x) && !keep.has(x)) { fs.unlinkSync(HOUT + "/" + x); changed++; }
  newState.conflicts[c.id] = { key: keyOf(c), n: ev.length, best: idx.best, chunks: chunks.length, first: idx.first, last: idx.last };
  console.log(c.id.padEnd(22), String(ev.length).padStart(7), "events", String(idx.best).padStart(8), "deaths (best)", chunks.length, "chunks", idx.first, "to", idx.last);
}
fs.writeFileSync(STATE_FILE, JSON.stringify(newState, null, 1) + "\n");
console.log("history files changed:", changed);
