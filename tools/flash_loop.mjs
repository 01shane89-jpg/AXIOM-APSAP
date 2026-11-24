// Flash loop (run by .github/workflows/refresh-flash.yml for about 5 h 20 min, then a fresh copy carries on).
// Before this, a push alert waited for a whole refresh lane: the keeper starts a lane every 15 minutes, the fast lane takes
// about 10 minutes to commit and the news lane 15 to 25 (and often waits behind the run before it), then the push job opens
// the pages. A quake USGS had published was on phones 12 to 30 minutes later. This loop keeps one runner awake and:
//   - every 15 s asks USGS's live event search for the last hour's M2.5+ quakes (the hour feed if it fails) and lays them over
//     data/live/quakes.js (tools/quake_rows.mjs);
//   - every 2 min asks GDACS for its current alerts (tools/refresh_feeds.mjs with FEEDS=gdacs);
//   - every 60 s asks the NOAA tsunami warning centers (PTWC and NTWC) for their bulletins (tools/refresh_more.mjs with ONLY=tsu),
//     which the page reads as official tsunami bulletin records, so a watch on a coast hears of one within about a minute, not
//     after the hourly lane (competitor gap, Shane 2026-11-18 "close the gap");
//   - every 60 s fetches main's newest commit and takes its data/ (so the fast and news lanes' commits are checked within a
//     minute of landing, not after the push job's own start-up);
//   - about every minute asks a short list of English wire, state agency, official and newspaper-of-record RSS feeds
//     (tools/flash_feeds.json, tools/flash_news.mjs) and lays their new items into each country's news file, and when one is
//     serious asks that country's other English feeds at once, so a second source's report is in too (a news FLASH needs two);
//     it also asks every other plain English RSS feed OSAP reads about every 5 minutes (the wide tier, 560 feeds on 23 Nov);
//     before this a news report reached a push only through the news lane, a median 47 minutes after the outlet's own time;
//   - whenever any of that changed and there is at least one push watch, runs tools/push_watches.mjs on the new data, so the
//     app's own matching rules (index.html wMatches) decide what is sent, exactly as in the push job.
// Nothing is committed: the lanes still own the published files. The push job in refresh-flood.yml stands aside while a loop
// runs or waits, so one seen-list (PUSH_STATE, kept in the Actions cache) decides what was sent and nothing goes out twice.
// Logs name quake ids, magnitudes and counts only, never report text.
// Env: FLASH_LOOP_MIN (default 320), FLASH_QUAKE_S (15), FLASH_GDACS_S (120), FLASH_TSU_S (60), FLASH_MAIN_S (60), FLASH_LIST_S (300),
//      FLASH_NEWS_S (60; 0 = no fast news), FLASH_WIDE_S (300; 0 = no wide tier), FLASH_NO_MAIN=1 (do not take main's data: a branch test of this file; main is still
//      read, never checked out, to time how much earlier the loop had each fast item), plus tools/push_watches.mjs's own env.
import fs from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { USGS_HOUR, quakeRow, mergeQuakes } from "./quake_rows.mjs";
import { fetchList } from "./push_lib.mjs";
import { median, serious } from "./flash_lib.mjs";
import { FastNews, fastFeeds, wideFeeds, layNews, linksIn, partFile } from "./flash_news.mjs";
import { storyLink } from "./news_dedupe.mjs";
import { loadRelevance } from "./topics_lib.mjs";
import { loadGazetteer } from "./gazetteer.mjs";

const env = process.env, S = (k, d) => Math.max(5, +(env[k] || d)) * 1000;
const END = Date.now() + Math.max(1, +(env.FLASH_LOOP_MIN || 320)) * 60e3;
const NEWS_ON = env.FLASH_NEWS_S !== "0";
const EVERY = { quake: S("FLASH_QUAKE_S", 15), gdacs: S("FLASH_GDACS_S", 120), tsu: S("FLASH_TSU_S", 60), main: S("FLASH_MAIN_S", 60), list: S("FLASH_LIST_S", 300), news: 5000 };
const QFILE = "data/live/quakes.js", GFILE = "data/live/gdacs.js", TFILE = "data/live/tsunami.js";
const due = { quake: 0, gdacs: 0, tsu: 0, main: 0, list: 0, news: NEWS_ON ? 0 : Infinity };
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

