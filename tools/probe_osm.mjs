// Test only: sends the app's own Postpass SQL (lifted from the modules that read OpenStreetMap through assets/osap-osm.js) to
// Geofabrik's Postpass for a few real places, turns the answer into elements with OSAP_OSM.elements, and prints status, time,
// size and element counts. Writes nothing to the repo. Run from the repo root: node tools/probe_osm.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
const win = {};
vm.runInNewContext(readFileSync("assets/osap-osm.js", "utf8"), { window: win, AbortController, setTimeout, clearTimeout, Date, JSON, Error, Promise, encodeURIComponent, fetch });
const O = win.OSAP_OSM;
const lift = (file, from, to, ret, args = {}) => {
  const s = readFileSync(file, "utf8"), body = s.slice(s.indexOf(from), s.indexOf(to));
  return new Function("W", ...Object.keys(args), body + "; return " + ret + ";")({ OSAP_OSM: O }, ...Object.values(args));
};
const B = (s, w, n, e) => ({ getSouth: () => s, getWest: () => w, getNorth: () => n, getEast: () => e });
const power = lift("assets/osap-power.js", "  var HVRE", "  var busy = null", "ppQuery", { ALLZ: 11, MINZ: 13 });
const surveil = lift("assets/osap-surveil.js", "  function ppQuery", "  var busy = null", "ppQuery", { MAX: 6000 });
const lz = lift("assets/osap-lz.js", "  var LANDUSE", "  function overpass(b)", "sqlQuery");
const cases = [
  ["power z8 Bangkok", power(B(11.4, 99.5, 15.9, 101.7), 8, { lines: true, subs: true })],
  ["power z13 Chiang Mai", power(B(18.76, 98.95, 18.82, 99.02), 13, { lines: true, subs: true })],
  ["surveil z16 Bangkok Silom", surveil(B(13.72, 100.52, 13.735, 100.54))],
  ["surveil z16 London", surveil(B(51.505, -0.14, 51.515, -0.12))],
  ["LZ 2 km rural Thailand", lz([12.55, 99.40, 12.59, 99.44])],
  ["LZ 2 km Bangkok", lz([13.73, 100.50, 13.77, 100.54])],
  ["LZ 3 km Chiang Mai forest edge", lz([18.78, 98.88, 18.84, 98.94])],
];
for (const [name, sql] of cases) {
  const t0 = Date.now();
  try {
    const r = await fetch(O.POSTPASS, { method: "POST", body: "data=" + encodeURIComponent(sql), headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://axiom-osap.netlify.app" } });
    const txt = await r.text(); let st;
    try { const els = O.elements(JSON.parse(txt)); const c = {}; els.forEach((e) => { c[e.type] = (c[e.type] || 0) + 1; }); st = JSON.stringify(c); } catch (e) { st = "not usable: " + txt.slice(0, 240).replace(/\s+/g, " "); }
    console.log(name, "|", r.status, (txt.length / 1024).toFixed(0) + " KB", (Date.now() - t0) + " ms", "|", st);
  } catch (e) { console.log(name, "| failed", e.message, (Date.now() - t0) + " ms"); }
}
