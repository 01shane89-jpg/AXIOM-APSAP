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
const sea = lift("assets/osap-seatransit.js", "  function aroundSql", "  var OSM_KM", "aroundSql", { wrap: (x) => x });
const comms = lift("assets/osap-comms.js", "  function sqlQuery", "  function post(q, sql)", "sqlQuery");
const W0 = { OSAP_OSM: O };
const med = new Function("W", (() => { const t = readFileSync("assets/osap-medplan.js", "utf8"); return t.slice(t.indexOf("  function ppNear"), t.indexOf("  /* Postpass first (one try")); })() + "; return { oSql, xSql, pSql };")(W0);
const epe = new Function("W", "wrap", (() => { const t = readFileSync("assets/osap-epe.js", "utf8"); return t.slice(t.indexOf("  function sqlNear"), t.indexOf("  function osmCls")) + t.slice(t.indexOf("  function depSql"), t.indexOf("  function depKind")) + t.slice(t.indexOf("  function susSql"), t.indexOf("  /* fuel and supplies within 1 km")); })() + "; return { ovSql, circSql, depSql, susSql };")(W0, (x) => x);
const rte = new Function("W", (() => { const t = readFileSync("assets/osap-route.js", "utf8"); return t.slice(t.indexOf("  function sqlPts"), t.indexOf("  function afKind")); })() + "; return { sqlPts };")(W0);
const road = [[13.75, 100.50], [13.9, 100.6], [14.1, 100.65], [14.35, 100.6], [14.6, 100.55], [14.9, 100.4]];
const line = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => ({ lat: a[0] + (b[0] - a[0]) * i / n, lon: a[1] + (b[1] - a[1]) * i / n }));
const cases = [
  ["med plan Bangkok 50/20/30 km", med.oSql([13.75, 100.5], 50000, 20000, 30000)],
  ["med plan extras Bangkok", med.xSql([13.75, 100.5])],
  ["med plan US posts Bangkok 1500 km", med.pSql([13.75, 100.5])],
  ["med plan Louisiana 50/20/30 km", med.oSql([30.45, -91.15], 50000, 20000, 30000)],
  ["evac airfields 25 km corridor", epe.ovSql(road, 25000)],
  ["evac circle 60 km", epe.circSql({ lat: 13.75, lon: 100.5, km: 60 })],
  ["evac route dependencies", epe.depSql(road)],
  ["evac sustainment", epe.susSql(road)],
  ["route airfields 50 km", rte.sqlPts("tags->>'aeroway' IN ('aerodrome','airstrip','heliport') OR tags->>'military' = 'airfield'", [[13.75, 100.5]], 50000, 2000)],
  ["sea transit Phuket-Singapore 300 km", sea(line([7.8, 98.3], [1.3, 103.8], 20), 300, "tags->>'healthcare' = 'hyperbaric_chamber' OR tags->>'healthcare:speciality' ~* '(hyperbaric|burn)' OR tags->>'emergency' = 'air_rescue_service'")],
  ["comms 1 degree Bangkok", comms(13.5, 100.25, 14.5, 101.25)],
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
