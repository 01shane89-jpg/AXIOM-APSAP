// Planes in Sentinel-2 passes, detector rules s2planes-v1 (assets/osap-planes-lib.js). Real 96 x 96 px cut-outs of the four
// 10 m bands (B02, B08, B03, B04; tests/fixtures/satplanes, contains modified Copernicus Sentinel data 2026) with a plane each
// (Dubai sea and city, New York shore, the Channel) must give one find; two town cut-outs that a looser rule set flagged must
// give none. Synthetic scenes check the geometry: speed and line from the band spacing, the 180-degree ambiguity, the
// contrail cue, parallax, still objects and the UTM inverse. Run: node tests/satplanes.test.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const L = createRequire(import.meta.url)("../assets/osap-planes-lib.js");
let fails = 0;
function ok(c, m, x) { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x))); if (!c) fails++; }

// ---- real cut-outs ----
const IX = JSON.parse(readFileSync("tests/fixtures/satplanes/index.json", "utf8"));
for (const s of IX) {
  const buf = readFileSync(`tests/fixtures/satplanes/${s.name}.u16`), n = s.w * s.h;
  const all = new Uint16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
  const B = [0, 1, 2, 3].map((k) => all.subarray(k * n, (k + 1) * n));
  const r = L.detect({ b02: B[0], b08: B[1], b03: B[2], b04: B[3], w: s.w, h: s.h, off: s.off });
  ok(r.rules === "s2planes-v1" && r.found.length === s.planes, `${s.name} (${s.scene}): ${s.planes} find(s)`, r.found);
  for (const f of r.found) {
    const o = L.readOut(f, { trackDeg: 192 });
    ok(f.rms <= 0.6 && o.app >= 40 && o.app <= 480, `${s.name}: fits the band timing and an aircraft's apparent speed`, { rms: f.rms, app: o.app });
  }
}

// ---- synthetic scenes ----
function scene(w, h, objs, opts = {}) {
  const B = [0, 1, 2, 3].map(() => new Uint16Array(w * h));
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const b of B) for (let i = 0; i < w * h; i++) b[i] = 1000 + 300 + Math.round((rnd() - 0.5) * 40);   // dark sea, 3 % reflectance
  const put = (b, x, y, v) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = Math.round(x) + dx, Y = Math.round(y) + dy; if (X >= 0 && Y >= 0 && X < w && Y < h) b[Y * w + X] = 1000 + 300 + Math.round(v * (dx || dy ? 0.45 : 1)); } };
  for (const o of objs) {
    if (o.still) { for (const b of B) put(b, o.x, o.y, o.v); continue; }
    if (o.trail) for (let t = 6; t < 70; t++) for (const b of B) { const X = Math.round(o.x - o.trail[0] * t), Y = Math.round(o.y - o.trail[1] * t); if (X >= 0 && Y >= 0 && X < w && Y < h) b[Y * w + X] = 1000 + 300 + 500; }
    // band m sees the object at x0 + v * t_m (o.rev: the reversed detector strip, red first)
    for (let m = 0; m < 4; m++) { const t = o.rev ? L.DT[3] - L.DT[m] : L.DT[m]; put(B[m], o.x + o.vx * t, o.y + o.vy * t, o.v); }
  }
  return { b02: B[0], b08: B[1], b03: B[2], b04: B[3], w, h, off: 1000 };
}
// 250 m/s due east (25 px/s), normal order; plus a still bright roof and a second plane going south
let r = L.detect(scene(200, 200, [{ x: 40, y: 50, vx: 25, vy: 0, v: 3000 }, { still: true, x: 150, y: 150, v: 3000 }, { x: 120, y: 60, vx: 0, vy: 18, v: 2500 }]));
ok(r.found.length === 2, "two moving planes found, the still roof not", r.found);
const east = r.found.find((f) => Math.abs(f.d[1]) < 1), south = r.found.find((f) => Math.abs(f.d[0]) < 1);
ok(east && Math.abs(east.d[0] - 25 * 1.005) < 0.8, "blue-to-red displacement = speed x 1.005 s", east);
const oE = L.readOut(east, { trackDeg: 192 });
ok(Math.abs(oE.app - 250) < 10 && oE.line === 90, "apparent speed 250 m/s, line 090", { app: oE.app, line: oE.line });
ok(oE.readings[0].hdg === 90 && oE.readings[1].hdg === 270, "both readings given: 090 or 270", oE.readings);
ok(oE.pick === -1, "no contrail and both speeds possible: which way is left open", oE.pick);
ok(oE.readings[0].lo <= 250 && oE.readings[0].hi >= 250, "the height range includes the true speed", oE.readings[0]);
const oS = L.readOut(south, { trackDeg: 192 });
ok(oS.line === 180, "line 180 for the plane going south (image y grows southwards)", oS.line);
// reversed strip: same plane, same line, the displacement points the other way
r = L.detect(scene(200, 200, [{ x: 80, y: 50, vx: 25, vy: 0, v: 3000, rev: true }]));
ok(r.found.length === 1 && r.found[0].d[0] < -20, "reversed detector strip: found, displacement reversed", r.found);
// contrail behind a plane flying east on a reversed strip: the trail sits on the +d side, so the reversed reading (east) is picked
r = L.detect(scene(220, 120, [{ x: 140, y: 60, vx: 25, vy: 0, v: 3000, rev: true, trail: [1, 0] }]));
const oc = r.found[0] && L.readOut(r.found[0], { trackDeg: 192 });
ok(r.found.length === 1 && r.found[0].contrail === 1 && oc.pick === 1 && oc.readings[1].hdg === 90 && oc.why === "contrail", "contrail behind it settles the heading (090)", r.found[0] && { c: r.found[0].contrail, oc });
// too slow to be told from a still object (2 px in 1 s) and too fast (60 px): not reported
r = L.detect(scene(240, 120, [{ x: 40, y: 60, vx: 2, vy: 0, v: 3000 }, { x: 120, y: 60, vx: 60, vy: 0, v: 3000 }]));
ok(r.found.length === 0, "under 4 px or over 48 px blue-to-red: not reported", r.found);
// images of very different brightness (a bright and a faint thing that happen to line up): not one object
const sc = scene(200, 120, [{ x: 40, y: 60, vx: 25, vy: 0, v: 3000 }]);
for (let i = 0; i < sc.b04.length; i++) if (sc.b04[i] > 2000) sc.b04[i] = 1000 + 300 + Math.round((sc.b04[i] - 1300) / 6);
ok(L.detect(sc).found.length === 0, "the red image 6 times fainter than the blue: not one object");

