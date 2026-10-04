// Headless check of Terrain analysis (assets/osap-terrain.js, assets/terrain/) on a desktop and a phone. Elevation tiles are
// answered by made-up terrarium tiles, so the check is the same every run.
// The test ground round 13.75 N, 100.50 E: flat at 100 m, with a 60 m high north-south ridge about 2 km east of the centre.
// Checks: Map overlays has "Elevation and terrain analysis" with a Terrain analysis button that opens the panel; the long-press
// ring has Terrain, which lists Viewshed from here and Elevation here (100 m); a viewshed from the centre runs in the worker
// and draws the overlay, observer and horizon; ground west is visible, ground behind the ridge masked; tapping a point gives the
// line of sight card (BLOCKED, blocking terrain about 2 km, highest ground 160 m, "Urban/vegetation obstruction: NOT MODELED");
// raising the observer to 300 m recalculates at once and sees over the ridge; the headless API (profile, viewshed) agrees;
// tiles that fail make UNKNOWN ground and a coverage warning, never "not visible"; on a 360 px phone the ring's 10 labels do
// not overlap; no page errors.
// Run from the repo root: node tests/terrain_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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
const C0 = [13.75, 100.5], RIDGE = [100.5180, 100.5195];   /* about 1.95 to 2.1 km east */
function elev(lat, lon) { return lon >= RIDGE[0] && lon <= RIDGE[1] ? 160 : 100; }
const tileLon = (x, z) => x / 2 ** z * 360 - 180;
function tile(z, x, y) {
  const n = 2 ** z, rgb = Buffer.alloc(256 * 256 * 3);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
    const lon = (x + (i + 0.5) / 256) / n * 360 - 180, lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + (j + 0.5) / 256) / n))) * 180 / Math.PI;
    const v = elev(lat, lon) + 32768, k = (j * 256 + i) * 3;
    rgb[k] = Math.floor(v / 256); rgb[k + 1] = Math.floor(v) % 256; rgb[k + 2] = Math.round((v % 1) * 256) % 256;
  }
  return png(256, 256, rgb);
}

async function open(opts, failWest) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [];
  let demCalls = 0;
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    const m = u.match(/elevation-tiles-prod\/terrarium\/(\d+)\/(\d+)\/(\d+)\.png/);
    if (m) {
      demCalls++;
      /* the failing run: every tile wholly west of 100.47 E answers 500 */
      if (failWest && tileLon(+m[2] + 1, +m[1]) < 100.47) return r.fulfill({ status: 500, body: "down" });
      return r.fulfill({ status: 200, contentType: "image/png", headers: { "Access-Control-Allow-Origin": "*" }, body: tile(+m[1], +m[2], +m[3]) });
    }
    return r.abort();
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base, { waitUntil: "domcontentloaded" }); await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_TERRAIN_ANALYSIS, null, { timeout: 60000 }); await p.waitForTimeout(3000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(400);
  return { ctx, p, errors, dem: () => demCalls };
}
const TA = "window.OSAP_TERRAIN_ANALYSIS";
const settled = (p) => p.waitForFunction(() => { const s = window.OSAP_TERRAIN_ANALYSIS.state(); return !s.busy && (s.pass === "fine" || s.err); }, null, { timeout: 60000 });
const tapLos = (p, ll) => p.evaluate((ll) => window.OSAP_TERRAIN_ANALYSIS.losTo(ll).then((x) => ({ los: x.los, blockD: x.blockD, maxZ: x.maxZ, dist: x.dist, zA: x.zA })), ll);

