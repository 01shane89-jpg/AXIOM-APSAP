// Headless check of the MGRS grid lines and centre crosshair (assets/osap-grid.js): both off by default, switched on and off
// separately from the tactical toolbar (Layers panel rows with classic controls), spacing by zoom, lines on grid values,
// crosshair on the map centre agreeing with the Centre readout, remembered on reload, classic controls on a phone.
// Run from the repo root: node tests/grid_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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

const gridState = (p) => p.evaluate(() => {
  const pane = document.querySelector(".leaflet-gridpane-pane");
  return { st: window.OSAP_GRID.state(), paths: pane ? pane.querySelectorAll("path").length : 0, labels: pane ? [...pane.querySelectorAll(".osap-gl span")].map((s) => s.textContent) : [] };
});
async function openLayers(p) {
  if (await p.evaluate(() => document.documentElement.classList.contains("atak"))) await p.click('#atk-tools [data-atk="overlays"]');
  else await p.evaluate(() => document.querySelector(".mlctl .mlbtn").click());
  await p.waitForTimeout(200);
}

// ---------- desktop, tactical toolbar ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1360, height: 860 } });
  let g = await gridState(p);
  ok(!g.st.grid && !g.st.cross && g.paths === 0, "desktop: grid lines and crosshair start off");
  ok(!(await shown(p, "#osap-xhair")), "desktop: no crosshair by default");
  ok(await shown(p, '#atk-tools [data-ogrid="lines"]') && await shown(p, '#atk-tools [data-ogrid="cross"]'), "desktop: Grid and Crosshair buttons on the toolbar");
  ok(await p.evaluate(() => { const b = [...document.querySelectorAll("#atk-tools .atk-list > button")]; const i = (s) => b.findIndex((x) => x.matches(s)); return i('[data-atk="basemap"]') < i('[data-ogrid="lines"]') && i('[data-ogrid="cross"]') < i('[data-atk="measure"]'); }), "desktop: they sit between Base map and Measure");
  const tb = await p.evaluate(() => { const r = document.getElementById("atk-tools").getBoundingClientRect(), m = document.getElementById("map").getBoundingClientRect(); return r.bottom <= m.bottom - 30; });
  ok(tb, "desktop: toolbar still fits above the readout");
  await openLayers(p);
  ok(!(await shown(p, "#atk-om #osap-gridrows")), "desktop: no Grid rows in the Overlays sheet any more");
  await p.click('#atk-om [data-om=x]');
  await p.click('#atk-tools [data-ogrid="lines"]'); await p.waitForTimeout(300);
  ok(await p.getAttribute('#atk-tools [data-ogrid="lines"]', "aria-pressed") === "true" && await p.getAttribute('#atk-tools [data-ogrid="cross"]', "aria-pressed") === "false", "desktop: Grid button shows pressed, Crosshair not");
  g = await gridState(p);
  ok(g.st.grid && g.paths > 0, "desktop: grid lines drawn when switched on (" + g.paths + " paths, spacing " + g.st.spacing + ")");
  ok(!g.st.cross && !(await shown(p, "#osap-xhair")), "desktop: crosshair stays off on its own");
  // zoom steps: finer lines closer in
  const byZoom = {};
  for (const z of [4, 7, 9, 11, 13]) {
    await p.evaluate((z) => window.__asapMap.setView([13.75, 100.5], z, { animate: false }), z); await p.waitForTimeout(250);
    const s = await gridState(p); byZoom[z] = s.st.spacing;
    ok(s.paths > 0 && s.labels.length > 0 && s.labels.length <= 300, `desktop: zoom ${z} spacing ${s.st.spacing} m, ${s.labels.length} labels e.g. ${s.labels.slice(0, 4).join(",")}`);
  }
  ok(byZoom[4] === 0 && byZoom[13] === 1000 && byZoom[9] > byZoom[13], "desktop: spacing gets finer as you zoom in " + JSON.stringify(byZoom));
  await p.evaluate(() => window.__asapMap.setView([13.75, 100.5], 7, { animate: false })); await p.waitForTimeout(250);
  ok((await gridState(p)).labels.includes("47P"), "desktop: grid zone 47P labelled over Bangkok");
  await p.evaluate(() => window.__asapMap.setView([13.75, 100.5], 11, { animate: false })); await p.waitForTimeout(250);
  const lb = (await gridState(p)).labels;
  ok(lb.some((t) => /^47P [A-Z]{2}$/.test(t)), "desktop: 100 km square letters shown: " + lb.filter((t) => /^47P/.test(t)).join(","));
  // a 10 km line really sits on its easting: sample a point on the drawn line, convert to UTM
  const onLine = await p.evaluate(() => {
    const g = window.OSAP_GEO, m = window.__asapMap, sp = window.OSAP_GRID.state().spacing, path = document.querySelector(".leaflet-gridpane-pane path.osap-g1");
    if (!path) return null; const len = path.getTotalLength(), pt = path.getPointAtLength(Math.min(40, len / 2));
    const ll = m.layerPointToLatLng([pt.x, pt.y]), u = g.toUtm(ll.lat, ll.lng);
    const r = (v) => Math.min(v % sp, sp - (v % sp)); return { de: r(u.e), dn: r(u.n), sp };
  });
  ok(onLine && Math.min(onLine.de, onLine.dn) < onLine.sp * 0.02, "desktop: drawn line lies on a grid value " + JSON.stringify(onLine));
  // crosshair
  await p.click('#atk-tools [data-ogrid="cross"]'); await p.waitForTimeout(250);
  ok(await shown(p, "#osap-xhair"), "desktop: crosshair shown when switched on");
  const cx = await p.evaluate(() => { const r = document.getElementById("osap-xhair").getBoundingClientRect(), m = document.getElementById("map").getBoundingClientRect(), c = window.__asapMap.latLngToContainerPoint(window.__asapMap.getCenter());
    return { dx: Math.abs(r.left + r.width / 2 - m.left - c.x), dy: Math.abs(r.top + r.height / 2 - m.top - c.y), lbl: document.querySelector("#osap-xhair .xl").textContent, strip: (() => { const c = window.__asapMap.getCenter(); return window.OSAP_GEO.mgrs(c.lat, c.lng, 5); })() }; });
  ok(cx.dx < 1.5 && cx.dy < 1.5, "desktop: crosshair sits on the map centre " + JSON.stringify(cx));
  ok(/^\d{2}[C-X] [A-Z]{2} \d+ \d+$/.test(cx.lbl) && (() => { const a = cx.lbl.split(" "), b = cx.strip.split(" "), n = a[2].length; return a[0] === b[0] && a[1] === b[1] && b[2].slice(0, n) === a[2] && b[3].slice(0, n) === a[3]; })(), "desktop: crosshair grid agrees with the Centre readout: " + cx.lbl + " / " + cx.strip);
  ok(await p.evaluate(() => getComputedStyle(document.getElementById("atk-cross")).display === "none"), "desktop: toolbar move marker yields to the crosshair");
  if (OUT) await p.screenshot({ path: OUT + "/grid-desk.png" });
  // off again, each on its own
  await p.click('#atk-tools [data-ogrid="lines"]'); await p.waitForTimeout(200);
  g = await gridState(p);
  ok(!g.st.grid && g.paths === 0 && await shown(p, "#osap-xhair"), "desktop: grid off leaves the crosshair on");
  await p.click('#atk-tools [data-ogrid="lines"]'); await p.click('#atk-tools [data-ogrid="cross"]'); await p.waitForTimeout(200);
  ok((await gridState(p)).paths > 0 && !(await shown(p, "#osap-xhair")), "desktop: crosshair off leaves the grid on");
  // remembered on reload
  await p.reload({ waitUntil: "domcontentloaded" }); await p.waitForFunction(() => window.OSAP_GRID, null, { timeout: 60000 }); await settle(p, 2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
  g = await gridState(p);
  ok(g.st.grid && !g.st.cross && g.paths > 0, "desktop: choices kept after reload");
  ok(await p.getAttribute('#atk-tools [data-ogrid="lines"]', "aria-pressed") === "true", "desktop: Grid button pressed after reload");
  // dark imagery base switches the line colour
  await p.evaluate(() => { const r = document.querySelector('input[name="ml-base"][value="sat"]'); r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); }); await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.documentElement.classList.contains("osap-gimg")), "desktop: imagery base gives light lines");
  ok(errors.length === 0, "desktop: no page errors " + errors.join(" | "));
  await ctx.close();
}

