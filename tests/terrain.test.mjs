// Terrain engine checks (assets/terrain/viewshed-engine.js) on made-up ground, with answers worked out by hand.
// Run from the repo root: node tests/terrain.test.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const VS = require("../assets/terrain/viewshed-engine.js");
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const near = (a, b, t) => Math.abs(a - b) <= t;

/* a square grid, cell = 30 m, height given as f(east metres, north metres) from the observer at the centre */
function grid(half, cell, f) {
  const n = half * 2 + 1, E = new Float32Array(n * n), rowM = new Float32Array(n).fill(cell);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) E[j * n + i] = f((i - half) * cell, (half - j) * cell);
  return { E, n, rowM, cell, half };
}
const idx = (g, eM, nM) => (g.half - Math.round(nM / g.cell)) * g.n + g.half + Math.round(eM / g.cell);

/* 1. flat ground: everything within range visible, nothing outside it */
{
  const g = grid(100, 30, () => 100);
  const r = VS.viewshed(g, { obsH: 1.7, tgtH: 1.7, radius_m: 2500 });
  ok(r.stats.masked === 0 && r.stats.unknown === 0, "flat ground: nothing masked or unknown");
  ok(r.cls[idx(g, 0, 2400)] === VS.VIS && r.cls[idx(g, 2400, 0)] === VS.VIS, "flat ground: 2.4 km north and east visible");
  ok(r.cls[idx(g, 2900, 0)] === VS.OUT && r.cls[idx(g, 2000, 2000)] === VS.OUT, "flat ground: beyond 2.5 km is outside the range");
  ok(near(r.Z0, 101.7, 1e-4), "observer altitude = ground + observer height (101.7 m)");
}

/* 2. a wall 50 m high, 1 km east (north-south ridge): ground behind it is masked, ground in front visible,
      the blocking distance is the wall's, and a tall enough target behind it shows over */
{
  const wall = (e) => (e >= 990 && e <= 1020 ? 150 : 100);
  const g = grid(100, 30, (e) => wall(e));
  const r = VS.viewshed(g, { obsH: 2, tgtH: 0, radius_m: 2900 });
  ok(r.cls[idx(g, 600, 0)] === VS.VIS, "wall: ground 600 m east (in front) visible");
  ok(r.cls[idx(g, 1500, 0)] === VS.MASK && r.cls[idx(g, 2500, 0)] === VS.MASK, "wall: ground 1.5 and 2.5 km east (behind) masked");
  ok(near(r.blockD[idx(g, 2500, 0)], 1005, 30), "wall: blocking terrain about 1 km from the observer (" + Math.round(r.blockD[idx(g, 2500, 0)]) + " m)");
  ok(r.cls[idx(g, -1500, 0)] === VS.VIS, "wall: ground 1.5 km west visible");
  /* line from 102 m over the wall top (150 m at ~990 m): at 2,520 m it is 102 + 48 x 2520 / 990 = 224 m, so a 130 m tower (230 m) shows */
  const tall = VS.viewshed(g, { obsH: 2, tgtH: 130, radius_m: 2900 });
  ok(tall.cls[idx(g, 2520, 0)] === VS.VIS, "wall: a 130 m target 2.5 km behind it is visible over the top");
  const short = VS.viewshed(g, { obsH: 2, tgtH: 110, radius_m: 2900 });
  ok(short.cls[idx(g, 2520, 0)] === VS.MASK, "wall: a 110 m target there is not");
  /* raising the observer to 200 m above ground sees over the wall to the ground beyond some distance */
  const hi = VS.viewshed(g, { obsH: 200, tgtH: 0, radius_m: 2900 });
  ok(hi.cls[idx(g, 2700, 0)] === VS.VIS && hi.cls[idx(g, 1100, 0)] === VS.MASK, "wall: from 200 m up, far ground shows and the strip right behind the wall stays masked");
  /* line of sight across the wall agrees */
  const L1 = VS.los(g, [g.half, g.half], [g.half + 2500 / 30, g.half], { hA: 2, hB: 1.7 });
  ok(L1.los === "BLOCKED" && near(L1.blockD, 990, 31) && L1.maxZ === 150, "LOS: blocked by the wall at about 990 m, highest ground 150 m");
  const L2 = VS.los(g, [g.half, g.half], [g.half + 900 / 30, g.half], { hA: 2, hB: 1.7 });
  ok(L2.los === "CLEAR" && near(L2.dist, 900, 0.5), "LOS: clear to 900 m, distance 900 m");
}

