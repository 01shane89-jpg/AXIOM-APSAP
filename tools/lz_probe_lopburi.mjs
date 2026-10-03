// Test only (probe branch, not for main): can a keyless satellite land-cover service see the buildings and trees that
// OpenStreetMap lacks round the Lop Buri LZ report (2026-10-03)?
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const START = [14.80022, 100.69635], B = [14.80076, 100.69550];
const SVC = "https://ic.imagery1.arcgis.com/arcgis/rest/services/Sentinel2_10m_LandCover/ImageServer";
for (const u of [SVC + "?f=json", "https://services.terrascope.be/wms/v2?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0", "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N12E099_Map.tif"]) {
  try { const r = await fetch(u, { method: /\.tif$/.test(u) ? "HEAD" : "GET", headers: { Origin: "https://01shane89-jpg.github.io" } }); const t = /\.tif$/.test(u) ? "" : await r.text();
    console.log("\n" + u, r.status, "cors:", r.headers.get("access-control-allow-origin"), "len", r.headers.get("content-length"), t.length);
    if (/f=json/.test(u)) { const j = JSON.parse(t); console.log(JSON.stringify({ name: j.name, timeInfo: j.timeInfo, pixelType: j.pixelType, extent: j.extent && j.extent.spatialReference, multidim: j.hasMultidimensions, rasterFunctionInfos: (j.rasterFunctionInfos || []).map((x) => x.name), cap: j.capabilities, maxImageWidth: j.maxImageWidth }).slice(0, 2500)); }
  } catch (e) { console.log(u, "ERR", e.message, e.cause && e.cause.code); }
}
try { const r = await fetch(SVC + "/rasterAttributeTable?f=json"); console.log("RAT", r.status, (await r.text()).slice(0, 1500)); } catch (e) { console.log("RAT ERR", e.message); }
const d = 0.003, bb = [START[1] - d, START[0] - d, START[1] + d, START[0] + d];
const ex = (extra) => `${SVC}/exportImage?bbox=${bb.join(",")}&bboxSR=4326&imageSR=4326&size=120,120&format=png&interpolation=RSP_NearestNeighbor&f=image${extra}`;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(process.cwd(), path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const browser = await chromium.launch();
const p = await (await browser.newContext()).newPage();
await p.goto(`http://127.0.0.1:${server.address().port}/manifest.webmanifest`);
for (const extra of ["", "&renderingRule=" + encodeURIComponent(JSON.stringify({ rasterFunction: "None" })), "&time=1704067200000", "&renderingRule=" + encodeURIComponent(JSON.stringify({ rasterFunction: "None" })) + "&time=1704067200000"]) {
  const url = ex(extra);
  const out = await p.evaluate(async ({ url, START, B, bb }) => {
    try {
      const im = new Image(); im.crossOrigin = "anonymous";
      await new Promise((res, rej) => { im.onload = res; im.onerror = () => rej(new Error("img error")); im.src = url; });
      const c = document.createElement("canvas"); c.width = c.height = 120; const g = c.getContext("2d"); g.drawImage(im, 0, 0);
      const D = g.getImageData(0, 0, 120, 120).data;
      const at = (q) => { const x = Math.floor((q[1] - bb[0]) / (bb[2] - bb[0]) * 120), y = Math.floor((bb[3] - q[0]) / (bb[3] - bb[1]) * 120), i = (y * 120 + x) * 4; return [D[i], D[i + 1], D[i + 2], D[i + 3]].join(","); };
      const hist = {}; for (let i = 0; i < D.length; i += 4) { const k = [D[i], D[i + 1], D[i + 2], D[i + 3]].join(","); hist[k] = (hist[k] || 0) + 1; }
      /* a coarse picture: 24 x 24 letters, one per colour */
      const keys = Object.keys(hist).sort((a, b) => hist[b] - hist[a]), L = "abcdefghijklmnopqrstuvwxyz";
      let pic = ""; for (let y = 0; y < 120; y += 5) { for (let x = 0; x < 120; x += 5) { const i = (y * 120 + x) * 4; pic += L[keys.indexOf([D[i], D[i + 1], D[i + 2], D[i + 3]].join(","))] || "?"; } pic += "\n"; }
      return { w: im.naturalWidth, start: at(START), B: at(B), hist: keys.slice(0, 12).map((k, i) => L[i] + "=" + k + " x" + hist[k]), pic };
    } catch (e) { return { err: e.message }; }
  }, { url, START, B, bb });
  console.log("\n### exportImage" + extra.slice(0, 80) + "\n" + JSON.stringify({ ...out, pic: undefined }) + "\n" + (out.pic || ""));
}
const id = await fetch(`${SVC}/identify?geometry=${START[1]},${START[0]}&geometryType=esriGeometryPoint&sr=4326&returnCatalogItems=false&f=json`).then((r) => r.text()).catch((e) => e.message);
console.log("identify start:", id.slice(0, 800));
const idb = await fetch(`${SVC}/identify?geometry=${B[1]},${B[0]}&geometryType=esriGeometryPoint&sr=4326&returnCatalogItems=false&f=json`).then((r) => r.text()).catch((e) => e.message);
console.log("identify B:", idb.slice(0, 800));
await browser.close(); server.close();
