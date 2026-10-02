// Headless check of the landing zone finder (assets/osap-lz.js) on a desktop and a phone. Elevation tiles and OpenStreetMap
// (Overpass) are answered by made-up test data, so the check is the same every run; tools/lz_live.mjs checks the real hosts.
// The test ground round 13.75 N, 100.50 E: flat at 100 m with a steep slope east of 100.512 E, a forest to the north-west,
// a village to the south with a sports pitch in it, open farmland with a house in the middle, a lake, a power line running
// north-south, and a mapped helipad.
// Checks: no toolbar button; the long-press "Find LZ" and Area > Landing zones open it; a search finds candidates, every one
// outside forest, village, lake and the steep ground, clear of the power line and the house by at least the LZ radius;
// the pitch inside the village is found; each candidate pop-up says "candidate from open data, verify on the ground" and
// gives an MGRS grid; the helipad is listed; a bigger LZ finds fewer; a failed Overpass request is reported as a failure
// with no candidates; the distance transform matches brute force; closing removes the marks; no page errors.
// Run from the repo root: node tests/lz_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { deflateSync } from "node:zlib";
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

/* ---------- made-up elevation: terrarium PNG tiles ---------- */
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(b) { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const EAST = 100.512;
function elev(lat, lon) { return 100 + (lon > EAST ? (lon - EAST) * 108000 * 0.35 : 0); }   /* about 19 degrees east of EAST */
function tile(z, x, y) {
  const n = 2 ** z, rgb = Buffer.alloc(256 * 256 * 3);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
    const lon = (x + (i + 0.5) / 256) / n * 360 - 180, lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + (j + 0.5) / 256) / n))) * 180 / Math.PI;
    const v = elev(lat, lon) + 32768, k = (j * 256 + i) * 3;
    rgb[k] = Math.floor(v / 256); rgb[k + 1] = Math.floor(v) % 256; rgb[k + 2] = Math.round((v % 1) * 256) % 256;
  }
  return png(256, 256, rgb);
}

/* ---------- made-up OpenStreetMap ---------- */
const box = (s, w, n, e) => [{ lat: s, lon: w }, { lat: s, lon: e }, { lat: n, lon: e }, { lat: n, lon: w }, { lat: s, lon: w }];
const C0 = [13.75, 100.5];
const LINE_LON = 100.5035;
const HOUSE = [13.7485, 100.4930];
const OSM = { elements: [
  { type: "way", id: 1, tags: { landuse: "forest" }, geometry: box(13.752, 100.484, 13.766, 100.4985) },
  { type: "way", id: 2, tags: { landuse: "residential", name: "Test Village" }, geometry: box(13.733, 100.488, 13.7445, 100.507) },
  { type: "way", id: 3, tags: { leisure: "pitch", sport: "soccer" }, geometry: box(13.7383, 100.4965, 13.7400, 100.4983) },
  { type: "way", id: 4, tags: { landuse: "farmland" }, geometry: box(13.7455, 100.484, 13.7515, 100.502) },
  { type: "way", id: 5, tags: { building: "house" }, geometry: box(HOUSE[0] - 0.0001, HOUSE[1] - 0.0001, HOUSE[0] + 0.0001, HOUSE[1] + 0.0001) },
  { type: "way", id: 6, tags: { natural: "water" }, geometry: box(13.7525, 100.5045, 13.757, 100.5105) },
  { type: "way", id: 7, tags: { power: "line", voltage: "115000" }, geometry: [{ lat: 13.744, lon: LINE_LON }, { lat: 13.768, lon: LINE_LON }] },
  { type: "node", id: 8, lat: 13.7505, lon: 100.5005, tags: { aeroway: "helipad", name: "Test Pad" } }
] };
const inBox = (p, s, w, n, e) => p[0] >= s && p[0] <= n && p[1] >= w && p[1] <= e;
const metres = (a, b) => { const r = Math.PI / 180, x = (b[1] - a[1]) * r * Math.cos((a[0] + b[0]) / 2 * r), y = (b[0] - a[0]) * r; return Math.hypot(x, y) * 6371008.8; };

