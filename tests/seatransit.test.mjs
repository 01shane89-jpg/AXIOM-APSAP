// Unit checks of the sea transit assessment's geometry (assets/osap-seatransit.js core), run in node without a browser.
// Distances are great-circle NM (Earth radius 3,440.065 NM) as in the supplied maritime medevac assessment (2026-10-05).
// Run: node tests/seatransit.test.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
const box = {}; vm.runInNewContext(readFileSync(new URL("../assets/osap-seatransit.js", import.meta.url), "utf8"), box);
const C = box.OSAP_SEATRANSIT && box.OSAP_SEATRANSIT.core;
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const near = (a, b, t) => Math.abs(a - b) <= t;

ok(!!C && typeof C.densify === "function", "core loads in node with no document");
// The assessment's distance table: northern Malacca (5.5 N 98.0 E) to Phuket town (7.8804 N 98.3923 E) is about 144.5 NM
const d = C.nm([5.5, 98.0], [7.8804, 98.3923]);
ok(near(d, 144.5, 1), `northern Malacca to Phuket ${d.toFixed(1)} NM (about 144.5)`);
ok(near(C.nm([0, 0], [0, 1]), 60.04, 0.05), "one degree of longitude on the equator is about 60 NM");
ok(near(C.nm([0, 179.5], [0, -179.5]), 60.04, 0.05), "distance across the date line is the short way");
// gcAt / dest / ring
const m = C.gcAt([0, 0], [0, 10], 0.5); ok(near(m[0], 0, 1e-6) && near(m[1], 5, 1e-6), "great-circle midpoint on the equator");
const p = C.dest([10, 100], 90, 100); ok(near(C.nm([10, 100], p), 100, 0.01), "a point 100 NM out is 100 NM away");
const r = C.ring([7.88, 98.39], 200, 36); ok(r.length === 37 && r.every((x) => near(C.nm([7.88, 98.39], x), 200, 0.01)), "200 NM ring: every point is 200 NM from the centre");
// densify keeps every waypoint and samples each leg at the step
const wps = [{ n: "A", lat: 0, lon: 0 }, { n: "B", lat: 0, lon: 5 }, { n: "C", lat: 3, lon: 5 }];
const pts = C.densify(wps, 50);
ok(pts.filter((x) => x.wp >= 0).length === 3, "densify keeps all three waypoints");
ok(near(pts[pts.length - 1].nm, C.nm([0, 0], [0, 5]) + C.nm([0, 5], [3, 5]), 0.01), "the last point's distance is the corridor length");
ok(pts.every((x, i) => !i || x.nm > pts[i - 1].nm), "sample distances increase along the corridor");
ok(pts.every((x, i) => !i || x.nm - pts[i - 1].nm <= 50 * 1.26), "no gap between samples is much over the step");
ok(pts.filter((x) => x.leg === 0 && x.wp < 0).length === 5, "the 300 NM first leg gets 5 samples between its ends at 50 NM");
// line: no jump across the date line
const L = C.line([{ lat: 0, lon: 179 }, { lat: 0, lon: -179 }]);
ok(L.every((x, i) => !i || Math.abs(x[1] - L[i - 1][1]) < 5), "the drawn line does not jump across the map at the date line");
// assess: remote only when no sourced hospital within remH AND no port within remP
const sets = { hosp: [{ id: "h", lat: 0, lon: 0 }], ports: [{ id: "p", lat: 3, lon: 5 }], osm: [], af: [] };
const rows = C.assess(pts, sets, { remH: 120, remP: 60, kn: 10, dep: Date.UTC(2026, 9, 5, 0, 0) });
ok(!rows[0].remote && rows[0].hosp.nm < 0.01, "the start (on the hospital) is not remote");
ok(!rows[rows.length - 1].remote, "the end (on the port) is not remote");
const mid = rows.find((x) => near(x.pt.nm, 250, 1)); ok(mid && mid.remote, "250 NM out, hospital and port both far: remote");
ok(rows.every((x) => x.osm === null && x.af === null), "an empty set gives no nearest point (never invented)");
ok(rows[rows.length - 1].eta === Date.UTC(2026, 9, 5) + pts[pts.length - 1].nm / 10 * 3600000, "ETA follows speed and departure");
// segments
const S = C.segments(wps, rows, { kn: 10, dep: null });
ok(S.length === 2 && near(S[0].nm + S[1].nm, pts[pts.length - 1].nm, 0.01), "two segments, lengths add up to the corridor");
ok(S[0].remote > 0 && S[0].remoteNm[0] > 100, "the first segment flags its remote stretch");
ok(S[0].t0 === null && near(S[0].hours, S[0].nm / 10, 1e-9), "no departure time: no clock times, hours still given");
ok(near(S[1].worstHosp, C.nm([0, 0], [3, 5]), 0.5) && S[1].worstPort > 100, "worst gaps: the far end of each segment from the hospital and the port");
// marine forecast helpers: the hour holding a time, the worst of a window, and planning flags
const T = Array.from({ length: 48 }, (_, i) => new Date(Date.UTC(2026, 9, 10, 0) + i * 3600000).toISOString().slice(0, 16));
const V = T.map((_, i) => (i === 30 ? 4.2 : i === 50 ? 9 : 1 + i / 100));
ok(C.wxAt(T, V, Date.UTC(2026, 9, 10, 5, 40)) === V[5], "value in the hour holding the time");
ok(C.wxAt(T, V, Date.UTC(2026, 9, 12, 1)) === null && C.wxAt(T, V, Date.UTC(2026, 9, 9, 23)) === null, "outside the forecast: no value (never extrapolated)");
const W = C.wxWorst(T, V, Date.UTC(2026, 9, 10, 10), 24);
ok(W && W.v === 4.2 && W.t === Date.UTC(2026, 9, 11, 6), "worst of the next 24 h found with its time");
ok(C.wxWorst(T, V, Date.UTC(2026, 9, 13), 24) === null, "a window after the forecast gives nothing");
ok(C.wxWorst(T, [null, null], Date.UTC(2026, 9, 10), 2) === null, "all-missing values give nothing");
ok(C.wxFlags({ hs: 4.2, gust: 40, vis: 500 }).length === 3 && C.wxFlags({ hs: 2.6 })[0].startsWith("rough") && C.wxFlags({ hs: 1, gust: 20, vis: 20000 }).length === 0, "planning flags for very rough sea, gale gusts and poor visibility; none in calm weather");
// the rescue contact directory (data/seamed/rcc.json): sourced, institutional, well formed
const RCC = JSON.parse(readFileSync(new URL("../data/seamed/rcc.json", import.meta.url), "utf8"));
const ids = new Set(), bad = [];
for (const c of RCC.centres) {
  if (ids.has(c.id)) bad.push("duplicate " + c.id); ids.add(c.id);
  if (!/^[a-z]{2}$/.test(c.cc)) bad.push(c.id + " cc");
  if (!/^https:\/\//.test(c.src || "")) bad.push(c.id + " src not https");
  if (!c.name || !c.role || !c.srcname) bad.push(c.id + " name/role/srcname");
  if (!["rcc", "rsc", "national", "naval", "comms"].includes(c.kind)) bad.push(c.id + " kind");
  if (!["pdf", "search"].includes(c.via)) bad.push(c.id + " via");
  for (const t of c.tel || []) if (!/^\+?[\d ]+( \(.*\))?$/.test(t)) bad.push(c.id + " tel " + t);
  for (const k of c.covers || []) if (!/^[a-z]{2}$/.test(k)) bad.push(c.id + " covers " + k);
  if (c.lat != null && !(Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180)) bad.push(c.id + " position");
}
ok(!bad.length, `rescue directory: ${RCC.centres.length} centres well formed` + (bad.length ? ": " + bad.slice(0, 5).join("; ") : ""));
ok(new Set(RCC.centres.map((c) => c.cc)).size >= 80, `rescue directory covers ${new Set(RCC.centres.map((c) => c.cc)).size} countries and territories`);
ok(RCC.centres.filter((c) => c.via === "search").every((c) => !c.email && !c.mmsi), "web-search entries carry no email or MMSI that OSAP could not read");
ok(RCC.missing.every((m) => /^[a-z]{2}$/.test(m.cc) && !RCC.centres.some((c) => c.cc === m.cc)), `countries with no sourced contact are listed (${RCC.missing.length}) and none also has an entry`);
if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("all passed");
