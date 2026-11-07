// Builds data/basemap/tz-zones.json: the world's time zone areas for the map readout's local time (assets/osap-zonetime.js).
// Source: timezone-boundary-builder "timezones-now" (https://github.com/evansiroky/timezone-boundary-builder, ODbL, from
// OpenStreetMap). The "now" release merges zones that keep the same clock from today on, so each area's tzid is one
// representative zone (Thailand, Vietnam and western Indonesia all read Asia/Jakarta): use it for the offset and summer time
// only, never as the place's own zone name. Land and territorial waters only; open sea falls back to nautical zones.
// Steps (mapshaper is not a dependency of the app; install it in a scratch folder):
//   curl -LO https://github.com/evansiroky/timezone-boundary-builder/releases/latest/download/timezones-now.geojson.zip
//   unzip timezones-now.geojson.zip    -> combined-now.json
//   npx mapshaper-xl combined-now.json -simplify 1% keep-shapes -clean -o format=geojson precision=0.01 tz-simple.json
//   node tools/build_tz_zones.mjs tz-simple.json <release tag>
// Output: { src, rel, built, z: [tzid], f: [[zone index, [w, s, e, n] (x100), [ring, ...]]] } with each ring a flat list of
// whole numbers lon*100, lat*100. A polygon's rings are tested even-odd, so holes (enclaves) work.
import { readFileSync, writeFileSync } from "node:fs";
const [inp, rel = ""] = process.argv.slice(2);
if (!inp) { console.error("usage: node tools/build_tz_zones.mjs <simplified geojson> [release tag]"); process.exit(1); }
const g = JSON.parse(readFileSync(inp, "utf8"));
const z = [], f = [];
for (const ft of g.features) {
  const id = ft.properties && ft.properties.tzid; if (!id || !ft.geometry) continue;
  let zi = z.indexOf(id); if (zi < 0) { zi = z.length; z.push(id); }
  const polys = ft.geometry.type === "Polygon" ? [ft.geometry.coordinates] : ft.geometry.type === "MultiPolygon" ? ft.geometry.coordinates : [];
  for (const poly of polys) {
    let w = 1e9, s = 1e9, e = -1e9, n = -1e9;
    const rings = poly.map((r) => { const o = []; for (const [x, y] of r) { const X = Math.round(x * 100), Y = Math.round(y * 100); o.push(X, Y); if (X < w) w = X; if (X > e) e = X; if (Y < s) s = Y; if (Y > n) n = Y; } return o; }).filter((r) => r.length >= 8);
    if (rings.length) f.push([zi, [w, s, e, n], rings]);
  }
}
const out = { src: "timezone-boundary-builder timezones-now (ODbL, OpenStreetMap contributors), simplified", rel, built: new Date().toISOString().slice(0, 10), z, f };
writeFileSync("data/basemap/tz-zones.json", JSON.stringify(out));
console.log(`zones ${z.length}, polygons ${f.length}, bytes ${JSON.stringify(out).length}`);
