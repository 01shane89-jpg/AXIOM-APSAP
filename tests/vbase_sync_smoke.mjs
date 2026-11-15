// Headless check that the vector base map (index.html VectorBase: the Grey map and the Esri maps, drawn by the MapLibre engine
// behind the 2D map) stays exactly under the 2D map zoomed right out. Shane 2026-11-15: at the World view the country borders
// sat south-east of the coastlines, because the engine kept the world filling its box: it moved its centre toward the equator
// and, when the box was taller than the world, zoomed in, while the 2D map and every overlay stayed where they were.
// The style is a stand-in (a plain background, served here) so the check needs no network; what is compared is where the engine
// and the 2D map each put the same places, at zoom 2 and 3, centred north, south and on the equator, in a short and a tall window.
// Run from the repo root: node tests/vbase_sync_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const STYLE = JSON.stringify({ version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#dddddd" } }] });
const PLACES = [[60, 30], [-34, 18], [0, 100], [35, 139], [64, -20]];
for (const height of [860, 1300]) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height }, serviceWorkers: "block" });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => /\/styles\//.test(r.request().url()) ? r.fulfill({ contentType: "application/json", body: STYLE }) : r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(), errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.__asapMap && window.TSAP, null, { timeout: 60000 });
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  const ready = await p.waitForFunction(() => { let g = null; window.__asapMap.eachLayer((l) => { if (l._gl) g = l; }); return !!g && g._gl.loaded(); }, null, { timeout: 30000 }).then(() => true, () => false);
  ok(ready, `[${height}px] the vector base map engine started (Grey map)`);
  if (!ready) { await ctx.close(); continue; }
  for (const [lat, z] of [[40, 2], [70, 2], [-50, 2], [0, 2], [20, 3], [-60, 3]]) {
    await p.evaluate(([lat, z]) => { window.__asapMap.setView([lat, 60], z, { animate: false }); }, [lat, z]);
    await p.waitForTimeout(300);
    const off = await p.evaluate((places) => {
      const m = window.__asapMap; let g = null; m.eachLayer((l) => { if (l._gl) g = l; });
      const br = g._box.getBoundingClientRect(), mr = m.getContainer().getBoundingClientRect();
      return Math.max(...places.map(([la, lo]) => {
        const a = m.latLngToContainerPoint([la, lo]), b = g._gl.project([lo, la]);
        return Math.hypot(b.x + br.left - mr.left - a.x, b.y + br.top - mr.top - a.y);
      }));
    }, PLACES);
    ok(off <= 2, `[${height}px] zoom ${z}, centred ${lat}°: base map under the 2D map (worst ${off.toFixed(1)} px)`);
  }
  ok(errors.length === 0, `[${height}px] no page errors` + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
