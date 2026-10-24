// Push watches (run by .github/workflows/refresh-flood.yml, job "push", after each refresh on main; or by hand with Node 18+).
// For each watch kept on OSAP's server (added from the app's Push to phone button; tools/push_lib.mjs fetchList):
//   1. The watch's country page is opened headless on the repo's own data (index.html?watchscan=1, network cut off) and
//      window.OSAP_WATCH.matches(watch) lists the reports it matches: the app's own rules (area, categories, severity, words,
//      last 7 days, grouped into events), so a push and the in-app Watch never disagree.
//   2. Reports not seen before for that watch, dated in the last PUSH_MAX_AGE_H hours, are sent to the watch's ntfy.sh channel:
//      one alert per event, at most PER_WATCH per watch per run, then one "and N more" alert. A report joining an event that was
//      already sent is noted, not sent again. The first check of a new watch only notes what is already there.
//   3. Once a local morning, each ntfy channel also gets a morning brief for the countries its watches are on
//      (tools/push_brief.mjs), sent after the alerts and inside the same per-run cap.
//   4. What was seen is kept in PUSH_STATE (the job keeps it in the Actions cache, never in the repo). Losing it only means the
//      next check notes everything again without sending.
// A push is a notice about a report, never a finding: it carries the source, the report's status and "reported, not verified".
// Report text is data; nothing in it is followed. Logs name watch ids and counts only, never report text.
// Env: PUSH_STATE (default .push-state/state.json), PUSH_TEST=1 (send the newest match of each watch as a test, keep no state),
//      PUSH_BRIEF=0 (no morning briefs), PUSH_DRY=1 (send nothing, print what would be sent; still keeps state), PUSH_NTFY (default https://ntfy.sh), CHROME_PATH.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fetchList } from "./push_lib.mjs";
import { rulesForPage } from "./tiers.mjs";
import * as BRIEF from "./push_brief.mjs";

const STATE = process.env.PUSH_STATE || ".push-state/state.json";
const NTFY = (process.env.PUSH_NTFY || "https://ntfy.sh").replace(/\/$/, "");
const LIVE = "https://01shane89-jpg.github.io/AXIOM-APSAP/";
const TEST = !!process.env.PUSH_TEST, DRY = !!process.env.PUSH_DRY;
const MAX_AGE_H = +(process.env.PUSH_MAX_AGE_H || 48), PER_WATCH = 3, PER_RUN = +(process.env.PUSH_PER_RUN || 60), KEEP_KEYS = 4000;
const now = Date.now();

let list;
try { list = (await fetchList()).watches; } catch (e) { console.log("push: could not read the push list:", e.message); process.exit(0); }
if (!list.length) { console.log("push: no push watches"); process.exit(0); }

function loadState() { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch (e) { return { watches: {} }; } }
function saveState(s) { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(s)); }

function loadPlaywright() {
  const req = createRequire(import.meta.url);
  for (const m of ["playwright-core", "playwright", "/opt/node22/lib/node_modules/playwright"]) { try { return req(m); } catch (e) {} }
  throw new Error("playwright-core is not installed (npm install --no-save playwright-core)");
}
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
function serve(root) {
  const srv = http.createServer((q, s) => {
    const p = path.normalize(decodeURIComponent(q.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
    const f = path.join(root, p === "/" ? "index.html" : p);
    if (!f.startsWith(root)) { s.writeHead(403); return s.end(); }
    fs.readFile(f, (e, b) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); s.end(b); });
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv)));
}

