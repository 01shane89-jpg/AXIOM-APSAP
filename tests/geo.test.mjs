// Unit test for assets/osap-geo.js (Measure tool and Route tab maths), no network.
// Expected values come from GeographicLib (distance, bearing, area), the NGA mgrs library (grid references) and
// NOAA's WMM2025 coefficients through pygeomag (declination at 2026.75, sea level).
// Usage: node tests/geo.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(new URL("../assets/osap-geo.js", import.meta.url), "utf8"), ctx);
const G = ctx.window.OSAP_GEO;
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (tolerance ${tol})`);

// distance and bearing on WGS 84 (GeographicLib Inverse)
let r = G.inverse([13.7563, 100.5018], [12.9236, 100.9925]);
near(r.m, 106361.887, 0.01, "Bangkok-Pattaya distance"); near(r.b1, 149.956081, 1e-5, "Bangkok-Pattaya bearing");
r = G.inverse([51.5, -0.12], [40.7, -74.0]);
near(r.m, 5586501.473, 0.01, "London-New York distance"); near(r.b1, 360 - 71.636993, 1e-5, "London-New York bearing");
r = G.inverse([0, 179.5], [0, -179.5]); near(r.m, 111319.49, 0.1, "across the dateline"); near(r.b1, 90, 1e-6, "dateline bearing");
assert.equal(G.inverse([10, 10], [10, 10]).m, 0);
// a near-antipodal pair falls back to the sphere instead of failing
r = G.inverse([0, 0], [0.5, 179.7]); assert.ok(r.m > 19.9e6 && r.m < 20.1e6, "near antipodal: " + r.m);

// area (GeographicLib Polygon: 11,977.8166 km² for this 1°x1° square)
near(G.area([[13, 100], [14, 100], [14, 101], [13, 101]]) / 1e6, 11977.8166, 12, "1 degree square area");
near(G.area([[13, 100], [13, 101], [14, 101], [14, 100]]) / 1e6, 11977.8166, 12, "area either way round");
assert.equal(G.area([[1, 1], [2, 2]]), 0);

// MGRS (NGA mgrs library, 1 m, truncated), and the way back to within the 1 m square
const M = [[13.7563, 100.5018, "47P PR 62366 21280"], [-33.8688, 151.2093, "56H LH 34368 50948"], [60.5, 5.5, "32V LN 07793 12209"],
  [78.2, 15.6, "33X WG 13696 80760"], [0, 0, "31N AA 66021 00000"], [-45.1, -170.2, "02G NR 62942 05629"], [51.5007, -0.1246, "30U XC 99567 09427"],
  [83.9, -40, "24X VU 88136 17033"]];
for (const [la, lo, want] of M) {
  assert.equal(G.mgrs(la, lo), want, `MGRS of ${la},${lo}`);
  const back = G.fromMgrs(want); near(back.lat, la, 2e-5, "MGRS back lat " + want); near(back.lon, lo, 3e-5, "MGRS back lon " + want);
}
assert.equal(G.mgrs(13.7563, 100.5018, 3), "47P PR 623 212");
assert.equal(G.mgrs(85, 0), null);   // polar (UPS) areas are not MGRS UTM
assert.equal(G.fromMgrs("47P PI 1 2"), null); assert.equal(G.fromMgrs("99Z AA"), null);

// typed positions
const P = (s) => { const p = G.parse(s); return p && [+p.lat.toFixed(5), +p.lon.toFixed(5)]; };
assert.deepEqual(P("13.7563, 100.5018"), [13.7563, 100.5018]);
assert.deepEqual(P("13°45'22.7\"N 100°30'06.5\"E"), [13.75631, 100.50181]);
assert.deepEqual(P("N13 45.378 E100 30.108"), [13.7563, 100.5018]);
assert.deepEqual(P("33.9S 151.2E"), [-33.9, 151.2]);
assert.deepEqual(P("-33.86 151.2"), [-33.86, 151.2]);
assert.deepEqual(P("47PPR6236621280"), [13.7563, 100.5018]);
assert.equal(G.parse("garbage"), null); assert.equal(G.parse("95, 10"), null); assert.equal(G.parse("13 61 N, 100 E"), null);

// magnetic declination, World Magnetic Model 2025 (pygeomag, 2026.75, sea level)
for (const [la, lo, want] of [[13.75, 100.5, -0.659], [40, -105, 7.527], [64, -150, 13.953], [-33.9, 151.2, 12.836], [51.5, 0, 1.247]])
  near(G.decl(la, lo, 2026.75), want, 0.01, `declination at ${la},${lo}`);

// sun: Bangkok 29 Sep 2026 sunrise 06:07 ICT (23:07Z the day before) and sunset 18:09 ICT; Denver on its own local date
let s = G.sun(Date.UTC(2026, 8, 29, 3), 13.75, 100.5);
near(s.rise, Date.UTC(2026, 8, 28, 23, 7), 3 * 60e3, "Bangkok sunrise"); near(s.set, Date.UTC(2026, 8, 29, 11, 9), 3 * 60e3, "Bangkok sunset");
assert.ok(s.bmnt < s.civilDawn && s.civilDawn < s.rise && s.set < s.civilDusk && s.civilDusk < s.eent, "twilight order");
s = G.sun(Date.UTC(2026, 8, 29, 3), 40, -105);
near(s.rise, Date.UTC(2026, 8, 28, 12, 53), 4 * 60e3, "Denver sunrise"); near(s.set, Date.UTC(2026, 8, 29, 0, 47), 4 * 60e3, "Denver sunset");
assert.equal(G.sun(Date.UTC(2026, 5, 21, 12), 78, 15).rise, null);   // midnight sun
near(G.moon(Date.UTC(2026, 8, 26, 16, 49)).lit, 1, 0.02, "full moon 26 Sep 2026");

// geodesic path: ends match, long legs are split, the dateline stays continuous
const pa = G.path([0, 170], [0, -170], 100);
assert.ok(pa.length > 20); assert.deepEqual(pa[0], [0, 170]); assert.equal(pa[pa.length - 1][1], 190);

// formatting
assert.equal(G.fmtDist(106361.9, "km"), "106.4 km"); assert.equal(G.fmtDist(850, "km"), "850 m"); assert.equal(G.fmtDist(1852 * 3, "nm"), "3.00 nm");
assert.equal(G.fmtBrg(359.7), "000°"); assert.equal(G.fmtBrg(90, true), "1600 mils"); assert.equal(G.fmtBrg(-10), "350°");
console.log("geo tests passed");
