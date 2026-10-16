// Fetches the Thailand–Malaysia land boundary and every road that crosses it from OpenStreetMap (Overpass API, no key), for the
// Deep South border map (tools/build_deepsouth_border.mjs). Run from GitHub Actions (.github/workflows/refresh-dsb-osm.yml):
//   node tools/fetch_osm_th_my_border.mjs   ->   source/thailand/osm-th-my-border.json
// What it keeps:
//   - border: the land ways both countries' admin_level=2 relations share (maritime ways dropped), chained west to east.
//   - crossings: every point where a road (highway=* except footpaths, cycleways, steps and the like) crosses that line,
//     found by segment intersection, not by distance; points of the same or parallel roads within MERGE_M are one crossing.
//   - border_controls: barrier=border_control nodes within 3 km of the line (OSM's mark for a staffed checkpoint).
// OpenStreetMap data © OpenStreetMap contributors, ODbL 1.0. OSM is crowd-mapped: a road in OSM may be closed, gated or gone, and
// a road that exists may be missing. Nothing here says whether a crossing is legal; the build marks only named checkpoints official.
import fs from "node:fs";
import crypto from "node:crypto";

const OUT = process.env.OUT || "source/thailand/osm-th-my-border.json", MERGE_M = 250;
const UA = "AXIOM-OSAP Deep South border map (https://github.com/01shane89-jpg/AXIOM-APSAP)";
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
const ROAD = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|track|living_street|road|busway|(motorway|trunk|primary|secondary|tertiary)_link)$/;
const RANK = ["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "road", "service", "track"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(q) {
  let err;
  for (const u of OVERPASS) for (let k = 0; k < 2; k++) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 400000);
    try {
      const r = await fetch(u, { method: "POST", signal: ctl.signal, body: "data=" + encodeURIComponent(q), headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json(); j.__host = u.split("/")[2]; return j;
    } catch (e) { err = e; console.log("overpass", u.split("/")[2], e.message); await sleep(15000); }
    finally { clearTimeout(t); }
  }
  throw err;
}

const q = `[out:json][timeout:300];
rel["boundary"="administrative"]["admin_level"="2"]["ISO3166-1"="TH"]->.th;
rel["boundary"="administrative"]["admin_level"="2"]["ISO3166-1"="MY"]->.my;
way(r.th)->.tw; way(r.my)->.mw;
way.tw.mw->.b;
.b out tags geom;
way(around.b:40)["highway"]->.h;
.h out tags geom;
node(around.b:3000)["barrier"="border_control"];
out tags;`;
const j = await overpass(q);
const els = j.elements || [];
console.log("overpass", j.__host, "elements", els.length, "osm_base", j.osm3s && j.osm3s.timestamp_osm_base);

/* ---------- the line ---------- */
const bways = els.filter((e) => e.type === "way" && !e.tags?.highway && e.geometry && e.tags?.maritime !== "yes" && !/maritime|territorial/i.test(e.tags?.border_type || ""));
if (!bways.length) throw new Error("no shared Thailand–Malaysia boundary ways");
const r6 = (x) => +x.toFixed(6);
const pieces = bways.map((w) => w.geometry.map((p) => [r6(p.lon), r6(p.lat)]));
const key = (p) => p[0] + "," + p[1];
// chain pieces end to end; a gap (should not happen) starts a new chain rather than failing, and the log says so
const left = pieces.slice(), chains = [];
while (left.length) {
  left.sort((a, b) => Math.min(a[0][0], a[a.length - 1][0]) - Math.min(b[0][0], b[b.length - 1][0]));
  let line = left[0][0][0] <= left[0][left[0].length - 1][0] ? left[0].slice() : left[0].slice().reverse(); left.shift();
  for (;;) {
    const e = key(line[line.length - 1]), s = key(line[0]);
    let i = left.findIndex((l) => key(l[0]) === e || key(l[l.length - 1]) === e);
    if (i >= 0) { const l = key(left[i][0]) === e ? left[i] : left[i].slice().reverse(); line = line.concat(l.slice(1)); left.splice(i, 1); continue; }
    i = left.findIndex((l) => key(l[0]) === s || key(l[l.length - 1]) === s);
    if (i >= 0) { const l = key(left[i][left[i].length - 1]) === s ? left[i] : left[i].slice().reverse(); line = l.concat(line.slice(1)); left.splice(i, 1); continue; }
    break;
  }
  if (line[0][0] > line[line.length - 1][0]) line.reverse();
  chains.push(line);
}
chains.sort((a, b) => b.length - a.length);
const line = chains[0];
console.log("border chains", chains.length, chains.map((c) => c.length + " pts " + JSON.stringify(c[0]) + "->" + JSON.stringify(c[c.length - 1])).join("; "));

