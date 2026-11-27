// Pure checks of Your sky (assets/osap-yoursky.js, rules sky-v1): the point that may leave the device is rounded to 0.01 degrees,
// the 4 km box around it, which Sentinel-2 pass is shown (newest at 30% scene cloud or less, else the least cloudy, and the
// cloudier newer passes named), the next picture and radar pass from Check it from space, and the country satellite count read
// from the hourly "sat-pass" line. Run from the repo root: node tests/yoursky.test.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
const ctx = { Math, JSON, Date, Promise, String, Object, Array, Number, isFinite, setTimeout, clearTimeout, document: null };
ctx.window = ctx;
vm.runInNewContext(readFileSync("assets/osap-yoursky.js", "utf8"), ctx);
const X = ctx.OSAP_SKYQ, t = X._t;
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const Z = (s) => Date.parse(s);

// rounding: about 1 km, never more precise; bad input refused
let r = t.round(13.756331, 100.501765);
ok(r.la === 13.76 && r.lo === 100.5, "position rounded to 0.01 degrees (" + JSON.stringify(r) + ")");
r = t.round(-33.86882, 151.20929);
ok(r.la === -33.87 && r.lo === 151.21, "southern and eastern hemispheres round the same way");
r = t.round(-0.001, -0.004);
ok(Object.is(r.la, 0) && Object.is(r.lo, 0), "no negative zero leaks into the URL");
ok(String(t.round(51.50735, -0.12776).lo).split(".")[1].length <= 2, "never more than two decimals");
ok(t.round(NaN, 1) === null && t.round(91, 0) === null && t.round(0, 181) === null && t.round("x", 2) === null, "bad positions refused");

// the box: 4 km across at the equator and at 60 N (longitude widens), centred on the point
const km = (bb) => [(bb[2] - bb[0]) * 111.32 * Math.cos(((bb[1] + bb[3]) / 2) * Math.PI / 180), (bb[3] - bb[1]) * 110.57];
let bb = t.boxAround(0, 10), k = km(bb);
ok(Math.abs(k[0] - 4) < 0.01 && Math.abs(k[1] - 4) < 0.01, "4 km box at the equator (" + k.map((v) => v.toFixed(3)) + ")");
bb = t.boxAround(60, 25); k = km(bb);
ok(Math.abs(k[0] - 4) < 0.02 && Math.abs(k[1] - 4) < 0.01, "4 km box at 60 N (" + k.map((v) => v.toFixed(3)) + ")");
ok(Math.abs((bb[0] + bb[2]) / 2 - 25) < 1e-4 && Math.abs((bb[1] + bb[3]) / 2 - 60) < 1e-4, "box centred on the point");
bb = t.boxAround(89.99, 0);
ok(bb[3] <= 85 && isFinite(bb[0]) && isFinite(bb[2]), "near the pole the box stays finite and inside the web map");

// picking the pass
const P = (d, cloud, items = 1) => ({ t: Z(d), cloud, sat: "S2B", items: Array.from({ length: items }, (_, i) => ({ id: "x" + i })) });
let got = t.pickPass([P("2026-11-25T03:50Z", 88), P("2026-11-22T03:50Z", 55), P("2026-11-20T03:50Z", 12), P("2026-11-15T03:50Z", 2)]);
ok(got.pic && got.pic.cloud === 12, "the newest pass at 30% scene cloud or less is shown, not the clearest overall");
ok(got.newer.length === 2 && got.newer[0].cloud === 88, "the cloudier newer passes are listed, newest first");
got = t.pickPass([P("2026-11-25T03:50Z", 90), P("2026-11-22T03:50Z", 61), P("2026-11-20T03:50Z", 61), P("2026-11-15T03:50Z", 75)]);
ok(got.pic && got.pic.cloud === 61 && got.pic.t === Z("2026-11-22T03:50Z"), "none clear: the least cloudy, the newer of a tie");
ok(got.newer.length === 1, "and the newer cloudier pass is named");
got = t.pickPass([P("2026-11-25T03:50Z", null), P("2026-11-20T03:50Z", 40)]);
ok(got.pic.cloud === 40, "a pass with no cloud figure is never called clear");
got = t.pickPass([P("2026-11-25T03:50Z", 5, 0), { t: NaN, cloud: 1, items: [{}] }]);
ok(got.pic === null && got.newer.length === 0, "passes without a picture or a time are left out");
ok(t.pickPass(null).pic === null && t.pickPass([]).pic === null, "no passes, no picture");
got = t.pickPass([P("2026-11-25T03:50Z", 30)]);
ok(got.pic.cloud === 30, "30% exactly counts as clear");

