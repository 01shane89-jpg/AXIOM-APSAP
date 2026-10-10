// Builds data/places/deepsouth-areas.json: the outline of every district in the Deep South place list (tools/places/deepsouth.json),
// so a report placed only by a district name can be shown as that district's area, never as a point at its centre.
// Source: geoBoundaries gbOpen, Thailand ADM2 (district) boundaries, simplified release, fetched through the geoBoundaries API; its
// licence and source are copied from the API answer into the file. Runs on GitHub's runners (.github/workflows/build-places.yml):
// the API is not reachable from every machine.
//
//   node tools/build_places_areas.mjs            fetch and write
//   GB_FILE=x.geojson node tools/build_places_areas.mjs   use a downloaded copy (licence fields then come from GB_META=meta.json)
//
// Each district is matched to the boundary that CONTAINS its centre (the centres were placed at the district seats); the boundary's
// own name is kept beside ours and a name that does not resemble ours is listed under "check". A district with no containing
// boundary stops the build. Coordinates are rounded to 0.001 degree (about 100 m) and thinned with Douglas-Peucker (0.001 degree).
import fs from "node:fs";
import crypto from "node:crypto";

const API = "https://www.geoboundaries.org/api/current/gbOpen/THA/ADM2/";
const OUT = "data/places/deepsouth-areas.json", TOL = 0.001;
const gaz = JSON.parse(fs.readFileSync("tools/places/deepsouth.json", "utf8"));

export function inRing([lon, lat], ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
// polygons: [[outer, hole, ...], ...]
export const inPolys = (pt, polys) => polys.some(([outer, ...holes]) => inRing(pt, outer) && !holes.some((h) => inRing(pt, h)));
const polysOf = (g) => (g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []);

function dp(pts, tol) {
  if (pts.length < 5) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1;
    const [x1, y1] = pts[a], [x2, y2] = pts[b], dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1e-12;
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / L; if (d > md) { md = d; mi = i; } }
    if (md > tol && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const r3 = (x) => Math.round(x * 1000) / 1000;
// a closed ring starts and ends on the same point, which Douglas-Peucker cannot use as its baseline: thin each half
const thinRing = (ring) => { const m = ring.length >> 1; return ring.length < 8 ? ring : dp(ring.slice(0, m + 1), TOL).concat(dp(ring.slice(m), TOL).slice(1)); };
const ringOut = (ring) => {
  const t = thinRing(ring).map(([x, y]) => [r3(x), r3(y)]).filter((c, i, a) => !i || c[0] !== a[i - 1][0] || c[1] !== a[i - 1][1]);
  return t.length >= 4 ? t : null;
};
const simple = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z]/g, "").replace(/^amphoe|^mueang|^muang/, "");

// Pure: districts + boundary features -> output areas and the problems found
export function match(places, features) {
  const areas = [], missing = [], check = [];
  for (const p of places.filter((x) => x.level === "district")) {
    const pt = [p.centre[1], p.centre[0]];
    const f = features.find((f) => inPolys(pt, polysOf(f.geometry || {})));
    if (!f) { missing.push(p.id + " " + p.name); continue; }
    const src = (f.properties || {}).shapeName || "";
    const polys = polysOf(f.geometry).map((poly) => { const r = poly.map(ringOut); return r[0] ? r.filter(Boolean) : []; }).filter((poly) => poly.length);
    if (!polys.length) { missing.push(p.id + " " + p.name + " (outline thinned away)"); continue; }
    const all = polys.flat(2), lons = all.map((c) => c[0]), lats = all.map((c) => c[1]);
    areas.push({ id: p.id, name: p.name, source_name: src, source_id: (f.properties || {}).shapeID || null,
      bbox: [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)], polygons: polys });
    const a = simple(src), b = simple(p.name);
    if (!(a && b && (a.includes(b) || b.includes(a) || p.names.en.some((n) => simple(n) && a.includes(simple(n)))))) check.push(p.id + " " + p.name + " ~ " + src);
  }
  const dup = areas.filter((a, i) => areas.findIndex((b) => b.source_id && b.source_id === a.source_id) !== i).map((a) => a.id);
  return { areas, missing, check, dup };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  let meta = {}, gj;
  if (process.env.GB_FILE) {
    gj = JSON.parse(fs.readFileSync(process.env.GB_FILE, "utf8"));
    if (process.env.GB_META) meta = JSON.parse(fs.readFileSync(process.env.GB_META, "utf8"));
  } else {
    const r = await fetch(API, { headers: { "user-agent": "OSAP place-list build (github.com/01shane89-jpg/AXIOM-APSAP)" }, signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error("geoBoundaries API " + r.status);
    meta = await r.json(); if (Array.isArray(meta)) meta = meta[0];
    const url = meta.simplifiedGeometryGeoJSON || meta.gjDownloadURL;
    if (!url) throw new Error("no download link in the API answer");
    const g = await fetch(url, { signal: AbortSignal.timeout(180000) });
    if (!g.ok) throw new Error("boundary download " + g.status);
    const buf = Buffer.from(await g.arrayBuffer());
    if (buf.length > 200e6) throw new Error("boundary file too large: " + buf.length);
    gj = JSON.parse(buf.toString("utf8"));
    meta.sha256 = crypto.createHash("sha256").update(buf).digest("hex");
    meta.url = url;
  }
  const { areas, missing, check, dup } = match(gaz.places, gj.features || []);
  console.log(`districts: ${areas.length} outlined, ${missing.length} missing, ${check.length} to check, ${dup.length} sharing a boundary`);
  for (const x of missing) console.log("  missing:", x);
  for (const x of check) console.log("  check:", x);
  if (missing.length || dup.length) { console.log("  sharing:", dup.join(", ")); process.exit(1); }
  const out = {
    schema: "osap-place-areas/1",
    note: "Outlines of the districts in tools/places/deepsouth.json, built by tools/build_places_areas.mjs. A report placed only by a district name covers this area; the centre in the place list is never an exact location. polygons: [[outer ring, holes...], ...], rings of [lon, lat] rounded to 0.001 degree and thinned (0.001 degree).",
    source: { name: "geoBoundaries gbOpen THA ADM2", api: API, file: meta.url || null, sha256: meta.sha256 || null,
      licence: meta.boundaryLicense || null, licence_source: meta.licenseSource || null, source: meta.boundarySource || null,
      source_year: meta.boundaryYearRepresented || null, updated: meta.sourceDataUpdateDate || null, build: meta.buildDate || null },
    built: new Date().toISOString().slice(0, 16) + "Z",
    check,
    areas,
  };
  fs.mkdirSync("data/places", { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ ...out, areas: [] }, null, 1).replace(/"areas": \[\]\n\}$/, '"areas": [\n') + areas.map((a) => "  " + JSON.stringify(a)).join(",\n") + "\n ]\n}\n");
  console.log("wrote", OUT, fs.statSync(OUT).size, "bytes; licence:", out.source.licence);
}