/* ---------- crossings ---------- */
const rad = Math.PI / 180;
const m = (a, b) => { const x = Math.sin((b[1] - a[1]) * rad / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin((b[0] - a[0]) * rad / 2) ** 2; return 12742000 * Math.asin(Math.sqrt(x)); };
function hit(p, p2, q, q2) {
  const d = (p2[0] - p[0]) * (q2[1] - q[1]) - (p2[1] - p[1]) * (q2[0] - q[0]); if (!d) return null;
  const t = ((q[0] - p[0]) * (q2[1] - q[1]) - (q[1] - p[1]) * (q2[0] - q[0])) / d, u = ((q[0] - p[0]) * (p2[1] - p[1]) - (q[1] - p[1]) * (p2[0] - p[0])) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [p[0] + t * (p2[0] - p[0]), p[1] + t * (p2[1] - p[1])] : null;
}
const bb = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
const segs = []; let off = 0;
for (const c of chains) { for (let i = 0; i < c.length - 1; i++) segs.push({ i: off + i, a: c[i], b: c[i + 1], bb: bb(c[i], c[i + 1]) }); off += c.length; }
const roads = els.filter((e) => e.type === "way" && e.tags?.highway && ROAD.test(e.tags.highway) && e.geometry);
const skipped = els.filter((e) => e.type === "way" && e.tags?.highway && !ROAD.test(e.tags.highway)).length;
const raw = [];
for (const w of roads) {
  const g = w.geometry.map((p) => [p.lon, p.lat]);
  for (let k = 0; k < g.length - 1; k++) {
    const rb = bb(g[k], g[k + 1]);
    for (const s of segs) {
      if (s.bb[0] > rb[2] || s.bb[2] < rb[0] || s.bb[1] > rb[3] || s.bb[3] < rb[1]) continue;
      const x = hit(g[k], g[k + 1], s.a, s.b);
      if (x) raw.push({ pt: x, w, seg: s.i });
    }
  }
}
const pick = (t) => { const o = {}; for (const k of ["highway", "name", "name:en", "name:th", "name:ms", "ref", "surface", "bridge", "ford", "access", "motor_vehicle", "barrier", "tracktype"]) if (t[k]) o[k] = t[k]; return o; };
const clusters = [];
for (const r of raw.sort((a, b) => a.seg - b.seg)) {
  const c = clusters.find((c) => m(c.pt, r.pt) <= MERGE_M);
  if (c) { c.ways.push(r.w); continue; }
  clusters.push({ pt: r.pt, seg: r.seg, ways: [r.w] });
}
const crossings = clusters.map((c) => {
  const ws = [...new Map(c.ways.map((w) => [w.id, w])).values()].sort((a, b) => RANK.indexOf(a.tags.highway.replace("_link", "")) - RANK.indexOf(b.tags.highway.replace("_link", "")));
  return { lat: +c.pt[1].toFixed(6), lon: +c.pt[0].toFixed(6), along: c.seg, ways: ws.map((w) => ({ id: w.id, ...pick(w.tags) })) };
}).sort((a, b) => a.along - b.along);
const controls = els.filter((e) => e.type === "node").map((n) => ({ id: n.id, lat: n.lat, lon: n.lon, ...pick(n.tags) }));
console.log("roads near the line", roads.length, "(non-road ways skipped", skipped + ")", "raw hits", raw.length, "crossings", crossings.length, "border_control nodes", controls.length);
for (const c of crossings) console.log("  X", c.lat, c.lon, c.ways.map((w) => w.highway + ":" + (w.ref || w.name || w["name:en"] || "-") + "#" + w.id).join(" | "));
for (const n of controls) console.log("  BC", n.lat, n.lon, n.name || n["name:en"] || "-", "#" + n.id);

const out = {
  schema: "osap-osm-th-my-border/1",
  source: "OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright), via the Overpass API",
  overpass_host: j.__host, osm_base: (j.osm3s && j.osm3s.timestamp_osm_base) || null, query_sha256: crypto.createHash("sha256").update(q).digest("hex"),
  merge_m: MERGE_M, border_ways: bways.map((w) => w.id), border: line, border_extra: chains.slice(1), crossings, border_controls: controls
};
fs.writeFileSync(OUT, JSON.stringify(out) + "\n");
console.log("wrote", OUT, fs.statSync(OUT).size, "bytes");
