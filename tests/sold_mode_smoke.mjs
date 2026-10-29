// The sold version's app switch (assets/osap-sold.js): with WebGL off, so the vector base map cannot start and its raster
// stand-in would load, the normal app asks tile.openstreetmap.org and the sold app does not. The sold app also leaves out
// EOX's hosted satellite tiles, OpenTopoMap and the free OSRM / FOSSGIS routers unless its build names its own hosts
// (tools/netlify_build.mjs writes window.OSAP_SOLD_HOSTS). Writes nothing.
// Run from the repo root: node tests/sold_mode_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const SOLD_JS = readFileSync("assets/osap-sold.js", "utf8");
const OWN = { sat: "https://sat.example.test/{z}/{x}/{y}.jpg", osrm: "https://osrm.example.test/" };

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".css": "text/css", ".webmanifest": "application/manifest+json" };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(process.cwd(), path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ["--disable-webgl", "--disable-3d-apis"] });
let failed = 0;
const check = (ok, m) => { console.log((ok ? "PASS " : "FAIL ") + m); if (!ok) failed++; };

async function run(sold, hosts) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, serviceWorkers: "block" });
  const errors = [], osm = [], esri = [], esriLp = [], eox = [], otm = [], rtr = [], own = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    if (/tile\.openstreetmap\.org/.test(u)) osm.push(u);
    if (/arcgis(online)?\.com/.test(u)) esri.push(u);
    if (/^https:\/\/(i?basemaps-api|static-map-tiles-api|basemapstyles-api)\.arcgis\.com\/.*[?&]token=TESTKEY/.test(u)) esriLp.push(u);
    if (/tiles\.maps\.eox\.at/.test(u)) eox.push(u);
    if (/opentopomap\.org/.test(u)) otm.push(u);
    if (/routing\.openstreetmap\.de|router\.project-osrm\.org|valhalla1\.openstreetmap\.de/.test(u)) rtr.push(u);
    if (/example\.test/.test(u)) own.push(u);
    return r.abort();
  });
  const js = SOLD_JS.replace("window.OSAP_SOLD = false;", "window.OSAP_SOLD = " + sold + ";").replace("window.OSAP_SOLD_HOSTS = {};", "window.OSAP_SOLD_HOSTS = " + JSON.stringify(hosts || {}) + ";");
  await page.route("**/assets/osap-sold.js", (r) => r.fulfill({ contentType: "text/javascript", body: js }));
  await page.addInitScript(() => { localStorage.setItem("osap-home", JSON.stringify("map")); localStorage.setItem("asap-map-layers", JSON.stringify({ base: "streets" })); });
  await page.goto(base + "#th");
  await page.waitForFunction(() => window.__asapMap && window.OSAP_BASEMAP, null, { timeout: 30000 });
  await page.evaluate(() => window.__asapMap.setView([13.75, 100.5], 12, { animate: false }));
  await page.waitForTimeout(6000);
  const flag = await page.evaluate(() => window.OSAP_SOLD);
  const bases = await page.evaluate(() => window.OSAP_BASEMAP.list().map((b) => b.id));
  const routers = await page.evaluate(() => ["osrm", "osrmDemo", "valhalla"].map((k) => window.OSAP_HOST(k)));
  const hs = await page.evaluate(() => [...document.querySelectorAll("#ml-panel input[data-hs]")].map((i) => i.dataset.hs));
  /* the Topographic and Satellite maps, where offered (Topographic stays raster in the normal app, so it loads with WebGL off) */
  await page.evaluate(() => window.OSAP_BASEMAP.set("topo"));
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.OSAP_BASEMAP.set("sat"));
  await page.waitForTimeout(2500);
  await page.close();
  return { flag, bases, hs, routers, osm: osm.length, esri: esri.length, esriLp: esriLp.length, eox: eox.length, otm: otm.length, rtr: rtr.length, own: own.length, errors };
}