// ---------- 1. matches, country by country ----------
async function scan() {
  const { chromium } = loadPlaywright();
  const srv = await serve(process.cwd()), port = srv.address().port, base = `http://127.0.0.1:${port}/index.html?watchscan=1#`;
  const opts = {};
  const chrome = process.env.CHROME_PATH || ["/usr/bin/google-chrome", "/opt/pw-browsers/chromium"].find((p) => fs.existsSync(p));
  if (chrome) opts.executablePath = chrome;
  const browser = await chromium.launch(opts);
  const ctx = await browser.newContext({ serviceWorkers: "block" });
  const LEAFLET = "assets/vendor/leaflet-1.9.4.js";
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => (/leaflet(\.min)?\.js$/.test(r.request().url()) && fs.existsSync(LEAFLET)
    ? r.fulfill({ status: 200, contentType: "text/javascript", body: fs.readFileSync(LEAFLET, "utf8") }) : r.abort()));
  // a Mid account's watch is checked on a page that leaves out the files Mid cannot open (assets/osap-datagate.js, with the
  // plan's rules from tools/tiers.mjs), so its alerts carry only what that account sees in the app
  const midCtx = list.some((w) => w.plan === "mid") ? await browser.newContext({ serviceWorkers: "block" }) : null;
  if (midCtx) {
    await midCtx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => (/leaflet(\.min)?\.js$/.test(r.request().url()) && fs.existsSync(LEAFLET)
      ? r.fulfill({ status: 200, contentType: "text/javascript", body: fs.readFileSync(LEAFLET, "utf8") }) : r.abort()));
    const R = rulesForPage();
    await midCtx.addInitScript((p) => { try {
      localStorage.setItem("osap-auth", JSON.stringify({ access_token: "push-scan", until: Date.now() + 864e5 }));
      localStorage.setItem("osap-tier-plan", JSON.stringify(p));
    } catch (e) {} }, { tier: "mid", data: R.data, dataDefault: R.dataDefault });
  }
  const byCc = {};
  list.forEach((w) => { const k = w.cc + (w.plan === "mid" ? "|mid" : ""); (byCc[k] = byCc[k] || []).push(w); });
  const out = {}, failed = [], queue = Object.keys(byCc), meta = { tz: {}, names: {} };
  await Promise.all([0, 1, 2].map(async () => {
    while (queue.length) {
      const key = queue.shift(), cc = key.split("|")[0], p = await (key.endsWith("|mid") ? midCtx : ctx).newPage();
      try {
        await p.goto(base + (cc === "th" ? "" : cc + "/") + "timeline", { timeout: 30000 });
        await p.waitForFunction(() => window.OSAP_WATCH && window.TSAP, null, { timeout: 30000 });
        // the live layers load after the page: wait until the report count has held still for 3 s (at most 30 s)
        for (let last = -1, same = 0, t0 = Date.now(); same < 3 && Date.now() - t0 < 30000; ) {
          const n = await p.evaluate(() => (window.TSAP.records || []).length);
          same = n === last ? same + 1 : 0; last = n; await p.waitForTimeout(1000);
        }
        if (key.endsWith("|mid") && !(await p.evaluate(() => !!(window.OSAP_DATA && window.OSAP_DATA.plan() && window.OSAP_DATA.plan().tier === "mid")))) throw new Error("Mid's data rules did not take");
        // each country's main time zone and name, from the page (the morning brief's clock for watches sent without one)
        if (!meta.tz[cc]) Object.assign(meta.tz, await p.evaluate(() => window.OSAP_TZMAP || {}));
        meta.names[cc] = await p.evaluate((c) => { const n = window.OSAP_WATCH.countryName && window.OSAP_WATCH.countryName(c); return typeof n === "string" ? n : ""; }, cc);
        for (const w of byCc[key]) {
          out[w.id] = await p.evaluate((w) => {
            return window.OSAP_WATCH.matches(w);
          }, { area: w.area, layers: w.layers, kw: w.kw, q: w.q, minSev: w.minSev, conf: w.conf });
        }
      } catch (e) { failed.push(key + ": " + String(e.message || e).split("\n")[0]); }
      finally { await p.close(); }
    }
  }));
  await browser.close(); srv.close();
  if (failed.length) console.log("push: failed countries: " + failed.join("; "));
  return { out, meta };
}