/* 3. Earth curvature: from 2 m over a flat sea-level plain, a 2 m target 10 km away is below the horizon
      (horizon for 2 m is about 5 km, a 2 m target adds 5 km more: 10.1 km; with refraction k = 0.13 about 10.8 km) */
{
  const g = grid(200, 60, () => 0);
  const flat = VS.viewshed(g, { obsH: 2, tgtH: 2, radius_m: 12000 });
  ok(flat.cls[idx(g, 11400, 0)] === VS.VIS, "curvature off: 11.4 km visible on a flat plain");
  const cur = VS.viewshed(g, { obsH: 2, tgtH: 2, radius_m: 12000, curvature: true });
  ok(cur.cls[idx(g, 9600, 0)] === VS.VIS && cur.cls[idx(g, 11400, 0)] === VS.MASK, "curvature on: 9.6 km visible, 11.4 km hidden");
  const ref = VS.viewshed(g, { obsH: 2, tgtH: 2, radius_m: 12000, curvature: true, k: 0.13 });
  ok(ref.cls[idx(g, 10500, 0)] === VS.VIS && cur.cls[idx(g, 10500, 0)] === VS.MASK, "refraction k = 0.13: 10.5 km visible again");
  ok(near(VS.drop(10000, { curvature: true }), 7.85, 0.01) && near(VS.drop(10000, { curvature: true, k: 0.25 }), 5.89, 0.01), "curvature drop 7.85 m at 10 km, 5.89 m with radio k = 0.25");
}

/* 4. no elevation data: a gap behind the observer's view makes points beyond it UNKNOWN, not masked;
      but ground already hidden by known terrain stays masked */
{
  const g = grid(100, 30, (e, nn) => (e >= 600 && e <= 700 && Math.abs(nn) < 400 ? NaN : e >= 1500 && e <= 1530 ? 400 : 100));
  const r = VS.viewshed(g, { obsH: 2, tgtH: 0, radius_m: 2900 });
  ok(r.cls[idx(g, 650, 0)] === VS.UNK, "no data: the gap itself is unknown");
  ok(r.cls[idx(g, 1200, 0)] === VS.UNK, "no data: flat ground beyond the gap is unknown (never 'not visible')");
  ok(r.cls[idx(g, 2400, 0)] === VS.MASK, "no data: ground behind a known 300 m ridge stays masked");
  ok(r.cls[idx(g, 1200, 900)] === VS.VIS, "no data: ground to the side, clear of the gap, visible");
  ok(r.stats.unknown > 0 && r.stats.unknown_pct < 20, "no data: unknown share counted (" + r.stats.unknown_pct.toFixed(1) + "%)");
  const L = VS.los(g, [g.half, g.half], [g.half + 1200 / 30, g.half], { hA: 2, hB: 0 });
  ok(L.los === "UNKNOWN", "no data: line of sight across the gap is UNKNOWN");
}

/* 5. observer on a hill sees down into a valley; a dip behind a crest is hidden; horizon per azimuth */
{
  const g = grid(100, 30, (e, nn) => { const d = Math.hypot(e, nn); return 300 - d * 0.1 + (d > 1500 && d < 1560 ? 60 : 0); });
  const r = VS.viewshed(g, { obsH: 1.7, tgtH: 1.7, radius_m: 2900 });
  ok(r.cls[idx(g, 0, 1200)] === VS.VIS, "hill: slope down to 1.2 km visible");
  ok(r.cls[idx(g, 0, 1700)] === VS.MASK, "hill: just behind a ring crest at 1.5 km masked");
  ok(r.horizon.length === 4 * (g.n - 1) && near(r.horizon[0].az, 0, 0.01), "horizon: one entry per edge ray, starting due north");
  const east = r.horizon.reduce((b, x) => (Math.abs(x.az - 90) < Math.abs(b.az - 90) ? x : b));
  ok(near(east.dMax, 1530, 45), "horizon: the skyline east is the crest at about 1.5 km (" + Math.round(east.dMax) + " m)");
}

/* 6. every cell inside the range is classified (no holes between rays) */
{
  const g = grid(150, 30, (e, nn) => 100 + 20 * Math.sin(e / 300) * Math.cos(nn / 400));
  const r = VS.viewshed(g, { obsH: 1.7, tgtH: 1.7, radius_m: 4400 });
  let holes = 0;
  for (let j = 0; j < g.n; j++) for (let i = 0; i < g.n; i++) { const e = (i - g.half) * 30, nn = (g.half - j) * 30; if (Math.hypot(e, nn) < 4300 && r.cls[j * g.n + i] === VS.OUT) holes++; }
  ok(holes === 0, "coverage: no unclassified cells inside the range (" + holes + ")");
  const c = VS.coarsen(g, 3);
  ok(c.n === 101 && c.E[50 * 101 + 50] === g.E[150 * g.n + 150] && c.rowM[0] === 90, "coarse pass: every third cell, centre kept, 90 m cells");
}

