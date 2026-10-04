// Test only: runs the LiDAR rows (assets/osap-lidar.js) and Terrain analysis on the real Mapterhorn service in a headless
// browser and prints what came back at a few places: the elevation model the coverage file names, Elevation here (height,
// sources, LiDAR), and a 1 km High detail viewshed's grid and LiDAR line. Fails when a place known to have LiDAR does not
// show it, or a place known to have none claims it. With SHOTS=1 it prints small JPEG screenshots (base64, between
// "SHOT name" and "END SHOT" lines) of the coverage layer and the hillshade, since the run's files cannot always be fetched.
// Run by the "Probe lidar sources" workflow; writes nothing to the repo. Run from the repo root: node tools/lidar_live.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(process.cwd(), path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
/* lidar: true = a model of 5 m or finer expected, false = none expected, null = just print */
const PLACES = [
  ["London (England EA 1 m)", 51.5, -0.12, true], ["Zurich (swissALTI3D)", 47.37, 8.54, true], ["Denver (USGS 3DEP)", 39.74, -104.99, true],
  ["Wellington (LINZ)", -41.29, 174.78, true], ["Sydney (GA 5 m)", -33.87, 151.2, null], ["Tokyo (GSI)", 35.68, 139.76, true], ["Madrid (PNOA)", 40.42, -3.7, true],
  ["Oslo (Kartverket)", 59.91, 10.75, true], ["Bangkok", 13.75, 100.5, false], ["Manila", 14.6, 121.0, false], ["Chiang Mai", 18.79, 98.98, false], ["Kabul", 34.53, 69.17, false]];
const ctx = await browser.newContext({ viewport: { width: 900, height: 640 } });
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TSAP && window.OSAP_LIDAR && window.OSAP_TERRAIN_ANALYSIS && document.querySelector("#ml-panel [data-lidar]"), null, { timeout: 90000 });
await p.waitForTimeout(3000);
await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
for (const [name, lat, lon, want] of PLACES) {
  const t0 = Date.now();
  const r = await p.evaluate(([lat, lon]) => Promise.all([window.OSAP_LIDAR.at(lat, lon), window.OSAP_TERRAIN_ANALYSIS.elevationAt(lat, lon)]).then(([a, e]) => ({
    best: a.best && { id: a.best.id, name: a.best.name, res: a.best.res, licence: a.best.licence }, n: a.sources.length,
    elev: e.elev_m, res: e.res_m, src: e.sources.map((s) => s.id), lidar: e.lidar && e.lidar.centre && e.lidar.centre.id })).catch((x) => ({ err: String(x && x.message || x) })), [lat, lon]);
  console.log(`${name}: ${JSON.stringify(r)} (${Date.now() - t0} ms)`);
  if (r.err) { ok(false, name + " errored"); continue; }
  if (want === true) ok(r.best && r.best.res <= 5 && r.src.includes("mapterhorn"), name + ": LiDAR-class model found and Mapterhorn heights used");
  if (want === false) ok(!r.best && r.src.includes("mapterhorn"), name + ": no LiDAR claimed, Mapterhorn 30 m used");
}
/* a 1 km High detail viewshed in London: finer than 10 m, and the result names the LiDAR */
{
  await p.evaluate(() => { window.__asapMap.setView([51.5, -0.12], 13); window.OSAP_TERRAIN_ANALYSIS.open(); });
  await p.waitForTimeout(500);
  await p.evaluate(() => { document.querySelector('#terrain [data-res="high"]').click(); const k = document.getElementById("ts-km"); k.value = "1"; k.dispatchEvent(new Event("change", { bubbles: true })); });
  await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.viewshedAt([51.5, -0.12]));
  await p.waitForFunction(() => { const s = window.OSAP_TERRAIN_ANALYSIS.state(); return !s.busy && (s.pass === "fine" || s.err); }, null, { timeout: 120000 }).catch(() => {});
  const st = await p.evaluate(() => { const s = window.OSAP_TERRAIN_ANALYSIS.state(); return { err: s.err, grid: s.grid && { res: s.grid.res, z: s.grid.z, cov: s.grid.coverage_pct, src: s.grid.sources.map((q) => q.id) }, vis: s.stats && s.stats.visible_pct, txt: ((document.getElementById("terrain") || {}).textContent || "").match(/LiDAR:[^·]*·[^%]*%/) }; });
  console.log("London viewshed: " + JSON.stringify(st));
  ok(!st.err && st.grid && st.grid.res < 10 && st.grid.src.includes("mapterhorn") && st.txt && /LiDAR 1 m or finer/.test(st.txt[0]), "London 1 km High detail viewshed runs on LiDAR and says so");
  await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.close());
}
async function shot(name) {
  if (!process.env.SHOTS) return;
  const b = await p.screenshot({ type: "jpeg", quality: 45 });
  console.log("SHOT " + name + "\n" + b.toString("base64") + "\nEND SHOT");
}
const tick = (k, on) => p.evaluate(([k, on]) => { const i = document.querySelector('#ml-panel input[data-lidar="' + k + '"]'); i.checked = on; i.dispatchEvent(new Event("change", { bubbles: true })); }, [k, on]);
await tick("cov", true);
for (const [n, c, z] of [["coverage-europe", [50, 8], 4], ["coverage-asia", [15, 110], 4], ["coverage-uk", [52.5, -1.5], 6]]) {
  await p.evaluate(([c, z]) => window.__asapMap.setView(c, z, { animate: false }), [c, z]); await p.waitForTimeout(9000);
  const note = await p.evaluate(() => document.getElementById("ml-lidarnote").textContent);
  console.log(n + " legend: " + note); await shot(n);
}
await tick("cov", false);
await p.evaluate(() => window.OSAP_BASEMAP.set("sat")); await tick("hs", true);
for (const [n, c, z] of [["hillshade-lake-district", [54.45, -3.1], 14], ["hillshade-zurich", [47.37, 8.54], 15], ["hillshade-chiangmai", [18.8, 98.92], 14]]) {
  await p.evaluate(([c, z]) => window.__asapMap.setView(c, z, { animate: false }), [c, z]); await p.waitForTimeout(9000); await shot(n);
}
ok(!errors.length, "no page errors: " + errors.join(" | "));
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
