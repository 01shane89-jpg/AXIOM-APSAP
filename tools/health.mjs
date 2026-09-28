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
import { stampOf, sourcesOf, evaluate, decide, lastAnnounced, fpTag } from "./health_lib.mjs";

const cfg = JSON.parse(fs.readFileSync(new URL("./health.json", import.meta.url), "utf8"));
const SITE = (process.env.HEALTH_SITE || cfg.site).replace(/\/?$/, "/");
const TOPIC = process.env.HEALTH_TOPIC || cfg.topic;
const NTFY = "https://ntfy.sh/";

function build() {
  const feeds = [];
  for (const f of cfg.feeds) {
    const row = { id: f.id, name: f.name, key: !!f.key, maxMin: f.maxMin || cfg.defaultMaxMin, asof: null };
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
        if (obj === null) row.asof = null;
      } catch (e) {}
    }
    feeds.push(row);
  }
  const run = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
  const out = { v: 1, asof: new Date().toISOString().slice(0, 19) + "Z", run, topic: TOPIC, amberMin: cfg.amberMin, downMin: cfg.downMin, feeds };
  fs.mkdirSync("data/live", { recursive: true });
  fs.writeFileSync("data/live/health.json", JSON.stringify(out) + "\n");
  const ev = evaluate(out, cfg);
  console.log(`health: ${ev.state}; ${feeds.length} feeds; ${ev.problems.length} problem(s)`);
  for (const p of ev.problems) console.log(`  ${p.key ? "KEY " : ""}${p.name}: ${p.why}`);
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

async function watch() {
  const pub = await readPublished();
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
if (mode === "build") build();
else if (mode === "watch") await watch().catch((e) => { console.log("::warning::health watch: " + e.message); });
else if (mode === "test") await test();
else { console.log("usage: node tools/health.mjs build|watch|test"); process.exit(2); }
