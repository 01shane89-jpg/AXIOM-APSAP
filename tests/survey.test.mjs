// Site survey geometry (assets/osap-survey.js): the site's own frame, the approach and departure ends and corners, inside tests,
// the gradient from two heights, the approach / departure corridor and the n:1 clearance check, and the geometry clean-up.
// Run: node tests/survey.test.mjs
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const C = req("../assets/osap-survey.js");
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const near = (a, b, t) => Math.abs(a - b) <= t;

// a 1000 x 30 m strip landing east (090), centred near Lop Buri
const g = { c: [14.8, 100.69], axis: 90, shape: "rect", len_m: 1000, wid_m: 30 };
const e = C.ends(g);
ok(near(C.local(g.c, e.a)[0], -500, 0.5) && near(C.local(g.c, e.a)[1], 0, 0.5), "approach end A is 500 m west of the centre when landing east");
ok(near(C.local(g.c, e.b)[0], 500, 0.5), "departure end B is 500 m east");
ok(near(C.bearing(e.a, e.b), 90, 0.05) && near(C.dist(e.a, e.b), 1000, 1), "A to B is 1000 m on 090");
ok(e.corners.length === 4 && near(C.local(g.c, e.corners[0])[1], 15, 0.3) && near(C.local(g.c, e.corners[1])[1], -15, 0.3), "corners 1 and 2 are the approach end's left (north) and right (south) corners");
const q = C.toUv(g, C.unlocal(g.c, [200, -10]));
ok(near(q[0], 200, 0.3) && near(q[1], 10, 0.3), "a point 200 m east, 10 m south is u 200, v 10 (right of the axis)");
ok(C.inside(g, C.unlocal(g.c, [490, 14])) && !C.inside(g, C.unlocal(g.c, [490, 16])) && C.inside(g, C.unlocal(g.c, [490, 16]), 5), "inside, outside and inside with a margin");
// a circle HLZ
const h = { c: [14.8, 100.69], axis: 45, shape: "circle", len_m: 100, wid_m: 100 };
ok(C.inside(h, C.unlocal(h.c, [30, 30])) && !C.inside(h, C.unlocal(h.c, [40, 40])), "a 100 m circle holds a point 42 m out, not one 57 m out");
ok(C.ends(h).corners.length === 0 && C.outline(h).length === 48, "a circle has no corners and a 48-point outline");
// gradient
ok(near(C.grade(20, 30, 1000), 1, 1e-9) && C.grade(null, 30, 1000) === null && C.grade(1, 2, 0) === null, "gradient 10 m over 1000 m is 1%, unknown heights give none");
// approach and departure corridor, splaying 10 percent each side
const ap = C.zone(g, C.unlocal(g.c, [-800, 30]), 1500, 0.1);
ok(ap && ap.z === "approach" && near(ap.d, 300, 0.5), "a point 300 m before A and 30 m off the axis is on the approach (corridor 15 + 30 m wide there)");
ok(C.zone(g, C.unlocal(g.c, [-800, 60]), 1500, 0.1) === null, "60 m off the axis 300 m out is outside the corridor");
const dp = C.zone(g, C.unlocal(g.c, [1100, 0]), 1500, 0.1);
ok(dp && dp.z === "departure" && near(dp.d, 600, 0.5), "600 m past B is on the departure");
ok(C.zone(g, C.unlocal(g.c, [-2100, 0]), 1500, 0.1) === null, "beyond the corridor length is not checked");
ok(C.zone(g, C.unlocal(g.c, [0, 0]), 1500, 0.1) === null, "the centre is not on a corridor");
// clearance plane
ok(C.penetrates(20, 300, 20) && !C.penetrates(14, 300, 20) && !C.penetrates(null, 10, 20), "a 20 m pole 300 m out breaks 20:1 (15 m allowed), a 14 m one does not");
ok(C.penetrates(20, 150, 10) && !C.penetrates(20, 250, 10), "10:1 at an HLZ: 20 m at 150 m breaks it, at 250 m does not");
// clean-up
const c = C.cleanG({ c: ["14.8000001", 100.69], axis: -90, shape: "x", len_m: 3, wid_m: "40" });
ok(c && c.axis === 270 && c.shape === "rect" && c.len_m === 100 && c.wid_m === 40, "cleanG wraps the axis, defaults a bad shape and length: " + JSON.stringify(c));
ok(C.cleanG({ c: [95, 0] }) === null && C.cleanG(null) === null, "cleanG refuses a bad centre");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
