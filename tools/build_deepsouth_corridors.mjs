// Builds data/thailand/deepsouth-corridors.js (window.OSAP_DSC): the railway and main roads of Thailand's Deep South for the
// conflict tab's corridor layer (assets/osap-cf-dspat.js).
//   NE_RAIL=ne_10m_railroads.geojson NE_ROADS=ne_10m_roads.geojson node tools/build_deepsouth_corridors.mjs
// Inputs: downloaded copies of Natural Earth 1:10m "railroads" and "roads" (public domain,
// raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/). Lines are cut to the Deep South box (Songkhla to
// Narathiwat) and rounded to 4 decimals. Natural Earth is drawn for 1:10 million maps: a line can be a kilometre or more off the real
// track or road, it carries no names, and the page says so. Roads keep Natural Earth scalerank <= 7 (main roads) only.
// Every line gets fp = SHA-256 of its canonical JSON (sorted keys, UTF-8) without fp.
import fs from "node:fs";
import crypto from "node:crypto";

const OUT = "data/thailand/deepsouth-corridors.js";
const BOX = [99.9, 5.5, 102.2, 7.4]; // lon0, lat0, lon1, lat1
const ROAD_RANK = 7;
const canon = (v) => Array.isArray(v) ? "[" + v.map(canon).join(",") + "]"
  : v && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}" : JSON.stringify(v);
const fp = (o) => { const c = { ...o }; delete c.fp; return crypto.createHash("sha256").update(canon(c), "utf8").digest("hex"); };
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

const inBox = (p) => p[0] >= BOX[0] && p[0] <= BOX[2] && p[1] >= BOX[1] && p[1] <= BOX[3];
// keep runs of points inside the box, with one point either side so a line reaches the edge
function clip(l) {
  const out = []; let run = null;
  for (let i = 0; i < l.length; i++) {
    if (inBox(l[i])) { if (!run) { run = i > 0 ? [l[i - 1]] : []; } run.push(l[i]); }
    else if (run) { run.push(l[i]); out.push(run); run = null; }
  }
  if (run) out.push(run);
  return out.filter((r) => r.length >= 2).map((r) => r.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]));
}
function read(env, what) {
  const f = process.env[env];
  if (!f) throw new Error("set " + env + " to a downloaded copy of " + what);
  const t = fs.readFileSync(f); return { j: JSON.parse(t), sha: sha(t) };
}
function take(j, keep, kind) {
  const out = [];
  for (const f of j.features) {
    const g = f.geometry, p = f.properties || {};
    if (!g || !keep(p)) continue;
    for (const l of (g.type === "MultiLineString" ? g.coordinates : [g.coordinates])) for (const c of clip(l)) {
      const r = { kind, rank: p.scalerank, line: c };
      if (kind === "road" && p.expressway) r.expressway = true;
      r.fp = fp(r); out.push(r);
    }
  }
  return out;
}
const rail = read("NE_RAIL", "ne_10m_railroads.geojson"), roads = read("NE_ROADS", "ne_10m_roads.geojson");
const out = {
  schema: "osap-dsc/1",
  box: BOX,
  sources: [
    { name: "Natural Earth 1:10m railroads", licence: "public domain", url: "https://www.naturalearthdata.com/downloads/10m-cultural-vectors/railroads/", input_sha256: rail.sha },
    { name: "Natural Earth 1:10m roads", licence: "public domain", url: "https://www.naturalearthdata.com/downloads/10m-cultural-vectors/roads/", input_sha256: roads.sha }
  ],
  rail: take(rail.j, () => true, "rail"),
  roads: take(roads.j, (p) => p.featurecla === "Road" && p.scalerank <= ROAD_RANK, "road")
};
if (!out.rail.length) throw new Error("no railway in the Deep South box");
fs.writeFileSync(OUT, "/* Built by tools/build_deepsouth_corridors.mjs from Natural Earth (public domain). Do not edit by hand. */\nwindow.OSAP_DSC=" + JSON.stringify(out) + ";\n");
console.log(OUT, "rail", out.rail.length, "roads", out.roads.length, fs.statSync(OUT).size, "bytes");
