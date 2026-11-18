// Pure checks of Land, sea and night lights (assets/osap-reflayers.js): the newest night, date shifts, the GIBS night lights
// URL, and the land cover request for a map tile (Web Mercator box, year window, renderer).
// Run from the repo root: node tests/ref_layers.test.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
const ctx = { Math, Date, JSON, Object, String, encodeURIComponent, Promise };
ctx.window = ctx; ctx.document = {};
vm.runInNewContext(readFileSync("assets/osap-reflayers.js", "utf8"), ctx);
const t = ctx.OSAP_REF_LAYERS._t;
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
ok(t.latestNight(Date.UTC(2026, 10, 18, 7)) === "2026-11-15", "the newest night is three days back (GIBS runs two to three days behind)");
ok(t.shift("2026-11-15", 30) === "2026-10-16" && t.shift("2026-03-01", 1) === "2026-02-28" && t.shift("2026-11-15", 365) === "2025-11-15", "date shifts for compare");
ok(t.nightUrl("2026-11-15") === "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_GapFilled_BRDF_Corrected_DayNightBand_Radiance/default/2026-11-15/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png", "night lights URL names the layer, date and Level8 matrix");
const R = 20037508.342789244, b = t.tileBox(1, 1, 0);
ok(Math.abs(b[0]) < 1e-6 && Math.abs(b[1]) < 1e-6 && Math.abs(b[2] - R) < 1e-6 && Math.abs(b[3] - R) < 1e-6, "tile 1/1/0 is the north-east quarter of the world");
const u = new URL(t.lcUrl(12, 3186, 1890, 2024, 512));
ok(u.origin + u.pathname === "https://ic.imagery1.arcgis.com/arcgis/rest/services/Sentinel2_10m_LandCover/ImageServer/exportImage", "land cover asks the Living Atlas image service");
ok(u.searchParams.get("time") === Date.UTC(2024, 0, 1) + "," + (Date.UTC(2025, 0, 1) - 1), "land cover time window is the chosen calendar year");
ok(u.searchParams.get("size") === "512,512" && u.searchParams.get("bboxSR") === "3857" && u.searchParams.get("imageSR") === "3857" && u.searchParams.get("f") === "image", "land cover asks a Web Mercator square image");
ok(JSON.parse(u.searchParams.get("renderingRule")).rasterFunction === "Cartographic Renderer for Visualization and Analysis", "land cover uses the class colours renderer");
const bb = u.searchParams.get("bbox").split(",").map(Number), tb = t.tileBox(12, 3186, 1890);
ok(bb.every((v, i) => Math.abs(v - tb[i]) < 0.01), "land cover box is the map tile's box");
ok(t.CLASSES.length === 9 && t.LC_FIRST === 2017 && t.LC_LAST >= 2024, "nine land cover classes, years from 2017");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
