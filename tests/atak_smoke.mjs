// Headless check of the ATAK-style map controls (assets/osap-atak.js) on a phone and a desktop: side toolbar in place of the
// old buttons, long-press / right-click radial menu and each of its actions, grid readout, Overlay Manager, Classic switch.
// Run from the repo root: node tests/atak_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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
const settle = (p, ms = 3500) => p.waitForTimeout(ms);
const shown = (p, s) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && getComputedStyle(e).display !== "none" && e.getClientRects().length > 0; }, s);
async function open(opts) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base, { waitUntil: "domcontentloaded" }); await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK, null, { timeout: 60000 }); await settle(p);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(400);
  return { ctx, p, errors };
}
/* a touch long-press in the middle of the map: pointerdown, hold, pointerup */
async function longPress(p, dx = 0, dy = 0) {
  await p.evaluate(([dx, dy]) => {
    const m = document.getElementById("map"), r = m.getBoundingClientRect(), x = r.left + r.width / 2 + dx, y = r.top + r.height / 2 + dy;
    const t = document.elementFromPoint(x, y) || m;
    t.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, pointerId: 7 }));
  }, [dx, dy]);
  await p.waitForTimeout(750);
  await p.evaluate(() => { const m = document.getElementById("map"); m.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch", isPrimary: true, pointerId: 7 })); });
}
const ringBtn = (p, k) => p.click(`#atk-ring [data-rk="${k}"]`);

// ---------- phone ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  ok(await p.evaluate(() => document.documentElement.classList.contains("atak")), "phone: toolbar mode on by default");
  ok(await shown(p, "#atk-tools") && await shown(p, "#atk-bar"), "phone: side toolbar and grid readout shown");
  ok(!(await shown(p, "#watch-btn")) && !(await shown(p, ".tdctl")) && !(await shown(p, ".mlctl")) && !(await shown(p, "#meas-btn")), "phone: old map buttons out of sight");
  const tb = await p.evaluate(() => { const r = document.getElementById("atk-tools").getBoundingClientRect(), m = document.getElementById("map").getBoundingClientRect(); return { w: r.width, right: m.right - r.right, top: r.top - m.top, h: r.height, mh: m.height }; });
  ok(tb.w <= 56 && tb.right < 12, "phone: toolbar is slim and on the right edge " + JSON.stringify(tb));
  ok(tb.h <= tb.mh - 30, "phone: toolbar fits inside the map above the readout");
  const rd = await p.textContent("#atk-bar .atk-v");
  ok(/^\d{1,2}[C-X] [A-Z]{2} \d{5} \d{5}$/.test(rd), "phone: readout shows an MGRS grid: " + rd);
  await p.click('#atk-bar [data-sb="fmt"]'); ok(/°[NS] /.test(await p.textContent("#atk-bar .atk-v")), "phone: tap readout switches to degrees");
  await p.click('#atk-bar [data-sb="fmt"]'); await p.click('#atk-bar [data-sb="fmt"]');
  if (OUT) await p.screenshot({ path: OUT + "/phone-toolbar.png" });
  // fold and unfold, remembered
  await p.click("#atk-tools .atk-fold");
  ok(await p.evaluate(() => document.getElementById("atk-tools").classList.contains("folded") && localStorage.getItem("osap-atak-fold") === "1"), "phone: toolbar folds away and remembers");
  if (OUT) await p.screenshot({ path: OUT + "/phone-folded.png" });
  await p.click("#atk-tools .atk-fold");
  // long-press radial menu
  await longPress(p);
  ok(await shown(p, "#atk-ring"), "phone: long-press opens the radial menu");
  ok(await p.evaluate(() => document.querySelectorAll("#atk-ring [data-rk]").length) === 7, "phone: radial has 6 actions and close");
  if (OUT) await p.screenshot({ path: OUT + "/phone-radial.png" });
  await ringBtn(p, "pin");
  ok(await p.evaluate(() => JSON.parse(localStorage.getItem("osap-atak-pts") || "[]").length === 1 && document.querySelectorAll(".leaflet-atakpane-pane .atk-pt").length === 1), "phone: Drop point draws P1 and keeps it");
  ok(await shown(p, "#pt-ed"), "phone: a dropped point opens its name, note and photos sheet");
  await p.click('#pt-ed .pt-foot [data-pe="x"]');
  // measure from here
  await longPress(p, 20, 20); await ringBtn(p, "measure"); await p.waitForTimeout(300);
  ok(await p.evaluate(() => window.OSAP_MEASURE.state().pts.length === 1), "phone: Measure from here starts a measurement at the point");
  if (OUT) await p.screenshot({ path: OUT + "/phone-measure.png" });
  ok(await p.evaluate(() => { const c = document.getElementById("meas-card").getBoundingClientRect(), b = document.getElementById("atk-bar").getBoundingClientRect(); return c.bottom <= b.top + 1; }), "phone: the measure card sits above the grid readout");
  await p.evaluate(() => window.OSAP_MEASURE.on(false));
  // NAI/TAI from here: a circle becomes the drawn area and the save form opens
  await longPress(p, -30, 10); await p.click('#atk-ring [data-rr="5"]'); await ringBtn(p, "nai"); await p.waitForTimeout(400);
  ok(await p.evaluate(() => { const A = window.TSAP.areaApi.area(); return A && A.length === 32; }), "phone: NAI/TAI sets a 32-point circle as the drawn area");
  ok(await shown(p, "#aoidlg") && /Save the drawn area/.test(await p.textContent("#aoidlg")), "phone: NAI/TAI opens the save form");
  if (OUT) await p.screenshot({ path: OUT + "/phone-nai.png" });
  await p.fill("#aoi-name", "7"); await p.click('#aoi-form button[type="submit"]'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => window.OSAP_AOI.list(window.TSAP.country).length === 1), "phone: the NAI is saved");
  await p.evaluate(() => { const x = document.querySelector("#aoidlg [data-aoi-x]"); if (x) x.click(); });
  // watch from here
  await longPress(p, 40, -40); await ringBtn(p, "watch"); await p.waitForTimeout(500);
  ok(await p.evaluate(() => { const r = document.querySelector('[name="w-area"][value="drawn"]'); return !!r && r.checked; }), "phone: Watch opens the watch form with the area picked");
  await p.keyboard.press("Escape"); await p.evaluate(() => { const d = document.getElementById("watchdlg"); if (d) d.hidden = true; });
  // right side toolbar opens the Overlay Manager with the Layers panel inside
  await p.click('#atk-tools [data-atk="overlays"]'); await p.waitForTimeout(200);
  ok(await shown(p, "#atk-om") && await p.evaluate(() => !!document.querySelector("#atk-om #ml-panel")), "phone: Overlay Manager opens holding the map layers");
  ok(await p.evaluate(() => document.querySelectorAll("#atk-om #ml-ds input, #atk-ds [data-ds]").length > 3), "phone: Overlay Manager lists the data sets");
  ok(/P1/.test(await p.textContent("#atk-marks")) && /NAI/.test(await p.textContent("#atk-marks")), "phone: Overlay Manager lists your point and NAI");
  if (OUT) await p.screenshot({ path: OUT + "/phone-overlays.png" });
  await p.click('#atk-om [data-om="x"]');
  ok(await p.evaluate(() => !document.querySelector("#atk-om #ml-panel") && !!document.querySelector(".mlctl #ml-panel")), "phone: closing puts the Layers panel back");
  // toolbar buttons press the old controls
  await p.click('#atk-tools [data-atk="today"]'); await p.waitForTimeout(400);
  ok(await p.evaluate(() => window.OSAP_TODAY && window.OSAP_TODAY.isOpen()), "phone: Today button opens Today");
  await p.evaluate(() => { const b = document.querySelector(".tdmap"); if (b) b.click(); }); await p.waitForTimeout(300);
  // conflict tabs keep the points pane
  ok(await p.evaluate(() => { document.documentElement.setAttribute("data-cf", "x"); const v = getComputedStyle(document.querySelector(".leaflet-atakpane-pane")).visibility; document.documentElement.removeAttribute("data-cf"); return v; }) !== "hidden", "phone: points pane stays on conflict tabs");
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- desktop ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1400, height: 900 } });
  ok(await shown(p, "#atk-tools") && await shown(p, ".leaflet-control-zoom"), "desktop: toolbar shown, zoom buttons kept for a mouse");
  const box = await p.evaluate(() => { const r = document.getElementById("map").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await p.mouse.move(box[0] - 100, box[1]); await p.waitForTimeout(100);
  ok(/Cursor/i.test(await p.textContent("#atk-bar .atk-k")), "desktop: readout follows the mouse");
  await p.mouse.click(box[0] - 100, box[1], { button: "right" }); await p.waitForTimeout(200);
  ok(await shown(p, "#atk-ring"), "desktop: right-click opens the radial menu");
  if (OUT) await p.screenshot({ path: OUT + "/desk-radial.png" });
  await p.keyboard.press("Escape"); ok(!(await shown(p, "#atk-ring")), "desktop: Escape closes it");
  await p.click('#atk-tools [data-atk="area"]');
  ok(await shown(p, "#atk-pop") && /Lasso/.test(await p.textContent("#atk-pop")), "desktop: Area opens Lasso / Polygon");
  await p.click('#atk-pop [data-pk="poly"]'); await p.waitForTimeout(150);
  ok(await shown(p, "#area-ctl") && /corner/.test(await p.textContent("#area-ctl")), "desktop: drawing hint shows while drawing");
  await p.click('#area-ctl [data-area="cancel"]');
  await p.click('#atk-tools [data-atk="layout"]'); await p.click('#atk-pop [data-pk="split"]'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => localStorage.getItem("asap-rv-mode")) === "split", "desktop: Layout sets Map and list");
  if (OUT) await p.screenshot({ path: OUT + "/desk-split.png" });
  // classic switch and back
  await p.click('#atk-tools [data-atk="overlays"]'); await p.check("#atk-classic"); await p.waitForTimeout(150);
  ok(await p.evaluate(() => !document.documentElement.classList.contains("atak")) && await shown(p, "#watch-btn") && !(await shown(p, "#atk-tools")), "desktop: Classic controls brings the old buttons back");
  await p.click(".mlctl .mlbtn"); await p.check("#atk-back input"); await p.waitForTimeout(150);
  ok(await p.evaluate(() => document.documentElement.classList.contains("atak")), "desktop: Tactical toolbar in Layers turns it back on");
  ok(errors.length === 0, "desktop: no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
