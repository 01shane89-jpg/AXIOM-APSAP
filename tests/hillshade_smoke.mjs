// Headless check of the elevation shading overlays in the Layers menu (index.html HSX / setShade): the rows are listed,
// ticking one adds a multiplied tile layer asking the right host, the Shading slider sets its opacity, it stays on when
// another tab opens (extrasOff leaves it), a reload brings it back, and unticking removes it. Outside hosts are blocked.
// Run from the repo root: node tests/hillshade_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
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
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 800 } });
const asked = [];
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { asked.push(r.request().url()); r.abort(); });
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
async function load(hash) {
  await p.goto(base + (hash || ""), { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && document.querySelector("#ml-panel"), null, { timeout: 60000 }); await p.waitForTimeout(3000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
}
const tick = (k, on) => p.evaluate(([k, on]) => { const i = document.querySelector('#ml-panel input[data-hs="' + k + '"]'); i.checked = on; i.dispatchEvent(new Event("change", { bubbles: true })); }, [k, on]);
const layers = () => p.evaluate(() => [...document.querySelectorAll("#map .leaflet-tile-pane .osap-hs")].map((d) => ({ op: d.style.opacity, blend: getComputedStyle(d).mixBlendMode, z: d.style.zIndex })));

await load("#th");
const rows = await p.evaluate(() => [...document.querySelectorAll('#ml-panel input[data-hs]')].map((i) => i.dataset.hs));
ok(rows.join() === "world,jp", "Layers menu lists the world hillshade and Japan relief rows: " + rows.join());
ok(await p.evaluate(() => /Elevation and terrain analysis/.test(document.querySelector("#ml-panel").textContent)), "rows sit under the Elevation and terrain analysis heading");
asked.length = 0; await tick("world", true); await p.waitForTimeout(800);
let L1 = await layers();
ok(L1.length === 1 && L1[0].blend === "multiply", "ticking the world hillshade adds one multiplied layer in the base-map pane");
ok(asked.some((u) => u.includes("server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/")), "it asks Esri World Hillshade for tiles");
await p.evaluate(() => { const r = document.querySelector("#ml-hsop"); r.value = "0.8"; r.dispatchEvent(new Event("input")); });
ok((await layers())[0].op === "0.8", "the Shading slider sets the layer opacity");
// another tab opens: extrasOff switches the other overlays off, not this one
await p.evaluate(() => { location.hash = "#th/alerts"; }); await p.waitForTimeout(1500);
ok((await layers()).length === 1 && await p.evaluate(() => document.querySelector('#ml-panel input[data-hs="world"]').checked), "the hillshade stays on when another tab opens");
await load("#th");
ok((await layers()).length === 1, "a reload brings the hillshade back (saved on this device)");
// Japan layer asks GSI only for tiles inside Japan
await p.evaluate(() => window.FW.map.setView([13.7, 100.5], 8, { animate: false })); await p.waitForTimeout(500);
asked.length = 0; await tick("jp", true); await p.waitForTimeout(800);
// Leaflet's bounds option: any tile asked for must overlap Japan (20-46 N, 122-154 E)
const lon = (x, z) => x / 2 ** z * 360 - 180, lat = (y, z) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** z))) * 180 / Math.PI;
const outside = asked.filter((u) => u.includes("cyberjapandata.gsi.go.jp")).filter((u) => {
  const [z, x, y] = u.match(/hillshademap\/(\d+)\/(\d+)\/(\d+)/).slice(1).map(Number);
  return lon(x + 1, z) <= 122 || lon(x, z) >= 154 || lat(y, z) <= 20 || lat(y + 1, z) >= 46;
});
ok(!outside.length, "Japan LiDAR asks for no tiles outside Japan while the map is over Thailand" + (outside.length ? ": " + outside.slice(0, 3).join(" ") : ""));
await load("#jp");
// the map itself over Japan (this used to pass only because a hidden watch-check frame loaded Japan's tiles)
await p.evaluate(() => window.__asapMap.setView([35.36, 138.73], 9, { animate: false }));
await p.waitForTimeout(1500);
ok(asked.some((u) => u.includes("cyberjapandata.gsi.go.jp/xyz/hillshademap/")), "over Japan it asks GSI for hillshade tiles");
await tick("world", false); await tick("jp", false); await p.waitForTimeout(300);
ok((await layers()).length === 0, "unticking removes the layers");