// ---------- 2. sending ----------
const SEVN = ["", "Low", "Medium", "High"];
function msOf(ts) {
  const s = String(ts || ""); if (!s) return NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.parse(s + "T12:00:00Z");
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s.replace(" ", "T") : s.replace(" ", "T") + "Z");
}
function zulu(ts) { const t = msOf(ts); return isFinite(t) ? new Date(t).toISOString().slice(0, 16).replace("T", " ") + "Z" : String(ts || "").slice(0, 16); }
function link(k, cc) { return LIVE + "?wopen=" + encodeURIComponent(k) + "#" + (cc === "th" ? "" : cc + "/") + "timeline"; }
// ntfy headers and JSON fields are plain text; keep them short and single-line where ntfy wants that
function one(s, n) { return String(s || "").replace(/\s+/g, " ").trim().slice(0, n); }
async function send(w, msg) {
  if (DRY) { console.log(`push: [dry] ${w.id}: ${msg.title} / ${msg.message.split("\n").join(" / ")} / ${msg.click}`); return true; }
  const body = { topic: w.topic, title: msg.title, message: msg.message, click: msg.click, tags: msg.tags, priority: msg.priority };
  if (msg.actions) body.actions = msg.actions;
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(NTFY, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
      if (r.ok) { if (TEST) { const j = await r.json().catch(() => ({})); console.log(`push: ${w.id}: ntfy accepted, message id ${j.id || "?"}, event ${j.event || "?"}`); } return true; }
      console.log(`push: ${w.id}: ntfy HTTP ${r.status}`);
      if (r.status !== 429 && r.status < 500) return false;
    } catch (e) { console.log(`push: ${w.id}: ntfy ${e.name || "error"}`); }
    await new Promise((res) => setTimeout(res, 5000 * (a + 1)));
  }
  return false;
}
function alertFor(w, m) {
  const sev = SEVN[m.sev || 1] || "", url = /^https?:\/\//.test(m.url) ? m.url : "";
  return {
    title: one((TEST ? "[test] " : "") + "OSAP watch: " + w.name, 120),
    message: one(m.rt || m.t, 300) + "\n" + one([m.rsrc || m.src, m.st, sev && sev + " severity", zulu(m.ts)].filter(Boolean).join(" · "), 200) +
      (m.grp > 1 ? `\nPart of an event with ${m.grp} reports: ${one(m.t, 120)}` : "") + (m.word ? `\nMatched "${one(m.word, 60)}".` : "") + "\nReported, not verified. Tap to open in OSAP.",
    click: link(m.k, w.cc), tags: ["osap"], priority: (m.sev || 1) >= 3 ? 4 : 3,
    actions: url ? [{ action: "view", label: "Source", url, clear: false }] : undefined,
  };
}

