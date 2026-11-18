// Military flight patterns and emergency squawks (tools/milpat_lib.mjs, rules milpat-v1). Run from the repo root: node tests/milpat.test.mjs
import { RULES, orbitOf, roleOf, emergencies, EMERG } from "../tools/milpat_lib.mjs";

let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const T0 = Date.parse("2026-11-18T00:00:00Z"), MIN = 60e3;
// a circle of radius r km around (la, lo), n points every `step` minutes, `laps` laps
function circle(la, lo, r, n, step, laps, dir = 1) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = dir * (i / n) * laps * 2 * Math.PI; out.push([la + (r / 111.2) * Math.cos(a), lo + (r / (111.2 * Math.cos(la * Math.PI / 180))) * Math.sin(a), T0 + i * step * MIN]); }
  return out;
}
const line = (n, step) => Array.from({ length: n }, (_, i) => [30, 50 + i * 0.1, T0 + i * step * MIN]);
const AIR = { gs: 300, alt: 30000 };

ok(RULES === "milpat-v1", "rules milpat-v1");
let o = orbitOf(circle(34.2, -95.4, 20, 28, 2, 2), AIR);
ok(o && o.k === "orbit" && o.turn > 600 && o.min === 54 && o.km <= 21, "two laps of a 20 km circle in 54 min is an orbit: " + JSON.stringify(o));
o = orbitOf(circle(34.2, -95.4, 20, 28, 2, 2, -1), AIR);
ok(o && o.turn < -600, "anticlockwise turns are negative");
ok(orbitOf(line(28, 2), AIR) === null, "a straight transit is not an orbit");
// zig-zag: alternate turns cancel
const zig = Array.from({ length: 20 }, (_, i) => [30 + (i % 2) * 0.05, 50 + i * 0.05, T0 + i * 2 * MIN]);
ok(orbitOf(zig, AIR) === null, "a zig-zag (turns cancel) is not an orbit");
ok(orbitOf(circle(34.2, -95.4, 20, 28, 2, 2), { gs: 80, alt: 2000 }) === null, "under 120 kt (a hovering helicopter) is not flagged");
ok(orbitOf(circle(34.2, -95.4, 20, 28, 2, 2), { gs: 300, alt: "ground" }) === null, "an aircraft on the ground is not flagged");
ok(orbitOf(circle(34.2, -95.4, 20, 5, 2, 1), AIR) === null, "five positions are too few");
ok(orbitOf(circle(34.2, -95.4, 20, 7, 1, 1), AIR) === null, "under 15 minutes spanned is too short");
ok(orbitOf(circle(34.2, -95.4, 150, 28, 2, 1), AIR) === null, "a 150 km wide loop is not over one area");
// position jitter: tiny movements around one point do not add up to turns
const jitter = Array.from({ length: 30 }, (_, i) => [34.2 + (i % 3) * 0.001, -95.4 + (i % 2) * 0.001, T0 + i * MIN]);
ok(orbitOf(jitter, AIR) === null, "position jitter under 1 km is not read as turning");
ok(orbitOf(null, AIR) === null && orbitOf([[1, 2]], AIR) === null && orbitOf([["x", 2, 3]], AIR) === null, "bad trails are refused, not thrown on");
ok(/reconnaissance/.test(roleOf("R135")) && /tanker/.test(roleOf("KC46")) && /trainer/.test(roleOf("pc21")) && roleOf("C17") === "" && roleOf(null) === "", "type roles: RC-135, KC-46, PC-21; none for C-17 or no type");
const em = emergencies([{ sqk: "7700", lat: 1, lon: 2, alt: 3000 }, { sqk: "7500", lat: 1, lon: 2, alt: "ground" }, { sqk: "1200", lat: 1, lon: 2 }, { sqk: "7600", lat: NaN, lon: 2 }]);
ok(em.length === 1 && em[0].emerg === EMERG["7700"], "emergency squawks: airborne 7700 kept; ground, ordinary codes and no position left out");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
