// Headless check of the Circle and Square shapes of Draw area (index.html, drawn area): drag out with a mouse on a desktop and
// with a finger on a phone (real touch input), the size shows while dragging, a tap alone draws nothing, and the result is an
// ordinary polygon in TSAP.areaApi so Summarise area, watches and NAI/TAI keep working.
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
  ok(/Summarise area/.test(await p.textContent("#area-ctl")), "desktop: Summarise area offered for the circle");
  if (OUT) await p.screenshot({ path: OUT + "/desk-circle.png" });
  // square: corner to corner
  await p.click('#area-ctl [data-area="open"]'); await p.click('#area-ctl [data-area="rect"]');
  const a = await ll(p, cx - 120, cy - 80), b = await ll(p, cx + 100, cy + 90);
  const sh = await mouseDrag(p, cx - 120, cy - 80, cx + 100, cy + 90);
  ok(/[\d.]+ km × [\d.]+ km/.test(sh), "desktop: width × height shows while dragging: " + sh);
  const S = await area(p);
  ok(S && S.length === 4, "desktop: square becomes a 4-corner drawn area");
  const near = (u, v) => Math.abs(u[0] - v[0]) < 1e-3 && Math.abs(u[1] - v[1]) < 1e-3;
  ok(S && near(S[0], a) && near(S[2], b) && near(S[1], [a[0], b[1]]) && near(S[3], [b[0], a[1]]), "desktop: corners are where the drag started and ended");
  if (OUT) await p.screenshot({ path: OUT + "/desk-square.png" });
  // Escape cancels and keeps the last area
  await p.click('#area-ctl [data-area="open"]'); await p.click('#area-ctl [data-area="circle"]');
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  ok((await area(p)).length === 4 && /Area on/.test(await p.textContent("#area-ctl")), "desktop: Escape cancels and keeps the square");
  // lasso still works as before
  await p.click('#area-ctl [data-area="open"]'); await p.click('#area-ctl [data-area="lasso"]');
  await p.mouse.move(cx, cy - 60); await p.mouse.down();
  for (const [dx, dy] of [[60, -30], [80, 30], [30, 80], [-40, 70], [-70, 10]]) await p.mouse.move(cx + dx, cy + dy, { steps: 3 });
  await p.mouse.up(); await p.waitForTimeout(300);
  ok((await area(p)).length > 6, "desktop: lasso still draws");
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
  await p.click('#atk-tools [data-atk="area"]'); await p.click('#atk-pop [data-pk="rect"]'); await p.waitForTimeout(200);
  await touchDrag(p, cdp, cx - 80, cy - 60, cx + 70, cy + 90);
  ok((await area(p) || []).length === 4, "phone: finger drag draws the square");
  if (OUT) await p.screenshot({ path: OUT + "/phone-square.png" });
  ok(await p.evaluate(() => !document.getElementById("map").classList.contains("area-drawing")), "phone: map panning is back after drawing");
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
