// The Esri maps (index.html ESRI_GROUPS, assets/osap-sold.js OSAP_ESRI_STYLE / OSAP_ESRI_STATIC): with the site's Esri key the
// Base map list gains every Esri map the key can use, folded under one "Esri maps" line in Layers and in the toolbar's Base
// map menu; picking one asks Esri's Basemap Styles service for that style in English with the key; with no WebGL it falls back
// to Esri's 512-pixel plain tiles of the same map; without a key none are offered. The sold version's Hybrid labels come
// from the plain imagery-labels tiles (the Location Platform has no Reference services). Nothing leaves the machine: every
// outside request is answered here or refused. Writes nothing.
// Run from the repo root: node tests/esri_basemaps_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const SOLD_JS = readFileSync("assets/osap-sold.js", "utf8");
const KEY = "TESTKEY_abcdefghijklmnopqrstuvwxyz";
const STYLE = JSON.stringify({ version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#c8d7e0" } }] });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".css": "text/css", ".webmanifest": "application/manifest+json" };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(process.cwd(), path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
let failed = 0;
const check = (ok, m) => { console.log((ok ? "PASS " : "FAIL ") + m); if (!ok) failed++; };

async function run({ sold = false, hosts = {}, webgl = true, ui = "atak" }) {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: webgl ? ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] : ["--disable-webgl", "--disable-3d-apis"] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, serviceWorkers: "block" });
  const errors = [], styles = [], stat = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    if (/^https:\/\/basemapstyles-api\.arcgis\.com\//.test(u)) { styles.push(u); return r.fulfill({ contentType: "application/json", body: STYLE, headers: { "access-control-allow-origin": "*" } }); }
    if (/^https:\/\/static-map-tiles-api\.arcgis\.com\//.test(u)) { stat.push(u); return r.fulfill({ contentType: "image/png", body: PNG, headers: { "access-control-allow-origin": "*" } }); }
    return r.abort();
  });
  const js = SOLD_JS.replace("window.OSAP_SOLD = false;", "window.OSAP_SOLD = " + sold + ";").replace("window.OSAP_SOLD_HOSTS = {};", "window.OSAP_SOLD_HOSTS = " + JSON.stringify(hosts) + ";");
  await page.route("**/assets/osap-sold.js", (r) => r.fulfill({ contentType: "text/javascript", body: js }));
  await page.addInitScript((ui) => { localStorage.setItem("osap-home", JSON.stringify("map")); localStorage.setItem("asap-map-layers", JSON.stringify({ base: "grey" })); if (ui === "classic") localStorage.setItem("osap-ui", "classic"); }, ui);
  await page.goto(base + "#th");
  await page.waitForFunction(() => window.__asapMap && window.OSAP_BASEMAP, null, { timeout: 30000 });
  await page.evaluate(() => window.__asapMap.setView([13.75, 100.5], 12, { animate: false }));
  return { browser, page, errors, styles, stat };
}
const esriIds = (page) => page.evaluate(() => window.OSAP_BASEMAP.list().filter((x) => x.group).map((x) => x.id));

// 1. no key: no Esri maps, no "Esri maps" line
{
  const t = await run({});
  const ids = await esriIds(t.page);
  const more = await t.page.evaluate(() => !!document.querySelector("#ml-panel .mlmore"));
  check(ids.length === 0 && !more, "no key: no Esri maps offered (" + ids.length + "), no Esri maps line in Layers (" + more + ")");
  await t.page.click('#atk-tools [data-atk="basemap"]');
  const esriLine = await t.page.locator('#atk-pop [data-pk="_esri"]').count();
  check(esriLine === 0, "no key: the toolbar menu has no Esri maps line");
  check(!t.errors.length, "no key: no page errors " + t.errors.slice(0, 3).join(" | "));
  await t.browser.close();
}

