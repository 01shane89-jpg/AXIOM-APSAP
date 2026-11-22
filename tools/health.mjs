// Data health for the app and for outage alerts. Rules in tools/health_lib.mjs, feed list and limits in tools/health.json.
//
//   node tools/health.mjs build   After a refresh: reads each feed file's own time stamp and source list and writes
//                                 data/live/health.json, which the app's data badge reads (assets/osap-health.js).
//   node tools/health.mjs watch   From the keeper, every 15 minutes: reads the PUBLISHED health.json from the app's own site
//                                 (so a stalled refresh, a failed deploy or a dead site all show), and when data has stopped,
//                                 posts one alert to the ntfy.sh channel in tools/health.json, and one more when it recovers.
//                                 What was already announced is read back from the channel itself, so no state is kept here.
//   node tools/health.mjs test    Same reading, then posts one "[test]" message with the current state to the channel and reads
//                                 it back (refresh-flood.yml only=health-test). Test messages never count as an alert.
//   Env: HEALTH_DRY=1 prints instead of posting; HEALTH_SITE / HEALTH_TOPIC override tools/health.json (tests).
import fs from "node:fs";
import vm from "node:vm";
import { stampOf, sourcesOf, countOf, evaluate, decide, lastAnnounced, fpTag, updateSeen, quietSources, cronsOf, jobLimitMin, jobLimitFor, cronGapMin, lateJobs } from "./health_lib.mjs";

const cfg = JSON.parse(fs.readFileSync(new URL("./health.json", import.meta.url), "utf8"));
const SITE = (process.env.HEALTH_SITE || cfg.site).replace(/\/?$/, "/");
const TOPIC = process.env.HEALTH_TOPIC || cfg.topic;
const NTFY = "https://ntfy.sh/";

// Feeds published outside main (live air traffic and drones, on their own branches, read by the page from
// raw.githubusercontent.com) carry a "url" in tools/health.json instead of a "file": their time stamp is read from there.
async function remoteText(f) {
  try { const r = await get(f.url + (f.url.includes("?") ? "&" : "?") + "t=" + Date.now(), 20000); return r.ok ? await r.text() : null; } catch (e) { return null; }
}

