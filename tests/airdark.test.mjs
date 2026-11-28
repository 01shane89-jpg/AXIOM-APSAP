// Aircraft gone quiet mid-flight near hot spots (tools/airdark_lib.mjs, rules airdark-v1), no network: a regular airborne
// aircraft in a hot spot that sweeps asked about and did not hear, while receivers heard others there, is flagged after 10 min
// and two such sweeps; heard again it gets "reappeared" with the gap and distance. Not flagged: outside the boxes, low, slow,
// near an airfield, MLAT, OpenSky-only, a short flight, circles not asked, no other aircraft heard there, no airfield list.
// Run: node tests/airdark.test.mjs
import * as A from "../tools/airdark_lib.mjs";
import { airfieldNm } from "../tools/air_tracks.mjs";
let fails = 0;
function ok(c, m, x) { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x))); if (!c) fails++; }

const T0 = 1_800_000_000, SW = (i) => T0 + i * 300;   // a sweep every five minutes
const sweepSrc = (i) => i < 2;                            // 0 adsb.fi, 1 adsb.lol, 2 OpenSky
// [hex, cs, reg, t, desc, lat, lon, alt, gs, trk, pos, src, sqk, cat, fl]
const row = (hex, lat, lon, t, o = {}) => [hex, o.cs ?? "TEST1", null, o.type ?? "B738", null, lat, lon, o.alt ?? 30000, o.gs ?? 420, o.trk ?? 90, t, o.src ?? 0, o.sqk ?? null, "A3", o.fl ?? 0];
// other aircraft heard near (lat, lon) in this sweep: the receivers there are up
const crowd = (lat, lon, t, n = 4) => Array.from({ length: n }, (_, i) => row("c" + i + "_" + Math.round(lat) + "_" + Math.round(lon), lat + 0.1 * i, lon + 0.1 * i, t));
const trackOf = (hex, lat, lon, t) => new Map([[hex, [[t - 1200, lat, lon - 1, 30000, 0], [t - 600, lat, lon - 0.5, 30000, 0], [t, lat, lon, 30000, 0]]]]);
const far = () => 80, near = () => 10;
const asMap = (rows) => new Map(rows.map((r) => [r[0], r]));
const circles = [[32.0, 52.0], [32.0, 55.0]];

// the Iran case: an airliner over central Iran at FL300 heading east, then nothing
function run(target, opts = {}) {
  let st = A.emptyState();
  const t1 = SW(0), x = target(t1);
  let prev = asMap([x, ...crowd(32.0, 52.0, t1), ...crowd(32.0, 53.0, t1)]);
  const tracks = opts.tracks ?? trackOf(x[0], x[5], x[6], t1);
  const out = [];
  for (let i = 1; i <= 4; i++) {
    const t = SW(i), dr = A.dest(x[5], x[6], x[9], x[8] * (t - x[10]) / 3600);
    const heard = [...crowd(32.0, 52.0, t, opts.crowd ?? 4), ...crowd(dr[0], dr[1], t, opts.crowd ?? 4)];
    if (opts.backAt === i) heard.push(row(x[0], 32.0, 54.2, t));
    const now = asMap(heard);
    st = A.step(st, prev, now, opts.circles ?? circles, i === 1 ? tracks : new Map(), t, opts.fieldNm === undefined ? far : opts.fieldNm, sweepSrc);
    out.push(JSON.parse(JSON.stringify(st)));
    prev = now;
  }
  return out;
}
const base = (t) => row("73a001", 32.0, 52.5, t);
let r = run(base);
ok(r[0].events.length === 0 && r[0].cand["73a001"] && r[0].cand["73a001"].miss === 1, "sweep 1 (5 min quiet): watched, one sweep should have heard it", r[0].cand["73a001"]);
ok(r[1].events.length === 1 && r[1].events[0].k === "quiet" && r[1].events[0].misses === 2, "sweep 2 (10 min quiet, 2 sweeps): flagged gone quiet", r[1].events[0]);
const e = r[1].events[0];
ok(e.box === "gulf" && e.alt === 30000 && e.gs === 420 && e.last_t === SW(0) && e.field_nm === 80 && Array.isArray(e.dr) && e.trail.length === 3 && !("reg" in e), "event keeps box, last report, dead reckoning and the kept flight; no registration", e);
ok(Math.abs(A.nm(e.lat, e.lon, e.dr[0], e.dr[1]) - 420 * 10 / 60) < 1, "dead reckoning: 10 min at 420 kt = 70 nm along its track");
ok(r[3].events.length === 1 && r[3].events[0].misses === 4, "still quiet: one event, misses counted on", r[3].events[0].misses);
const p = A.publish(r[3], "x", []);
ok(p.schema === "osap-airdark/1" && p.rules === "airdark-v1" && p.boxes.length === A.BOXES.length && p.events.length === 1 && p.watching === 1 && !JSON.stringify(p).includes('"cand"'), "published file: events, boxes, rules, how many watched; no candidate list", { watching: p.watching });

