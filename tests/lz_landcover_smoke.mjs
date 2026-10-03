// Headless check that the landing zone finder (assets/osap-lz.js) uses satellite land cover where OpenStreetMap is empty or
// wrong, as on the Lop Buri base where Nearest LZ picked a spot between unmapped buildings (2026-10-03). Same made-up ground as
// tests/lz_smoke.mjs; the Esri Sentinel-2 10 m land cover service is answered with "built area" over the patch OpenStreetMap
// calls farmland and "rangeland" elsewhere.
// Checks: the land cover is asked for on the search window's own grid (raw classes, 2024 map); no candidate lands on the
// built-up patch and nearby candidates name it; the card credits the land cover and the warning says buildings come from it;
// with the land cover service down the search still runs, says the land cover did not load, and the farmland is offered
// again (so the block came from the land cover); no page errors.
// Run from the repo root: node tests/lz_landcover_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { deflateSync } from "node:zlib";
import { chromium } from "playwright";
const OUT = process.env.OUT || "";
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

/* ---------- made-up elevation: terrarium PNG tiles ---------- */
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(b) { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const EAST = 100.512;
function elev(lat, lon) { return 100 + (lon > EAST ? (lon - EAST) * 108000 * 0.35 : 0); }   /* about 19 degrees east of EAST */
function tile(z, x, y) {
  const n = 2 ** z, rgb = Buffer.alloc(256 * 256 * 3);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
    const lon = (x + (i + 0.5) / 256) / n * 360 - 180, lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + (j + 0.5) / 256) / n))) * 180 / Math.PI;
    const v = elev(lat, lon) + 32768, k = (j * 256 + i) * 3;
    rgb[k] = Math.floor(v / 256); rgb[k + 1] = Math.floor(v) % 256; rgb[k + 2] = Math.round((v % 1) * 256) % 256;
  }
  return png(256, 256, rgb);
}