// every scheduled workflow's last successful run on main (tools/health_lib.mjs lateJobs); asked at most hourly, else the last
// answer is carried over. Needs a token with actions: read (refresh-flood.yml gives its GITHUB_TOKEN); without one, skipped.
async function jobs(prev) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN, repo = process.env.GITHUB_REPOSITORY || "01shane89-jpg/AXIOM-APSAP";
  if (prev && prev.at && Date.now() - Date.parse(prev.at) < 55 * 60000 && !process.env.HEALTH_JOBS_NOW) return prev;
  if (!token) return prev || null;
  const dir = ".github/workflows", list = []; let asked = 0, failed = 0;
  for (const file of fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    const yml = fs.readFileSync(`${dir}/${file}`, "utf8"), maxMin = jobLimitFor(cronsOf(yml), yml, cfg.feeds, cfg.defaultMaxMin);
    if (!maxMin) continue;
    const name = (/^name:\s*(.+)$/m.exec(yml) || [])[1] || file;
    let last = null; asked++;
    try {
      const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${file}/runs?branch=main&status=success&per_page=1`,
        { headers: { authorization: "Bearer " + token, accept: "application/vnd.github+json", "user-agent": "osap-health" }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) { failed++; console.log(`  jobs: ${file} answered HTTP ${r.status}`); if (prev) { const o = (prev.list || []).find((x) => x.file === file); if (o) list.push(o); } continue; }
      const run = ((await r.json()).workflow_runs || [])[0]; last = run ? run.updated_at || run.created_at : null;
    } catch (e) { failed++; console.log(`  jobs: ${file}: ${e.message}`); continue; }
    // no success on record: when was the workflow added? (a new monthly job has not reached its first run yet)
    let since;
    if (!last) {
      try {
        const w = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${file}`,
          { headers: { authorization: "Bearer " + token, accept: "application/vnd.github+json", "user-agent": "osap-health" }, signal: AbortSignal.timeout(20000) });
        if (w.ok) since = (await w.json()).created_at || undefined;
      } catch (e) {}
    }
    // past its limit: is a run going on main right now? (the keeper runs about 5 h 20 min a time, longer than its hourly
    // schedule's limit, so its last success is always "late" near the end of each run while it is plainly working)
    let running;
    if (!last || Date.now() - Date.parse(last) > maxMin * 60000) {
      try {
        const g = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${file}/runs?branch=main&status=in_progress&per_page=1`,
          { headers: { authorization: "Bearer " + token, accept: "application/vnd.github+json", "user-agent": "osap-health" }, signal: AbortSignal.timeout(20000) });
        const run = g.ok ? ((await g.json()).workflow_runs || [])[0] : null;
        if (run) running = run.run_started_at || run.created_at;
      } catch (e) {}
    }
    const gapMin = Math.min(...cronsOf(yml).map(cronGapMin).filter((g) => g != null));
    list.push({ file, name: name.replace(/^["']|["']$/g, "").trim(), maxMin, gapMin, last, ...(since ? { since } : {}), ...(running ? { running } : {}) });
  }
  // when GitHub would not answer, the last answer is kept and the failure is listed, never an empty "nothing late"
  if (asked && failed === asked) return { ...(prev || { list: [] }), error: "could not read the workflow runs (" + failed + " of " + asked + " failed)" };
  return { at: new Date().toISOString().slice(0, 19) + "Z", list };
}

async function build() {
  const feeds = [], srcLists = [];
  for (const f of cfg.feeds) {
    const row = { id: f.id, name: f.name, key: !!f.key, maxMin: f.maxMin || cfg.defaultMaxMin, asof: null };
    if (f.url) { const t = await remoteText(f); row.asof = t ? stampOf(t, f.stamp || "asof") : null; feeds.push(row); continue; }
    let text = null;
    try { text = fs.readFileSync(f.file, "utf8"); } catch (e) {}
    if (text) {
      row.asof = stampOf(text, f.stamp || "asof");
      // the data files are "window.X = {...};": run them in an empty sandbox to read their source lists
      try {
        const box = { window: {} };
        vm.runInNewContext(text, box, { timeout: 5000 });
        const obj = Object.values(box.window)[0];
        const src = sourcesOf(obj);
        if (src) row.src = src;
        for (const k of ["sources", "feeds"]) { let v = obj && obj[k]; if (v && !Array.isArray(v) && typeof v === "object") v = Object.values(v); if (Array.isArray(v)) { srcLists.push({ feed: f.id, sources: v }); break; } }
        if (f.count) { const n = countOf(obj, f.count); if (n != null) { row.n = n; row.minItems = f.minItems || 1; } }
        if (obj === null) row.asof = null;
      } catch (e) {}
    }
    feeds.push(row);
  }
  const run = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
  // quiet sources (tools/health_lib.mjs updateSeen, quietSources): day-resolution memory in data/live/source-seen.json
  const today = new Date().toISOString().slice(0, 10), SEEN = "data/live/source-seen.json";
  let seen = {}; try { seen = JSON.parse(fs.readFileSync(SEEN, "utf8")).seen || {}; } catch (e) {}
  const up = updateSeen(seen, srcLists, today);
  if (up.changed) { fs.mkdirSync("data/live", { recursive: true }); fs.writeFileSync(SEEN, JSON.stringify({ about: "tools/health.mjs: per source, first listed, last listed, last ok answer, last day with items", seen: up.seen }) + "\n"); }
  const quiet = quietSources(up.seen, today);
  let prevHealth = null; try { prevHealth = JSON.parse(fs.readFileSync("data/live/health.json", "utf8")); } catch (e) {}
  const jb = await jobs(prevHealth && prevHealth.jobs);
  const out = { v: 1, asof: new Date().toISOString().slice(0, 19) + "Z", run, topic: TOPIC, amberMin: cfg.amberMin, downMin: cfg.downMin, feeds,
    // over 60, keep the most recent silences (the panel lists those first; years-quiet pages are the least worth a look)
    quiet: { n: quiet.length, list: quiet.length > 60 ? quiet.slice(-60) : quiet }, ...(jb ? { jobs: { ...jb, late: lateJobs(jb.list, Date.now(), jb.at) } } : {}) };
  fs.mkdirSync("data/live", { recursive: true });
  fs.writeFileSync("data/live/health.json", JSON.stringify(out) + "\n");
  const ev = evaluate(out, cfg);
  console.log(`health: ${ev.state}; ${feeds.length} feeds; ${ev.problems.length} problem(s)`);
  for (const p of ev.problems) console.log(`  ${p.key ? "KEY " : ""}${p.name}: ${p.why}`);
  console.log(`health: ${quiet.length} quiet source(s)` + (quiet.length ? ": " + quiet.slice(0, 5).map((q) => q.name + " (" + q.why + ")").join("; ") : ""));
  if (out.jobs) console.log(`health: ${out.jobs.late.length} of ${out.jobs.list.length} scheduled jobs late` + (out.jobs.late.length ? ": " + out.jobs.late.map((j) => j.name + " (" + j.why + ")").join("; ") : ""));
}

async function get(url, ms = 20000) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { signal: ac.signal, cache: "no-store", headers: { "user-agent": "osap-health" } }); } finally { clearTimeout(t); }
}

async function readPublished() {
  const bust = "?t=" + Date.now();
  let res;
  try { res = await get(SITE + "data/live/health.json" + bust); } catch (e) { return { site: "not answering (" + e.message + ")" }; }
  if (res.ok) { try { return { health: await res.json() }; } catch (e) { return { health: null }; } }
  if (res.status !== 404) return { site: "answered HTTP " + res.status };
  // before the first deploy with health.json: judge by the earthquake file's own time stamp alone
  try {
    const q = await get(SITE + "data/live/quakes.js" + bust);
    if (!q.ok) return { site: "answered HTTP " + q.status + " for data/live/quakes.js" };
    return { health: { v: 0, asof: stampOf(await q.text()), feeds: [] } };
  } catch (e) { return { site: "not answering (" + e.message + ")" }; }
}

async function send(kind, ev) {
  const down = kind === "down";
  const title = down ? "OSAP data problem" : "OSAP data back to normal";
  const body = down ? ev.alerts.slice(0, 6).join("\n") + (ev.alerts.length > 6 ? `\n+${ev.alerts.length - 6} more` : "") : "New data is arriving again" + (ev.ageMin != null ? ` (last refresh ${ev.ageMin} min ago).` : ".");
  const tags = [down ? "warning" : "white_check_mark", down ? "osap-down" : "osap-ok", fpTag(ev.fp)];
  if (process.env.HEALTH_DRY) { console.log(`[dry] would send to ${TOPIC}: ${title} | ${body.replace(/\n/g, " / ")} | ${tags.join(",")}`); return; }
  const res = await fetch(NTFY, {
    method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(20000),
    body: JSON.stringify({ topic: TOPIC, title, message: body, tags, priority: down ? 4 : 3, click: SITE }),
  }).catch(() => null);
  if (!res || !res.ok) throw new Error("ntfy post failed: " + (res ? res.status : "no answer"));
  console.log(`sent: ${title}`);
}

// the url feeds are read again at watch time, so a stalled sweep is caught within 15 minutes even while the published
// health.json is older than that (an old reading of them is replaced; a published file without them gets them added)
async function freshRemote(health) {
  if (!health || !Array.isArray(health.feeds)) return;
  for (const f of cfg.feeds.filter((x) => x.url)) {
    const t = await remoteText(f), asof = t ? stampOf(t, f.stamp || "asof") : null;
    const row = { id: f.id, name: f.name, key: !!f.key, maxMin: f.maxMin || cfg.defaultMaxMin, asof };
    const i = health.feeds.findIndex((x) => x.id === f.id);
    if (i >= 0) health.feeds[i] = row; else health.feeds.push(row);
    console.log(`  ${f.name}: ${asof ? "published " + asof : "could not be read"}`);
  }
}

async function watch() {
  const pub = await readPublished();
  if (!pub.site) await freshRemote(pub.health);
  const ev = pub.site
    ? { state: "down", ageMin: null, problems: [], alerts: ["The app site " + SITE + " " + pub.site + "."], fp: "site" }
    : evaluate(pub.health, cfg);
  console.log(`published data: ${ev.state}${ev.ageMin != null ? `, last refresh ${ev.ageMin} min ago` : ""}`);
  for (const a of ev.alerts) console.log("  " + a);
  let poll;
  try {
    const r = await get(NTFY + encodeURIComponent(TOPIC) + "/json?poll=1&since=12h");
    if (!r.ok) throw new Error("HTTP " + r.status);
    poll = await r.text();
  } catch (e) {
    // without knowing what was announced, stay quiet rather than risk repeating an alert every 15 minutes
    console.log("::warning::could not read the health channel back (" + e.message + "); not sending");
    return;
  }
  const last = lastAnnounced(poll);
  const kind = decide(ev, last);
  console.log(`last announced: ${last ? last.state : "nothing in 12 h"}; now: ${kind || "nothing new to send"}`);
  if (kind) await send(kind, ev);
}

async function test() {
  const pub = await readPublished();
  const ev = pub.site ? { state: "down", ageMin: null, alerts: ["The app site " + pub.site + "."] } : evaluate(pub.health, cfg);
  const msg = `Health alerts are working. Published data now: ${ev.state}` + (ev.ageMin != null ? `, last refresh ${ev.ageMin} min ago.` : ".") + (ev.alerts.length ? "\n" + ev.alerts.slice(0, 4).join("\n") : "");
  console.log(msg);
  if (process.env.HEALTH_DRY) return;
  const res = await fetch(NTFY, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(20000),
    body: JSON.stringify({ topic: TOPIC, title: "[test] OSAP data health", message: msg, tags: ["test_tube"], priority: 3, click: SITE }) });
  if (!res.ok) throw new Error("ntfy post failed: HTTP " + res.status);
  const id = (await res.json().catch(() => ({}))).id;
  console.log("posted, message id " + id);
  // read it back by its id (ntfy can take a moment to list a new message)
  let seen = false;
  for (let i = 0; i < 5 && !seen; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const back = await (await get(NTFY + encodeURIComponent(TOPIC) + "/json?poll=1&since=10m")).text();
    seen = back.split("\n").some((l) => { try { return JSON.parse(l).id === id; } catch (e) { return false; } });
  }
  console.log(seen ? "test message read back from the channel" : "::error::test message was not found in the channel");
  if (!seen) process.exit(1);
}

const mode = process.argv[2];
if (mode === "build") await build();
else if (mode === "watch") await watch().catch((e) => { console.log("::warning::health watch: " + e.message); });
else if (mode === "test") await test();
else { console.log("usage: node tools/health.mjs build|watch|test"); process.exit(2); }