/* 7. no elevation at the observer is an error, not a result */
{
  const g = grid(10, 30, (e, nn) => (e === 0 && nn === 0 ? NaN : 100));
  let msg = ""; try { VS.viewshed(g, { obsH: 2, tgtH: 2, radius_m: 300 }); } catch (e) { msg = e.message; }
  ok(/No elevation at the observer/.test(msg), "no elevation at the observer: refused with a message");
}

/* 8. line of sight along samples (the A-to-B tool and Measure's Profile) agrees with the grid line of sight, and the reverse
   viewshed (heights swapped) agrees with a line of sight run from each observer to the point */
{
  const g = grid(100, 30, (e, nn) => 100 + (e > 1400 && e < 1500 ? 50 : 0) + 15 * Math.sin(nn / 500));
  const a = [g.half, g.half], b = [g.half + 2400 / 30, g.half - 600 / 30];
  const G1 = VS.los(g, a, b, { hA: 2, hB: 1.7 });
  const samples = G1.samples.map((q) => ({ d: q.d, z: q.z }));
  const A1 = VS.losAlong(samples, { hA: 2, hB: 1.7 });
  ok(A1.los === G1.los && A1.blockD === G1.blockD && A1.maxZ === G1.maxZ && A1.dist === G1.dist, "losAlong: same verdict, blocking point and highest ground as the grid line of sight (" + A1.los + ")");
  const flat = [0, 1, 2, 3, 4].map((k) => ({ d: k * 1000, z: 50 }));
  ok(VS.losAlong(flat, { hA: 1.7, hB: 1.7 }).los === "CLEAR", "losAlong: flat ground is CLEAR");
  ok(VS.losAlong(flat.map((q, k) => (k === 2 ? { d: q.d, z: 60 } : q)), { hA: 1.7, hB: 1.7 }).blockD === 2000, "losAlong: a 10 m bump half way blocks at 2 km");
  ok(VS.losAlong(flat.map((q, k) => (k === 2 ? { d: q.d, z: NaN } : q)), { hA: 1.7, hB: 1.7 }).los === "UNKNOWN", "losAlong: a gap in the data is UNKNOWN, not CLEAR");
  ok(VS.losAlong([{ d: 0, z: 0 }, { d: 20000, z: 0 }, { d: 40000, z: 0 }], { hA: 2, hB: 2, curvature: true }).los === "BLOCKED", "losAlong: 40 km over flat sea with curvature, 2 m eyes: the bulge blocks");
  /* reverse: the point P at 1.7 m, observers everywhere at 10 m */
  const r = VS.viewshed(g, { obsH: 1.7, tgtH: 10, radius_m: 2900 });
  let agree = 0, tot = 0;
  for (const [e, nn] of [[1000, 0], [2000, 0], [2500, 300], [-1500, 800], [1800, -1200], [2600, 900], [600, 2400], [1700, 400]]) {
    const i = g.half + Math.round(e / 30), j = g.half - Math.round(nn / 30), c = r.cls[j * g.n + i];
    const l = VS.los(g, [i, j], [g.half, g.half], { hA: 10, hB: 1.7 });
    tot++; if ((c === VS.VIS) === (l.los === "CLEAR")) agree++;
  }
  ok(agree === tot, "reverse viewshed: every sampled cell matches a line of sight from an observer there to the point (" + agree + "/" + tot + ")");
}

/* 9. slope: flat 0, a 10 % ramp 5.7 degrees, a gap NaN */
{
  const g = grid(20, 30, (e) => (e > 0 ? e * 0.1 : 0));
  const sl = VS.slope(g, 1);
  ok(near(sl[idx(g, -300, 0)], 0, 1e-6), "slope: flat ground is 0 degrees");
  ok(near(sl[idx(g, 300, 0)], Math.atan(0.1) * 180 / Math.PI, 0.01), "slope: a 10 % ramp is 5.71 degrees (" + sl[idx(g, 300, 0)].toFixed(2) + ")");
  const h = grid(10, 30, (e) => (e === 60 ? NaN : 100));
  ok(Number.isNaN(VS.slope(h, 1)[idx(h, 30, 0)]), "slope: next to a gap in the data it is unknown (NaN)");
}

console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