// 2. free version with the key, toolbar: the menu folds the Esri maps under one line, picking one loads its style
{
  const t = await run({ hosts: { esriKey: KEY } });
  const ids = await esriIds(t.page);
  check(ids.length === 33, "with the key: 33 Esri maps offered (" + ids.length + ")");
  check(["esri:arcgis/navigation", "esri:arcgis/topographic", "esri:arcgis/oceans", "esri:open/streets", "esri:open/hybrid"].every((k) => ids.includes(k)), "with the key: navigation, topographic, oceans, OSM streets and imagery with OSM labels listed");
  const core = await t.page.evaluate(() => window.OSAP_BASEMAP.list().filter((x) => !x.group).map((x) => x.id));
  check(["grey", "streets", "topo", "sat", "hybrid"].every((k) => core.includes(k)), "with the key: the main maps are unchanged (" + core.join(",") + ")");
  await t.page.click('#atk-tools [data-atk="basemap"]');
  await t.page.waitForSelector("#atk-pop:not([hidden])");
  const top = await t.page.evaluate(() => [...document.querySelectorAll("#atk-pop [data-pk]")].map((b) => b.textContent));
  check(top.some((x) => /^Esri maps \(33\)/.test(x)) && !top.includes("Navigation"), "toolbar menu: one Esri maps (33) line, the Esri maps not listed at the top (" + top.length + " lines)");
  await t.page.click('#atk-pop [data-pk="_esri"]');
  await t.page.waitForTimeout(200);
  const sub = await t.page.evaluate(() => ({ heads: [...document.querySelectorAll("#atk-pop .atk-ph")].map((h) => h.textContent), n: document.querySelectorAll("#atk-pop [data-pk^='esri:']").length, open: !document.getElementById("atk-pop").hidden,
    fits: (() => { const p = document.getElementById("atk-pop").getBoundingClientRect(), m = document.getElementById("map").getBoundingClientRect(); return p.bottom <= m.bottom + 1 && p.top >= m.top - 1; })() }));
  check(sub.open && sub.n === 33 && sub.heads.length === 5, "Esri maps menu: 33 maps under 5 headings (" + sub.heads.join(", ") + ")");
  check(sub.fits, "Esri maps menu stays inside the map (scrolls)");
  await t.page.click('#atk-pop [data-pk="esri:arcgis/navigation"]');
  await t.page.waitForTimeout(3000);
  const cur = await t.page.evaluate(() => ({ cur: window.OSAP_BASEMAP.get(), radio: (document.querySelector('input[name="ml-base"]:checked') || {}).value, saved: JSON.parse(localStorage.getItem("asap-map-layers")).base }));
  check(cur.cur === "esri:arcgis/navigation" && cur.radio === cur.cur && cur.saved === cur.cur, "picking Navigation switches the map, ticks Layers and is remembered (" + JSON.stringify(cur) + ")");
  const want = "https://basemapstyles-api.arcgis.com/arcgis/rest/services/styles/v2/styles/arcgis/navigation?language=en&token=" + KEY;
  check(t.styles.includes(want), "Navigation's style is asked in English with the key (" + t.styles.length + " style requests)");
  await t.page.click('#atk-tools [data-atk="basemap"]');
  const mark = await t.page.evaluate(() => [...document.querySelectorAll("#atk-pop .on")].map((b) => b.textContent));
  check(mark.length === 1 && /^Esri: Navigation/.test(mark[0]), "toolbar menu names the Esri map in use (" + mark.join(",") + ")");
  await t.page.click('#atk-pop [data-pk="_esri"]'); await t.page.waitForTimeout(150);
  await t.page.click('#atk-pop [data-pk="_back"]'); await t.page.waitForTimeout(150);
  const back = await t.page.locator('#atk-pop [data-pk="streets"]').count();
  check(back === 1, "Esri maps menu has a way back to the main list");
  await t.page.click('#atk-pop [data-pk="streets"]'); await t.page.waitForTimeout(1500);
  check(!t.errors.length, "with the key: no page errors " + t.errors.slice(0, 3).join(" | "));
  await t.browser.close();
}

// 3. classic controls: Layers folds the Esri maps under one line, open when one is in use
{
  const t = await run({ hosts: { esriKey: KEY }, ui: "classic" });
  await t.page.evaluate(() => window.OSAP_BASEMAP.set("esri:arcgis/oceans"));
  await t.page.waitForTimeout(500);
  const l = await t.page.evaluate(() => { const d = document.querySelector("#ml-panel .mlmore"); return d && { sum: d.querySelector("summary").textContent, n: d.querySelectorAll('input[name="ml-base"]').length, checked: (d.querySelector("input:checked") || {}).value }; });
  check(l && l.sum === "Esri maps (33)" && l.n === 33 && l.checked === "esri:arcgis/oceans", "Layers: Esri maps (33) folded line holding 33 maps, Oceans ticked (" + JSON.stringify(l) + ")");
  check(!t.errors.length, "classic: no page errors " + t.errors.slice(0, 3).join(" | "));
  await t.browser.close();
}

// 4. no WebGL: an Esri map with plain tiles falls back to them (512 px, with the key); one without plain tiles stays quiet
{
  const t = await run({ hosts: { esriKey: KEY }, webgl: false });
  await t.page.evaluate(() => window.OSAP_BASEMAP.set("esri:arcgis/streets"));
  await t.page.waitForTimeout(4000);
  const tiles = t.stat.filter((u) => /static-basemap-tiles-service\/v1\/arcgis\/streets\/static\/tile\/\d+\/\d+\/\d+\?language=en&token=TESTKEY/.test(u));
  const z = tiles.length ? +tiles[0].match(/tile\/(\d+)\//)[1] : -1, mz = await t.page.evaluate(() => window.__asapMap.getZoom());
  check(tiles.length > 0, "no WebGL: Esri Streets falls back to Esri's plain tiles with the key (" + tiles.length + ")");
  check(z === mz - 1, "no WebGL: the 512-pixel tiles are asked one level down (tile z " + z + ", map z " + mz + ")");
  await t.page.evaluate(() => window.OSAP_BASEMAP.set("esri:arcgis/terrain"));
  await t.page.waitForTimeout(1500);
  check(!t.errors.length, "no WebGL: no page errors " + t.errors.slice(0, 3).join(" | "));
  await t.browser.close();
}

// 5. sold version with the key: Hybrid's labels from the plain imagery-labels tiles; the Esri maps offered too
{
  const t = await run({ sold: true, hosts: { esriKey: KEY } });
  await t.page.evaluate(() => window.OSAP_BASEMAP.set("hybrid"));
  await t.page.waitForTimeout(2500);
  const lab = t.stat.filter((u) => /static-basemap-tiles-service\/v1\/arcgis\/imagery\/labels\/static\/tile\/.*token=TESTKEY/.test(u));
  check(lab.length > 0, "sold Hybrid: labels from Esri's imagery-labels tiles with the key (" + lab.length + ")");
  const ids = await esriIds(t.page);
  check(ids.length === 33, "sold with the key: the 33 Esri maps offered (" + ids.length + ")");
  check(!t.errors.length, "sold: no page errors " + t.errors.slice(0, 3).join(" | "));
  await t.browser.close();
}

server.close();
console.log(failed ? failed + " failed" : "all passed");
process.exit(failed ? 1 : 0);
