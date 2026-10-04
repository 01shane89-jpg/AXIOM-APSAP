// Headless check that the map pans round the globe (index.html, "the map wraps round the globe"): no sideways limit, a pan
// past the dateline carries on and the view steps back to a centre between -180 and 180, and symbols, lines, shapes, circles,
// pictures and pop-ups follow onto the world copy in view: a Samoa symbol seen from Fiji is drawn east of Fiji, a track over
// the dateline is drawn the short way, a world-wide band shows either side of it. A real mouse drag across the Pacific, and the phone.
// Run from the repo root: node tests/wrap_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const OUT = process.env.OUT || "";
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
async function open(opts, hash) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(), errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  let lastNav = Date.now();
  p.on("framenavigated", (f) => { if (f === p.mainFrame()) lastNav = Date.now(); });
  await p.goto(base + hash, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.__asapMap && window.OSAP_WRAP, null, { timeout: 60000 });
  /* a country's first open can load the page once more: wait until it has settled */
  while (Date.now() - lastNav < 5000) await p.waitForTimeout(500);
  await p.waitForLoadState("domcontentloaded");
  await p.waitForFunction(() => window.TSAP && window.__asapMap && window.OSAP_WRAP && window.__asapMap._loaded, null, { timeout: 60000 });
  await p.waitForTimeout(1500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
  return { ctx, p, errors };
}
/* a test layer group: a symbol and a pop-up at Apia (Samoa, -171.8), a track Suva -> Apia, a circle at Tarawa (Kiribati),
   a box over Tonga's dateline side, and a band round the whole world */
const addTest = (p) => p.evaluate(() => {
  const map = window.__asapMap, L = window.L, g = window.__wrapT = L.layerGroup().addTo(map);
  g.dot = L.circleMarker([-13.83, -171.76], { radius: 6 }).addTo(g);
  g.pin = L.marker([-13.83, -171.76]).addTo(g);
  g.track = L.polyline([[-18.14, 178.44], [-16, 179.9], [-14.5, -178], [-13.83, -171.76]]).addTo(g);
  g.circle = L.circle([1.35, 173.0], { radius: 50000 }).addTo(g);
  g.box = L.polygon([[-22, -176], [-15, -176], [-15, -173], [-22, -173]]).addTo(g);
  g.band = L.polygon([[-1, -180], [1, -180], [1, 180], [-1, 180]]).addTo(g);
  g.pic = L.imageOverlay("assets/logo-mark.png", [[-20, -170], [-16, -165]]).addTo(g);
  g.pop = L.popup().setLatLng([-13.83, -171.76]).setContent("Apia");
});
const state = (p) => p.evaluate(() => {
  const map = window.__asapMap, g = window.__wrapT, sz = map.getSize(), c = map.getCenter();
  const cp = (ll) => map.latLngToContainerPoint(ll);
  const inView = (pt) => pt.x >= 0 && pt.x <= sz.x && pt.y >= 0 && pt.y <= sz.y;
  const lp2cp = (pt) => map.layerPointToContainerPoint(pt);
  const ringX = (ring) => ring.map((q) => lp2cp(q).x);
  const pinPos = window.L.DomUtil.getPosition(g.pin._icon), dotPt = lp2cp(g.dot._point);
  const trk = ringX(g.track._rings[0]), boxX = ringX(g.box._rings[0]);
  const band = g.band._rings.map((r) => { const x = ringX(r); return [Math.min(...x), Math.max(...x)]; });
  const im = g.pic._image.getBoundingClientRect(), mr = map.getContainer().getBoundingClientRect();
  return {
    lng: c.lng, size: sz.x,
    dot: dotPt, dotIn: inView(dotPt), pin: lp2cp(pinPos), pinIn: inView(lp2cp(pinPos)),
    trackSpan: Math.max(...trk) - Math.min(...trk), trackRings: g.track._rings.length,
    box: [Math.min(...boxX), Math.max(...boxX)], circle: lp2cp(g.circle._point),
    bandCovers: [1, sz.x / 2, sz.x - 1].every((x) => band.some((b) => b[0] <= x && b[1] >= x)),
    pic: { x: im.left - mr.left, w: im.width },
    pop: g.pop._container ? lp2cp(window.L.DomUtil.getPosition(g.pop._container)) : null,
    fiji: cp([-18.14, 178.44]),
  };
});