// next passes from Check it from space
const nx = t.nextOf({ next: [{ src: "s1", t: 1 }, { src: "s2", t: 2 }, { src: "s1", t: 3 }, { src: "s2", t: 4 }] });
ok(nx.pic.t === 2 && nx.radar.t === 1, "the soonest picture pass and the soonest radar pass");
ok(t.nextOf(null).pic === null && t.nextOf({ ok: {} }).radar === null, "a failed check gives no pass, not an error");

// the country's satellites, as the hourly job writes them (data/live/x/th.js, 27 Nov 2026)
const item = { f: "sat-pass", t: "67 reconnaissance or imaging satellites over the country in the next 12 hours (12 military)",
  x: "First passes (sub-satellite point, approximate): PLEIADES NEO 3 04:07Z; LEGION 1 04:16Z; PRSC-E03 04:38Z; KENT RIDGE 1 04:41Z; RASAT 05:04Z; and 55 more. From public CelesTrak orbital elements; timings within a few minutes.",
  d: "2026-11-27T04:07", v: 67 };
let s = t.satCount([{ f: "quake" }, item]);
ok(s.n === 67 && s.mil === 12, "count and military count read (" + s.n + ", " + s.mil + ")");
ok(s.first.length === 5 && s.first[0].name === "PLEIADES NEO 3" && s.first[0].z === "04:07" && s.first[3].name === "KENT RIDGE 1", "first passes with their Zulu times");
ok(s.t0 === Z("2026-11-27T04:07:00Z") && s.first[0].t === Z("2026-11-27T04:07:00Z") && s.first[4].t === Z("2026-11-27T05:04:00Z"), "each pass placed on the job's day");
s = t.satCount([{ f: "sat-pass", t: "2 reconnaissance or imaging satellites over the country in the next 12 hours", d: "2026-11-27T20:10", x: "First passes (sub-satellite point, approximate): A 20:30Z; B 01:15Z. From public CelesTrak orbital elements." }]);
ok(s.first[1].t === Z("2026-11-28T01:15:00Z"), "a pass after midnight Zulu goes on the next day");
ok(!s.first.some((f) => /more|CelesTrak/.test(f.name)), "the trailing note is never read as a satellite");
s = t.satCount([{ f: "sat-pass", t: "3 reconnaissance or imaging satellites over the country in the next 12 hours" }]);
ok(s.n === 3 && s.mil === 0 && s.first.length === 0 && s.t0 === null, "without v or a military figure the line is still read");
ok(t.satCount([{ f: "quake" }]) === null && t.satCount(null) === null && t.satCount([{ f: "sat-pass", t: "none" }]) === null, "no line, no count");

// wording of times
const now = Z("2026-11-27T05:00Z");
ok(t.ago(now - 30 * 6e4, now) === "under an hour ago" && t.ago(now - 5 * 36e5, now) === "5 h ago" && t.ago(now - 4 * 864e5, now) === "4 days ago", "how long ago");
ok(t.soon(now + 30 * 6e4, now) === "within the hour" && t.soon(now + 20 * 36e5, now) === "in about 20 h" && t.soon(now + 3 * 864e5, now) === "in about 3 days", "how soon");

// the file sends nothing until tapped: no fetch at load, and it never names an AXIOM host
const src = readFileSync("assets/osap-yoursky.js", "utf8");
ok(!/axiom-intelligence-systems|\/api\//.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), "no AXIOM endpoint in the code");
ok(ctx.OSAP_SKYQ.state().step === "idle", "nothing runs at load");

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
