// Headless check of editing a drop zone on the map from the DZSO sheet (assets/osap-dzso.js; Shane 2026-10-27: "edit the dz
// shape and angle/ approach from the map"), the aircraft drop-down, the hazard lookup surviving a winds Refresh, the satellite
// map in the exported PDF, and the flight planner (assets/osap-flight.js) following the saved DZ through window.OSAP_DZ.
// The test DZ: PI at 15.10 N, 100.60 E, 1000 x 550 m on a 000 run-in, PI 274 m from the leading edge. Open-Meteo, Overpass and
// Esri imagery tiles are answered by made-up test data; everything else outside is refused.
// Checks, desktop with a mouse: the handles are drawn (move ring, four corners, turn handle on the run-in line); dragging a
// trailing corner makes the DZ longer and wider with the PI fixed; dragging a leading corner past the PI stops at the PI;
// dragging the turn handle round to the west sets the run-in to 090; dragging the ring moves the PI; each change of a saved DZ
// is in "osap-dz"; Edit on map hides the handles; a press on a handle opens no report pop-up. The flight plan with an IP before
// this DZ follows it: PI, size and lead come across and the IP swings onto the new run-in at the same distance.
// Aircraft: a drop-down of the shared list; picking one stores its name; a typed "C130" shows as Other with the text kept.
// Hazards: a winds Refresh while Overpass is still answering no longer leaves the hazards on "Asking OpenStreetMap".
// PDF: the diagram carries imagery tiles, waits for them, and the rendered PDF page has the tile colour in the map.
// Phone with real touch (CDP): a corner drag resizes the DZ, the long-press ring does not open, the map does not pan.
// Run from the repo root: node tests/dz_map_edit_smoke.mjs   (needs playwright, Chromium and poppler's pdftoppm; OUT=dir saves screenshots and the PDF)
import { createServer } from "node:http";
import { readFile, readdir, mkdtemp } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
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

const PI = [15.10, 100.60];
/* a 256 x 256 tile of one colour (RGB 30, 160, 60), standing in for Esri imagery */
function png(r, g, b) {
  const crc = (buf) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } c = 0xffffffff; for (const x of buf) c = t[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(256, 0); ih.writeUInt32BE(256, 4); ih[8] = 8; ih[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(256).fill([r, g, b]).flat())]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", deflateSync(Buffer.concat(Array(256).fill(row)))), chunk("IEND", Buffer.alloc(0))]);
}
const TILE = png(30, 160, 60);
function meteo() {
  const t0 = Math.floor(Date.now() / 36e5) * 3600 - 3600, n = 72, time = [...Array(n)].map((_, i) => t0 + i * 3600), f = (v) => time.map(() => v);
  return { latitude: PI[0], longitude: PI[1], elevation: 24, timezone: "Asia/Bangkok", utc_offset_seconds: 25200, hourly: { time, temperature_2m: f(30), dew_point_2m: f(22), wind_speed_10m: f(8), wind_direction_10m: f(270), wind_gusts_10m: f(10),
    wind_speed_80m: f(8), wind_direction_80m: f(270), wind_speed_120m: f(8), wind_direction_120m: f(270), wind_speed_180m: f(8), wind_direction_180m: f(270), wind_speed_925hPa: f(8), wind_direction_925hPa: f(270), geopotential_height_925hPa: f(780),
    wind_speed_850hPa: f(8), wind_direction_850hPa: f(270), geopotential_height_850hPa: f(1500), cloud_cover_low: f(10), visibility: f(24000), precipitation: f(0), weather_code: f(1), pressure_msl: f(1009) } };
}

