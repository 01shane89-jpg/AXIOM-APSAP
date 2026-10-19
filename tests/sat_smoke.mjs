// Headless check of Satellite before/after (assets/osap-sat.js): the Area menu entry and the Map overlays section "Satellite
// imagery" (below Population); with an area drawn the window opens docked beside the map (split view), lists the Sentinel-2
// passes from Earth Search with Zulu and local times and cloud %, picks the newest clear pass as After and the clear pass about
// 30 days earlier as Before, reads the true-colour COGs with geotiff.js by byte ranges and draws them side by side, links each
// scene to its STAC item and credits Copernicus; picking another pass redraws; the swipe mode lays both on the map with a handle
// that moves the cut; NASA GIBS daily true colour asks for the chosen day and sensor; an area too large is refused; external
// text is escaped; closing clears the map. Earth Search, the COG bucket and GIBS are answered here by made-up data (small
// GeoTIFFs written with the vendored geotiff.js, no network); the real hosts were checked from a GitHub runner on 2026-10-19.
// Run from the repo root: node tests/sat_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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

// one-colour UTM 36N GeoTIFFs over Kyiv, 40 x 40 km at 100 m
function cog(rgb) {
  const w = 400, h = 400, v = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) { v[i * 3] = rgb[0]; v[i * 3 + 1] = rgb[1]; v[i * 3 + 2] = rgb[2]; }
  return Buffer.from(G.writeArrayBuffer(v, { width: w, height: h, BitsPerSample: [8, 8, 8], SamplesPerPixel: 3, PhotometricInterpretation: 2, PlanarConfiguration: 1,
    ModelPixelScale: [100, 100, 0], ModelTiepoint: [0, 0, 0, 300000, 5610000, 0], ProjectedCSTypeGeoKey: 32636, GTModelTypeGeoKey: 1, GTRasterTypeGeoKey: 1 }));
}
const COGS = { RED: cog([200, 30, 30]), GREEN: cog([30, 180, 40]), BLUE: cog([30, 40, 200]) };
const S3 = "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/36/U/UA/";
const feat = (id, dt, cc, col) => ({ type: "Feature", id, properties: { datetime: dt, "eo:cloud_cover": cc, platform: id.startsWith("S2B") ? "sentinel-2b" : "sentinel-2a", "grid:code": "MGRS-36UUA" },
  assets: { visual: { href: S3 + id.replace(/[^\w]/g, "") + "/" + col + "/TCI.tif" } }, links: [{ rel: "self", href: "https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/" + encodeURIComponent(id) }] });
