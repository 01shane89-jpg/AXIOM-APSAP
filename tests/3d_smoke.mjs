// Headless check of the 3D terrain view, scale bar and compass (assets/osap-3d.js) on a phone and a desktop:
// the scale bar and its unit switch, the 3D button, MapLibre loaded only on demand, tilt slider, compass reset, points
// copied into 3D, and 2D again at the same place. Outside hosts are blocked, so the ground stays flat here (the check
// only needs the view to start). Run from the repo root: node tests/3d_smoke.mjs   (OUT=dir saves screenshots)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const OUT = process.env.OUT || "";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"], ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const shown = (p, s) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && getComputedStyle(e).display !== "none" && e.getClientRects().length > 0; }, s);
async function open(opts, classic) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [], libs = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript((classic) => { try { localStorage.setItem("osap-home", "map"); if (localStorage.getItem("osap-mapsets-th") == null) localStorage.setItem("osap-mapsets-th", JSON.stringify(["flood", "crime", "crisis"])); if (classic) localStorage.setItem("osap-ui", "classic"); } catch (e) {} }, classic);
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  p.on("request", (r) => { if (/maplibre-gl/.test(r.url())) libs.push(r.url()); });
  await p.goto(base, { waitUntil: "domcontentloaded" }); await p.waitForFunction(() => window.TSAP && window.OSAP_3D, null, { timeout: 60000 }); await p.waitForTimeout(3500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(400);
  return { ctx, p, errors, libs };
}
async function run3d(name, p, errors, libs, openSel) {
  ok(libs.length === 0, name + ": 3D engine not downloaded before 3D is opened");
  const before = await p.evaluate(() => { const m = window.__asapMap; m.setView([18.79, 98.98], 10, { animate: false }); return { c: m.getCenter(), z: m.getZoom() }; });
  await p.waitForTimeout(300);
  await p.click(openSel);
  const flat0 = await p.waitForFunction(() => window.OSAP_3D.gl && { p: window.OSAP_3D.gl.getPitch() }, null, { timeout: 30000, polling: "raf" }).then((h) => h.jsonValue()).then((v) => v.p).catch(() => 99);
  await p.waitForFunction(() => window.OSAP_3D.gl && window.OSAP_3D.gl.loaded && window.OSAP_3D.gl.isStyleLoaded(), null, { timeout: 30000 }).catch(() => {});
  ok(await shown(p, "#o3d .o3-map canvas"), name + ": 3D view opened with a WebGL canvas");
  ok(libs.some((u) => /maplibre-gl-5\.24\.0\.js$/.test(u)), name + ": 3D engine loaded from assets/vendor on demand");
  ok(flat0 < 30, name + ": opens looking straight down first, where the 2D pictures are already loaded (" + flat0.toFixed(0) + "°)");
  await p.waitForFunction(() => window.OSAP_3D.gl.getPitch() > 55 && !window.OSAP_3D.gl.isMoving(), null, { timeout: 15000 }).catch(() => {});
  const g = await p.evaluate(() => { const gl = window.OSAP_3D.gl; const c = gl.getCenter(); return { lat: c.lat, lng: c.lng, z: gl.getZoom(), pitch: gl.getPitch(), terrain: !!gl.getTerrain(), sky: !!gl.getStyle().sky, hill: !!gl.getLayer("hill"),
    rasters: gl.getStyle().layers.filter((l) => l.type === "raster").length, pts: (gl.getSource("vp").serialize().data.features || []).length }; });
  ok(Math.abs(g.lat - 18.79) < 0.01 && Math.abs(g.lng - 98.98) < 0.01 && Math.abs(g.z - 9) < 0.01, name + ": 3D opens at the 2D centre and scale " + JSON.stringify(g));
  ok(g.pitch > 55, name + ": then tilts to the saved angle (" + g.pitch.toFixed(0) + "°)");
  ok(g.terrain && g.hill && g.sky, name + ": terrain, hill shading and sky are on");
  ok(g.rasters >= 1, name + ": the 2D base map is draped over the ground (" + g.rasters + " tile layers)");
  ok(g.pts > 0, name + ": map points copied into 3D (" + g.pts + ")");
  ok(await shown(p, "#o3d .o3-scale .o3s-b"), name + ": scale bar shown in 3D");
  // tilt slider
  await p.evaluate(() => { const t = document.querySelector("#o3d .o3-tilt input"); t.value = "20"; t.dispatchEvent(new Event("input", { bubbles: true })); t.dispatchEvent(new Event("change", { bubbles: true })); });
  await p.waitForTimeout(200);
  ok(Math.round(await p.evaluate(() => window.OSAP_3D.gl.getPitch())) === 20, name + ": tilt slider sets the view angle");
  // compass
  await p.evaluate(() => { const gl = window.OSAP_3D.gl; gl.jumpTo({ bearing: 70, pitch: 50 }); });
  await p.waitForTimeout(100);
  const rot = await p.evaluate(() => document.querySelector("#o3d .o3-needle").getAttribute("transform"));
  ok(/rotate\(-70/.test(rot), name + ": compass needle turns with the map (" + rot + ")");
  await p.click("#o3d .o3-cmp"); await p.waitForFunction(() => !window.OSAP_3D.gl.isMoving(), null, { timeout: 8000 }).catch(() => {}); await p.waitForTimeout(300);
  const rs = await p.evaluate(() => ({ b: window.OSAP_3D.gl.getBearing(), p: window.OSAP_3D.gl.getPitch() }));
  ok(Math.abs(rs.b) < 0.5 && rs.p < 0.5, name + ": compass tap turns north-up and flat " + JSON.stringify(rs));
  // relief
  await p.click("#o3d .o3-ex"); ok(await p.evaluate(() => window.OSAP_3D.gl.getTerrain().exaggeration) === 2, name + ": relief button raises the terrain");
  await p.evaluate(() => window.OSAP_3D.gl.jumpTo({ pitch: 60, center: [99.1, 18.9], zoom: 9 }));
  await p.waitForTimeout(1500);
  if (OUT) await p.screenshot({ path: OUT + "/" + name + "-3d.png" });
  // tap a point: its popup, then Show in 2D
  const hit = await p.evaluate(() => { const gl = window.OSAP_3D.gl, f = gl.queryRenderedFeatures({ layers: ["vp"] }).filter((x) => x.properties.i)[0]; if (!f) return null; const pt = gl.project(f.geometry.coordinates); return { x: pt.x, y: pt.y }; });
  if (hit) {
    const r = await p.evaluate(() => document.querySelector("#o3d .o3-map").getBoundingClientRect().toJSON());
    await p.mouse.click(r.x + hit.x, r.y + hit.y); await p.waitForTimeout(400);
    ok(await shown(p, "#o3d .o3-pop"), name + ": tapping a point shows its popup in 3D");
  } else ok(true, name + ": (no point on screen to tap here)");
  await p.click("#o3d .o3-2d"); await p.waitForTimeout(500);
  ok(!(await p.$("#o3d")), name + ": 2D button closes the 3D view");
  const after = await p.evaluate(() => { const m = window.__asapMap; return { c: m.getCenter(), z: m.getZoom() }; });
  ok(Math.abs(after.c.lat - 18.9) < 0.02 && Math.abs(after.c.lng - 99.1) < 0.02 && after.z === 10, name + ": back in 2D at the same place " + JSON.stringify(after));
  ok(errors.length === 0, name + ": no page errors " + JSON.stringify(errors.slice(0, 3)));
  void before;
}

// ---------- phone, toolbar mode ----------
{
  const { ctx, p, errors, libs } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  ok(await shown(p, ".leaflet-bottom .o3s .o3s-b"), "phone: scale bar shown on the 2D map");
  const t1 = await p.textContent(".leaflet-bottom .o3s .o3s-t");
  ok(/km|\bm\b/.test(t1), "phone: scale bar in km by default: " + t1);
  await p.click(".leaflet-bottom .o3s"); const t2 = await p.textContent(".leaflet-bottom .o3s .o3s-t");
  ok(/mi|ft/.test(t2), "phone: tap switches the scale bar to miles: " + t2);
  ok(await p.evaluate(() => JSON.parse(localStorage.getItem("osap-meas-unit")).unit === "mi"), "phone: unit shared with Measure");
  await p.click(".leaflet-bottom .o3s"); await p.click(".leaflet-bottom .o3s");
  // clear of the grid strip
  const clear = await p.evaluate(() => { const s = document.querySelector(".leaflet-bottom .o3s").getBoundingClientRect(), b = document.getElementById("atk-bar"); if (!b) return true; const r = b.getBoundingClientRect(); return s.bottom <= r.top + 0.5; });
  ok(clear, "phone: scale bar sits above the grid strip");
  ok(await shown(p, "#atk-tools [data-o3d]"), "phone: 3D button in the map toolbar");
  ok(!(await shown(p, ".o3dctl")), "phone: classic 3D button hidden in toolbar mode");
  if (OUT) await p.screenshot({ path: OUT + "/phone-2d.png" });
  await run3d("phone", p, errors, libs, "#atk-tools [data-o3d]");
  await ctx.close();
}
// ---------- desktop, classic controls ----------
{
  const { ctx, p, errors, libs } = await open({ viewport: { width: 1400, height: 900 } }, true);
  ok(await shown(p, ".o3dctl a"), "desktop classic: 3D button on the map");
  await run3d("desktop", p, errors, libs, ".o3dctl a");
  await ctx.close();
}
// ---------- a busy imagery host: every picture is refused once (429), and there are no close-ups past zoom 9 (404) ----------
{
  const png = await readFile(join(root, "assets/icons/icon-192.png"));
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1000, height: 700 } });
  const seen = new Set(); let busy = 0, missing = 0;
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url(), m = /World_Imagery\/MapServer\/tile\/(\d+)\//.exec(u);
    if (/elevation-tiles|terrarium/.test(u)) return r.fulfill({ status: 200, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "image/png" }, body: png });
    if (!m) return r.abort();
    if (!seen.has(u)) { seen.add(u); busy++; return r.fulfill({ status: 429, headers: { "Access-Control-Allow-Origin": "*" }, body: "" }); }
    if (+m[1] > 9) { missing++; return r.fulfill({ status: 404, headers: { "Access-Control-Allow-Origin": "*" }, body: "" }); }
    return r.fulfill({ status: 200, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "image/png" }, body: png });
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("asap-map-layers", JSON.stringify({ base: "sat" })); localStorage.setItem("osap-mapsets-th", "[]"); } catch (e) {} });
  const p = await ctx.newPage(), errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base, { waitUntil: "domcontentloaded" }); await p.waitForFunction(() => window.TSAP && window.OSAP_3D, null, { timeout: 60000 }); await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); window.__asapMap.setView([18.79, 98.98], 12, { animate: false }); });
  await p.waitForTimeout(500);
  await p.evaluate(() => { window.__t = { ok: 0, err: 0 }; window.OSAP_3D.open(); });
  await p.waitForFunction(() => window.OSAP_3D.gl, null, { timeout: 30000 });
  await p.evaluate(() => { const gl = window.OSAP_3D.gl; gl.on("data", (e) => { if (e.sourceId === "r0" && e.tile && e.dataType === "source") window.__t.ok++; }); gl.on("error", (e) => { if (e.sourceId === "r0") { window.__t.err++; window.__t.msg = String(e.error && e.error.message); } }); });
  await p.waitForFunction(() => { const gl = window.OSAP_3D.gl; return gl.loaded() && gl.areTilesLoaded() && !gl.isMoving(); }, null, { timeout: 40000 }).catch(() => {});
  await p.waitForTimeout(800);
  const r = await p.evaluate(() => ({ t: window.__t, bar: document.querySelector("#o3d .o3-load").hidden, text: document.querySelector("#o3d .o3-load").textContent }));
  ok(busy > 0 && missing > 0, "busy host: pictures were refused once (" + busy + ") and close-ups were missing (" + missing + ")");
  ok(r.t.ok > 0 && r.t.err === 0, "busy host: every 3D picture still loaded, asked again or from a wider picture " + JSON.stringify(r.t));
  ok(r.bar, "busy host: no error bar in 3D " + JSON.stringify(r.text));
  ok(errors.length === 0, "busy host: no page errors " + JSON.stringify(errors.slice(0, 3)));
  if (OUT) await p.screenshot({ path: OUT + "/busy-3d.png" });
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
