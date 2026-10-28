// Headless check of the DZSO sheet (assets/osap-dzso.js) and the shared drop zone store (assets/osap-dz.js) on a desktop and a
// phone. Open-Meteo and OpenStreetMap (Overpass) are answered by made-up test data, so the check is the same every run; hospitals
// come from OSAP's own stored copy in data/medfac.
// The test DZ: PI at 15.10 N, 100.60 E (central Thailand), 1000 x 550 m on a 090 run-in, a power line crossing it 100 m north of
// the PI, a canal 400 m south, a house 900 m west; the model wind is 270/10 kt at every level, gusting 16 kt in the drop hour.
// Checks: no toolbar button and nothing loaded until used; long-press > Plans lists "DZSO sheet here" and opens the sheet at that
// point with its MGRS; Area menu lists Drop zone (DZSO); a dropped point's pop-up has "DZSO sheet" and opens with the point's
// name; the wind table has 7 hours round the drop time, the drift is K x A x V (375 m at 1250 ft with 10 kt) and the drift-only
// release point is drawn upwind; 16 kt gusts read Outside limits; the anemometer reading is checked live; light shows EENT and
// BMNT; the power line is a hazard inside the DZ and the canal is not; hospitals are listed with distance; Save keeps the DZ in
// "osap-dz" with the DZSO's fields and reopening at the same spot finds it; Export PDF builds a sheet with the diagram and no form
// fields; a failed Overpass request is reported as a failure; the phone sheet has no sideways overflow; no page errors.
// Run from the repo root: node tests/dzso_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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

const PI = [15.10, 100.60];
const dLat = (m) => m / 110574, dLon = (m) => m / (111320 * Math.cos(PI[0] * Math.PI / 180));
const TOT = new Date(Math.floor(Date.now() / 36e5) * 36e5 + 30 * 36e5);   /* 30 hours ahead, on the hour */
const TOTS = TOT.toISOString().slice(0, 16);

/* made-up Open-Meteo answer: 270/10 kt everywhere, gusts 16 kt in the drop hour */
function meteo() {
  const t0 = Math.floor(Date.now() / 36e5) * 3600 - 3600, n = 96, time = [...Array(n)].map((_, i) => t0 + i * 3600), f = (v) => time.map(() => v);
  const h = { time, temperature_2m: f(30), dew_point_2m: f(22), wind_speed_10m: f(10), wind_direction_10m: f(270), wind_gusts_10m: time.map((s) => (s * 1000 === TOT.getTime() ? 16 : 10)),
    wind_speed_80m: f(10), wind_direction_80m: f(270), wind_speed_120m: f(10), wind_direction_120m: f(270), wind_speed_180m: f(10), wind_direction_180m: f(270),
    wind_speed_925hPa: f(10), wind_direction_925hPa: f(270), geopotential_height_925hPa: f(780), wind_speed_850hPa: f(10), wind_direction_850hPa: f(270), geopotential_height_850hPa: f(1500),
    cloud_cover_low: f(20), visibility: f(24000), precipitation: f(0), weather_code: f(1), pressure_msl: f(1009) };
  return { latitude: PI[0], longitude: PI[1], elevation: 24, timezone: "Asia/Bangkok", utc_offset_seconds: 25200, hourly: h };
}
const pt = (e, n) => ({ lat: PI[0] + dLat(n), lon: PI[1] + dLon(e) });
const OSM = { elements: [
  { type: "way", id: 1, tags: { power: "line", voltage: "115000", name: "Test line" }, geometry: [pt(-2000, 100), pt(2000, 100)] },
  { type: "way", id: 2, tags: { waterway: "canal", name: "Test canal" }, geometry: [pt(-2000, -400), pt(2000, -400)] },
  { type: "way", id: 3, tags: { building: "house" }, geometry: [pt(-905, -5), pt(-895, -5), pt(-895, 5), pt(-905, 5), pt(-905, -5)] },
  { type: "node", id: 4, lat: PI[0] + dLat(600), lon: PI[1] + dLon(1500), tags: { man_made: "mast", height: "60" } }
] };