/* ---------- desktop ---------- */
{
  const { ctx, p, errors, dem } = await open({ viewport: { width: 1366, height: 860 } });
  ok(await p.evaluate(() => !document.querySelector('#atk-tools [data-atk="terrain"]')), "desktop: no Terrain toolbar button");
  ok(await p.evaluate(() => [...document.querySelectorAll("#ml-elev .mlh")].some((h) => h.textContent === "Elevation and terrain analysis") && !!document.querySelector("#ml-elev [data-terrain-open]")),
    "desktop: Map overlays section is 'Elevation and terrain analysis' with a Terrain analysis button");
  ok(dem() === 0 && await p.evaluate(() => !window.OSAP_TERRAIN_SRC), "desktop: nothing elevation-related is downloaded before the tools are used");
  await p.evaluate(() => document.querySelector("#ml-elev [data-terrain-open]").click()); await p.waitForTimeout(200);
  ok(await p.evaluate(() => { const e = document.getElementById("terrain"); return !!e && !e.hidden && /Terrain viewshed/.test(e.textContent) && /Observer height/.test(e.textContent) && /CALCULATE/.test(e.textContent); }), "desktop: the button opens the Terrain viewshed panel");
  ok(await p.evaluate(() => document.getElementById("terrain").classList.contains("osplit")), "desktop: the panel uses the shared split view");
  await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.close());

  /* long-press ring > Terrain > Elevation here, Viewshed from here */
  await p.evaluate((c) => { window.__asapMap.setView(c, 13); window.OSAP_ATAK.ring(c[0], c[1]); }, C0); await p.waitForTimeout(200);
  ok(await p.evaluate(() => !!document.querySelector('#atk-ring [data-rk="terrain"]')), "desktop: long-press menu has Terrain");
  await p.click('#atk-ring [data-rk="terrain"]'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => { const m = document.querySelector(".leaflet-popup .vsmenu"); return !!m && /Viewshed from here/.test(m.textContent) && /Elevation here/.test(m.textContent) && document.querySelectorAll(".vsmenu").length === 1; }), "desktop: Terrain lists Viewshed from here and Elevation here, in a pop-up at the point (not the report panel)");
  await p.click('.vsmenu [data-vm="el"]');
  await p.waitForFunction(() => /m MSL|No elevation|did not/.test(document.querySelector(".vsmenu .el").textContent), null, { timeout: 20000 });
  ok(await p.evaluate(() => /\b100 m MSL/.test(document.querySelector(".vsmenu .el").textContent)), "desktop: Elevation here gives 100 m MSL (" + await p.evaluate(() => document.querySelector(".vsmenu .el").textContent.slice(0, 60)) + ")");
  await p.click('.vsmenu [data-vm="vs"]');
  await settled(p);
  let st = await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.state());
  ok(!st.err && st.stats && st.stats.visible_pct > 30 && st.stats.visible_pct < 95 && st.stats.masked > 0, "desktop: viewshed from the centre: some ground visible, ground behind the ridge masked (" + (st.stats ? st.stats.visible_pct.toFixed(1) + "% visible" : st.err) + ")");
  ok(st.grid && st.grid.res === 30 && st.grid.coverage_pct > 99.9 && st.grid.sources.some((s) => /AWS/.test(s.label)), "desktop: Standard 30 m grid from AWS tiles, coverage complete");
  ok(await p.evaluate(() => typeof window.OSAP_VS === "undefined"), "desktop: the sums ran in the background worker, not on the page");
  await p.waitForTimeout(300);
  const drawn = await p.evaluate(() => ({ img: !!document.querySelector(".leaflet-vspane-pane img.vsimg"), marks: window.OSAP_TERRAIN_ANALYSIS.state().marks }));
  ok(drawn.img && drawn.marks >= 4, "desktop: overlay image, observer, range ring and horizon are drawn " + JSON.stringify(drawn));
  const txt = await p.evaluate(() => document.getElementById("terrain").textContent);
  ok(/TERRAIN VIEWSHED/.test(txt) && /Urban\/vegetation obstruction:\s*NOT MODELED/.test(txt) && /Calculated locally/.test(txt) && /Earth curvature:\s*off/.test(txt), "desktop: the result states terrain only, not modelled obstructions, local calculation and the curvature assumption");
  ok(/Visible terrain/.test(txt) && /Terrain-masked/.test(txt) && /Unknown: no elevation data/.test(txt), "desktop: key: visible, terrain-masked, unknown");

  /* line of sight to a point */
  const east = [13.75, 100.5350], west = [13.75, 100.4700];
  let L1 = await tapLos(p, east);
  ok(L1.los === "BLOCKED" && Math.abs(L1.blockD - 1990) < 120 && Math.round(L1.maxZ) === 160 && Math.round(L1.zA) === 100, "desktop: LOS 3.8 km east is BLOCKED by the ridge about 2 km out, highest ground 160 m (" + JSON.stringify(L1) + ")");
  const card = await p.evaluate(() => (document.querySelector(".leaflet-popup .vslos") || {}).textContent || "");
  ok(await p.evaluate(() => ![...document.querySelectorAll(".pkgpop .vslos, .pkgpop .vsmenu")].length), "desktop: the line of sight card stays a pop-up on the map, not a report");
  ok(/LINE OF SIGHT/.test(card) && /Terrain LOS:\s*BLOCKED/.test(card) && /Blocking terrain:\s*1\.9\d? km from observer|Blocking terrain:\s*2\.0\d? km from observer/.test(card) && /Maximum intervening terrain:\s*160 m MSL/.test(card) && /NOT MODELED/.test(card), "desktop: the line of sight pop-up says why: " + card.replace(/\s+/g, " ").slice(0, 200));
  ok(await p.evaluate(() => /Terrain LOS/.test(document.getElementById("terrain").textContent)), "desktop: the line of sight card shows in the panel too");
  await p.evaluate(() => { const b = document.getElementById("ts-prof"); b.click(); }); await p.waitForTimeout(150);
  ok(await p.evaluate(() => !!document.querySelector("#terrain svg.prof path") && /highest ground/.test(document.getElementById("terrain").textContent)), "desktop: Show terrain profile draws the profile with the line of sight and highest ground");
  L1 = await tapLos(p, west);
  ok(L1.los === "CLEAR" && Math.abs(L1.dist - 3240) < 80, "desktop: LOS 3.2 km west is CLEAR (" + JSON.stringify(L1) + ")");
  if (OUT) await p.screenshot({ path: OUT + "/terrain-desktop.png" });

  /* observer height: changing it recalculates at once and the observer now sees over the ridge */
  const before = st.stats.visible_pct;
  await p.fill("#ts-oh", "300"); await p.waitForTimeout(700); await settled(p);
  st = await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.state());
  ok(st.stats.visible_pct > before + 5 && st.settings.obsH === 300, "desktop: observer height 300 m recalculates straight away: " + before.toFixed(1) + "% -> " + st.stats.visible_pct.toFixed(1) + "% visible");
  L1 = await tapLos(p, east);
  ok(L1.los === "CLEAR", "desktop: from 300 m up the point behind the ridge is visible");
  await p.fill("#ts-oh", "1.7"); await p.waitForTimeout(700); await settled(p);

  /* curvature: on, assumption stated */
  await p.click("#ts-refr"); await p.waitForTimeout(300); await settled(p);
  ok(await p.evaluate(() => document.getElementById("ts-curv").checked && /Earth curvature:\s*on, with atmospheric refraction \(k = 0\.13\)/.test(document.getElementById("terrain").textContent)), "desktop: refraction switches curvature on and says k = 0.13");
  await p.click("#ts-curv"); await p.waitForTimeout(300); await settled(p);

  /* the API other modules use */
  const prof = await p.evaluate((a) => window.OSAP_TERRAIN_ANALYSIS.profile(a[0], a[1], { hA: 1.7, hB: 1.7 }).then((r) => ({ los: r.los, total: r.total_m, max: r.max_elev_m, n: r.samples.length, v: r.version, nod: r.samples.some((s) => s.nodata) })), [C0, east]);
  ok(prof.los === "BLOCKED" && Math.round(prof.max) === 160 && prof.n > 50 && Math.abs(prof.total - 3800) < 80 && prof.v === "osap-terrain-analysis/1" && !prof.nod, "desktop: API profile() agrees: " + JSON.stringify(prof));
  const vs = await p.evaluate((c) => window.OSAP_TERRAIN_ANALYSIS.viewshed({ lat: c[0], lon: c[1], observer_height_m: 2, target_height_m: 2, radius_m: 3000, refraction_k: 0.25 }).then((r) => ({ n: r.n, vis: r.stats.visible_pct, k: r.assumptions.refraction_k, curv: r.assumptions.curvature, cls: r.cls.length, b: r.bounds })), C0);
  ok(vs.n > 100 && vs.cls === vs.n * vs.n && vs.vis > 30 && vs.k === 0.25 && vs.curv === true, "desktop: API viewshed() with radio refraction k = 0.25: " + JSON.stringify({ n: vs.n, vis: vs.vis, k: vs.k }));

  await settled(p);
  const both = await p.evaluate((c) => { const A = window.OSAP_TERRAIN_ANALYSIS; const pr = A.viewshed({ lat: c[0], lon: c[1], observer_height_m: 5, target_height_m: 5, radius_m: 10000, res_m: 30 }); (document.querySelector('#terrain [data-ts="calc"]') || document.querySelector('#terrain [data-ts="cancel"]')).click();
    return Promise.race([pr.then((r) => "done " + r.stats.visible_pct.toFixed(1)), new Promise((ok) => setTimeout(() => ok("hung"), 20000))]); }, C0);
  ok(/^done/.test(both), "desktop: API viewshed() from another module survives the panel recalculating at the same time (" + both + ")");
  await settled(p);
  await p.evaluate(() => document.querySelector('#terrain [data-ts="clear"]').click()); await p.waitForTimeout(200);
  ok(await p.evaluate(() => !document.querySelector(".leaflet-vspane-pane img") && window.OSAP_TERRAIN_ANALYSIS.state().marks === 0), "desktop: Clear removes the overlay and marks");
  ok(errors.length === 0, "desktop: no page errors " + JSON.stringify(errors.slice(0, 3)));
  await ctx.close();
}

