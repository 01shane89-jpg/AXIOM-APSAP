// Open data panel (index.html showOpenData / xFigures), sold-version replacements (2026-11-07): Key figures show WHO health
// figures and fall back to the World Bank copy (wdi-health) where WHO has none; aircraft over the country come from OSAP's
// own sweep (air-count) with OpenSky as a second row; GPS interference from OSAP's own map (gnss-own); UN sanctions counts;
// and the panel's rain radar overlay draws the national radar networks (OSAP_WX.radarLayer), never RainViewer.
// Every data file and outside request is answered by the test. Writes nothing.
// Run from the repo root: node tests/opendata_figures_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp" };
const root = process.cwd();
const XF = { asof: "2026-11-07 16:00Z", globals: {}, feeds: {
  "who-gho": { id: "who-gho", name: "WHO GHO", org: "WHO", cat: "Health", nc: true, ok: true },
  "wdi-health": { id: "wdi-health", name: "Health (World Bank)", org: "World Bank", cat: "Health", ok: true },
  "air-count": { id: "air-count", name: "Aircraft (OSAP sweep)", org: "OSAP", cat: "Aviation", ok: true },
  opensky: { id: "opensky", name: "OpenSky", org: "OpenSky", cat: "Aviation", nc: true, ok: true },
  "gnss-own": { id: "gnss-own", name: "GNSS (OSAP)", org: "OSAP", cat: "Aviation", ok: true },
  "un-sanctions": { id: "un-sanctions", name: "UN list", org: "UN", cat: "Sanctions", ok: true } } };
const XC = { th: { asof: "2026-11-07 16:00Z", items: [], figures: {
  "who-gho": { life_expectancy_years: { value: 76.4, year: 2023 } },
  "wdi-health": { life_expectancy_years: { value: 79, year: 2024 }, under5_mortality_per_1000: { value: 8.1, year: 2024 } },
  "air-count": { airborne: 412, military: 7, asof: "2026-11-07T15:45:00Z" }, opensky: { airborne: 380 },
  "gnss-own": { cells: 3, from: "2026-11-06T16:00:00Z", to: "2026-11-07T16:00:00Z" },
  "un-sanctions": { entries: 5, individuals: 4, entities: 1 } } } };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  if (path === "data/live/x/feeds.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); return res.end("window.OSAP_XF=" + JSON.stringify(XF) + ";"); }
  if (path === "data/live/x/th.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); return res.end("window.OSAP_XC=window.OSAP_XC||{};window.OSAP_XC.th=" + JSON.stringify(XC.th) + ";"); }
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1300, height: 850 } });
const nat = [], rv = [];
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
  const url = r.request().url();
  if (/rainviewer/.test(url)) rv.push(url);
  if (/geo\.weather\.gc\.ca|nowcoast\.noaa\.gov\/geoserver\/observations|maps\.dwd\.de|openwms\.fmi\.fi|knmi|jmatile/.test(url)) { nat.push(url); return r.fulfill({ status: 200, contentType: /json$/.test(url) ? "application/json" : "image/png", body: /json$/.test(url) ? "[]" : PNG }); }
  return r.abort();
});
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.OSAP_XF && window.OSAP_XC && window.OSAP_XC.th && window.__asapMap && window.OSAP_WX, null, { timeout: 60000 });
await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
await p.evaluate(() => window.__asapMap.setView([13.75, 100.5], 6, { animate: false }));
await p.evaluate(() => { const b = document.querySelector('#view-seg [data-view="opendata"]'); if (b) b.click(); });
await p.waitForFunction(() => /Key figures/.test((document.getElementById("rail-sof") || {}).textContent || ""), null, { timeout: 20000 });
const rows = await p.evaluate(() => [...document.querySelectorAll("#rail-sof table.reg tr")].map((tr) => [...tr.children].map((c) => c.textContent.trim())));
const row = (re) => rows.find((r) => re.test(r[0] || ""));
ok(row(/Life expectancy/) && row(/Life expectancy/)[1] === "76.4", "WHO value shown where WHO has one (" + JSON.stringify(row(/Life expectancy/)) + ")");
ok(row(/Under-5/) && row(/Under-5/)[1] === "8.1" && row(/Under-5/)[2] === "2024", "World Bank value shown where WHO has none (" + JSON.stringify(row(/Under-5/)) + ")");
ok(row(/^Aircraft airborne over the country \(7 military\)/) && row(/^Aircraft airborne over the country \(7/)[1] === "412", "aircraft count from OSAP's own sweep, with military count (" + JSON.stringify(row(/7 military/)) + ")");
ok(!!row(/\(OpenSky\)/), "OpenSky kept as a second row");
ok(row(/GPS interference, last 24 h/) && row(/GPS interference, last 24 h/)[1] === "3", "GPS interference cells from OSAP's own map");
ok(row(/UN Security Council/) && /5 \(4 people, 1 entity\)/.test(row(/UN Security Council/)[1]), "UN sanctions counts (" + JSON.stringify(row(/UN Security/)) + ")");
await p.evaluate(() => { const c = document.getElementById("x-radar"); if (c && !c.checked) c.click(); });
await p.waitForTimeout(2500);
const lbl = await p.evaluate(() => (document.querySelector('label[for="x-radar"]') || {}).textContent || "");
ok(/national radar/i.test(lbl) && !/RainViewer/.test(lbl), "radar overlay label names national radar (" + lbl + ")");
ok(nat.length > 0 && rv.length === 0, "radar overlay asks the national networks (" + nat.length + "), never RainViewer (" + rv.length + ")");
ok(!errors.length, "no page errors " + errors.slice(0, 2).join(" | "));
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