async function open(opts, osmFail) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [];
  let overpassCalls = 0;
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    const m = u.match(/elevation-tiles-prod\/terrarium\/(\d+)\/(\d+)\/(\d+)\.png/);
    if (m) return r.fulfill({ status: 200, contentType: "image/png", headers: { "Access-Control-Allow-Origin": "*" }, body: tile(+m[1], +m[2], +m[3]) });
    if (/\/api\/interpreter/.test(u)) { overpassCalls++; return osmFail ? r.fulfill({ status: 504, body: "busy" }) : r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(OSM) }); }
    return r.abort();
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base, { waitUntil: "domcontentloaded" }); await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK, null, { timeout: 60000 }); await p.waitForTimeout(3500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(400);
  return { ctx, p, errors, calls: () => overpassCalls };
}
const done = (p) => p.waitForFunction(() => window.OSAP_LZ && !window.OSAP_LZ.state().busy && (window.OSAP_LZ.state().res || window.OSAP_LZ.state().err), null, { timeout: 60000 });

/* ---------- desktop ---------- */
{
  const { ctx, p, errors } = await open({ viewport: { width: 1366, height: 860 } });
  /* no toolbar button (the toolbar already overflows on phones): Find LZ in the long-press menu and Area > Landing zones */
  ok(await p.evaluate(() => !document.querySelector('#atk-tools [data-atk="lz"]') && !window.OSAP_LZ), "desktop: no LZ toolbar button, and the finder is not loaded until used");
  await p.evaluate((c) => { window.__asapMap.setView(c, 14); window.OSAP_ATAK.ring(c[0], c[1]); }, [13.9, 100.6]); await p.waitForTimeout(200);
  ok(await p.evaluate(() => !!document.querySelector('#atk-ring [data-rk="lz"]')), "desktop: long-press menu has Find LZ");
  await p.evaluate(() => window.OSAP_ATAK.close());
  await p.evaluate(() => (window.OSAP_AREA_TOOLS || []).filter((t) => t.id === "lz")[0].run());
  await p.waitForFunction(() => window.OSAP_LZ && window.OSAP_LZ.isOpen(), null, { timeout: 15000 });
  ok(await p.evaluate(() => { const c = document.getElementById("lz-card"); return !!c && !c.hidden && /Draw an area first/.test(c.textContent) && /Find landing zones/.test(c.textContent); }), "desktop: Landing zones with no area drawn opens the card and asks for an area");

  /* distance transform against brute force on a small random grid */
  ok(await p.evaluate(() => {
    const w = 23, h = 17, b = new Uint8Array(w * h); let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < b.length; i++) b[i] = rnd() < 0.08 ? 1 : 0;
    const d = window.OSAP_LZ.edt(b, w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let m = Infinity; for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (b[j * w + i]) m = Math.min(m, (i - x) ** 2 + (j - y) ** 2);
      if (Math.abs(d[y * w + x] - m) > 1e-6) return false;
    }
    return true;
  }), "desktop: distance transform matches brute force");
  ok(await p.evaluate(() => { const f = window.OSAP_LZ.obCls; return f({ power: "line" })[0] === 3 && f({ building: "yes" })[0] === 1 && f({ landuse: "forest" })[0] === 2 && f({ landuse: "farmland" }) === null && window.OSAP_LZ.surfCls({ leisure: "pitch" }) === 3; }), "desktop: obstacle and surface classes");
  ok(await p.evaluate(() => !/maxsize/.test(window.OSAP_LZ.query([13.7, 100.4, 13.8, 100.6]))), "desktop: Overpass query declares no [maxsize]");

  await p.evaluate((c) => window.OSAP_LZ.at(c), C0);
  await done(p);
  const st = await p.evaluate(() => { const s = window.OSAP_LZ.state(); return { err: s.err, cands: s.res ? s.res.cands.map((k) => ({ lat: k.lat, lon: k.lon, clearD: k.clearD, mean: k.mean, max: k.max, near: k.near, surface: k.surface })) : [], pads: s.res ? s.res.pads : [] }; });
  ok(!st.err && st.cands.length >= 3, "desktop: search finds candidates (" + st.cands.length + ")" + (st.err ? " " + st.err : ""));
  const R = 50;
  const bad = st.cands.filter((k) => { const p0 = [k.lat, k.lon];
    return inBox(p0, 13.752, 100.484, 13.766, 100.4985) || (inBox(p0, 13.733, 100.488, 13.7445, 100.507) && !inBox(p0, 13.7383, 100.4965, 13.7400, 100.4983)) ||
      inBox(p0, 13.7525, 100.5045, 13.757, 100.5105) || k.lon > EAST - 0.0003; });
  ok(bad.length === 0, "desktop: no candidate in forest, village, lake or steep ground " + JSON.stringify(bad));
  const nearLine = st.cands.filter((k) => k.lat > 13.744 && k.lat < 13.768 && metres([k.lat, k.lon], [k.lat, LINE_LON]) < R + 10);
  ok(nearLine.length === 0, "desktop: every candidate is clear of the power line by the LZ radius plus its margin " + JSON.stringify(nearLine));
  ok(st.cands.every((k) => metres([k.lat, k.lon], HOUSE) >= R + 10), "desktop: every candidate is clear of the house");
  ok(st.cands.some((k) => inBox([k.lat, k.lon], 13.7383, 100.4965, 13.7400, 100.4983)), "desktop: the sports pitch inside the village is found " + JSON.stringify(st.cands.map((k) => [+k.lat.toFixed(4), +k.lon.toFixed(4), k.clearD, +k.mean.toFixed(1)])));
  ok(st.cands.some((k) => k.surface === "Farmland"), "desktop: a candidate on the farmland says so");
  ok(st.cands.every((k) => k.clearD >= 100 && k.max <= 7.01), "desktop: every candidate is at least 100 m clear with slope within 7 degrees");
  ok(st.cands.some((k) => k.near.some((o) => o.n === "Power or cable line")), "desktop: nearby power line is reported in a candidate");
  ok(await p.evaluate(() => /Only 1 building is mapped/.test(document.getElementById("lz-card").textContent)), "desktop: thin building mapping is warned about");
  ok(st.pads.length === 1 && st.pads[0].name === "Test Pad", "desktop: mapped helipad is listed");
  ok(await p.evaluate(() => document.querySelectorAll(".leaflet-lzpane-pane path.leaflet-interactive").length >= 3), "desktop: candidate circles are drawn on the map");
  await p.click("#lz-card li[data-lzi='0']"); await p.waitForTimeout(500);
  const pop = await p.evaluate(() => { const e = document.querySelector(".leaflet-popup-content"); return e ? e.textContent : ""; });
  ok(/candidate from open data, verify on the ground/.test(pop), "desktop: pop-up says candidate from open data, verify on the ground");
  ok(/Grid:\s*47P\s?[A-Z]{2}\s?\d{5}\s?\d{5}/.test(pop), "desktop: pop-up gives an MGRS grid (" + (pop.match(/Grid:[^C]*/) || [""])[0].trim() + ")");
  ok(/Slope:.*average.*steepest/.test(pop) && /Clear ground: about \d+ m across/.test(pop), "desktop: pop-up gives slope and clear size");
  ok(await p.evaluate(() => !!document.querySelector(".leaflet-popup-content [data-keep-pop] [data-lzcopy]")), "desktop: pop-up keeps its Copy button");
  await p.check("#lz-mask"); await p.waitForTimeout(300);
  ok(await p.evaluate(() => !!document.querySelector(".leaflet-lzpane-pane img.lzmask")), "desktop: Show blocked ground draws the mask");
  if (OUT) await p.screenshot({ path: OUT + "/lz-desktop.png" });

  /* a two-ship LZ (250 m) needs more room: fewer or equal candidates, each 250 m clear */
  await p.selectOption("#lz-d", "250"); await p.click('#lz-card [data-lz="find"]'); await done(p);
  const big = await p.evaluate(() => window.OSAP_LZ.state().res.cands.map((k) => k.clearD));
  ok(big.length <= st.cands.length && big.every((d) => d >= 250), "desktop: a 250 m LZ finds " + big.length + ", each at least 250 m clear");
  await p.selectOption("#lz-d", "100");

  /* Area menu: Landing zones searches inside the drawn area */
  ok(await p.evaluate(() => (window.OSAP_AREA_TOOLS || []).some((t) => t.id === "lz" && t.label === "Landing zones")), "desktop: Area menu offers Landing zones");
  await p.evaluate(() => window.TSAP.areaApi.setArea([[13.745, 100.484], [13.752, 100.484], [13.752, 100.5025], [13.745, 100.5025]])); await p.waitForTimeout(300);
  await p.evaluate(() => window.OSAP_AREA_TOOLS.filter((t) => t.id === "lz")[0].run()); await p.waitForTimeout(200); await done(p);
  const ar = await p.evaluate(() => window.OSAP_LZ.state().res.cands.map((k) => [k.lat, k.lon]));
  ok(ar.length >= 1 && ar.every((q) => inBox(q, 13.745, 100.484, 13.752, 100.5025)), "desktop: area search keeps candidates inside the drawn area (" + ar.length + ")");

  ok(await p.evaluate(() => { const c = document.getElementById("lz-card").getBoundingClientRect(), m = window.__asapMap.getContainer().getBoundingClientRect(); return !!document.querySelector("#lz-dock.osplit #lz-card") && Math.abs(c.right - innerWidth) < 2 && Math.abs(c.top - Math.max(0, m.top)) < 2 && c.width <= 482; }), "desktop: split view docks the card on the right, under the header");
  ok(await p.evaluate(() => { const pad = window.OSAP_SPLIT.clear(document.getElementById("lz-dock")), m = window.__asapMap, b = m.getBounds(); return window.OSAP_LZ.state().res.cands.every((k) => { const pt = m.latLngToContainerPoint([k.lat, k.lon]); return pt.x >= pad.tl[0] && pt.x <= m.getSize().x - pad.br[0]; }); }), "desktop: every candidate is in the part of the map the panel leaves clear");
  await p.click('#lz-card [data-lz="close"]'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.querySelectorAll(".leaflet-lzpane-pane path, .leaflet-lzpane-pane img").length === 0 && document.getElementById("lz-card").hidden), "desktop: Close removes the card and the marks");
  ok(errors.length === 0, "desktop: no page errors " + errors.join(" | "));
  await ctx.close();
}

