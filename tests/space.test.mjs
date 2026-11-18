// Pure checks of Check it from space (assets/osap-space.js, rules space-v1): Sentinel-2 and Sentinel-1 passes folded into repeat
// tracks, the next expected passes from each track's newest pass plus whole cycles, the cloud forecast at the pass hour, what was
// already taken since the report and the clear pass before it, which reports the check is offered for, and that every value a
// source returns is escaped. Run from the repo root: node tests/space.test.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
const ctx = { Math, JSON, Date, Promise, String, Object, Array, isFinite, setTimeout, clearTimeout, document: null };
ctx.window = ctx;
vm.runInNewContext(readFileSync("assets/osap-space.js", "utf8"), ctx);
const X = ctx.OSAP_SPACE, t = X._t;
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const Z = (s) => Date.parse(s), iso = (ms) => new Date(ms).toISOString().slice(0, 16);
const NOW = Z("2026-11-18T12:00:00Z");

// Sentinel-2 over Tehran as Earth Search answered on 18 Nov 2026 (platform, time, cloud), plus a second tile of one pass
const s2 = { features: [
  ["sentinel-2b", "2026-11-17T07:29:49Z", 16.0], ["sentinel-2b", "2026-11-17T07:29:52Z", 4.2], ["sentinel-2a", "2026-11-14T07:29:53Z", 0.8],
  ["sentinel-2c", "2026-11-12T07:29:45Z", 1.5], ["sentinel-2b", "2026-11-07T07:29:48Z", 99.6], ["sentinel-2c", "2026-11-02T07:29:44Z", 10.8],
  ["sentinel-2b", "2026-10-28T07:29:48Z", 7.9], ["sentinel-2a", "2026-10-25T07:29:55Z", 63.5], ["sentinel-2c", "2026-10-23T07:29:47Z", 8.5],
  ["sentinel-2b", "2026-10-18T07:29:47Z", 11.0], ["landsat-9", "2026-11-16T07:00:00Z", 1], ["sentinel-2b", "not a date", 1],
].map(([platform, datetime, c]) => ({ properties: { platform, datetime, "eo:cloud_cover": c } })) };
const r2 = t.s2Rows(s2);
ok(r2.length === 9, "one row a satellite and day; Landsat and bad dates left out (" + r2.length + ")");
ok(r2[0].sat === "Sentinel-2B" && r2[0].cloud === 4, "two tiles of one pass fold into one row with the lowest cloud");
const tr2 = t.tracks(r2, 10);
ok(tr2.length === 3 && tr2.map((g) => g.sat + g.seen).sort().join() === "Sentinel-2A2,Sentinel-2B4,Sentinel-2C3", "three 10-day tracks with how often each was seen");
const n2 = t.project(tr2, 10, NOW, 14);
ok(n2.map((p) => p.sat.slice(-1) + iso(p.t).slice(5, 10)).join() === "C11-22,A11-24,B11-27,C12-02", "next passes: whole cycles after each track's newest (" + n2.map((p) => iso(p.t)).join() + ")");
ok(iso(n2[0].t) === "2026-11-22T07:29", "a projected pass keeps its track's time of day");

// Sentinel-1: OPERA bursts; two tracks of one satellite, one pass with two bursts
const s1 = { feed: { entry: [
  ["2026-11-17T02:36:48Z", "OPERA_L2_RTC-S1_T035-073893-IW2_20261117T023648Z_20261117T070522Z_S1D_30_v1.0"],
  ["2026-11-16T14:35:29Z", "OPERA_L2_RTC-S1_T028-058202-IW3_20261116T143529Z_20261116T210641Z_S1D_30_v1.0"],
  ["2026-11-16T14:35:28Z", "OPERA_L2_RTC-S1_T028-058202-IW2_20261116T143528Z_20261116T210641Z_S1D_30_v1.0"],
  ["2026-11-05T02:36:49Z", "OPERA_L2_RTC-S1_T035-073893-IW2_20261105T023649Z_20261105T120520Z_S1D_30_v1.0"],
  ["2026-11-04T14:35:30Z", "OPERA_L2_RTC-S1_T028-058202-IW3_20261104T143530Z_20261105T040351Z_S1D_30_v1.0"],
  ["2026-10-30T10:00:00Z", "no satellite in this title"],
].map(([time_start, title]) => ({ time_start, title })) } };
const r1 = t.s1Rows(s1);
ok(r1.length === 4 && r1.every((r) => r.sat === "Sentinel-1D"), "Sentinel-1 rows: bursts of one pass folded, an unnamed satellite left out (" + r1.length + ")");
ok(r1.find((r) => r.track === "T028" && iso(r.t) === "2026-11-16T14:35"), "a folded pass keeps its first burst time");
const n1 = t.project(t.tracks(r1, 12), 12, NOW, 14);
ok(n1.map((p) => p.track + iso(p.t).slice(5, 10)).join() === "T02811-28,T03511-29", "radar: each track repeats in 12 days (" + n1.map((p) => p.track + iso(p.t)).join() + ")");

