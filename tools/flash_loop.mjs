// Flash loop (run by .github/workflows/refresh-flash.yml for about 5 h 20 min, then a fresh copy carries on).
// Before this, a push alert waited for a whole refresh lane: the keeper starts a lane every 15 minutes, the fast lane takes
// about 10 minutes to commit and the news lane 15 to 25 (and often waits behind the run before it), then the push job opens
// the pages. A quake USGS had published was on phones 12 to 30 minutes later. This loop keeps one runner awake and:
//   - every 15 s asks USGS's live event search for the last hour's M2.5+ quakes (the hour feed if it fails) and lays them over
//     data/live/quakes.js (tools/quake_rows.mjs);
//   - every 2 min asks GDACS for its current alerts (tools/refresh_feeds.mjs with FEEDS=gdacs);
//   - every 60 s fetches main's newest commit and takes its data/ (so the fast and news lanes' commits are checked within a
//     minute of landing, not after the push job's own start-up);
//   - whenever any of that changed and there is at least one push watch, runs tools/push_watches.mjs on the new data, so the
//     app's own matching rules (index.html wMatches) decide what is sent, exactly as in the push job.
// Nothing is committed: the lanes still own the published files. The push job in refresh-flood.yml stands aside while a loop
// runs or waits, so one seen-list (PUSH_STATE, kept in the Actions cache) decides what was sent and nothing goes out twice.
// Logs name quake ids, magnitudes and counts only, never report text.
// Env: FLASH_LOOP_MIN (default 320), FLASH_QUAKE_S (15), FLASH_GDACS_S (120), FLASH_MAIN_S (60), FLASH_LIST_S (300),
//      FLASH_NO_MAIN=1 (do not take main's data: a branch test of this file), plus tools/push_watches.mjs's own env.
import fs from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { USGS_HOUR, quakeRow, mergeQuakes } from "./quake_rows.mjs";
import { fetchList } from "./push_lib.mjs";
import { median } from "./flash_lib.mjs";