/* ---------- missing elevation: UNKNOWN, never "not visible" ---------- */
{
  const { ctx, p, errors } = await open({ viewport: { width: 1366, height: 860 } }, true);
  await p.evaluate((c) => { window.__asapMap.setView(c, 13); window.OSAP_TERRAIN_ANALYSIS.viewshedAt(c); }, C0);
  await settled(p);
  const st = await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.state());
  ok(st.stats && st.stats.unknown > 0 && st.grid.coverage_pct < 99, "no data: ground with no elevation is UNKNOWN (" + (st.stats ? st.stats.unknown_pct.toFixed(1) + "% unknown, coverage " + st.grid.coverage_pct.toFixed(1) + "%" : st.err) + ")");
  ok(await p.evaluate(() => /VIEWSHED DATA WARNING/.test(document.getElementById("terrain").textContent) && /shown as UNKNOWN/.test(document.getElementById("terrain").textContent)), "no data: the panel warns with the coverage");
  const L = await tapLos(p, [13.75, 100.4560]);
  ok(L.los === "UNKNOWN", "no data: line of sight into the gap is UNKNOWN, not BLOCKED (" + L.los + ")");
  ok(errors.length === 0, "no data: no page errors " + JSON.stringify(errors.slice(0, 3)));
  await ctx.close();
}