/* the test features as Postpass would send them: GeoJSON with osm_type, osm_id and tags; a closed way is a polygon */
function geojson(o) {
  return { type: "FeatureCollection", features: o.elements.map((e) => {
    const c = e.geometry ? e.geometry.map((q) => [q.lon, q.lat]) : null, closed = c && c.length > 3 && c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1];
    return { type: "Feature", properties: { osm_type: e.type[0].toUpperCase(), osm_id: e.id, tags: e.tags }, geometry: e.type === "node" ? { type: "Point", coordinates: [e.lon, e.lat] } : closed ? { type: "Polygon", coordinates: [c] } : { type: "LineString", coordinates: c } };
  }) };
}
async function open(opts, flags = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [], hits = { meteo: 0, overpass: 0, postpass: 0 };
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    if (/api\.open-meteo\.com\/v1\/forecast/.test(u) && /wind_speed_925hPa/.test(u)) { hits.meteo++; return r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(meteo()) }); }
    /* Geofabrik Postpass answers the same features as GeoJSON (or fails with the flag, so Overpass is tried next) */
    if (/postpass\.geofabrik\.de/.test(u)) { hits.postpass++; return flags.osmFail || flags.ppFail ? r.fulfill({ status: 503, headers: { "Access-Control-Allow-Origin": "*" }, body: "down" }) : r.fulfill({ status: 200, contentType: "application/geo+json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(geojson(OSM)) }); }
    if (/\/api\/interpreter/.test(u)) { hits.overpass++; return flags.osmFail ? r.fulfill({ status: 504, headers: { "Access-Control-Allow-Origin": "*" }, body: "busy" }) : r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(OSM) }); }
    return r.abort();
  });
  await ctx.addInitScript((pi) => {
    try {
      localStorage.setItem("osap-home", "map");
      if (!localStorage.getItem("osap-atak-pts")) localStorage.setItem("osap-atak-pts", JSON.stringify([{ id: "ptdz1", cc: "th", lat: pi[0], lon: pi[1], n: "Tadia DZ", t: Date.now() }]));
    } catch (e) {}
  }, PI);
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_DZ && window.__asapMap, null, { timeout: 60000 }); await p.waitForTimeout(3000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
  return { ctx, p, errors, hits };
}
const settled = (p) => p.waitForFunction(() => { const s = window.OSAP_DZSO && window.OSAP_DZSO.state && window.OSAP_DZSO.state(); return s && (s.wx || s.wxErr) && (s.hz || s.hzErr) && (s.hosp || s.hospErr); }, null, { timeout: 30000 });
const text = (p) => p.evaluate(() => (document.getElementById("dzso") || {}).innerText || "");

