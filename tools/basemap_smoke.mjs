// Test only: opens OSAP headless (the live site, or this checkout when no URL is given), picks each base map in turn and
// counts the tile answers per host, so a base map that draws nothing shows up. Writes nothing to the repo.
// Run: node tools/basemap_smoke.mjs [url]   (needs the playwright package and Chromium, and internet access)
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

let base = process.argv[2], server;
if (!base) {
  const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
  server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
    try { const body = await readFile(join(process.cwd(), path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
    catch { res.writeHead(404); res.end(); }
  }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}/`;
}
await mkdir("probe-out", { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [], hits = {};
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200)); });
page.on("requestfailed", (r) => { if (/tile|\{z\}|\/\d+\/\d+\/\d+/.test(r.url())) { const k = new URL(r.url()).host + " FAILED " + (r.failure() || {}).errorText; hits[k] = (hits[k] || 0) + 1; } });
page.on("response", (r) => { const u = new URL(r.url()); if (/\/\d+\/\d+\/\d+/.test(u.pathname) || /tile/.test(u.pathname)) { const k = u.host + " " + r.status(); hits[k] = (hits[k] || 0) + 1; } });
await page.addInitScript(() => { localStorage.setItem("osap-home", JSON.stringify("map")); });
await page.goto(base + "#th", { waitUntil: "load" });
await page.waitForFunction(() => window.__asapMap, null, { timeout: 30000 });
await page.waitForTimeout(4000);
console.log("sw:", await page.evaluate(() => navigator.serviceWorker && navigator.serviceWorker.controller ? "controlled" : "none"));
const keys = await page.evaluate(() => [...document.querySelectorAll('input[name="ml-base"]')].map((i) => i.value));
console.log("base map radios:", keys.join(", "));
// open the base map list the way a user does: the tactical toolbar's Overlays button, or the classic Layers button
const ov = page.locator("#atk-tools button", { hasText: "Overlays" });
if (await ov.count() && await ov.first().isVisible()) { await ov.first().click(); console.log("opened: Overlays sheet"); }
else { await page.click(".mlbtn"); console.log("opened: Layers button"); }
await page.waitForTimeout(500);
for (const k of keys) {
  for (const h in hits) delete hits[h];
  await page.locator('input[name="ml-base"][value="' + k + '"]').check({ force: true });
  await page.evaluate(() => window.__asapMap.setView([13.75, 100.5], 12, { animate: false }));
  await page.waitForTimeout(5000);
  const st = await page.evaluate(() => { const t = [...document.querySelectorAll(".leaflet-tile-pane .leaflet-layer")].map((l) => [l.className.slice(0, 40), l.querySelectorAll(".leaflet-tile-loaded").length, l.querySelectorAll(".leaflet-tile").length]); return t; });
  console.log(`\n== ${k}: layers ${JSON.stringify(st)}\n   answers ${JSON.stringify(hits)}`);
  await page.locator("#map").screenshot({ path: `probe-out/base-${k}.jpg`, type: "jpeg", quality: 60 });
}
const bad = []; // filled below
console.log("\npage errors:", JSON.stringify(errors.slice(0, 20)));
await browser.close(); if (server) server.close();
