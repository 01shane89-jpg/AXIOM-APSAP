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
  // "while the app starts": the app waits 5 s after the page's load event before it fetches the engine in idle time
  // (osap-3d.js preload). Count only engine requests that began before that, so a slow start on a busy runner, where the
  // idle fetch can land inside the fixed waits above, is not taken for an early download.
  const early = await p.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0], t = nav && nav.loadEventEnd ? nav.loadEventEnd + 4900 : Infinity;
    return performance.getEntriesByType("resource").filter((e) => /maplibre-gl/.test(e.name) && e.startTime < t).length;
  });
  return { ctx, p, errors, libs, early };
}
async function run3d(name, p, errors, libs, openSel, early) {
  ok(early === 0, name + ": 3D engine not downloaded while the app starts (it is fetched later, when idle)");
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
  const { ctx, p, errors, libs, early } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  ok(await shown(p, ".leaflet-bottom .o3s .o3s-b"), "phone: scale bar shown on the 2D map");
  const t1 = await p.textContent(".leaflet-bottom .o3s .o3s-t");
  ok(/km|\bm\b/.test(t1), "phone: scale bar in km by default: " + t1);
  await p.click(".leaflet-bottom .o3s"); const t2 = await p.textContent(".leaflet-bottom .o3s .o3s-t");
  ok(/mi|ft/.test(t2), "phone: tap switches the scale bar to miles: " + t2);
  ok(await p.evaluate(() => JSON.parse(localStorage.getItem("osap-meas-unit")).unit === "mi"), "phone: unit shared with Measure");
  await p.click(".leaflet-bottom .o3s"); await p.click(".leaflet-bottom .o3s");
  // every label inside the box and clear of its neighbour, at every zoom and in km, mi and nm
  const spill = [];
  for (let u = 0; u < 3; u++) {
    for (let z = 5; z <= 18; z++) {
      await p.evaluate((z) => { window.__asapMap.setView([13.7, 100.5], z, { animate: false }); }, z); await p.waitForTimeout(60);
      const r = await p.evaluate(() => { const box = document.querySelector(".leaflet-bottom .o3s").getBoundingClientRect(); const sp = [...document.querySelectorAll(".leaflet-bottom .o3s .o3s-t span")].map((e) => e.getBoundingClientRect());
        const txt = document.querySelector(".leaflet-bottom .o3s .o3s-t").textContent, last = document.querySelector(".leaflet-bottom .o3s .o3s-t span:last-child b").getBoundingClientRect();
        const bad = sp.some((b) => b.left < box.left - 0.5 || b.right > box.right + 0.5) || last.right > box.right + 0.5 || sp.some((b, i) => i && b.left < sp[i - 1].right + 2) || (sp.length && last.left < sp[sp.length - 1].right - 0.5);
        return bad ? txt + " box " + Math.round(box.left) + "-" + Math.round(box.right) + " labels " + sp.map((b) => Math.round(b.left) + "-" + Math.round(b.right)).join(",") + " unit " + Math.round(last.left) + "-" + Math.round(last.right) : ""; });
      if (r) spill.push("z" + z + ": " + r);
    }
    await p.click(".leaflet-bottom .o3s");
  }
  ok(spill.length === 0, "phone: scale labels stay inside the box and apart at every zoom, in km, mi and nm " + JSON.stringify(spill.slice(0, 3)));
  // clear of the grid strip
  const clear = await p.evaluate(() => { const s = document.querySelector(".leaflet-bottom .o3s").getBoundingClientRect(), b = document.getElementById("atk-bar"); if (!b) return true; const r = b.getBoundingClientRect(); return s.bottom <= r.top + 0.5; });
  ok(clear, "phone: scale bar sits above the grid strip");
  ok(await shown(p, "#atk-tools [data-o3d]"), "phone: 3D button in the map toolbar");
  ok(!(await shown(p, ".o3dctl")), "phone: classic 3D button hidden in toolbar mode");
  if (OUT) await p.screenshot({ path: OUT + "/phone-2d.png" });
  await run3d("phone", p, errors, libs, "#atk-tools [data-o3d]", early);
  await ctx.close();
}
// ---------- desktop, classic controls ----------
{
  const { ctx, p, errors, libs, early } = await open({ viewport: { width: 1400, height: 900 } }, true);
  ok(await shown(p, ".o3dctl a"), "desktop classic: 3D button on the map");
  await run3d("desktop", p, errors, libs, ".o3dctl a", early);
  await ctx.close();
}
// ---------- the regular toolbar over the 3D view: panels open over it, what they switch on shows in 3D, the two views
// follow each other, and the tools that need taps on the map go back to 2D at the same place ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await p.evaluate(() => { window.__asapMap.setView([18.79, 98.98], 10, { animate: false }); });
  await p.click("#atk-tools [data-o3d]");
  await p.waitForFunction(() => window.OSAP_3D.gl && window.OSAP_3D.gl.isStyleLoaded(), null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(1500);
  const top = await p.evaluate(() => {
    const at = (s) => { const r = document.querySelector(s).getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!e && !!e.closest(s); };
    const a = document.querySelector("#o3d .o3-side").getBoundingClientRect(), b = document.querySelector("#atk-tools").getBoundingClientRect();
    const t = document.querySelector("#o3d .o3-tilt").getBoundingClientRect(), s = document.querySelector("#atk-bar").getBoundingClientRect();
    return { tools: at('#atk-tools [data-atk="datasets"]'), bar: at("#atk-bar .atk-pos"), apart: a.right <= b.left || a.left >= b.right, tilt: t.bottom <= s.top + 0.5 };
  });
  if (OUT) await p.screenshot({ path: OUT + "/phone-3d-bar.png" });
  ok(top.tools && top.bar, "3D tools: the map toolbar and the grid strip stay on top of the 3D view " + JSON.stringify(top));
  ok(top.apart && top.tilt, "3D tools: the 3D buttons and tilt slider sit clear of the toolbar and strip " + JSON.stringify(top));
  // something switched on in 2D appears in 3D
  await p.evaluate(() => { window.__tp = L.circleMarker([18.83, 99.02], { radius: 7, color: "#f00" }).addTo(window.__asapMap); });
  const got = await p.waitForFunction(() => (window.OSAP_3D.gl.getSource("vp").serialize().data.features || []).some((f) => Math.abs(f.geometry.coordinates[0] - 99.02) < 1e-6 && Math.abs(f.geometry.coordinates[1] - 18.83) < 1e-6), null, { timeout: 5000 }).then(() => true).catch(() => false);
  ok(got, "3D tools: a layer added on the map shows in 3D without reopening it");
  await p.evaluate(() => { window.__tp.remove(); });
  const gone = await p.waitForFunction(() => !(window.OSAP_3D.gl.getSource("vp").serialize().data.features || []).some((f) => Math.abs(f.geometry.coordinates[0] - 99.02) < 1e-6), null, { timeout: 5000 }).then(() => true).catch(() => false);
  ok(gone, "3D tools: and goes when it is switched off");
  // going to a place (Search, Today) moves the 3D camera; moving in 3D moves the flat map under it
  await p.evaluate(() => { window.__asapMap.setView([13.75, 100.5], 12, { animate: false }); });
  await p.waitForFunction(() => { const g = window.OSAP_3D.gl, c = g.getCenter(); return !g.isMoving() && Math.abs(c.lat - 13.75) < 0.01 && Math.abs(c.lng - 100.5) < 0.01; }, null, { timeout: 8000 }).catch(() => {});
  const fly = await p.evaluate(() => { const g = window.OSAP_3D.gl, c = g.getCenter(); return { lat: c.lat, lng: c.lng, z: g.getZoom() }; });
  ok(Math.abs(fly.lat - 13.75) < 0.01 && Math.abs(fly.lng - 100.5) < 0.01 && Math.abs(fly.z - 11) < 0.05, "3D tools: going to a place on the map moves the 3D view there " + JSON.stringify(fly));
  await p.evaluate(() => { window.OSAP_3D.gl.jumpTo({ center: [100.62, 13.81], zoom: 13.4 }); }); await p.waitForTimeout(300);
  const fl = await p.evaluate(() => { const m = window.__asapMap, c = m.getCenter(); return { lat: c.lat, lng: c.lng, z: m.getZoom(), want: Math.min(14, m.getMaxZoom()), grid: document.querySelector("#atk-bar .atk-v").textContent, still: window.OSAP_3D.gl.getCenter().lng }; });
  ok(Math.abs(fl.lat - 13.81) < 0.001 && Math.abs(fl.lng - 100.62) < 0.001 && fl.z === fl.want && Math.abs(fl.still - 100.62) < 1e-6, "3D tools: the flat map follows the 3D view, so Centre, Search and Med plan use it " + JSON.stringify(fl));
  // a panel from the toolbar opens over 3D
  await p.click('#atk-tools [data-atk="datasets"]'); await p.waitForTimeout(400);
  if (OUT) await p.screenshot({ path: OUT + "/phone-3d-panel.png" });
  const om = await p.evaluate(() => { const o = document.getElementById("atk-om"); if (!o || o.hidden) return false; const r = o.getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.top + 60); return !!e && !!e.closest("#atk-om") && !!document.getElementById("o3d"); });
  ok(om, "3D tools: Data sets opens over the 3D view, which stays open");
  await p.click('#atk-tools [data-atk="datasets"]'); await p.waitForTimeout(200);
  // Measure needs taps on the map: back to 2D at the same place, and it says why
  await p.click('#atk-tools [data-atk="measure"]'); await p.waitForTimeout(400);
  const ms = await p.evaluate(() => ({ open: !!document.getElementById("o3d"), toast: (document.getElementById("atk-toast") || {}).textContent || "", c: window.__asapMap.getCenter() }));
  ok(!ms.open && /flat map/.test(ms.toast) && Math.abs(ms.c.lng - 100.62) < 0.01, "3D tools: Measure goes back to 2D at the same place and says why " + JSON.stringify(ms));
  ok(await p.evaluate(() => !document.documentElement.classList.contains("o3d-on") && getComputedStyle(document.querySelector("#map .leaflet-control-container")).display !== "none"), "3D tools: the flat map's own controls are back in 2D");
  ok(errors.length === 0, "3D tools: no page errors " + JSON.stringify(errors.slice(0, 3)));
  if (OUT) await p.screenshot({ path: OUT + "/phone-3d-tools.png" });
  await ctx.close();
}
// ---------- 3D buildings switch: on by default, tiles only when zoomed in close, off and on again, remembered ----------
// The buildings come from an Overture PMTiles archive on S3. The test serves a tiny real archive: one empty "building" tile that
// answers for every zoom-14 address, so each tile the map wants shows up as a byte-range request past the archive's directory.
function pmFixture() {
  const vw = (n) => { const o = []; while (n >= 128) { o.push((n % 128) | 128); n = Math.floor(n / 128); } o.push(n); return o; };
  /* one "building" layer holding one square building in the middle of the tile, with a name, use, floors and its source */
  const fld = (n, w, b) => [...vw(n * 8 + w), ...(w === 2 ? [...vw(b.length), ...b] : b)];
  const str = (t) => [...Buffer.from(t)], zz = (n) => (n << 1) ^ (n >> 31);
  const keys = ["@name", "class", "num_floors", "@geometry_source", "sources", "id"];
  const vals = [fld(1, 2, str("Test <b>Hall</b>")), fld(1, 2, str("school")), fld(5, 0, vw(3)), fld(1, 2, str("OpenStreetMap")),
    fld(1, 2, str(JSON.stringify([{ dataset: "OpenStreetMap", record_id: "w123@2", update_time: "2025-01-07T11:53:37.000Z" }]))), fld(1, 2, str("abc-1"))];
  const geom = [9, zz(1024), zz(1024), 26, zz(2048), 0, 0, zz(2048), zz(-2048), 0, 15];
  const feat = [...fld(1, 0, vw(1)), ...fld(2, 2, [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]), ...fld(3, 0, vw(3)), ...fld(4, 2, geom.flatMap(vw))];
  const layer = [...fld(15, 0, vw(2)), ...fld(1, 2, str("building")), ...fld(2, 2, feat), ...keys.flatMap((k) => fld(3, 2, str(k))), ...vals.flatMap((v) => fld(4, 2, v)), ...fld(5, 0, vw(4096))];
  const tile = Buffer.from(fld(3, 2, layer));
  const z14 = (Math.pow(4, 14) - 1) / 3, dir = Buffer.from([...vw(1), ...vw(z14), ...vw(Math.pow(4, 14)), ...vw(tile.length), ...vw(1)]);
  const meta = Buffer.from(JSON.stringify({ vector_layers: [{ id: "building", fields: {}, minzoom: 14, maxzoom: 14 }, { id: "building_part", fields: {}, minzoom: 14, maxzoom: 14 }] }));
  const h = Buffer.alloc(127); h.write("PMTiles", 0); h[7] = 3;
  const at = [127, dir.length, 127 + dir.length, meta.length, 0, 0, 127 + dir.length + meta.length, tile.length, Math.pow(4, 14), 1, 1];
  at.forEach((v, i) => h.writeBigUInt64LE(BigInt(v), 8 + i * 8));
  h[96] = 1; h[97] = 1; h[98] = 1; h[99] = 1; h[100] = 14; h[101] = 14;
  [-1800000000, -850000000, 1800000000, 850000000].forEach((v, i) => h.writeInt32LE(v, 102 + i * 4));
  h[118] = 14;
  return { buf: Buffer.concat([h, dir, meta, tile]), tileAt: 127 + dir.length + meta.length };
}
{
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1000, height: 700 } });
  const asked = [], archives = [], pm = pmFixture(), CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "ETag, Content-Length, Content-Range" };
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    if (/overturemaps-extras-us-west-2\.s3\.us-west-2\.amazonaws\.com\/\?list-type=2/.test(u))
      return r.fulfill({ status: 200, headers: { ...CORS, "Content-Type": "application/xml" }, body: "<ListBucketResult><CommonPrefixes><Prefix>tiles/2026-08-19.0/</Prefix></CommonPrefixes><CommonPrefixes><Prefix>tiles/2026-10-21.0/</Prefix></CommonPrefixes><CommonPrefixes><Prefix>tiles/2026-10-21.1/</Prefix></CommonPrefixes></ListBucketResult>" });
    if (/overturemaps-extras-us-west-2\.s3\.us-west-2\.amazonaws\.com\/tiles\/.*\/buildings\.pmtiles$/.test(u)) {
      archives.push(u.split("/tiles/")[1]);
      const m = /bytes=(\d+)-(\d+)/.exec(r.request().headers()["range"] || ""), from = m ? +m[1] : 0, to = Math.min(m ? +m[2] : pm.buf.length - 1, pm.buf.length - 1);
      if (from >= pm.tileAt) asked.push(from);
      return r.fulfill({ status: 206, headers: { ...CORS, "Content-Type": "application/octet-stream", ETag: '"t1"', "Content-Range": `bytes ${from}-${to}/${pm.buf.length}` }, body: pm.buf.subarray(from, to + 1) });
    }
    return r.abort();
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("osap-mapsets-th", "[]"); } catch (e) {} });
  const p = await ctx.newPage(), errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base, { waitUntil: "domcontentloaded" }); await p.waitForFunction(() => window.TSAP && window.OSAP_3D, null, { timeout: 60000 }); await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); window.__asapMap.setView([13.726, 100.531], 11, { animate: false });
    /* a saved point, as the map's own mark tool keeps them */
    const m = window.__asapMap; if (!m.getPane("atakpane")) m.createPane("atakpane");
    window.L.marker([13.726, 100.531], { pane: "atakpane", title: "AOB 1120" }).addTo(m); });
  await p.evaluate(() => window.OSAP_3D.open());
  await p.waitForFunction(() => window.OSAP_3D.gl && window.OSAP_3D.gl.getLayer("bld") && window.OSAP_3D.gl.getLayer("bldp"), null, { timeout: 30000 }).catch(() => {});
  const b1 = await p.evaluate(() => { const gl = window.OSAP_3D.gl, L = gl.getLayer("bld"), P = gl.getLayer("bldp"); return { layer: !!L, parts: !!P, type: L && L.type, min: L && L.minzoom, vis: L && gl.getLayoutProperty("bld", "visibility"), op: L && gl.getPaintProperty("bld", "fill-extrusion-opacity"), pressed: document.querySelector("#o3d .o3-bld").getAttribute("aria-pressed") }; });
  ok(b1.layer && b1.parts && b1.type === "fill-extrusion" && b1.min === 14 && b1.op === 1 && b1.pressed === "true", "buildings: on by default, solid, buildings and building parts from zoom 14 " + JSON.stringify(b1));
  // the saved point stays at full strength even when the engine decides the ground or a building is in front of it
  const mk = await p.evaluate(() => { const gl = window.OSAP_3D.gl, el = document.querySelector("#o3d .o3-mark"); if (!el || !gl.terrain) return { el: !!el, terrain: !!gl.terrain };
    gl.terrain.depthAtPoint = () => -1;   /* everything is "in front" */
    (window.OSAP_3D._markers || []).forEach((k) => k._updateOpacity(true));
    return { n: (window.OSAP_3D._markers || []).length, el: true, terrain: true, label: el.textContent, opacity: el.style.opacity, covered: el.closest(".maplibregl-marker").classList.contains("maplibregl-marker-covered") }; });
  ok(mk.n > 0 && mk.el && mk.terrain && mk.covered && mk.opacity === "1" && mk.label === "AOB 1120", "3D: a saved point the engine thinks is hidden still shows at full strength " + JSON.stringify(mk));
  ok(archives.length > 0 && archives.every((a) => a === "2026-10-21.1/buildings.pmtiles"), "buildings: the newest Overture release in the bucket listing is used " + JSON.stringify([...new Set(archives)]));
  const cached = await p.evaluate(() => JSON.parse(localStorage.getItem("osap-3d-ovr") || "null"));
  ok(cached && cached.r === "2026-10-21.1", "buildings: the release is remembered so the listing is not read on every open " + JSON.stringify(cached));
  await p.waitForTimeout(2500);
  ok(asked.length === 0, "buildings: no building tiles downloaded while zoomed out (" + asked.length + ")");
  await p.evaluate(() => window.OSAP_3D.gl.jumpTo({ zoom: 15.5, pitch: 60 })); await p.waitForTimeout(3000);
  ok(asked.length > 0, "buildings: close in, building tiles are asked for (" + asked.length + ")");
  const kinds = await p.evaluate(() => { const e = window.OSAP_3D.gl.getPaintProperty("bld", "fill-extrusion-height"); return JSON.stringify(e).includes("num_floors") && JSON.stringify(e).includes("apartments"); });
  ok(kinds, "buildings: heights come from the recorded height, else floors, else the building's kind");
  // tap a building: what the data records, "not recorded" for the rest, its source, and nothing from the data run as code
  await p.evaluate(() => { const gl = window.OSAP_3D.gl, c = gl.getCenter(), n = Math.pow(2, 14), x = Math.floor((c.lng + 180) / 360 * n), r = c.lat * Math.PI / 180,
    y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n), lon = (x + 0.5) / n * 360 - 180, lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 0.5) / n))) * 180 / Math.PI;
    gl.jumpTo({ center: [lon, lat], zoom: 16, pitch: 0, bearing: 0 }); });
  await p.waitForTimeout(2500);
  const box = await p.locator("#o3d .o3-map canvas").boundingBox();
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await p.waitForTimeout(600);
  const pop = await p.evaluate(() => { const e = document.querySelector("#o3d .o3-popw .o3-pc"); return e ? { html: e.innerHTML, text: e.textContent, bold: !!e.querySelector("h3 b"), link: (e.querySelector("a[href*='openstreetmap.org']") || {}).href } : null; });
  ok(pop && /Test <b>Hall<\/b>/.test(pop.text) && !pop.bold && /School/.test(pop.text) && /Floors\s*3/.test(pop.text) && /Height\s*not recorded/.test(pop.text) && /OpenStreetMap \(drawn by volunteers\)/.test(pop.text) &&
    pop.link === "https://www.openstreetmap.org/way/123" && /Last edited\s*2025-01-07/.test(pop.text) && /not an official survey/.test(pop.text) && /Footprint\s*about 1,411,\d{3} m²/.test(pop.text),
    "buildings: tapping one shows its recorded details and source, and 'not recorded' for the rest " + JSON.stringify(pop && pop.text.slice(0, 400)));
  const g = await p.evaluate(() => window.OSAP_3D._bldInfo({ "@geometry_source": "Google Open Buildings", sources: JSON.stringify([{ dataset: "Google Open Buildings", confidence: 0.87, update_time: "2023-05-01T00:00:00.000Z" }]) }, null));
  ok(/<h3>Building<\/h3>/.test(g) && /No name recorded/.test(g) && /Use<\/th><td><i class="o3-nr">not recorded/.test(g) && /87% sure/.test(g) && /traced by a computer/.test(g) && !/Footprint/.test(g),
    "buildings: a machine-traced building says so, with the model's confidence, and invents nothing");
  // the compass gives the heading in degrees
  const hd = [];
  for (const b of [0, 45, -90, 179.6, -0.4]) { await p.evaluate((b) => window.OSAP_3D.gl.jumpTo({ bearing: b }), b); await p.waitForTimeout(100); hd.push(await p.evaluate(() => document.querySelector("#o3d .o3-deg").textContent)); }
  ok(JSON.stringify(hd) === JSON.stringify(["000° N", "045° NE", "270° W", "180° S", "000° N"]), "3D compass: heading in degrees as the view turns " + JSON.stringify(hd));
  await p.click("#o3d .o3-bld");
  const b2 = await p.evaluate(() => ({ vis: window.OSAP_3D.gl.getLayoutProperty("bld", "visibility"), vp: window.OSAP_3D.gl.getLayoutProperty("bldp", "visibility"), pressed: document.querySelector("#o3d .o3-bld").getAttribute("aria-pressed"), saved: JSON.parse(localStorage.getItem("osap-3d")).bld }));
  ok(b2.vis === "none" && b2.vp === "none" && b2.pressed === "false" && b2.saved === false, "buildings: the switch turns them off and remembers it " + JSON.stringify(b2));
  await p.evaluate(() => window.OSAP_3D.gl.jumpTo({ zoom: 10 })); await p.click("#o3d .o3-bld");
  const b3 = await p.evaluate(() => ({ vis: window.OSAP_3D.gl.getLayoutProperty("bld", "visibility"), msg: document.querySelector("#o3d .o3-msg").textContent }));
  ok(b3.vis === "visible" && /zoom in/i.test(b3.msg), "buildings: on again while zoomed out says to zoom in " + JSON.stringify(b3));
  ok(errors.length === 0, "buildings: no page errors " + JSON.stringify(errors.slice(0, 3)));
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
  /* after the tilt, once every picture is in, the bar goes away (it never turns into an error) */
  await p.waitForFunction(() => { const gl = window.OSAP_3D.gl; return gl.getPitch() > 55 && gl.loaded() && gl.areTilesLoaded() && !gl.isMoving(); }, null, { timeout: 40000 }).catch(() => {});
  await p.waitForFunction(() => document.querySelector("#o3d .o3-load").hidden || document.querySelector("#o3d .o3-load").classList.contains("err"), null, { timeout: 15000 }).catch(() => {});
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
