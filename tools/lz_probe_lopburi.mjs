// Test only (probe branch, not for main): what open data says round the Lop Buri spot where Nearest LZ picked a road between
// buildings (47P PS 82521 37992 map centre, 2026-10-03). Prints OpenStreetMap features, ESA WorldCover access and classes,
// and what the LZ finder returns from the start.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const START = [14.80022, 100.69635], B = [14.80076, 100.69550];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
async function overpass(q) {
  for (const u of ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]) {
    try { const r = await fetch(u, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "AXIOM-OSAP probe" } }); if (r.ok) return await r.json(); console.log("overpass", u, r.status); } catch (e) { console.log("overpass", u, e.message); }
  }
  return null;
}
const j = await overpass(`[out:json][timeout:60];nwr(around:600,${START[0]},${START[1]});out tags center qt;`);
if (j) {
  const sum = {};
  for (const e of j.elements) {
    const t = e.tags || {}; if (!Object.keys(t).length) continue;
    const k = ["building", "landuse", "natural", "aeroway", "military", "highway", "leisure", "amenity", "power", "barrier", "waterway"].find((x) => t[x]);
    const key = k ? k + "=" + t[k] : "other:" + Object.keys(t).slice(0, 2).join(",");
    (sum[key] = sum[key] || []).push((t.name || "") + (e.center ? " @" + e.center.lat.toFixed(5) + "," + e.center.lon.toFixed(5) : e.lat ? " @" + e.lat.toFixed(5) + "," + e.lon.toFixed(5) : ""));
  }
  for (const [k, v] of Object.entries(sum).sort()) console.log(k, v.length, v.slice(0, 6).join(" | "));
}
const near = await overpass(`[out:json][timeout:60];nwr(around:80,${B[0]},${B[1]});out tags geom qt;`);
if (near) console.log("within 80 m of B:", JSON.stringify(near.elements.map((e) => ({ t: e.type, tags: e.tags }))).slice(0, 3000));
/* ESA WorldCover */
for (const u of ["https://services.terrascope.be/wms/v2?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0", "https://services.terrascope.be/wmts/v2?SERVICE=WMTS&REQUEST=GetCapabilities"]) {
  try { const r = await fetch(u, { headers: { Origin: "https://01shane89-jpg.github.io" } }); const t = await r.text(); console.log(u, r.status, "cors:", r.headers.get("access-control-allow-origin"), t.length);
    console.log((t.match(/<(ows:)?Identifier>[^<]*WORLDCOVER[^<]*</g) || t.match(/<Name>[^<]*WORLDCOVER[^<]*</g) || []).slice(0, 12).join(" "));
    console.log((t.match(/<TileMatrixSet>[^<]*</g) || []).slice(0, 8).join(" "));
  } catch (e) { console.log(u, e.message); }
}
const d = 0.004, bbox = [START[0] - d, START[1] - d, START[0] + d, START[1] + d];
const wms = `https://services.terrascope.be/wms/v2?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=WORLDCOVER_2021_MAP&STYLES=&CRS=EPSG:4326&BBOX=${bbox.join(",")}&WIDTH=200&HEIGHT=200&FORMAT=image/png`;
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(process.cwd(), path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const browser = await chromium.launch();
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 1000 } });
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("pageerror", e.message));
await p.goto(`http://127.0.0.1:${server.address().port}/#th/`, { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_AREA_TOOLS, null, { timeout: 60000 });
await p.waitForTimeout(3000);
const wc = await p.evaluate(async ({ wms, START, B, bbox }) => {
  try {
    const im = new Image(); im.crossOrigin = "anonymous";
    await new Promise((res, rej) => { im.onload = res; im.onerror = () => rej(new Error("img error")); im.src = wms; });
    const c = document.createElement("canvas"); c.width = c.height = 200; const g = c.getContext("2d"); g.drawImage(im, 0, 0);
    const at = (q) => { const x = Math.floor((q[1] - bbox[1]) / (bbox[3] - bbox[1]) * 200), y = Math.floor((bbox[2] - q[0]) / (bbox[2] - bbox[0]) * 200); return Array.from(g.getImageData(x, y, 1, 1).data).join(","); };
    const hist = {}; const d = g.getImageData(0, 0, 200, 200).data; for (let i = 0; i < d.length; i += 4) { const k = d[i] + "," + d[i + 1] + "," + d[i + 2]; hist[k] = (hist[k] || 0) + 1; }
    return { start: at(START), B: at(B), hist };
  } catch (e) { return { err: e.message }; }
}, { wms, START, B, bbox });
console.log("WorldCover in browser:", JSON.stringify(wc));
await p.evaluate(() => window.OSAP_AREA_TOOLS.filter((t) => t.id === "lz")[0].run());
await p.waitForFunction(() => window.OSAP_LZ && window.OSAP_LZ.isOpen(), null, { timeout: 30000 });
for (const sz of ["100", "50"]) {
  await p.selectOption("#lz-r", "0.5"); await p.selectOption("#lz-d", sz);
  await p.evaluate((c) => window.OSAP_LZ.at(c), START);
  await p.waitForFunction(() => !window.OSAP_LZ.state().busy, null, { timeout: 240000 }).catch(() => console.log("timed out"));
  const s = await p.evaluate(() => { const s = window.OSAP_LZ.state(); return { err: s.err, cands: s.res && s.res.cands.map((k) => ({ lat: +k.lat.toFixed(5), lon: +k.lon.toFixed(5), clearD: k.clearD, surface: k.surface, near: k.near.slice(0, 4).map((o) => o.n + " " + Math.round(o.m) + " m " + o.dir) })), pads: s.res && s.res.pads, counts: s.res && s.res.counts, warn: s.res && s.res.warn }; });
  console.log("\n##### LZ " + sz + " m from start:", JSON.stringify(s, null, 1).slice(0, 5000));
  await p.screenshot({ path: "lz-out/lopburi-" + sz + ".png" });
}
await browser.close(); server.close();