const now = Date.now(), iso = (d) => new Date(now - d * 864e5).toISOString();
const FEATS = [
  feat("S2A_36UUA_X1_1_L2A", iso(2), 97, "BLUE"),                  // newest, cloudy
  feat("S2B_36UUA_X2_0_L2A", iso(5), 3.5, "GREEN"),                // newest clear -> After
  feat("S2A_36UUA_X3_0_L2A", iso(20), 40, "BLUE"),
  feat("S2B_36UUA_X4_0_L2A", iso(34), 8, "RED"),                   // clear, about 30 days before After -> Before
  feat("S2A_36UUA_X5<img src=x onerror=window.__xss=1>_0_L2A", iso(60), 1, "BLUE")
];
const STAC = { type: "FeatureCollection", features: FEATS, links: [] };

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const shown = (p, s) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && getComputedStyle(e).display !== "none" && e.getClientRects().length > 0; }, s);
let log = { stac: [], cog: [], ranged: 0, full: 0, gibs: [] };
async function context(opts) {
  const ctx = await browser.newContext({ serviceWorkers: "block", timezoneId: "Asia/Bangkok", ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const q = r.request(), u = q.url();
    if (/^https:\/\/earth-search\.aws\.element84\.com\/v1\/search\?/.test(u)) { log.stac.push(u); return r.fulfill({ status: 200, contentType: "application/geo+json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(STAC) }); }
    if (u.startsWith(S3)) {
      const col = u.split("/").slice(-2)[0], buf = COGS[col]; log.cog.push(col);
      if (!buf) return r.fulfill({ status: 404 });
      const m = /bytes=(\d+)-(\d*)/.exec(q.headers()["range"] || "");
      if (!m) { log.full++; return r.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "image/tiff" }, body: buf }); }
      log.ranged++;
      const a = +m[1], b = Math.min(buf.length - 1, m[2] ? +m[2] : buf.length - 1);
      return r.fulfill({ status: 206, headers: { "access-control-allow-origin": "*", "access-control-expose-headers": "content-range", "content-type": "image/tiff", "content-range": `bytes ${a}-${b}/${buf.length}` }, body: buf.subarray(a, b + 1) });
    }
    if (/gibs\.earthdata\.nasa\.gov\/wmts\/epsg3857\/best\/(VIIRS|MODIS)_/.test(u)) { log.gibs.push(u); return r.fulfill({ status: 404 }); }
    return r.abort();
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  return ctx;
}
async function open(ctx) {
  const p = await ctx.newPage(), errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_SAT, null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
  return { p, errors };
}
// the colour at the middle of each side-by-side picture
const pics = (p) => p.evaluate(() => ["before", "after"].map((k) => {
  const c = document.querySelector('#satba [data-pic="' + k + '"] canvas'); if (!c) return null;
  const d = c.getContext("2d").getImageData(c.width >> 1, c.height >> 1, 1, 1).data; return [d[0], d[1], d[2], d[3]];
}));
const near = (a, b) => !!a && b.every((v, i) => Math.abs(a[i] - v) <= 3);
const AREA = [[50.40, 30.45], [50.50, 30.45], [50.50, 30.60], [50.40, 30.60]];
// ---------- desktop ----------
{
  const ctx = await context({ viewport: { width: 1360, height: 860 } });
  const { p, errors } = await open(ctx);
  ok(log.stac.length === 0 && log.cog.length === 0, "asks nothing until opened");
  ok(await p.evaluate(() => (window.OSAP_AREA_TOOLS || []).some((t) => t.id === "satba" && t.label === "Satellite before/after")), "Area menu entry Satellite before/after");
  await p.evaluate(() => window.OSAP_ATAK.overlays("overlays")); await p.waitForTimeout(400);
  ok(await shown(p, "#atk-om #ml-sat [data-sat-open]") && /Satellite imagery/.test(await p.textContent("#ml-sat .mlh")), "Map overlays > Satellite imagery with Open Satellite before/after");
  ok(await p.evaluate(() => { const a = document.getElementById("ml-pop"), b = document.getElementById("ml-sat"); return !!(a && b && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); }), "Satellite imagery sits below Population");
  ok(await shown(p, "#atk-om #ml-sat input[data-satg=on]"), "NASA daily true colour switch in the section");
  await p.evaluate(() => window.OSAP_ATAK.overlays("overlays")); await p.waitForTimeout(200);
  // draw an area and run the Area menu tool
  await p.evaluate((A) => { window.TSAP.areaApi.setArea(A); window.__asapMap.setView([50.45, 30.525], 11, { animate: false }); }, AREA);
  await p.waitForTimeout(400);
  await p.evaluate(() => window.OSAP_AREA_TOOLS.filter((t) => t.id === "satba")[0].run());
  await p.waitForFunction(() => window.OSAP_SAT.state().passes > 0, null, { timeout: 15000 });
  const st = await p.evaluate(() => window.OSAP_SAT.state());
  ok(await shown(p, "#satba") && await p.evaluate(() => document.getElementById("satba").classList.contains("osplit")), "window open, docked beside the map (split view)");
  ok(st.src === "Drawn area" && log.stac.length === 1 && /bbox=30\.45,50\.4,30\.6,50\.5&datetime=/.test(log.stac[0]) && /collections=sentinel-2-l2a/.test(log.stac[0]), "Earth Search asked for the drawn area's bbox: " + log.stac[0]);
  ok(st.passes === 5 && st.after === "S2B_" + iso(5).slice(0, 10) && st.before === "S2B_" + iso(34).slice(0, 10), "defaults: newest clear pass after, clear pass ~30 days earlier before (" + st.before + " / " + st.after + ")");
  const rows = await p.$$eval("#satba tbody tr", (t) => t.map((r) => r.textContent));
  ok(rows.length === 5 && rows.every((r) => /\d{4}Z \/ \d{2}:\d{2} /.test(r)) && rows.some((r) => /97%/.test(r)) && rows.some((r) => /4%/.test(r)), "pass list with Zulu / local time and cloud %: " + rows[1]);
  await p.waitForFunction(() => document.querySelectorAll("#satba figure canvas").length === 2, null, { timeout: 20000 });
  let px = await pics(p);
  ok(near(px[0], [200, 30, 30, 255]) && near(px[1], [30, 180, 40, 255]), "side by side: before (red COG) and after (green COG) drawn " + JSON.stringify(px));
  ok(log.ranged > 0 && log.full === 0, "COGs read by byte ranges only (" + log.ranged + " range requests)");
  const cap = await p.textContent('#satba [data-pic="after"] figcaption');
  ok(/S2B_36UUA_X2_0_L2A/.test(cap) && /4% cloud/.test(cap) && /Z \/ /.test(cap), "after caption: scene id, Zulu/local time, cloud %: " + cap.trim());
  ok(await p.evaluate(() => [...document.querySelectorAll("#satba figcaption a.sid")].every((a) => /^https:\/\/earth-search\.aws\.element84\.com\/v1\/collections\/sentinel-2-l2a\/items\//.test(a.href) && a.target === "_blank")), "each scene links to its STAC item");
  ok(/Contains modified Copernicus Sentinel data 20\d\d/.test(await p.textContent("#satba .attr")), "Copernicus attribution shown");
  ok(await p.evaluate(() => typeof window.GeoTIFF === "object" && [...document.scripts].some((s) => /assets\/vendor\/geotiff-3\.0\.5\.js$/.test(s.src))), "geotiff.js loaded from assets/vendor on first use");
  if (OUT) await p.screenshot({ path: OUT + "/sat-side.png" });
  // another pass as Before
  await p.click('#satba button[data-pick="before"][data-key="S2A_' + iso(20).slice(0, 10) + '"]');
  await p.waitForFunction(() => { const c = document.querySelector('#satba [data-pic="before"] canvas'); if (!c) return false; const d = c.getContext("2d").getImageData(c.width >> 1, c.height >> 1, 1, 1).data; return d[2] > 150; }, null, { timeout: 15000 });
  ok(await p.evaluate(() => window.OSAP_SAT.state().before) === "S2A_" + iso(20).slice(0, 10), "picking a pass as Before redraws it (blue COG)");
  ok(await p.evaluate(() => window.__xss === undefined && !document.querySelector("#satba img")), "scene ids from the catalogue are escaped");
  // the cloud filter
  await p.selectOption('#satba select[data-sat="maxc"]', "10"); await p.waitForTimeout(300);
  const n10 = await p.$$eval("#satba tbody tr", (t) => t.length);
  ok(n10 === 4, "cloud 10% or less hides cloudy passes except the picked ones (" + n10 + " rows)");
  // swipe
  await p.click('#satba [data-sat-mode="swipe"]');
  await p.waitForFunction(() => document.querySelectorAll(".leaflet-satpane-pane img.satimg").length === 2 && document.querySelector(".satswipe"), null, { timeout: 20000 });
  const c0 = await p.evaluate(() => document.querySelector(".satimg.sata").style.clipPath);
  await p.focus(".satswipe b"); await p.keyboard.press("ArrowLeft"); await p.keyboard.press("ArrowLeft");
  const c1 = await p.evaluate(() => document.querySelector(".satimg.sata").style.clipPath);
  ok(/inset/.test(c0) && c0 !== c1, "swipe: both pictures on the map, the handle moves the cut (" + c0 + " -> " + c1 + ")");
  ok(/Before \d{4}-\d\d-\d\d/.test(await p.textContent(".satswipe .l")) && /After \d{4}-\d\d-\d\d/.test(await p.textContent(".satswipe .r")), "swipe labels before / after dates");
  ok(/Copernicus Sentinel/.test(await p.evaluate(() => document.querySelector(".leaflet-control-attribution").innerHTML)), "Copernicus credited on the map");
  if (OUT) await p.screenshot({ path: OUT + "/sat-swipe.png" });
  // NASA daily
  log.gibs = [];
  await p.check('#satba input[data-satg="on"]'); await p.waitForTimeout(1200);
  ok(log.gibs.length > 0 && log.gibs.every((u) => /VIIRS_NOAA20_CorrectedReflectance_TrueColor\/default\/\d{4}-\d\d-\d\d\/GoogleMapsCompatible_Level9\//.test(u)), "NASA daily on: GIBS VIIRS NOAA-20 tiles for a day (" + (log.gibs[0] || "none") + ")");
  ok(await p.evaluate(() => document.querySelector("#ml-sat input[data-satg=on]").checked), "Map overlays switch follows");
  log.gibs = [];
  await p.click('#satba [data-sat="gafter"]'); await p.waitForTimeout(1200);
  ok(log.gibs.length > 0 && log.gibs.every((u) => u.includes("/" + iso(5).slice(0, 10) + "/")), "Day of the after pass: GIBS date set to " + iso(5).slice(0, 10));
  log.gibs = [];
  await p.selectOption('#ml-sat select[data-satg="layer"]', "MODIS_Terra_CorrectedReflectance_TrueColor"); await p.waitForTimeout(1200);
  ok(log.gibs.length > 0 && log.gibs.every((u) => /MODIS_Terra_/.test(u)), "sensor picker switches to MODIS Terra");
  // a data set change does not switch it off (reference imagery, like Population)
  await p.evaluate(() => { const i = document.querySelector("#ml-ds input[data-ds]"); if (i) i.click(); }); await p.waitForTimeout(1000);
  ok(await p.evaluate(() => window.OSAP_SAT.state().gibs), "NASA daily stays on after a data set change");
  // close clears the before/after from the map
  await p.click('#satba [data-sat="close"]'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => !document.querySelector(".satswipe") && !document.querySelector(".satimg")), "closing clears the swipe from the map");
  await p.evaluate(() => window.OSAP_SAT.gibs(false));
  // too large
  const nStac = log.stac.length;
  await p.evaluate(() => { window.TSAP.areaApi.setArea([[10, 20], [20, 20], [20, 30], [10, 30]]); window.OSAP_SAT.open(); }); await p.waitForTimeout(500);
  ok(/too large/.test(await p.evaluate(() => window.OSAP_SAT.state().err)) && log.stac.length === nStac, "an area too large is refused without asking Earth Search");
  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- phone ----------
{
  log = { stac: [], cog: [], ranged: 0, full: 0, gibs: [] };
  const ctx = await context({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  const { p, errors } = await open(ctx);
  await p.evaluate(() => window.__asapMap.setView([50.45, 30.525], 12, { animate: false })); await p.waitForTimeout(300);
  await p.evaluate(() => window.OSAP_SAT.open());
  await p.waitForFunction(() => document.querySelectorAll("#satba figure canvas").length === 2, null, { timeout: 20000 });
  ok(await p.evaluate(() => window.OSAP_SAT.state().src) === "Map view", "phone: with no area drawn it uses the map view");
  const hgt = await p.evaluate(() => Math.min(...[...document.querySelectorAll("#satba td button, #satba .seg button")].map((b) => b.getBoundingClientRect().height)));
  const fs = await p.evaluate(() => getComputedStyle(document.querySelector('#satba select[data-sat="maxc"]')).fontSize);
  ok(hgt >= 40 && fs === "16px", "phone: buttons at least 40 px (" + hgt + "), inputs 16 px (" + fs + ")");
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "phone: no sideways scroll");
  if (OUT) await p.screenshot({ path: OUT + "/sat-phone.png" });
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
