// TEMPORARY (removed before merge): opens the PR's deploy preview (which carries the site's Esri key) headless, picks some
// Esri maps and reports whether Esri answered and drew them, with a small picture of each. Esri's key only accepts the live
// site's address, so requests to Esri are sent with that Referer. Never prints the key.
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.argv[2];
const MAPS = ["esri:arcgis/navigation", "esri:arcgis/topographic", "esri:arcgis/outdoor", "esri:open/streets", "esri:arcgis/dark-gray", "esri:open/hybrid"];
await mkdir("probe-out", { recursive: true });
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 900, height: 650 }, serviceWorkers: "block" });
const st = {}, errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.route(/arcgis\.com\//, (r) => r.continue({ headers: { ...r.request().headers(), referer: "https://axiom-osap.netlify.app/" } }));
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
await browser.close();