r = run(base, { backAt: 3 });
const b = r[2].events[0];
ok(b && b.back && b.back.gap_min === 15 && b.back.nm > 0 && !r[2].cand["73a001"], "heard again after 15 min: the event gets the gap and distance, watching stops", b && b.back);

// not flagged
const none = (m, o) => { const x = run(o.t || base, o); ok(x[3].events.length === 0, m, x[3].events[0]); };
none("outside every hot spot (over France)", { t: (t) => row("39a001", 46.5, 2.5, t), circles: [[46.5, 2.5], [46.5, 4.0]] });
none("low (5,000 ft)", { t: (t) => row("73a002", 32.0, 52.5, t, { alt: 5000 }) });
none("slow (120 kt)", { t: (t) => row("73a003", 32.0, 52.5, t, { gs: 120 }) });
none("on the ground", { t: (t) => row("73a004", 32.0, 52.5, t, { fl: 4 }) });
none("placed by MLAT", { t: (t) => row("73a005", 32.0, 52.5, t, { fl: 2 }) });
none("heard only in OpenSky's snapshot", { t: (t) => row("73a006", 32.0, 52.5, t, { src: 2 }) });
none("10 nm from an airfield (landing or taking off)", { fieldNm: near });
none("no airfield list: the airfield test cannot be done", { fieldNm: null });
none("a flight kept for only 2 positions", { tracks: new Map([["73a001", [[SW(0) - 300, 32, 52, 30000, 0], [SW(0), 32, 52.5, 30000, 0]]]]) });
none("receiver circles there not asked this sweep", { circles: [[10, 10]] });
none("no other aircraft heard there (no receivers up)", { crowd: 2 });
ok(run((t) => row("73a007", 32.0, 52.5, t, { fl: 1 }))[3].events[0]?.mil === true, "a military-flagged aircraft is flagged too, marked mil");

// gives up after 3 h
let st = A.emptyState(), x = base(SW(0));
st = A.step(st, asMap([x]), new Map(), circles, trackOf(x[0], 32, 52.5, SW(0)), SW(1), far, sweepSrc);
ok(!!st.cand["73a001"], "watched after one unheard sweep");
st = A.step(st, new Map(), new Map(), circles, new Map(), SW(0) + 3 * 3600 + 60, far, sweepSrc);
ok(!st.cand["73a001"], "watching stops after 3 h");
// old events drop after 24 h; another rule set starts fresh
st = A.step({ rules: "airdark-v1", cand: {}, events: [{ k: "quiet", hex: "x", t: SW(0) }] }, new Map(), new Map(), circles, new Map(), SW(0) + 25 * 3600, far, sweepSrc);
ok(st.events.length === 0, "events older than 24 h are dropped");
ok(A.step({ rules: "airdark-v0", cand: { a: {} }, events: [{ t: SW(0) }] }, new Map(), new Map(), [], new Map(), SW(1), far, sweepSrc).events.length === 0, "a state from another rule set is not used");

// helpers
ok(A.boxOf(48.5, 35.0) === "ukraine" && A.boxOf(24.0, 120.0) === "taiwan" && A.boxOf(51.5, -0.1) === null, "boxes: Ukraine, Taiwan Strait, not London");
const g = new Map([["32_52", [[32.1, 52.1, "OIXX", "Test field", 1]]]]);
ok(Math.abs(airfieldNm(g, 32.0, 52.0) - A.nm(32, 52, 32.1, 52.1)) < 0.01 && airfieldNm(g, 40, 40) === Infinity && airfieldNm(null, 1, 1) === null, "airfield distance from the OurAirports grid");

console.log(fails ? `${fails} FAILED` : "ALL PASS");
process.exit(fails ? 1 : 0);
