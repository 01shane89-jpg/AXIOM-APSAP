// Every world country's view box (data/basemap/world-countries.js "bounds") must hold its own land: no island or exclave of
// a country's 1:10m outline bigger than about 0.05 square degrees may lie outside it. Equatorial Guinea's box left out Bioko,
// so the capital Malabo was off the map when the country opened (audit 2026-11-14). Far overseas territories and lands across
// the 180th meridian are listed in FAR and skipped on purpose, since taking them in would zoom the view out to half the world.
// Run from the repo root: node tests/country_bounds.test.mjs
import { readFileSync, readdirSync } from "node:fs";
const w = {}; new Function("window", readFileSync("data/basemap/world-countries.js", "utf8"))(w);
for (const f of readdirSync("data/basemap/outline-10m")) new Function("window", readFileSync("data/basemap/outline-10m/" + f, "utf8"))(w);
const O = w.OSAP_OUTLINE10;
// overseas departments and territories (fr, nl, pt, es Canaries, no Svalbard), Galápagos (ec), and lands across the
// antimeridian or very far out (us, ru, fj, ki, sb, ye Socotra)
const FAR = new Set(["fr", "nl", "pt", "es", "no", "ec", "us", "ru", "fj", "ki", "sb", "ye"]);
let fails = 0, checked = 0;
for (const c of w.ASAP_WORLD) {
  const o = O[c.ne] || O[c.name]; if (!o || FAR.has(c.id)) continue;
  checked++;
  const [[s, we], [n, e]] = c.bounds;
  for (const r of o.l) {
    let x = 0, y = 0, mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
    for (let i = 0; i < r.length; i += 2) { x += r[i]; y += r[i + 1]; const X = x / o.s, Y = y / o.s; mnx = Math.min(mnx, X); mxx = Math.max(mxx, X); mny = Math.min(mny, Y); mxy = Math.max(mxy, Y); }
    const cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2, size = (mxx - mnx) * (mxy - mny);
    const lonIn = we <= e ? cx >= we - 0.3 && cx <= e + 0.3 : cx >= we - 0.3 || cx <= e + 0.3;
    if (size > 0.05 && !(lonIn && cy >= s - 0.3 && cy <= n + 0.3)) { fails++; console.log(`FAIL ${c.id} ${c.name}: land at ${cy.toFixed(2)},${cx.toFixed(2)} (${size.toFixed(2)} sq deg) is outside ${JSON.stringify(c.bounds)}`); }
  }
}
if (checked < 150) { console.log("FAIL only " + checked + " countries checked"); fails++; }
if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("country bounds hold their land: " + checked + " countries");
