// Test only: the 3D view after the flat map has already loaded the same place, as on a phone. Prints each map host's
// CORS headers (with and without an Origin), then opens the flat map on Satellite over central Thailand, waits for it,
// opens 3D and lists every 3D tile that failed and why, in Safari's engine (WebKit) and Chrome's.
// BASE=url picks the site (default: this checkout served locally). Writes nothing to the repo; screenshots go to probe-out/.
// Run from the repo root: node tools/probe_3d_cache.mjs
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium, webkit, devices } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();
let base = process.env.BASE, server;
if (!base) {
  server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
    try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
    catch { res.writeHead(404); res.end(); }
  }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}/`;
}
await mkdir("probe-out", { recursive: true });

for (const u of ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/9/240/399?blankTile=false",
  "https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/9/240/399?blankTile=false",
  "https://a.tile.opentopomap.org/9/399/240.png", "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/g/9/240/399.jpg"]) {
  for (const origin of [null, "https://01shane89-jpg.github.io"]) {
    try {
      const r = await fetch(u, { headers: origin ? { Origin: origin } : {} });
      const h = (k) => r.headers.get(k);
      console.log(`HDR ${new URL(u).host} origin=${origin ? "yes" : "no "} ${r.status} acao=${h("access-control-allow-origin")} vary=${h("vary")} cache=${h("cache-control")}`);
    } catch (e) { console.log(`HDR ${u} ${e.message}`); }
  }
}

let bad = 0;
for (const [name, engine, dev] of [["webkit-iphone", webkit, devices["iPhone 13"]], ["chromium-phone", chromium, devices["Pixel 7"]]]) {
  for (const bm of ["sat", "topo"]) {
    const browser = await engine.launch(engine === chromium ? { args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] } : {});
    const ctx = await browser.newContext({ ...dev, serviceWorkers: "block" });
    await ctx.addInitScript((bm) => { localStorage.setItem("osap-home", "map"); localStorage.setItem("asap-map-layers", JSON.stringify({ base: bm })); }, bm);
    const p = await ctx.newPage(), errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("console", (m) => { if (m.type() === "error" && errs.length < 6) errs.push(m.text().slice(0, 200)); });
    await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
    await p.waitForFunction(() => window.TSAP && window.OSAP_3D, null, { timeout: 60000 }); await p.waitForTimeout(3000);
    await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); window.__asapMap.setView([14.2, 100.4], 8, { animate: false }); });
    await p.waitForTimeout(8000);
    const two = await p.evaluate(() => window.OSAP_MAPLOAD ? window.OSAP_MAPLOAD.state() : null);
    await p.evaluate(() => { window.__e = []; window.__ok = 0; window.OSAP_3D.open(); });
    await p.waitForFunction(() => window.OSAP_3D.gl, null, { timeout: 60000 }).catch(() => {});
    await p.evaluate(() => {
      const gl = window.OSAP_3D.gl; if (!gl) return;
      gl.on("data", (e) => { if (e.dataType === "source" && e.tile && e.sourceId) window.__ok++; });
      gl.on("error", (e) => { window.__e.push({ s: e.sourceId || "-", z: e.tile && e.tile.tileID ? e.tile.tileID.canonical.z : null, m: String(e.error && (e.error.message || e.error.status) || e.error).slice(0, 140) }); });
    });
    await p.waitForTimeout(20000);
    const r = await p.evaluate(() => ({ ok: window.__ok, e: window.__e, bar: (document.querySelector("#o3d .o3-load") || {}).textContent || "", hidden: (document.querySelector("#o3d .o3-load") || {}).hidden,
      urls: window.OSAP_3D.gl ? window.OSAP_3D.gl.getStyle().layers.filter((l) => l.type === "raster").map((l) => window.OSAP_3D.gl.getSource(l.source).tiles[0].slice(0, 110)) : [] }));
    await p.screenshot({ path: `probe-out/cache-${name}-${bm}.png` });
    const fail = r.e.filter((x) => x.s !== "-").length;
    if (fail > 2) bad++;
    console.log(`${fail > 2 ? "BAD " : "OK  "} ${name} ${bm}: 2D ${JSON.stringify(two)} | 3D ok=${r.ok} failed=${fail} bar=${r.hidden ? "hidden" : JSON.stringify(r.bar)} urls=${JSON.stringify(r.urls)}`);
    const by = {}; r.e.forEach((x) => { const k = x.s + " z" + x.z + " " + x.m; by[k] = (by[k] || 0) + 1; });
    Object.entries(by).slice(0, 8).forEach(([k, n]) => console.log(`     ${n} x ${k}`));
    if (errs.length) console.log("     page: " + JSON.stringify(errs.slice(0, 4)));
    await browser.close();
  }
}
if (server) server.close();
console.log(bad ? bad + " runs had failing 3D tiles" : "no failing 3D tiles");
