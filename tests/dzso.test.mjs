// DZSO sheet maths (assets/osap-dzso.js): DZ frame and outline, inside tests, nearest distance, the D = KAV drift, the mean
// wind to the drop altitude, the personnel DZ length rule, the hour check against limits and the shared drop zone store
// (assets/osap-dz.js). Run: node tests/dzso.test.mjs
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const C = req("../assets/osap-dzso.js");
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const near = (a, b, t) => Math.abs(a - b) <= t;

// a 1000 x 550 m DZ heading 090 (east) with the PI 274 m from the leading edge, near Lop Buri
const dz = { pi: [15.0, 100.6], axis: 90, shape: "rect", len_m: 1000, wid_m: 550, pi_lead_m: 274 };
const lead = C.fromUv(dz, 0, 0), trail = C.fromUv(dz, 1000, 0);
ok(near(C.local(dz.pi, lead)[0], -274, 0.5) && near(C.local(dz.pi, lead)[1], 0, 0.5), "leading edge is 274 m west of the PI on an east run-in");
ok(near(C.local(dz.pi, trail)[0], 726, 0.5), "trailing edge is 726 m east of the PI");
const uv = C.uv(dz, C.unlocal(dz.pi, [100, -200]));
ok(near(uv[0], 374, 0.5) && near(uv[1], 200, 0.5), "a point 100 m E and 200 m S is u 374, v 200 (right of an east axis): " + uv.map((x) => x.toFixed(1)));
ok(C.inside(dz, C.unlocal(dz.pi, [700, 270])), "a point near the far corner is inside");
ok(!C.inside(dz, C.unlocal(dz.pi, [700, 290])), "20 m past the side is outside");
ok(C.inside(dz, C.unlocal(dz.pi, [700, 290]), 50), "but inside the 50 m margin");
ok(!C.inside(dz, C.unlocal(dz.pi, [-300, 0])), "26 m before the leading edge is outside");
const ol = C.outline(dz);
ok(ol.length === 4, "a rectangle has four corners");
const circ = Object.assign({}, dz, { shape: "circle", len_m: 600 });
ok(C.inside(circ, C.unlocal(dz.pi, [0, 290])) && !C.inside(circ, C.unlocal(dz.pi, [0, 310])), "a 600 m circle holds 290 m out, not 310 m");
ok(C.outline(circ).length === 48, "a circle outline has 48 points");
// axis 000: u runs north
const north = Object.assign({}, dz, { axis: 0 });
ok(near(C.uv(north, C.unlocal(dz.pi, [0, 100]))[0], 374, 0.5), "on a north run-in, 100 m north of the PI is u 374");

// nearest distance to a line and a ring
const line = [C.unlocal(dz.pi, [-500, 300]), C.unlocal(dz.pi, [500, 300])];
const n1 = C.nearest(dz.pi, line);
ok(near(n1.m, 300, 1), "a power line 300 m north is 300 m away: " + n1.m.toFixed(1));
ok(near(C.bearing(dz.pi, n1.p), 0, 0.5), "and due north of the PI");
ok(C.touches(dz, line, false) === false, "a line 300 m north does not touch the DZ");
ok(C.touches(dz, [C.unlocal(dz.pi, [-500, 100]), C.unlocal(dz.pi, [500, 100])], false), "a line 100 m north crosses the DZ");
ok(C.touches(dz, [C.unlocal(dz.pi, [-2000, -2000]), C.unlocal(dz.pi, [2000, -2000]), C.unlocal(dz.pi, [2000, 2000]), C.unlocal(dz.pi, [-2000, 2000])], true), "a lake round the whole DZ touches it");
ok(C.inRing(dz.pi, [C.unlocal(dz.pi, [-10, -10]), C.unlocal(dz.pi, [10, -10]), C.unlocal(dz.pi, [10, 10]), C.unlocal(dz.pi, [-10, 10])]), "inRing finds the PI inside a small square");
ok(C.compass(0) === "N" && C.compass(225) === "SW" && C.compass(359) === "N", "compass points");

// D = KAV: K 3.0, 1250 ft, 10 kt -> 375 m
ok(C.drift(3, 1250, 10) === 375, "D = KAV: 3.0 x 12.5 x 10 kt = 375 m");
ok(C.drift(0, 1250, 10) === null, "no drift with K = 0 (ram-air)");
// the planning DZ length: 600 yd + 75 yd per extra jumper
ok(near(C.minLen(1, 75), 548.64, 0.01) && near(C.minLen(20, 75), (600 + 19 * 75) * 0.9144, 0.01), "length rule: 1 jumper 600 yd, 20 jumpers 2025 yd");

// mean wind
const same = C.meanWind([{ h: 10, kt: 10, dir: 270 }, { h: 300, kt: 10, dir: 270 }], 381);
ok(same && near(same.kt, 10, 1e-6) && near(same.dir, 270, 1e-6), "a steady 270/10 to 381 m means 270/10: " + JSON.stringify(same));
const shear = C.meanWind([{ h: 10, kt: 0, dir: 0 }, { h: 110, kt: 20, dir: 90 }], 110);
ok(shear && near(shear.kt, 1000 / 110, 0.01) && near(shear.dir, 90, 0.5), "0 kt up to 10 m, then rising to 20 kt at 110 m from 090, means 090/9.1: " + JSON.stringify(shear));
const above = C.meanWind([{ h: 10, kt: 10, dir: 180 }, { h: 1000, kt: 30, dir: 180 }], 100);
ok(above && above.kt < 13 && near(above.dir, 180, 0.5), "levels above the drop altitude only count up to it: " + above.kt.toFixed(2));
ok(C.meanWind([], 300) === null && C.meanWind([{ h: 10, kt: 5, dir: 0 }], 0) === null, "no levels or no altitude gives nothing");
const opp = C.meanWind([{ h: 10, kt: 10, dir: 0 }, { h: 20, kt: 10, dir: 180 }], 20);
ok(opp && opp.kt < 6, "opposite winds cancel in a vector mean: " + opp.kt.toFixed(2));

