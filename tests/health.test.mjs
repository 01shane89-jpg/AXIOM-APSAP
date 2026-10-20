// Unit test for the data health rules (tools/health_lib.mjs) and the shipped tools/health.json (no network).
// Usage: node tests/health.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseStamp, stampOf, sourcesOf, evaluate, decide, lastAnnounced, fpTag, ago } from "../tools/health_lib.mjs";

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
for (const f of C.feeds) { assert.ok(/^data\//.test(f.file), f.id + ": file under data/"); assert.ok(f.maxMin > 0, f.id + ": maxMin"); }
assert.ok(C.feeds.some((f) => f.key), "at least one key feed");
assert.match(C.topic, /^osap-health-[0-9a-f]{12}$/);
assert.ok(C.downMin > C.amberMin);
console.log("health tests passed");
