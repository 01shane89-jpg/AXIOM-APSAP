// Headless check of Newest imagery (assets/osap-newimg.js): the first row of Map overlays > Satellite imagery opens a docked
// window that lists, newest first, the Sentinel-2 passes (Earth Search), Landsat 8/9 scenes (Planetary Computer), HLS days (NASA
// CMR), Sentinel-1 radar days (NASA OPERA via CMR + GIBS), VIIRS night lights and NASA daily pictures over the middle of the map, each with Zulu / local date, age, cloud % and a licence tag; Show
// lays the picture on the map in its own pane (kept on conflict tabs) with a date badge; Sentinel-2 is drawn from the COG;
// a failing source says so while the others still show; the sold version asks nothing of Planetary Computer; catalogue text is
// escaped; Remove clears the map. Every host is answered here with made-up data (no network); the real hosts were checked
// from a GitHub runner on 2026-11-08 (tools/probe_newest_imagery.mjs).
// Run from the repo root: node tests/newimg_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright";
const G = createRequire(import.meta.url)("../assets/vendor/geotiff-3.0.5.js");
const OUT = process.env.OUT || "";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const PNG = await readFile(join(root, "assets/logo-mark.png"));

// one-colour UTM 36N GeoTIFF over Kyiv, 40 x 40 km at 100 m
const w = 400, h = 400, v = new Uint8Array(w * h * 3);
for (let i = 0; i < w * h; i++) { v[i * 3] = 30; v[i * 3 + 1] = 180; v[i * 3 + 2] = 40; }
const COG = Buffer.from(G.writeArrayBuffer(v, { width: w, height: h, BitsPerSample: [8, 8, 8], SamplesPerPixel: 3, PhotometricInterpretation: 2, PlanarConfiguration: 1,
  ModelPixelScale: [100, 100, 0], ModelTiepoint: [0, 0, 0, 300000, 5610000, 0], ProjectedCSTypeGeoKey: 32636, GTModelTypeGeoKey: 1, GTRasterTypeGeoKey: 1 }));
const now = Date.now(), iso = (d) => new Date(now - d * 864e5).toISOString();
const S3 = "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/36/U/UA/";
const ES = { type: "FeatureCollection", links: [], features: [
  { type: "Feature", id: "S2B_36UUA_N1_0_L2A", properties: { datetime: iso(1.2), "eo:cloud_cover": 12, platform: "sentinel-2b", "grid:code": "MGRS-36UUA" }, assets: { visual: { href: S3 + "N1/TCI.tif" } }, links: [] }] };
const TJ = "https://planetarycomputer.microsoft.com/api/data/v1/item/tilejson.json?collection=landsat-c2-l2&item=LC09_TEST&assets=red&assets=green&assets=blue";
const PC = { type: "FeatureCollection", features: [
  { id: "LC09_TEST", bbox: [29.5, 49.5, 31.5, 51.5], properties: { datetime: iso(3.1), platform: "landsat-9", "eo:cloud_cover": 7 }, assets: { tilejson: { href: TJ } } },
  { id: "LC08_<img src=x onerror=window.__xss=1>", bbox: [29.5, 49.5, 31.5, 51.5], properties: { datetime: iso(9), platform: "landsat-8", "eo:cloud_cover": 30 }, assets: { tilejson: { href: TJ } } }] };
