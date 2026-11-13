// Test only: night lights + Sentinel-1 radar probe, round 2. Prints results; writes nothing.
const ORIGIN = "https://axiom-osap.netlify.app";
async function get(u, quiet) {
  const t0 = Date.now();
  try {
    const r = await fetch(u, { headers: { Origin: ORIGIN }, signal: AbortSignal.timeout(60000) });
    const ct = r.headers.get("content-type") || "", b = Buffer.from(await r.arrayBuffer());
    if (!quiet) console.log(`${r.status} ${Date.now() - t0}ms acao=${r.headers.get("access-control-allow-origin")} ct=${ct} len=${b.length} ${u.slice(0, 240)}`);
    return { r, b, ct };
  } catch (e) { console.log(`ERR ${e.message} ${u.slice(0, 200)}`); return {}; }
}
const G = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/";
const OP = "OPERA_L2_Radiometric_Terrain_Corrected_SAR_Sentinel-1";
function tile(lon, lat, z) { const n = 2 ** z, x = Math.floor((lon + 180) / 360 * n), r = lat * Math.PI / 180, y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n); return `${z}/${y}/${x}`; }
function merc(lon, lat) { const R = 6378137; return [lon * Math.PI / 180 * R, Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * R]; }
const places = { bangkok: [100.55, 13.75, "2026-11-06"], kyiv: [30.5, 50.45, ""], manila: [121.0, 14.6, ""], la: [-118.25, 34.05, ""], taipei: [121.5, 25.05, ""] };
// DescribeDomains with bbox (EPSG:3857 metres) for the OPERA layer and night-light layers
for (const [n, [lon, lat]] of Object.entries(places)) {
  const a = merc(lon - 0.25, lat - 0.25), b = merc(lon + 0.25, lat + 0.25), bb = [a[0], a[1], b[0], b[1]].map(v => Math.round(v)).join(",");
  for (const L of [[OP, "GoogleMapsCompatible_Level12"], ["VIIRS_NOAA20_GapFilled_BRDF_Corrected_DayNightBand_Radiance", "GoogleMapsCompatible_Level8"], ["VIIRS_NOAA21_DayNightBand_At_Sensor_Radiance", "GoogleMapsCompatible_Level8"]]) {
    const d = await get(`${G}1.0.0/${L[0]}/default/${L[1]}/${bb}/2026-10-01--2026-11-13.xml`);
    if (d.b) console.log("DD", n, L[0].slice(0, 30), d.b.toString().replace(/\s+/g, " ").slice(0, 700));
  }
}
// no-bbox form
const d0 = await get(`${G}1.0.0/${OP}/default/GoogleMapsCompatible_Level12/all/2026-11-01--2026-11-13.xml`);
if (d0.b) console.log("DD0", d0.b.toString().replace(/\s+/g, " ").slice(0, 900));
// OPERA tiles at z6..z12 over places, for each of the last 10 days
const now = Date.now();
for (const [n, [lon, lat]] of Object.entries(places)) for (let k = 0; k < 10; k++) {
  const d = new Date(now - k * 864e5).toISOString().slice(0, 10), out = [];
  for (const z of [6, 8, 10, 12]) { const g = await get(`${G}${OP}/default/${d}/GoogleMapsCompatible_Level12/${tile(lon, lat, z)}.png`, true); out.push(`z${z}:${g.r ? g.r.status : "E"}/${g.b ? g.b.length : 0}`); }
  console.log("OPT", n, d, out.join(" "));
}
// night lights: gap-filled newest days at z6/z8 Kyiv + Taipei
for (const L of ["VIIRS_NOAA20_GapFilled_BRDF_Corrected_DayNightBand_Radiance", "VIIRS_NOAA21_GapFilled_BRDF_Corrected_DayNightBand_Radiance", "VIIRS_Black_Marble", "VIIRS_CityLights_2012"])
  for (const [n, [lon, lat]] of Object.entries(places)) {
    const d = /Black/.test(L) ? "2016-01-01" : /City/.test(L) ? "default" : "2026-11-10", ext = /City/.test(L) ? "jpg" : "png", out = [];
    for (const z of [3, 5, 7, 8]) { const g = await get(`${G}${L}/default/${d}/GoogleMapsCompatible_Level8/${tile(lon, lat, z)}.${ext}`, true); out.push(`z${z}:${g.r ? g.r.status : "E"}/${g.b ? g.b.length : 0}`); }
    console.log("NLT", L.slice(0, 28), n, out.join(" "));
  }
// z9 over Level8 -> 404 or overzoom?
await get(`${G}VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/${tile(30.5, 50.45, 9)}.png`);
// Earth Search Sentinel-1 GRD items: are assets public https?
const es = await get("https://earth-search.aws.element84.com/v1/search?collections=sentinel-1-grd&bbox=100.45,13.65,100.65,13.85&limit=1&sortby=-properties.datetime");
if (es.b) try { const f = JSON.parse(es.b).features[0]; console.log("ES1", f.id, f.properties.datetime, JSON.stringify(Object.fromEntries(Object.entries(f.assets).map(([k, v]) => [k, v.href]))).slice(0, 600)); } catch (e) {}
