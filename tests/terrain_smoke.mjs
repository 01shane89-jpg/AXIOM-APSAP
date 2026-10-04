// Headless check of Terrain analysis (assets/osap-terrain.js, assets/terrain/) on a desktop and a phone. Elevation tiles are
// answered by made-up terrarium tiles, so the check is the same every run.
// The test ground round 13.75 N, 100.50 E: flat at 100 m, with a 60 m high north-south ridge about 2 km east of the centre.
// Checks: Map overlays has "Elevation and terrain analysis" with a Terrain analysis button that opens the panel; the long-press
// ring has Terrain, which lists Viewshed from here and Elevation here (100 m); a viewshed from the centre runs in the worker
// and draws the overlay, observer and horizon; ground west is visible, ground behind the ridge masked; tapping a point gives the
// line of sight card (BLOCKED, blocking terrain about 2 km, highest ground 160 m, "Urban/vegetation obstruction: NOT MODELED");
// raising the observer to 300 m recalculates at once and sees over the ridge; the headless API (profile, viewshed) agrees;
// the reverse viewshed swaps the heights and its tap card runs from the tapped observer to the point; the skyline chart shows
// the ridge to the east; Line of sight from here sets A and the next tap B (BLOCKED by the ridge, recalculated when A's height
// changes); Measure's Profile gives A to B for two points and the elevation profile (climb, descent) for a path, none for a
// closed shape; modules' OSAP_PROFILE_EXT sections get the profile;
// a viewshed saves under a name with the agreed fields, its visible ground as polygons and its horizon; toggles in the panel
// and Map overlays agree; rename, recalculate (kept in place) and delete (asks first); the workspace lists it and its KML
// carries the observer, polygons and horizon; after a reload it is drawn from the stored shapes with nothing downloaded;
// terrain saved from Offline maps and data runs the viewshed with no signal (OFFLINE, DEM cached, nothing downloaded), finer
// detail than saved is enlarged and said so, outside it says there is no elevation, and Delete clears it;
// Slope shades the ground in five bands (the ridge's sides over 30 degrees) and a tap gives the slope there; route exposure
// (corridor) finds the ground that can see a route and shows it under the line of sight result;
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
  const net = { off: false };
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    const m = u.match(/elevation-tiles-prod\/terrarium\/(\d+)\/(\d+)\/(\d+)\.png/);
    if (m) {
      if (net.off) return r.abort("internetdisconnected");
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
  return { ctx, p, errors, dem: () => demCalls, net };
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

/* ---------- reverse viewshed, line of sight A to B, Measure's Profile, skyline, the profile hook ---------- */
{
  const { ctx, p, errors } = await open({ viewport: { width: 1366, height: 860 } });
  const east = [13.75, 100.5350], west = [13.75, 100.4700];
  /* a module adds a section under the profile */
  await p.evaluate(() => { window.OSAP_PROFILE_EXT = [{ id: "test", label: "Test section", render: (box, pr) => { box.appendChild(document.createTextNode("ext got " + pr.samples.length + " samples, los " + pr.los)); } }]; });
  await p.evaluate((c) => { window.__asapMap.setView(c, 13); window.OSAP_ATAK.ring(c[0], c[1]); }, C0); await p.waitForTimeout(200);
  await p.click('#atk-ring [data-rk="terrain"]'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => ["vs", "rv", "lo", "el"].every((k) => document.querySelector('.vsmenu [data-vm="' + k + '"]'))), "tools: Terrain lists Viewshed, Reverse viewshed, Line of sight and Elevation here");
  await p.click('.vsmenu [data-vm="rv"]'); await settled(p);
  let st = await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.state());
  let txt = await p.evaluate(() => document.getElementById("terrain").textContent);
  ok(st.mode === "rev" && st.stats && st.stats.masked > 0 && /Reverse viewshed/.test(txt) && /REVERSE TERRAIN VIEWSHED/.test(txt) && /Can see the point/.test(txt) && /heights swapped/.test(txt), "reverse: the panel says Reverse viewshed, its key and the swapped heights (" + (st.stats ? st.stats.visible_pct.toFixed(1) + "% can see" : st.err) + ")");
  /* the point at 1.7 m, observers at 20 m: the swap must show (with 1.7 m everywhere the two would match) */
  await p.fill("#ts-oh", "20"); await p.waitForTimeout(700); await settled(p);
  const revPct = (await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.state())).stats.visible_pct;
  let L1 = await tapLos(p, east);
  const rcard = await p.evaluate(() => (document.querySelector(".leaflet-popup .vslos") || {}).textContent || "");
  ok(/Observer here\s*→\s*The point/.test(rcard) && /Observer elevation:\s*100 m MSL\s*\+ 20 m/.test(rcard) && /Point elevation:\s*100 m MSL\s*\+ 1\.7 m/.test(rcard), "reverse: the tap card runs from an observer at the tapped point (20 m) to the point (1.7 m): " + rcard.replace(/\s+/g, " ").slice(0, 160));
  ok(L1.los === "BLOCKED" && Math.abs(L1.blockD - 1690) < 120, "reverse: from 3.8 km east the ridge blocks the point, about 1.7 km from the observer (" + JSON.stringify(L1) + ")");
  ok(await p.evaluate(() => !!document.querySelector("#terrain svg.sky path") && /SKYLINE/.test(document.getElementById("terrain").textContent)), "skyline: the chart is drawn under the result");
  ok(/towards (8\d|9\d|10\d)°/.test(await p.evaluate(() => document.getElementById("terrain").textContent)), "skyline: the highest ground is towards the east (the ridge)");
  /* the reverse result is the viewshed from the point at its own height (1.7 m) with 20 m targets */
  const api = await p.evaluate((c) => window.OSAP_TERRAIN_ANALYSIS.viewshed({ lat: c[0], lon: c[1], observer_height_m: 1.7, target_height_m: 20, radius_m: 10000, res_m: 30 }).then((r) => r.stats.visible_pct), C0);
  const api2 = await p.evaluate((c) => window.OSAP_TERRAIN_ANALYSIS.viewshed({ lat: c[0], lon: c[1], observer_height_m: 20, target_height_m: 1.7, radius_m: 10000, res_m: 30 }).then((r) => r.stats.visible_pct), C0);
  await settled(p);
  const both = await p.evaluate((c) => { const A = window.OSAP_TERRAIN_ANALYSIS; const pr = A.viewshed({ lat: c[0], lon: c[1], observer_height_m: 5, target_height_m: 5, radius_m: 10000, res_m: 30 }); (document.querySelector('#terrain [data-ts="calc"]') || document.querySelector('#terrain [data-ts="cancel"]')).click();
    return Promise.race([pr.then((r) => "done " + r.stats.visible_pct.toFixed(1)), new Promise((ok) => setTimeout(() => ok("hung"), 20000))]); }, C0);
  ok(/^done/.test(both), "API: a viewshed() call from another module survives the panel recalculating at the same time (" + both + ")");
  await settled(p);
  ok(Math.abs(api - revPct) < 0.05 && Math.abs(api2 - revPct) > 0.05, "reverse: equals the viewshed with the heights swapped (" + revPct.toFixed(2) + "% = " + api.toFixed(2) + "%, unswapped " + api2.toFixed(2) + "%)");
  await p.click('#terrain [data-mode="vs"]'); await settled(p);
  await p.fill("#ts-oh", "1.7"); await p.waitForTimeout(700); await settled(p);

  /* line of sight A to B: the ring entry sets A, the next tap B */
  await p.evaluate((c) => window.OSAP_TERRAIN_ANALYSIS.losFrom(c), C0); await p.waitForTimeout(200);
  st = await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.state());
  ok(st.mode === "los" && st.arm === "pickB" && st.line.pts.length === 1, "line of sight: from here sets A and waits for B");
  await p.evaluate((ll) => window.__asapMap.fire("click", { latlng: window.L.latLng(ll[0], ll[1]) }), east);
  await p.waitForFunction(() => { const s = window.OSAP_TERRAIN_ANALYSIS.state(); return !s.busy && (s.line.result || s.err); }, null, { timeout: 30000 });
  st = await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.state());
  txt = await p.evaluate(() => document.getElementById("terrain").textContent);
  ok(st.line.result && st.line.result.los === "BLOCKED" && Math.abs(st.line.result.block_m - 1990) < 120 && Math.round(st.line.result.max_elev_m) === 160, "line of sight: A to B 3.8 km east is BLOCKED by the ridge (" + JSON.stringify(st.line.result && { los: st.line.result.los, b: st.line.result.block_m, max: st.line.result.max_elev_m }) + ")");
  ok(/Point A\s*→\s*Point B/.test(txt) && /Blocking terrain:\s*(1\.9\d?|2\.0\d?) km from A/.test(txt) && /TERRAIN LINE OF SIGHT/.test(txt) && /NOT MODELED/.test(txt) && !!(await p.evaluate(() => document.querySelector("#terrain svg.prof path"))), "line of sight: card, profile and assumptions in the panel");
  ok(/ext got \d+ samples, los BLOCKED/.test(txt) && /Test section/.test(txt), "profile hook: OSAP_PROFILE_EXT gets the profile");
  ok(st.marks >= 3, "line of sight: A, B and the line are on the map (" + st.marks + " marks)");
  await p.fill("#ts-oh", "300"); await p.waitForTimeout(800);
  await p.waitForFunction(() => { const s = window.OSAP_TERRAIN_ANALYSIS.state(); return !s.busy && s.line.result && s.line.result.los === "CLEAR"; }, null, { timeout: 30000 }).catch(() => {});
  ok((await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.state().line.result.los)) === "CLEAR", "line of sight: A at 300 m recalculates at once and clears the ridge");
  await p.fill("#ts-oh", "1.7"); await p.waitForTimeout(800);

  /* Measure: Profile shows for a line, gives A to B for two points and the path profile for three */
  await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.close());
  await p.evaluate((pts) => { window.OSAP_MEASURE.on(true); window.OSAP_MEASURE.set(pts, false); }, [west, east]); await p.waitForTimeout(200);
  ok(await p.evaluate(() => !!document.querySelector('#meas-card [data-m="profile"]')), "measure: a two-point line has a Profile button");
  await p.click('#meas-card [data-m="profile"]');
  await p.waitForFunction(() => { const s = window.OSAP_TERRAIN_ANALYSIS.state(); return !s.busy && (s.line.result || s.err); }, null, { timeout: 30000 });
  st = await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.state());
  ok(st.line.result && st.line.result.los === "BLOCKED" && Math.abs(st.line.result.total_m - 7040) < 120, "measure: Profile on two points is the line of sight A to B (" + (st.line.result && st.line.result.los + ", " + Math.round(st.line.result.total_m) + " m") + ")");
  await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.close());
  await p.evaluate((pts) => { window.OSAP_MEASURE.on(true); window.OSAP_MEASURE.set(pts, false); }, [west, C0, east]); await p.waitForTimeout(200);
  await p.click('#meas-card [data-m="profile"]');
  await p.waitForFunction(() => { const s = window.OSAP_TERRAIN_ANALYSIS.state(); return !s.busy && (s.line.result || s.err); }, null, { timeout: 30000 });
  st = await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.state());
  txt = await p.evaluate(() => document.getElementById("terrain").textContent);
  ok(st.line.result && st.line.result.los === null && st.line.result.vertices.length === 3 && /Elevation profile/.test(txt) && /ELEVATION PROFILE/.test(txt) && /3 points from Measure/.test(txt), "measure: Profile on three points is the elevation profile along the path");
  ok(/Highest:\s*160 m MSL/.test(txt) && /Lowest:\s*100 m MSL/.test(txt) && /Climb:\s*60 m/.test(txt) && /Descent:\s*60 m/.test(txt), "path profile: highest, lowest, climb and descent over the ridge: " + (txt.match(/Lowest[^.]*?Descent:\s*\d+ m/) || [""])[0]);
  ok(/ext got \d+ samples, los null/.test(txt), "profile hook: also under a path profile");
  await p.evaluate(() => { window.OSAP_MEASURE.set([[13.75, 100.47], [13.75, 100.48], [13.76, 100.48]], true); }); await p.waitForTimeout(150);
  ok(await p.evaluate(() => !document.querySelector('#meas-card [data-m="profile"]')), "measure: a closed shape has no Profile button");
  await p.evaluate(() => window.OSAP_MEASURE.on(false));
  if (OUT) await p.screenshot({ path: OUT + "/terrain-path-profile.png" });
  /* Clear in line of sight mode */
  await p.evaluate(() => document.querySelector('#terrain [data-ts="clear"]').click()); await p.waitForTimeout(200);
  ok(await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.state().marks === 0), "line of sight: Clear removes A, B and the line");
  ok(errors.length === 0, "tools: no page errors " + JSON.stringify(errors.slice(0, 3)));
  await ctx.close();
}

