// "What changed here" pixel rules (assets/osap-newimg.js, chg-v1): no change for the same ground under other light, haze or a
// few metres' offset; change where a building appears or goes; a blank picture is "could not compare", never "no change".
// Run from the repo root: node tests/whatchanged.test.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const T = require("../assets/osap-newimg.js");
let fails = 0;
function ok(c, m, x) { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x))); if (!c) fails++; }
const N = T.CH_PX, BS = T.CH_BS;
/* a ground texture: fields, a road grid and small huts, deterministic */
function rnd(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function scene(opts = {}) {
  const r = rnd(7), px = new Uint8ClampedArray(N * N * 4), { gain = 1, bias = 0, dx = 0, dy = 0, add = null, remove = null, blank = false, noise = 0 } = opts, nr = rnd(99);
  const base = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) base[y * N + x] = 90 + 30 * Math.sin(x / 9) * Math.cos(y / 13) + (r() - 0.5) * 12;
  const huts = []; const r2 = rnd(3);
  for (let k = 0; k < 18; k++) huts.push([Math.floor(r2() * (N - 12)), Math.floor(r2() * (N - 12))]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const X = x - dx, Y = y - dy;
    let v = 0;
    if (X >= 0 && Y >= 0 && X < N && Y < N) {
      v = base[Y * N + X];
      if (X % 40 < 3 || Y % 52 < 3) v = 200;
      for (const [hx, hy] of huts) if (X >= hx && X < hx + 7 && Y >= hy && Y < hy + 7 && !(remove && hx === huts[0][0])) v = 230;
      if (add && X >= add[0] && X < add[0] + add[2] && Y >= add[1] && Y < add[1] + add[2]) v = (X + Y) % 6 < 3 ? 250 : 40;
    } else v = base[0];
    v = blank ? 128 : v * gain + bias + (noise ? (nr() - 0.5) * noise : 0);
    const i = (y * N + x) * 4; px[i] = px[i + 1] = px[i + 2] = Math.max(0, Math.min(255, v)); px[i + 3] = 255;
  }
  return T.chCells(T.chGray(px, N, N), N, N, BS);
}
const A = scene();
let d = T.chDiff(A, scene());
ok(d.frac === 0 && T.chLevel(d) === "little", "the same picture: nothing changed", d.frac);
d = T.chDiff(A, scene({ gain: 0.7, bias: 40 }));
ok(d.frac < 0.05 && T.chLevel(d) === "little", "the same ground, darker and hazier (other light or sensor): little change", d.frac);
d = T.chDiff(A, scene({ dx: 4, dy: -3 }));
ok(d.frac < 0.1 && T.chLevel(d) === "little", "the same ground 4 by 3 pixels out of line (about 5 m): little change", d.frac);
d = T.chDiff(A, scene({ noise: 14 }));
ok(d.frac < 0.1, "sensor noise: little change", d.frac);
d = T.chDiff(A, scene({ add: [50, 50, 56] }));
const inBox = d.cells.every((i) => { const x = (i % d.n) * BS, y = Math.floor(i / d.n) * BS; return x >= 50 - BS * 2 && x < 106 + BS && y >= 50 - BS * 2 && y < 106 + BS; });
const outs = d.cells.filter((i) => { const x = (i % d.n) * BS, y = Math.floor(i / d.n) * BS; return !(x >= 50 - BS * 2 && x < 106 + BS && y >= 50 - BS * 2 && y < 106 + BS); }).map((i) => [(i % d.n) * BS, Math.floor(i / d.n) * BS]);
ok(T.chLevel(d) !== "little" && d.frac >= 0.1 && inBox, "a new compound 56 px (about 65 m) square: flagged, and only around it", { frac: d.frac, n: d.cells.length, inBox, outs });
d = T.chDiff(A, scene({ add: [70, 70, 40] }));
ok(d.frac < 0.1 && d.cluster >= 9 && T.chLevel(d) === "some", "a smaller new building (40 px, about 45 m): under a tenth of the square but one group, so Some change", { frac: d.frac, cluster: d.cluster });
d = T.chDiff(A, scene({ add: [10, 10, 130] }));
ok(T.chLevel(d) === "big", "most of the square rebuilt: large change", d.frac);
d = T.chDiff(A, scene({ remove: true }));
ok(d.cells.length >= 1 && d.frac < 0.1, "one hut gone: its cells are flagged (removal is seen too)", { n: d.cells.length, frac: d.frac });
d = T.chDiff(A, scene({ blank: true }));
ok(d.blank && T.chLevel(d) === "none", "a one-colour square (no picture): could not compare, never no change");
ok(T.chDiff(null, A).blank, "missing picture: could not compare");
ok(T.CH_RULES === "chg-v1" && T.CH_Z === 17, "rules named and zoom fixed");
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