// ---------- phone, classic controls ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await p.evaluate(() => { window.OSAP_ATAK.mode(false); if (window.OSAP_TOOLS) window.OSAP_TOOLS.fold(false); }); await p.waitForTimeout(200);
  await openLayers(p);
  ok(await shown(p, '.mlctl #osap-gridrows input[data-grid="lines"]'), "phone classic: switches in the Layers panel");
  await p.check('#osap-gridrows input[data-grid="lines"]'); await p.check('#osap-gridrows input[data-grid="cross"]'); await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelector(".mlctl .mlbtn").click()); await p.waitForTimeout(150);
  const g = await gridState(p);
  ok(g.paths > 0 && await shown(p, "#osap-xhair"), "phone classic: grid and crosshair both on (spacing " + g.st.spacing + ")");
  const t0 = Date.now(); for (let i = 0; i < 6; i++) { await p.evaluate(() => window.__asapMap.panBy([120, 80], { animate: false })); await p.waitForTimeout(80); }
  await p.waitForTimeout(200); ok((await gridState(p)).paths > 0, "phone classic: grid follows the map after panning (" + (Date.now() - t0) + " ms)");
  const ms = await p.evaluate(() => { const t = performance.now(); for (let i = 0; i < 10; i++) window.OSAP_GRID.redraw(); return (performance.now() - t) / 10; });
  ok(ms < 60, "phone classic: one grid redraw takes " + ms.toFixed(1) + " ms");
  if (OUT) await p.screenshot({ path: OUT + "/grid-phone.png" });
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
