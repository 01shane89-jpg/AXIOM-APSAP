// Deep South district outlines (data/places/deepsouth-areas.json, tools/build_places_areas.mjs): one real outline per district in
// the place list, each holding its own centre, the source licence recorded; and the matcher's rules on made-up boundaries.
import assert from "node:assert/strict";
import fs from "node:fs";
import { match, inPolys } from "../tools/build_places_areas.mjs";

const gaz = JSON.parse(fs.readFileSync("tools/places/deepsouth.json", "utf8"));
const A = JSON.parse(fs.readFileSync("data/places/deepsouth-areas.json", "utf8"));
assert.equal(A.schema, "osap-place-areas/1");
assert.ok(A.source.licence && A.source.sha256, "licence and file fingerprint recorded");
const districts = gaz.places.filter((p) => p.level === "district");
const byId = Object.fromEntries(A.areas.map((a) => [a.id, a]));
for (const p of districts) {
  const a = byId[p.id];
  assert.ok(a, p.id + " has an outline");
  assert.ok(a.polygons.length && a.polygons.every((poly) => poly[0].length >= 4), p.id + " outline has points");
  assert.ok(inPolys([p.centre[1], p.centre[0]], a.polygons), p.id + " centre inside its own outline");
  const [s, w, n, e] = a.bbox;
  assert.ok(n - s < 1 && e - w < 1 && n > s && e > w, p.id + " outline is district-sized");
}
assert.equal(A.areas.length, districts.length);
// no centre falls inside another district's outline
for (const p of districts) for (const a of A.areas) if (a.id !== p.id) assert.ok(!inPolys([p.centre[1], p.centre[0]], a.polygons), p.id + " not inside " + a.id);

// matcher: the containing boundary wins, an odd name is flagged, a district outside every boundary is missing
const box = (lat, lon, d = 0.05) => [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]];
const p1 = { id: "TH-1", level: "district", name: "Alpha", names: { en: ["Alpha"] }, centre: [6, 101] };
const p2 = { id: "TH-2", level: "district", name: "Beta", names: { en: ["Beta"] }, centre: [7, 102] };
const p3 = { id: "TH-3", level: "district", name: "Gamma", names: { en: ["Gamma"] }, centre: [9, 99] };
const r = match([p1, p2, p3], [
  { properties: { shapeName: "Amphoe Alpha", shapeID: "a" }, geometry: { type: "Polygon", coordinates: box(6, 101) } },
  { properties: { shapeName: "Delta", shapeID: "b" }, geometry: { type: "MultiPolygon", coordinates: [box(7, 102)] } },
]);
assert.deepEqual(r.areas.map((a) => [a.id, a.source_name]), [["TH-1", "Amphoe Alpha"], ["TH-2", "Delta"]]);
assert.deepEqual(r.check, ["TH-2 Beta ~ Delta"]);
assert.deepEqual(r.missing, ["TH-3 Gamma"]);
console.log("Deep South district outlines ok:", A.areas.length);