// ---- read-out: parallax and the speed cue ----
// 600 m/s apparent along the line: one reading is impossible at any height, the other possible once parallax is taken off
const fast = { d: [0, -60.3], contrail: 0 };     // north, 60 px in 1.005 s
const of = L.readOut(fast, { trackDeg: 180 });   // satellite going south: parallax makes high things seem to move north
ok(of.readings[0].lo > 330 && of.readings[0].plausible === false, "north reading at 600 m/s is beyond any aircraft at any height", of.readings[0]);
ok(of.readings[1].plausible === false, "south reading also implausible at 600 m/s", of.readings[1]);
const mid = L.readOut({ d: [0, -36], contrail: 0 }, { trackDeg: 180 });    // 358 m/s apparent, northward
ok(mid.readings[0].lo < mid.readings[0].hi && Math.abs(mid.readings[0].lo - (358 - 12 * L.K_PARALLAX)) < 2, "northward reading: 0-12 km of height takes up to 114 m/s off", mid.readings[0]);
ok(mid.readings[1].plausible === false && mid.pick === 0 && mid.why === "speed", "southward reading would be 358-472 m/s: the speed cue picks north", mid);
ok(Math.abs(L.K_PARALLAX - 9.466) < 0.01, "parallax 7.44 km/s / 786 km = 9.47 m/s per km of height");
// grid convergence turns the reading
ok(L.readOut({ d: [25, 0], contrail: 0 }, { conv: 2 }).line === 92, "grid convergence added to the line (090 + 2)");

// ---- geometry helpers ----
const near = (a, b, e) => Math.abs(a[0] - b[0]) < e && Math.abs(a[1] - b[1]) < e;
// against PROJ (pyproj 3, EPSG 32640, 32631, 32747)
ok(near(L.utmInv(313600, 2832690, 40, false), [25.59997781120509, 55.143893157806275], 1e-7), "UTM 40N inverse matches PROJ");
ok(near(L.utmInv(351700, 5668610, 31, false), [51.149701510808, 0.8796162001158435], 1e-7), "UTM 31N inverse matches PROJ");
ok(near(L.utmInv(500000, 1000000, 47, true), [-81.06088097499796, 99.0], 1e-7), "UTM 47S inverse matches PROJ");
ok(Math.abs(L.trackAt(0) - 192) < 1 && L.trackAt(60) > L.trackAt(0) && L.trackAt(-60) > L.trackAt(0), "Sentinel-2 daytime ground track about 192 at the equator, more westerly toward the poles", [L.trackAt(0), L.trackAt(60)]);

console.log(fails ? `${fails} FAILED` : "ALL PASS");
process.exit(fails ? 1 : 0);