/* ---------- phone, long-press, and a failed Overpass request ---------- */
{
  const { ctx, p, errors, calls } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, true);
  await p.evaluate((c) => { window.__asapMap.setView(c, 14); window.OSAP_ATAK.ring(c[0], c[1]); }, C0); await p.waitForTimeout(300);
  ok(await p.evaluate(() => !!document.querySelector('#atk-ring [data-rk="lz"]')), "phone: long-press menu has Find LZ");
  await p.evaluate(() => document.querySelector('#atk-ring [data-rk="lz"]').click());
  await p.waitForFunction(() => window.OSAP_LZ, null, { timeout: 15000 }); await done(p);
  const st = await p.evaluate(() => { const s = window.OSAP_LZ.state(); return { err: s.err, res: !!s.res }; });
  ok(!st.res && /OpenStreetMap obstacles did not load/.test(st.err) && calls() >= 4, "phone: failed Overpass (all hosts) is reported as a failure, no candidates: " + st.err);
  /* split view (the default): the card is the bottom half of the screen, the map above it stays usable */
  ok(await p.evaluate(() => { const c = document.getElementById("lz-card"), d = c.closest("#lz-dock"), r = c.getBoundingClientRect(); return !!d && d.classList.contains("osplit") && !d.hidden && r.top >= innerHeight * 0.45 - 2 && Math.abs(r.bottom - innerHeight) < 2 && r.left === 0; }), "phone: split view puts the card in the bottom half");
  ok(await p.evaluate(() => { const b = document.querySelector("#lz-card [data-osplit]"); return !!b && b.textContent === "Full window"; }), "phone: the card has a Full window switch");
  await p.click("#lz-card [data-osplit]"); await p.waitForTimeout(200);
  ok(await p.evaluate(() => { const c = document.getElementById("lz-card"); return c.classList.contains("lzdock") && c.closest(".leaflet-bottom.leaflet-left") !== null && document.getElementById("lz-dock").hidden && localStorage.getItem("osap.split") === "0"; }), "phone: Full window puts the card back on the map and is remembered");
  ok(await p.evaluate(() => { const c = document.getElementById("lz-card").getBoundingClientRect(), t = document.getElementById("atk-tools").getBoundingClientRect(); return c.left >= 0 && c.right <= t.left; }), "phone: the card fits beside the toolbar");
  ok(await p.evaluate(() => document.querySelector("#lz-card [data-osplit]").textContent === "Half screen"), "phone: the switch then offers Half screen");
  await p.click("#lz-card [data-osplit]"); await p.waitForTimeout(200);
  ok(await p.evaluate(() => !document.getElementById("lz-dock").hidden && !!document.querySelector("#lz-dock #lz-card")), "phone: Half screen docks it again");
  await p.evaluate(() => window.OSAP_LZ.close());
  ok(await p.evaluate(() => document.getElementById("lz-dock").hidden), "phone: Close hides the docked panel");
  if (OUT) await p.screenshot({ path: OUT + "/lz-phone.png" });
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}

await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