/* a 115 kV line running north-south 4 km east of the PI: outside the old 1.8 km hazard search */
const FARLINE = { type: "way", id: 9, tags: { power: "line", voltage: "115000" }, geometry: [-3000, 3000].map((n) => ({ lat: PI[0] + n / 110574, lon: PI[1] + 4000 / (111320 * Math.cos(PI[0] * Math.PI / 180)) })) };
async function open(opts, flags = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [], hits = { overpass: 0, tiles: 0 };
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
    const u = r.request().url();
    if (/api\.open-meteo\.com\/v1\/forecast/.test(u) && /wind_speed_925hPa/.test(u)) return r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(meteo()) });
    if (/postpass\.geofabrik\.de/.test(u)) {
      if (flags.osmSlow) await new Promise((w) => setTimeout(w, flags.osmSlow));
      return r.fulfill({ status: 200, contentType: "application/geo+json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ type: "FeatureCollection", features: flags.farLine ? [{ type: "Feature", properties: { osm_type: "W", osm_id: 9, tags: FARLINE.tags }, geometry: { type: "LineString", coordinates: FARLINE.geometry.map((q) => [q.lon, q.lat]) } }] : [] }) });
    }
    if (/\/api\/interpreter/.test(u)) { hits.overpass++; if (flags.osmSlow) await new Promise((w) => setTimeout(w, flags.osmSlow)); return r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ elements: flags.farLine ? [FARLINE] : [] }) }); }
    if (/World_Imagery\/MapServer\/tile\//.test(u)) { hits.tiles++; return r.fulfill({ status: 200, contentType: "image/png", headers: { "Access-Control-Allow-Origin": "*" }, body: TILE }); }
    return r.abort();
  });
  await ctx.addInitScript((pi) => {
    try {
      localStorage.setItem("osap-home", "map");
      localStorage.setItem("osap-dz", JSON.stringify([{ id: "dztest01", name: "Edit DZ", cc: "th", pi: pi, axis: 0, shape: "rect", len_m: 1000, wid_m: 550, pi_lead_m: 274, alt_ft: 1250, acft: "C130" }]));
    } catch (e) {}
  }, PI);
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_DZ && window.OSAP_DZSO_GO && window.__asapMap, null, { timeout: 60000 }); await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
  return { ctx, p, errors, hits };
}
const settled = (p) => p.waitForFunction(() => { const s = window.OSAP_DZSO && window.OSAP_DZSO.state && window.OSAP_DZSO.state(); return s && (s.wx || s.wxErr) && (s.hz || s.hzErr) && (s.hosp || s.hospErr); }, null, { timeout: 30000 });
const dzNow = (p) => p.evaluate(() => window.OSAP_DZSO.state().dz);
const stored = (p) => p.evaluate(() => window.OSAP_DZ.get("dztest01"));
/* a handle's centre on the page, and the page point of a lat, lon */
const hxy = (p, k) => p.evaluate((k) => { const r = document.querySelector('[data-dzh="' + k + '"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, k);
const llxy = (p, ll) => p.evaluate((ll) => { const m = window.__asapMap, q = m.latLngToContainerPoint(ll), r = m.getContainer().getBoundingClientRect(); return [r.left + q.x, r.top + q.y]; }, ll);
/* metres from the PI to a page point, in the DZ's frame (along the run-in, right of it) */
const offLL = (p, n, e) => p.evaluate((a) => { const d = window.OSAP_DZSO.state().dz, la = d.pi[0] + a[0] / 110574, lo = d.pi[1] + a[1] / (111320 * Math.cos(d.pi[0] * Math.PI / 180)); return [la, lo]; }, [n, e]);
async function mouseDrag(p, from, to) {
  await p.mouse.move(from[0], from[1]); await p.mouse.down();
  for (let i = 1; i <= 8; i++) await p.mouse.move(from[0] + (to[0] - from[0]) * i / 8, from[1] + (to[1] - from[1]) * i / 8);
  await p.mouse.up(); await p.waitForTimeout(250);
}

/* ---------- desktop, mouse ---------- */
{
  const { ctx, p, errors, hits } = await open({ viewport: { width: 1440, height: 900 } });
  await p.evaluate((c) => { window.__asapMap.setView(c, 15); window.OSAP_DZSO_GO({ id: "dztest01" }); }, PI);
  await p.waitForFunction(() => window.OSAP_DZSO && window.OSAP_DZSO.isOpen && window.OSAP_DZSO.isOpen(), null, { timeout: 15000 }); await settled(p);
  /* the sheet docks to the side so the DZ is on the map beside it */
  await p.evaluate((c) => window.__asapMap.setView(c, 15), PI); await p.waitForTimeout(300);
  let s = await p.evaluate(() => window.OSAP_DZSO.state());
  ok(s.saved && ["mv", "c0", "c1", "c2", "c3", "rot"].every((k) => s.handles.includes(k)), "desktop: handles drawn for move, four corners and the run-in turn: " + s.handles.join(","));
  ok(/drag the dashed ring/.test(await p.textContent("#dzso")) && /Each change is saved/.test(await p.textContent("#dzso")), "desktop: the sheet says how to edit on the map and that changes save");
  const vis = await p.evaluate(() => { const e = document.querySelector('[data-dzh="c2"]'), r = e.getBoundingClientRect(), t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return t && t.closest("[data-dzh]") === e; });
  if (!vis) { await p.evaluate(() => document.getElementById("dzso").hidden = false); }
  ok(vis, "desktop: the corner handle is on top and can be pressed");

  /* trailing right corner (u = 1000, v = +275) out to u = 1300, v = +400 */
  await mouseDrag(p, await hxy(p, "c2"), await llxy(p, await offLL(p, 1300 - 274, 400)));
  let d = await dzNow(p), st = await stored(p);
  ok(Math.abs(d.len_m - 1300) <= 20 && Math.abs(d.wid_m - 800) <= 20 && Math.abs(d.pi[0] - PI[0]) < 1e-7 && d.pi_lead_m === 274, "desktop: a trailing corner drag makes the DZ 1300 x 800 m with the PI fixed: " + d.len_m + " x " + d.wid_m);
  ok(st && st.len_m === d.len_m && st.wid_m === d.wid_m, "desktop: the saved DZ in osap-dz has the new size: " + (st && st.len_m + " x " + st.wid_m));
  ok(await p.evaluate(() => !document.querySelector(".leaflet-popup")), "desktop: a handle press opens no report pop-up");

  /* leading left corner (u = 0) dragged past the PI stops at the PI */
  await mouseDrag(p, await hxy(p, "c0"), await llxy(p, await offLL(p, 200, -400)));
  d = await dzNow(p);
  ok(d.pi_lead_m === 0 && Math.abs(d.len_m - (1300 - 274)) <= 20, "desktop: the leading edge stops at the PI (PI lead 0 m): lead " + d.pi_lead_m + ", length " + d.len_m);

  /* the turn handle round to due west of the PI: the aircraft flies east, run-in 090 */
  await mouseDrag(p, await hxy(p, "rot"), await llxy(p, await offLL(p, 0, -900)));
  d = await dzNow(p); st = await stored(p);
  ok(d.axis === 90 && st.axis === 90, "desktop: the turn handle sets the run-in to 090 and saves it: " + d.axis);
  ok(/Run-in axis/.test(await p.textContent("#dzso")) && (await p.inputValue('#dzso [data-f="axis"]')) === "90", "desktop: the sheet's run-in field shows 90");

  /* flight plan with an IP 10 km before the DZ follows the DZ */
  await p.evaluate(() => window.OSAP_FLIGHT_GO({}));
  await p.waitForFunction(() => window.OSAP_FLIGHT && window.OSAP_FLIGHT.load, null, { timeout: 15000 });
  await p.evaluate((pi) => {
    const g = window.OSAP_GEO, ip = g.dest(pi, 270, 10000);
    window.OSAP_FLIGHT.load({ id: "ftest", acft: "c130j", pts: [{ role: "dep", lat: 15.2, lon: 100.2 }, { role: "ip", lat: ip[0], lon: ip[1] }, { role: "dz", lat: pi[0], lon: pi[1], dzId: "dztest01" }, { role: "land", lat: 15.2, lon: 100.2 }] });
  }, (await dzNow(p)).pi);
  /* the flight card closed: the plan still follows the DZ */
  await p.evaluate(() => { window.OSAP_FLIGHT.close(); window.OSAP_DZSO_GO({ id: "dztest01" }); });
  await p.waitForTimeout(900);   /* the sheet may bring the DZ into view: let the map settle, then zoom back in */
  await p.evaluate(() => window.__asapMap.setView(window.OSAP_DZSO.state().dz.pi, 15, { animate: false })); await p.waitForTimeout(300);
  await mouseDrag(p, await hxy(p, "rot"), await llxy(p, await offLL(p, -900, 0)));   /* due south of the PI: run-in 000 */
  const fl = await p.evaluate(() => { const s = window.OSAP_FLIGHT.state(), P = s.plan.pts, g = window.OSAP_GEO, inv = g.inverse([P[1].lat, P[1].lon], [P[2].lat, P[2].lon]); return { m: inv.m, b: inv.b2, len: s.plan.dzLen, wid: s.plan.dzWid, lead: P[2].lead, msg: s.msg, fd: window.OSAP_FLIGHT.forDz("dztest01") }; });
  /* OSAP_GEO.dest is spherical and inverse ellipsoidal, so the distance reads within half a percent */
  ok(Math.abs(fl.m - 10000) < 60 && (fl.b < 2.5 || fl.b > 357.5), "flight: the IP swings onto the new run-in (about 000) at the same 10 km: " + Math.round(fl.m) + " m, " + fl.b.toFixed(1) + "°");
  ok(fl.len === (await dzNow(p)).len_m && fl.wid === (await dzNow(p)).wid_m && fl.lead === 0 && /IP moved onto the new run-in/.test(fl.msg), "flight: the plan takes the DZ size and PI lead: " + JSON.stringify({ len: fl.len, wid: fl.wid, lead: fl.lead }));
  ok(fl.fd && Math.abs(((fl.fd.axis - (await dzNow(p)).axis + 540) % 360) - 180) <= 1, "flight: forDz gives the DZSO sheet the same run-in: " + (fl.fd && fl.fd.axis));

  /* move the whole DZ by its ring */
  const before = (await dzNow(p)).pi, to = await offLL(p, 300, 200);
  await mouseDrag(p, await hxy(p, "mv"), await llxy(p, to));
  d = await dzNow(p); st = await stored(p);
  ok(Math.abs(d.pi[0] - to[0]) < 1.5e-4 && Math.abs(d.pi[1] - to[1]) < 1.5e-4 && st.pi[0] === d.pi[0] && d.pi[0] !== before[0], "desktop: dragging the ring moves the PI and saves it");
  const fl2 = await p.evaluate(() => { const P = window.OSAP_FLIGHT.state().plan.pts; return [P[2].lat, P[2].lon]; });
  ok(Math.abs(fl2[0] - d.pi[0]) < 1e-6 && Math.abs(fl2[1] - d.pi[1]) < 1e-6, "flight: the plan's DZ point moved with it");

  /* Edit on map toggles the handles */
  await p.click('#dzso [data-dz="edit"]');
  ok(await p.evaluate(() => !document.querySelector("[data-dzh]") && window.OSAP_DZSO.state().edit === false), "desktop: Edit on map off hides the handles");
  await p.click('#dzso [data-dz="edit"]');
  ok(await p.evaluate(() => document.querySelectorAll("[data-dzh]").length === 6), "desktop: and on shows them again");

  /* aircraft drop-down */
  ok(await p.evaluate(() => { const s = document.querySelector('#dzso [data-f="acsel"]'); return s && [...s.options].some((o) => o.value === "C-130J Super Hercules") && s.value === "__other" && document.querySelector('#dzso [data-f="acft"]').value === "C130"; }), "aircraft: a drop-down of the shared list; the typed C130 shows as Other with its text");
  await p.selectOption('#dzso [data-f="acsel"]', "C-17A Globemaster III");
  ok((await stored(p)).acft === "C-17A Globemaster III" && await p.evaluate(() => !document.querySelector('#dzso [data-f="acft"]')), "aircraft: picking C-17A saves its name to the shared DZ and hides the text box");
  ok(await p.evaluate(() => window.OSAP_FLIGHT.aircraft === window.OSAP_DZ.aircraft), "aircraft: the flight planner uses the same list");
  await p.selectOption('#dzso [data-f="acsel"]', "__other");
  ok(await p.evaluate(() => !!document.querySelector('#dzso [data-f="acft"]')), "aircraft: Other shows a text box to type one");

  /* the PDF diagram with imagery, rendered to a real PDF */
  await p.evaluate(() => { window.__pdf = null; window.__pdfGo = null; window.__pdfHold = (info) => { const r = info.root; window.__pdf = { images: r.querySelectorAll("svg image").length, loaded: [...r.querySelectorAll("svg image")].length }; return new Promise((res) => { window.__pdfGo = res; }); }; });
  const t0 = hits.tiles;
  await p.click('#dzso [data-dz="pdf"]'); await p.waitForFunction(() => window.__pdf, null, { timeout: 20000 });
  const pdf = await p.evaluate(() => window.__pdf);
  ok(pdf.images >= 1 && hits.tiles > t0, "pdf: the diagram carries satellite tiles, fetched before printing: " + pdf.images + " tiles, " + (hits.tiles - t0) + " requests");
  const dir = OUT || await mkdtemp(join(tmpdir(), "dzpdf-"));
  await p.emulateMedia({ media: "print" });
  await p.pdf({ path: join(dir, "dzso-sheet.pdf"), format: "A4", printBackground: true });
  await p.emulateMedia({ media: "screen" });
  await p.evaluate(() => window.__pdfGo && window.__pdfGo());
  let green = 0;
  try {
    /* poppler draws each page as a PPM (a short text header, then raw RGB), read here with no image library */
    execFileSync("pdftoppm", ["-r", "40", join(dir, "dzso-sheet.pdf"), join(dir, "dzpage")]);
    const pages = (await readdir(dir)).filter((f) => /^dzpage.*\.ppm$/.test(f));
    for (const f of pages) {
      const buf = await readFile(join(dir, f)), hd = buf.toString("latin1", 0, 64).match(/^P6\s+(\d+)\s+(\d+)\s+255\s/);
      if (!hd) continue;
      for (let i = hd[0].length; i + 2 < buf.length; i += 3) if (Math.abs(buf[i] - 30) <= 6 && Math.abs(buf[i + 1] - 160) <= 6 && Math.abs(buf[i + 2] - 60) <= 6) green++;
    }
    ok(green > 500, "pdf: the rendered PDF shows the satellite map (tile-coloured pixels: " + green + ")");
  } catch (e) { ok(false, "pdf: could not render the PDF to check the map: " + e.message); }
  if (OUT) await p.screenshot({ path: OUT + "/dz-edit-desktop.png" });
  ok(errors.length === 0, "desktop: no page errors " + errors.join(" | "));
  await ctx.close();
}

/* ---------- hazards: a winds Refresh during a slow Overpass answer ---------- */
{
  const { ctx, p, errors } = await open({ viewport: { width: 1280, height: 800 } }, { osmSlow: 2500 });
  await p.evaluate(() => window.OSAP_DZSO_GO({ id: "dztest01" }));
  await p.waitForFunction(() => window.OSAP_DZSO && window.OSAP_DZSO.isOpen && window.OSAP_DZSO.isOpen() && window.OSAP_DZSO.state().wx, null, { timeout: 15000 });
  ok(/Asking OpenStreetMap/.test(await p.textContent("#dzso")), "hazards: the lookup is still running when winds are refreshed");
  await p.click('#dzso [data-dz="wx"]');
  await p.waitForFunction(() => { const s = window.OSAP_DZSO.state(); return s.hz || s.hzErr; }, null, { timeout: 15000 }).catch(() => {});
  const t = await p.textContent("#dzso");
  ok(!/Asking OpenStreetMap/.test(t) && /Hazards in and round the DZ/.test(t) && (await p.evaluate(() => !!window.OSAP_DZSO.state().hz)), "hazards: they still fill in after a winds Refresh (no longer stuck on Asking OpenStreetMap)");
  ok(errors.length === 0, "hazards: no page errors " + errors.join(" | "));
  await ctx.close();
}

/* ---------- hazards: a power line 4 km away is found and named, not "none" ---------- */
{
  const { ctx, p, errors } = await open({ viewport: { width: 1280, height: 800 } }, { farLine: true });
  await p.evaluate(() => window.OSAP_DZSO_GO({ id: "dztest01" })); await settled(p);
  const s = await p.evaluate(() => window.OSAP_DZSO.state().hz.sum.power);
  const t = await p.textContent("#dzso");
  ok(s.n === 0 && s.near && Math.abs(s.near.m - 4000) < 20, "hazards: the power line 4 km east is the nearest one (outside the DZ search, so counted 0 there): " + (s.near && Math.round(s.near.m)));
  ok(/4\.0 km E \(090°\), 115 kV/.test(t) && /out to 10 km/.test(t), "hazards: the table names it, 4.0 km E, 115 kV, and says power lines are looked for out to 10 km");
  ok(/none mapped within 10 km/.test(t) && /none mapped within 1\.8 km/.test(t), "hazards: an empty row says how far it looked");
  ok(errors.length === 0, "far line: no page errors " + errors.join(" | "));
  await ctx.close();
}

/* ---------- phone, real touch ---------- */
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await p.evaluate((c) => window.OSAP_DZSO_GO({ id: "dztest01" }), PI);
  await p.waitForFunction(() => window.OSAP_DZSO && window.OSAP_DZSO.isOpen && window.OSAP_DZSO.isOpen(), null, { timeout: 15000 }); await settled(p);
  /* Map view of the split sheet, the DZ in the middle */
  await p.evaluate((c) => { const b = document.querySelector('#dzso [data-osplit-stop="map"], .osplit [data-stop="map"]'); if (b) b.click(); else if (window.OSAP_SPLIT && window.OSAP_SPLIT.stop) window.OSAP_SPLIT.stop(document.getElementById("dzso"), "map"); window.__asapMap.setView(c, 15); }, PI);
  await p.waitForTimeout(500);
  const cdp = await ctx.newCDPSession(p);
  const free = await p.evaluate(() => { const e = document.querySelector('[data-dzh="c2"]'), r = e.getBoundingClientRect(), t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return t && t.closest("[data-dzh]") === e; });
  ok(free, "phone: the corner handle is on the map and can be touched");
  const from = await hxy(p, "c2"), to = await llxy(p, await offLL(p, 1200 - 274, 350)), c0 = await p.evaluate(() => window.__asapMap.getCenter());
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from[0], y: from[1] }] });
  await p.waitForTimeout(700);   /* held longer than the long-press time */
  for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from[0] + (to[0] - from[0]) * i / 8, y: from[1] + (to[1] - from[1]) * i / 8 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await p.waitForTimeout(400);
  const d = await dzNow(p), c1 = await p.evaluate(() => window.__asapMap.getCenter());
  ok(Math.abs(d.len_m - 1200) <= 30 && Math.abs(d.wid_m - 700) <= 30, "phone: a touch drag on a corner resizes the DZ to about 1200 x 700 m: " + d.len_m + " x " + d.wid_m);
  ok((await stored(p)).len_m === d.len_m, "phone: the change is saved to the shared DZ");
  ok(Math.abs(c0.lat - c1.lat) < 1e-9 && Math.abs(c0.lng - c1.lng) < 1e-9, "phone: the map did not pan under the drag");
  ok(await p.evaluate(() => { const r = document.getElementById("atk-ring"); return !r || r.hidden || getComputedStyle(r).display === "none" || !r.classList.contains("open"); }), "phone: holding a handle does not open the long-press menu");
  if (OUT) await p.screenshot({ path: OUT + "/dz-edit-phone.png" });
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}

await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
