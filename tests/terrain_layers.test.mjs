// Pure checks of the terrain layers' sums (assets/osap-terrainlayers.js): slope bands, aspect directions, elevation colours,
// contour segments, ridges and valleys, low ground, and that a gap in the data stays a gap.
// Run from the repo root: node tests/terrain_layers.test.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
const ctx = { window: {}, document: {}, Math, Float32Array, Float64Array, Uint8ClampedArray, Promise, String, JSON, Object, isFinite, Infinity, NaN };
ctx.window = ctx;
vm.runInNewContext(readFileSync("assets/osap-terrainlayers.js", "utf8"), ctx);
const A = ctx.OSAP_TERRAIN_LAYERS, t = A._t, N = t.N, M = t.M, T = t.T;
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
function grid(f) { const h = new Float32Array(N * N); for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) h[j * N + i] = f(i, j); return h; }
const px = (out, i, j) => Array.from(out.slice((j * T + i) * 4, (j * T + i) * 4 + 4));

ok(A.LIST.map((l) => l.id).join() === "slope,aspect,contour,tint,tpi,low", "six terrain layers listed in order");
// slope: rises 10 m per 10 m cell to the east = 45 degrees -> over 30 band (red); 1 m per 10 m = 5.7 deg -> 3-7 band
let out = t.paint("slope", grid((i) => i * 10), 10, {});
ok(px(out, 128, 128).slice(0, 3).join() === "198,40,40", "45 degree ground is in the 'over 30' band");
out = t.paint("slope", grid((i) => i * 1), 10, {});
ok(px(out, 128, 128).slice(0, 3).join() === "156,204,101", "5.7 degree ground is in the 3-7 band");
out = t.paint("slope", grid(() => 100), 10, {});
ok(px(out, 128, 128)[3] === 0, "flat ground is left clear");
ok(t.slopeBand(2.9) === 0 && t.slopeBand(3) === 1 && t.slopeBand(7) === 2 && t.slopeBand(15) === 3 && t.slopeBand(30) === 4, "band edges match Terrain analysis (3, 7, 15, 30)");
// aspect: ground rising to the east faces west; rising to the south (j grows) faces north
ok(t.ASPECT[t.aspectIdx(t.aspectDeg(1, 0))][0] === "W", "ground rising east faces west");
ok(t.ASPECT[t.aspectIdx(t.aspectDeg(0, 1))][0] === "N", "ground rising south faces north");
ok(t.ASPECT[t.aspectIdx(t.aspectDeg(0, -1))][0] === "S", "ground rising north faces south");
ok(t.ASPECT[t.aspectIdx(t.aspectDeg(-1, 1))][0] === "NE", "ground rising south-west faces north-east");
out = t.paint("aspect", grid((i) => -i * 5), 10, {});
ok(px(out, 100, 100).slice(0, 3).join() === t.ASPECT[2][1].join(), "aspect paints east-facing ground in the E colour");
// elevation colours
ok(t.tint(0) === null && t.tint(-5) === null, "sea level and below have no colour");
ok(t.tint(150).join() === "130,180,90" && t.tint(225).join() === "160,195,100" && t.tint(9000).join() === "255,255,255", "colour ramp stops");
// contours: a plane rising 1 m per cell east over 0..N m with a 50 m step gives vertical lines at 50, 100, ...
const segs = t.contours(grid((i) => i), 50);
const levels = [...new Set(segs.map((s) => s[4]))].sort((a, b) => a - b);
ok(levels.join() === "50,100,150,200,250", "contour levels inside the tile (with its one-cell overlap): " + levels.join());
ok(segs.every((s) => Math.abs(s[0] - s[2]) < 1e-9 && Math.abs(s[0] - (s[4] - M + 0.5)) < 1e-6), "a contour sits exactly where the ground crosses its height");
ok(t.contours(grid(() => 100), 50).length === 0, "no contours on flat ground at a level");
ok(t.contourStep(8) === 250 && t.contourStep(12) === 25 && t.contourStep(14) === 10 && t.contourStep(17) === 5, "contour step follows zoom");
// ridges and valleys: a ridge line down the middle column is red, the troughs beside it blue
const ridge = grid((i) => 100 - Math.abs(i - (M + 128)) * 3);
out = t.paint("tpi", ridge, 10, {});
ok(px(out, 128, 128)[0] === 183 && px(out, 128, 128)[3] > 0, "ridge line reads as higher than around it");
out = t.paint("tpi", grid((i) => Math.abs(i - (M + 128)) * 3), 10, {});
ok(px(out, 128, 128)[2] === 192 && px(out, 128, 128)[3] > 0, "valley floor reads as lower than around it");
ok(px(t.paint("tpi", grid(() => 50), 10, {}), 128, 128)[3] === 0, "even ground has no ridge or valley");
// low ground
const g = grid((i) => i < M + 128 ? 3 : 20);
out = t.paint("low", g, 10, { low: 5 });
ok(px(out, 10, 10)[3] > 0 && px(out, 200, 10)[3] === 0, "ground at 3 m is low at 5 m, 20 m is not");
ok(px(t.paint("low", grid(() => 0), 10, { low: 5 }), 10, 10)[3] === 0, "the sea (0 m) stays clear");
ok(px(t.paint("low", grid(() => -4), 10, { low: 5 }), 10, 10).slice(0, 3).join() === "21,101,192", "below sea level is darker blue");
// gaps
const gap = grid((i) => i * 10); gap[(M + 50) * N + M + 50] = NaN;
out = t.paint("slope", gap, 10, {});
ok(px(out, 50, 50)[3] === 0 && px(out, 51, 50)[3] === 0, "no data stays clear, never flat or steep");
ok(t.contours(gap, 50).every((s) => !(s.some((v) => Number.isNaN(v)))), "contours skip cells with no data");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