/* ---------- desktop ---------- */
{
  const { ctx, p, errors, hits } = await open({ viewport: { width: 1440, height: 900 } });
  ok(await p.evaluate(() => !document.querySelector('#atk-tools [data-atk="dzso"]') && !window.OSAP_DZSO), "desktop: no DZSO toolbar button, and the sheet is not loaded until used");
  ok(await p.evaluate(() => (window.OSAP_AREA_TOOLS || []).some((t) => t.id === "dzso" && t.label === "Drop zone (DZSO)" && t.point)), "desktop: Area menu lists Drop zone (DZSO), usable with no shape");
  await p.evaluate((c) => { window.__asapMap.setView(c, 14); window.OSAP_ATAK.ring(c[0], c[1]); }, PI); await p.waitForTimeout(200);
  await p.click('#atk-ring [data-rk="plans"]'); await p.waitForTimeout(150);
  ok(/DZSO sheet here/.test(await p.textContent("#atk-pop")), "desktop: long-press > Plans lists DZSO sheet here");
  await p.click('#atk-pop [data-pk="dzso"]');
  await p.waitForFunction(() => window.OSAP_DZSO && window.OSAP_DZSO.isOpen && window.OSAP_DZSO.isOpen(), null, { timeout: 15000 });
  await settled(p);
  let s = await p.evaluate(() => window.OSAP_DZSO.state());
  const mg = await p.evaluate((c) => window.OSAP_GEO.mgrs(c[0], c[1], 5), PI);
  ok(Math.abs(s.dz.pi[0] - PI[0]) < 1e-4 && Math.abs(s.dz.pi[1] - PI[1]) < 1e-4 && (await text(p)).includes(mg), "desktop: the sheet opens at the long-pressed point with its MGRS " + mg);
  ok(s.dz.elev_m === 24 && /24 m \/ 79 ft MSL/.test(await text(p)), "desktop: elevation comes from the model terrain: " + s.dz.elev_m);
  ok(hits.meteo === 1 && hits.postpass === 1 && hits.overpass === 0, "desktop: one forecast and one Postpass request (Overpass not needed): " + JSON.stringify(hits));

  /* drop time, altitude and the axis */
  await p.fill('#dzso [data-f="tot"]', TOTS); await p.dispatchEvent('#dzso [data-f="tot"]', "change");
  await p.fill('#dzso [data-f="axis"]', "90"); await p.dispatchEvent('#dzso [data-f="axis"]', "change");
  await p.fill('#dzso [data-f="alt_ft"]', "1250"); await p.dispatchEvent('#dzso [data-f="alt_ft"]', "change");
  s = await p.evaluate(() => window.OSAP_DZSO.state());
  ok(s.hours.length === 7, "desktop: 7 forecast hours round the drop time: " + s.hours.length);
  const th = s.hours.find((h) => h.tot);
  ok(th && Math.abs(th.mean.kt - 10) < 1e-6 && Math.round(th.mean.dir) === 270, "desktop: mean wind to 1250 ft is 270/10");
  ok(th && Math.round(th.drift) === 375, "desktop: drift D = KAV = 3.0 x 12.5 x 10 = 375 m: " + (th && th.drift));
  ok(th && th.rp && th.rp[1] < PI[1] && Math.abs(th.rp[0] - PI[0]) < 1e-4, "desktop: the drift-only release point is west (upwind) of the PI");
  ok(th && th.v.state === "out" && /Gusts 16/.test(th.v.why.join(" ")), "desktop: 16 kt gusts in the drop hour read Outside limits");
  ok(s.hours.filter((h) => !h.tot).every((h) => h.v.state === "ok"), "desktop: 10 kt with 10 kt gusts reads Within limits");
  const t = await text(p);
  ok(/Outside limits/.test(t) && /Within limits/.test(t) && /375 m/.test(t), "desktop: the table shows the checks and the drift");
  ok(await p.evaluate(() => [...document.querySelectorAll(".dzlbl span")].some((x) => /Drift-only RP/.test(x.textContent)) && [...document.querySelectorAll(".dzlbl span")].some((x) => /^PI /.test(x.textContent))), "desktop: PI and drift-only RP are drawn on the map");
  ok(/EENT/.test(t) && /BMNT/.test(t) && /% lit/.test(t), "desktop: light shows EENT, BMNT and the moon");
  ok(/declination/.test(t) && /magnetic/.test(t), "desktop: run-in axis shows magnetic too");

  /* the anemometer reading */
  await p.fill('#dzso [data-m="kt"]', "15");
  ok(/Outside limits/.test(await p.textContent("#dzso [data-meas]")), "desktop: a 15 kt reading is Outside limits at once");
  await p.fill('#dzso [data-m="kt"]', "7"); await p.fill('#dzso [data-m="gust"]', "9");
  ok(/Within limits/.test(await p.textContent("#dzso [data-meas]")), "desktop: 7 kt gusting 9 is Within limits");

  /* hazards */
  const hz = s.hz.sum;
  ok(hz.power.n === 1 && hz.power.inDz === 1 && Math.round(hz.power.near.m) === 100, "desktop: the power line 100 m north is inside the DZ: " + JSON.stringify(hz.power.near && hz.power.near.m));
  ok(hz.river.n === 1 && hz.river.inDz === 0 && Math.abs(hz.river.near.m - 400) < 2 && hz.river.near.brg > 179 && hz.river.near.brg < 181, "desktop: the canal 400 m south is outside the DZ, due south");
  ok(hz.bldg.n === 1 && hz.bldg.inDz === 0, "desktop: the house 900 m west is outside the DZ");
  ok(hz.mast.n === 1 && /60 m tall/.test(t), "desktop: the mast is listed with its height");
  ok(/In or within 50 m of the DZ:/.test(t) && /Power line/.test(t), "desktop: a power line in the DZ is flagged at the top of the hazards");
  ok(await p.evaluate(() => document.querySelectorAll(".leaflet-dzpane-pane path.leaflet-interactive").length >= 3), "desktop: hazards are drawn on the map");

  /* hospitals from the stored copy */
  ok(s.hosp && s.hosp.list.length >= 1 && s.hosp.list.every((h, i, a) => !i || a[i - 1].m <= h.m), "desktop: nearest hospitals listed, nearest first: " + (s.hosp ? s.hosp.list.length : s.hospErr));
  ok(/Medical plan from the PI/.test(t) && /Evacuate from the PI/.test(t), "desktop: medical plan and evacuation buttons");
  await p.evaluate(() => { window.__mp = null; window.OSAP_MEDPLAN.open = (o) => { window.__mp = o; }; });
  await p.click('#dzso [data-dz="medplan"]');
  ok(await p.evaluate((c) => window.__mp && Math.abs(window.__mp.at[0] - c[0]) < 1e-4, PI), "desktop: Medical plan from the PI opens the plan at the PI");

  /* save, fields, reopen */
  await p.fill('#dzso [data-f="name"]', "Test DZ"); await p.dispatchEvent('#dzso [data-f="name"]', "change");
  await p.click('#dzso [data-dz="save"]');
  await p.fill('#dzso [data-ff="g2a"]', "34.550"); await p.check('#dzso [data-ff="c_walk"]'); await p.waitForTimeout(600);
  let saved = await p.evaluate(() => window.OSAP_DZ.list());
  ok(saved.length === 1 && saved[0].name === "Test DZ" && saved[0].fields.g2a === "34.550" && saved[0].fields.c_walk === true && saved[0].axis === 90 && saved[0].alt_ft === 1250 && saved[0].tot === TOTS + ":00Z", "desktop: Save keeps the DZ, its drop time and the DZSO's fields in osap-dz: " + JSON.stringify(saved[0] && { n: saved[0].name, f: saved[0].fields, tot: saved[0].tot }));
  await p.click('#dzso [data-dz="close"]');
  ok(await p.evaluate(() => !window.OSAP_DZSO.isOpen() && !document.querySelector(".leaflet-dzpane-pane path")), "desktop: Close hides the sheet and clears the map");

  /* the dropped point's pop-up */
  await p.evaluate(() => { const m = [...document.querySelectorAll(".leaflet-marker-icon")].find((x) => x.title === "Tadia DZ"); m && m.click(); }); await p.waitForTimeout(300);
  ok(await p.evaluate(() => !!document.querySelector('.leaflet-popup [data-pp="dzso"]')), "desktop: a dropped point's pop-up has DZSO sheet");
  await p.click('.leaflet-popup [data-pp="dzso"]'); await settled(p);
  s = await p.evaluate(() => window.OSAP_DZSO.state());
  ok(s.saved && s.dz.name === "Test DZ" && s.dz.fields.g2a === "34.550", "desktop: opening at the same spot finds the saved DZ and its fields");

  /* the PDF sheet */
  await p.evaluate(() => { window.__pdf = null; window.__pdfHold = (info) => { const r = info.root; window.__pdf = { title: info.title, svg: !!r.querySelector("svg polygon"), inputs: r.querySelectorAll("input,select,button").length, text: r.innerText }; }; });
  await p.click('#dzso [data-dz="pdf"]'); await p.waitForFunction(() => window.__pdf, null, { timeout: 10000 });
  const pdf = await p.evaluate(() => window.__pdf);
  ok(/^DZSO sheet: Test DZ/.test(pdf.title) && pdf.svg && pdf.inputs === 0, "desktop: Export PDF prints the sheet with the DZ diagram and no form fields");
  ok(/34\.550/.test(pdf.text) && /\[x\]/.test(pdf.text) && /375 m/.test(pdf.text) && /not an official drop zone survey/i.test(pdf.text), "desktop: the printed sheet carries the fields, checks, drift and the planning-aid label");
  if (OUT) await p.screenshot({ path: OUT + "/dzso-desktop.png" });
  ok(errors.length === 0, "desktop: no page errors " + errors.join(" | "));
  await ctx.close();
}

