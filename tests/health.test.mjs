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
