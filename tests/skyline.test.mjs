// Skyline match (assets/osap-skyline.js): the traced skyline to angles, the terrain skyline from a spot, the facing direction
// and fit, the search grid, the best distinct spots and the plain-words reading. A made-up terrain of hills: a skyline traced
// from a known spot is found again at that spot, facing the right way. Run: node tests/skyline.test.mjs
import { createRequire } from "node:module";
const T = createRequire(import.meta.url)("../assets/osap-skyline.js");
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const RAD = Math.PI / 180;

// photo profile: a level line through the middle is 0 degrees all across; edges are ±fov/2
const flat = T.photoProfile([[0, 0.5], [0.5, 0.5], [1, 0.5]], 0.75, 60);
ok(flat && flat.a0 === 0 && flat.n === 61 && flat.vals.every((v) => Math.abs(v) < 1e-9), "a level line through the middle: 0° across all 60°");
const up = T.photoProfile([[0.5, 0], [0.2, 0.25], [0.8, 0.25]], 1, 90);
ok(up && Math.abs(up.vals[Math.round(45 - up.a0)] - 45) < 0.6, "the top middle of a square 90° photo is 45° up: " + (up && up.vals[Math.round(45 - up.a0)]).toFixed(2));
ok(T.photoProfile([[0, 0.5], [0.5, 0.5]], 0.75, 60) === null && T.photoProfile([[0.5, 0.5], [0.51, 0.4], [0.52, 0.5]], 0.75, 60) === null && T.photoProfile([[0, 0], [1, 1], [0.5, 0.5]], 0.75, 0) === null, "too few taps, too narrow, or a broken field of view: no profile");
ok(T.photoProfile([[1, 0.4], [0, 0.5], [0.5, 0.45]], 0.75, 60).vals[0] > T.photoProfile([[1, 0.4], [0, 0.5], [0.5, 0.45]], 0.75, 60).vals[60] - 10, "taps in any order are sorted left to right");

// made-up terrain: three hills
const HILLS = [[45.03, 7.05, 1400, 0.012], [44.98, 7.08, 900, 0.008], [45.06, 6.96, 1800, 0.02], [44.95, 6.94, 1100, 0.01]];
const elev = (la, lo) => 200 + HILLS.reduce((s, h) => s + h[2] * Math.exp(-(((la - h[0]) ** 2 + ((lo - h[1]) * Math.cos(45 * RAD)) ** 2) / (2 * h[3] ** 2))), 0);
const cam = [45.0, 7.0], heading = 40, fov = 66, aspect = 0.75, tilt = 1.5;
const sky = T.horizon(elev, cam[0], cam[1], 1.7, 25);
ok(sky && sky.length === 360 && sky[40] > sky[220], "terrain skyline all the way round; higher towards the hills: " + sky[40].toFixed(2) + "° vs " + sky[220].toFixed(2) + "°");
ok(T.horizon(() => NaN, 45, 7, 1.7, 25) === null, "no ground height at the spot: no skyline");
const flatSky = T.horizon(() => 0, 0, 0, 1.7, 25);
ok(flatSky.every((v) => v < 0 && v > -1), "flat sea-level ground: the skyline is just below level (earth's curve): " + flatSky[0].toFixed(3));
// trace the photo from the true spot
const f = 0.5 / Math.tan(fov / 2 * RAD), pts = [];
for (let k = 0; k <= fov; k += 3) {
  const az = heading - fov / 2 + k, e = sky[((Math.round(az) % 360) + 360) % 360] + tilt, x = Math.tan((k - fov / 2) * RAD) * f;
  pts.push([0.5 + x, 0.5 - Math.tan(e * RAD) * Math.sqrt(f * f + x * x) / aspect]);
}
const prof = T.photoProfile(pts, aspect, fov);
const m0 = T.match(prof, sky, fov);
ok(m0.heading === heading && m0.rms < 0.05 && Math.abs(m0.tilt - tilt) < 0.1, "at the true spot: facing " + m0.heading + "°, fit " + m0.rms.toFixed(3) + "°, tilt " + m0.tilt.toFixed(2) + "°");
// search a 6 km square round the spot
const bb = T.bboxAround(45.005, 7.008, 6), spots = T.grid(bb, 300);
ok(spots.length > 300 && spots.length < 500 && spots.every((s) => s[0] > bb[1] && s[0] < bb[3] && s[1] > bb[0] && s[1] < bb[2]), "search grid: about 400 spots, all inside the box (" + spots.length + ")");
const res = spots.map((ll) => { const s = T.horizon(elev, ll[0], ll[1], 1.7, 25), m = T.match(prof, s, fov); return { ll, rms: m.rms, heading: m.heading }; });
const top = T.distinct(res, 1.5, 5);
ok(top.length >= 3 && top.every((t, i) => i === 0 || T.km(t.ll, top[i - 1].ll) >= 1.5 || top.slice(0, i).every((o) => T.km(o.ll, t.ll) >= 1.5)) && top.every((t, i) => i === 0 || t.rms >= top[i - 1].rms), "best spots at least 1.5 km apart, best first");
ok(T.km(top[0].ll, cam) < 0.4 && Math.abs(top[0].heading - heading) <= 4, "the best spot is the true spot (" + T.km(top[0].ll, cam).toFixed(2) + " km off, facing " + top[0].heading + "°)");
const v = T.verdict(prof, top);
ok(v.k === "clear" || v.k === "several", "reading: " + v.k + " · " + v.text);
ok(T.verdict(T.photoProfile([[0, 0.5], [0.5, 0.501], [1, 0.5]], 0.75, 60), top).k === "flat", "a nearly flat traced skyline is too flat to match");
ok(T.verdict(prof, [{ ll: [0, 0], rms: 3 }]).k === "poor" && T.verdict(prof, [{ ll: [0, 0], rms: 0.3 }, { ll: [0, 1], rms: 0.35 }]).k === "several" && T.verdict(prof, [{ ll: [0, 0], rms: 0.3 }, { ll: [0, 1], rms: 0.9 }]).k === "clear" && T.verdict(prof, []).k === "none", "readings: poor, several, clear, none");
ok(T.verdict(prof, [{ ll: [0, 0], rms: 0.05 }, { ll: [0, 1], rms: 0.17 }]).k === "several", "a tiny best fit is not 'clear' unless the next spot is worse by more than tracing error (0.3°)");
ok(!/confirm(ed|s)? the|is the place|proves/i.test([v.text, T.verdict(prof, [{ ll: [0, 0], rms: 0.3 }, { ll: [0, 1], rms: 0.9 }]).text].join(" ")), "readings never claim certainty");
ok(T.RULES === "skyline-v1", "rules version named");
console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
