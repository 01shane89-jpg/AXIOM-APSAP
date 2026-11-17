// Headless check that choosing an item centers the map on it (Shane 2026-11-08: "when i click on an item it doesnt center the map
// on that item"). Before: a click on a report's map point opened the report but left the map where it was; pop-up items only nudged
// into view. Checks: on a desktop, a real mouse click on a report point off to the side brings it to the middle of the map (zoom
// kept); on a phone, a tap brings it to the middle of the map above the bottom sheet; a pop-up opened by code (a list row, a tool)
// does not move the map, and neither does a click while a map tool waits for a tap (crosshair cursor). External hosts are blocked. Run from the repo root: node tests/center_click_smoke.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium, webkit } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = process.env.BROWSER === "webkit" ? await webkit.launch() : await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
async function open(phone) {
  const ctx = await browser.newContext(phone ? { serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }
    : { serviceWorkers: "block", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  /* the report data sets drawn on the map (a first open shows none) */
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-mapsets-th", JSON.stringify(["insurgency", "crime", "scam", "safety", "transport", "infra", "protest", "politics", "health", "migration", "weather"])); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#th/timeline", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => document.querySelectorAll("#tl-list .tlrow").length > 0 && typeof window.OSAP_CENTER_ON === "function", null, { timeout: 90000 });
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.hide(); });
  await p.waitForTimeout(1500);
  return { ctx, p, errors };
}
/* a report point that is on screen, away from the middle, with no other point within 30 px; zoomed in step by step until one is (so the click lands on it alone) */
const pick = (target) => {
  const mr = __asapMap.getContainer().getBoundingClientRect(), pts = [];
  __asapMap.eachLayer((l) => { if (l.options && l.options.pane === "tlpane" && l.getLatLng && l.listens && l.listens("click")) pts.push([l, __asapMap.latLngToContainerPoint(l.getLatLng())]); });
  const free = pts.filter(([l, c]) => c.x > 60 && c.x < mr.width - 60 && c.y > 60 && c.y < target - 40 &&
    Math.hypot(c.x - mr.width / 2, c.y - target / 2) > 120 && !pts.some(([o, d]) => o !== l && Math.hypot(d.x - c.x, d.y - c.y) < 30));
  if (!free.length) return null;
  const [l, c] = free[0]; window.__cc = l;
  return { x: c.x + mr.left, y: c.y + mr.top, mid: [mr.width / 2, target / 2], zoom: __asapMap.getZoom() };
};
const where = () => { const c = __asapMap.latLngToContainerPoint(window.__cc.getLatLng()); return { x: c.x, y: c.y, zoom: __asapMap.getZoom() }; };

{ /* desktop: mouse click */
  const { ctx, p, errors } = await open(false);
  const h = await p.evaluate(() => __asapMap.getContainer().getBoundingClientRect().height);
  let s = null; for (let k = 0; k < 4 && !(s = await p.evaluate(pick, h)); k++) { await p.evaluate(() => { __asapMap.setZoom(__asapMap.getZoom() + 1, { animate: false }); }); await p.waitForTimeout(800); }
  ok(!!s, "desktop: found a report point off to the side to click");
  if (s) {
    await p.mouse.click(s.x, s.y); await p.waitForTimeout(1500);
    const w = await p.evaluate(where);
    ok(Math.abs(w.x - s.mid[0]) < 6 && Math.abs(w.y - s.mid[1]) < 6, `desktop: the clicked point is now in the middle of the map (${Math.round(w.x)},${Math.round(w.y)} vs ${s.mid})`);
    ok(w.zoom === s.zoom, `desktop: the zoom stayed ${s.zoom} (now ${w.zoom})`);
    ok(await p.evaluate(() => !document.getElementById("tl-pkg").hidden), "desktop: the report opened too");
    /* a pop-up a tool opens itself (a list row, a script) is placed by that tool: the map does not move */
    const c0 = await p.evaluate(() => { const c = __asapMap.getCenter(), sz = __asapMap.getSize(), ll = __asapMap.containerPointToLatLng([sz.x / 2 + 150, sz.y / 2 + 60]);
      window.__tmp = L.circleMarker(ll, { radius: 8 }).addTo(__asapMap).bindPopup("tool note", { autoPan: false }); window.__tmp.openPopup(); return [c.lat, c.lng]; });
    await p.waitForTimeout(900);
    const c1 = await p.evaluate(() => { const c = __asapMap.getCenter(); __asapMap.closePopup(); return [c.lat, c.lng]; });
    ok(Math.abs(c1[0] - c0[0]) < 0.02 && Math.abs(c1[1] - c0[1]) < 0.02, "desktop: a pop-up opened by code, not a tap on the map, does not move the map");
    /* a map tool waiting for a tap (crosshair): a real click on an item does not move the map */
    const q = await p.evaluate(() => { const mr = __asapMap.getContainer().getBoundingClientRect(), pt = __asapMap.latLngToContainerPoint(window.__tmp.getLatLng()); __asapMap.getContainer().style.cursor = "crosshair"; const c = __asapMap.getCenter(); return { x: pt.x + mr.left, y: pt.y + mr.top, c: [c.lat, c.lng] }; });
    await p.mouse.click(q.x, q.y); await p.waitForTimeout(900);
    const c2 = await p.evaluate(() => { const c = __asapMap.getCenter(), open = !!document.querySelector(".leaflet-popup"); __asapMap.removeLayer(window.__tmp); __asapMap.getContainer().style.cursor = ""; return { c: [c.lat, c.lng], open }; });
    ok(Math.abs(c2.c[0] - q.c[0]) < 0.02 && Math.abs(c2.c[1] - q.c[1]) < 0.02, "desktop: with a map tool armed (crosshair), clicking an item does not move the map");
  }
  ok(!errors.length, "desktop: no page errors" + (errors.length ? ": " + errors[0] : ""));
  await ctx.close();
}
{ /* phone: tap, centered above the bottom sheet */
  const { ctx, p, errors } = await open(true);
  const t = await p.evaluate(() => { const mr = __asapMap.getContainer().getBoundingClientRect(), rr = document.querySelector(".rail").getBoundingClientRect(); return Math.min(mr.bottom, rr.top) - mr.top; });
  let s = null; for (let k = 0; k < 4 && !(s = await p.evaluate(pick, t)); k++) { await p.evaluate(() => { __asapMap.setZoom(__asapMap.getZoom() + 1, { animate: false }); }); await p.waitForTimeout(800); }
  ok(!!s, "phone: found a report point off to the side to tap");
  if (s) {
    await p.touchscreen.tap(s.x, s.y); await p.waitForTimeout(1600);
    const w = await p.evaluate(where);
    const t2 = await p.evaluate(() => { const mr = __asapMap.getContainer().getBoundingClientRect(), rr = document.querySelector(".rail").getBoundingClientRect(); return (Math.min(mr.bottom, rr.top) - mr.top) / 2; });
    ok(Math.abs(w.x - s.mid[0]) < 6 && Math.abs(w.y - t2) < 6, `phone: the tapped point is in the middle of the map above the sheet (${Math.round(w.x)},${Math.round(w.y)} vs ${s.mid[0]},${t2})`);
  }
  ok(!errors.length, "phone: no page errors" + (errors.length ? ": " + errors[0] : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
