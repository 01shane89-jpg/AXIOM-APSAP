// The sold version's app switch (assets/osap-sold.js): with WebGL off, so the vector base map cannot start and its raster
// stand-in would load, the normal app asks tile.openstreetmap.org and the sold app does not. Writes nothing.
// Run from the repo root: node tests/sold_mode_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

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

async function run(sold) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, serviceWorkers: "block" });
  const errors = [], osm = [], esri = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    if (/tile\.openstreetmap\.org/.test(u)) osm.push(u);
    if (/arcgis\.com/.test(u)) esri.push(u);
    return r.abort();
  });
  await page.route("**/assets/osap-sold.js", (r) => r.fulfill({ contentType: "text/javascript", body: "window.OSAP_SOLD = " + sold + ";" }));
  await page.addInitScript(() => { localStorage.setItem("osap-home", JSON.stringify("map")); localStorage.setItem("asap-map-layers", JSON.stringify({ base: "streets" })); });
  await page.goto(base + "#th");
  await page.waitForFunction(() => window.__asapMap && window.OSAP_BASEMAP, null, { timeout: 30000 });
  await page.evaluate(() => window.__asapMap.setView([13.75, 100.5], 12, { animate: false }));
  await page.waitForTimeout(6000);
  const flag = await page.evaluate(() => window.OSAP_SOLD);
  await page.close();
  return { flag, osm: osm.length, esri: esri.length, errors };
}

const normal = await run(false), sold = await run(true);
check(normal.flag === false && sold.flag === true, "the switch reaches the page (normal " + normal.flag + ", sold " + sold.flag + ")");
check(normal.osm > 0, "normal app: no WebGL, so the OpenStreetMap raster stand-in loads (" + normal.osm + " tile requests)");
check(sold.osm === 0, "sold app: no tile.openstreetmap.org request (" + sold.osm + ")");
check(sold.esri === 0, "sold app: no Esri request (" + sold.esri + ")");
check(!sold.errors.length, "sold app: no page errors " + sold.errors.slice(0, 3).join(" | "));
await browser.close();
server.close();
console.log(failed ? failed + " failed" : "all passed");
process.exit(failed ? 1 : 0);
