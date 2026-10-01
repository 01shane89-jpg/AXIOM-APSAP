// Test only: how fast 3D buildings appear and how smoothly the 3D view keeps drawing, on the real network (GitHub Actions).
// Compares no buildings, the Overture buildings the app uses, and OpenFreeMap's OpenStreetMap buildings, at a phone and a
// desktop size. Prints one line per run; writes nothing to the repo. Run from the repo root: node tools/probe_bld_perf.mjs
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
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const PLACES = [["bangkok", 13.7245, 100.5335], ["yala", 6.541, 101.281]];
for (const [vw, vh] of [[390, 844], [1280, 800]]) for (const [name, lat, lon] of PLACES) for (const mode of ["none", "overture", "openfreemap"]) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: vw, height: vh } });
  await ctx.addInitScript((off) => { localStorage.setItem("osap-home", "map"); localStorage.setItem("asap-map-layers", JSON.stringify({ base: "sat" })); localStorage.setItem("osap-3d", JSON.stringify({ bld: !off })); }, mode !== "overture");
  const p = await ctx.newPage(); let kb = 0;
  p.on("response", (res) => { if (/pmtiles|openfreemap/.test(res.url())) kb += (+res.headers()["content-length"] || 0) / 1024; });
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_3D, null, { timeout: 60000 }); await p.waitForTimeout(3000);
  await p.evaluate(([lat, lon]) => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); window.__asapMap.setView([lat, lon], 13, { animate: false }); window.OSAP_3D.open(); }, [lat, lon]);
  await p.waitForFunction(() => window.OSAP_3D.gl && window.OSAP_3D.gl.loaded(), null, { timeout: 40000 }).catch(() => {});
  await p.waitForTimeout(2000);
  if (mode === "openfreemap") await p.evaluate(() => { const gl = window.OSAP_3D.gl; gl.addSource("ofm", { type: "vector", url: "https://tiles.openfreemap.org/planet" });
    gl.addLayer({ id: "ofm", type: "fill-extrusion", source: "ofm", "source-layer": "building", minzoom: 14, filter: ["!=", ["get", "hide_3d"], true], paint: { "fill-extrusion-color": "#d8d2c6", "fill-extrusion-height": ["coalesce", ["get", "render_height"], 5], "fill-extrusion-opacity": 1 } }); });
  kb = 0;
  const lay = mode === "overture" ? ["bld", "bldp"] : mode === "openfreemap" ? ["ofm"] : [];
  await p.evaluate(([lat, lon, lay]) => { const gl = window.OSAP_3D.gl, t0 = performance.now(); window.__r = { tiles: [], n50: null, fr: [] };
    gl.on("data", (e) => { if ((e.sourceId === "bld" || e.sourceId === "ofm") && e.tile && e.dataType === "source") window.__r.tiles.push(Math.round(performance.now() - t0)); });
    let last = t0; (function f() { const n = performance.now(); window.__r.fr.push(n - last); last = n;
      if (lay.length && window.__r.n50 == null && window.__r.fr.length % 10 === 0 && gl.queryRenderedFeatures({ layers: lay }).length > 50) window.__r.n50 = Math.round(n - t0);
      if (n - t0 < 25000) requestAnimationFrame(f); })();
    gl.jumpTo({ center: [lon, lat], zoom: 15.6, pitch: 62, bearing: -30 });
    /* a slow turn, as a person looks around */
    setTimeout(() => gl.easeTo({ bearing: 60, duration: 8000 }), 12000); }, [lat, lon, lay]);
  await p.waitForTimeout(27000);
  const r = await p.evaluate((lay) => { const R = window.__r, fr = R.fr.slice(1), turn = fr.slice(Math.floor(fr.length * 0.5));
    const st = (a) => ({ frames: a.length, over100: a.filter((x) => x > 100).length, over500: a.filter((x) => x > 500).length, max: Math.round(Math.max(...a)), med: Math.round(a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)]) });
    return { drawn: lay.length ? window.OSAP_3D.gl.queryRenderedFeatures({ layers: lay }).length : 0, firstTile: R.tiles[0], tiles: R.tiles.length, n50: R.n50, all: st(fr), turn: st(turn) }; }, lay);
  console.log(`${vw}x${vh} ${name.padEnd(8)} ${mode.padEnd(12)} drawn ${String(r.drawn).padStart(5)} | first tile ${r.firstTile} ms, ${r.tiles} tiles, 50 drawn at ${r.n50} ms | ${Math.round(kb)} KB | frames ${JSON.stringify(r.all)} turning ${JSON.stringify(r.turn)}`);
  await ctx.close();
}
await browser.close(); server.close();
