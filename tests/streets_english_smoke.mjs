// Headless check of the English Streets base map (VectorBase in index.html): labels come out in English or Latin letters,
// the drawn map stays lined up with the 2D map after pans and zooms, switching away leaves nothing behind, 3D gets plain
// tiles of the same map, and with OpenFreeMap unreachable the plain OpenStreetMap tiles stand in.
// Needs internet access to tiles.openfreemap.org. Run from the repo root: node tests/streets_english_smoke.mjs
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const init = () => { try { localStorage.setItem("osap-home", JSON.stringify("map")); sessionStorage.setItem("osap-today", "0"); localStorage.setItem("asap-map-layers", JSON.stringify({ base: "streets" })); } catch (e) {} };

const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1200, height: 800 } });
await ctx.addInitScript(init);
const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(2500);
await p.waitForFunction(() => window.__asapMap && window.OSAP_BASEMAP, null, { timeout: 60000 });
await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
await p.evaluate(() => window.__asapMap.setView([13.75, 100.5], 12, { animate: false }));
const vb = () => Object.values(window.__asapMap._layers).find((l) => l.rasterTwin);
await p.waitForFunction(() => { const l = Object.values(window.__asapMap._layers).find((x) => x.rasterTwin); return l && (l._gl || l._fb); }, null, { timeout: 30000 }).catch(() => {});
const idle = () => p.evaluate((src) => new Promise((r) => { const l = eval("(" + src + ")")(); if (!l || !l._gl) return r(false);
  const g = l._gl; if (g.loaded() && g.areTilesLoaded()) return r(true); g.once("idle", () => r(true)); setTimeout(() => r(false), 25000); }), vb.toString());
ok(await idle(), "Streets: the English map engine started and drew Bangkok");
const lab = await p.evaluate((src) => { const l = eval("(" + src + ")")(); if (!l || !l._gl) return null;
  const g = l._gl, f = g.queryRenderedFeatures().filter((x) => x.layer.type === "symbol" && x.properties && x.properties.name);
  const shown = f.map((x) => x.properties["name:en"] || x.properties["name:latin"] || x.properties.name_en || x.properties.name);
  const fields = g.getStyle().layers.filter((x) => x.layout && x.layout["text-field"] && /name/.test(JSON.stringify(x.layout["text-field"])));
  return { n: shown.length, thai: shown.filter((s) => /[฀-๿]/.test(s)).length, sample: [...new Set(shown)].slice(0, 10),
    en: fields.every((x) => JSON.stringify(x.layout["text-field"]).indexOf('"name:en"') > 0), nf: fields.length }; }, vb.toString());
console.log("labels:", JSON.stringify(lab));
ok(lab && lab.n >= 10 && lab.thai <= lab.n * 0.1, "Bangkok labels are in English or Latin letters (Thai script on at most 1 in 10)");
ok(lab && lab.nf > 5 && lab.en, "every name label in the style asks for the English name first");
if (process.env.PROBE_OUT) { await mkdir("probe-out", { recursive: true }); await p.screenshot({ path: "probe-out/streets-bkk.png" }); }
// lined up: a place sits at the same screen spot on both maps
const aligned = () => p.evaluate((src) => { const l = eval("(" + src + ")")(); if (!l || !l._gl) return 999; const m = window.__asapMap, ll = m.getCenter(), pt = L.latLng(ll.lat + 0.01, ll.lng + 0.02);
  const a = m.latLngToContainerPoint(pt), mr = m.getContainer().getBoundingClientRect(), br = l._box.getBoundingClientRect(), b = l._gl.project([pt.lng, pt.lat]);
  return Math.hypot(br.left + b.x - (mr.left + a.x), br.top + b.y - (mr.top + a.y)); }, vb.toString());
let d = await aligned(); ok(d < 2, "lined up at the start (" + d.toFixed(2) + " px)");
await p.evaluate(() => window.__asapMap.panBy([180, -120], { animate: false })); await p.waitForTimeout(300);
d = await aligned(); ok(d < 2, "lined up after a pan (" + d.toFixed(2) + " px)");
await p.evaluate(() => window.__asapMap.zoomIn(1)); await p.waitForTimeout(1200);
d = await aligned(); ok(d < 2, "lined up after an animated zoom (" + d.toFixed(2) + " px)");
await p.evaluate(() => window.__asapMap.setZoom(8.5, { animate: false })); await p.waitForTimeout(400);
d = await aligned(); ok(d < 2, "lined up at a part zoom (" + d.toFixed(2) + " px)");
await p.setViewportSize({ width: 900, height: 700 }); await p.waitForTimeout(800);
d = await aligned(); ok(d < 2, "lined up after the window is resized (" + d.toFixed(2) + " px)");
const twin = await p.evaluate((src) => { const l = eval("(" + src + ")")(); return l.rasterTwin(); }, vb.toString());
ok(twin && /tile\.openstreetmap\.org/.test(twin.url), "3D is given the plain OpenStreetMap tiles of the same map");
await p.evaluate(() => window.OSAP_BASEMAP.set("grey")); await p.waitForTimeout(300);
ok(await p.evaluate(() => !document.querySelector(".osap-vbase") && !Object.values(window.__asapMap._layers).some((l) => l.rasterTwin)), "switching to Grey removes the English map");
await p.evaluate(() => window.OSAP_BASEMAP.set("streets")); await p.waitForTimeout(300);
ok(await p.evaluate(() => document.querySelectorAll(".osap-vbase").length === 1), "switching back draws it once");
ok(errors.length === 0, "no page errors " + JSON.stringify(errors.slice(0, 3)));
await ctx.close();

// OpenFreeMap unreachable: the plain OpenStreetMap tiles stand in, so the map is never blank
{
  const c2 = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1200, height: 800 } });
  let osm = 0;
  await c2.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { const u = r.request().url();
    if (/tile\.openstreetmap\.org/.test(u)) { osm++; return r.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==", "base64") }); }
    return r.abort(); });
  await c2.addInitScript(init);
  const q = await c2.newPage(); const e2 = []; q.on("pageerror", (e) => e2.push(e.message));
  await q.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await q.waitForTimeout(2500);
  await q.waitForFunction(() => window.__asapMap && window.OSAP_BASEMAP, null, { timeout: 60000 });
  await q.evaluate(() => window.__asapMap.setView([13.75, 100.5], 10, { animate: false }));
  await q.waitForTimeout(3000);
  ok(osm > 0, "OpenFreeMap unreachable: OpenStreetMap tiles stand in (" + osm + " tiles)");
  ok(e2.length === 0, "no page errors when OpenFreeMap is unreachable " + JSON.stringify(e2.slice(0, 3)));
  await c2.close();
}
await browser.close(); server.close();
if (fails) { console.log(fails + " check(s) failed"); process.exit(1); }
console.log("English Streets map: all checks passed");
