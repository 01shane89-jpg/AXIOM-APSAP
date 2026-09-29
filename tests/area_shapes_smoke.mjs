// Headless check of the Circle and Square shapes of Draw area (index.html, drawn area): drag out with a mouse on a desktop and
// with a finger on a phone (real touch input), the size shows while dragging, a tap alone draws nothing, and the result is an
// ordinary polygon in TSAP.areaApi so Summarise area, watches and NAI/TAI keep working. Edit shape: corner handles resize,
// the turn handle rotates, the centre handle moves, and the fill colour, fill opacity and outline colour can be set.
// Run from the repo root: node tests/area_shapes_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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
async function open(opts, ui) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript((ui) => { try { localStorage.setItem("osap-home", "map"); if (ui) localStorage.setItem("osap-ui", ui); } catch (e) {} }, ui);
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base, { waitUntil: "domcontentloaded" }); await p.waitForFunction(() => window.TSAP && window.TSAP.areaApi, null, { timeout: 60000 });
  /* the map container shifts a little a few seconds after load; draw only once it has settled */
  await p.waitForTimeout(9000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(400);
  return { ctx, p, errors };
}
const mid = (p) => p.evaluate(() => { const r = document.getElementById("map").getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; });
const area = (p) => p.evaluate(() => window.TSAP.areaApi.area());
const ll = (p, x, y) => p.evaluate(([x, y]) => { const m = window.__asapMap, r = m.getContainer().getBoundingClientRect(), l = m.containerPointToLatLng([x - r.left, y - r.top]); return [l.lat, l.lng]; }, [x, y]);
const hpos = (p, k) => p.evaluate((k) => { const r = document.querySelector('.areah[data-ah="' + k + '"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, k);
const pxBox = (p) => p.evaluate(() => { const m = window.__asapMap, P = window.TSAP.areaApi.area().map((q) => m.latLngToContainerPoint(q)); const xs = P.map((q) => q.x), ys = P.map((q) => q.y); return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), cx: xs.reduce((a, b) => a + b) / xs.length, cy: ys.reduce((a, b) => a + b) / ys.length }; });
const edgeLen = (p) => p.evaluate(() => { const m = window.__asapMap, P = window.TSAP.areaApi.area().map((q) => m.latLngToContainerPoint(q)); return [P[0].distanceTo(P[1]), P[1].distanceTo(P[2])]; });
const dist = (p, a, b) => p.evaluate(([a, b]) => window.__asapMap.distance(a, b), [a, b]);
async function mouseDrag(p, x0, y0, x1, y1) {
  await p.mouse.move(x0, y0); await p.mouse.down();
  for (let i = 1; i <= 8; i++) await p.mouse.move(x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8);
  const hint = await p.textContent("#area-ctl .areahint");
  await p.mouse.up(); await p.waitForTimeout(300);
  return hint;
}
async function touchDrag(p, cdp, x0, y0, x1, y1) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + (x1 - x0) * i / 8, y: y0 + (y1 - y0) * i / 8 }] });
  const hint = await p.textContent("#area-ctl .areahint");
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await p.waitForTimeout(300);
  return hint;
}
// ---------- desktop, classic buttons, mouse ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1400, height: 900 } }, "classic");
  await p.evaluate(() => window.TSAP.areaApi.setArea(null));
  await p.click('#area-ctl [data-area="open"]');
  ok(/Circle/.test(await p.textContent("#area-ctl")) && /Square/.test(await p.textContent("#area-ctl")), "desktop: Draw area offers Circle and Square");
  if (OUT) await p.screenshot({ path: OUT + "/desk-menu.png" });
  await p.click('#area-ctl [data-area="circle"]');
  ok(/centre/.test(await p.textContent("#area-ctl .areahint")), "desktop: circle hint shows");
  const [cx, cy] = await mid(p);
  // a click alone draws nothing and stays in circle mode
  await p.mouse.click(cx, cy); await p.waitForTimeout(300);
  ok(!(await area(p)) && /centre/.test(await p.textContent("#area-ctl .areahint")), "desktop: a click alone draws nothing, still drawing");
  const center = await ll(p, cx, cy), edge = await ll(p, cx + 150, cy);
  const hint = await mouseDrag(p, cx, cy, cx + 150, cy);
  ok(/Radius [\d.]+ km \([\d.]+ nm\)/.test(hint), "desktop: radius shows while dragging: " + hint);
  const A = await area(p);
  ok(A && A.length === 64, "desktop: circle becomes a 64-point drawn area");
  const want = await dist(p, center, edge), got = A ? await dist(p, center, A[16]) : 0;
  ok(A && Math.abs(got - want) / want < 0.02, `desktop: every point is the radius from the centre (${Math.round(got)} m vs ${Math.round(want)} m)`);
  ok(await p.evaluate((c) => window.TSAP.areaApi.inPoly(c[0], c[1], window.TSAP.areaApi.area()), center), "desktop: the centre is inside the area");
  ok(await p.evaluate(() => !!document.querySelector('#area-ctl [data-area="save"]') && !!document.querySelector('#area-ctl [data-area="clear"]') && document.querySelectorAll(".areah").length === 6), "desktop: after drawing, Save, Delete and the edit handles are right there");
  await p.click('#area-ctl [data-area="done"]');
  ok(/Summarise area/.test(await p.textContent("#area-ctl")), "desktop: Summarise area offered for the circle");
  if (OUT) await p.screenshot({ path: OUT + "/desk-circle.png" });
  // square: corner to corner
  await p.click('#area-ctl [data-area="open"]'); await p.click('#area-ctl [data-area="rect"]');
  const a = await ll(p, cx - 120, cy - 80), b = await ll(p, cx + 100, cy + 90);
  const sh = await mouseDrag(p, cx - 120, cy - 80, cx + 100, cy + 90);
  ok(/[\d.]+ km × [\d.]+ km/.test(sh), "desktop: width × height shows while dragging: " + sh);
  const S = await area(p);
  ok(S && S.length === 4, "desktop: square becomes a 4-corner drawn area");
  await p.click('#area-ctl [data-area="done"]');
  const near = (u, v) => Math.abs(u[0] - v[0]) < 1e-3 && Math.abs(u[1] - v[1]) < 1e-3;
  ok(S && near(S[0], a) && near(S[2], b) && near(S[1], [a[0], b[1]]) && near(S[3], [b[0], a[1]]), "desktop: corners are where the drag started and ended");
  if (OUT) await p.screenshot({ path: OUT + "/desk-square.png" });
  // Escape cancels and keeps the last area
  await p.click('#area-ctl [data-area="open"]'); await p.click('#area-ctl [data-area="circle"]');
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  ok((await area(p)).length === 4 && /Area on/.test(await p.textContent("#area-ctl")), "desktop: Escape cancels and keeps the square");
  // edit the square: resize from a corner, turn it, move it
  await p.click('#area-ctl [data-area="open"]'); await p.click('#area-ctl [data-area="edit"]'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.querySelectorAll(".areah").length) === 6, "edit: 4 corner handles, a turn handle and a move handle");
  if (OUT) await p.screenshot({ path: OUT + "/desk-edit.png" });
  const b0 = await pxBox(p), c2 = await hpos(p, "c2");
  await p.mouse.move(c2[0], c2[1]); await p.mouse.down(); await p.mouse.move(c2[0] + 40, c2[1] + 30, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(300);
  const b1 = await pxBox(p);
  ok(Math.abs(b1.w - b0.w - 40) < 3 && Math.abs(b1.h - b0.h - 30) < 3, `edit: corner drag resizes (${Math.round(b0.w)}x${Math.round(b0.h)} -> ${Math.round(b1.w)}x${Math.round(b1.h)})`);
  ok((await area(p)).length === 4 && await p.evaluate(() => document.querySelectorAll(".areah").length) === 6, "edit: still a square, handles follow");
  const e0 = await edgeLen(p), rh = await hpos(p, "rot");
  // turn 90 degrees clockwise: from straight above the centre to straight right of it
  const rr = Math.hypot(rh[0] - b1.cx, rh[1] - b1.cy);
  const mr = await p.evaluate(() => { const r = document.getElementById("map").getBoundingClientRect(); return [r.left, r.top]; });
  await p.mouse.move(rh[0], rh[1]); await p.mouse.down();
  for (let i = 1; i <= 8; i++) { const t = -Math.PI / 2 + (Math.PI / 2) * i / 8; await p.mouse.move(mr[0] + b1.cx + rr * Math.cos(t), mr[1] + b1.cy + rr * Math.sin(t)); }
  await p.mouse.up(); await p.waitForTimeout(300);
  const b2 = await pxBox(p), e1 = await edgeLen(p);
  ok(Math.abs(b2.w - b1.h) < 8 && Math.abs(b2.h - b1.w) < 8, `edit: turn handle rotates 90° (${Math.round(b2.w)}x${Math.round(b2.h)})`);
  ok(Math.abs(e1[0] - e0[0]) < 3 && Math.abs(e1[1] - e0[1]) < 3, "edit: turning keeps the side lengths");
  const st = await p.evaluate(() => window.TSAP.areaApi.style());
  ok(Math.abs(st.rot - Math.PI / 2) < 0.1, "edit: the turn is remembered: " + st.rot.toFixed(2));
  // resize after turning keeps right angles (resizes along the turned sides)
  const c1 = await hpos(p, "c1");
  await p.mouse.move(c1[0], c1[1]); await p.mouse.down(); await p.mouse.move(c1[0] + 25, c1[1] - 15, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(300);
  ok(await p.evaluate(() => { const m = window.__asapMap, P = window.TSAP.areaApi.area().map((q) => m.latLngToContainerPoint(q)); const u = P[1].subtract(P[0]), v = P[2].subtract(P[1]); return Math.abs(u.x * v.x + u.y * v.y) / (u.distanceTo([0, 0]) * v.distanceTo([0, 0])) < 0.02; }), "edit: resizing a turned square keeps right angles");
  const mv = await hpos(p, "mv"), bm = await pxBox(p);
  await p.mouse.move(mv[0], mv[1]); await p.mouse.down(); await p.mouse.move(mv[0] - 60, mv[1] + 20, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(300);
  const b3 = await pxBox(p);
  ok(Math.abs(b3.cx - bm.cx + 60) < 3 && Math.abs(b3.cy - bm.cy - 20) < 3, "edit: centre handle moves the shape");
  ok(await p.evaluate(() => !document.querySelector(".leaflet-popup-content")), "edit: no report opened by handle taps");
  // colours and opacity (under Style)
  ok(await p.evaluate(() => !document.querySelector('#area-ctl [data-ast]')), "style: the style settings stay folded until asked for");
  await p.click('#area-ctl [data-area="look"]');
  await p.evaluate(() => { const set = (k, v) => { const i = document.querySelector('#area-ctl [data-ast="' + k + '"]'); i.value = v; i.dispatchEvent(new Event("input", { bubbles: true })); }; set("fill", "#ff0000"); set("line", "#00ff00"); set("op", "50"); });
  const paths = await p.evaluate(() => [...document.querySelectorAll(".leaflet-areapane-pane path")].map((x) => [x.getAttribute("fill"), x.getAttribute("fill-opacity"), x.getAttribute("stroke")]));
  ok(paths.some((x) => x[0] === "#ff0000" && x[1] === "0.5") && paths.some((x) => x[2] === "#00ff00"), "style: fill colour, fill opacity and outline colour apply");
  if (OUT) await p.screenshot({ path: OUT + "/desk-styled.png" });
  await p.click('#area-ctl [data-area="done"]'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.querySelectorAll(".areah").length) === 0 && /Area on/.test(await p.textContent("#area-ctl")), "edit: Done removes the handles");
  await p.reload(); await p.waitForFunction(() => window.TSAP && window.TSAP.areaApi, null, { timeout: 60000 }); await p.waitForTimeout(3000);
  const s2 = await p.evaluate(() => window.TSAP.areaApi.style());
  ok(s2.fill === "#ff0000" && s2.line === "#00ff00" && s2.op === 0.5 && (await area(p)).length === 4, "style: kept after reload");
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(400);
  // lasso still works as before
  await p.click('#area-ctl [data-area="open"]'); await p.click('#area-ctl [data-area="lasso"]');
  await p.mouse.move(cx, cy - 60); await p.mouse.down();
  for (const [dx, dy] of [[60, -30], [80, 30], [30, 80], [-40, 70], [-70, 10]]) await p.mouse.move(cx + dx, cy + dy, { steps: 3 });
  await p.mouse.up(); await p.waitForTimeout(300);
  ok((await area(p)).length > 6, "desktop: lasso still draws");
  // outline width: thinner by default, a setting, and thinner again when zoomed out
  const w = () => p.evaluate(() => { const ps = [...document.querySelectorAll(".leaflet-areapane-pane path")].filter((x) => x.getAttribute("fill") === "none" && /z$/i.test(x.getAttribute("d") || "")); return ps.length ? +ps[ps.length - 1].getAttribute("stroke-width") : 0; });
  await p.click('#area-ctl [data-area="look"]');
  await p.click('#area-ctl [data-area="reset"]');
  await p.evaluate(() => window.__asapMap.setZoom(10, { animate: false })); await p.waitForTimeout(300);
  ok(await w() === 2, "width: outline is 2 px by default at close zoom: " + await w());
  await p.evaluate(() => { const i = document.querySelector('#area-ctl [data-ast="w"]'); i.value = "5"; i.dispatchEvent(new Event("input", { bubbles: true })); });
  ok(await w() === 5 && /5 px/.test(await p.textContent("#area-ctl")), "width: the Outline width setting applies");
  await p.evaluate(() => window.__asapMap.setZoom(5, { animate: false })); await p.waitForTimeout(300);
  ok(await w() === 2.5, "width: halves when zoomed out to country level: " + await w());
  await p.evaluate(() => window.__asapMap.setZoom(3, { animate: false })); await p.waitForTimeout(300);
  ok(await w() === 2, "width: 40% (never under 1 px) zoomed right out: " + await w());
  await p.evaluate(() => { const i = document.querySelector('#area-ctl [data-ast="w"]'); i.value = "1"; i.dispatchEvent(new Event("input", { bubbles: true })); });
  ok(await w() === 1, "width: a 1 px outline stays visible at 1 px zoomed out");
  await p.evaluate(() => window.__asapMap.setZoom(7, { animate: false })); await p.waitForTimeout(300);
  // Save: the name form opens, the saved area keeps its look and stays on the map after a reload
  await p.evaluate(() => { const set = (k, v) => { const i = document.querySelector('#area-ctl [data-ast="' + k + '"]'); i.value = v; i.dispatchEvent(new Event("input", { bubbles: true })); }; set("fill", "#ff8800"); set("line", "#112233"); set("w", "3"); });
  await p.click('#area-ctl [data-area="save"]'); await p.waitForTimeout(300);
  ok(/Save the drawn area/.test(await p.textContent("#aoidlg")), "save: Save opens the name form");
  await p.fill("#aoi-name", "Bridge"); await p.click('#aoi-form button[type="submit"]'); await p.waitForTimeout(300);
  const saved = await p.evaluate(() => window.OSAP_AOI.list(window.TSAP.country));
  ok(saved.length === 1 && saved[0].name === "Bridge" && saved[0].st && saved[0].st.fill === "#ff8800" && saved[0].st.line === "#112233" && saved[0].st.w === 3, "save: saved with its name and look " + JSON.stringify(saved[0] && saved[0].st));
  await p.evaluate(() => { const x = document.querySelector("#aoidlg [data-aoi-x]"); if (x) x.click(); });
  // Delete: the drawn shape goes; the saved copy stays
  await p.click('#area-ctl [data-area="open"]'); await p.click('#area-ctl [data-area="edit"]'); await p.click('#area-ctl [data-area="clear"]'); await p.waitForTimeout(300);
  ok(!(await area(p)) && await p.evaluate(() => document.querySelectorAll(".areah").length === 0) && /Draw area/.test(await p.textContent("#area-ctl")), "delete: Delete removes the drawn shape and its handles");
  await p.reload(); await p.waitForFunction(() => window.TSAP && window.OSAP_AOI, null, { timeout: 60000 }); await p.waitForTimeout(3000);
  const kept = await p.evaluate(() => [...document.querySelectorAll(".leaflet-areapane-pane path")].some((x) => x.getAttribute("stroke") === "#112233" && x.getAttribute("fill") === "#ff8800"));
  ok(kept && /Bridge/.test(await p.evaluate(() => document.querySelector(".leaflet-pane").textContent + [...document.querySelectorAll(".aoilbl")].map((x) => x.textContent).join(" "))), "save: the saved area is on the map after a reload, in its own colours");
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(400);
  ok(errors.length === 0, "desktop: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- phone, tactical toolbar, finger ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const cdp = await ctx.newCDPSession(p);
  await p.evaluate(() => window.TSAP.areaApi.setArea(null));
  await p.click('#atk-tools [data-atk="area"]');
  ok(/Circle/.test(await p.textContent("#atk-pop")) && /Square/.test(await p.textContent("#atk-pop")), "phone: toolbar Area menu offers Circle and Square");
  if (OUT) await p.screenshot({ path: OUT + "/phone-menu.png" });
  await p.click('#atk-pop [data-pk="circle"]'); await p.waitForTimeout(200);
  const [cx, cy] = await mid(p);
  const hint = await touchDrag(p, cdp, cx, cy, cx + 90, cy + 40);
  ok(/Radius/.test(hint), "phone: radius shows under the finger: " + hint);
  if (OUT) await p.screenshot({ path: OUT + "/phone-circle.png" });
  ok((await area(p) || []).length === 64, "phone: finger drag draws the circle");
  ok(await p.evaluate(() => { const b = document.querySelector('#area-ctl [data-area="save"]'); if (!b) return false; const r = b.getBoundingClientRect(), t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return b.contains(t); }), "phone: Save is on screen right after drawing");
  await p.click('#area-ctl [data-area="done"]');
  await p.click('#atk-tools [data-atk="area"]'); await p.click('#atk-pop [data-pk="rect"]'); await p.waitForTimeout(200);
  await touchDrag(p, cdp, cx - 80, cy - 60, cx + 70, cy + 90);
  ok((await area(p) || []).length === 4, "phone: finger drag draws the square");
  await p.click('#area-ctl [data-area="done"]');
  if (OUT) await p.screenshot({ path: OUT + "/phone-square.png" });
  ok(await p.evaluate(() => !document.getElementById("map").classList.contains("area-drawing")), "phone: map panning is back after drawing");
  // edit with a finger: the toolbar's Edit shape, then drag a corner
  await p.click('#atk-tools [data-atk="area"]'); await p.click('#atk-pop [data-pk="edit"]'); await p.waitForTimeout(300);
  await p.click('#area-ctl [data-area="look"]');
  ok(await p.evaluate(() => document.querySelectorAll(".areah").length) === 6, "phone: Edit shape shows the handles");
  ok(await p.evaluate(() => { const e = document.getElementById("area-ctl"), r = e.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.width > 100 && r.left >= 0 && r.right <= innerWidth && !!e.querySelector('[data-ast="op"]') && e.contains(t); }), "phone: colour controls fit the screen and nothing covers them");
  if (OUT) await p.screenshot({ path: OUT + "/phone-edit.png" });
  const pb0 = await pxBox(p), pc = await hpos(p, "c2");
  await touchDrag(p, cdp, pc[0], pc[1], pc[0] + 30, pc[1] + 30);
  const pb1 = await pxBox(p);
  ok(pb1.w > pb0.w + 20 && pb1.h > pb0.h + 20, "phone: finger drag on a corner resizes");
  await p.click('#area-ctl [data-area="done"]');
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
