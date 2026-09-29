// Test only: opens the 3D view over Mt Fuji and over Okinawa with the real network and prints the ground height the 3D
// engine reads at known summits (GSI elevation inside Japan, assets/osap-3d.js demTile), plus elevation tile errors.
// Writes nothing to the repo; screenshots go to probe-out/. Run from the repo root: node tools/probe_3d_japan.mjs
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
// [name, hash, lat, lon, zoom, known height in m]
for (const [name, hash, lat, lon, z, known] of [["Mt Fuji summit", "#jp", 35.3606, 138.7274, 13, 3776], ["Okinawa, Yonaha-dake", "#oki", 26.7189, 128.2186, 13, 503], ["Doi Inthanon (AWS)", "#th", 18.5883, 98.4867, 13, 2565]]) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => { localStorage.setItem("osap-home", "map"); localStorage.setItem("asap-map-layers", JSON.stringify({ base: "sat" })); });
  const p = await ctx.newPage(); const errs = [], hosts = {};
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("requestfinished", async (r) => { const h = new URL(r.url()).host; if (/gsi|elevation-tiles/.test(h)) { const s = (await r.response())?.status(); hosts[h + " " + s] = (hosts[h + " " + s] || 0) + 1; } });
  await p.goto(base + hash, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_3D, null, { timeout: 60000 }); await p.waitForTimeout(3000);
  await p.evaluate(([lat, lon, z]) => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); window.__asapMap.setView([lat, lon], z, { animate: false }); }, [lat, lon, z]);
  await p.waitForTimeout(800);
  await p.evaluate(() => { window.__e = []; window.OSAP_3D.open(); });
  await p.waitForFunction(() => window.OSAP_3D.gl, null, { timeout: 30000 });
  await p.evaluate(([lat, lon, z]) => { const gl = window.OSAP_3D.gl; gl.on("error", (e) => window.__e.push((e.sourceId || "") + " " + String(e.error && e.error.message || e.error).slice(0, 120))); gl.jumpTo({ center: [lon, lat], zoom: z, pitch: 60, bearing: 20 }); }, [lat, lon, z]);
  await p.waitForTimeout(15000);
  const r = await p.evaluate(([lat, lon]) => { const gl = window.OSAP_3D.gl, t = gl.getTerrain(); const e = gl.queryTerrainElevation([lon, lat]); return { h: e == null ? null : e / (t ? t.exaggeration : 1), errs: window.__e.slice(0, 5), credits: document.querySelector("#o3d .o3-cr").innerHTML.replace(/<[^>]+>/g, "").slice(0, 300) }; }, [lat, lon]);
  await p.screenshot({ path: `probe-out/3d-${hash.slice(1)}.png` });
  console.log(`${name.padEnd(22)} known ${known} m, 3D reads ${r.h == null ? "nothing" : r.h.toFixed(1) + " m"} | tiles ${JSON.stringify(hosts)} | map errors ${r.errs.length} ${r.errs.join(" ; ")} | page errors ${errs.length} ${errs.join(" ; ")}`);
  console.log(`   credits: ${r.credits}`);
  if (r.h == null || errs.length || r.errs.some((e) => /^(dem|hill) /.test(e))) bad++;
  await ctx.close();
}
await browser.close(); server.close();
console.log(bad ? `${bad} problems` : "3D Japan probe clean");
process.exit(bad ? 1 : 0);
