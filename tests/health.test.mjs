// Unit test for the data health rules (tools/health_lib.mjs) and the shipped tools/health.json (no network).
// Usage: node tests/health.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseStamp, stampOf, sourcesOf, countOf, evaluate, decide, lastAnnounced, fpTag, ago } from "../tools/health_lib.mjs";

const NOW = Date.parse("2026-09-28T12:00:00Z");
const iso = (minAgo) => new Date(NOW - minAgo * 60000).toISOString();
const cfg = { amberMin: 40, downMin: 60, defaultMaxMin: 120 };

// time stamps as the data files write them
assert.equal(parseStamp("2026-09-28 13:12Z"), Date.parse("2026-09-28T13:12:00Z"));
assert.equal(parseStamp("2026-09-28T13:12:05Z"), Date.parse("2026-09-28T13:12:05Z"));
assert.equal(parseStamp("2026-09-28 20:00"), Date.parse("2026-09-28T20:00:00Z"));
assert.equal(parseStamp("yesterday"), null);
assert.equal(parseStamp(null), null);
assert.equal(stampOf('window.X={"asof":"2026-09-28 13:12Z","n":1};'), "2026-09-28T13:12:00.000Z");
assert.equal(stampOf('window.LIVE={"asof":"2026-09-28 20:00","built":"2026-09-28 13:12Z"};', "built"), "2026-09-28T13:12:00.000Z");
assert.equal(stampOf("window.ASAP_RW=null;"), null);

// source lists: arrays or objects of entries with ok flags; anything else is not a source list
assert.deepEqual(sourcesOf({ sources: [{ source: "A", ok: true }, { source: "B", ok: false }] }), { ok: 1, fail: 1, failing: ["B"] });
assert.deepEqual(sourcesOf({ feeds: { x: { id: "x", ok: false }, y: { id: "y", ok: true } } }), { ok: 1, fail: 1, failing: ["x"] });
// the warnings file names its sources by agency and country; an unnamed source shows its host, never "?"
assert.deepEqual(sourcesOf({ feeds: [{ cc: "ph", agency: "PAGASA", url: "https://publicalert.pagasa.dost.gov.ph/feeds/", ok: false }, { cc: "jp", agency: "JMA", ok: true }] }),
  { ok: 1, fail: 1, failing: ["PH PAGASA"] });
assert.deepEqual(sourcesOf({ feeds: [{ url: "https://example.org/rss", ok: false }] }), { ok: 0, fail: 1, failing: ["example.org"] });
assert.equal(sourcesOf({ features: [{ ok: true }] }), null);
assert.equal(sourcesOf(null), null);

const feed = (id, minAgo, extra = {}) => ({ id, name: id.toUpperCase(), key: true, maxMin: 60, asof: minAgo == null ? null : iso(minAgo), ...extra });

// all fresh: ok, nothing to send
let ev = evaluate({ asof: iso(10), feeds: [feed("quakes", 20), feed("news", 30)] }, cfg, NOW);
assert.equal(ev.state, "ok");
assert.deepEqual(ev.alerts, []);

// a key feed stale: down, one alert line naming it
ev = evaluate({ asof: iso(10), feeds: [feed("quakes", 20), feed("news", 95)] }, cfg, NOW);
assert.equal(ev.state, "down");
assert.deepEqual(ev.alerts, ["NEWS: last updated 1 h 35 min."]);
assert.equal(ev.fp, "news");

// a non-key feed stale or empty: amber only, no alert
ev = evaluate({ asof: iso(10), feeds: [feed("quakes", 20), feed("rw", null, { key: false })] }, cfg, NOW);
assert.equal(ev.state, "amber");
assert.deepEqual(ev.alerts, []);
assert.equal(ev.problems[0].why, "no data");

// most of a key feed's sources failing: down
ev = evaluate({ asof: iso(10), feeds: [feed("news", 10, { src: { ok: 3, fail: 7, failing: [] } })] }, cfg, NOW);
assert.equal(ev.state, "down");
assert.match(ev.alerts[0], /7 of 10 sources failing/);
// a few failing sources is normal
ev = evaluate({ asof: iso(10), feeds: [feed("news", 10, { src: { ok: 360, fail: 5, failing: [] } })] }, cfg, NOW);
assert.equal(ev.state, "ok");

