// Newest imagery helpers (assets/osap-newimg.js): the search box, the source queries, Landsat / HLS / Sentinel-2 / NASA daily
// rows (dates, cloud, licence, tile addresses), the merged newest-first list and the age text. Run: node tests/newimg.test.mjs
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const T = req("../assets/osap-newimg.js"), SAT = req("../assets/osap-sat.js");
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

// search box: the view cut to 1 x 1 degree around its middle
ok(JSON.stringify(T.searchBox([100.4, 13.6, 100.6, 13.8])) === JSON.stringify([100.4, 13.6, 100.6, 13.8]), "a small view is searched as it is");
ok(JSON.stringify(T.searchBox([90, 5, 110, 25])) === JSON.stringify([99.5, 14.5, 100.5, 15.5]), "a big view is cut to 1° around its middle");
ok(T.searchBox(null) === null && T.searchBox([1, 1, 1, 1]) === null && T.searchBox([NaN, 0, 1, 1]) === null, "no box for a broken view");
const bb = [100.45, 13.65, 100.65, 13.85], from = Date.parse("2026-09-24T00:00:00Z"), to = Date.parse("2026-11-08T12:00:00Z");
ok(T.s2Url(bb, from, to) === "https://earth-search.aws.element84.com/v1/search?collections=sentinel-2-l2a&bbox=100.45,13.65,100.65,13.85&datetime=2026-09-24T00:00:00Z/2026-11-08T12:00:00Z&limit=100&sortby=-properties.datetime", "Earth Search GET query");
ok(T.lsUrl(bb, from, to).startsWith("https://planetarycomputer.microsoft.com/api/stac/v1/search?collections=landsat-c2-l2&bbox=100.45,13.65,100.65,13.85&datetime=2026-09-24T00:00:00Z/2026-11-08T12:00:00Z"), "Planetary Computer Landsat query");
ok(T.hlsUrl("L", bb, from, to) === "https://cmr.earthdata.nasa.gov/search/granules.json?short_name=HLSL30&bounding_box=100.45,13.65,100.65,13.85&temporal=2026-09-24T00:00:00Z,2026-11-08T12:00:00Z&sort_key=-start_date&page_size=20", "CMR HLS query");

// Landsat rows (Planetary Computer items as seen on 2026-11-08)
const TJ = "https://planetarycomputer.microsoft.com/api/data/v1/item/tilejson.json?collection=landsat-c2-l2&item=LC09_L2SP_129051_20261025_02_T1&assets=red&assets=green&assets=blue&color_formula=gamma%20RGB%202.7";
const ls = (id, plat, dt, cc, tj) => ({ id, bbox: [99.4, 11.95, 101.5, 14.06], properties: { datetime: dt, platform: plat, "eo:cloud_cover": cc }, assets: { tilejson: { href: tj } } });
const LR = T.lsRows([ls("LC09_L2SP_129051_20261025_02_T1", "landsat-9", "2026-10-25T03:38:15Z", 16.49, TJ), ls("LE07_X", "landsat-7", "2026-10-26T03:00:00Z", 5, TJ),
  ls("LC08_EVIL", "landsat-8", "2026-10-20T03:00:00Z", 5, "https://evil.example/api/data/v1/item/tilejson.json?x=1"), ls("LC08_BAD", "landsat-8", "nope", 5, TJ)]);
ok(LR.length === 1, "only Landsat 8/9 items with a Planetary Computer tile address and a date are kept: " + LR.length);
ok(LR[0].sat === "Landsat 9" && LR[0].res === "30 m" && LR[0].lic === "usgs" && Math.abs(LR[0].cloud - 16.49) < 1e-9, "Landsat row: satellite, resolution, licence, cloud");
ok(LR[0].tiles === "https://planetarycomputer.microsoft.com/api/data/v1/item/tiles/WebMercatorQuad/{z}/{x}/{y}@1x?collection=landsat-c2-l2&item=LC09_L2SP_129051_20261025_02_T1&assets=red&assets=green&assets=blue&color_formula=gamma%20RGB%202.7&nodata=0&format=png", "Landsat tile address (no-data clear, PNG): " + LR[0].tiles);
ok(LR[0].t === Date.parse("2026-10-25T03:38:15Z") && LR[0].bounds.length === 4, "Landsat row keeps the pass time and the scene bounds");