// ---------- tsunami bulletins ----------
// what a push check would see change: each bulletin's title, time and link (asof alone changes every run)
const tKey = () => { const t = readJs(TFILE); return JSON.stringify(((t && t.items) || []).map((i) => [i.title, i.date, i.link])); };
let tsuN = -1, tsuFail = 0;
function tsunami() {
  const before = tKey();
  try { execFileSync(process.execPath, ["tools/refresh_more.mjs"], { env: { ...env, ONLY: "tsu" }, stdio: "ignore", timeout: 60000 }); tsuFail = 0; }
  catch (e) {
    // the old file stays; a long outage is logged on its first minute and then every 30 minutes, not every minute
    if (tsuFail++ % 30 === 0) throw new Error(`tsunami step failed (${tsuFail} in a row)`);
    return false;
  }
  const after = tKey(), n = JSON.parse(after).length;
  if (n !== tsuN) { log(`tsunami bulletins in the last 30 days: ${n}`); tsuN = n; }
  return after !== before;
}

// ---------- main's newest data ----------
let mainSha = "";
try { mainSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch (e) {}   // the job checked out main's tip
function main() {
  execFileSync("git", ["fetch", "-q", "--depth", "1", "origin", "main"], { stdio: "ignore", timeout: 90000 });
  const sha = execFileSync("git", ["rev-parse", "FETCH_HEAD"], { encoding: "utf8" }).trim();
  if (sha === mainSha) return false;
  mainSha = sha;
  if (env.FLASH_NO_MAIN) { onMain((cc) => { try { return execFileSync("git", ["show", "FETCH_HEAD:" + partFile(cc)], { encoding: "utf8", maxBuffer: 64e6, stdio: ["ignore", "pipe", "ignore"] }); } catch (e) { return ""; } }); return false; }
  execFileSync("git", ["checkout", "-q", "FETCH_HEAD", "--", "data"], { stdio: "ignore", timeout: 120000 });
  layQuakes();   // main's quakes.js can be older than the loop's newest hour
  onMain(null);  // and main's news files may not carry the loop's fast items yet
  log(`main is at ${sha.slice(0, 7)}: took its data`);
  return true;
}

// ---------- fast news ----------
// pending: fast items main did not carry yet when the loop laid them (storyLink -> { cc, item, seen, firstPoll })
const pending = new Map(), newsLag = [], leadS = [];
let news = null, newsAdded = 0, bursts = 0, burstAdded = 0;
async function newsSetup() {
  const listed = JSON.parse(fs.readFileSync("tools/news_feeds.json", "utf8"));
  const urls = JSON.parse(fs.readFileSync("tools/flash_feeds.json", "utf8")).feeds, feeds = fastFeeds(listed, urls);
  const wideS = env.FLASH_WIDE_S === "0" ? 0 : Math.max(120, +(env.FLASH_WIDE_S || 300)), wide = wideS ? wideFeeds(listed, urls) : [];
  let gz = null;
  try { gz = await loadGazetteer(); } catch (e) { log(`gazetteer unavailable (${String(e.message || e).slice(0, 60)}): fast news items left unplaced`); }
  news = new FastNews({ feeds, wide, listed, R: await loadRelevance(), gz, base: Math.max(30, +(env.FLASH_NEWS_S || 60)), wideBase: wideS || 300, log });
  log(`fast news: ${feeds.length} feeds about every ${news.base} s` + (wide.length ? `, ${wide.length} more (every other plain English RSS feed) about every ${wideS} s` : ""));
}
async function fastNews() {
  if (!news) await newsSetup();
  const now = Date.now(), got = await news.round(now);
  let changed = false;
  for (const [cc, list] of Object.entries(got)) {
    const fresh = list.filter((i) => !pending.has(storyLink(i.link)));
    if (!fresh.length) continue;
    const add = layNews(cc, fresh.map(clean));
    if (!add.length) continue;
    changed = true;
    const byLink = new Map(fresh.map((i) => [i.link, i]));
    for (const a of add) {
      const i = byLink.get(a.link) || {}, out = Math.round((now - Date.parse(a.date + "Z")) / 1000);
      pending.set(storyLink(a.link), { cc, item: a, seen: now, first: !!i._first });
      if (i._burst) burstAdded++; else newsAdded++;
      // the first answer of a feed holds items from before the loop started: not a measure of it
      if (!i._first) { if (!i._burst) newsLag.push(out); log(`new fast item ${cc} ${a.outlet}${i._burst ? " (burst)" : i._wide ? " (wide)" : ""}: ${out} s after its outlet's time${i._late ? ", late post" : ""}${serious({ t: a.title_en }) ? ", serious" : ""}`); }
      // a burst follows a new serious report, not one from before the loop started or one a burst found
      if (!i._first && !i._burst && serious({ t: a.title_en })) { const n = news.burst(cc, now); if (n) { bursts++; log(`burst: asking ${n} more ${cc} feed(s) at once`); } }
    }
  }
  // old pending items: main carries them by now or never will (the lane's own cut); stop re-laying them
  for (const [k, p] of pending) if (now - p.seen > 3 * 36e5) pending.delete(k);
  return changed;
}
const clean = (i) => { const o = { ...i }; delete o._first; delete o._burst; delete o._wide; delete o._late; return o; };
/* main moved: time each pending item main now carries (how much earlier the loop had it), re-lay the rest. read(cc) gives the text
   of main's file for cc without checking it out (a branch test); null means main's data was checked out */
function onMain(read) {
  const by = {};
  for (const [k, p] of pending) (by[p.cc] = by[p.cc] || []).push([k, p]);
  for (const [cc, list] of Object.entries(by)) {
    let have;
    if (read) { const t = read(cc), tmp = ".flash-main-" + cc + ".js"; fs.writeFileSync(tmp, t || ""); have = linksIn(cc, tmp); fs.rmSync(tmp, { force: true }); }
    else have = linksIn(cc);
    const left = [];
    for (const [k, p] of list) {
      if (have.has(k)) { if (!p.first) { const s = Math.round((Date.now() - p.seen) / 1000); leadS.push(s); log(`main now carries a fast ${cc} item the loop had ${s} s earlier`); } pending.delete(k); }
      else left.push(p.item);
    }
    if (!read && left.length) layNews(cc, left);
  }
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
log(`started; runs until ${new Date(END).toISOString().slice(11, 16)}Z; quakes every ${EVERY.quake / 1000} s, GDACS every ${EVERY.gdacs / 1000} s, tsunami bulletins every ${EVERY.tsu / 1000} s, main every ${EVERY.main / 1000} s${env.FLASH_NO_MAIN ? " (read only, to time fast news)" : ""}, fast news ${NEWS_ON ? "on" : "off"}`);
let checks = 0, errors = 0;
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
  await step("tsu", tsunami);
  await step("news", fastNews);
  if (why.length && watches > 0) { checks++; await pushCheck(why.join("+")); }
  await sleep(Math.max(1000, Math.min(...Object.values(due)) - Date.now()));
}
const f = (a) => (a.length ? `median ${median(a)}, fastest ${Math.min(...a)}, slowest ${Math.max(...a)}` : "none");
log(`done: ${checks} push check(s), ${errors} error(s); push check seconds ${f(scanS.map(Math.round))}`);
log(`new quakes seen ${qLag.length}: seconds after they happened ${f(qLag)}; seconds after USGS published them ${f(pubLag)}`);
if (news) {
  log(`fast news: ${news.requests} request(s), ${news.notModified} not modified, ${news.failures} failed (${news.refused || 0} wide feed(s) refusing OSAP's name left to the lane); ${newsAdded} item(s) laid before main had them, ${bursts} burst(s) adding ${burstAdded}`);
  log(`fast news items seen after the loop started ${newsLag.length}: seconds after their outlet's time ${f(newsLag)}`);
  log(`fast news items main later carried ${leadS.length}: seconds the loop had them earlier ${f(leadS)}; still not on main ${[...pending.values()].filter((p) => !p.first).length}`);
}