/* ---------- phone, 360 px: the ring with Terrain; the panel in half screen ---------- */
{
  const { ctx, p, errors } = await open({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await p.evaluate((c) => { window.__asapMap.setView(c, 13); window.OSAP_ATAK.ring(c[0], c[1]); }, C0); await p.waitForTimeout(250);
  const ring = await p.evaluate(() => [...document.querySelectorAll("#atk-ring [data-rk]")].map((b) => { const s = b.querySelector("span") || b, r = s.getBoundingClientRect(); return { k: b.getAttribute("data-rk"), l: r.left, r: r.right, t: r.top, b: r.bottom }; }));
  ok(ring.length === 10 && ring.some((x) => x.k === "terrain"), "phone: ring has 10 buttons with Terrain");
  const over = [];
  const lab = ring.filter((x) => x.k !== "close");
  for (let i = 0; i < lab.length; i++) for (let j = i + 1; j < lab.length; j++) { const a = lab[i], b = lab[j]; if (a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1) over.push(a.k + "/" + b.k); }
  ok(over.length === 0, "phone: at 360 px no two ring labels overlap " + JSON.stringify(over));
  ok(ring.every((x) => x.l >= 0 && x.r <= 360), "phone: every ring label is on screen");
  if (OUT) await p.screenshot({ path: OUT + "/terrain-ring-360.png" });
  await p.click('#atk-ring [data-rk="terrain"]'); await p.waitForTimeout(200);
  await p.click('.vsmenu [data-vm="vs"]'); await settled(p);
  const ph = await p.evaluate(() => { const e = document.getElementById("terrain"), r = e.firstElementChild.getBoundingClientRect(); return { top: r.top, h: r.height, vh: innerHeight, vis: window.OSAP_TERRAIN_ANALYSIS.state().stats.visible_pct }; });
  ok(ph.top >= ph.vh * 0.45 && ph.vis > 30, "phone: the panel takes the bottom half and the map stays usable above it " + JSON.stringify(ph));
  if (OUT) await p.screenshot({ path: OUT + "/terrain-phone.png" });
  ok(errors.length === 0, "phone: no page errors " + JSON.stringify(errors.slice(0, 3)));
  await ctx.close();
}

await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