// HLS rows (CMR granules): one row a day, the least cloudy granule's cloud
const cmr = { feed: { entry: [
  { id: "G1234-LPCLOUD", title: "HLS.L30.T47PPR.2026306T033754.v2.0", time_start: "2026-11-02T03:37:54.127Z", cloud_cover: "9" },
  { id: "G1235-LPCLOUD", title: "HLS.L30.T47PQR.2026306T033754.v2.0", time_start: "2026-11-02T03:37:58Z", cloud_cover: "4" },
  { id: "bad id", title: "HLS.L30.T47PPR.2026298T033751.v2.0", time_start: "2026-10-25T03:37:51.533Z", cloud_cover: "40" },
  { id: "G9", time_start: "nope" }] } };
const HR = T.hlsRows("L", cmr);
ok(HR.length === 2 && HR[0].n === 2 && HR[0].cloud === 4, "two HLS days, the same day's granules folded with the clearest cloud");
ok(HR[0].tiles === "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/HLS_L30_Nadir_BRDF_Adjusted_Reflectance/default/2026-11-02/GoogleMapsCompatible_Level12/{z}/{y}/{x}.png", "HLS GIBS tile address for that UTC day");
ok(HR[0].link === "https://cmr.earthdata.nasa.gov/search/concepts/G1234-LPCLOUD.html" && HR[1].link === "", "granule link only for a well-formed CMR id");
ok(T.hlsRows("S", null).length === 0 && T.hlsRows("S", { feed: {} }).length === 0, "no rows from an empty answer");

// Sentinel-2 rows from Earth Search passes
const PS = SAT.groupPasses([{ id: "S2C_47PPR_20261106_0_L2A", properties: { datetime: "2026-11-06T03:54:20Z", "eo:cloud_cover": 56.3, platform: "sentinel-2c", "grid:code": "MGRS-47PPR" },
  assets: { visual: { href: "https://sentinel-cogs.s3.us-west-2.amazonaws.com/x/TCI.tif" } }, links: [] }]);
const SR = T.s2Rows(PS);
ok(SR.length === 1 && SR[0].sat === "Sentinel-2C" && SR[0].res === "10 m" && SR[0].lic === "cop" && SR[0].pass === PS[0], "Sentinel-2 row from a pass: " + SR[0].sat);

// NASA daily rows
const now = Date.parse("2026-11-08T11:00:00Z"), DR = T.dailyRows(now);
ok(DR.length === 9 && DR.filter((r) => r.partial).length === 3 && DR[0].day === "2026-11-08" && DR.every((r) => /NOAA-20|NOAA-21|MODIS Terra/.test(r.sat)), "daily: VIIRS NOAA-20, NOAA-21 and MODIS Terra for today (filling in) and the 2 days before");
ok(DR.every((r) => /^https:\/\/gibs\.earthdata\.nasa\.gov\/wmts\/epsg3857\/best\/\w+\/default\/\d{4}-\d{2}-\d{2}\/GoogleMapsCompatible_Level9\/\{z\}\/\{y\}\/\{x\}\.jpg$/.test(r.tiles)), "daily tile addresses");

// merged list
const M = T.merge([...DR, ...LR, ...HR, ...SR], 100);
ok(M[0].src === "daily" && M[0].day === "2026-11-08", "newest day first");
const d6 = M.filter((r) => /2026-11-06/.test(new Date(r.t).toISOString()));
ok(d6.length === 4 && d6[0].src === "s2" && d6.slice(1).every((r) => r.src === "daily"), "a day with a scene lists the scene before that day's daily pictures");
const days = M.map((r) => new Date(r.t).toISOString().slice(0, 10));
ok(days.every((d, i) => i === 0 || d <= days[i - 1]), "newest first throughout");
const sameDay = T.merge([{ id: "a", src: "daily", t: Date.parse("2026-11-02T12:00:00Z") }, { id: "b", src: "hls", t: Date.parse("2026-11-02T03:37:00Z") }], 100);
ok(sameDay[0].id === "b", "on the same day the sharper scene comes before the daily picture");
const M20 = T.merge([...LR, ...HR, ...SR, ...DR], 20);
ok(M20.every((r) => r.cloud == null || r.cloud <= 20) && !M20.some((r) => r.src === "s2"), "cloud filter keeps 20% or less (and daily, which has no figure)");

// age text
ok(T.ageTxt(now - 20 * 60e3, now) === "under an hour old" && T.ageTxt(now - 5 * 36e5, now) === "5 h old" && T.ageTxt(now - 3 * 864e5, now) === "3 days old" && T.ageTxt(now - 40 * 36e5, now) === "2 days old", "age text");
ok(Object.keys(T.LIC).every((k) => /^https:\/\//.test(T.LIC[k].url) && T.LIC[k].tag), "every licence has a tag and a link");

console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