/* ---------- saved viewsheds: save, toggles, rename, recalculate, delete, workspace, KML ---------- */
{
  const { ctx, p, errors, dem } = await open({ viewport: { width: 1366, height: 860 } });
  await p.evaluate((c) => { window.__asapMap.setView(c, 13); window.OSAP_TERRAIN_ANALYSIS.viewshedAt(c); }, C0);
  await settled(p);
  ok(await p.evaluate(() => !!document.querySelector('#terrain [data-ts="save"]') && document.getElementById("ts-name").value === "Viewshed 01"), "save: a finished result offers Save viewshed, named Viewshed 01");
  await p.fill("#ts-name", "Ridge watch");
  await p.click('#terrain [data-ts="save"]'); await p.waitForTimeout(200);
  let saved = await p.evaluate(() => JSON.parse(localStorage.getItem("osap-viewsheds") || "[]"));
  const v = saved[0] || {};
  ok(saved.length === 1 && v.name === "Ridge watch" && v.type === "viewshed" && v.mode === "viewshed" && v.observer && Math.abs(v.observer.lat - 13.75) < 1e-4 && v.observer.height_m === 1.7 && v.target_height_m === 1.7 && v.radius_m === 10000 &&
    v.terrain_resolution_m === 30 && v.curvature === false && v.dem_source === "OSAP DEM" && v.terrain_model === "DEM (terrain only)" && v.engine === "osap-viewshed/1" && v.result && v.result.visible_pct > 30 && /^\d{4}-\d\d-\d\dT/.test(v.created),
    "save: stored in osap-viewsheds with the agreed fields: " + JSON.stringify({ name: v.name, obs: v.observer, r: v.radius_m, res: v.terrain_resolution_m, dem: v.dem_detail, result: v.result }));
  const geo = await p.evaluate((vv) => {
    function inR(p, r) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
    function vis(p) { return vv.visible.some((q) => inR(p, q.o) && !(q.h || []).some((h) => inR(p, h))); }
    return { n: vv.visible.length, verts: vv.visible.reduce((a, q) => a + q.o.length + (q.h || []).reduce((b, h) => b + h.length, 0), 0), west: vis([13.75, 100.47]), east: vis([13.75, 100.535]), hz: vv.horizon.length, bytes: JSON.stringify(vv).length };
  }, v);
  ok(geo.n >= 1 && geo.west && !geo.east && geo.verts < 4000 && geo.hz > 50, "save: the visible ground is stored as polygons (west of the ridge inside, behind it outside) with the horizon line: " + JSON.stringify(geo));
  ok(await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.state().savedMarks >= 3), "save: the saved viewshed is drawn on the map");
  ok(await p.evaluate(() => /Saved as\s*Ridge watch/.test(document.getElementById("terrain").textContent) && /SAVED VIEWSHEDS \(1\)/.test(document.getElementById("terrain").textContent)), "save: the panel says where it went and lists it");
  ok(await p.evaluate(() => { const b = document.querySelector('#ml-viewsheds [data-vson]'); return !!b && b.checked && /Ridge watch/.test(document.getElementById("ml-viewsheds").textContent); }), "Map overlays: the saved viewshed is listed with an on toggle");
  /* toggle off from Map overlays */
  await p.evaluate(() => document.querySelector('#ml-viewsheds [data-vson]').click()); await p.waitForTimeout(150);
  ok(await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.state().savedMarks === 0 && JSON.parse(localStorage.getItem("osap-viewsheds"))[0].on === false && !document.querySelector('#terrain [data-vson]').checked), "toggle: off in Map overlays hides it and the panel follows");
  await p.evaluate(() => document.querySelector('#terrain [data-vson]').click()); await p.waitForTimeout(150);
  ok(await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.state().savedMarks >= 3), "toggle: on again in the panel");
  /* a second one, a reverse viewshed: names do not clash */
  await p.click('#terrain [data-mode="rev"]'); await settled(p);
  ok(await p.evaluate(() => document.getElementById("ts-name").value === "Reverse viewshed 01"), "save: a reverse viewshed gets its own name");
  await p.click('#terrain [data-ts="save"]'); await p.waitForTimeout(200);
  saved = await p.evaluate(() => JSON.parse(localStorage.getItem("osap-viewsheds") || "[]"));
  ok(saved.length === 2 && saved[1].mode === "reverse", "save: two saved viewsheds, the second reverse");
  /* rename */
  await p.click(`#terrain [data-vsren="${saved[1].id}"]`); await p.fill(`#terrain [data-vsrenin="${saved[1].id}"]`, "Who sees the CP"); await p.press(`#terrain [data-vsrenin="${saved[1].id}"]`, "Enter"); await p.waitForTimeout(150);
  ok(await p.evaluate(() => JSON.parse(localStorage.getItem("osap-viewsheds"))[1].name === "Who sees the CP" && /Who sees the CP/.test(document.getElementById("ml-viewsheds").textContent)), "rename: the name changes everywhere");
  /* recalculate the first: the saved record is replaced, same id */
  await p.click(`#terrain [data-vsopen="${saved[0].id}"]`); await p.waitForTimeout(100);
  ok(await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.state().mode === "vs"), "recalculate: reopens in Viewshed mode");
  await settled(p); await p.waitForTimeout(200);
  saved = await p.evaluate(() => JSON.parse(localStorage.getItem("osap-viewsheds") || "[]"));
  ok(saved.length === 2 && saved[0].name === "Ridge watch" && saved[0].calculated >= saved[0].created, "recalculate: worked out again and kept in place (" + saved[0].calculated + ")");
  /* workspace and KML */
  const ws = await p.evaluate(() => { const I = window.OSAP_WS.items(); return { n: I.vs.length, names: I.vs.map((x) => x.name), kml: window.OSAP_WS.kml() }; });
  ok(ws.n === 2 && ws.names.includes("Ridge watch"), "workspace: My work > Workspaces lists the saved viewsheds");
  ok(/<Folder><name>Viewsheds<\/name>/.test(ws.kml) && /<Folder><name>Viewshed visible terrain<\/name>/.test(ws.kml) && /<Folder><name>Viewshed horizons<\/name>/.test(ws.kml) && /NOT MODELED/.test(ws.kml) && /Ridge watch: visible terrain/.test(ws.kml), "KML: observer with its settings, visible terrain polygons and horizon lines");
  ok(await p.evaluate(() => { const d = new DOMParser().parseFromString(window.OSAP_WS.kml(), "application/xml"); return !d.getElementsByTagName("parsererror").length && d.getElementsByTagName("Polygon").length >= 1; }), "KML: well-formed, with polygons");
  /* delete asks once more */
  await p.click(`#terrain [data-vsdel="${saved[1].id}"]`); await p.waitForTimeout(100);
  ok(await p.evaluate(() => JSON.parse(localStorage.getItem("osap-viewsheds")).length === 2 && /Delete: sure\?/.test(document.getElementById("terrain").textContent)), "delete: asks first");
  await p.click(`#terrain [data-vsdel="${saved[1].id}"]`); await p.waitForTimeout(150);
  ok(await p.evaluate(() => JSON.parse(localStorage.getItem("osap-viewsheds")).length === 1), "delete: removed on the second tap");
  /* after a reload the saved one is drawn straight away from its stored shapes, with nothing downloaded */
  await p.reload({ waitUntil: "domcontentloaded" }); await p.waitForFunction(() => window.OSAP_TERRAIN_ANALYSIS, null, { timeout: 60000 }); await p.waitForTimeout(2000);
  const d0 = dem();
  ok(await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.state().savedMarks >= 3 && /Ridge watch/.test(document.getElementById("ml-viewsheds").textContent)), "reload: the saved viewshed is back on the map and in Map overlays");
  await p.waitForTimeout(500);
  ok(dem() === d0 && await p.evaluate(() => !window.OSAP_TERRAIN_SRC), "reload: drawn from the stored shapes, no elevation downloaded");
  if (OUT) await p.screenshot({ path: OUT + "/terrain-saved.png" });
  ok(errors.length === 0, "saved: no page errors " + JSON.stringify(errors.slice(0, 3)));
  await ctx.close();
}

