// Test only: how many buildings the keyless OpenFreeMap tiles (OpenStreetMap, OpenMapTiles schema) have in SE Asian cities,
// and how many carry a real height or floor count (render_height other than the 5 m default). Writes nothing to the repo.
// Needs @mapbox/vector-tile and pbf (npm install --no-save). Run from the repo root: node tools/probe_buildings.mjs
import { VectorTile } from "@mapbox/vector-tile";
import Protobuf from "pbf";
const TJ = "https://tiles.openfreemap.org/planet";
const tj = await (await fetch(TJ)).json();
const cors = (await fetch(TJ, { headers: { Origin: "https://01shane89-jpg.github.io" } })).headers.get("access-control-allow-origin");
console.log("TileJSON tiles", tj.tiles && tj.tiles[0], "maxzoom", tj.maxzoom, "CORS", cors);
const places = [["Bangkok Silom", 13.726, 100.531], ["Bangkok Sukhumvit", 13.737, 100.560], ["Chiang Mai", 18.788, 98.985], ["Hat Yai", 7.006, 100.474], ["Yala", 6.541, 101.281],
  ["Pattani", 6.869, 101.25], ["Narathiwat", 6.426, 101.823], ["Manila Makati", 14.556, 121.023], ["Cotabato", 7.223, 124.246], ["Hanoi", 21.028, 105.852], ["Ho Chi Minh", 10.776, 106.701],
  ["Phnom Penh", 11.556, 104.928], ["Vientiane", 17.966, 102.613], ["Yangon", 16.8, 96.155], ["Kuala Lumpur", 3.152, 101.711], ["Singapore", 1.283, 103.851], ["Jakarta", -6.2, 106.823], ["Taipei", 25.04, 121.565]];
function tile(lat, lon, z) { const n = 2 ** z, x = Math.floor((lon + 180) / 360 * n), r = lat * Math.PI / 180, y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n); return [x, y]; }
for (const [name, lat, lon] of places) {
  const [x, y] = tile(lat, lon, 14), u = tj.tiles[0].replace("{z}", 14).replace("{x}", x).replace("{y}", y);
  try {
    const res = await fetch(u); if (!res.ok) { console.log(name, "HTTP", res.status); continue; }
    const vt = new VectorTile(new Protobuf(new Uint8Array(await res.arrayBuffer()))), L = vt.layers.building;
    let n = 0, h = 0, tall = 0;
    if (L) for (let i = 0; i < L.length; i++) { const p = L.feature(i).properties; n++; if (p.render_height != null && p.render_height !== 5) h++; if (p.render_height >= 30) tall++; }
    console.log(`BLD ${name.padEnd(18)} buildings ${String(n).padStart(5)} | with height or floors ${String(h).padStart(5)} (${n ? Math.round(h / n * 100) : 0}%) | 30 m or taller ${tall}`);
  } catch (e) { console.log(name, e.message); }
}
