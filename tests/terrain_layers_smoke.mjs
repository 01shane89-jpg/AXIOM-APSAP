// Headless check of the Terrain layers in Map overlays > Elevation and terrain analysis (assets/osap-terrainlayers.js).
// Mapterhorn is answered by made-up tiles (rolling hills with flat low ground between them), so every run is the same.
// Checks: the block lists the six layers under the Terrain analysis button, all off, and nothing is downloaded until one is
// switched on; each layer draws painted tiles (slope, aspect, elevation colors, ridges and valleys, low ground) or lines
// (contours) from Mapterhorn; the legend shows for a layer that is on; the opacity slider and the low-ground height work;
// they stay on when another tab opens (like the other elevation shading); they come back after a reload; no page errors.
// Run from the repo root: node tests/terrain_layers_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { deflateSync } from "node:zlib";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
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

const lonOf = (X, z) => X / 2 ** z * 360 - 180;
const latOf = (Y, z) => Math.atan(Math.sinh(Math.PI * (1 - 2 * Y / 2 ** z))) * 180 / Math.PI;
/* hills about 2.5 km apart, up to 650 m, with flat ground at 2 m where the wave is low */
const elev = (lat, lon) => Math.max(2, 150 + 500 * Math.sin(lon * 2 * Math.PI / 0.05) * Math.cos(lat * 2 * Math.PI / 0.05));
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(b) { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const MTC = new Map();
function mtTile(z, x, y) {
  const k = z + "/" + x + "/" + y; if (MTC.has(k)) return MTC.get(k);
  const W = 512, rgb = Buffer.alloc(W * W * 3);
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
    const v = elev(latOf(y + (j + 0.5) / W, z), lonOf(x + (i + 0.5) / W, z)) + 32768, q = (j * W + i) * 3;
    rgb[q] = Math.floor(v / 256); rgb[q + 1] = Math.floor(v) % 256; rgb[q + 2] = Math.round((v % 1) * 256) % 256;
  }
  const b = png(W, W, rgb); MTC.set(k, b); return b;
}
const CORS = { "Access-Control-Allow-Origin": "*" };
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 820 } });
const asked = [];
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
  const u = r.request().url(), m = u.match(/tiles\.mapterhorn\.com\/(\d+)\/(\d+)\/(\d+)\.webp/);
  if (m) { asked.push(m.slice(1).join("/")); return +m[1] > 14 ? r.fulfill({ status: 404, headers: CORS, body: "" }) : r.fulfill({ status: 200, contentType: "image/png", headers: CORS, body: mtTile(+m[1], +m[2], +m[3]) }); }
  return r.abort();
});
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
async function load() {
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_TERRAIN_LAYERS && document.querySelector("#ml-panel #ml-tl"), null, { timeout: 60000 }); await p.waitForTimeout(2000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
}
const tick = (k, on) => p.evaluate(([k, on]) => { const i = document.querySelector('#ml-panel input[data-tl="' + k + '"]'); i.checked = on; i.dispatchEvent(new Event("change", { bubbles: true })); }, [k, on]);
/* share of painted pixels over the layer's loaded tiles */
const painted = (k) => p.evaluate((k) => {
  let all = 0, on = 0, tiles = 0;
  for (const c of document.querySelectorAll(".leaflet-tile-pane .osap-tl-" + k + " canvas")) {
    if (!c.width) continue; tiles++;
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 16) { all++; if (d[i] > 0) on++; }
  }
  return { tiles, share: all ? on / all : 0 };
}, k);