const normal = await run(false), sold = await run(true), soldOwn = await run(true, OWN);
const soldEsri = await run(true, { esriKey: "TESTKEY_abcdefghijklmnopqrstuvwxyz" });
check(normal.flag === false && sold.flag === true, "the switch reaches the page (normal " + normal.flag + ", sold " + sold.flag + ")");
check(normal.osm > 0, "normal app: no WebGL, so the OpenStreetMap raster stand-in loads (" + normal.osm + " tile requests)");
check(sold.osm === 0, "sold app: no tile.openstreetmap.org request (" + sold.osm + ")");
check(sold.esri === 0, "sold app: no Esri request (" + sold.esri + ")");
check(!sold.errors.length, "sold app: no page errors " + sold.errors.slice(0, 3).join(" | "));
check(normal.otm > 0 && normal.esri > 0, "normal app: Topographic asks OpenTopoMap (" + normal.otm + ") and Satellite asks Esri World Imagery (" + normal.esri + ")");
check(["sat", "hybrid", "clarity", "offline"].every((k) => normal.bases.indexOf(k) >= 0), "normal app: Satellite, Hybrid, second look and Offline map offered (" + normal.bases.join(",") + ")");
check(sold.bases.indexOf("hybrid") < 0 && sold.bases.indexOf("clarity") < 0 && sold.hs.indexOf("world") < 0, "sold app: no Esri Hybrid, second look or hillshade (" + sold.bases.join(",") + "; shading " + sold.hs.join(",") + ")");
check(sold.otm === 0 && sold.eox === 0, "sold app: no OpenTopoMap (" + sold.otm + ") or EOX (" + sold.eox + ") request");
check(sold.bases.indexOf("topo") >= 0 && sold.bases.indexOf("sat") < 0 && sold.bases.indexOf("offline") < 0,
  "sold app with no imagery host: Topographic offered (vector), Satellite and Offline map left out (" + sold.bases.join(",") + ")");
check(normal.routers.every(Boolean), "normal app: the free routers are named (" + normal.routers.join(", ") + ")");
check(sold.routers.every((x) => x === "") && sold.rtr === 0, "sold app: no free router named or asked (" + sold.rtr + " requests)");
check(soldOwn.bases.indexOf("sat") >= 0 && soldOwn.bases.indexOf("offline") >= 0 && soldOwn.own > 0 && soldOwn.eox === 0,
  "sold app with its own imagery host: Satellite back on that host (" + soldOwn.own + " requests), still no EOX (" + soldOwn.eox + ")");
check(soldOwn.esri === 0, "sold app with its own imagery host: no Esri request (" + soldOwn.esri + ")");
check(soldOwn.routers[0] === OWN.osrm && soldOwn.routers[1] === "" && soldOwn.routers[2] === "", "sold app with its own OSRM: only that router (" + soldOwn.routers.join(", ") + ")");
check(!soldOwn.errors.length, "sold app with own hosts: no page errors " + soldOwn.errors.slice(0, 3).join(" | "));
check(soldEsri.bases.indexOf("sat") >= 0 && soldEsri.bases.indexOf("hybrid") >= 0 && soldEsri.bases.indexOf("clarity") < 0 && soldEsri.hs.indexOf("world") >= 0,
  "sold app with an Esri key: Satellite, Hybrid and Esri hillshade offered, no Clarity (" + soldEsri.bases.join(",") + "; shading " + soldEsri.hs.join(",") + ")");
check(soldEsri.esriLp > 0 && soldEsri.esriLp === soldEsri.esri && soldEsri.eox === 0,
  "sold app with an Esri key: every Esri request goes to the Location Platform with the key (" + soldEsri.esriLp + " of " + soldEsri.esri + "), no EOX (" + soldEsri.eox + ")");
check(!soldEsri.errors.length, "sold app with an Esri key: no page errors " + soldEsri.errors.slice(0, 3).join(" | "));
await browser.close();
server.close();
console.log(failed ? failed + " failed" : "all passed");
process.exit(failed ? 1 : 0);