/* ---------- Postpass down: Overpass answers instead ---------- */
{
  const { ctx, p, errors, hits } = await open({ viewport: { width: 1280, height: 800 } }, { ppFail: true });
  await p.evaluate((c) => window.OSAP_DZSO_GO({ at: c }), PI); await settled(p);
  const s = await p.evaluate(() => window.OSAP_DZSO.state());
  ok(hits.postpass === 1 && hits.overpass === 1 && s.hz && s.hz.sum.power.n === 1 && s.hz.sum.river.n === 1, "fallback: with Postpass down the hazards come from Overpass: " + JSON.stringify(hits));
  ok(errors.length === 0, "fallback: no page errors " + errors.join(" | "));
  await ctx.close();
}

/* ---------- Overpass failure ---------- */
{
  const { ctx, p, errors } = await open({ viewport: { width: 1280, height: 800 } }, { osmFail: true });
  await p.evaluate((c) => window.OSAP_DZSO_GO({ at: c }), PI); await settled(p);
  const t = await text(p);
  ok(/hazard lookup failed/.test(t) && /failure, not "no hazards"/.test(t), "failure: a failed Overpass request is reported as a failure");
  ok(errors.length === 0, "failure: no page errors " + errors.join(" | "));
  await ctx.close();
}

/* ---------- phone ---------- */
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await p.evaluate(() => (window.OSAP_AREA_TOOLS || []).filter((t) => t.id === "dzso")[0].run());
  await p.waitForFunction(() => window.OSAP_DZSO && window.OSAP_DZSO.isOpen && window.OSAP_DZSO.isOpen(), null, { timeout: 15000 }); await settled(p);
  const r = await p.evaluate(() => { const e = document.getElementById("dzso"), b = e.getBoundingClientRect(); return { w: b.width, over: document.documentElement.scrollWidth > innerWidth + 1, boxOver: [...e.querySelectorAll(".cbox > *:not(.tw)")].some((x) => x.scrollWidth > x.clientWidth + 2) }; });
  ok(r.w <= 391 && !r.over, "phone: the sheet fits the screen with no sideways page scroll: " + JSON.stringify(r));
  ok(/Winds and weather/.test(await text(p)) && /Hazards in and round the DZ/.test(await text(p)), "phone: Area > Drop zone (DZSO) opens the sheet at the map centre");
  if (OUT) await p.screenshot({ path: OUT + "/dzso-phone.png" });
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}

await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
