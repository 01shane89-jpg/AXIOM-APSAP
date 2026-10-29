// TEMPORARY (removed before merge): opens the PR's deploy preview (which carries the site's Esri key) headless, picks some
// Esri maps and reports whether Esri answered and drew them, with a small picture of each. Esri's key only accepts the live
// site's address, so requests to Esri are sent with that Referer. Never prints the key.
import { chromium } from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
// the preview's copy of assets/osap-sold.js carries the key (the sign-in page covers the preview's map, so the map is
// served here from this checkout with that one file taken from the preview)
const soldJs = await (await fetch(process.argv[2] + "assets/osap-sold.js")).text();
if (!/"esriKey"/.test(soldJs)) { console.log("::error::the preview has no Esri key"); process.exit(1); }
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".css": "text/css", ".webmanifest": "application/manifest+json" };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  if (path === "assets/osap-sold.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); return res.end(soldJs); }
  try { const body = await readFile(join(process.cwd(), path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const MAPS = ["esri:arcgis/navigation", "esri:arcgis/topographic", "esri:arcgis/outdoor", "esri:open/streets", "esri:arcgis/dark-gray", "esri:open/hybrid"];
await mkdir("probe-out", { recursive: true });
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 900, height: 650 }, serviceWorkers: "block" });
const st = {}, errors = [];
page.on("pageerror", (e) => errors.push(e.message));
// the browser will not let a page change Referer or Origin, so Esri's requests are made from here with the live site's, and
// handed back to the page as if Esri allowed this address
await page.route(/arcgis\.com\//, async (r) => {
  try {
    const res = await r.fetch({ headers: { ...r.request().headers(), referer: "https://axiom-osap.netlify.app/", origin: "https://axiom-osap.netlify.app" } });
    await r.fulfill({ response: res, headers: { ...res.headers(), "access-control-allow-origin": "*" } });
  } catch (e) { await r.abort().catch(() => {}); }
});
page.on("response", (r) => { const u = r.url(); if (/arcgis\.com/.test(u)) { const h = new URL(u).host; const k = h + " " + r.status(); st[k] = (st[k] || 0) + 1; } });
await page.addInitScript(() => { localStorage.setItem("osap-home", JSON.stringify("map")); });
await page.goto(base + "#th");
await page.waitForFunction(() => window.__asapMap && window.OSAP_BASEMAP, null, { timeout: 60000 });
const n = await page.evaluate(() => window.OSAP_BASEMAP.list().filter((x) => x.group).length);
console.log("::notice title=esri count::" + n + " Esri maps offered");
await page.evaluate(() => window.__asapMap.setView([13.745, 100.53], 13, { animate: false }));
for (const k of MAPS) {
  for (const x in st) delete st[x];
  await page.evaluate((k) => window.OSAP_BASEMAP.set(k), k);
  await page.waitForTimeout(7000);
  const shot = await page.locator("#map").screenshot({ type: "jpeg", quality: 35, scale: "css" });
  await writeFile("probe-out/" + k.replace(/[:/]/g, "_") + ".jpg", shot);
  console.log("::notice title=" + k + "::" + JSON.stringify(st));
}
console.log("::notice title=errors::" + JSON.stringify(errors).slice(0, 1000));
await browser.close(); server.close();
