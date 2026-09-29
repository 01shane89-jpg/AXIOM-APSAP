// Headless check of the flat map's loading bar (assets/osap-maploading.js) and of the hidden watch-check frames:
// slow tiles show "Loading map N%" then clear; failing tiles show which service failed with Try again, which recovers;
// a ?watchscan=1 copy of the page downloads no map tiles. Run from the repo root: node tests/maploading_smoke.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==", "base64");
const OSM = /tile\.openstreetmap\.org/;
let mode = "slow", osmN = 0;
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1200, height: 800 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
  const u = r.request().url();
  if (OSM.test(u)) {
    osmN++;
    if (mode === "fail") return r.fulfill({ status: 500, body: "" });
    if (mode === "slow") await new Promise((x) => setTimeout(x, 2500));
    return r.fulfill({ status: 200, contentType: "image/png", body: PNG });
  }
  return r.abort();
});
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("asap-map-layers", JSON.stringify({ base: "streets" })); } catch (e) {} });
const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base, { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TSAP && window.OSAP_MAPLOAD, null, { timeout: 60000 });
await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
// slow
await p.evaluate(() => window.__asapMap.setView([13.75, 100.5], 9, { animate: false }));
await p.waitForTimeout(1200);
let s = await p.evaluate(() => window.OSAP_MAPLOAD.state());
ok(!s.hidden && /^Loading map \d+%$/.test(s.text), "slow tiles: loading bar with progress shown " + JSON.stringify(s));
await p.waitForFunction(() => window.OSAP_MAPLOAD.state().hidden, null, { timeout: 20000 }).catch(() => {});
ok(await p.evaluate(() => window.OSAP_MAPLOAD.state().hidden), "slow tiles: bar clears once the map has loaded");
// failing
mode = "fail";
await p.evaluate(() => window.__asapMap.setView([18.8, 99.0], 10, { animate: false }));
await p.waitForFunction(() => window.OSAP_MAPLOAD.state().err, null, { timeout: 15000 }).catch(() => {});
s = await p.evaluate(() => window.OSAP_MAPLOAD.state());
ok(s.err && /did not load/.test(s.text) && /openstreetmap/.test(s.text), "failing tiles: says which service did not load " + JSON.stringify(s));
ok(await p.isVisible("#mload button"), "failing tiles: Try again button shown");
mode = "ok"; const before = osmN;
await p.click("#mload button");
await p.waitForFunction(() => window.OSAP_MAPLOAD.state().hidden, null, { timeout: 15000 }).catch(() => {});
ok(osmN > before && await p.evaluate(() => window.OSAP_MAPLOAD.state().hidden), "Try again asks for the tiles again and clears the notice");
ok(errors.length === 0, "no page errors " + JSON.stringify(errors.slice(0, 3)));
await ctx.close();
// hidden watch-check frame
{
  const c2 = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 700 } });
  let tiles = 0;
  await c2.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { if (r.request().resourceType() === "image" && /tile|MapServer|wmts|\/\d+\/\d+\/\d+/.test(r.request().url())) { tiles++; console.log("tile " + r.request().url().slice(0, 120)); } return r.abort(); });
  const q = await c2.newPage();
  await q.goto(base + "?watchscan=1#timeline", { waitUntil: "domcontentloaded" });
  await q.waitForFunction(() => window.TSAP, null, { timeout: 60000 }); await q.waitForTimeout(3000);
  const local = await q.evaluate(() => performance.getEntriesByType("resource").filter((e) => /tiles-base/.test(e.name)).length);
  ok(tiles === 0 && local === 0, "watch-check frame downloads no map tiles (" + tiles + " outside, " + local + " packaged)");
  await c2.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
