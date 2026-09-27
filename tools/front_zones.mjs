// Front source type "zones" (tools/conflicts.json): for a war with no ground front line (strikes, missiles, drones and war at sea),
// the equivalent is drawn from two things, each feature saying which:
//   1. reported strike zones: the conflict's own placed reports of air strikes, missiles, drones and attacks over the last
//      `days` days, grouped where they fall within 60 km of each other; each zone is a circle around its reports and carries
//      how many reports, from when to when, and links to up to five of them. Redrawn every run, so it moves with the reporting.
//   2. announced or reported areas from a hand-curated file (`areas`: a JSON file with an "areas" list: name, kind
//      exclusion|blockade|threat|strike-zone, geom (GeoJSON Polygon, lon/lat), from, claimed_by, url, basis, description).
//      These are hand-drawn where no official coordinates were published, and say so.
// Every feature is "Reported, not verified". A new front version is kept (with its date and SHA-256) only when a zone changes.
import fs from "node:fs";
import { sha256, fcKm2 } from "./conflict_lib.mjs";

const STRIKE = new Set(["airstrike", "missile", "drone", "attack", "ied", "shelling"]);
const KIND_LABEL = { "strike-zone": "Reported strike zones", exclusion: "Announced exclusion or restricted zones", blockade: "Blockade areas", threat: "Shipping threat areas" };
const COL = { "strike-zone": "#8A1C7C", exclusion: "#B3261E", blockade: "#2F6FB5", threat: "#C2792B" };

function km(a, b, c, d) { const R = 6371, p = Math.PI / 180, x = Math.sin((c - a) * p / 2), y = Math.sin((d - b) * p / 2); return 2 * R * Math.asin(Math.sqrt(x * x + Math.cos(a * p) * Math.cos(c * p) * y * y)); }
function circle(lat, lon, rKm, n = 24) {
  const ring = [];
  for (let k = 0; k <= n; k++) {
    const a = (k % n) / n * 2 * Math.PI;
    ring.push([+(lon + (rKm / (111.32 * Math.cos(lat * Math.PI / 180))) * Math.sin(a)).toFixed(4), +(lat + (rKm / 110.57) * Math.cos(a)).toFixed(4)]);
  }
  return ring;
}

export function zonesFront(c, s, items, stamp, now = Date.now()) {
  const days = s.days || 14, since = new Date(now - days * 864e5).toISOString().slice(0, 16);
  const [[south, west], [north, east]] = c.bounds;
  const feats = [];
  // 1. strike zones from placed reports
  // hand-curated earlier reports (`backfill`: date-only web-search titles) count too, so zones exist before the feeds caught up
  let bf = [];
  if (s.backfill) { try { bf = JSON.parse(fs.readFileSync(s.backfill, "utf8")); } catch (e) { bf = []; } }
  const BK = { strike: "airstrike", missile: "missile", drone: "drone" };
  const pool = (items || []).concat(bf.filter((r) => BK[r.kind] && r.lat != null && r.url).map((r) => ({ kind: BK[r.kind], date: String(r.t).slice(0, 16), title: r.title, link: r.url,
    outlet: r.source, geo: { la: r.lat, lo: r.lon, n: r.place }, backfill: true, fp: sha256({ link: r.url, title: r.title, date: String(r.t).slice(0, 16), outlet: r.source }) })));
  const seen = new Set(), zs = [];
  for (const i of pool) {
    if (seen.has(i.link)) continue; seen.add(i.link);
    // a live report counts only when its headline names the place it was pinned to (a dateline such as "TEHRAN, Sep. 27" is not where a strike was)
    if (!i.backfill && i.geo && i.geo.n && ((i.title_en || "") + " " + (i.title || "")).toLowerCase().indexOf(String(i.geo.n).toLowerCase().split(",")[0]) < 0) continue;
    if (!STRIKE.has(i.kind) || !i.geo || i.geo.la == null || !(i.date >= since)) continue;
    const la = i.geo.la, lo = i.geo.lo;
    if (la < south || la > north || lo < west || lo > east) continue;
    let z = zs.find((q) => km(q.la, q.lo, la, lo) < 60);
    if (!z) { z = { la, lo, recs: [] }; zs.push(z); }
    z.recs.push(i);
    z.la = z.recs.reduce((t, r) => t + r.geo.la, 0) / z.recs.length;
    z.lo = z.recs.reduce((t, r) => t + r.geo.lo, 0) / z.recs.length;
  }
  for (const z of zs) {
    const r = Math.max(25, Math.max(...z.recs.map((x) => km(z.la, z.lo, x.geo.la, x.geo.lo))) + 15);
    const ds = z.recs.map((x) => x.date).sort(), places = {};
    z.recs.forEach((x) => { places[x.geo.n] = (places[x.geo.n] || 0) + 1; });
    const where = Object.keys(places).sort((a, b) => places[b] - places[a])[0];
    z.recs.sort((a, b) => (b.date > a.date ? 1 : -1));
    feats.push({ type: "Feature", geometry: { type: "MultiPolygon", coordinates: [[circle(z.la, z.lo, Math.round(r))]] },
      properties: { ctl: "strike-zone", name: "Reported strikes near " + where, n: z.recs.length, from: ds[0], to: ds[ds.length - 1], col: COL["strike-zone"], auto: true,
        basis: "Circle around " + z.recs.length + " placed report(s) of strikes, missiles or drones in the last " + days + " days; drawn from reports, not a damage assessment",
        reports: z.recs.slice(0, 5).map((x) => ({ t: x.title_en || x.title, link: x.link, outlet: x.outlet, date: x.date, fp: x.fp })) } });
  }
  feats.sort((a, b) => b.properties.n - a.properties.n);
  // 2. curated announced or reported areas
  let areas = [];
  if (s.areas) { try { areas = JSON.parse(fs.readFileSync(s.areas, "utf8")).areas || []; } catch (e) { throw new Error("areas file unreadable: " + e.message); } }
  for (const a of areas) {
    if (!a.geom || a.geom.type !== "Polygon") continue;
    feats.push({ type: "Feature", geometry: { type: "MultiPolygon", coordinates: [a.geom.coordinates] },
      properties: { ctl: a.kind, name: a.name, from: a.from, claimed_by: a.claimed_by, src: a.url || a.src, basis: a.basis || "", description: a.description || "", col: COL[a.kind] || "#6B7785", auto: false } });
  }
  feats.forEach((f) => { f.properties.claim_status = "Reported, not verified"; f.properties.fp = sha256({ g: f.geometry.coordinates, p: { ...f.properties, reports: undefined } }); });
  const fc = { type: "FeatureCollection", features: feats }, km2 = {};
  for (const f of feats) { const k = KIND_LABEL[f.properties.ctl] || f.properties.ctl; km2[k] = (km2[k] || 0) + fcKm2({ features: [f] }); }
  return { kind: "areas", source: s.id, areas: fc, km2, legend: Object.fromEntries(Object.keys(COL).map((k) => [k, KIND_LABEL[k]])), styled: true, no_front: true, taken: stamp,
    sha256: sha256(JSON.stringify(feats.map((f) => [f.properties.ctl, f.properties.name, f.geometry.coordinates]))), zones: zs.length, curated: areas.length };
}