// ---------- desktop ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1400, height: 900 } }, "#fj/timeline");
  ok(await p.evaluate(() => !window.__asapMap.options.maxBounds), "no sideways pan limit on the map");
  await addTest(p);
  // looking from Fiji, just west of the dateline: Samoa (-171.8) is east of Fiji, on screen
  await p.evaluate(() => { window.__asapMap.setView([-16, 178], 5, { animate: false }); }); await p.waitForTimeout(400);
  let s = await state(p);
  ok(s.dotIn && s.dot.x > s.fiji.x, "from Fiji the Samoa dot is on screen, east of Fiji (x " + Math.round(s.dot.x) + " > " + Math.round(s.fiji.x) + ")");
  ok(s.pinIn && Math.abs(s.pin.x - s.dot.x) < 2, "the Samoa marker sits with the dot");
  ok(s.trackSpan < s.size, "the Suva-Apia track is drawn the short way over the dateline (" + Math.round(s.trackSpan) + " px)");
  ok(s.box[0] > s.fiji.x && s.box[1] - s.box[0] < 400, "the Tonga box is east of Fiji, its true size");
  ok(s.bandCovers, "a band round the whole world covers the screen either side of the dateline");
  ok(s.pic.x > s.fiji.x && s.pic.w > 0 && s.pic.w < 400, "a picture laid over Samoa's east is drawn east of Fiji");
  ok(Math.abs(s.circle.x - s.fiji.x) < 600 && s.circle.y < s.fiji.y, "the Tarawa circle is drawn north of Fiji, not a world away");
  await p.evaluate(() => { window.__wrapT.pop.openOn(window.__asapMap); }); await p.waitForTimeout(300);
  s = await state(p);
  ok(s.pop && Math.abs(s.pop.x - s.dot.x) < 2, "a pop-up at Apia opens over the dot, east of Fiji");
  await p.evaluate(() => { window.__asapMap.closePopup(); });
  if (OUT) await p.screenshot({ path: OUT + "/wrap-fiji.png" });

  // keep panning east: across the dateline, and the centre steps back between -180 and 180
  for (let i = 0; i < 4; i++) { await p.evaluate(() => { window.__asapMap.panBy([100, 0], { animate: false }); }); await p.waitForTimeout(80); }
  s = await state(p);
  ok(s.lng >= -180 && s.lng < -150, "after panning east across the dateline the centre reads " + s.lng.toFixed(1) + " (stepped back between -180 and 180)");
  ok(s.dotIn && s.dot.x > s.fiji.x, "Samoa still on screen, east of Fiji, after the view stepped back a world");
  await p.evaluate(() => { window.__asapMap.setView([-16, 178], 5, { animate: false }); }); await p.waitForTimeout(400);
  // all the way round the world and back to Fiji (east, by 3 worlds): the data is there again
  const W = await p.evaluate(() => window.__asapMap.options.crs.scale(window.__asapMap.getZoom()));
  for (let i = 0; i < 12; i++) { await p.evaluate((d) => { window.__asapMap.panBy([d, 0], { animate: false }); }, W / 4); await p.waitForTimeout(60); }
  s = await state(p);
  ok(s.lng >= -180 && s.lng <= 180 && s.dotIn, "three times round the world eastward: centre " + s.lng.toFixed(1) + ", Samoa on screen");
  for (let i = 0; i < 12; i++) { await p.evaluate((d) => { window.__asapMap.panBy([-d, 0], { animate: false }); }, W / 4); await p.waitForTimeout(60); }
  s = await state(p);
  ok(s.lng >= -180 && s.lng <= 180 && s.dotIn, "three times round westward: centre " + s.lng.toFixed(1) + ", Samoa on screen");

  // a real mouse drag westward from Fiji (pans the view east) across the dateline, released past it
  await p.evaluate(() => { window.__asapMap.setView([-16, 176], 5, { animate: false }); }); await p.waitForTimeout(400);
  const box = await p.evaluate(() => { const r = window.__asapMap.getContainer().getBoundingClientRect(), x = r.left + r.width * 0.15, y = r.top + r.height * 0.55; return { x, y }; });
  await p.mouse.move(box.x + 400, box.y); await p.mouse.down();
  for (let i = 1; i <= 20; i++) { await p.mouse.move(box.x + 400 - i * 20, box.y); await p.waitForTimeout(16); }
  await p.waitForTimeout(150); await p.mouse.up(); await p.waitForTimeout(1500);
  s = await state(p);
  ok(s.lng >= -180 && s.lng < -150, "a mouse drag over the dateline carries on and ends with the centre at " + s.lng.toFixed(1));
  ok(s.dotIn && s.pinIn, "after the drag the Samoa dot and marker are on screen");
  // zoom in and out over the dateline: still on the copy in view
  await p.evaluate(() => { window.__asapMap.setView([-15, 179.5], 7); }); await p.waitForTimeout(900);
  await p.evaluate(() => { window.__asapMap.setZoom(4); }); await p.waitForTimeout(900);
  s = await state(p);
  ok(s.dotIn && s.dot.x > s.fiji.x, "after zooming over the dateline the Samoa dot is still east of Fiji");
  // the country's own data: Fiji's tab shows its map without errors
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 2).join(" | ") : ""));
  await ctx.close();
}

// ---------- phone ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, "#to/timeline");
  await addTest(p);
  await p.evaluate(() => { window.__asapMap.setView([-17, -179], 5, { animate: false }); }); await p.waitForTimeout(400);
  let s = await state(p);
  ok(s.dotIn, "phone: from just east of the dateline the Samoa dot is on screen");
  ok(s.fiji.x < s.dot.x && s.fiji.x > -400, "phone: Fiji is drawn west of Samoa, beside it (x " + Math.round(s.fiji.x) + ")");
  // swipe right to left over the dateline several times (pans east), each swipe a real touch drag
  const cdp = await ctx.newCDPSession(p);
  const r = await p.evaluate(() => { const b = window.__asapMap.getContainer().getBoundingClientRect(); return { x: b.left + 140, y: b.top + Math.min(b.height / 2, 260) }; });
  await p.evaluate(() => { window.__asapMap.setView([-15, 170], 5, { animate: false }); }); await p.waitForTimeout(400);
  for (let k = 0; k < 2; k++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: r.x + 150, y: r.y }] });
    for (let i = 1; i <= 10; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: r.x + 150 - i * 30, y: r.y }] }); await p.waitForTimeout(16); }
    await p.waitForTimeout(120);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await p.waitForTimeout(700);
  }
  s = await state(p);
  ok(s.lng >= -180 && s.lng <= 180, "phone: after swiping over the dateline the centre reads " + s.lng.toFixed(1));
  ok(s.lng < -150 && s.dotIn, "phone: two swipes east from Vanuatu carry over the dateline to Samoa (centre " + s.lng.toFixed(1) + ")");
  if (OUT) await p.screenshot({ path: OUT + "/wrap-phone.png" });
  ok(!errors.length, "phone: no page errors" + (errors.length ? ": " + errors.slice(0, 2).join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
