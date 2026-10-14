// Builds data/thailand/deepsouth-border.js (window.OSAP_DSB): the Deep South conflict tab's border map (assets/osap-cf-deepsouth.js).
//   NE_FILE=ne_10m_admin_0_boundary_lines_land.geojson node tools/build_deepsouth_border.mjs
// Inputs:
//   - the Thailand–Malaysia land boundary from Natural Earth 1:10m "admin 0 boundary lines land" (public domain), a downloaded copy
//     (raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_boundary_lines_land.geojson). Its pieces
//     are chained into one line, west (Satun coast) to east (Kolok river mouth). Natural Earth is drawn for 1:10 million maps: the
//     line can be a kilometre or more off the true boundary, and the page says so.
//   - source/thailand/deepsouth-border.json: the hand-kept crossings and special-law areas, each with its sources.
// Crossing positions were placed by hand near the named checkpoints and are then moved onto the nearest point of the line when it is
// within SNAP_KM, so a crossing never sits off the border it crosses; "coord_basis" says which happened.
// Every record gets fp = SHA-256 of its canonical JSON (sorted keys, UTF-8) without fp.
import fs from "node:fs";
import crypto from "node:crypto";

const SNAP_KM = 8, OUT = "data/thailand/deepsouth-border.js";
const src = JSON.parse(fs.readFileSync("source/thailand/deepsouth-border.json", "utf8"));
const NE = process.env.NE_FILE;
if (!NE) throw new Error("set NE_FILE to a downloaded copy of ne_10m_admin_0_boundary_lines_land.geojson");
const neText = fs.readFileSync(NE);
const ne = JSON.parse(neText);

const canon = (v) => Array.isArray(v) ? "[" + v.map(canon).join(",") + "]"
  : v && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}" : JSON.stringify(v);
const fp = (o) => { const c = { ...o }; delete c.fp; return crypto.createHash("sha256").update(canon(c), "utf8").digest("hex"); };

/* ---------- the line ---------- */
const pieces = [];
for (const f of ne.features) {
  const p = f.properties || {};
  const pair = [p.ADM0_LEFT, p.ADM0_RIGHT].sort().join("|");
  if (pair !== "Malaysia|Thailand") continue;
  const g = f.geometry;
  (g.type === "MultiLineString" ? g.coordinates : [g.coordinates]).forEach((l) => pieces.push(l.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)])));
}
if (!pieces.length) throw new Error("no Thailand–Malaysia boundary in " + NE);
const key = (p) => p[0] + "," + p[1];
// chain: start at the westernmost end, keep attaching the piece whose end touches the line's end
let line = null; const left = pieces.slice();
const ends = left.flatMap((l, i) => [[l[0], i, false], [l[l.length - 1], i, true]]).sort((a, b) => a[0][0] - b[0][0]);
{ const [, i, rev] = ends[0]; line = rev ? left[i].slice().reverse() : left[i].slice(); left.splice(i, 1); }
while (left.length) {
  const e = key(line[line.length - 1]);
  const i = left.findIndex((l) => key(l[0]) === e || key(l[l.length - 1]) === e);
  if (i < 0) throw new Error("boundary pieces do not chain: " + left.length + " left at " + e);
  const l = key(left[i][0]) === e ? left[i] : left[i].slice().reverse();
  line = line.concat(l.slice(1)); left.splice(i, 1);
}

/* ---------- crossings snapped onto the line ---------- */
const R = 6371.0088, rad = Math.PI / 180;
const km = (a, b) => { const dl = (b[1] - a[1]) * rad, dn = (b[0] - a[0]) * rad, x = Math.sin(dl / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
function nearest(pt) {
  let best = null;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1], c = Math.cos(pt[1] * rad);
    const ax = a[0] * c, bx = b[0] * c, px = pt[0] * c, dx = bx - ax, dy = b[1] - a[1];
    let t = ((px - ax) * dx + (pt[1] - a[1]) * dy) / (dx * dx + dy * dy || 1e-12); t = Math.max(0, Math.min(1, t));
    const q = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], d = km(pt, q);
    if (!best || d < best.d) best = { q, d };
  }
  return best;
}
const crossings = src.crossings.map((x) => {
  const o = { ...x };
  if (x.kind !== "sea") {
    const n = nearest([x.lon, x.lat]);
    if (n.d <= SNAP_KM) { o.lat = +n.q[1].toFixed(4); o.lon = +n.q[0].toFixed(4); o.coord_basis = "placed by hand near the named checkpoint, then moved " + n.d.toFixed(1) + " km onto the nearest point of the Natural Earth border line"; }
    else o.coord_basis = "placed by hand near the named checkpoint; more than " + SNAP_KM + " km from the Natural Earth line, left where placed";
  } else o.coord_basis = "placed by hand at the named pier";
  o.prec = "approx";
  o.fp = fp(o);
  return o;
});
const measures = (src.measures || []).map((m) => ({ ...m, fp: fp(m) }));
const out = {
  schema: "osap-dsb/1", asof: src.asof, note: src.note,
  border: { line, source: "Natural Earth 1:10m admin 0 boundary lines (land), public domain", source_sha256: crypto.createHash("sha256").update(neText).digest("hex"),
    caution: "Drawn for small-scale maps: the line can be a kilometre or more off the true boundary. Not for navigation or for deciding which side of the border a place is on." },
  crossings, measures, measure_levels: src.measure_levels, districts_note: src.districts_note
};
fs.writeFileSync(OUT, "window.OSAP_DSB=" + JSON.stringify(out) + ";\n");
console.log(OUT, "line", line.length, "points; crossings", crossings.length, crossings.map((c) => c.id + " " + c.coord_basis.match(/moved [\d.]+ km|left where placed|pier/)[0]).join("; "), "; measures", measures.length);