// refresh late but under the down limit: amber
ev = evaluate({ asof: iso(45), feeds: [feed("quakes", 50)] }, cfg, NOW);
assert.equal(ev.state, "amber");

// the whole refresh stalled (this morning's outage): one alert line, not one per feed
ev = evaluate({ asof: iso(500), feeds: [feed("quakes", 510), feed("news", 505)] }, cfg, NOW);
assert.equal(ev.state, "down");
assert.equal(ev.alerts.length, 1);
assert.match(ev.alerts[0], /^No new data for 8 h 20 min/);
assert.equal(ev.fp, "stall");

// no health file at all
ev = evaluate(null, cfg, NOW);
assert.equal(ev.state, "down");
assert.equal(ev.ui.state, "down");

// what app readers see (ev.ui): milder than the alert state
const minor = (id, minAgo, extra = {}) => feed(id, minAgo, { key: false, ...extra });
const fresh = [feed("quakes", 5), feed("news", 10), feed("warnings", 8), feed("storms", 3)];
// everything fresh: green, plain line
ev = evaluate({ asof: iso(10), feeds: fresh }, cfg, NOW);
assert.equal(ev.ui.state, "ok");
assert.equal(ev.ui.line, "All 4 feeds are fresh.");
assert.equal(ev.ui.short, "");
// one key feed 6 h late (the conflict tabs case): the keeper is alerted, the reader sees amber naming it
ev = evaluate({ asof: iso(10), feeds: fresh.concat(feed("conflicts", 360, { name: "Conflict tabs" })) }, cfg, NOW);
assert.equal(ev.state, "down");                       // alert rule unchanged
assert.equal(ev.ui.state, "amber");
assert.equal(ev.ui.line, "Conflict tabs last updated 6 h ago; everything else is fresh.");
assert.equal(ev.ui.short, "Conflict tabs late");
// one key feed late plus minor ones: the key feed is named, the minor ones counted
ev = evaluate({ asof: iso(10), feeds: fresh.concat(feed("conflicts", 360, { name: "Conflict tabs" }), minor("volcano", 17 * 1440, { name: "Volcanoes" }), minor("rw", null)) }, cfg, NOW);
assert.equal(ev.ui.state, "amber");
assert.equal(ev.ui.line, "Conflict tabs last updated 6 h ago; 2 minor feeds are also late; everything else is fresh.");
// only a minor feed with no data: amber, named
ev = evaluate({ asof: iso(10), feeds: fresh.concat(minor("rw", null, { name: "ReliefWeb reports" })) }, cfg, NOW);
assert.equal(ev.ui.state, "amber");
assert.equal(ev.ui.line, "ReliefWeb reports has no data; everything else is fresh.");
// two of five key feeds late: still amber, both named
ev = evaluate({ asof: iso(10), feeds: [feed("quakes", 5), feed("news", 200), feed("warnings", 8), feed("storms", 3), feed("gdacs", 300)] }, cfg, NOW);
assert.equal(ev.ui.state, "amber");
assert.equal(ev.ui.short, "2 key feeds late");
assert.match(ev.ui.line, /^NEWS last updated 3 h 20 min ago, GDACS last updated 5 h ago; everything else is fresh\.$/);
// most key feeds down: red
ev = evaluate({ asof: iso(10), feeds: [feed("quakes", 500), feed("news", 200), feed("warnings", 8), feed("storms", null)] }, cfg, NOW);
assert.equal(ev.ui.state, "down");
assert.match(ev.ui.line, /^Most key feeds are down: QUAKES, NEWS and STORMS\.$/);
// a key feed whose sources mostly fail: amber for readers, worded plainly
ev = evaluate({ asof: iso(10), feeds: fresh.concat(feed("dense", 10, { name: "Open-data feeds", src: { ok: 3, fail: 7, failing: [] } })) }, cfg, NOW);
assert.equal(ev.ui.state, "amber");
assert.equal(ev.ui.line, "Open-data feeds has 7 of 10 sources failing; everything else is fresh.");
// all stalled: red, says nothing has refreshed
ev = evaluate({ asof: iso(500), feeds: [feed("quakes", 510), feed("news", 505)] }, cfg, NOW);
assert.equal(ev.ui.state, "down");
assert.equal(ev.ui.line, "No new data for 8 h 20 min. Everything shown is at least that old.");
// refresh late but under the down limit, feeds fine: amber, says when it last ran
ev = evaluate({ asof: iso(45), feeds: [feed("quakes", 50)] }, cfg, NOW);
assert.equal(ev.ui.state, "amber");
assert.match(ev.ui.line, /^The last refresh was 45 min ago/);
// late refresh and a late feed: the tail says the refresh is late rather than "everything else is fresh"
ev = evaluate({ asof: iso(45), feeds: [feed("quakes", 50), feed("news", 50), minor("rw", null)] }, cfg, NOW);
assert.equal(ev.ui.line, "RW has no data; the last refresh was 45 min ago.");
// the app's copy of the rule (assets/osap-health.js) gives the same answers
{
  const src = fs.readFileSync(new URL("../assets/osap-health.js", import.meta.url), "utf8");
  const m = /\/\* same rules as tools\/health_lib\.mjs[\s\S]*?\n  (function evaluate[\s\S]*?\n  \})\n/.exec(src);
  assert.ok(m, "evaluate() copy found in assets/osap-health.js");
  const helpers = /(function parseStamp[\s\S]*?)\n  function when/.exec(src)[1];
  const appEval = new Function(helpers + "\n" + m[1] + "\nreturn evaluate;")();
  const cases = [
    { asof: iso(10), feeds: fresh },
    { asof: iso(10), feeds: fresh.concat(feed("conflicts", 360, { name: "Conflict tabs" })) },
    { asof: iso(10), feeds: fresh.concat(feed("conflicts", 360, { name: "Conflict tabs" }), minor("volcano", 17 * 1440), minor("rw", null)) },
    { asof: iso(10), feeds: [feed("quakes", 500), feed("news", 200), feed("warnings", 8), feed("storms", null)] },
    { asof: iso(500), feeds: [feed("quakes", 510), feed("news", 505)] },
    { asof: iso(45), feeds: [feed("quakes", 50), feed("news", 50), minor("rw", null)] },
  ];
  for (const h of cases) {
    const a = appEval(Object.assign({ amberMin: 40, downMin: 60 }, h), NOW), b = evaluate(h, cfg, NOW).ui;
    assert.equal(a.state, b.state, "app state for " + JSON.stringify(h.feeds.map((f) => f.id)));
    assert.equal(a.line, b.line);
    assert.equal(a.short, b.short);
  }
}

