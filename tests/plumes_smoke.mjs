// Headless check of Pollution plumes (assets/osap-plumes.js): a row inside Map overlays > Satellite imagery switches on the
// Sentinel-5P NO2 or SO2 layer from NASA GIBS for the newest published day (from DescribeDomains), in its own pane under the
// markers; "Same day 30 days earlier" swaps to the layer 30 days before; the date picker cannot pass the newest day; the legend
// and the "never confirms" note are shown; nothing is fetched while it is off; the choice survives a reload; it fits a phone.
// Every GIBS request is answered here with made-up data (no network). The real layer ids, DescribeDomains and legend links were
// checked against gibs.earthdata.nasa.gov on 2026-11-18 (data through 2026-11-13).
// Run from the repo root: node tests/plumes_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium, devices } from "playwright";
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
const PNG = await readFile(join(root, "assets/logo-mark.png"));
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="40"><rect width="300" height="40" fill="#c33"/></svg>';
const NEWEST = "2026-11-13";
const DD = `<Domains><DimensionDomain><ows:Identifier>time</ows:Identifier><Domain>2026-10-19/${NEWEST}/P1D</Domain></DimensionDomain></Domains>`;
const CORS = { "access-control-allow-origin": "*" };
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
let log;
async function context(opts) {
  log = { dd: [], tiles: [], legend: [] };
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    if (/^https:\/\/gibs\.earthdata\.nasa\.gov\/wmts\/epsg3857\/best\/1\.0\.0\/TROPOMI_.*\.xml$/.test(u)) { log.dd.push(u); return r.fulfill({ status: 200, contentType: "text/xml", headers: CORS, body: DD }); }
    if (/^https:\/\/gibs\.earthdata\.nasa\.gov\/wmts\/epsg3857\/best\/TROPOMI_/.test(u)) { log.tiles.push(u); return r.fulfill({ status: 200, contentType: "image/png", headers: CORS, body: PNG }); }
    if (u.startsWith("https://gibs.earthdata.nasa.gov/legends/")) { log.legend.push(u); return r.fulfill({ status: 200, contentType: "image/svg+xml", headers: CORS, body: SVG }); }
    return r.abort();
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  return ctx;
}
async function open(p) {
  await p.goto(base, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_PLUME && document.getElementById("ml-plume"), null, { timeout: 60000 });
  await p.waitForTimeout(1500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
  await p.evaluate(() => window.__asapMap.setView([29.4, 48.0], 6, { animate: false })); await p.waitForTimeout(300);
}
// ---------- helpers (pure) ----------
{
  const ctx = await context({ viewport: { width: 1360, height: 860 } });
  const p = await ctx.newPage(), errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await open(p);
  const t = await p.evaluate(() => { const T = window.OSAP_PLUME._t; return [T.shiftDay("2026-11-13", -30), T.shiftDay("2026-03-01", -1), T.shiftDay("bad", 1), T.domainEnd("<Domain>2026-10-19/2026-11-13/P1D</Domain>"), T.domainEnd("<Domain>2026-10-01/2026-10-05/P1D,2026-10-09/2026-10-12/P1D</Domain>"), T.domainEnd("nothing")]; });
  ok(t[0] === "2026-10-14" && t[1] === "2026-02-28" && t[2] === "", "shiftDay: 30 days back, month edge, bad input (" + t.slice(0, 3).join(",") + ")");
  ok(t[3] === "2026-11-13" && t[4] === "2026-10-12" && t[5] === "", "domainEnd reads the last published day (" + t.slice(3).join(",") + ")");
  // ---------- off by default, asks nothing ----------
  await p.evaluate(() => window.OSAP_ATAK.overlays("overlays")); await p.waitForTimeout(400);
  ok(await p.evaluate(() => { const s = document.getElementById("ml-sat"), r = document.getElementById("ml-plume"); return !!(s && r && s.contains(r)); }), "row sits inside Map overlays > Satellite imagery");
  ok(log.dd.length + log.tiles.length === 0 && await p.evaluate(() => !window.OSAP_PLUME.on() && !window.OSAP_PLUME.layer()), "off by default: nothing fetched, no layer");
  ok(await p.evaluate(() => [...document.querySelectorAll("#ml-plume .plctl button, #plume-day")].every((b) => b.disabled)), "controls disabled while off");
  // ---------- switch on ----------
  await p.click('#ml-plume [data-plume="on"]');
  await p.waitForFunction((d) => window.OSAP_PLUME.state().day === d, NEWEST, { timeout: 10000 });
  await p.waitForTimeout(1200);
  const s1 = await p.evaluate(() => window.OSAP_PLUME.state());
  ok(s1.on && s1.gas === "no2" && s1.newest === NEWEST && s1.shown === NEWEST, "on: NO2 for the newest published day " + JSON.stringify(s1));
  ok(log.dd.length === 1 && /TROPOMI_L2_Nitrogen_Dioxide_Tropospheric_Column\/default\/GoogleMapsCompatible_Level6\/all\//.test(log.dd[0]), "asked DescribeDomains once for NO2");
  ok(log.tiles.length > 0 && log.tiles.every((u) => u.includes("TROPOMI_L2_Nitrogen_Dioxide_Tropospheric_Column/default/" + NEWEST + "/GoogleMapsCompatible_Level6/")), "tiles for the newest day (" + log.tiles.length + ")");
  ok(await p.evaluate(() => document.querySelectorAll(".leaflet-plumepane-pane img.leaflet-tile").length > 0 && +getComputedStyle(document.querySelector(".leaflet-plumepane-pane")).zIndex < 400), "tiles in their own pane under the markers");
  const st1 = await p.textContent("#plume-st");
  ok(/Nitrogen dioxide/.test(st1) && st1.includes(NEWEST) && /newest published/.test(st1) && /cloud/.test(st1), "status names gas, day and gaps: " + st1.trim().slice(0, 90));
  ok(/never confirms/.test(await p.textContent("#ml-plume")) && /Copernicus Sentinel data/.test(await p.textContent("#ml-plume")), "never-confirms note and Copernicus credit in the row");
  ok(await p.evaluate(() => /Contains modified Copernicus Sentinel data 2026/.test(document.querySelector(".leaflet-control-attribution").innerHTML)), "map attribution credits Copernicus with the year");
  ok(log.legend.some((u) => /OMI_Nitrogen_Dioxide_Tropo_Column_H\.svg$/.test(u)) && await p.evaluate(() => !document.getElementById("plume-lg").hidden), "NO2 colour scale shown");
  ok(await p.evaluate((d) => document.getElementById("plume-day").max === d, NEWEST), "date picker stops at the newest published day");
  if (OUT) await p.screenshot({ path: OUT + "/plumes-no2.png" });
  // ---------- 30 days earlier ----------
  log.tiles = [];
  await p.click("#plume-cmp"); await p.waitForTimeout(1000);
  const s2 = await p.evaluate(() => window.OSAP_PLUME.state());
  ok(s2.cmp && s2.shown === "2026-10-14" && log.tiles.length > 0 && log.tiles.every((u) => u.includes("/default/2026-10-14/")), "Same day 30 days earlier: 2026-10-14 tiles");
  ok(/Back to 2026-11-13/.test(await p.textContent("#plume-cmp")) && await p.getAttribute("#plume-cmp", "aria-pressed") === "true" && /30 days before 2026-11-13/.test(await p.textContent("#plume-st")), "button and status say it is the earlier day");
  await p.click("#plume-cmp"); await p.waitForTimeout(300);
  ok(await p.evaluate(() => window.OSAP_PLUME.state().shown) === NEWEST, "back to the newest day");
  // ---------- SO2 ----------
  log.tiles = [];
  await p.click('#ml-plume [data-plume-gas="so2"]'); await p.waitForTimeout(1200);
  ok(log.dd.length === 2 && /TROPOMI_L2_Sulfur_Dioxide_Total_Vertical_Column/.test(log.dd[1]) && log.tiles.length > 0 && log.tiles.every((u) => u.includes("TROPOMI_L2_Sulfur_Dioxide_Total_Vertical_Column/default/" + NEWEST + "/")), "SO2 tiles for its newest day");
  ok(await p.evaluate(() => document.querySelectorAll(".leaflet-plumepane-pane .leaflet-layer").length === 1), "one plume layer at a time");
  ok(await p.getAttribute('#ml-plume [data-plume-gas="so2"]', "aria-pressed") === "true" && log.legend.some((u) => /OMI_SO2_Lower_Troposphere_H\.svg$/.test(u)), "SO2 pressed and its colour scale shown");
  // ---------- date picker ----------
  await p.fill("#plume-day", "2026-11-01"); await p.dispatchEvent("#plume-day", "change"); await p.waitForTimeout(300);
  ok(await p.evaluate(() => window.OSAP_PLUME.state().shown) === "2026-11-01", "picking a day shows that day");
  await p.evaluate(() => { const i = document.getElementById("plume-day"); i.value = "2026-12-30"; i.dispatchEvent(new Event("change", { bubbles: true })); }); await p.waitForTimeout(300);
  ok(await p.evaluate(() => window.OSAP_PLUME.state().shown) === NEWEST, "a day past the newest falls back to the newest");
  // ---------- reload keeps the choice; off removes the layer ----------
  await p.reload({ waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.OSAP_PLUME && window.OSAP_PLUME.layer(), null, { timeout: 60000 });
  ok(await p.evaluate(() => { const s = window.OSAP_PLUME.state(); return s.on && s.gas === "so2"; }), "reload keeps on + SO2 (this browser only)");
  await p.evaluate(() => window.OSAP_PLUME.set(false)); await p.waitForTimeout(200);
  ok(await p.evaluate(() => !window.OSAP_PLUME.layer() && !document.querySelector(".leaflet-plumepane-pane .leaflet-layer") && document.getElementById("plume-lg").hidden), "off removes the layer and legend");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
// ---------- GIBS DescribeDomains down: falls back, still draws ----------
{
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1360, height: 860 } });
  let tiles = 0;
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { const u = r.request().url(); if (/\.xml$/.test(u)) return r.fulfill({ status: 503, headers: CORS, body: "down" }); if (/TROPOMI_/.test(u)) { tiles++; return r.fulfill({ status: 200, contentType: "image/png", headers: CORS, body: PNG }); } return r.abort(); });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("osap-plume", JSON.stringify({ on: true, gas: "no2" })); } catch (e) {} });
  const p = await ctx.newPage(), errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await open(p); await p.waitForTimeout(1200);
  const s = await p.evaluate(() => window.OSAP_PLUME.state());
  const g = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10);
  ok(s.on && s.newest === "" && s.shown === g && tiles > 0 && errors.length === 0, "DescribeDomains down: shows 5 days ago (" + s.shown + ") without errors");
  await ctx.close();
}
// ---------- phone ----------
{
  const ctx = await context({ ...devices["iPhone 13"] });
  const p = await ctx.newPage();
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-plume", JSON.stringify({ on: true, gas: "no2" })); } catch (e) {} });
  await open(p);
  await p.evaluate(() => window.OSAP_ATAK.overlays("overlays")); await p.waitForTimeout(600);
  await p.evaluate(() => document.getElementById("ml-plume").scrollIntoView()); await p.waitForTimeout(300);
  const fit = await p.evaluate(() => { const r = document.getElementById("ml-plume"); const bs = [...r.querySelectorAll(".plctl button, #plume-day")]; return { over: r.scrollWidth - r.clientWidth, minH: Math.min(...bs.map((b) => b.getBoundingClientRect().height)), lg: (r.querySelector(".pllg img") || { getBoundingClientRect: () => ({ width: 0 }) }).getBoundingClientRect().width <= r.clientWidth + 1 }; });
  ok(fit.over <= 1 && fit.minH >= 44 && fit.lg, "phone: row fits, controls at least 44 px, legend fits " + JSON.stringify(fit));
  if (OUT) await p.screenshot({ path: OUT + "/plumes-phone.png" });
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