// ---------- 3D elevation in Japan (assets/osap-3d.js demTile), with made-up tiles instead of the network ----------
// GSI tile: 3776.00 m on the left half, no value (2^23) on the right half; AWS terrarium tile: 100 m everywhere.
const png = (kind) => p.evaluate((kind) => {
  const c = document.createElement("canvas"); c.width = c.height = 256; const x = c.getContext("2d"), im = x.createImageData(256, 256), d = im.data;
  for (let k = 0, i = 0; k < 65536; k++, i += 4) {
    if (kind === "aws") { const v = 100 + 32768; d[i] = v >> 8; d[i + 1] = v & 255; d[i + 2] = 0; }
    else if (kind === "gsi5" ? (k >> 8) < 128 : (k & 255) < 128) { const v = kind === "gsi5" ? 377612 : 377600; d[i] = v >> 16; d[i + 1] = (v >> 8) & 255; d[i + 2] = v & 255; }
    else { d[i] = 128; d[i + 1] = 0; d[i + 2] = 0; }
    d[i + 3] = 255;
  }
  x.putImageData(im, 0, 0); return c.toDataURL("image/png").split(",")[1];
}, kind);
const T = { aws: Buffer.from(await png("aws"), "base64"), gsi: Buffer.from(await png("gsi"), "base64"), gsi5: Buffer.from(await png("gsi5"), "base64") };
const hits = [];
await p.route(/cyberjapandata\.gsi\.go\.jp\/xyz\/dem(5a)?_png\/|elevation-tiles-prod\/terrarium\//, (r) => {
  const u = r.request().url(); hits.push(u);
  if (/terrarium/.test(u)) return r.fulfill({ status: 200, contentType: "image/png", body: T.aws, headers: { "Access-Control-Allow-Origin": "*" } });
  if (/dem5a_png\/15\/29034\//.test(u)) return r.fulfill({ status: 200, contentType: "image/png", body: T.gsi5, headers: { "Access-Control-Allow-Origin": "*" } });
  if (/dem5a_png/.test(u) || /dem_png\/12\/9999\//.test(u)) return r.fulfill({ status: 404, body: "", headers: { "Access-Control-Allow-Origin": "*" } });
  return r.fulfill({ status: 200, contentType: "image/png", body: T.gsi, headers: { "Access-Control-Allow-Origin": "*" } });
});
const dem = (url) => p.evaluate((url) => window.OSAP_3D._demTile({ url: url }, new AbortController()).then(async (r) => {
  const bm = await createImageBitmap(new Blob([r.data]), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const c = document.createElement("canvas"); c.width = c.height = 256; const x = c.getContext("2d"); x.drawImage(bm, 0, 0); const d = x.getImageData(0, 0, 256, 256).data;
  const h = (k) => d[k * 4] * 256 + d[k * 4 + 1] + d[k * 4 + 2] / 256 - 32768;
  return { tl: h(0), tr: h(255), bl: h(255 * 256), br: h(65535) };
}), url);
let H = await dem("osapdem://12/3629/1617");   /* Mt Fuji, z12 */
ok(Math.abs(H.tl - 3776) < 0.01 && Math.abs(H.bl - 3776) < 0.01, "3D Japan: GSI 10 m heights are decoded (3776 m): " + JSON.stringify(H));
ok(Math.abs(H.tr - 100) < 0.01 && Math.abs(H.br - 100) < 0.01, "3D Japan: pixels GSI has no value for come from the AWS tile (100 m)");
ok(hits.some((u) => u.includes("/xyz/dem_png/12/3629/1617.png")), "3D Japan: asks GSI dem_png for the tile");
hits.length = 0; H = await dem("osapdem://15/29034/12938");   /* z15 near Fuji: laser 5 m top half, 10 m parent fills the rest */
ok(Math.abs(H.tl - 3776.12) < 0.01 && Math.abs(H.tr - 3776.12) < 0.01, "3D Japan z15: the 5 m laser model is used where it has values: " + JSON.stringify(H));
ok(Math.abs(H.bl - 3776) < 0.01 && Math.abs(H.br - 3776) < 0.01, "3D Japan z15: the rest comes from the 10 m parent tile (left half of it for an even x)");
ok(hits.some((u) => u.includes("/dem_png/14/14517/6469.png")), "3D Japan z15: the 10 m parent is the z14 tile above");
hits.length = 0; H = await dem("osapdem://12/9999/1617");   /* inside the box but GSI has no tile: AWS as is */
ok(Math.abs(H.tl - 100) < 0.01, "3D Japan: a tile GSI does not have is the AWS tile");
hits.length = 0; H = await dem("osapdem://12/3200/1900");   /* Thailand */
ok(Math.abs(H.tl - 100) < 0.01 && !hits.some((u) => u.includes("cyberjapandata")), "3D outside Japan: AWS only, GSI never asked");
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close(); server.close();
if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("all passed");
