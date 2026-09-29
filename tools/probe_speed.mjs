// Test only: how fast the map is on a phone over a mobile connection, with the real network. For each site given in
// SITES (name=url or name=dir, comma separated), cold start: page opened -> first base-map picture on screen, and
// -> every picture in view loaded; then 3D opened -> 3D pictures all loaded. Runs each 3 times in Chrome's and
// Safari's engines and prints the medians. Writes nothing to the repo.
// Run from the repo root: SITES="now=.,before=../before" node tools/probe_speed.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { chromium, webkit, devices } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
function serve(dir) {
  const root = resolve(dir);
  const s = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
    try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream", "Cache-Control": "no-cache" }); res.end(body); }
    catch { res.writeHead(404); res.end(); }
  }).listen(0, "127.0.0.1");
  return new Promise((r) => s.once("listening", () => r(`http://127.0.0.1:${s.address().port}/`)));
}
const sites = [];
for (const part of (process.env.SITES || "now=.").split(",")) {
  const [name, where] = part.split("=");
  sites.push({ name, url: /^https?:/.test(where) ? where : await serve(where) });
}
const RUNS = +(process.env.RUNS || 3), BASEMAP = process.env.BASEMAP || "sat";
const med = (a) => { const b = a.filter((x) => x != null).sort((x, y) => x - y); return b.length ? Math.round(b[Math.floor(b.length / 2)]) : null; };

async function once(engine, dev, url) {
  const browser = await engine.launch(engine === chromium ? { args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] } : {});
  const ctx = await browser.newContext({ ...dev, serviceWorkers: "block" });
  await ctx.addInitScript((bm) => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("asap-map-layers", JSON.stringify({ base: bm })); } catch (e) {} }, BASEMAP);
  const p = await ctx.newPage();
  if (engine === chromium) {
    const cdp = await ctx.newCDPSession(p);
    await cdp.send("Network.enable");
    /* a good 4G phone connection: 150 ms round trip, 9 Mbit/s down, and a phone-class processor */
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 9e6 / 8, uploadThroughput: 3e6 / 8 });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  }
  const t0 = Date.now();
  await p.goto(url + "#th", { waitUntil: "domcontentloaded" });
  const r = await p.evaluate(async () => {
    const T = (h) => new Promise((res) => { const s = performance.now(); (function tick() { const v = h(); if (v || performance.now() - s > 60000) res(v ? performance.now() : null); else setTimeout(tick, 50); })(); });
    const tileImg = () => [...document.querySelectorAll("#map .leaflet-tile-pane img.leaflet-tile-loaded, #map .leaflet-tile-pane .leaflet-tile-loaded img")].some((i) => i.complete && i.naturalWidth > 0);
    const first = await T(tileImg);
    const all = await T(() => { const m = window.__asapMap; if (!m || !tileImg()) return false; let busy = false; m.eachLayer((l) => { if (l.isLoading && l.isLoading()) busy = true; }); return !busy; });
    const tiles = performance.getEntriesByType("resource").filter((e) => /tile|arcgis|opentopomap|eox|gibs/i.test(e.name) && e.initiatorType === "img").length;
    return { first, all, tiles, scripts: performance.getEntriesByType("resource").filter((e) => e.initiatorType === "script" || e.initiatorType === "fetch").reduce((a, e) => a + (e.transferSize || 0), 0) };
  });
  let three = null;
  try {
    await p.waitForFunction(() => window.OSAP_3D, null, { timeout: 30000 });
    await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
    await p.waitForTimeout(6000);   /* a person looks at the map for a few seconds before opening 3D */
    three = await p.evaluate(async () => {
      const s = performance.now(); window.OSAP_3D.open();
      return await new Promise((res) => { (function tick() { const gl = window.OSAP_3D.gl; if (gl && gl.loaded() && gl.areTilesLoaded() && !gl.isMoving()) res(performance.now() - s); else if (performance.now() - s > 60000) res(null); else setTimeout(tick, 100); })(); });
    });
  } catch (e) {}
  await browser.close();
  return { first: r.first, all: r.all, three, tiles: r.tiles, js: r.scripts, wall: Date.now() - t0 };
}
for (const [ename, engine, dev] of [["chrome", chromium, devices["Pixel 7"]], ["safari", webkit, devices["iPhone 13"]]]) {
  for (const s of sites) {
    const rs = [];
    for (let i = 0; i < RUNS; i++) { try { rs.push(await once(engine, dev, s.url)); } catch (e) { console.log(`  ${ename} ${s.name} run ${i}: ${e.message.slice(0, 120)}`); } }
    console.log(`SPEED ${ename.padEnd(6)} ${s.name.padEnd(8)} base=${BASEMAP} first picture ${med(rs.map((r) => r.first))} ms | all in view ${med(rs.map((r) => r.all))} ms | 3D ready ${med(rs.map((r) => r.three))} ms | tiles ${med(rs.map((r) => r.tiles))} | runs ${JSON.stringify(rs.map((r) => [r.first && Math.round(r.first), r.all && Math.round(r.all), r.three && Math.round(r.three)]))}`);
  }
}
process.exit(0);
