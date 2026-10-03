// Test only: for buildings in the Overture data with no name, use or floors, how often OpenStreetMap at that spot adds a
// name, a use or floors (the 3D building popup's lookup). Samples evenly across one zoom-14 tile in each city. Writes nothing.
import { PMTiles } from "pmtiles"; import { VectorTile } from "@mapbox/vector-tile"; import { PbfReader as Protobuf } from "pbf";
const p = new PMTiles("https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/2026-09-23.1/buildings.pmtiles");
const places = [["Bangkok Silom", 13.726, 100.531], ["Chiang Mai", 18.788, 98.985], ["Hat Yai", 7.006, 100.474], ["Yala", 6.541, 101.281], ["Pattani", 6.869, 101.25], ["Manila", 14.556, 121.023]];
const PER = +(process.env.PER || 25);
function tile(lat, lon, z) { const n = 2 ** z, x = Math.floor((lon + 180) / 360 * n), r = lat * Math.PI / 180, y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n); return [x, y]; }
const KIND = ["amenity", "shop", "office", "tourism", "healthcare", "leisure", "military", "government", "craft", "religion", "building"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function ask(lat, lon) {
  const q = `[out:json][timeout:15];is_in(${lat},${lon})->.a;(way(pivot.a)[building];relation(pivot.a)[building];way(pivot.a)[amenity];relation(pivot.a)[amenity];);out tags 6;node(around:25,${lat},${lon})[name];out tags center 8;`;
  for (const u of ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]) {
    const t = Date.now();
    try { const r = await fetch(u, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(20000) });
      if (r.ok) return { j: await r.json(), ms: Date.now() - t }; } catch (e) {}
  }
  return null;
}
const all = { n: 0, fail: 0, name: 0, use: 0, floors: 0, near: 0, any: 0, ms: [] };
for (const [city, lat0, lon0] of places) {
  const [x, y] = tile(lat0, lon0, 14), t = await p.getZxy(14, x, y); if (!t) continue;
  const L = new VectorTile(new Protobuf(new Uint8Array(t.data))).layers.building, bare = [];
  for (let i = 0; i < L.length; i++) { const f = L.feature(i), q = f.properties; if (!q["@name"] && !q.names && !q.class && !q.subtype && q.num_floors == null && q.height == null) bare.push(f); }
  const c = { n: 0, fail: 0, name: 0, use: 0, floors: 0, near: 0, any: 0 }, step = Math.max(1, Math.floor(bare.length / PER));
  for (let k = 0; k < bare.length && c.n < PER; k += step) {
    const g = bare[k].toGeoJSON(x, y, 14).geometry, ring = (g.type === "Polygon" ? g.coordinates : g.coordinates[0])[0];
    const lon = ring.reduce((s, q) => s + q[0], 0) / ring.length, lat = ring.reduce((s, q) => s + q[1], 0) / ring.length;
    c.n++; const r = await ask(lat.toFixed(6), lon.toFixed(6)); await sleep(1100);
    if (!r) { c.fail++; continue; } all.ms.push(r.ms);
    let nm = 0, use = 0, fl = 0, near = 0;
    for (const e of r.j.elements || []) { const tg = e.tags || {};
      if (e.type === "node") { near = 1; continue; }
      if (tg.name || tg["name:en"]) nm = 1; if (KIND.some((k2) => tg[k2] && tg[k2] !== "yes")) use = 1; if (tg["building:levels"] || tg.height) fl = 1; }
    c.name += nm; c.use += use; c.floors += fl; c.near += near; c.any += nm || use || fl || near ? 1 : 0;
  }
  const pc = (v) => Math.round((v / Math.max(1, c.n - c.fail)) * 100) + "%";
  console.log(`${city.padEnd(14)} bare ${bare.length}/${L.length} sampled ${c.n} failed ${c.fail} | outline name ${pc(c.name)} use ${pc(c.use)} floors ${pc(c.floors)} | named place within 25 m ${pc(c.near)} | anything ${pc(c.any)}`);
  for (const k of Object.keys(c)) all[k] += c[k];
}
const ok = all.n - all.fail, pc = (v) => Math.round((v / Math.max(1, ok)) * 100) + "%"; all.ms.sort((a, b) => a - b);
console.log(`ALL sampled ${all.n} answered ${ok} | outline name ${pc(all.name)} use ${pc(all.use)} floors ${pc(all.floors)} | named place within 25 m ${pc(all.near)} | anything ${pc(all.any)} | median ${all.ms[all.ms.length >> 1]} ms`);