await load();
const rows = await p.evaluate(() => [...document.querySelectorAll("#ml-tl input[data-tl]:not(#tl-fit)")].map((i) => i.dataset.tl + (i.checked ? "+" : "")));
ok(rows.join() === "slope,aspect,contour,tint,tpi,low", "the Terrain layers block lists six layers, all off: " + rows.join());
ok(await p.evaluate(() => { const b = document.querySelector("#ml-elev [data-terrain-open]"), t = document.getElementById("ml-tl"); return !!b && !!(b.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING); }), "it sits under the Terrain analysis button");
ok(await p.evaluate(() => { const r = document.querySelector("#ml-elev #ml-lidar"), t = document.getElementById("ml-tl"); return !r || !!(r.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING); }), "and after the hillshade rows");
ok(asked.length === 0, "no elevation tile is downloaded before a layer is switched on");
await p.evaluate(() => { window.OSAP_BASEMAP.set("grey"); window.__asapMap.setView([13.75, 100.5], 12, { animate: false }); });
const FILL = { slope: 0.3, aspect: 0.3, tint: 0.5, tpi: 0.1, low: 0.05, contour: 0.005 };
for (const k of Object.keys(FILL)) {
  await tick(k, true); await p.waitForTimeout(3500);
  const r = await painted(k);
  ok(r.tiles > 0 && r.share > FILL[k], k + " draws tiles from Mapterhorn: " + r.tiles + " tiles, " + Math.round(r.share * 1000) / 10 + "% painted");
  ok(await p.evaluate((k) => { const e = document.getElementById("tl-key-" + k); return !e || !e.hidden; }, k), k + " shows its legend while on");
  if (k === "tint") ok(await p.evaluate(() => { const r = window.OSAP_TERRAIN_LAYERS.state().range; return !!r && r[0] >= 2 && r[1] <= 650 && r[1] - r[0] > 100; }), "elevation colors fit the heights in view: " + JSON.stringify(await p.evaluate(() => window.OSAP_TERRAIN_LAYERS.state().range)));
  if (k !== "contour") await tick(k, false);
}
ok(asked.length > 0, "the layers read Mapterhorn's elevation tiles (" + asked.length + " asked)");
ok(/Contours every 25 m here, bold every 125 m/.test(await p.evaluate(() => document.getElementById("tl-note").textContent)), "the note gives the contour step at this zoom");
if (process.env.OUT) await p.screenshot({ path: process.env.OUT + "/terrain-layers-contours.png" });
/* low ground follows the height slider: at 1 m none of the 2 m flats is low */
await tick("low", true); await p.waitForTimeout(2500);
const at5 = (await painted("low")).share;
await p.evaluate(() => { const s = document.getElementById("tl-low"); s.value = "1"; s.dispatchEvent(new Event("input", { bubbles: true })); s.dispatchEvent(new Event("change", { bubbles: true })); }); await p.waitForTimeout(2500);
const at1 = (await painted("low")).share;
ok(at5 > 0.05 && at1 < at5 / 5, "low ground follows the height (5 m: " + Math.round(at5 * 100) + "%, 1 m: " + Math.round(at1 * 100) + "%)");
await p.evaluate(() => { const s = document.getElementById("tl-op"); s.value = "0.4"; s.dispatchEvent(new Event("input", { bubbles: true })); });
ok(await p.evaluate(() => Math.abs(+getComputedStyle(document.querySelector(".osap-tl-low")).opacity - 0.4) < 0.01), "the opacity slider sets the layers' opacity");
await tick("slope", true); await p.waitForTimeout(1500);
/* opening another tab switches the other overlays off (index.html extrasOff); terrain layers stay, like the elevation shading */
const tab0 = await p.evaluate(() => document.documentElement.getAttribute("data-view"));
await p.evaluate((t) => { const b = document.querySelector('#view-seg [data-view="' + (t === "alerts" ? "timeline" : "alerts") + '"]'); b.click(); }, tab0); await p.waitForTimeout(1500);
ok(await p.evaluate((t) => document.documentElement.getAttribute("data-view") !== t, tab0), "another tab opened (" + tab0 + " -> " + await p.evaluate(() => document.documentElement.getAttribute("data-view")) + ")");
ok(await p.evaluate(() => window.OSAP_TERRAIN_LAYERS.on("slope") && window.OSAP_TERRAIN_LAYERS.on("contour") && document.querySelectorAll("#ml-tl input[data-tl]:checked").length === 4), "the terrain layers (and Fit to view) stay on when another tab opens");
if (process.env.OUT) await p.screenshot({ path: process.env.OUT + "/terrain-layers-slope.png" });
await load();
const st = await p.evaluate(() => window.OSAP_TERRAIN_LAYERS.state());
ok(st.on.slope && st.on.contour && st.on.low && st.low === 1 && Math.abs(st.op - 0.4) < 0.01 && st.layers.length === 3, "they come back after a reload: " + JSON.stringify(st));
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