// a satellite that changes its plan: a track not seen for three cycles is not projected
const stale = t.project([{ sat: "Sentinel-2A", track: "", last: NOW - 35 * 864e5, seen: 3, src: "s2" }], 10, NOW, 14);
ok(stale.length === 0, "a track last seen 35 days ago gives no expected pass");
// passes not a whole cycle apart are separate tracks (two relative orbits of one satellite over the same place)
const two = t.tracks([{ sat: "Sentinel-2B", t: Z("2026-11-17T07:30Z") }, { sat: "Sentinel-2B", t: Z("2026-11-14T07:10Z") }, { sat: "Sentinel-2B", t: Z("2026-11-07T07:31Z") }], 10);
ok(two.length === 2 && two[0].seen === 2, "two orbits of one satellite stay two tracks");

// cloud forecast at the pass hour (Open-Meteo hourly, GMT), within 90 minutes only
const om = { hourly: { time: ["2026-11-22T07:00", "2026-11-22T08:00", "2026-11-24T07:00"], cloud_cover: [12, 80, null] } };
ok(t.cloudAt(om, Z("2026-11-22T07:29:45Z")) === 12, "cloud at the nearest hour");
ok(t.cloudAt(om, Z("2026-11-24T07:29Z")) === null && t.cloudAt(om, Z("2026-11-27T07:29Z")) === null, "no value or no hour near: not known");

// the whole answer for a report of 15 Nov 10:00Z
const R = t.build(Z("2026-11-15T10:00:00Z"), NOW, s2, s1, om);
ok(R.next[0].sat === "Sentinel-2C" && R.next[0].cloud === 12, "the soonest pass carries its cloud forecast");
ok(R.next.filter((p) => p.src === "s1").every((p) => p.cloud === undefined), "radar passes carry no cloud");
ok(R.since.map((p) => p.sat + iso(p.t).slice(5, 10)).join() === "Sentinel-1D11-16,Sentinel-1D11-17,Sentinel-2B11-17", "passes already taken since the report, in order");
ok(R.before && R.before.sat === "Sentinel-2A" && iso(R.before.t).startsWith("2026-11-14"), "the newest clear (30% or less) pass before the report");
const F = t.build(Z("2026-11-15T10:00:00Z"), NOW, null, s1, null);
ok(!F.ok.s2 && F.ok.s1 && F.next.length === 2, "Sentinel-2 failing still gives the radar passes");
const html = t.draw(R);
ok(/Next expected passes/.test(html) && /space-v1/.test(html) && /not a picture of the event/.test(html) && /Contains modified Copernicus Sentinel data/.test(html), "the panel names its rules, says a pass is not a picture, credits Copernicus");
ok(/radar, cloud does not matter/.test(html) && /Seen 3 times on this 10-day track/.test(html), "radar and track counts are said");
ok(!/forecast not read/.test(html), "forecast read: no failure note");
ok(/could not be read/.test(t.draw(t.build(Z("2026-11-15T10:00Z"), NOW, null, null, null))), "both pass lists failing says so");
// a hostile value from a source is escaped (only numbers and dates are shown; a satellite name comes from a fixed pattern)
const evil = t.s2Rows({ features: [{ properties: { platform: "<img src=x>", datetime: "2026-11-10T07:00Z" } }] });
ok(evil.length === 0, "an unknown platform is dropped, never drawn");

// which reports get the check: strike kinds pinned at a site or town, never a reaction headline or a province pin
const rep = (o) => Object.assign({ kind: "drone", title: "Drone strike hits depot", date: "2026-11-17T10:00", geo: { la: 35.7, lo: 51.4, p: "site" } }, o);
ok(X.eligible(rep({})), "a placed drone strike gets the check");
ok(!X.eligible(rep({ geo: { la: 35.7, lo: 51.4, p: "province" } })), "a province pin does not");
ok(!X.eligible(rep({ kind: "talks" })), "talks do not");
ok(!X.eligible(rep({ title: "Qatar condemns drone strike" })), "a reaction headline does not");
const u = t.urls(35.68912, 51.38977, Z("2026-10-09T00:00Z"), NOW);
ok(/bbox=51\.389,35\.688,51\.391,35\.69&/.test(u.s2), "only the rounded pin is sent (" + u.s2.slice(u.s2.indexOf("bbox"), u.s2.indexOf("&datetime")) + ")");
ok(/point=51\.39,35\.689&/.test(u.s1) && /latitude=35\.689&longitude=51\.39&/.test(u.om), "radar and cloud ask for the rounded pin");
console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
