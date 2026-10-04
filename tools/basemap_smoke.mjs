// Test only: opens OSAP headless (this checkout, or the URL given), picks every base map from the toolbar's Base map button
// and checks each one draws tiles from its own host; also checks Overlays no longer repeats the base map list, and that
// classic controls still offer it in Layers. Used by .github/workflows/probe-basemaps.yml; writes nothing to the repo.
// Run from the repo root: node tools/basemap_smoke.mjs [url]   (needs the playwright package and Chromium, and internet access)
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
const HOST = { grey: /services\.arcgisonline/, streets: /openfreemap/, topo: /opentopomap/, sat: /server\.arcgisonline.*World_Imagery/,
  hybrid: /server\.arcgisonline.*World_Imagery/, clarity: /clarity\.maptiles/, s2: /maps\.eox\.at/, daily: /gibs\.earthdata/ };
await mkdir("probe-out", { recursive: true });
const browser = await chromium.launch();
let failed = 0;
const bad = (m) => { failed++; console.log("::warning::" + m); };
const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, serviceWorkers: "block" });
const errors = [], urls = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (r) => { if (r.ok()) urls.push(r.url()); });
await page.addInitScript(() => { localStorage.setItem("osap-home", JSON.stringify("map")); });
await page.goto(base + "#th");
await page.waitForFunction(() => window.__asapMap && window.OSAP_BASEMAP && document.querySelector('#atk-tools [data-atk="basemap"]'), null, { timeout: 30000 });
await page.evaluate(() => window.__asapMap.setView([13.75, 100.5], 12, { animate: false }));
// Overlays should no longer list base maps
await page.click('#atk-tools [data-atk="overlays"]'); await page.waitForTimeout(400);
const inOverlays = await page.evaluate(() => [...document.querySelectorAll('#atk-om input[name="ml-base"]')].some((i) => i.offsetParent !== null));
console.log("base maps visible in Overlays:", inOverlays); if (inOverlays) bad("Overlays still lists base maps");
await page.click('#atk-om [data-om="x"]');
const ids = await page.evaluate(() => window.OSAP_BASEMAP.list().map((x) => x.id));
// start away from grey (already showing, so picking it again loads nothing new) and come back to it at the end
for (const k of ids.filter((x) => x !== "grey").concat(["grey"])) {
  await page.click('#atk-tools [data-atk="basemap"]');
  await page.waitForSelector("#atk-pop:not([hidden])");
  const item = page.locator('#atk-pop [data-pk="' + k + '"]');
  if (!(await item.count())) { bad(k + ": not in the Base map menu"); continue; }
  urls.length = 0;
  await item.click(); await page.waitForTimeout(4500);
  const st = await page.evaluate(() => ({ cur: window.OSAP_BASEMAP.get(), radio: (document.querySelector('input[name="ml-base"]:checked') || {}).value,
    loaded: document.querySelectorAll(".leaflet-tile-pane .leaflet-tile-loaded").length, popHidden: document.getElementById("atk-pop").hidden }));
  const hits = urls.filter((u) => HOST[k] && HOST[k].test(u)).length;
  console.log(`${k}: current ${st.cur}, Layers radio ${st.radio}, ${hits} tiles from its host, ${st.loaded} tiles on the map, menu closed ${st.popHidden}`);
  if (st.cur !== k || st.radio !== k || !hits || !st.popHidden) bad(k + " did not switch cleanly");
  await page.locator("#map").screenshot({ path: `probe-out/base-${k}.jpg`, type: "jpeg", quality: 60 });
}
// the menu marks the current base map
await page.click('#atk-tools [data-atk="basemap"]');
const onItem = await page.evaluate(() => (document.querySelector("#atk-pop .on") || {}).getAttribute && document.querySelector("#atk-pop .on").getAttribute("data-pk"));
console.log("menu marks current:", onItem); if (onItem !== "grey") bad("menu does not mark the current base map");
await page.keyboard.press("Escape");
// classic controls: base maps are back in Layers
const page2 = await browser.newPage({ viewport: { width: 1200, height: 800 }, serviceWorkers: "block" });
await page2.addInitScript(() => { localStorage.setItem("osap-home", JSON.stringify("map")); localStorage.setItem("osap-ui", "classic"); });
await page2.goto(base + "#th");
await page2.waitForFunction(() => window.__asapMap && window.OSAP_BASEMAP, null, { timeout: 30000 });
const classic = await page2.evaluate(() => !document.documentElement.classList.contains("atak"));
if (classic) {
  await page2.click(".mlbtn"); await page2.waitForTimeout(300);
  const vis = await page2.evaluate(() => [...document.querySelectorAll('#ml-panel input[name="ml-base"]')].filter((i) => i.offsetParent !== null).length);
  console.log("classic controls: base maps in Layers:", vis); if (!vis) bad("classic Layers lost the base maps");
} else bad("classic controls did not switch on");
console.log("page errors:", JSON.stringify(errors));
if (errors.length) failed++;
await browser.close(); if (server) server.close();
if (failed) { console.log(failed + " problem(s)"); process.exit(1); }
console.log("every base map switches from the toolbar");
