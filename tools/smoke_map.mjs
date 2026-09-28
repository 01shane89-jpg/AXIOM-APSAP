// Headless smoke test: opens Thailand's map and checks that the page throws no errors and that
// each checked tab actually draws objects (and military symbols where it should).
// Run from the repo root: node tools/smoke_map.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
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

// tab -> what it must draw: markers (L.Marker), dots (L.CircleMarker), sym (military symbols, .msym)
const CHECKS = { timeline: { dots: 1 }, flood: { markers: 1 }, border: { markers: 1, sym: 1 }, crisis: { sym: 1 } };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, serviceWorkers: "block" });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
// keep a handle on the page's Leaflet map so drawn objects can be counted (most are on a canvas, not in the DOM)
await page.addInitScript(() => {
  let lib;
  Object.defineProperty(window, "L", { configurable: true, get: () => lib, set(v) {
    lib = v;
    if (v && v.Map && !v.Map.__smoke) { v.Map.__smoke = 1; v.Map.addInitHook(function () { if (this._container && this._container.id === "map") window.__smokeMap = this; }); }
  } });
});
await page.goto(base + "#th");
await page.waitForTimeout(3000);
await page.click(".tdmap").catch(() => {});
await page.waitForTimeout(1500);
let failed = 0;
for (const [tab, need] of Object.entries(CHECKS)) {
  // a tab a conflict tab has taken over (merge_tabs in tools/conflicts.json) is hidden but still works; click it in the page
  await page.evaluate((t) => document.querySelector(`button[role=tab][data-view="${t}"]`).click(), tab);
  await page.waitForTimeout(2500);
  const got = await page.evaluate(() => {
    const L = window.L, n = { markers: 0, dots: 0, sym: document.querySelectorAll("#map .msym").length };
    for (const l of Object.values((window.__smokeMap || {})._layers || {})) { if (l instanceof L.Marker) n.markers++; else if (l instanceof L.CircleMarker) n.dots++; }
    return n;
  });
  const short = Object.keys(need).filter((k) => got[k] < need[k]);
  console.log(`${tab}: ${got.markers} markers, ${got.dots} dots, ${got.sym} military symbols${short.length ? "  <- nothing drawn: " + short.join(", ") : ""}`);
  if (short.length) { failed++; console.log(`::error::The ${tab} tab drew no ${short.join(" or ")}`); }
}
for (const e of errors) console.log(`::error::Page error: ${e}`);
await browser.close(); server.close();
process.exit(failed || errors.length ? 1 : 0);
