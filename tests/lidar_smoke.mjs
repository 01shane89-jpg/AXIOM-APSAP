// Headless check of the LiDAR rows in Map overlays (assets/osap-lidar.js) and LiDAR heights in Terrain analysis.
// Mapterhorn is answered by made-up files, so the check is the same every run: a coverage file (PMTiles of one polygon,
// "ukengland", 1 m, over London), its source list, and terrarium elevation tiles that exist down to zoom 12 everywhere and
// to zoom 16 only inside the polygon (north-south ridges, so the shading shows).
// Checks: Elevation and terrain analysis lists LiDAR hillshade and LiDAR coverage above the Esri row, which no longer claims
// LiDAR everywhere; coverage paints the polygon in the 1 m class colour and nothing outside it; the legend lists the classes
// and names the model at the map centre (and "no LiDAR" outside); OSAP_LIDAR.at finds the model inside and none outside;
// the hillshade draws shaded tiles from Mapterhorn, enlarging zoom 12 outside the polygon with each missing tile asked once;
// both stay on when another tab opens and come back after a reload; Elevation here and a viewshed inside the polygon use
// Mapterhorn and say "LiDAR 1 m or finer" with the model name; "High detail" there runs on a finer grid than 10 m;
// outside it says no LiDAR; with Mapterhorn down the sums fall back to the other sources; no page errors.
// Run from the repo root: node tests/lidar_smoke.mjs   (needs the playwright package and Chromium)
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