const env = process.env, S = (k, d) => Math.max(5, +(env[k] || d)) * 1000;
const END = Date.now() + Math.max(1, +(env.FLASH_LOOP_MIN || 320)) * 60e3;
const EVERY = { quake: S("FLASH_QUAKE_S", 15), gdacs: S("FLASH_GDACS_S", 120), main: S("FLASH_MAIN_S", 60), list: S("FLASH_LIST_S", 300) };
const QFILE = "data/live/quakes.js", GFILE = "data/live/gdacs.js";
const due = { quake: 0, gdacs: 0, main: 0, list: 0 };
const zt = () => new Date().toISOString().slice(11, 19) + "Z";
const log = (s) => console.log(`flash ${zt()} ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readJs(file) {
  try { const t = fs.readFileSync(file, "utf8"); return JSON.parse(t.slice(t.indexOf("=") + 1).trim().replace(/;$/, "")); } catch (e) { return null; }
}
function writeJs(file, global, body) { fs.writeFileSync(file, "window." + global + "=" + JSON.stringify(body).replace(/<\//g, "<\\/") + ";\n"); }

// ---------- quakes ----------
let hourRows = [], etag = "", seenQ = new Set(), firstQ = true;
{ const q = readJs(QFILE); for (const r of (q && q.features) || []) seenQ.add(r.id); }
const qLag = [], pubLag = [];
// USGS's live event search (FDSN), not the summary feed: on main, 8-9 Nov 2026, the hour feed (cached about a minute at USGS's
// edge) showed new quakes a median 52 s (30-96 s) after USGS published them. The search answers from the catalogue itself.
// One small question every 15 s (30 s until 9 Nov 2026: 6 quakes seen a median 22 s, 13-34 s, after USGS published them): M2.5+ quakes from the last 65 minutes. When it fails, the hour feed is asked instead.
const FDSN = "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=2.5&orderby=time&limit=400&starttime=";
let via = "";
async function getQuakes() {
  const h = { "user-agent": "AXIOM-OSAP flash loop" };
  try {
    const r = await fetch(FDSN + new Date(Date.now() - 65 * 60e3).toISOString().slice(0, 19), { headers: h, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    if (via !== "search") { via = "search"; log("quakes from USGS's live event search"); }
    return await r.json();
  } catch (e) {
    if (via !== "feed") { via = "feed"; log(`USGS event search failed (${String(e.message || e).slice(0, 60)}); using the hour feed`); }
    if (etag) h["if-none-match"] = etag;
    const r = await fetch(USGS_HOUR, { headers: h, signal: AbortSignal.timeout(15000) });
    if (r.status === 304) return null;
    if (!r.ok) throw new Error("USGS hour feed HTTP " + r.status);
    etag = r.headers.get("etag") || "";
    return await r.json();
  }
}
async function quakes() {
  const g = await getQuakes(), now = Date.now();
  if (!g) return false;
  hourRows = (g.features || []).map(quakeRow).filter(Boolean);
  const upd = new Map((g.features || []).map((f) => [f.id, +((f.properties || {}).updated) || 0]));
  const changed = layQuakes();
  for (const q of hourRows) {
    if (seenQ.has(q.id)) continue;
    seenQ.add(q.id);
    const o = Math.round((now - q.time) / 1000), p = upd.get(q.id) ? Math.round((now - upd.get(q.id)) / 1000) : null;
    if (firstQ) continue;               // the first answer holds quakes from before the loop started: not a measure of it
    qLag.push(o); if (p != null) pubLag.push(p);
    log(`new quake ${q.id} M${q.mag}: ${o} s after it happened, ${p == null ? "?" : p} s after USGS published it`);
  }
  firstQ = false;
  return changed;
}
/* the newest hour over whatever quakes.js holds now (the lane's file or main's); true when that changed the file */
function layQuakes() {
  const q = readJs(QFILE) || { src: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson", features: [] };
  const m = mergeQuakes(q.features, hourRows, Date.now());
  if (!m.added.length && !m.changed.length) return false;
  writeJs(QFILE, "ASAP_QUAKES", { ...q, asof: new Date().toISOString().slice(0, 16).replace("T", " ") + "Z", features: m.rows });
  return true;
}

// ---------- GDACS ----------
const gKey = () => { const g = readJs(GFILE); return JSON.stringify((g && g.events) || []); };
function gdacs() {
  const before = gKey();
  try { execFileSync(process.execPath, ["tools/refresh_feeds.mjs"], { env: { ...env, FEEDS: "gdacs" }, stdio: "ignore", timeout: 60000 }); } catch (e) { throw new Error("GDACS step failed"); }
  return gKey() !== before;
}

// ---------- main's newest data ----------
let mainSha = "";
try { mainSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch (e) {}   // the job checked out main's tip
function main() {
  execFileSync("git", ["fetch", "-q", "--depth", "1", "origin", "main"], { stdio: "ignore", timeout: 90000 });
  const sha = execFileSync("git", ["rev-parse", "FETCH_HEAD"], { encoding: "utf8" }).trim();
  if (sha === mainSha) return false;
  mainSha = sha;
  execFileSync("git", ["checkout", "-q", "FETCH_HEAD", "--", "data"], { stdio: "ignore", timeout: 120000 });
  layQuakes();   // main's quakes.js can be older than the loop's newest hour
  log(`main is at ${sha.slice(0, 7)}: took its data`);
  return true;
}

// ---------- the push check ----------
let watches = -1;
const scanS = [];
function pushCheck(why) {
  return new Promise((res) => {
    const t0 = Date.now();
    const c = spawn(process.execPath, ["tools/push_watches.mjs"], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    c.stdout.on("data", (d) => { out += d; }); c.stderr.on("data", (d) => { out += d; });
    const kill = setTimeout(() => c.kill("SIGKILL"), 8 * 60e3);
    c.on("close", (code) => {
      clearTimeout(kill);
      const s = Math.round((Date.now() - t0) / 100) / 10; scanS.push(s);
      const lines = out.split("\n").filter((l) => /^push: /.test(l) && !/: \d+ matching, 0 new, 0 sent$/.test(l) && !/0 morning brief\(s\) sent, 0 held/.test(l));
      log(`push check (${why}) took ${s} s, exit ${code}` + (lines.length ? "\n  " + lines.join("\n  ") : ""));
      res();
    });
  });
}

// ---------- the loop ----------
log(`started; runs until ${new Date(END).toISOString().slice(11, 16)}Z; quakes every ${EVERY.quake / 1000} s, GDACS every ${EVERY.gdacs / 1000} s, main every ${EVERY.main / 1000} s`);
let checks = 0, errors = 0;
if (env.FLASH_NO_MAIN) due.main = Infinity;
while (Date.now() < END) {
  const now = Date.now(), why = [];
  const step = async (k, fn) => {
    if (now < due[k]) return;
    due[k] = now + EVERY[k];
    try { if (await fn()) why.push(k); } catch (e) { errors++; log(`${k} failed: ${String(e.message || e).split("\n")[0].slice(0, 160)}`); }
  };
  await step("list", async () => {
    const n = (await fetchList()).watches.length;
    if (n !== watches) log(`${n} push watch(es)`);
    const was = watches; watches = n;
    return was === 0 && n > 0;          // a first watch: check it at once (its first check only notes what is there)
  });
  await step("main", main);
  await step("quake", quakes);
  await step("gdacs", gdacs);
  if (why.length && watches > 0) { checks++; await pushCheck(why.join("+")); }
  await sleep(Math.max(1000, Math.min(...Object.values(due)) - Date.now()));
}
const f = (a) => (a.length ? `median ${median(a)}, fastest ${Math.min(...a)}, slowest ${Math.max(...a)}` : "none");
log(`done: ${checks} push check(s), ${errors} error(s); push check seconds ${f(scanS.map(Math.round))}`);
log(`new quakes seen ${qLag.length}: seconds after they happened ${f(qLag)}; seconds after USGS published them ${f(pubLag)}`);
