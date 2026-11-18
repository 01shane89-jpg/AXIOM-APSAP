// Headless check of Map overlays > Land, sea and night lights (assets/osap-reflayers.js) and the Sea floor base map (GEBCO).
// Every outside host is answered by a made-up picture, so every run is the same.
// Checks: the section lists night lights by date, night lights 2016, land cover and nautical seamarks, all off, after
// Satellite imagery; nothing is asked before a row is switched on; night lights ask NASA GIBS for the chosen night and, with
// Compare and Flip, the earlier night; land cover asks the image service for the chosen year; seamarks ask OpenSeaMap from
// zoom 9; the Sea floor base map asks GEBCO's WMS in Web Mercator; the rows stay on when another tab opens and after a
// reload; the sold version leaves out land cover and seamarks but keeps night lights and Sea floor; no page errors.
// Run from the repo root: node tests/ref_layers_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { deflateSync } from "node:zlib";
import { chromium } from "playwright";
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
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(b) { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
function png(rgbv) {
  const w = 256, raw = Buffer.alloc((w * 3 + 1) * w);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) raw.set(rgbv, y * (w * 3 + 1) + 1 + x * 3);
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(w, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const TILE = png([60, 90, 120]);
const SOLD_JS = await readFile("assets/osap-sold.js", "utf8");

async function open(sold) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 820 } });
  const asked = { night: [], marble: 0, land: [], sea: [], gebco: [] };
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    let m = u.match(/gibs\.earthdata\.nasa\.gov\/wmts\/epsg3857\/best\/VIIRS_NOAA20_GapFilled_BRDF_Corrected_DayNightBand_Radiance\/default\/(\d{4}-\d\d-\d\d)\//);
    if (m) asked.night.push(m[1]);
    else if (/VIIRS_Black_Marble\/default\/2016-01-01\//.test(u)) asked.marble++;
    else if (/ic\.imagery1\.arcgis\.com\/arcgis\/rest\/services\/Sentinel2_10m_LandCover\/ImageServer\/exportImage/.test(u)) asked.land.push(new URL(u).searchParams.get("time"));
    else if ((m = u.match(/tiles\.openseamap\.org\/seamark\/(\d+)\//))) asked.sea.push(+m[1]);
    else if (/wms\.gebco\.net\/mapserv/.test(u)) asked.gebco.push(u);
    else return r.abort();
    return r.fulfill({ status: 200, contentType: "image/png", headers: { "Access-Control-Allow-Origin": "*" }, body: TILE });
  });
  if (sold) await ctx.route("**/assets/osap-sold.js", (r) => r.fulfill({ contentType: "text/javascript", body: SOLD_JS.replace("window.OSAP_SOLD = false;", "window.OSAP_SOLD = true;") }));
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  return { ctx, p, errors, asked };
}
async function load(p) {
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_REF_LAYERS && document.querySelector("#ml-panel #ml-ref"), null, { timeout: 60000 }); await p.waitForTimeout(1500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
}
const tick = (p, k, on) => p.evaluate(([k, on]) => { const i = document.querySelector('#ml-panel input[data-rl="' + k + '"]'); i.checked = on; i.dispatchEvent(new Event("change", { bubbles: true })); }, [k, on]);
const pick = (p, id, v) => p.evaluate(([id, v]) => { const s = document.getElementById(id); s.value = v; s.dispatchEvent(new Event("change", { bubbles: true })); }, [id, v]);

{
  const { ctx, p, errors, asked } = await open(false);
  await load(p);
  const rows = await p.evaluate(() => [...document.querySelectorAll("#ml-ref input[data-rl]")].map((i) => i.dataset.rl + (i.checked ? "+" : "")));
  ok(rows.join() === "night,marble,land,sea", "the section lists night lights by date, 2016, land cover and seamarks, all off: " + rows.join());
  ok(await p.evaluate(() => { const s = document.getElementById("ml-sat"), r = document.getElementById("ml-ref"); return !s || s.nextElementSibling === r; }), "it sits right after Satellite imagery");
  ok(!asked.night.length && !asked.marble && !asked.land.length && !asked.sea.length && !asked.gebco.length, "nothing is asked before a row is switched on");
  await p.evaluate(() => window.__asapMap.setView([13.75, 100.5], 7, { animate: false }));
  await tick(p, "night", true); await p.waitForTimeout(1500);
  const latest = await p.evaluate(() => window.OSAP_REF_LAYERS._t.latestNight());
  ok(asked.night.length > 0 && asked.night.every((d) => d === latest), "night lights ask NASA GIBS for the newest night (" + latest + ", " + asked.night.length + " tiles)");
  await pick(p, "rl-nd", "2026-06-01"); asked.night.length = 0; await p.waitForTimeout(1200);
  ok(asked.night.length > 0 && asked.night.every((d) => d === "2026-06-01"), "picking a night asks for that night");
  await pick(p, "rl-cmp", "30"); await p.waitForTimeout(300);
  ok(await p.evaluate(() => !document.getElementById("rl-flip").hidden && /2026-05-02/.test(document.getElementById("rl-flip").textContent)), "Compare one month earlier offers Flip to 2026-05-02");
  asked.night.length = 0; await p.evaluate(() => document.getElementById("rl-flip").click()); await p.waitForTimeout(1200);
  ok(asked.night.length > 0 && asked.night.every((d) => d === "2026-05-02") && /earlier night/.test(await p.evaluate(() => document.getElementById("rl-nnote").textContent)), "Flip shows the earlier night and says so");
  await p.evaluate(() => document.getElementById("rl-flip").click()); await p.waitForTimeout(300);
  ok((await p.evaluate(() => window.OSAP_REF_LAYERS.state())).shown === "2026-06-01", "Flip again goes back to the chosen night");
  await tick(p, "marble", true); await p.waitForTimeout(1000);
  ok(asked.marble > 0, "night lights 2016 ask GIBS's Black Marble 2016");
  await tick(p, "land", true); await p.waitForTimeout(1500);
  const y0 = await p.evaluate(() => window.OSAP_REF_LAYERS._t.LC_LAST);
  ok(asked.land.length > 0 && asked.land.every((t) => +t.split(",")[0] === Date.UTC(y0, 0, 1)), "land cover asks the newest year (" + y0 + ")");
  ok(await p.evaluate(() => /Built area/.test(document.getElementById("rl-opt-land").textContent) && !document.getElementById("rl-opt-land").hidden), "the land cover legend shows its classes");
  asked.land.length = 0; await pick(p, "rl-year", "2018"); await p.waitForTimeout(1500);
  ok(asked.land.length > 0 && asked.land.every((t) => +t.split(",")[0] === Date.UTC(2018, 0, 1)), "choosing 2018 asks for 2018");
  await tick(p, "sea", true); await p.waitForTimeout(1000);
  ok(asked.sea.length === 0, "seamarks wait until zoom 9");
  await p.evaluate(() => window.__asapMap.setView([13.1, 100.9], 11, { animate: false })); await p.waitForTimeout(1500);
  ok(asked.sea.length > 0 && asked.sea.every((z) => z === 11), "seamarks ask OpenSeaMap at the zoom in view");
  await p.evaluate(() => { const s = document.getElementById("rl-op"); s.value = "0.5"; s.dispatchEvent(new Event("input", { bubbles: true })); });
  ok(await p.evaluate(() => Math.abs(+getComputedStyle(document.querySelector(".osap-rl-land")).opacity - 0.5) < 0.01 && +getComputedStyle(document.querySelector(".osap-rl-sea")).opacity === 1), "opacity sets land and night layers, seamarks stay solid");
  /* Sea floor base map */
  ok(await p.evaluate(() => window.OSAP_BASEMAP.list().some((b) => b.id === "seafloor" && /GEBCO/.test(b.note))), "Sea floor is offered as a base map");
  await p.evaluate(() => window.OSAP_BASEMAP.set("seafloor")); await p.waitForTimeout(1500);
  const g = asked.gebco.length ? new URL(asked.gebco[0]).searchParams : null;
  ok(g && /GEBCO_LATEST/i.test(g.get("layers") || g.get("LAYERS")) && /3857/.test(g.get("srs") || g.get("SRS")) && /GetMap/i.test(g.get("request") || g.get("REQUEST")), "Sea floor asks GEBCO's WMS for Web Mercator squares (" + asked.gebco.length + ")");
  /* another tab, then a reload */
  const tab0 = await p.evaluate(() => document.documentElement.getAttribute("data-view"));
  await p.evaluate((t) => document.querySelector('#view-seg [data-view="' + (t === "alerts" ? "timeline" : "alerts") + '"]').click(), tab0); await p.waitForTimeout(1200);
  ok(await p.evaluate(() => document.querySelectorAll("#ml-ref input[data-rl]:checked").length === 4), "the rows stay on when another tab opens");
  await load(p);
  const st = await p.evaluate(() => window.OSAP_REF_LAYERS.state());
  ok(st.layers.length === 4 && st.year === 2018 && st.night === "2026-06-01" && st.cmp === 30 && Math.abs(st.op - 0.5) < 0.01 && await p.evaluate(() => window.OSAP_BASEMAP.get()) === "seafloor", "they come back after a reload: " + JSON.stringify(st));
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
{
  const { ctx, p, errors } = await open(true);
  await load(p);
  const rows = await p.evaluate(() => [...document.querySelectorAll("#ml-ref input[data-rl]")].map((i) => i.dataset.rl));
  ok(rows.join() === "night,marble", "sold version: night lights only, no land cover (Esri public service) or seamarks (volunteer server): " + rows.join());
  ok(await p.evaluate(() => window.OSAP_BASEMAP.list().some((b) => b.id === "seafloor")), "sold version keeps the Sea floor base map (GEBCO, public domain)");
  ok(errors.length === 0, "sold version: no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