/* ---------- the made-up world ---------- */
const BOX = { s: 51.35, w: -0.45, n: 51.65, e: 0.25 };   /* the "LiDAR" polygon */
const IN = [51.5, -0.12], OUT = [52.4, -1.9];
const gx = (lon, z) => (lon + 180) / 360 * 2 ** z;
const gy = (lat, z) => { const s = Math.sin(lat * Math.PI / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z; };
const lonOf = (X, z) => X / 2 ** z * 360 - 180;
const latOf = (Y, z) => Math.atan(Math.sinh(Math.PI * (1 - 2 * Y / 2 ** z))) * 180 / Math.PI;
const inBox = (lat, lon) => lat > BOX.s && lat < BOX.n && lon > BOX.w && lon < BOX.e;
const elev = (lat, lon) => 500 + 300 * Math.sin(lon * 2 * Math.PI / 0.01);   /* ridges every 0.01 degree of longitude, 600 m high */

/* PNG (RGB) for terrarium tiles */
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(b) { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
function mtTile(z, x, y) {
  const W = 512, rgb = Buffer.alloc(W * W * 3);
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
    const v = elev(latOf(y + (j + 0.5) / W, z), lonOf(x + (i + 0.5) / W, z)) + 32768, k = (j * W + i) * 3;
    rgb[k] = Math.floor(v / 256); rgb[k + 1] = Math.floor(v) % 256; rgb[k + 2] = Math.round((v % 1) * 256) % 256;
  }
  return png(W, W, rgb);
}
/* does the 512 px tile (z, x, y) exist: zoom 12 and coarser everywhere, 13 to 16 only where it touches the polygon */
function mtHas(z, x, y) {
  if (z <= 12) return true;
  if (z > 16) return false;
  return latOf(y + 1, z) < BOX.n && latOf(y, z) > BOX.s && lonOf(x + 1, z) > BOX.w && lonOf(x, z) < BOX.e;
}

/* ---------- a PMTiles v3 coverage file: one polygon, layer "coverage", attribute source = "ukengland" ---------- */
function varint(n) { const o = []; while (n >= 128) { o.push((n % 128) | 128); n = Math.floor(n / 128); } o.push(n); return Buffer.from(o); }
const key = (f, t) => varint(f * 8 + t);
const ld = (f, b) => Buffer.concat([key(f, 2), varint(b.length), b]);
const zz = (n) => (n << 1) ^ (n >> 31);
function mvt(z, x, y) {
  const E = 4096, P = [[BOX.w, BOX.n], [BOX.e, BOX.n], [BOX.e, BOX.s], [BOX.w, BOX.s]].map(([lon, lat]) => [Math.round((gx(lon, z) - x) * E), Math.round((gy(lat, z) - y) * E)]);
  const g = [1 * 1 + 8, zz(P[0][0]), zz(P[0][1]), 2 + 3 * 8];
  for (let i = 1; i < 4; i++) g.push(zz(P[i][0] - P[i - 1][0]), zz(P[i][1] - P[i - 1][1]));
  g.push(7 + 8);
  const packed = (a) => Buffer.concat(a.map(varint));
  const feat = Buffer.concat([ld(2, packed([0, 0])), key(3, 0), varint(3), ld(4, packed(g))]);
  const val = ld(1, Buffer.from("ukengland"));
  const layer = Buffer.concat([key(15, 0), varint(2), ld(1, Buffer.from("coverage")), ld(2, feat), ld(3, Buffer.from("source")), ld(4, val), key(5, 0), varint(E)]);
  return ld(3, layer);
}
function tileId(z, x, y) {
  let acc = 0; for (let t = 0; t < z; t++) acc += 4 ** t;
  const n = 2 ** z; let d = 0;
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = (x & s) > 0 ? 1 : 0, ry = (y & s) > 0 ? 1 : 0; d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) { if (rx === 1) { x = n - 1 - x; y = n - 1 - y; } const t = x; x = y; y = t; }
  }
  return acc + d;
}
function pmtiles() {
  const tiles = [];
  for (let z = 0; z <= 11; z++) {
    const x0 = Math.floor(gx(BOX.w, z)), x1 = Math.floor(gx(BOX.e, z)), y0 = Math.floor(gy(BOX.n, z)), y1 = Math.floor(gy(BOX.s, z));
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push({ id: tileId(z, x, y), data: mvt(z, x, y) });
  }
  tiles.sort((a, b) => a.id - b.id);
  let off = 0; tiles.forEach((t) => { t.off = off; off += t.data.length; });
  const dir = Buffer.concat([varint(tiles.length), ...tiles.map((t, i) => varint(t.id - (i ? tiles[i - 1].id : 0))), ...tiles.map(() => varint(1)), ...tiles.map((t) => varint(t.data.length)),
    ...tiles.map((t, i) => varint(i && t.off === tiles[i - 1].off + tiles[i - 1].data.length ? 0 : t.off + 1))]);
  const meta = Buffer.from("{}"), data = Buffer.concat(tiles.map((t) => t.data));
  const H = Buffer.alloc(127); H.write("PMTiles", 0); H[7] = 3;
  const u64 = (o, v) => H.writeBigUInt64LE(BigInt(v), o);
  u64(8, 127); u64(16, dir.length); u64(24, 127 + dir.length); u64(32, meta.length); u64(40, 0); u64(48, 0);
  u64(56, 127 + dir.length + meta.length); u64(64, data.length); u64(72, tiles.length); u64(80, tiles.length); u64(88, tiles.length);
  H[96] = 1; H[97] = 1; H[98] = 1; H[99] = 1; H[100] = 0; H[101] = 11;
  H.writeInt32LE(-1800000000, 102); H.writeInt32LE(-850000000, 106); H.writeInt32LE(1800000000, 110); H.writeInt32LE(850000000, 114);
  return Buffer.concat([H, dir, meta, data]);
}
const COVF = pmtiles();
const ATT = JSON.stringify([
  { source: "ukengland", name: "LIDAR Composite Digital Terrain Model (DTM) - 1m", resolution: 1, license: "Open Government Licence", producer: "© Environment Agency", website: "https://environment.data.gov.uk/" },
  { source: "glo30", name: "COPERNICUS GLO-30", resolution: 30, license: "COPERNICUS full, free and open license", producer: "DLR e.V., Airbus, ESA", website: "https://example.org/" }]);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "Content-Range, Content-Length, ETag" };

