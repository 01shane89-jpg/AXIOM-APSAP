// Live OpenStreetMap source check (tools/refresh_osm_sources.mjs): what each answer means, the file it writes, and that the data
// health reads that file as a key feed that goes stale when Postpass stops answering.   node tests/osm_sources.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { judge, render, prevAsof, RUNNER_BLOCKED, OVERPASS } from "../tools/refresh_osm_sources.mjs";
import { stampOf, sourcesOf, evaluate } from "../tools/health_lib.mjs";
import vm from "node:vm";

const GJ = JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: { osm_type: "N", osm_id: 1, tags: { amenity: "cafe" } }, geometry: { type: "Point", coordinates: [100.5, 13.75] } }] });
assert.deepEqual(judge("postpass", 200, GJ), { ok: true });
assert.equal(judge("postpass", 200, JSON.stringify({ type: "FeatureCollection", features: [] })).ok, false, "an empty Postpass answer is a failure");
assert.equal(judge("postpass", 504, "<html>").why, "HTTP 504");
assert.equal(judge("postpass", 200, "<html>busy</html>").why, "answer is not JSON");
assert.deepEqual(judge("overpass", 200, JSON.stringify({ elements: [{ type: "node", id: 1 }] })), { ok: true });
assert.equal(judge("overpass", 200, JSON.stringify({ elements: [{ type: "node", id: 1 }], remark: "runtime error: Query timed out" })).ok, false, "a timed-out partial Overpass answer is a failure");
assert.equal(judge("overpass", 429, "").why, "busy (429)");
assert.ok(RUNNER_BLOCKED.test(OVERPASS[0]) && !OVERPASS.slice(1).some((u) => RUNNER_BLOCKED.test(u)), "only overpass-api.de is treated as not checkable from GitHub");

const pp = { source: "Postpass (Geofabrik)", ok: true, ms: 300 }, bad = { source: "Postpass (Geofabrik)", ok: false, why: "HTTP 504", ms: 25000 };
const ops = [{ source: "maps.mail.ru", ok: false, why: "HTTP 504" }];
const t1 = render(null, "2026-10-28T13:00:00Z", pp, ops);
assert.equal(stampOf(t1), "2026-10-28T13:00:00.000Z", "a good Postpass answer stamps the file");
const t2 = render(prevAsof(t1), "2026-10-28T13:15:00Z", bad, ops);
assert.equal(stampOf(t2), "2026-10-28T13:00:00.000Z", "a failed check keeps the last good time, so the feed ages");
assert.equal(stampOf(render(null, "2026-10-28T13:15:00Z", bad, ops)), null, "never answered: no stamp (health says no data)");
const box = { window: {} }; vm.runInNewContext(t2, box);
assert.deepEqual(JSON.parse(JSON.stringify(sourcesOf(box.window.OSAP_OSM_SOURCES))), { ok: 0, fail: 1, failing: ["Postpass (Geofabrik)"] }, "Postpass is the listed source");
assert.equal(box.window.OSAP_OSM_SOURCES.fallbacks[0].source, "maps.mail.ru", "Overpass servers are kept as fallbacks, not sources");

const cfg = JSON.parse(fs.readFileSync("tools/health.json", "utf8"));
const f = cfg.feeds.find((x) => x.id === "osm");
assert.ok(f && f.key && f.file === "data/live/osm-sources.js", "the data health lists the file as a key feed");
const now = Date.parse("2026-10-28T16:00:00Z");
const health = (asof) => ({ asof: "2026-10-28T15:55:00Z", feeds: [{ id: "osm", name: f.name, key: true, maxMin: f.maxMin, asof }] });
assert.equal(evaluate(health("2026-10-28T15:50:00Z"), cfg, now).state, "ok", "Postpass answered recently: ok");
const ev = evaluate(health("2026-10-28T13:00:00Z"), cfg, now);
assert.ok(ev.state === "down" && /Live map data/.test(ev.alerts.join(" ")), "Postpass dark for 3 h: a key alert names it " + JSON.stringify(ev.alerts));
const wf = fs.readFileSync(".github/workflows/refresh-flood.yml", "utf8");
assert.ok(wf.indexOf("refresh_osm_sources.mjs") > 0 && wf.indexOf("refresh_osm_sources.mjs") < wf.indexOf("node tools/health.mjs build"), "the refresh checks the sources before it writes the data health");
console.log("osm sources: all passed");
