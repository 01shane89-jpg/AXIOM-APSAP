// Headless check of Search places (the magnifying glass on the map toolbar, assets/osap-search.js on top of assets/osap-atak.js):
// nothing loads until the button is pressed; results as you type from Photon (stubbed here), biased to the map view;
// Open-Meteo answers when Photon does not; MGRS, UTM and lat/long go straight there with no network; picking a result flies
// the map there with a temporary marker that saves a named point or seeds a route; recent searches are kept.
// Run from the repo root: node tests/search_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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
const centre = (p) => p.evaluate(() => { const c = window.__asapMap.getCenter(); return [c.lat, c.lng]; });
const near = (a, b, d) => Math.abs(a[0] - b[0]) < d && Math.abs(a[1] - b[1]) < d;

const PHOTON = { type: "FeatureCollection", features: [
  { type: "Feature", geometry: { type: "Point", coordinates: [100.5018, 13.7563] }, properties: { name: "Bangkok", osm_value: "city", type: "city", country: "Thailand", state: "Bangkok", extent: [100.33, 13.95, 100.94, 13.49] } },
  { type: "Feature", geometry: { type: "Point", coordinates: [100.4930, 13.7500] }, properties: { name: "Grand Palace", osm_value: "palace", type: "house", city: "Bangkok", country: "Thailand" } }
] };
const METEO = { results: [{ name: "Chiang Mai", latitude: 18.7883, longitude: 98.9853, admin1: "Chiang Mai", country: "Thailand" }] };

async function open(opts) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [], hits = { photon: [], meteo: 0, search: 0 }, mode = { photon: "ok" };
  await ctx.route(/^https:\/\/photon\.komoot\.io\//, (r) => {
    hits.photon.push(r.request().url());
    if (mode.photon === "down") return r.fulfill({ status: 503, body: "" });
    r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(PHOTON) });
  });
  await ctx.route(/^https:\/\/geocoding-api\.open-meteo\.com\//, (r) => { hits.meteo++; r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(METEO) }); });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|photon\.komoot\.io|geocoding-api\.open-meteo\.com)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message)); p.on("dialog", (d) => d.accept());
  p.on("request", (r) => { if (/osap-search\.js/.test(r.url())) hits.search++; });
  await p.goto(base, { waitUntil: "domcontentloaded" }); await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK, null, { timeout: 60000 }); await p.waitForTimeout(3500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(400);
  return { ctx, p, errors, hits, mode };
}
// the box focuses and selects its text on the tick after it opens: typing before that loses the first key to the selection
async function type(p, text) { await p.waitForTimeout(150); await p.fill("#srch-q", ""); await p.type("#srch-q", text, { delay: 15 }); await p.waitForTimeout(450); }