/* ---------- made-up OpenStreetMap ---------- */
const box = (s, w, n, e) => [{ lat: s, lon: w }, { lat: s, lon: e }, { lat: n, lon: e }, { lat: n, lon: w }, { lat: s, lon: w }];
const C0 = [13.75, 100.5];
const LINE_LON = 100.5035;
const HOUSE = [13.7485, 100.4930];
const OSM = { elements: [
  { type: "way", id: 1, tags: { landuse: "forest" }, geometry: box(13.752, 100.484, 13.766, 100.4985) },
  { type: "way", id: 2, tags: { landuse: "residential", name: "Test Village" }, geometry: box(13.733, 100.488, 13.7445, 100.507) },
  { type: "way", id: 3, tags: { leisure: "pitch", sport: "soccer" }, geometry: box(13.7383, 100.4965, 13.7400, 100.4983) },
  { type: "way", id: 4, tags: { landuse: "farmland" }, geometry: box(13.7455, 100.484, 13.7515, 100.502) },
  { type: "way", id: 5, tags: { building: "house" }, geometry: box(HOUSE[0] - 0.0001, HOUSE[1] - 0.0001, HOUSE[0] + 0.0001, HOUSE[1] + 0.0001) },
  { type: "way", id: 6, tags: { natural: "water" }, geometry: box(13.7525, 100.5045, 13.757, 100.5105) },
  { type: "way", id: 7, tags: { power: "line", voltage: "115000" }, geometry: [{ lat: 13.744, lon: LINE_LON }, { lat: 13.768, lon: LINE_LON }] },
  { type: "node", id: 8, lat: 13.7505, lon: 100.5005, tags: { aeroway: "helipad", name: "Test Pad" } }
] };
const inBox = (p, s, w, n, e) => p[0] >= s && p[0] <= n && p[1] >= w && p[1] <= e;
const metres = (a, b) => { const r = Math.PI / 180, x = (b[1] - a[1]) * r * Math.cos((a[0] + b[0]) / 2 * r), y = (b[0] - a[0]) * r; return Math.hypot(x, y) * 6371008.8; };
const FARM = [13.7455, 100.484, 13.7515, 100.502];
/* Web Mercator metres to lat/lon */
const unM = (x, y) => [Math.atan(Math.sinh(y / 6378137)) * 180 / Math.PI, x / 6378137 * 180 / Math.PI];
function landcover(u) {
  const q = new URL(u).searchParams, bb = q.get("bbox").split(",").map(Number), sz = q.get("size").split(",").map(Number), w = sz[0], h = sz[1], rgb = Buffer.alloc(w * h * 3);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const p = unM(bb[0] + (i + 0.5) / w * (bb[2] - bb[0]), bb[3] - (j + 0.5) / h * (bb[3] - bb[1])), k = (j * w + i) * 3;
    rgb[k] = rgb[k + 1] = rgb[k + 2] = inBox(p, ...FARM) ? 7 : 11;
  }
  return png(w, h, rgb);
}
async function run(lcDown) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1366, height: 860 } });
  const errors = [], lcUrls = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    const m = u.match(/elevation-tiles-prod\/terrarium\/(\d+)\/(\d+)\/(\d+)\.png/);
    if (m) return r.fulfill({ status: 200, contentType: "image/png", headers: { "Access-Control-Allow-Origin": "*" }, body: tile(+m[1], +m[2], +m[3]) });
    if (/\/api\/interpreter/.test(u)) return r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(OSM) });
    if (/Sentinel2_10m_LandCover\/ImageServer\/exportImage/.test(u)) { lcUrls.push(u); return lcDown ? r.fulfill({ status: 500, body: "" }) : r.fulfill({ status: 200, contentType: "image/png", headers: { "Access-Control-Allow-Origin": "*" }, body: landcover(u) }); }
    return r.abort();
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base, { waitUntil: "domcontentloaded" }); await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK, null, { timeout: 60000 }); await p.waitForTimeout(3500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(400);
  await p.evaluate(() => window.OSAP_AREA_TOOLS.filter((t) => t.id === "lz")[0].run());
  await p.waitForFunction(() => window.OSAP_LZ && window.OSAP_LZ.isOpen(), null, { timeout: 30000 });
  await p.evaluate((c) => window.OSAP_LZ.at(c), C0);
  await p.waitForFunction(() => !window.OSAP_LZ.state().busy && (window.OSAP_LZ.state().res || window.OSAP_LZ.state().err), null, { timeout: 60000 });
  const st = await p.evaluate(() => { const s = window.OSAP_LZ.state(); return { err: s.err, cands: s.res ? s.res.cands.map((k) => ({ lat: k.lat, lon: k.lon, near: k.near.map((o) => o.n), surface: k.surface })) : [], warn: s.res ? s.res.warn : [], card: document.getElementById("lz-card").textContent }; });
  await ctx.close();
  return { st, errors, lcUrls };
}
{
  const { st, errors, lcUrls } = await run(false);
  const q = lcUrls[0] ? new URL(lcUrls[0]).searchParams : null;
  ok(q && q.get("bboxSR") === "3857" && /"None"/.test(q.get("renderingRule")) && q.get("time") === String(Date.UTC(2024, 0, 1)) && q.get("interpolation") === "RSP_NearestNeighbor", "land cover asked for once, raw classes of the 2024 map on the Web Mercator grid (" + lcUrls.length + ")");
  ok(!st.err && st.cands.length >= 1, "a search with land cover finds candidates (" + st.cands.length + ")" + (st.err ? " " + st.err : ""));
  const onFarm = st.cands.filter((k) => inBox([k.lat, k.lon], ...FARM));
  ok(onFarm.length === 0, "no candidate on the patch OpenStreetMap calls farmland but the land cover calls built-up " + JSON.stringify(onFarm.map((k) => [+k.lat.toFixed(4), +k.lon.toFixed(4)])));
  ok(st.cands.some((k) => k.near.includes("Built-up area")), "a nearby candidate names the built-up area as an obstacle");
  ok(/Sentinel-2 10 m land cover \(2024/.test(st.card), "the card credits the land cover");
  ok(st.warn.some((w) => /come from 10 m satellite land cover .*ha blocked that OpenStreetMap left open/.test(w)), "the warning says built-up land and trees come from the land cover (" + st.warn.join(" | ").slice(0, 200) + ")");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
}
{
  const { st, errors } = await run(true);
  ok(!st.err && st.cands.length >= 1, "land cover down: the search still runs (" + st.cands.length + ")");
  ok(st.warn.some((w) => /Satellite land cover did not load/.test(w)), "land cover down: says so");
  ok(st.cands.some((k) => inBox([k.lat, k.lon], ...FARM)), "land cover down: the farmland is offered again, so the block came from the land cover");
  ok(!errors.length, "land cover down: no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
