// Newest imagery helpers (assets/osap-newimg.js): the search box, the source queries, Landsat / HLS / Sentinel-2 / NASA daily
// rows, Sentinel-1 radar and night lights (dates, cloud, licence, tile addresses), the merged newest-first list and the age text. Run: node tests/newimg.test.mjs
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

// Sentinel-1 radar (OPERA RTC-S1 granules from CMR, pictures from GIBS)
ok(T.s1Url([100.55, 13.75], from, to) === "https://cmr.earthdata.nasa.gov/search/granules.json?short_name=OPERA_L2_RTC-S1_V1&point=100.55,13.75&temporal=2026-09-24T00:00:00Z,2026-11-08T12:00:00Z&sort_key=-start_date&page_size=60", "CMR OPERA radar query at the map's middle");
const op = { feed: { entry: [
  { id: "G4404703269-ASF", title: "OPERA_L2_RTC-S1_T062-132019-IW2_20261106T230856Z_20261107T144332Z_S1D_30_v1.0", time_start: "2026-11-06T23:08:56Z" },
  { id: "G4404703213-ASF", title: "OPERA_L2_RTC-S1_T062-132019-IW1_20261106T230855Z_20261107T144332Z_S1C_30_v1.0", time_start: "2026-11-06T23:08:55Z" },
  { id: "bad id", title: "OPERA_L2_RTC-S1_T172-367373-IW2_20261102T112827Z_20261103T050949Z_S1D_30_v1.0", time_start: "2026-11-02T11:28:27Z" },
  { id: "G1", time_start: "nope" }] } };
const S1 = T.s1Rows(op);
ok(S1.length === 2 && S1[0].n === 2 && S1[0].sat === "Sentinel-1D + Sentinel-1C radar" && S1[1].sat === "Sentinel-1D radar", "radar: one row a UTC day, satellites of that day folded: " + S1.map((r) => r.sat).join(" | "));
ok(S1[0].tiles === "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/OPERA_L2_Radiometric_Terrain_Corrected_SAR_Sentinel-1/default/2026-11-06/GoogleMapsCompatible_Level12/{z}/{y}/{x}.png" && S1[0].nz === 12, "radar GIBS tile address for that UTC day");
ok(S1[0].cloud === null && S1[0].lic === "opera" && S1[0].res === "30 m" && S1[0].link === "https://cmr.earthdata.nasa.gov/search/concepts/G4404703269-ASF.html" && S1[1].link === "", "radar row: no cloud figure, OPERA licence, granule link only for a good id");
ok(T.s1Rows(null).length === 0 && T.s1Rows({ feed: {} }).length === 0, "no radar rows from an empty answer");
ok(T.merge([...S1, { id: "c", src: "hls", t: Date.parse("2026-11-05T03:00:00Z"), cloud: 90 }], 20).filter((r) => r.src === "s1").length === 2, "the cloud filter never hides radar (it sees through cloud)");

// Night lights: newest night from GIBS DescribeDomains, the usual lag when it does not answer, baselines always
ok(T.ddUrl("VIIRS_NOAA20_GapFilled_BRDF_Corrected_DayNightBand_Radiance", from, to) === "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/VIIRS_NOAA20_GapFilled_BRDF_Corrected_DayNightBand_Radiance/default/GoogleMapsCompatible_Level8/all/2026-09-24--2026-11-08.xml", "DescribeDomains address");
ok(T.domainEnd("<Domains><DimensionDomain><ows:Identifier>time</ows:Identifier><Domain>2026-10-01/2026-11-03/P1D,2026-11-05/2026-11-11/P1D</Domain></DimensionDomain></Domains>") === "2026-11-11" && T.domainEnd("<x/>") === "" && T.domainEnd(null) === "", "newest day of a time domain");
const n13 = Date.parse("2026-11-13T02:00:00Z"), NR = T.nightRows(n13, { VIIRS_NOAA20_GapFilled_BRDF_Corrected_DayNightBand_Radiance: "2026-11-11", VIIRS_NOAA21_DayNightBand_At_Sensor_Radiance: "2099-01-01" });
ok(NR.length === 14 && NR.filter((r) => r.kind === "base").length === 2 && NR.every((r) => r.src === "night" && r.lic === "nasa" && r.nz === 8), "night: 4 layers x 3 nights + 2 baselines, NASA licence, zoom 8 tiles");
const day = (id) => NR.filter((r) => r.scene.indexOf(id + " ") === 0).map((r) => r.day).join(",");
ok(day("VIIRS_NOAA20_GapFilled_BRDF_Corrected_DayNightBand_Radiance") === "2026-11-11,2026-11-10,2026-11-09", "gap-filled nights from DescribeDomains");
ok(day("VIIRS_NOAA21_GapFilled_BRDF_Corrected_DayNightBand_Radiance") === "2026-11-11,2026-11-10,2026-11-09" && day("VIIRS_NOAA20_DayNightBand_At_Sensor_Radiance") === "2026-11-12,2026-11-11,2026-11-10", "the usual lag when DescribeDomains did not answer (gap-filled 2 days, at-sensor 1 day)");
ok(day("VIIRS_NOAA21_DayNightBand_At_Sensor_Radiance") === "2026-11-13,2026-11-12,2026-11-11", "a future date from the server is capped at today");
ok(NR.find((r) => r.id === "night:VIIRS_Black_Marble").tiles === "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png" &&
  /VIIRS_CityLights_2012\/default\/2012-01-01\/GoogleMapsCompatible_Level8\/\{z\}\/\{y\}\/\{x\}\.jpg$/.test(NR.find((r) => r.id === "night:VIIRS_CityLights_2012").tiles), "baseline tile addresses (Black Marble 2016 PNG, Earth at Night 2012 JPEG)");
const MN = T.merge([...NR, { id: "h", src: "hls", t: Date.parse("2026-11-11T03:00:00Z"), cloud: 5 }], 100), d11 = MN.filter((r) => r.day === "2026-11-11" || r.id === "h");
ok(d11[0].id === "h", "on the same day a scene comes before the night lights");

// age text
ok(T.ageTxt(now - 20 * 60e3, now) === "under an hour old" && T.ageTxt(now - 5 * 36e5, now) === "5 h old" && T.ageTxt(now - 3 * 864e5, now) === "3 days old" && T.ageTxt(now - 40 * 36e5, now) === "2 days old", "age text");
ok(Object.keys(T.LIC).every((k) => /^https:\/\//.test(T.LIC[k].url) && T.LIC[k].tag), "every licence has a tag and a link");

console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
