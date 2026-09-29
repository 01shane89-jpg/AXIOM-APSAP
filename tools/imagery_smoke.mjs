// Test only: opens OSAP headless with the Satellite base maps and zooms past the sharpest imagery in a few SE Asian places,
// to show the map stays on (enlarged) imagery instead of grey "no data" squares. Counts imagery tile answers and page errors,
// and saves screenshots to probe-out/. Used by .github/workflows/probe-imagery.yml; writes nothing to the repo.
// Run from the repo root: node tools/imagery_smoke.mjs   (needs the playwright package and Chromium, and internet access)
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
await mkdir("probe-out", { recursive: true });
const browser = await chromium.launch();
let failed = 0;
for (const [label, bm, lat, lon, z] of [["bangkok-sat-z19", "sat", 13.7466, 100.5393, 19], ["bangkok-sat-z20", "sat", 13.7466, 100.5393, 20],
  ["yala-sat-z20", "sat", 6.5411, 101.2804, 20], ["yala-hybrid-z19", "hybrid", 6.5411, 101.2804, 19],
  ["yala-clarity-z19", "clarity", 6.5411, 101.2804, 19], ["dili-clarity-z18", "clarity", -8.5569, 125.5603, 18]]) {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 }, serviceWorkers: "block" });
  const errors = [], hits = {};
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => { const m = r.url().match(/arcgisonline\.com|arcgis\.com/); if (m && /\/tile\//.test(r.url())) { const k = r.url().match(/tile\/(\d+)\//)[1] + ":" + r.status(); hits[k] = (hits[k] || 0) + 1; } });
  await page.addInitScript((bm) => { localStorage.setItem("osap-home", JSON.stringify("map")); localStorage.setItem("asap-map-layers", JSON.stringify({ base: bm })); }, bm);
  await page.goto(base + "#th");
  await page.waitForFunction(() => window.__asapMap, null, { timeout: 30000 });
  await page.evaluate(([lat, lon, z]) => window.__asapMap.setView([lat, lon], z, { animate: false }), [lat, lon, z]);
  await page.waitForTimeout(9000);
  const st = await page.evaluate(() => {
    const m = window.__asapMap, t = [...document.querySelectorAll(".leaflet-tile-pane .leaflet-tile")];
    const deep = t.filter((d) => d.tagName === "DIV" && d.firstChild && d.firstChild.tagName === "IMG");
    return { zoom: m.getZoom(), max: m.getMaxZoom(), deepTiles: deep.length, loaded: deep.filter((d) => d.classList.contains("leaflet-tile-loaded")).length,
      enlarged: deep.filter((d) => parseFloat(d.firstChild.style.width) > 256).length, blank: deep.filter((d) => !d.firstChild.naturalWidth).length };
  });
  await page.locator("#map").screenshot({ path: `probe-out/${label}.jpg`, type: "jpeg", quality: 80 });
  console.log(`${label}: ${JSON.stringify(st)} tile answers ${JSON.stringify(hits)} page errors ${JSON.stringify(errors)}`);
  if (errors.length || st.zoom !== z || !st.loaded || st.blank) { failed++; console.log(`::warning::${label} not clean`); }
  await page.close();
}
await browser.close(); server.close();
if (failed) { console.log(`${failed} view(s) not clean`); process.exit(1); }
console.log("all views on imagery");