// ---------- phone ----------
{
  const { ctx, p, errors, hits, mode } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  ok(await shown(p, '#atk-tools [data-atk="search"]'), "phone: magnifying glass on the map toolbar");
  ok(await p.evaluate(() => document.querySelector('#atk-tools .atk-list [data-atk]').getAttribute("data-atk") === "search"), "phone: Search is the first tool");
  ok(hits.search === 0 && !(await p.evaluate(() => !!window.OSAP_SEARCH)), "phone: nothing for search is loaded before the button is pressed");
  await p.click('#atk-tools [data-atk="search"]'); await p.waitForFunction(() => window.OSAP_SEARCH && window.OSAP_SEARCH.isOpen(), null, { timeout: 10000 });
  ok(hits.search === 1 && await shown(p, "#srch"), "phone: pressing it loads search once and opens the box");
  ok(await p.evaluate(() => document.activeElement && document.activeElement.id === "srch-q"), "phone: the box has the cursor");
  ok(await p.evaluate(() => getComputedStyle(document.getElementById("srch-q")).fontSize === "16px"), "phone: 16px input (no iPhone focus zoom)");
  const lay = await p.evaluate(() => { const s = document.getElementById("srch").getBoundingClientRect(), t = document.getElementById("atk-tools").getBoundingClientRect(), m = document.getElementById("map").getBoundingClientRect(); return { l: s.left - m.left, r: s.right, tl: t.left, w: s.width }; });
  ok(lay.l >= 0 && lay.r <= lay.tl && lay.w > 250, "phone: the box fills the width beside the toolbar " + JSON.stringify(lay));
  ok(/Type a place/.test(await p.textContent("#srch")), "phone: an empty box explains what can be typed");
  await type(p, "Bangkok");
  ok(hits.photon.length === 1, "phone: typing sends one debounced search, not one per letter (" + hits.photon.length + ")");
  ok(/[?&]lat=-?\d/.test(hits.photon[0] || "") && /[?&]lon=-?\d/.test(hits.photon[0] || ""), "phone: the search is biased to the map view");
  ok(await p.evaluate(() => document.querySelectorAll("#srch-list [data-i]").length) === 2 && /Bangkok/.test(await p.textContent("#srch-list")), "phone: results appear as you type");
  if (OUT) await p.screenshot({ path: OUT + "/phone-search.png" });
  await p.click('#srch-list [data-i="0"]'); await p.waitForTimeout(1500);
  ok(!(await shown(p, "#srch")), "phone: picking a result closes the box");
  ok(near(await centre(p), [13.72, 100.63], 0.4), "phone: the map flies to Bangkok " + JSON.stringify(await centre(p)));
  ok(await p.evaluate(() => document.querySelectorAll(".leaflet-srchpane-pane .srch-pin").length === 1), "phone: a temporary marker marks the place");
  ok(await shown(p, ".srch-pop") && /Save as point/.test(await p.textContent(".srch-pop")) && /Route to here/.test(await p.textContent(".srch-pop")), "phone: its popup offers Save as point and Route to here");
  if (OUT) await p.screenshot({ path: OUT + "/phone-result.png" });
  await p.click('.srch-pop [data-sp="save"]'); await p.waitForTimeout(300);
  const P = await p.evaluate(() => JSON.parse(localStorage.getItem("osap-atak-pts") || "[]"));
  ok(P.length === 1 && P[0].n === "Bangkok" && Math.abs(P[0].lat - 13.7563) < 1e-4, "phone: Save as point keeps a point named Bangkok " + JSON.stringify(P.map((x) => x.n)));
  ok(await p.evaluate(() => document.querySelectorAll(".leaflet-srchpane-pane .srch-pin").length === 0), "phone: the temporary marker goes once saved");
  if (await shown(p, "#pt-ed")) await p.click('#pt-ed .pt-foot [data-pe="x"]');
  // recent
  await p.click('#atk-tools [data-atk="search"]'); await p.waitForTimeout(150);
  ok(hits.search === 1, "phone: the second press does not load search again");
  ok(/Recent/.test(await p.textContent("#srch")) && /Bangkok/.test(await p.textContent("#srch-list")), "phone: recent searches show in an empty box");
  // MGRS straight there, no network
  const n0 = hits.photon.length;
  const mg = await p.evaluate(() => window.OSAP_GEO.mgrs(15.87, 100.99, 5));
  await type(p, mg); await p.keyboard.press("Enter"); await p.waitForTimeout(1500);
  ok(hits.photon.length === n0, "phone: an MGRS is read on the device, no search sent");
  ok(near(await centre(p), [15.87, 100.99], 0.01), "phone: an MGRS goes straight there (" + mg + ")");
  // lat/long and UTM
  await p.click('#atk-tools [data-atk="search"]'); await type(p, "13.75, 100.5"); await p.keyboard.press("Enter"); await p.waitForTimeout(1500);
  ok(near(await centre(p), [13.75, 100.5], 0.01), "phone: a lat/long goes straight there");
  const u = await p.evaluate(() => { const u = window.OSAP_GEO.toUtm(14.2, 101.3); return u.zone + u.band + " " + Math.round(u.e) + " " + Math.round(u.n); });
  await p.click('#atk-tools [data-atk="search"]'); await type(p, u); await p.keyboard.press("Enter"); await p.waitForTimeout(1500);
  ok(near(await centre(p), [14.2, 101.3], 0.01), "phone: a UTM goes straight there (" + u + ")");
  ok(hits.photon.length === n0, "phone: no search sent for grids");
  // Photon down: Open-Meteo answers
  mode.photon = "down";
  await p.click('#atk-tools [data-atk="search"]'); await type(p, "Chiang Mai"); await p.waitForTimeout(600);
  ok(hits.meteo >= 1 && /Chiang Mai/.test(await p.textContent("#srch-list")) && /GeoNames/.test(await p.textContent("#srch")), "phone: when Photon fails, Open-Meteo answers and says so");
  // Escape / X closes; route to here
  await p.click("#srch [data-sx]"); ok(!(await shown(p, "#srch")), "phone: the X closes the box");
  await p.click('#atk-tools [data-atk="search"]'); await type(p, "Chiang Mai"); await p.waitForTimeout(400); await p.keyboard.press("Enter"); await p.waitForTimeout(1500);
  await p.click('.srch-pop [data-sp="route"]'); await p.waitForTimeout(1500);
  ok(await p.evaluate(() => !!document.getElementById("rt-q")), "phone: Route to here opens the Route tab");
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- desktop ----------
{
  const { ctx, p, errors, hits } = await open({ viewport: { width: 1400, height: 900 } });
  await p.click('#atk-tools [data-atk="search"]'); await p.waitForFunction(() => window.OSAP_SEARCH && window.OSAP_SEARCH.isOpen(), null, { timeout: 10000 });
  const lay = await p.evaluate(() => { const s = document.getElementById("srch").getBoundingClientRect(), t = document.getElementById("atk-tools").getBoundingClientRect(); return { r: s.right, tl: t.left, w: s.width }; });
  ok(lay.r <= lay.tl && lay.w <= 362, "desktop: the box sits beside the toolbar " + JSON.stringify(lay));
  await type(p, "Bangkok");
  await p.keyboard.press("ArrowDown");
  ok(await p.evaluate(() => document.querySelector('#srch-list [data-i="1"]').getAttribute("aria-selected") === "true"), "desktop: arrow keys move through the results");
  await p.keyboard.press("Enter"); await p.waitForTimeout(1500);
  ok(near(await centre(p), [13.75, 100.493], 0.01), "desktop: Enter goes to the chosen result (Grand Palace)");
  await p.click('#atk-tools [data-atk="search"]'); await p.keyboard.press("Escape");
  ok(!(await shown(p, "#srch")), "desktop: Escape closes the box");
  ok(hits.search === 1, "desktop: search loaded once");
  if (OUT) await p.screenshot({ path: OUT + "/desktop-search.png" });
  ok(errors.length === 0, "desktop: no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
