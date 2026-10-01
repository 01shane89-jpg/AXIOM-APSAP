// Headless check of the Country boundaries overlay (assets/osap-borders.js): the "Country borders" switch sits in Map overlays
// (not in Data sets), is off at start and downloads nothing until switched on; switched on it draws the 1:50m borders zoomed out
// and the 1:10m borders zoomed in, sharp lines in a pane of their own; it stays on after a reload and across a data set change
// (extrasOff), shows on a conflict tab, adds a legend key, and switches off cleanly. Also the dateline copies and the phone layout.
// Run from the repo root: node tests/borders_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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
const shown = (p, s) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && getComputedStyle(e).display !== "none" && e.getClientRects().length > 0; }, s);
async function open(ctx, hash = "") {
  const p = await ctx.newPage(), errors = [], got = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("request", (r) => { if (/borders-(50m|10m)\.js/.test(r.url())) got.push(r.url().match(/borders-(\w+)\.js/)[1]); });
  await p.goto(base + hash, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_BORDERS_UI, null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
  return { p, errors, got };
}
async function context(opts) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  return ctx;
}
const lines = (p) => p.evaluate(() => {
  const m = window.__asapMap, pane = m.getPane("bdrpane"); let n = 0, pts = 0, minLng = 999, maxLng = -999, ws = [];
  m.eachLayer((l) => { if (l instanceof L.Polyline && l.options.pane === "bdrpane") { n++; ws.push(l.options.weight);
    l.getLatLngs().forEach((r) => { pts += r.length; r.forEach((q) => { minLng = Math.min(minLng, q.lng); maxLng = Math.max(maxLng, q.lng); }); }); } });
  return { n, pts, minLng, maxLng, ws, canvas: !!(pane && pane.querySelector("canvas")), legend: /Natural Earth, de facto lines/.test(document.body.innerHTML) };
});
const om = (p) => p.evaluate(() => window.OSAP_ATAK.overlays("overlays")).then(() => p.waitForTimeout(400));
// ---------- desktop ----------
{
  const ctx = await context({ viewport: { width: 1360, height: 860 } });
  let { p, errors, got } = await open(ctx);
  let s = await lines(p);
  ok(s.n === 0 && got.length === 0, "starts off, no border file downloaded (" + got.join() + ")");
  await om(p);
  ok(await shown(p, '#atk-om #ml-bounds input[data-bd="countries"]'), "Country borders switch in the Overlays sheet");
  ok(await p.evaluate(() => { const b = document.getElementById("ml-bounds"), s = document.getElementById("ml-sides"); return !s || !!(b.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING); }), "Boundaries sits above Country sides");
  await p.evaluate(() => window.OSAP_ATAK.overlays("datasets")); await p.waitForTimeout(300);
  ok(!(await shown(p, "#ml-bounds")), "not in the Data sets panel");
  await om(p);
  await p.evaluate(() => window.__asapMap.setView([20, 100], 4, { animate: false }));
  await p.check('#ml-bounds input[data-bd="countries"]'); await p.waitForTimeout(1500);
  s = await lines(p);
  ok(s.n === 2 && s.pts > 20000 && got.join() === "50m", "zoomed out: 1:50m borders drawn (casing + line, " + s.pts + " points), only the 50m file fetched (" + got.join() + ")");
  ok(s.canvas, "drawn in its own pane");
  ok(s.minLng < -180 && s.maxLng > 180, "borders near the dateline drawn one world over too (" + s.minLng.toFixed(1) + " to " + s.maxLng.toFixed(1) + ")");
  ok(s.legend, "legend key");
  if (OUT) await p.screenshot({ path: OUT + "/borders-z4.png" });
  await p.evaluate(() => window.__asapMap.setView([14.2, 102.8], 8, { animate: false })); await p.waitForTimeout(1500);
  const s2 = await lines(p);
  ok(s2.n === 2 && s2.pts > s.pts && got.join() === "50m,10m", "zoomed in: 1:10m borders drawn (" + s2.pts + " points), file fetched once now (" + got.join() + ")");
  ok(s2.ws[1] > s.ws[1], "line thicker zoomed in (" + s.ws[1] + " -> " + s2.ws[1] + ")");
  if (OUT) await p.screenshot({ path: OUT + "/borders-z8.png" });
  // a data set change switches the other overlays off, not this one
  await p.evaluate(() => { const i = document.querySelector("#ml-ds input[data-ds]"); if (i) i.click(); }); await p.waitForTimeout(1200);
  ok((await lines(p)).n === 2 && await p.isChecked('#ml-bounds input[data-bd="countries"]'), "stays on after a data set change");
  // a conflict tab hides every unlisted pane
  await p.evaluate(() => { location.hash = "#ua/cf-russia-ukraine"; }); await p.waitForTimeout(3000);
  const vis = await p.evaluate(() => { const pn = window.__asapMap.getPane("bdrpane"); return pn ? getComputedStyle(pn).visibility : "none"; });
  ok(vis === "visible", "shows on a conflict tab (" + vis + ")");
  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await p.close();
  // remembered on this device
  ({ p, errors, got } = await open(ctx));
  ok((await lines(p)).n === 2 && await p.evaluate(() => window.OSAP_BORDERS_UI.on()), "still on after a reload");
  await om(p);
  await p.uncheck('#ml-bounds input[data-bd="countries"]'); await p.waitForTimeout(500);
  s = await lines(p);
  ok(s.n === 0 && !s.legend, "switched off: lines and legend key gone");
  ok(errors.length === 0, "no page errors after reload " + errors.join(" | "));
  await ctx.close();
}
// ---------- phone ----------
{
  const ctx = await context({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  const { p, errors } = await open(ctx);
  await om(p);
  ok(await shown(p, '#ml-bounds input[data-bd="countries"]'), "phone: switch reachable in Map overlays");
  await p.evaluate(() => window.OSAP_BORDERS_UI.set(true)); await p.waitForTimeout(1500);
  ok((await lines(p)).n === 2, "phone: borders drawn");
  if (OUT) await p.screenshot({ path: OUT + "/borders-phone.png" });
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