/* ---------- offline terrain: saved from Offline maps and data, used with no signal ---------- */
{
  const { ctx, p, errors, dem, net } = await open({ viewport: { width: 1366, height: 860 } });
  await p.evaluate((c) => window.__asapMap.setView(c, 12), C0); await p.waitForTimeout(300);
  await p.evaluate(() => window.OSAP_OFFLINE.open()); await p.waitForTimeout(200);
  ok(await p.evaluate(() => /Terrain for viewshed and line of sight/.test(document.getElementById("offdlg").textContent) && !!document.querySelector("#offdlg [data-off-tdl]")), "offline: Offline maps and data has a Terrain section with Download terrain");
  await p.selectOption("#offdlg [data-off-tz]", "13");
  const est = await p.evaluate(() => document.getElementById("off-terrain").textContent.match(/([\d,]+) elevation tiles, about ([\d.]+ [KM]B)/));
  await p.click("#offdlg [data-off-tdl]");
  await p.waitForFunction(() => /Terrain saved/.test((document.querySelector("#offdlg .offmsg") || {}).textContent || ""), null, { timeout: 60000 });
  const tp = await p.evaluate(() => { const r = JSON.parse(localStorage.getItem("osap-terrain-offline")); return r.packs.th && r.packs.th.areas[0]; });
  const nCached = await p.evaluate(() => caches.open("osap-terrain").then((c) => c.keys()).then((k) => k.length));
  ok(tp && tp.z === 13 && tp.n > 20 && nCached === tp.n && est && +est[1].replace(/,/g, "") === tp.n, "offline: " + tp.n + " zoom 13 elevation tiles saved (" + (est && est[2]) + " estimated), listed and cached (" + nCached + ")");
  await p.evaluate(() => document.querySelector("#offdlg .x").click());
  /* the app's own files come from the service worker's copy when offline; here (no service worker) load them first, far away */
  await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.profile([15.5, 102.5], [15.51, 102.5]));
  /* no signal */
  await ctx.setOffline(true); net.off = true; const d0 = dem();
  await p.evaluate((c) => { window.OSAP_TERRAIN_ANALYSIS.open(); }, C0);
  await p.selectOption("#ts-km", "5");
  await p.evaluate((c) => window.OSAP_TERRAIN_ANALYSIS.viewshedAt(c), C0); await settled(p);
  let st = await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.state());
  let txt = await p.evaluate(() => document.getElementById("terrain").textContent);
  ok(!st.err && st.grid && st.grid.coverage_pct > 99.9 && st.grid.sources.map((x) => x.id).join() === "saved-dem" && st.stats.masked > 0, "offline: the viewshed runs from the saved terrain alone, coverage complete (" + (st.err || st.grid.sources.map((x) => x.id).join()) + ")");
  ok(/OFFLINE TERRAIN VIEWSHED/.test(txt) && /DEM:\s*cached on this device/.test(txt) && /Calculated locally/.test(txt) && dem() === d0, "offline: the result says OFFLINE, DEM cached, calculated locally; nothing downloaded");
  /* finer than saved: enlarged from the saved zoom 13, and said so */
  await p.click('#terrain [data-res="high"]'); await p.selectOption("#ts-km", "1"); await settled(p);
  st = await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.state());
  txt = await p.evaluate(() => document.getElementById("terrain").textContent);
  ok(!st.err && st.grid.coverage_pct > 99.9 && st.grid.sources.some((x) => x.id === "saved-dem-coarse") && /coarser than asked/.test(txt), "offline: High detail with only zoom 13 saved uses it enlarged and says so (" + (st.err || st.grid.sources.map((x) => x.id).join()) + ")");
  /* outside the saved area: no elevation, a clear message */
  await p.click('#terrain [data-res="std"]');
  await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.viewshedAt([14.6, 101.5])); await settled(p);
  st = await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.state());
  ok(/No elevation for this place on this device/.test(st.err || ""), "offline: outside the saved terrain it says there is no elevation here and no connection (" + st.err + ")");
  await ctx.setOffline(false); net.off = false;
  /* delete */
  const left = await p.evaluate(() => window.OSAP_OFFLINE.terrain.remove("th", JSON.parse(localStorage.getItem("osap-terrain-offline")).packs.th.areas[0].id).then(() => caches.open("osap-terrain").then((c) => c.keys()).then((k) => [k.length, localStorage.getItem("osap-terrain-offline")])));
  ok(left[0] === 0 && left[1] === null, "offline: Delete removes the saved terrain and its record " + JSON.stringify(left));
  ok(errors.length === 0, "offline: no page errors " + JSON.stringify(errors.slice(0, 3)));
  await ctx.close();
}

