// Permanent restricted, danger and prohibited airspace (and military reserved areas, ADIZs, alert and warning areas) from OpenAIP,
// for Map overlays. Added 27 Nov 2026 from the OSINT Framework comparison (Shane: "Add those four").
//   Source  OpenAIP country exports (<cc>_asp.geojson). The API needs an account, but www.openaip.net/data/exports publishes every
//           export as a presigned download link (24 h) without one; this job reads that page and downloads the links it lists.
//   Licence OpenAIP data is CC BY-NC 4.0: non-commercial, so every file written here is tagged nc (source.nc) and the sold
//           version deletes the whole data/live/airspace folder (tools/nc_strip.mjs). Attribution "© OpenAIP, CC BY-NC 4.0".
//   Output  data/live/airspace/index.json (countries with their area count and bounding box, as-of) and data/live/airspace/<cc>.json, one per country, with only
//           what the map needs: name, type, lower and upper limit, outline rounded to 3 decimals (about 100 m). OpenAIP's
//           contributor ids are never copied. Runs at most once a day (the exports change slowly).
// Run: node tools/refresh_openaip.mjs   (FORCE=1 ignores the once-a-day check)
import fs from "node:fs";
import { get, sleep } from "./dense_lib.mjs";

export const TYPES = { 1: "Restricted", 2: "Danger", 3: "Prohibited", 8: "Temporary reserved (military)", 9: "Temporary segregated (military)", 12: "ADIZ", 17: "Alert", 18: "Warning" };
const UNIT = { 0: "m", 1: "ft", 6: "FL" }, DATUM = { 0: "GND", 1: "MSL", 2: "STD" };
export const SOURCE = { name: "OpenAIP", url: "https://www.openaip.net/", lic: "CC BY-NC 4.0", credit: "© OpenAIP, CC BY-NC 4.0", nc: true };
const OUT = "data/live/airspace";

export function limit(l) {
  if (!l || !Number.isFinite(+l.value)) return "";
  if (+l.unit === 6) return "FL" + Math.round(+l.value);
  if (+l.value === 0 && +l.referenceDatum === 0) return "GND";
  return Math.round(+l.value).toLocaleString("en-US") + " " + (UNIT[l.unit] || "") + " " + (DATUM[l.referenceDatum] || "");
}
const r3 = (v) => Math.round(v * 1000) / 1000;
function ring(coords) {
  const out = [];
  for (const p of coords || []) { if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue; const q = [r3(p[0]), r3(p[1])]; const l = out[out.length - 1]; if (!l || l[0] !== q[0] || l[1] !== q[1]) out.push(q); }
  return out.length >= 4 ? out : null;
}
// one OpenAIP export -> the compact areas the map draws
export function areasOf(geo) {
  const out = [];
  for (const f of (geo && geo.features) || []) {
    const p = (f && f.properties) || {}, t = +p.type, g = f.geometry || {};
    if (!TYPES[t] || !p.name) continue;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    const rings = polys.map((pl) => ring(pl && pl[0])).filter(Boolean);
    if (!rings.length) continue;
    out.push({ n: String(p.name).replace(/\s+/g, " ").trim().slice(0, 80), t, lo: limit(p.lowerLimit), hi: limit(p.upperLimit), ...(p.byNotam ? { notam: true } : {}), g: rings });
  }
  return out;
}
// [[south, west], [north, east]] around every outline, so the map loads a country's file only when it is in view
export function bboxOf(areas) {
  let s = 90, w = 180, n = -90, e = -180;
  for (const a of areas || []) for (const r of a.g) for (const [x, y] of r) { if (y < s) s = y; if (y > n) n = y; if (x < w) w = x; if (x > e) e = x; }
  return n >= s ? [[s, w], [n, e]] : null;
}
export function exportLinks(html) {
  const links = {};
  for (const m of String(html || "").matchAll(/https:\/\/s3\.openaip\.net\/openaip-system-exports\/([a-z]{2})_asp\.geojson\?[^"'\s<>]+/g)) links[m[1]] = m[0].replace(/&amp;/g, "&");
  return links;
}

if (import.meta.url === "file://" + process.argv[1]) {
  let old = null; try { old = JSON.parse(fs.readFileSync(OUT + "/index.json", "utf8")); } catch (e) {}
  if (!process.env.FORCE && old && old.asof && Date.now() - Date.parse(old.asof) < 20 * 3600e3) { console.log("airspace: fetched " + old.asof + ", next run after 20 h"); process.exit(0); }
  const links = {};
  for (let p = 1; p <= 40; p++) {
    const html = await get("https://www.openaip.net/data/exports?format=geojson&type=airspace&page=" + p, "text", { timeout: 45000 });
    if (!/openaip-system-exports\/[a-z0-9_]+\.geojson\?/.test(html)) break;
    Object.assign(links, exportLinks(html));
    await sleep(800);
  }
  if (Object.keys(links).length < 50) { console.log("::warning::OpenAIP exports page listed only " + Object.keys(links).length + " airspace files; keeping the old data"); process.exit(0); }
  fs.mkdirSync(OUT, { recursive: true });
  const countries = {}, asof = new Date().toISOString().slice(0, 16) + "Z";
  let failed = 0;
  for (const [cc, url] of Object.entries(links).sort()) {
    try {
      const areas = areasOf(await get(url, "json", { timeout: 120000 }));
      if (areas.length) { fs.writeFileSync(OUT + "/" + cc + ".json", JSON.stringify({ source: SOURCE, cc, asof, a: areas })); countries[cc] = { n: areas.length, b: bboxOf(areas) }; }
    } catch (e) { failed++; console.log("airspace " + cc + ": " + (e.message || e)); }
    await sleep(300);
  }
  fs.writeFileSync(OUT + "/index.json", JSON.stringify({ source: SOURCE, asof, types: TYPES, countries }));
  console.log("airspace: " + Object.keys(countries).length + " countries, " + Object.values(countries).reduce((a, c) => a + c.n, 0) + " areas" + (failed ? ", " + failed + " downloads failed" : ""));
}