async function open(opt) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 820 } });
  const asked = { mt: [], cov: 0 }, net = { mtDown: !!(opt && opt.mtDown) };
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
    const u = r.request().url();
    let m = u.match(/tiles\.mapterhorn\.com\/(\d+)\/(\d+)\/(\d+)\.webp/);
    if (m) {
      asked.mt.push(m[1] + "/" + m[2] + "/" + m[3]);
      if (net.mtDown) return r.fulfill({ status: 503, headers: CORS, body: "down" });
      if (!mtHas(+m[1], +m[2], +m[3])) return r.fulfill({ status: 404, headers: CORS, body: "not found" });
      return r.fulfill({ status: 200, contentType: "image/png", headers: CORS, body: mtTile(+m[1], +m[2], +m[3]) });
    }
    if (/download\.mapterhorn\.com\/attribution\.json/.test(u)) return r.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: ATT });
    if (/download\.mapterhorn\.com\/coverage\.pmtiles/.test(u)) {
      asked.cov++;
      const rg = (r.request().headers().range || "").match(/bytes=(\d+)-(\d+)/);
      const a = rg ? +rg[1] : 0, b = rg ? Math.min(+rg[2], COVF.length - 1) : COVF.length - 1, body = COVF.subarray(a, b + 1);
      return r.fulfill({ status: rg ? 206 : 200, headers: { ...CORS, "Content-Type": "application/octet-stream", "Content-Range": `bytes ${a}-${b}/${COVF.length}`, "Content-Length": String(body.length), ETag: '"cov1"' }, body });
    }
    if (/elevation-tiles-prod\/terrarium\//.test(u)) {
      /* the fallback source: flat 50 m, so a fallback is easy to tell from Mapterhorn's heights */
      const rgb = Buffer.alloc(256 * 256 * 3); for (let k = 0; k < rgb.length; k += 3) { rgb[k] = 128; rgb[k + 1] = 50; }
      return r.fulfill({ status: 200, contentType: "image/png", headers: CORS, body: png(256, 256, rgb) });
    }
    return r.abort();
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  return { ctx, p, errors, asked, net };
}
async function load(p, hash) {
  await p.goto(base + (hash || "#th"), { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_LIDAR && document.querySelector("#ml-panel [data-lidar]"), null, { timeout: 60000 }); await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
}
const tick = (p, k, on) => p.evaluate(([k, on]) => { const i = document.querySelector('#ml-panel input[data-lidar="' + k + '"]'); i.checked = on; i.dispatchEvent(new Event("change", { bubbles: true })); }, [k, on]);
const view = (p, ll, z) => p.evaluate(([ll, z]) => window.__asapMap.setView(ll, z, { animate: false }), [ll, z]);
/* the colour at a lat/lon on the canvas tiles of a grid layer, read from the tile canvas under that point */
const colourAt = (p, cls, ll) => p.evaluate(([cls, ll]) => {
  const map = window.__asapMap, pt = map.latLngToContainerPoint(ll), r = map.getContainer().getBoundingClientRect();
  for (const c of document.querySelectorAll(".leaflet-tile-pane " + cls + " canvas")) {
    const b = c.getBoundingClientRect();
    if (r.left + pt.x >= b.left && r.left + pt.x < b.right && r.top + pt.y >= b.top && r.top + pt.y < b.bottom) {
      const d = c.getContext("2d").getImageData(Math.floor((r.left + pt.x - b.left) * c.width / b.width), Math.floor((r.top + pt.y - b.top) * c.height / b.height), 1, 1).data;
      return [d[0], d[1], d[2], d[3]];
    }
  }
  return null;
}, [cls, ll]);

{
  const { ctx, p, errors, asked } = await open();
  await load(p);
  const order = await p.evaluate(() => [...document.querySelectorAll("#ml-elev input[type=checkbox]")].map((i) => i.dataset.lidar || i.dataset.hs));
  ok(order.slice(0, 4).join() === "hs,cov,world,jp", "Elevation and terrain analysis lists LiDAR hillshade and LiDAR coverage above the Esri and Japan rows: " + order.join());
  const esri = await p.evaluate(() => document.querySelector('#ml-elev input[data-hs="world"]').closest("label").textContent);
  ok(/Esri hillshade/.test(esri) && !/LiDAR where published/.test(esri) && /30 m satellite/.test(esri), "the Esri row says it is LiDAR only in parts of the US and Europe: " + esri.slice(0, 90));
  ok(asked.cov === 0 && asked.mt.length === 0, "nothing is downloaded from Mapterhorn before a row is switched on");

  /* coverage */
  await view(p, IN, 9); await tick(p, "cov", true); await p.waitForTimeout(2500);
  ok(asked.cov > 0, "LiDAR coverage reads Mapterhorn's coverage file");
  const cIn = await colourAt(p, "", IN), cOut = await colourAt(p, "", [51.1, -0.12]);
  ok(await p.evaluate(() => document.querySelectorAll(".leaflet-tile-pane canvas").length > 0), "coverage draws canvas tiles");
  const green = (c) => c && c[3] > 100 && c[1] > c[0] + 30 && c[1] > c[2];
  ok(green(cIn), "inside the polygon the map is painted in the 1 m class colour " + JSON.stringify(cIn));
  ok(!cOut || cOut[3] === 0, "outside the polygon nothing is painted " + JSON.stringify(cOut));
  const key = await p.evaluate(() => { const k = document.getElementById("ml-lidarkey"); return k && !k.hidden ? k.textContent : ""; });
  ok(/LiDAR 1 m or finer/.test(key) && /LiDAR 2 to 2\.5 m/.test(key) && /5 m model/.test(key) && /10 to 20 m/.test(key) && /Satellite only, about 30 m/.test(key), "the legend lists the four classes and the satellite-only rest");
  await p.waitForFunction(() => /At the map centre/.test((document.getElementById("ml-lidarnote") || {}).textContent || ""), null, { timeout: 15000 }).catch(() => {});
  const note = await p.evaluate(() => document.getElementById("ml-lidarnote").textContent);
  ok(/LiDAR 1 m or finer/.test(note) && /LIDAR Composite/.test(note) && /Open Government Licence/.test(note), "the legend names the model at the map centre with its licence: " + note);
  await view(p, OUT, 9); await p.waitForTimeout(1500);
  ok(/no LiDAR/.test(await p.evaluate(() => document.getElementById("ml-lidarnote").textContent)), "outside it says there is no LiDAR at the centre");
  const at = await p.evaluate(([a, b]) => Promise.all([window.OSAP_LIDAR.at(a[0], a[1]), window.OSAP_LIDAR.at(b[0], b[1])]).then((r) => r.map((x) => x.best && x.best.id)), [IN, OUT]);
  ok(at[0] === "ukengland" && at[1] === null, "OSAP_LIDAR.at finds the model inside and none outside: " + JSON.stringify(at));

  /* hillshade */
  /* the grey base map stops at zoom 13; the satellite one goes closer */
  await p.evaluate(() => window.OSAP_BASEMAP.set("sat"));
  await tick(p, "cov", false); await view(p, IN, 15); asked.mt.length = 0;
  await tick(p, "hs", true); await p.waitForTimeout(3000);
  ok(asked.mt.length > 0 && asked.mt.every((k) => +k.split("/")[0] === 15), "LiDAR hillshade asks Mapterhorn for the zoom's own 512 px tiles (drawn at twice the detail): " + [...new Set(asked.mt)].slice(0, 4).join(" "));
  const hs = await p.evaluate(() => [...document.querySelectorAll(".leaflet-tile-pane .osap-hs")].map((d) => getComputedStyle(d).mixBlendMode));
  ok(hs.length === 1 && hs[0] === "multiply", "it is one layer multiplied into the base map");
  const sh = []; for (let i = 0; i < 10; i++) sh.push(await colourAt(p, ".osap-hs", [IN[0], IN[1] + i * 0.001]));
  const vals = sh.map((c) => c ? c[0] : -1);
  ok(sh.every((c) => c && c[3] === 255) && Math.min(...vals) < 170 && Math.max(...vals) > 230, "across a ridge the ground is shaded light and dark: " + vals.join(","));
  /* outside the polygon: zoom 14 to 13 are missing, zoom 12 is enlarged; each missing tile asked once */
  asked.mt.length = 0; await view(p, OUT, 15); await p.waitForTimeout(3000);
  const zs = asked.mt.map((k) => +k.split("/")[0]), dup = asked.mt.length - new Set(asked.mt).size;
  ok(zs.includes(12) && zs.includes(15) && zs.includes(13) && dup === 0, "outside it falls back to zoom 12, asking each missing tile once (" + asked.mt.length + " asks, " + dup + " repeats)");
  ok((await colourAt(p, ".osap-hs", OUT) || [])[3] === 255, "and still draws shading there");

  /* tab change and reload keep both */
  await tick(p, "cov", true);
  await p.evaluate(() => { location.hash = "#th/alerts"; }); await p.waitForTimeout(1500);
  ok(await p.evaluate(() => [...document.querySelectorAll("#ml-panel input[data-lidar]")].every((i) => i.checked)), "both rows stay on when another tab opens");
  await load(p);
  ok(await p.evaluate(() => [...document.querySelectorAll("#ml-panel input[data-lidar]")].every((i) => i.checked) && document.querySelectorAll(".leaflet-tile-pane .osap-hs").length === 1), "a reload brings both back (saved on this device)");
  await tick(p, "hs", false); await tick(p, "cov", false);
  ok(await p.evaluate(() => !document.querySelector(".leaflet-tile-pane .osap-hs") && !JSON.parse(localStorage.getItem("osap-lidar")).hs), "unticking removes the layer and the choice");

  /* Terrain analysis */
  const el = await p.evaluate((ll) => window.OSAP_TERRAIN_ANALYSIS.elevationAt(ll[0], ll[1]), IN);
  ok(el.sources.some((s) => s.id === "mapterhorn") && Math.abs(el.elev_m - elev(IN[0], IN[1])) < 15 && el.lidar && el.lidar.centre && el.lidar.centre.id === "ukengland",
    "Elevation here inside the polygon uses Mapterhorn (" + Math.round(el.elev_m) + " m) and knows it is LiDAR");
  await p.evaluate((ll) => { window.__asapMap.setView(ll, 13); window.OSAP_ATAK.ring(ll[0], ll[1]); }, IN); await p.waitForTimeout(200);
  await p.click('#atk-ring [data-rk="terrain"]'); await p.waitForTimeout(200);
  await p.click('.vsmenu [data-vm="el"]');
  await p.waitForFunction(() => /m MSL|No elevation|did not/.test(document.querySelector(".vsmenu .el").textContent), null, { timeout: 20000 });
  const elt = await p.evaluate(() => document.querySelector(".vsmenu .el").textContent);
  ok(/LiDAR 1 m or finer here/.test(elt) && /Mapterhorn/.test(elt), "Elevation here says LiDAR 1 m and Mapterhorn: " + elt);
  await p.click('.vsmenu [data-vm="vs"]');
  const settled = () => p.waitForFunction(() => { const s = window.OSAP_TERRAIN_ANALYSIS.state(); return !s.busy && (s.pass === "fine" || s.err); }, null, { timeout: 90000 });
  await settled();
  let txt = await p.evaluate(() => document.getElementById("terrain").textContent);
  ok(/LiDAR:\s*LiDAR 1 m or finer at the observer: LIDAR Composite/.test(txt) && /Open Government Licence/.test(txt) && /LiDAR-class ground \(2\.5 m or finer\):\s*100%/.test(txt), "the viewshed names the LiDAR at the observer and its share: " + (txt.match(/LiDAR:[^·]*·[^%]*%/) || [""])[0]);
  ok(/Elevation:\s*Mapterhorn elevation/.test(txt), "the viewshed's elevation line names Mapterhorn");
  /* High detail at 1 km: finer than 10 m where there is 1 m LiDAR */
  const hi = await p.evaluate(() => new Promise((res) => {
    const b = document.querySelector('#terrain [data-res="high"]'); b.click();
    const k = document.getElementById("ts-km"); k.value = k.querySelector("option").value; k.dispatchEvent(new Event("change", { bubbles: true }));
    setTimeout(() => { const c = [...document.querySelectorAll("#terrain button")].find((x) => /calculate/i.test(x.textContent)); if (c) c.click(); res(k.value); }, 200);
  }));
  await p.waitForTimeout(500); await settled();
  const g = await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.state().grid);
  ok(g && g.res < 10, "High detail with a " + hi + " km range runs on a " + (g && g.res) + " m grid where 1 m LiDAR exists (10 m elsewhere)");
  /* outside: no LiDAR */
  const out = await p.evaluate((ll) => window.OSAP_TERRAIN_ANALYSIS.elevationAt(ll[0], ll[1]), OUT);
  ok(out.lidar && !out.lidar.centre && out.sources.some((s) => s.id === "mapterhorn"), "outside the polygon Elevation here still uses Mapterhorn (30 m) and says no LiDAR");
  ok(!errors.length, "no page errors: " + errors.join(" | "));
  await ctx.close();
}
/* Mapterhorn down: Terrain analysis falls back to the other sources */
{
  const { ctx, p, errors } = await open({ mtDown: true });
  await load(p);
  const el = await p.evaluate((ll) => window.OSAP_TERRAIN_ANALYSIS.elevationAt(ll[0], ll[1]), IN);
  ok(!el.nodata && Math.round(el.elev_m) === 50 && !el.sources.some((s) => s.id === "mapterhorn"), "with Mapterhorn down, Elevation here comes from the next source (" + Math.round(el.elev_m) + " m, " + el.sources.map((s) => s.id).join(",") + ")");
  ok(!errors.length, "no page errors with Mapterhorn down: " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
