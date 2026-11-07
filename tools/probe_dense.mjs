// PROBE BRANCH ONLY: WMS GetCapabilities for open radar services; lists layer names and time extents.
import fs from "node:fs";
const C = [
  ["nowcoast-root", "https://nowcoast.noaa.gov/geoserver/ows?service=WMS&request=GetCapabilities&version=1.3.0"],
  ["nowcoast-radar", "https://nowcoast.noaa.gov/geoserver/weather_radar/wms?service=WMS&request=GetCapabilities&version=1.3.0"],
  ["nowcoast-obs", "https://nowcoast.noaa.gov/geoserver/observations/wms?service=WMS&request=GetCapabilities&version=1.3.0"],
  ["geomet", "https://geo.weather.gc.ca/geomet?service=WMS&version=1.3.0&request=GetCapabilities&layer=RADAR_1KM_RRAI"],
  ["geomet-dbzh", "https://geo.weather.gc.ca/geomet?service=WMS&version=1.3.0&request=GetCapabilities&layer=RADAR_1KM_RDBR"],
  ["dwd", "https://maps.dwd.de/geoserver/dwd/wms?service=WMS&version=1.3.0&request=GetCapabilities"],
  ["mrms-mapservices", "https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity/MapServer?f=pjson"],
  ["gibs-imerg", "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml"],
];
const out = [];
for (const [id, url] of C) {
  try {
    const r = await fetch(url, { headers: { "user-agent": "AXIOM-OSAP/1.0 (probe)" }, signal: AbortSignal.timeout(60000) });
    const t = await r.text();
    const names = [...t.matchAll(/<(?:Name|ows:Identifier)>([^<]+)<\/(?:Name|ows:Identifier)>/g)].map((m) => m[1]).filter((n) => /radar|reflect|precip|rain|niederschlag|rv|ry|wn|imerg|rdbr|rrai|mrms|qpe/i.test(n));
    const dims = [...t.matchAll(/<Dimension[^>]*name="time"[^>]*>([^<]{0,160})/g)].map((m) => m[1]).slice(0, 8);
    out.push({ id, url, status: r.status, ctype: r.headers.get("content-type"), cors: r.headers.get("access-control-allow-origin"), bytes: t.length, names: [...new Set(names)].slice(0, 80), dims, head: names.length ? undefined : t.slice(0, 300) });
  } catch (e) { out.push({ id, url, error: e.message }); }
}
fs.mkdirSync("probe-out", { recursive: true });
fs.writeFileSync("probe-out/dense.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1).slice(0, 60000));
