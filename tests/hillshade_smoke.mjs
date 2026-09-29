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
ok(rows.join() === "world,jp", "Layers menu lists the world hillshade and Japan LiDAR rows: " + rows.join());
ok(await p.evaluate(() => /Elevation and LiDAR/.test(document.querySelector("#ml-panel").textContent)), "rows sit under an Elevation and LiDAR heading");
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
await p.waitForTimeout(1500);
ok(asked.some((u) => u.includes("cyberjapandata.gsi.go.jp/xyz/hillshademap/")), "over Japan it asks GSI for hillshade tiles");
await tick("world", false); await tick("jp", false); await p.waitForTimeout(300);
ok((await layers()).length === 0, "unticking removes the layers");
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close(); server.close();
if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("all passed");