const OPC = { feed: { entry: [{ id: "G200-ASF", title: "OPERA_L2_RTC-S1_T036-075952-IW2_X_Y_S1C_30_v1.0", time_start: iso(2.3) }, { id: "G201-ASF", title: "OPERA_L2_RTC-S1_T036-075951-IW2_X_Y_S1D_30_v1.0", time_start: iso(2.3) }] } };
const DD = (d) => `<Domains><DimensionDomain><ows:Identifier>time</ows:Identifier><Domain>2026-10-01/${d}/P1D</Domain></DimensionDomain></Domains>`;
const CMR = (k) => ({ feed: { entry: [{ id: "G100-LPCLOUD", title: "HLS." + k + "30.T36UUA.X.v2.0", time_start: iso(k === "L" ? 5 : 6), cloud_cover: "15" }] } });

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
let log;
const CORS = { "access-control-allow-origin": "*" };
async function context(opts, cfg = {}) {
  log = { es: [], pc: [], pct: [], cmr: [], gibs: [], dd: [], cog: 0 };
  const ctx = await browser.newContext({ serviceWorkers: "block", timezoneId: "Europe/Kyiv", ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const q = r.request(), u = q.url();
    if (u.startsWith("https://earth-search.aws.element84.com/v1/search?")) { log.es.push(u); return r.fulfill({ status: 200, contentType: "application/geo+json", headers: CORS, body: JSON.stringify(ES) }); }
    if (u.startsWith("https://planetarycomputer.microsoft.com/api/stac/v1/search?")) { log.pc.push(u); return cfg.pcDown ? r.fulfill({ status: 503, headers: CORS, body: "down" }) : r.fulfill({ status: 200, contentType: "application/geo+json", headers: CORS, body: JSON.stringify(PC) }); }
    if (u.startsWith("https://planetarycomputer.microsoft.com/api/data/v1/item/tiles/")) { log.pct.push(u); return r.fulfill({ status: 200, contentType: "image/png", headers: CORS, body: PNG }); }
    if (u.startsWith("https://cmr.earthdata.nasa.gov/search/granules.json?short_name=OPERA_L2_RTC-S1_V1&")) { log.cmr.push(u); return cfg.s1Down ? r.fulfill({ status: 500, headers: CORS, body: "x" }) : r.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify(OPC) }); }
    if (/^https:\/\/gibs\.earthdata\.nasa\.gov\/wmts\/epsg3857\/best\/1\.0\.0\/.*\.xml$/.test(u)) { log.dd.push(u); return r.fulfill({ status: 200, contentType: "text/xml", headers: CORS, body: DD(new Date(now - 3 * 864e5).toISOString().slice(0, 10)) }); }
    if (u.startsWith("https://cmr.earthdata.nasa.gov/search/granules.json?")) { log.cmr.push(u); const k = /short_name=HLS([LS])30/.exec(u)[1]; return r.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify(CMR(k)) }); }
    if (u.startsWith("https://gibs.earthdata.nasa.gov/")) { log.gibs.push(u); return r.fulfill({ status: 200, contentType: "image/png", headers: CORS, body: PNG }); }
    if (u.startsWith(S3)) {
      log.cog++;
      const m = /bytes=(\d+)-(\d*)/.exec(q.headers()["range"] || "");
      if (!m) return r.fulfill({ status: 200, headers: { ...CORS, "content-type": "image/tiff" }, body: COG });
      const a = +m[1], b = Math.min(COG.length - 1, m[2] ? +m[2] : COG.length - 1);
      return r.fulfill({ status: 206, headers: { ...CORS, "access-control-expose-headers": "content-range", "content-type": "image/tiff", "content-range": `bytes ${a}-${b}/${COG.length}` }, body: COG.subarray(a, b + 1) });
    }
    return r.abort();
  });
  await ctx.addInitScript((sold) => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} if (sold) { let v = true; Object.defineProperty(window, "OSAP_SOLD", { get: () => v, set: () => {}, configurable: true }); } }, !!cfg.sold);
  return ctx;
}
async function open(ctx) {
  const p = await ctx.newPage(), errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_NEWIMG, null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
  await p.evaluate(() => window.__asapMap.setView([50.45, 30.525], 11, { animate: false })); await p.waitForTimeout(300);
  return { p, errors };
}
const settled = (p) => p.waitForFunction(() => { const s = window.OSAP_NEWIMG.state().st; return ["s2", "ls", "hls", "s1"].every((k) => s[k] && !s[k].busy); }, null, { timeout: 20000 });
// ---------- desktop ----------
{
  const ctx = await context({ viewport: { width: 1360, height: 860 } });
  const { p, errors } = await open(ctx);
  ok(log.es.length + log.pc.length + log.cmr.length === 0, "asks nothing until opened");
  await p.evaluate(() => window.OSAP_ATAK.overlays("overlays")); await p.waitForTimeout(400);
  ok(await p.evaluate(() => { const s = document.getElementById("ml-sat"), r = document.getElementById("ml-nimg"); return !!(s && r && s.contains(r) && s.querySelector(".mlh").nextElementSibling === r); }), "Newest imagery here is the first row of Map overlays > Satellite imagery");
  await p.evaluate(() => { document.querySelector("#ml-nimg [data-nimg-open]").click(); window.OSAP_ATAK.overlays("overlays"); });
  await settled(p);
  ok(await p.evaluate(() => document.getElementById("nimg").classList.contains("osplit")), "window docked beside the map (split view)");
  ok(log.es.length === 1 && /bbox=30\.\d+,50\.\d+,30\.\d+,50\.\d+/.test(log.es[0]) && log.pc.length === 1 && /landsat-c2-l2/.test(log.pc[0]) && log.cmr.length === 3 && log.cmr.some((u) => /OPERA_L2_RTC-S1_V1&point=30\.\d+,50\.\d+/.test(u)), "asked Earth Search, Planetary Computer and CMR (L30 + S30 + OPERA radar) for the map's middle");
  const L = await p.evaluate(() => window.OSAP_NEWIMG.list());
  const srcs = [...new Set(L.map((r) => r.src))].sort().join(",");
  ok(srcs === "daily,hls,ls,night,s1,s2", "all sources listed (with Sentinel-1 radar and night lights): " + srcs);
  ok(L.every((r, i) => i === 0 || new Date(r.t).toISOString().slice(0, 10) <= new Date(L[i - 1].t).toISOString().slice(0, 10)), "newest first");
  const rows = await p.$$eval("#nimg tbody tr", (t) => t.map((r) => r.textContent));
  ok(rows.length === L.filter((r) => r.src !== "daily" && r.src !== "night").length && rows.filter((r) => /Sentinel-2B|Landsat 9|HLS/.test(r)).every((r) => /\d{4}Z \/ \d{2}:\d{2} /.test(r) && /old/.test(r)), "scene rows show Zulu / local time and age: " + rows.find((r) => /Landsat 9/.test(r)));
  ok(await p.evaluate(() => [...document.querySelectorAll("#nimg tbody tr")].every((tr) => { const a = tr.querySelector("a.tag"); return a && /^https:\/\//.test(a.href) && a.textContent.trim(); })), "every row has a licence tag with a link");
  ok(await p.evaluate(() => document.querySelectorAll('#nimg button[data-nimg-show^="daily:"]').length) === 9, "NASA daily: 9 buttons (3 sensors, 3 days)");
  await p.waitForFunction(() => window.OSAP_NEWIMG.list().some((r) => r.id.indexOf("night:VIIRS_NOAA20_GapFilled") === 0), null, { timeout: 10000 });
  ok(log.dd.length === 4, "asked GIBS DescribeDomains once for each of the 4 nightly layers (" + log.dd.length + ")");
  const ng = await p.$$eval('#nimg button[data-nimg-show^="night:"]', (b) => b.map((x) => x.getAttribute("data-nimg-show")));
  const d3 = new Date(now - 3 * 864e5).toISOString().slice(0, 10);
  ok(ng.length === 14 && ng.includes("night:VIIRS_NOAA20_GapFilled_BRDF_Corrected_DayNightBand_Radiance:" + d3) && ng.includes("night:VIIRS_Black_Marble"), "night lights: 4 layers x 3 nights from DescribeDomains + 2 baselines (" + ng.length + ")");
  const s1r = await p.$$eval("#nimg tbody tr", (t) => t.map((r) => r.textContent).filter((x) => /radar/.test(x)));
  ok(s1r.length === 1 && /Sentinel-1C \+ Sentinel-1D radar/.test(s1r[0]) && /Open \(NASA \+ Copernicus\)/.test(s1r[0]) && /2 days old/.test(s1r[0]), "radar row: both satellites, age and OPERA licence tag: " + (s1r[0] || "none"));
  ok(/not a photo/.test(await p.textContent("#nimg")), "radar is explained (not a photo)");
  ok(await p.evaluate(() => { const c = document.querySelector("#nimg .cbox"); return c.scrollWidth <= c.clientWidth + 1; }), "the list fits the docked window (no sideways overflow)");
  ok(/Copernicus Sentinel data/.test(await p.textContent("#nimg .attr")) && /Geological Survey/.test(await p.textContent("#nimg .attr")), "credits shown");
  ok(await p.evaluate(() => window.__xss === undefined && !document.querySelector("#nimg img")), "catalogue text escaped");
  if (OUT) await p.screenshot({ path: OUT + "/newimg-list.png" });
  // Landsat on the map
  const ls = L.find((r) => r.src === "ls" && r.sat === "Landsat 9");
  await p.click(`#nimg [data-nimg-show="${ls.id}"]`); await p.waitForTimeout(1500);
  ok(log.pct.length > 0 && log.pct.every((u) => /item=LC09_TEST/.test(u) && /nodata=0/.test(u) && /format=png/.test(u)), "Landsat drawn from Planetary Computer item tiles (" + log.pct.length + ")");
  ok(await p.evaluate(() => document.querySelectorAll(".leaflet-nimgpane-pane img.leaflet-tile").length > 0), "tiles in their own pane");
  const b1 = await p.textContent(".nimgbadge");
  ok(/Landsat 9/.test(b1) && /\d{4}Z/.test(b1) && /3 days old/.test(b1) && /7% cloud/.test(b1) && /Public domain/.test(b1), "date badge on the map: " + b1.trim());
  ok(await p.evaluate(() => /Geological Survey/.test(document.querySelector(".leaflet-control-attribution").innerHTML)), "USGS credited on the map");
  // conflict tabs keep the pane
  ok(await p.evaluate(() => { document.documentElement.setAttribute("data-cf", "test"); const d = getComputedStyle(document.querySelector(".leaflet-nimgpane-pane")).display; document.documentElement.removeAttribute("data-cf"); return d !== "none"; }), "conflict tabs keep the imagery pane");
  if (OUT) await p.screenshot({ path: OUT + "/newimg-landsat.png" });
  // Sentinel-2 from the COG
  const s2 = L.find((r) => r.src === "s2");
  await p.click(`#nimg [data-nimg-show="${s2.id}"]`);
  await p.waitForFunction(() => document.querySelector(".leaflet-nimgpane-pane img.osap-nimg.leaflet-image-layer"), null, { timeout: 20000 });
  ok(log.cog > 0 && await p.evaluate(() => document.querySelectorAll(".leaflet-nimgpane-pane img.leaflet-tile").length === 0), "Sentinel-2 drawn from the COG; the Landsat tiles are gone");
  const b2 = await p.textContent(".nimgbadge");
  ok(/Sentinel-2B/.test(b2) && /(28|29) h old/.test(b2) && /12% cloud/.test(b2) && /Copernicus open/.test(b2), "badge follows the picture: " + b2.trim());
  // HLS and daily from GIBS
  const hl = L.find((r) => r.src === "hls"); log.gibs = [];
  await p.click(`#nimg [data-nimg-show="${hl.id}"]`); await p.waitForTimeout(1200);
  ok(log.gibs.length > 0 && log.gibs.every((u) => /HLS_[LS]30_Nadir_BRDF_Adjusted_Reflectance\/default\/\d{4}-\d\d-\d\d\/GoogleMapsCompatible_Level12\//.test(u)), "HLS from GIBS for its day: " + (log.gibs[0] || "none"));
  const dl = L.find((r) => r.src === "daily"); log.gibs = [];
  await p.click(`#nimg [data-nimg-show="${dl.id}"]`); await p.waitForTimeout(200); await p.waitForTimeout(1200);
  ok(log.gibs.length > 0 && /still filling in/.test(await p.textContent(".nimgbadge")), "today's NASA daily picture says it is still filling in");
  // Sentinel-1 radar from GIBS OPERA
  const s1 = L.find((r) => r.src === "s1"); log.gibs = [];
  await p.click(`#nimg [data-nimg-show="${s1.id}"]`); await p.waitForTimeout(1200);
  ok(log.gibs.length > 0 && log.gibs.every((u) => /OPERA_L2_Radiometric_Terrain_Corrected_SAR_Sentinel-1\/default\/\d{4}-\d\d-\d\d\/GoogleMapsCompatible_Level12\//.test(u)), "radar from GIBS OPERA for its day: " + (log.gibs[0] || "none"));
  const b3 = await p.textContent(".nimgbadge");
  ok(/Sentinel-1C \+ Sentinel-1D radar/.test(b3) && /2 days old/.test(b3) && /radar, all passes that UTC day/.test(b3) && !/cloud/.test(b3) && /NASA \+ Copernicus/.test(b3), "radar badge: " + b3.trim());
  ok(await p.evaluate(() => /OPERA; contains modified Copernicus Sentinel data/.test(document.querySelector(".leaflet-control-attribution").innerHTML)), "OPERA + Copernicus credited on the map");
  // night lights from GIBS, newest gap-filled night, then the 2016 baseline
  log.gibs = [];
  await p.click(`#nimg [data-nimg-show="night:VIIRS_NOAA20_GapFilled_BRDF_Corrected_DayNightBand_Radiance:${d3}"]`); await p.waitForTimeout(1200);
  ok(log.gibs.some((u) => u.indexOf("VIIRS_NOAA20_GapFilled_BRDF_Corrected_DayNightBand_Radiance/default/" + d3 + "/GoogleMapsCompatible_Level8/") > 0), "night lights tiles for that night: " + (log.gibs[0] || "none"));
  const b4 = await p.textContent(".nimgbadge");
  ok(/NOAA-20 gap-filled night lights/.test(b4) && b4.includes(d3 + " (UTC night)") && /Public domain/.test(b4), "night badge: " + b4.trim());
  await p.click('#nimg [data-nimg-show="night:VIIRS_Black_Marble"]'); await p.waitForTimeout(600);
  ok(/Black Marble 2016/.test(await p.textContent(".nimgbadge")) && /2016 annual composite \(before\)/.test(await p.textContent(".nimgbadge")), "baseline badge says it is the 2016 before picture");
  if (OUT) await p.screenshot({ path: OUT + "/newimg-night.png" });
  // cloud filter
  await p.selectOption('#nimg select[data-nimg="maxc"]', "20"); await p.waitForTimeout(200);
  ok(await p.evaluate(() => window.OSAP_NEWIMG.list().every((r) => r.cloud == null || r.cloud <= 20)), "cloud filter 20%");
  // remove
  await p.evaluate(() => document.querySelector('.nimgbadge [data-nimg="clear"]').click()); await p.waitForTimeout(300);
  ok(await p.evaluate(() => !document.querySelector(".nimgbadge") && !document.querySelector(".leaflet-nimgpane-pane img")), "× on the badge removes the picture and the badge");
  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- one source down ----------
{
  const ctx = await context({ viewport: { width: 1200, height: 800 } }, { pcDown: true });
  const { p, errors } = await open(ctx);
  await p.evaluate(() => window.OSAP_NEWIMG.open()); await settled(p);
  const st = await p.evaluate(() => window.OSAP_NEWIMG.state().st);
  ok(/503/.test(st.ls.err || "") && /Planetary Computer answered 503/.test(await p.textContent("#nimg .srcs")), "a failing source says so: " + st.ls.err);
  ok(await p.evaluate(() => { const s = new Set(window.OSAP_NEWIMG.list().map((r) => r.src)); return s.has("s2") && s.has("hls") && s.has("daily") && !s.has("ls"); }), "the other sources still listed");
  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- radar source down ----------
{
  const ctx = await context({ viewport: { width: 1200, height: 800 } }, { s1Down: true });
  const { p, errors } = await open(ctx);
  await p.evaluate(() => window.OSAP_NEWIMG.open()); await settled(p);
  ok(/NASA CMR \(OPERA\) answered 500/.test(await p.textContent("#nimg .srcs")) && await p.evaluate(() => window.OSAP_NEWIMG.list().some((r) => r.src === "s2")), "radar down: it says so and the other pictures still show");
  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- the Night lights button ----------
{
  const ctx = await context({ viewport: { width: 1200, height: 800 } });
  const { p, errors } = await open(ctx);
  await p.evaluate(() => window.OSAP_ATAK.overlays("overlays")); await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('#ml-nimg [data-nimg-open="night"]').click()); await settled(p);
  ok(await p.evaluate(() => window.OSAP_NEWIMG.isOpen() && !!document.getElementById("nimg-night")), "Map overlays > Satellite imagery > Night lights opens the window at the night lights");
  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- sold version ----------
{
  const ctx = await context({ viewport: { width: 1200, height: 800 } }, { sold: true });
  const { p, errors } = await open(ctx);
  await p.evaluate(() => window.OSAP_NEWIMG.open()); await settled(p);
  ok(log.pc.length === 0 && log.cmr.length === 3 && /not in this version/.test(await p.textContent("#nimg .srcs")), "sold version: no Planetary Computer, Landsat through HLS");
  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- phone ----------
{
  const ctx = await context({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  const { p, errors } = await open(ctx);
  await p.evaluate(() => window.OSAP_NEWIMG.open()); await settled(p);
  const hgt = await p.evaluate(() => Math.min(...[...document.querySelectorAll("#nimg td button, #nimg .row button")].map((b) => b.getBoundingClientRect().height)));
  ok(hgt >= 40, "phone: buttons at least 40 px (" + hgt + ")");
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "phone: no sideways scroll");
  if (OUT) await p.screenshot({ path: OUT + "/newimg-phone.png" });
  const id = await p.evaluate(() => window.OSAP_NEWIMG.list().find((r) => r.src === "hls").id);
  await p.evaluate((id) => { window.OSAP_NEWIMG.show(id); window.OSAP_NEWIMG.close(); }, id); await p.waitForTimeout(500);
  const bb = await p.evaluate(() => { const r = document.querySelector(".nimgbadge").getBoundingClientRect(); return [r.left, r.right, window.innerWidth]; });
  ok(bb[0] >= 0 && bb[1] <= bb[2], "phone: the badge fits on screen " + JSON.stringify(bb));
  if (OUT) await p.screenshot({ path: OUT + "/newimg-phone-map.png" });
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
