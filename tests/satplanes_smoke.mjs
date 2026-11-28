// Headless check of Planes in the air (assets/osap-satplanes.js) in Satellite before/after: with an area drawn over the sea off
// Dubai, "Find planes in the After pass" reads the four 10 m bands (B02, B08, B03, B04) by byte ranges, runs the search in the
// worker, lists one possible aircraft with its line of travel and a speed range, draws an orange dot and line on the map, and the
// dot's pop-up shows the colour smear picture, says it is not identified and not checked against flight tracking, and names the
// rule set; an area over 30 km is refused with a reason; Clear takes the dots off; the window works on a phone. The bands are a
// real 96 x 96 px cut-out of S2B_40RCN_20261128_0_L2A (tests/fixtures/satplanes/dxb-sea, contains modified Copernicus Sentinel
// data 2026) written here as GeoTIFFs; Earth Search and the bucket are answered locally (no network).
// Run from the repo root: node tests/satplanes_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright";
const req = createRequire(import.meta.url);
const G = req("../assets/vendor/geotiff-3.0.5.js"), PL = req("../assets/osap-planes-lib.js");
const OUT = process.env.OUT || "";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();
const served = [];
const server = createServer(async (rq, res) => {
  const path = normalize(decodeURIComponent(new URL(rq.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  served.push(path);
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;

// the fixture as four 10 m UTM 40N GeoTIFFs (its place in the real tile: column 1838, row 0 of S2B_40RCN_20261128)
const FX = JSON.parse(readFileSync("tests/fixtures/satplanes/index.json", "utf8")).find((s) => s.name === "dxb-sea");
const raw = readFileSync("tests/fixtures/satplanes/dxb-sea.u16"), n = FX.w * FX.h;
const all = new Uint16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
const E0 = 313600 + FX.x0 * 10, N0 = 2832690 - FX.y0 * 10;
function tif16(a) {
  return Buffer.from(G.writeArrayBuffer(a, { width: FX.w, height: FX.h, BitsPerSample: [16], SamplesPerPixel: 1, SampleFormat: [1],
    ModelPixelScale: [10, 10, 0], ModelTiepoint: [0, 0, 0, E0, N0, 0], ProjectedCSTypeGeoKey: 32640, GTModelTypeGeoKey: 1, GTRasterTypeGeoKey: 1 }));
}
const BANDS = { "B02.tif": tif16(all.slice(0, n)), "B08.tif": tif16(all.slice(n, 2 * n)), "B03.tif": tif16(all.slice(2 * n, 3 * n)), "B04.tif": tif16(all.slice(3 * n, 4 * n)) };
const tci = new Uint8Array(n * 3).fill(20);
BANDS["TCI.tif"] = Buffer.from(G.writeArrayBuffer(tci, { width: FX.w, height: FX.h, BitsPerSample: [8, 8, 8], SamplesPerPixel: 3, PhotometricInterpretation: 2, PlanarConfiguration: 1,
  ModelPixelScale: [10, 10, 0], ModelTiepoint: [0, 0, 0, E0, N0, 0], ProjectedCSTypeGeoKey: 32640, GTModelTypeGeoKey: 1, GTRasterTypeGeoKey: 1 }));
// the area: the cut-out less a 50 m margin
const sw = PL.utmInv(E0 + 50, N0 - FX.h * 10 + 50, 40, false), ne = PL.utmInv(E0 + FX.w * 10 - 50, N0 - 50, 40, false);
const AREA = [[sw[0], sw[1]], [sw[0], ne[1]], [ne[0], ne[1]], [ne[0], sw[1]]];
const S3 = "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/40/R/CN/2026/11/S2B_40RCN_20261128_0_L2A/";
const now = Date.now();
const STAC = { type: "FeatureCollection", links: [], features: [{ type: "Feature", id: "S2B_40RCN_20261128_0_L2A",
  properties: { datetime: new Date(now - 3 * 864e5).toISOString(), "eo:cloud_cover": 0.9, platform: "sentinel-2b", "grid:code": "MGRS-40RCN", "s2:processing_baseline": "05.11" },
  assets: { visual: { href: S3 + "TCI.tif" }, red: { href: S3 + "B04.tif" }, green: { href: S3 + "B03.tif" }, blue: { href: S3 + "B02.tif" } },
  links: [{ rel: "self", href: "https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/S2B_40RCN_20261128_0_L2A" }] }] };

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const log = { bands: [], full: 0 };
async function context(opts) {
  const ctx = await browser.newContext({ serviceWorkers: "block", timezoneId: "Asia/Dubai", ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const q = r.request(), u = q.url();
    if (/^https:\/\/earth-search\.aws\.element84\.com\/v1\/search\?/.test(u)) return r.fulfill({ status: 200, contentType: "application/geo+json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(STAC) });
    if (u.startsWith(S3)) {
      const f = u.split("/").pop(), buf = BANDS[f]; if (!buf) return r.fulfill({ status: 404 });
      log.bands.push(f);
      const m = /bytes=(\d+)-(\d*)/.exec(q.headers()["range"] || "");
      if (!m) { log.full++; return r.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "image/tiff" }, body: buf }); }
      const a = +m[1], b = Math.min(buf.length - 1, m[2] ? +m[2] : buf.length - 1);
      return r.fulfill({ status: 206, headers: { "access-control-allow-origin": "*", "access-control-expose-headers": "content-range", "content-type": "image/tiff", "content-range": `bytes ${a}-${b}/${buf.length}` }, body: buf.subarray(a, b + 1) });
    }
    return r.abort();
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  return ctx;
}
async function open(ctx) {
  const p = await ctx.newPage(), errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_SAT && window.OSAP_SATPLANES && window.OSAP_PLANES_LIB, null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
  return { p, errors };
}
async function openWindow(p, area, zoom) {
  await p.evaluate(([A, z]) => { window.TSAP.areaApi.setArea(A); const la = (A[0][0] + A[2][0]) / 2, lo = (A[0][1] + A[2][1]) / 2; window.__asapMap.setView([la, lo], z, { animate: false }); }, [area, zoom]);
  await p.waitForTimeout(300);
  await p.evaluate(() => window.OSAP_SAT.open());
  await p.waitForFunction(() => window.OSAP_SAT.state().passes > 0 && window.OSAP_SAT.state().after, null, { timeout: 15000 });
}

{
  const ctx = await context({ viewport: { width: 1360, height: 860 } });
  const { p, errors } = await open(ctx);
  ok(log.bands.length === 0, "nothing read before the window is opened");
  await openWindow(p, AREA, 15);
  ok(await p.isVisible('#satba button[data-sat="planes"]') && /Planes in the air/.test(await p.textContent("#satba")), "Planes in the air row with Find planes in the After pass");
  await p.click('#satba button[data-sat="planes"]');
  await p.waitForFunction(() => window.OSAP_SATPLANES.state().done, null, { timeout: 30000 });
  const st = await p.evaluate(() => window.OSAP_SATPLANES.state());
  ok(["B02.tif", "B08.tif", "B03.tif", "B04.tif"].every((b) => log.bands.includes(b)) && log.full === 0, "read blue, near-infrared, green and red by byte ranges " + JSON.stringify([...new Set(log.bands)]));
  ok(served.includes("assets/osap-planes-worker.js"), "the search ran in the worker");
  ok(st.found.length === 1 && !st.err, "one possible aircraft found " + JSON.stringify(st.found));
  const f = st.found[0] || {};
  ok(f.lat > 25.59 && f.lat < 25.61 && f.lon > 55.18 && f.lon < 55.2 && f.pic, "placed over the sea off Dubai with its picture " + JSON.stringify([f.lat, f.lon]));
  ok(f.line >= 270 && f.line <= 285 && f.pick === -1 && f.readings.length === 2, "line of travel about 279 / 099, which way left open (no contrail): " + f.line);
  const row = await p.textContent("#satpl");
  ok(/1 possible aircraft/.test(row) && /27[89]° \/ 09[89]°/.test(row) && /kt/.test(row) && /not an identification/.test(row) && /s2planes-v1/.test(row), "window lists it with both headings, speed range and caveats: " + row.replace(/\s+/g, " ").slice(0, 200));
  ok((await p.evaluate(() => window.OSAP_SATPLANES.state().onMap)) === 1, "orange dot on the map");
  if (OUT) await p.screenshot({ path: OUT + "/satplanes-window.png" });
  await p.click('#satpl button[data-satpl="0"]');
  await p.waitForSelector(".leaflet-popup-content", { timeout: 5000 });
  const pop = await p.textContent(".leaflet-popup-content");
  ok(/Possible aircraft in flight/.test(pop) && /Not identified/.test(pop) && /flight tracking/.test(pop) && /s2planes-v1/.test(pop) && /not certain/.test(pop) && /height/.test(pop), "pop-up: possible aircraft, which way not certain, not identified, height caveat, rule set");
  ok(await p.evaluate(() => { const i = document.querySelector(".leaflet-popup-content img"); return !!i && /^data:image\/png/.test(i.src) && i.naturalWidth === 44; }), "pop-up shows the smear itself (44 x 44 px of the bands)");
  if (OUT) await p.screenshot({ path: OUT + "/satplanes-popup.png" });
  await p.click('#satpl button[data-satpl="clear"]'); await p.waitForTimeout(200);
  ok((await p.evaluate(() => window.OSAP_SATPLANES.state().onMap)) === 0, "Clear takes the dots off the map");
  // an area over 30 km is refused, with nothing read
  const bandReads = () => log.bands.filter((b) => b !== "TCI.tif").length, before = bandReads();
  await openWindow(p, [[25.3, 55.0], [25.3, 55.5], [25.7, 55.5], [25.7, 55.0]], 9);
  await p.click('#satba button[data-sat="planes"]'); await p.waitForTimeout(500);
  const big = await p.evaluate(() => window.OSAP_SATPLANES.state());
  ok(/up to 30 × 30 km/.test(big.err) && bandReads() === before, "a 50 km area is refused with the reason, nothing read: " + big.err);
  ok(errors.length === 0, "no page errors " + JSON.stringify(errors));
  await ctx.close();
}
// ---------- phone ----------
{
  const ctx = await context({ ...(await import("playwright")).devices["iPhone 13"] });
  const { p, errors } = await open(ctx);
  await openWindow(p, AREA, 15);
  await p.click('#satba button[data-sat="planes"]');
  await p.waitForFunction(() => window.OSAP_SATPLANES.state().done, null, { timeout: 30000 });
  ok((await p.evaluate(() => window.OSAP_SATPLANES.state().found.length)) === 1, "phone: one possible aircraft found");
  const fit = await p.evaluate(() => { const t = document.querySelector("#satpl table"); return t ? t.getBoundingClientRect().right <= window.innerWidth + 1 : false; });
  ok(fit, "phone: the list fits the screen width");
  if (OUT) await p.screenshot({ path: OUT + "/satplanes-phone.png" });
  ok(errors.length === 0, "phone: no page errors " + JSON.stringify(errors));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? `${fails} FAILED` : "ALL PASS");
process.exit(fails ? 1 : 0);