// cloud base estimate
ok(C.cloudBaseFt(30, 25) === 2000 && C.cloudBaseFt(20, 22) === 0 && C.cloudBaseFt(NaN, 1) === null, "cloud base about 400 ft per degree of spread");

// hour verdicts
const Lm = { wind: 13, gust: 13, vis: 5, alt: 1250, pad: 500 };
ok(C.verdict({ kt: 8, gust: 10, vis: 20000, low: 10, base: 3000, code: 1 }, Lm).state === "ok", "8 kt, gusts 10: within limits");
ok(C.verdict({ kt: 12, gust: 12, vis: 20000, code: 1 }, Lm).state === "check", "12 kt against 13: check");
const v1 = C.verdict({ kt: 9, gust: 16, vis: 20000, code: 1 }, Lm);
ok(v1.state === "out" && /Gusts 16/.test(v1.why[0]), "gusts 16 against 13: outside limits: " + v1.why);
ok(C.verdict({ kt: 5, gust: 6, vis: 3000, code: 1 }, Lm).state === "out", "3 km visibility under 5: outside limits");
ok(C.verdict({ kt: 5, gust: 6, vis: 20000, code: 95 }, Lm).state === "out", "thunderstorm: outside limits");
ok(C.verdict({ kt: 5, gust: 6, vis: 20000, code: 3, low: 80, base: 1200 }, Lm).state === "check", "broken low cloud with a 1200 ft base under 1750 ft: check");
ok(C.verdict({ kt: NaN, gust: NaN }, { wind: 13, gust: 13 }).state === "ok", "missing values do not fail the check");
ok(C.lightAt(10) === "Day" && C.lightAt(-3) === "Civil twilight" && C.lightAt(-9) === "Nautical twilight" && C.lightAt(-15) === "Dark", "light bands from the sun's height");

// the shared store (assets/osap-dz.js) in a fake browser
{
  const mem = {};
  globalThis.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  globalThis.window = globalThis; const evs = []; globalThis.addEventListener = (t, f) => evs.push(f);
  req("../assets/osap-dz.js");
  const S = globalThis.OSAP_DZ; let heard = 0; S.on(() => heard++);
  const a = S.save({ name: "Tadia DZ", cc: "th", pi: [15.123456789, 100.1], axis: 400, len_m: 1500, wid_m: 600, alt_ft: 1250, tot: "2026-11-02T22:30:00Z", fields: { dzso: "Cpt A", "bad key!": "x", c_walk: true } });
  ok(a && /^dz[a-z0-9]+$/.test(a.id) && a.pi[0] === 15.123457 && a.axis === 40, "save cleans the point and gives an id");
  ok(a.fields.dzso === "Cpt A" && !("bad key!" in a.fields) && a.fields.c_walk === true, "only well-formed field keys are kept");
  ok(S.list().length === 1 && S.get(a.id).name === "Tadia DZ" && heard === 1, "list, get and the change callback");
  ok(S.list("th").length === 1 && S.list("ph").length === 0, "list filters by country");
  ok(S.save({ name: "bad", pi: [95, 0] }) === null, "a point off the globe is refused");
  ok(S.clean({ pi: [1, 2], tot: "tomorrow" }).tot === "", "a drop time that is not ISO Zulu is dropped");
  ok(S.clean({ pi: [1, 2], elev_m: null }).elev_m === null && S.clean({ pi: [1, 2], elev_m: 0 }).elev_m === 0, "an unknown elevation stays unknown (not 0 m), a real 0 m stays");
  ok(Array.isArray(S.aircraft) && S.aircraft.some((a) => a.name === "C-130J Super Hercules") && S.aircraft.every((a) => a.name.length <= 40), "the shared aircraft list fits the 40-character acft field");
  mem["osap-dz"] = "not json"; ok(S.list().length === 0, "a broken store reads as empty, never throws");
  mem["osap-dz"] = JSON.stringify([{ pi: [1, 2] }, null, { pi: "x" }]); ok(S.list().length === 1, "bad rows in the store are skipped");
  const b = S.save({ name: "Tadia DZ", pi: [15.1, 100.1], fields: { dzso: "Cpt B", g2a: "34.55" } });
  const b2 = S.save({ id: b.id, name: "Tadia DZ", pi: [15.1, 100.1], axis: 75, tot: "2026-11-02T22:30:00Z", alt_ft: 1000 });
  ok(b2.fields.dzso === "Cpt B" && b2.fields.g2a === "34.55" && b2.axis === 75 && b2.alt_ft === 1000 && b2.pi_lead_m === b.pi_lead_m, "a save without fields (the flight planner's) keeps the DZSO's fields");
  ok(S.save({ id: b.id, pi: [15.1, 100.1], fields: { g2a: "40.00" } }).fields.dzso === "Cpt B", "a save with some fields merges them");
  S.remove(b.id);
  S.remove(S.list()[0].id); ok(S.list().length === 0, "remove");
}
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