const { out: matches, meta } = await scan();
const state = TEST ? { watches: {} } : loadState();
const next = { watches: {}, at: new Date(now).toISOString() };
let sentTotal = 0, noted = 0, failedSends = 0, held = 0;
// 1. what is new for each watch
const jobs = [];
for (const w of list) {
  const ms = matches[w.id];
  const prev = state.watches[w.id];
  if (!ms) { if (prev) next.watches[w.id] = prev; continue; }   // country failed to load: keep what was seen
  const seen = (prev && prev.seen) || {}, sent = (prev && prev.sent) || {}, first = !prev && !TEST;
  const fresh = [], groups = {};
  for (const m of ms) {
    if (seen[m.k]) continue;
    seen[m.k] = now;
    if (first) continue;
    const t = msOf(m.ts);
    if (!TEST && (!isFinite(t) || now - t > MAX_AGE_H * 36e5 || t > now + 36e5)) continue;
    if (sent[m.gk + ""]) continue;                       // this event was already sent
    if (groups[m.gk]) continue;
    groups[m.gk] = 1; fresh.push(m);
  }
  fresh.sort((a, b) => (msOf(b.ts) || 0) - (msOf(a.ts) || 0));
  const todo = TEST ? ms.slice().sort((a, b) => (msOf(b.ts) || 0) - (msOf(a.ts) || 0)).slice(0, 1) : fresh.slice(0, PER_WATCH);
  if (first) noted++;
  jobs.push({ w, ms, seen, sent, first, fresh, todo, done: 0 });
}
// 2. sending in rounds, the newest alert of every watch first, so with many accounts no watch waits behind another's backlog.
//    An alert the run's cap holds back is not marked seen, so the next run sends it.
for (let round = 0; round < PER_WATCH; round++) {
  for (const j of jobs) {
    const m = j.todo[round]; if (!m) continue;
    if (sentTotal >= PER_RUN) continue;
    if (await send(j.w, alertFor(j.w, m))) { sentTotal++; j.done++; j.sent[m.gk + ""] = now; } else failedSends++;
  }
}
for (const j of jobs) {
  const { w, seen, sent, fresh, todo } = j;
  j.todo.slice(j.done).forEach((m) => { if (!sent[m.gk + ""] && sentTotal >= PER_RUN) { delete seen[m.k]; held++; } });
  const more = TEST ? 0 : fresh.length - todo.length;
  if (more > 0 && sentTotal < PER_RUN) {
    const ok = await send(w, { title: one("OSAP watch: " + w.name, 120), message: `${more} more new report${more === 1 ? "" : "s"} matched this watch. Open OSAP to see them all.`,
      click: LIVE + "#" + (w.cc === "th" ? "" : w.cc + "/") + "timeline", tags: ["osap"], priority: 2 });
    if (ok) { sentTotal++; fresh.slice(todo.length).forEach((m) => { sent[m.gk + ""] = now; }); }
  } else if (more > 0) fresh.slice(todo.length).forEach((m) => { delete seen[m.k]; held++; });
  // keep the newest KEEP_KEYS seen keys, and sent events for 4 days (event ids are only stable while the event is open)
  const ks = Object.keys(seen); if (ks.length > KEEP_KEYS) ks.sort((a, b) => seen[a] - seen[b]).slice(0, ks.length - KEEP_KEYS).forEach((k) => delete seen[k]);
  Object.keys(sent).forEach((k) => { if (now - sent[k] > 4 * 864e5) delete sent[k]; });
  next.watches[w.id] = { seen, sent, checked: now };
  console.log(`push: ${w.id} (${w.cc}${w.plan === "mid" ? ", mid" : ""}): ${j.ms.length} matching, ${j.first ? "first check, noted only" : fresh.length + " new, " + j.done + " sent" + (more > 0 ? ", +" + more + " more" : "")}`);
}
// 3. morning briefs, one a local day per channel, after the alerts and inside the same cap. A channel one of whose countries did
//    not load this run waits for the next check (still inside its morning), so a brief never says "nothing" for want of data.
let briefs = 0, briefsHeld = 0;
next.briefs = TEST ? {} : { ...(state.briefs || {}) };
if (process.env.PUSH_BRIEF !== "0") {
  for (const ch of BRIEF.channels(list, meta.tz)) {
    const day = TEST ? BRIEF.local(now, ch.tz).date : BRIEF.dueDate(ch, now, next.briefs[ch.topic]);
    if (!day) continue;
    if (ch.watches.some((w) => !matches[w.id])) { briefsHeld++; continue; }
    if (sentTotal >= PER_RUN) { briefsHeld++; continue; }
    const msg = BRIEF.compose(ch, { matches, names: meta.names, daily: (cc) => BRIEF.dailyOf(cc, now), now, live: LIVE, test: TEST });
    if (!msg) continue;
    if (await send(ch.watches[0], msg)) { sentTotal++; briefs++; next.briefs[ch.topic] = day; } else failedSends++;
  }
  // forget channels that no longer have a watch
  const live = new Set(list.map((w) => w.topic)); Object.keys(next.briefs).forEach((t) => { if (!live.has(t)) delete next.briefs[t]; });
}
console.log(`push: ${briefs} morning brief(s) sent, ${briefsHeld} held for the next check`);
if (!TEST) saveState(next);
console.log(`push: ${list.length} watch(es), ${sentTotal} alert(s) sent, ${failedSends} failed, ${held} held for the next run, ${noted} new watch(es) noted`);
// a test run reads its channels back from ntfy.sh, to prove the alerts arrived (counts only)
if (TEST && !DRY) {
  for (const t of [...new Set(list.map((w) => w.topic))]) {
    try {
      await new Promise((res) => setTimeout(res, 3000));
      const r = await fetch(`${NTFY}/${t}/json?poll=1&since=all`, { signal: AbortSignal.timeout(15000) });
      const lines = (await r.text()).split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return {}; } }).filter((m) => m.event === "message");
      console.log(`push: test read-back: HTTP ${r.status}, ${lines.length} message(s) held on the channel` + (lines.length ? `, newest titled "${one(lines[lines.length - 1].title, 80)}"` : ""));
    } catch (e) { console.log("push: test read-back failed: " + (e.name || "error")); }
  }
}