// what to send, given the last health message in the channel
const down = { state: "down", fp: "news" }, ok = { state: "ok", fp: "" };
assert.equal(decide(down, null), "down");                                            // first alert
assert.equal(decide(down, { state: "down", tag: fpTag("news") }), null);              // same problem: not again
assert.equal(decide(down, { state: "down", tag: fpTag("stall") }), "down");           // a different problem
assert.equal(decide(ok, { state: "down", tag: fpTag("news") }), "ok");                // recovered: one all-clear
assert.equal(decide(ok, { state: "ok", tag: "" }), null);                             // still fine
assert.equal(decide(ok, null), null);
assert.equal(decide({ state: "amber", fp: "" }, { state: "down", tag: "k1" }), "ok"); // amber counts as recovered

// reading the channel back (ntfy NDJSON poll): the newest health message wins, other messages are ignored
const nd = [
  JSON.stringify({ event: "open" }),
  JSON.stringify({ event: "message", time: 100, tags: ["warning", "osap-down", fpTag("news")] }),
  JSON.stringify({ event: "message", time: 200, tags: ["test"] }),
  "not json",
  JSON.stringify({ event: "message", time: 300, tags: ["white_check_mark", "osap-ok", fpTag("")] }),
].join("\n");
assert.deepEqual(lastAnnounced(nd), { state: "ok", tag: fpTag(""), time: 300 });
assert.equal(lastAnnounced(""), null);
assert.match(fpTag("news,quakes"), /^k[0-9a-z]+$/);
assert.equal(ago(59 * 60000), "59 min");
assert.equal(ago(3 * 86400000), "3 days");

