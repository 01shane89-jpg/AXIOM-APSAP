// Hourly hazard snapshot refresh (run by .github/workflows/refresh-flood.yml, or by hand with Node 18+).
// Writes data/live/quakes.js (USGS M2.5+ past 7 days across the Asia-Pacific) and
// data/live/air-quality.js (Open-Meteo CAMS air quality at the same points the page asks for:
// up to six U.S. posts per area from source/sof, or the area centre when there are none).
// The page uses these files only when its own live request fails.
// Exit codes: 0 = at least one feed refreshed or unchanged, 1 = both feeds failed (old files are left untouched).
import fs from "node:fs";

const USGS = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson";
const AQAPI = "https://air-quality-api.open-meteo.com/v1/air-quality";
const TIMEOUT = 30000;
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";

async function getJSON(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "user-agent": "AXIOM-ASAP hazard refresh" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
function write(file, global, body) {
  fs.mkdirSync("data/live", { recursive: true });
  const text = "window." + global + "=" + JSON.stringify(body).replace(/<\//g, "<\\/") + ";\n";
  fs.writeFileSync(file, text);
}
// same bounds as the page's COUNTRIES list
const page = fs.readFileSync("index.html", "utf8");
const AREAS = [...page.matchAll(/\{ id: "([a-z]+)", name: "[^"]+", region: "[^"]+", ne: "[^"]+", bounds: (\[\[[^\]]+\], \[[^\]]+\]\]) \}/g)]
  .map((m) => ({ cc: m[1], bounds: JSON.parse(m[2]) }));
if (AREAS.length < 20) { console.error("could not read the area list from index.html"); process.exit(1); }

let ok = 0;
try {
  const g = await getJSON(USGS);
  const features = (g.features || []).map((f) => {
    const p = f.properties || {}, c = (f.geometry || {}).coordinates || [];
    return { id: f.id, mag: p.mag, place: p.place || "", time: p.time, depth: c[2], lat: c[1], lon: c[0], url: p.url || "",
      tsunami: p.tsunami, alert: p.alert || null, status: p.status || "", type: p.type || "earthquake" };
  }).filter((q) => q.type === "earthquake" && q.mag != null && q.lat >= -50 && q.lat <= 56 && q.lon >= 58 && q.lon <= 180);
  write("data/live/quakes.js", "ASAP_QUAKES", { asof: stamp, src: USGS, features });
  console.log("quakes", features.length); ok++;
} catch (e) { console.error("USGS failed:", e.message); }

try {
  const pts = [];
  for (const a of AREAS) {
    let posts = [];
    try { posts = (JSON.parse(fs.readFileSync("source/sof/" + a.cc + ".json", "utf8")).posts || []).filter((p) => p.lat != null).slice(0, 6); } catch (e) {}
    const list = posts.length ? posts.map((p) => ({ name: p.city || p.name, lat: p.lat, lon: p.lon }))
      : [{ name: a.cc.toUpperCase() + " (centre)", lat: (a.bounds[0][0] + a.bounds[1][0]) / 2, lon: (a.bounds[0][1] + a.bounds[1][1]) / 2 }];
    for (const p of list) pts.push({ cc: a.cc, ...p });
  }
  const points = {};
  for (let i = 0; i < pts.length; i += 50) {
    const chunk = pts.slice(i, i + 50);
    const url = AQAPI + "?latitude=" + chunk.map((p) => p.lat.toFixed(3)).join(",") + "&longitude=" + chunk.map((p) => p.lon.toFixed(3)).join(",") +
      "&current=us_aqi,pm2_5,pm10&timezone=GMT";
    const j = await getJSON(url), arr = Array.isArray(j) ? j : [j];
    chunk.forEach((p, k) => {
      const c = (arr[k] || {}).current || {};
      (points[p.cc] = points[p.cc] || []).push({ name: p.name, lat: p.lat, lon: p.lon, time: c.time || "", us_aqi: c.us_aqi, pm2_5: c.pm2_5, pm10: c.pm10 });
    });
  }
  write("data/live/air-quality.js", "ASAP_AQ", { asof: stamp, src: AQAPI, points });
  console.log("air quality points", pts.length); ok++;
} catch (e) { console.error("Open-Meteo failed:", e.message); }

process.exit(ok ? 0 : 1);
