// Test only: opens OSAP headless with the real network, turns on each base map in turn and opens the 3D view over
// Doi Inthanon (Thailand's highest mountain), then prints how many elevation and map tiles loaded or failed per source.
// Proves the keyless hosts answer a WebGL page (CORS) from outside. Writes nothing to the repo; screenshots go to probe-out/.
// Run from the repo root: node tools/probe_3d.mjs
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
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
await mkdir("probe-out", { recursive: true });
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
let bad = 0;
for (const bm of ["grey", "sat", "hybrid", "clarity", "topo", "streets", "s2", "daily"]) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((bm) => { localStorage.setItem("osap-home", "map"); localStorage.setItem("asap-map-layers", JSON.stringify({ base: bm })); }, bm);
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_3D, null, { timeout: 60000 }); await p.waitForTimeout(3000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); window.__asapMap.setView([18.59, 98.49], 12, { animate: false }); });
  await p.waitForTimeout(800);
  await p.evaluate(() => {
    window.__t = {};
    window.OSAP_3D.open();
  });
  await p.waitForFunction(() => window.OSAP_3D.gl, null, { timeout: 30000 });
  await p.evaluate(() => {
    const gl = window.OSAP_3D.gl, t = window.__t;
    gl.on("data", (e) => { if (e.dataType === "source" && e.tile && e.sourceId) { const k = e.sourceId; t[k] = t[k] || { ok: 0, err: 0 }; t[k].ok++; } });
    gl.on("error", (e) => { const k = e.sourceId || "other"; t[k] = t[k] || { ok: 0, err: 0 }; t[k].err++; if (!t[k].msg) t[k].msg = String(e.error && e.error.message || e.error).slice(0, 160); });
    gl.jumpTo({ center: [98.49, 18.59], zoom: 11.5, pitch: 70, bearing: -40 });
  });
  await p.waitForTimeout(20000);
  const r = await p.evaluate(() => ({ t: window.__t, urls: window.OSAP_3D.gl.getStyle().layers.filter((l) => l.type === "raster").map((l) => window.OSAP_3D.gl.getSource(l.source).tiles[0].slice(0, 90)),
    msg: (document.querySelector("#o3d .o3-msg") || {}).textContent || "" }));
  await p.screenshot({ path: `probe-out/3d-${bm}.png` });
  const dem = r.t.dem || { ok: 0, err: 0 };
  const rs = Object.entries(r.t).filter(([k]) => /^r\d+$/.test(k));
  const ok = dem.ok > 0 && rs.length > 0 && rs.every(([, v]) => v.ok > 0);
  if (!ok) bad++;
  console.log(`${ok ? "OK  " : "BAD "} ${bm}: dem ${JSON.stringify(dem)} rasters ${JSON.stringify(Object.fromEntries(rs))} urls ${JSON.stringify(r.urls)} note "${r.msg}" errors ${JSON.stringify(errs.slice(0, 2))}`);
  await ctx.close();
}
// 3D buildings (Overture) over central Bangkok and Makati, and Yala and Pattani where OpenStreetMap has few, satellite base map.
// Prints how many are drawn, how long the first 50 took, and how much the building tiles weighed.
for (const [name, lat, lon] of [["bangkok", 13.7245, 100.5335], ["makati", 14.5547, 121.0244], ["yala", 6.541, 101.281], ["pattani", 6.869, 101.25]]) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => { localStorage.setItem("osap-home", "map"); localStorage.setItem("asap-map-layers", JSON.stringify({ base: "sat" })); });
  const p = await ctx.newPage(); let kb = 0, reqs = 0;
  p.on("response", (res) => { if (/buildings\.pmtiles/.test(res.url())) { reqs++; kb += (+res.headers()["content-length"] || 0) / 1024; } });
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_3D, null, { timeout: 60000 }); await p.waitForTimeout(3000);
  await p.evaluate(([lat, lon]) => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); window.__asapMap.setView([lat, lon], 13, { animate: false }); window.OSAP_3D.open(); }, [lat, lon]);
  await p.waitForFunction(() => window.OSAP_3D.gl && window.OSAP_3D.gl.getLayer("bld"), null, { timeout: 30000 }).catch(() => {});
  const t0 = Date.now(); kb = 0; reqs = 0;
  await p.evaluate(([lat, lon]) => { const gl = window.OSAP_3D.gl; window.__b = { ok: 0, err: 0 }; gl.on("data", (e) => { if (e.sourceId === "bld" && e.tile && e.dataType === "source") window.__b.ok++; }); gl.on("error", (e) => { if (e.sourceId === "bld") { window.__b.err++; window.__b.msg = String(e.error && e.error.message); } });
    gl.jumpTo({ center: [lon, lat], zoom: 15.6, pitch: 62, bearing: -30 }); }, [lat, lon]);
  const first = await p.waitForFunction(() => window.OSAP_3D.gl.queryRenderedFeatures({ layers: ["bld", "bldp"] }).length > 50, null, { timeout: 30000, polling: 250 }).then(() => Date.now() - t0, () => null);
  await p.waitForTimeout(12000);
  const r = await p.evaluate(() => { const f = window.OSAP_3D.gl.queryRenderedFeatures({ layers: ["bld", "bldp"] }); return { t: window.__b, drawn: f.length, known: f.filter((x) => x.properties.height != null || x.properties.num_floors != null).length, ver: window.OSAP_3D.gl.getSource("bld").url }; });
  await p.screenshot({ path: `probe-out/3d-buildings-${name}.png`, timeout: 90000 }).catch((e) => console.log("no screenshot:", e.message.split("\n")[0]));
  const ok = r.drawn > 50 && r.t.err === 0;
  if (!ok) bad++;
  console.log(`${ok ? "OK  " : "BAD "} buildings ${name}: ${r.drawn} drawn (${r.known} with a recorded height or floors), first 50 after ${first} ms, ${reqs} requests ${Math.round(kb)} KB, tiles ${JSON.stringify(r.t)} ${r.ver}`);
  await ctx.close();
}
await browser.close(); server.close();
console.log(bad ? bad + " base maps did not load in 3D" : "every base map loaded in 3D");