// the shipped config: unique ids, files named, key feeds exist, ntfy topic hard to guess
const C = JSON.parse(fs.readFileSync(new URL("../tools/health.json", import.meta.url), "utf8"));
const ids = C.feeds.map((f) => f.id);
assert.equal(new Set(ids).size, ids.length, "duplicate feed id");
for (const f of C.feeds) {
  // a feed is either a file on main or (published on its own branch) a raw.githubusercontent.com address, never both
  if (f.url) { assert.ok(!f.file, f.id + ": url or file, not both"); assert.match(f.url, /^https:\/\/raw\.githubusercontent\.com\/01shane89-jpg\/AXIOM-APSAP\/live-[a-z]+\//, f.id + ": url on a live- branch"); }
  else assert.ok(/^data\//.test(f.file), f.id + ": file under data/");
  assert.ok(f.maxMin > 0, f.id + ": maxMin");
}
// the live air traffic and drone sweeps are watched as key feeds (stale for 5 h 40 min on 4 Nov 2026 with no alert)
for (const id of ["airtraffic", "drones"]) { const f = C.feeds.find((x) => x.id === id); assert.ok(f && f.key && f.url && f.stamp === "built" && f.maxMin <= 60, id + " watched"); }
// their "built" stamp (ISO with milliseconds) is read, and a stale one alerts by name
assert.equal(stampOf('{"schema":"osap-air-traffic/1","built":"2026-09-28T11:00:01.211Z","sweep":5}', "built"), "2026-09-28T11:00:01.211Z");
ev = evaluate({ asof: iso(10), feeds: [feed("quakes", 20), { id: "airtraffic", name: "Live air traffic (ADS-B)", key: true, maxMin: 45, asof: iso(340) }] }, cfg, NOW);
assert.equal(ev.state, "down");
assert.deepEqual(ev.alerts, ["Live air traffic (ADS-B): last updated 5 h 40 min."]);
assert.ok(C.feeds.some((f) => f.key), "at least one key feed");
assert.match(C.topic, /^osap-health-[0-9a-f]{12}$/);
assert.ok(C.downMin > C.amberMin);
// fresh but empty (16 Nov 2026: GDACS sat at 0 alerts for days with a fresh stamp)
assert.equal(countOf({ events: [] }, "events"), 0);
assert.equal(countOf({ events: [1, 2] }, "events"), 2);
assert.equal(countOf({ items: { th: [1, 2], vn: [3] } }, "items"), 3, "news-style object of lists");
assert.equal(countOf({ asof: "x" }, "events"), 0, "a missing list counts as empty");
assert.equal(countOf({ events: "x" }, "events"), null, "not a list: not counted");
ev = evaluate({ asof: iso(10), feeds: [feed("gdacs", 5, { n: 0, minItems: 1 }), feed("quakes", 5), feed("news", 10)] }, cfg, NOW);
assert.equal(ev.state, "down", "an empty key feed alerts even with a fresh stamp");
assert.deepEqual(ev.alerts, ["GDACS: 0 items."]);
assert.equal(ev.ui.line, "GDACS has 0 items; everything else is fresh.");
ev = evaluate({ asof: iso(10), feeds: [feed("gdacs", 5, { n: 37, minItems: 1 })] }, cfg, NOW);
assert.equal(ev.state, "ok", "a feed with items is fine");
ev = evaluate({ asof: iso(10), feeds: [feed("volcano", 5, { key: false, n: 0, minItems: 1 })] }, cfg, NOW);
assert.equal(ev.state, "amber", "an empty minor feed is amber only");
ev = evaluate({ asof: iso(10), feeds: [feed("gdacs", 5, { n: 0 })] }, cfg, NOW);
assert.equal(ev.state, "ok", "no minItems: a count alone never raises a problem");
// the app's copy of the rule (assets/osap-health.js) matches
assert.match(fs.readFileSync(new URL("../assets/osap-health.js", import.meta.url), "utf8"), /f\.minItems > 0 && typeof f\.n === "number" && f\.n < f\.minItems\) why = f\.n \+ " items"/);
// GDACS and the other always-full key feeds are counted
for (const id of ["quakes", "gdacs", "warnings", "news", "social", "conflicts"]) assert.ok(C.feeds.find((f) => f.id === id).count, id + " has a count list");
console.log("health tests passed");

// ---------- operations checks: quiet sources and late scheduled jobs (20 Nov 2026) ----------
{
  const { updateSeen, quietSources, cronGapMin, cronsOf, jobLimitMin, lateJobs, QUIET_DAYS, DEAD_DAYS } = await import("../tools/health_lib.mjs");
  const day = (d) => "2026-11-" + String(d).padStart(2, "0");
  // a source that answers ok with nothing for 10+ days (NHK's old feed, 8 Aug to 19 Nov 2026) and one that fails
  let seen = {};
  for (let d = 1; d <= 12; d++) {
    seen = updateSeen(seen, [{ feed: "news", sources: [
      { cc: "jp", source: "NHK", url: "https://nhk.example/old", ok: true, n: 0 },
      { cc: "jp", source: "Busy", url: "https://busy.example", ok: true, n: 5 },
      { cc: "th", source: "Broken", url: "https://broken.example", ok: d < 8, n: d < 8 ? 2 : 0 },
    ] }], day(d)).seen;
  }
  const q = quietSources(seen, day(12));
  assert.deepEqual(q.map((x) => x.name).sort(), ["Broken", "NHK"], "the frozen and the failing source are quiet; the busy one is not");
  assert.match(q.find((x) => x.name === "Broken").why, /^failing since 2026-11-07/);
  assert.match(q.find((x) => x.name === "NHK").why, /^no items since it was first listed/);
  assert.equal(quietSources(updateSeen({}, [{ feed: "news", sources: [{ source: "New", url: "u", ok: true, n: 0 }] }], day(1)).seen, day(1)).length, 0, "a new source is not judged on its first day");
  // a source that gives its newest item's date is judged at once
  const nw = updateSeen({}, [{ feed: "news", sources: [{ source: "Frozen", url: "f", ok: true, n: 0, newest: "2026-08-08T03:00" }, { source: "Fine", url: "g", ok: true, n: 0, newest: "2026-11-18T03:00" }] }], day(20)).seen;
  assert.deepEqual(quietSources(nw, day(20)).map((x) => x.why), ["answers, but its newest item is from 2026-08-08"], "a frozen feed shows on its first check");
  // a source the feed stopped listing is dropped from the quiet list at once and forgotten after 30 days
  const gone = updateSeen(seen, [{ feed: "news", sources: [] }], day(13)).seen;
  assert.equal(quietSources(gone, day(13)).length, 0);
  assert.equal(Object.keys(updateSeen(gone, [], "2026-12-30").seen).length, 0);
  assert.ok(QUIET_DAYS >= 7 && DEAD_DAYS >= 2);

  // schedules -> longest gap and the late limit
  assert.equal(cronGapMin("17 3 * * *"), 1440);
  assert.equal(cronGapMin("37 */6 * * *"), 360);
  assert.equal(cronGapMin("8,23,38,53 * * * *"), 15);
  assert.equal(cronGapMin("41 4 * * 0"), 10080);
  assert.equal(cronGapMin("17 4 * * 2,5"), 5760);
  assert.ok(cronGapMin("17 5 3 * *") >= 28 * 1440, "monthly");
  assert.equal(cronGapMin("not a cron"), null);
  assert.deepEqual(cronsOf('on:\n  schedule:\n    - cron: "23 1 * * *"\n    - cron: \'53 */3 * * *\'\n'), ["23 1 * * *", "53 */3 * * *"]);
  assert.equal(jobLimitMin(["23 1 * * *", "53 */3 * * *"]), 2 * 180 + 180);
  assert.equal(jobLimitMin([]), null, "no schedule: not watched");
  // a daily job that last succeeded 3 days ago is late; one from yesterday is not
  const N = Date.parse("2026-11-20T12:00:00Z");
  const late = lateJobs([{ file: "a.yml", name: "Econ", maxMin: jobLimitMin(["17 3 * * *"]), last: "2026-11-17T03:30:00Z" },
    { file: "b.yml", name: "Risk", maxMin: jobLimitMin(["17 3 * * *"]), last: "2026-11-19T03:30:00Z" },
    { file: "c.yml", name: "Never", maxMin: 600, last: null }], N);
  assert.deepEqual(late.map((j) => j.name), ["Econ", "Never"]);
  assert.match(late[0].why, /^last succeeded 3 days ago \(runs at least every 24 h\)$/);
  // a monthly job added 6 days ago with no run yet is not late (refresh-outlet-facts.yml, 20 Nov 2026); one added long ago is
  const monthly = jobLimitMin(["41 4 7 * *"]);
  assert.deepEqual(lateJobs([{ file: "o.yml", name: "Outlet facts", maxMin: monthly, last: null, since: "2026-11-14T08:16:00Z" }], N), [], "a new job before its first run is not late");
  assert.equal(lateJobs([{ file: "o.yml", name: "Outlet facts", maxMin: monthly, last: null, since: "2026-07-01T00:00:00Z" }], N).length, 1, "an old job that never succeeded is late");
  // a job with a run going on main is not late (refresh-keeper.yml: 5 h 20 min runs on an hourly schedule, 20 Nov 2026);
  // one "in progress" for 6 h or more is stuck, and late
  const keeper = { file: "refresh-keeper.yml", name: "Keep the 15-minute refresh running", maxMin: 300, last: new Date(N - 319 * 60000).toISOString() };
  assert.equal(lateJobs([keeper], N).length, 1, "past its limit with nothing running: late");
  assert.deepEqual(lateJobs([{ ...keeper, running: new Date(N - 319 * 60000).toISOString() }], N), [], "a run going for 5 h 19 min: working, not late");
  assert.equal(lateJobs([{ ...keeper, running: new Date(N - 400 * 60000).toISOString() }], N).length, 1, "a run 'in progress' for 6 h 40 min: stuck");
  // a job that writes a watched feed is late no later than that feed is stale (refresh-factchecks.yml, 20 Nov 2026)
  {
    const { jobLimitFor } = await import("../tools/health_lib.mjs");
    const feeds = [{ id: "factchecks", file: "data/live/factchecks.js", maxMin: 420 }, { id: "news", file: "data/live/news.js", maxMin: 90 }];
    assert.equal(jobLimitFor(["17 */3 * * *"], "git add data/live/factchecks.js", feeds), 420, "3-hourly job (540) writing a 420-min feed: 420");
    assert.equal(jobLimitFor(["17 */3 * * *"], "git add data/other.js", feeds), 540, "writes no watched feed: its own schedule");
    assert.equal(jobLimitFor(["7,22,37,52 * * * *"], "data/live/news.js", feeds), 90, "15-min job writing a 90-min feed: 90");
    assert.equal(jobLimitFor(["17 3 * * *"], "data/live/news.js", feeds), 1500, "never under one gap of its own schedule + 60");
    assert.equal(jobLimitFor([], "data/live/news.js", feeds), null);
  }
  // quiet sources are listed as ops only: never part of the badge or the phone alerts
  const fresh1 = { asof: new Date(N - 5 * 60000).toISOString(), feeds: [{ id: "quakes", name: "Earthquakes", key: true, maxMin: 90, asof: new Date(N - 10 * 60000).toISOString() }] };
  const evq = evaluate({ ...fresh1, quiet: { n: 2, list: [] } }, cfg, N);
  assert.equal(evq.ui.state, "ok", "quiet sources do not change the badge");
  assert.deepEqual(evq.ops.map((o) => o.id), ["quiet"]);
  // a late job turns the badge amber and is named (20 Nov 2026: three late jobs sat in the panel with the badge green), but no phone alert
  const ev2 = evaluate({ ...fresh1, quiet: { n: 2, list: [] }, jobs: { list: [{ file: "a.yml", name: "Refresh economic stress signals", maxMin: 3060, last: "2026-11-17T03:30:00Z" }] } }, cfg, N);
  assert.equal(ev2.ui.state, "amber", "a late job turns the badge amber");
  assert.equal(ev2.ui.short, "Economic stress signals late");
  assert.equal(ev2.ui.line, "Economic stress signals last updated 3 days ago; everything else is fresh.");
  assert.deepEqual(ev2.alerts, [], "a late job sends no phone alert on its own");
  assert.equal(decide(ev2, null), null);
  assert.deepEqual(ev2.ops.map((o) => o.id), ["job:a.yml", "quiet"], "still listed for the nightly run");
  // the app's copy agrees
  {
    const src = fs.readFileSync(new URL("../assets/osap-health.js", import.meta.url), "utf8");
    const m = /\/\* same rules as tools\/health_lib\.mjs[\s\S]*?\n  (function evaluate[\s\S]*?\n  \})\n/.exec(src);
    const helpers = /(function parseStamp[\s\S]*?)\n  function when/.exec(src)[1];
    const appEval = new Function(helpers + "\n" + m[1] + "\nreturn evaluate;")();
    const jobs = { list: [{ file: "a.yml", name: "Refresh economic stress signals", maxMin: 3060, last: "2026-11-17T03:30:00Z" }, { file: "b.yml", name: "Refresh airfield weather", maxMin: 220, last: new Date(N - 266 * 60000).toISOString() }, { file: "c.yml", name: "On time", maxMin: 220, last: new Date(N - 30 * 60000).toISOString() }] };
    const runJobs = { list: [{ file: "refresh-keeper.yml", name: "Keep the 15-minute refresh running", maxMin: 300, last: new Date(N - 319 * 60000).toISOString(), running: new Date(N - 319 * 60000).toISOString() }] };
    for (const h of [{ ...fresh1, jobs: runJobs }, { ...fresh1, jobs }, { ...fresh1, jobs: { list: jobs.list.slice(1) } }, { ...fresh1, feeds: fresh1.feeds.concat({ id: "news", name: "News", key: true, maxMin: 90, asof: new Date(N - 300 * 60000).toISOString() }), jobs }]) {
      const a = appEval(Object.assign({ amberMin: 40, downMin: 60 }, h), N), b = evaluate(h, cfg, N).ui;
      assert.equal(a.state, b.state); assert.equal(a.line, b.line); assert.equal(a.short, b.short);
    }
  }
  console.log("operations checks passed");
}

// ---------- restarting late jobs (tools/late_jobs.mjs, run by refresh-keeper.yml each round) ----------
{
  const { dispatchable, toRestart } = await import("../tools/late_jobs.mjs");
  assert.equal(dispatchable('on:\n  schedule:\n    - cron: "7 * * * *"\n  workflow_dispatch:\n'), true);
  assert.equal(dispatchable('on:\n  schedule:\n    - cron: "7 * * * *"\n  workflow_dispatch:\n    inputs:\n      lane:\n        description: x\n        default: fast\n'), true, "inputs with defaults are fine");
  assert.equal(dispatchable('on:\n  workflow_dispatch:\n    inputs:\n      cc:\n        required: true\n  schedule:\n    - cron: "7 * * * *"\n'), false, "a required input: not started by hand");
  assert.equal(dispatchable('on:\n  schedule:\n    - cron: "7 * * * *"\n'), false, "no workflow_dispatch");
  const N = Date.parse("2026-11-20T12:00:00Z"), yml = 'on:\n  workflow_dispatch:\n';
  const h = { jobs: { list: [{ file: "refresh-avwx.yml", maxMin: 220, last: "2026-11-20T07:00:00Z" }, { file: "refresh-keeper.yml", maxMin: 300, last: "2026-11-19T07:00:00Z" },
    { file: "on-time.yml", maxMin: 220, last: "2026-11-20T11:00:00Z" }, { file: "no-dispatch.yml", maxMin: 220, last: "2026-11-20T01:00:00Z" }, { file: "../x.yml", maxMin: 1, last: null }] } };
  assert.deepEqual(toRestart(h, (f) => (f === "no-dispatch.yml" ? "on:\n  schedule:\n" : yml), N), ["refresh-avwx.yml"], "only late, startable jobs, never the keeper or an odd file name");
  assert.deepEqual(toRestart({}, () => yml, N), []);
  // every scheduled workflow in the repository can be started again by hand
  for (const f of fs.readdirSync(new URL("../.github/workflows/", import.meta.url))) {
    const t = fs.readFileSync(new URL("../.github/workflows/" + f, import.meta.url), "utf8");
    if (/^\s*-\s*cron:/m.test(t)) assert.ok(dispatchable(t), f + " has a schedule but cannot be started by hand");
  }
  console.log("late job restart checks passed");
}