/* ---------- slope and route exposure ---------- */
{
  const { ctx, p, errors } = await open({ viewport: { width: 1366, height: 860 } });
  await p.evaluate((c) => { window.__asapMap.setView(c, 13); window.OSAP_TERRAIN_ANALYSIS.open(); }, C0);
  await p.click('#terrain [data-mode="slope"]'); await p.waitForTimeout(150);
  ok(await p.evaluate(() => /Terrain slope/.test(document.getElementById("terrain").textContent) && !!document.querySelector("#terrain [data-ts=pick]")), "slope: the Slope tool opens with a centre to pick");
  await p.click('#terrain [data-ts="centre"]');
  await p.waitForFunction(() => { const s = window.OSAP_TERRAIN_ANALYSIS.state(); return !s.busy && (s.slope || s.err); }, null, { timeout: 60000 });
  let st = await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.state());
  ok(!st.err && st.slope && st.slope.pct[0] > 80 && st.slope.pct[4] > 0 && st.slope.unk_pct === 0, "slope: flat ground is 0-3 degrees and the ridge's sides over 30 (" + (st.slope ? st.slope.pct.map((x) => x.toFixed(1)).join("/") : st.err) + ")");
  ok(st.slope && st.slope.k === 1, "slope: measured across +-1 cell (about +-30 m) on the Standard grid");
  await p.waitForTimeout(300);
  ok(await p.evaluate(() => !!document.querySelector(".leaflet-vspane-pane img.vsimg")), "slope: the slope picture is drawn");
  const flat = await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.slopeAt([13.75, 100.49]));
  const edge = await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.slopeAt([13.75, 100.5180]));
  ok(flat && flat.slope_deg < 1 && Math.round(flat.elev_m) === 100, "slope: flat ground reads under 1 degree, 100 m (" + JSON.stringify(flat) + ")");
  ok(edge && edge.slope_deg > 30 && /very steep/.test(edge.band), "slope: the ridge's side reads over 30 degrees, very steep (" + (edge && edge.slope_deg.toFixed(1)) + ")");
  ok(await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.slopeAt([14.5, 100.5]) === null), "slope: outside the area there is no answer");
  const pt = await p.evaluate(() => { const m = window.__asapMap, q = m.latLngToContainerPoint([13.75, 100.5180]), r = m.getContainer().getBoundingClientRect(); return [r.left + q.x, r.top + q.y]; });
  await p.mouse.click(pt[0], pt[1]); await p.waitForTimeout(300);
  const pop = await p.evaluate(() => (document.querySelector(".leaflet-popup .vslos") || {}).textContent || "");
  ok(/SLOPE/.test(pop) && /grade/.test(pop) && /not a survey/.test(pop), "slope: a tap shows the slope there: " + pop.replace(/\s+/g, " ").slice(0, 120));
  const txt = await p.evaluate(() => document.getElementById("terrain").textContent);
  ok(/TERRAIN SLOPE/.test(txt) && /NOT MODELED/.test(txt) && /landing zone finder/.test(txt) && /0–3°/.test(txt) && /over 30°/.test(txt), "slope: key with the five bands and the method and assumptions");

  /* route exposure: the API */
  const route = [[13.73, 100.50], [13.77, 100.50]];
  const C = await p.evaluate((r) => window.OSAP_TERRAIN_ANALYSIS.corridor(r, { radius_m: 3000 }).then((c) => {
    const S = window.OSAP_TERRAIN_SRC, at = (ll) => { const x = S.toCell(c.spec, ll[0], ll[1]), i = Math.round(x[0]), j = Math.round(x[1]); return i < 0 || j < 0 || i >= c.n || j >= c.n ? -1 : c.cls[j * c.n + i]; };
    return { st: c.stations.length, sk: c.skipped, stats: c.stats, w: at([13.75, 100.48]), e: at([13.75, 100.525]), far: at([13.75, 100.466]), poly: c.visible.length, a: c.assumptions };
  }), route);
  ok(C.st >= 5 && C.sk === 0 && C.a.spacing_m === 750, "route exposure: stations every 750 m along a 4.4 km route (" + C.st + ")");
  ok(C.w === 1 && C.e === 2 && C.far <= 0, "route exposure: ground west can see the route, ground behind the ridge cannot, 3.6 km west is outside (" + [C.w, C.e, C.far] + ")");
  ok(C.stats.exposed_pct > 30 && C.stats.exposed_pct < 95 && C.stats.masked_pct > 0 && C.poly > 0, "route exposure: " + C.stats.exposed_pct.toFixed(1) + "% exposed, polygons for the exposed ground");
  /* in the panel, under the line of sight result */
  await p.evaluate((r) => window.OSAP_TERRAIN_ANALYSIS.line(r), route);
  await p.waitForFunction(() => { const s = window.OSAP_TERRAIN_ANALYSIS.state(); return !s.busy && (s.line.result || s.err); }, null, { timeout: 60000 });
  ok(await p.evaluate(() => /ROUTE EXPOSURE/.test(document.getElementById("terrain").textContent) && !!document.querySelector('#terrain [data-ts="cor"]')), "route exposure: the line of sight result offers Show where this route can be seen from");
  await p.click('#terrain [data-ts="cor"]');
  await p.waitForFunction(() => { const s = window.OSAP_TERRAIN_ANALYSIS.state(); return !s.busy && (s.cor || s.err); }, null, { timeout: 60000 });
  st = await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.state());
  await p.waitForTimeout(300);
  const t2 = await p.evaluate(() => document.getElementById("terrain").textContent);
  ok(st.cor && Math.abs(st.cor.stats.exposed_pct - C.stats.exposed_pct) < 0.01 && st.corMarks > st.cor.stations && /can see part of it/.test(t2) && /Most exposed points/.test(t2) && /NOT MODELED/.test(t2), "route exposure: the panel shows the same result, drawn on the map with its stations (" + (st.cor ? st.corMarks : st.err) + ")");
  /* the evacuation planner's route tools hook */
  const H = await p.evaluate((r) => { const t = (window.OSAP_EPE_CORRIDOR_TOOLS || []).filter((x) => x.id === "terrain-exposure")[0]; return t ? t.run({ id: "opt1", coords: r, km: 4.4, dest: "x" }, {}).then((c) => ({ label: t.label, ok: !!c && c.stats.exposed_pct > 30 })) : null; }, route);
  ok(H && H.ok && /seen from/.test(H.label), "route exposure: the evacuation route tools hook runs it on a route " + JSON.stringify(H));
  await p.click('#terrain [data-ts="corclear"]'); await p.waitForTimeout(100);
  ok(await p.evaluate(() => { const s = window.OSAP_TERRAIN_ANALYSIS.state(); return !s.cor && s.corMarks === 0; }), "route exposure: Hide takes it off the map");
  ok(errors.length === 0, "slope/exposure: no page errors " + JSON.stringify(errors.slice(0, 3)));
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
