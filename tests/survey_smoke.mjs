// Headless check of the site survey (assets/osap-survey.js) on a desktop and a phone. Elevation tiles and OpenStreetMap
// (Postpass) are answered by made-up test data, so the check is the same every run.
// The test site: centre at 15.10 N, 100.60 E (central Thailand). The ground rises 10 m per km to the east. A 20 m power line runs
// north-south 300 m west of the west end of a 1000 m strip landing east (on its approach, breaking 20:1); a house sits inside the
// strip; a grass runway "09/27" is mapped along it.
// Checks: no toolbar button and nothing loaded until used; Area menu lists Site survey; long-press > Plans > Site survey here
// opens the worksheet at that point with its MGRS; switching to Landing zone / airfield and setting 1000 x 30 m on 090 gives the
// ends 500 m each side; elevation and the end-to-end gradient (1.0 %) come back tagged From sources; the power line is on the
// approach and breaks 20:1, the house is inside; the runway's surface shows as From sources and is NOT copied into the surveyed
// surface; the surveyor's values, an obstacle with a grid and a photo point are kept; Save puts one record in "osap-surveys" and
// My places lists it; dragging B on the map lengthens the strip and saves; Export PDF prints Surveyed and From sources columns,
// the diagram and no form fields; reopening from My places finds it; a DZ survey from the DZSO sheet shares the drop zone in
// OSAP_DZ both ways; an HLZ finder hand-over is kept as From sources; a failed OpenStreetMap lookup says it failed; the phone
// worksheet fits the screen; no page errors.
// Run from the repo root: node tests/survey_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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

const C0 = [15.10, 100.60];
const dLat = (m) => m / 110574, dLon = (m) => m / (111320 * Math.cos(C0[0] * Math.PI / 180));
const at = (e, n) => [C0[0] + dLat(n), C0[1] + dLon(e)];

/* ---------- made-up elevation: terrarium tiles, 50 m at the centre rising 10 m per km to the east ---------- */
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(b) { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const elev = (lat, lon) => 50 + (lon - C0[1]) * 111320 * Math.cos(C0[0] * Math.PI / 180) * 0.01;
function tile(z, x, y) {
  const n = 2 ** z, rgb = Buffer.alloc(256 * 256 * 3);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
    const lon = (x + (i + 0.5) / 256) / n * 360 - 180, lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + (j + 0.5) / 256) / n))) * 180 / Math.PI;
    const v = elev(lat, lon) + 32768, k = (j * 256 + i) * 3;
    rgb[k] = Math.floor(v / 256); rgb[k + 1] = Math.floor(v) % 256; rgb[k + 2] = Math.round((v % 1) * 256) % 256;
  }
  return png(256, 256, rgb);
}
const tiles = new Map();

/* ---------- made-up OpenStreetMap, as Postpass GeoJSON ---------- */
const ll = (p) => [p[1], p[0]];
const OSM = { type: "FeatureCollection", features: [
  { type: "Feature", properties: { osm_type: "W", osm_id: 11, tags: { power: "line", height: "20", name: "Test line" } }, geometry: { type: "LineString", coordinates: [ll(at(-800, -600)), ll(at(-800, 600))] } },
  { type: "Feature", properties: { osm_type: "W", osm_id: 12, tags: { building: "house" } }, geometry: { type: "Polygon", coordinates: [[ll(at(195, -5)), ll(at(205, -5)), ll(at(205, 5)), ll(at(195, 5)), ll(at(195, -5))]] } },
  { type: "Feature", properties: { osm_type: "W", osm_id: 13, tags: { aeroway: "runway", ref: "09/27", surface: "grass", width: "30" } }, geometry: { type: "LineString", coordinates: [ll(at(-500, 0)), ll(at(500, 0))] } }
] };

async function open(opts, flags = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [], hits = { postpass: 0, overpass: 0, tiles: 0 };
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url(), m = u.match(/elevation-tiles-prod\/terrarium\/(\d+)\/(\d+)\/(\d+)\.png/);
    if (m) { hits.tiles++; if (!tiles.has(u)) tiles.set(u, tile(+m[1], +m[2], +m[3])); return r.fulfill({ status: 200, contentType: "image/png", headers: { "Access-Control-Allow-Origin": "*" }, body: tiles.get(u) }); }
    if (/postpass\.geofabrik\.de/.test(u)) { hits.postpass++; return flags.osmFail ? r.fulfill({ status: 503, headers: { "Access-Control-Allow-Origin": "*" }, body: "down" }) : r.fulfill({ status: 200, contentType: "application/geo+json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(OSM) }); }
    if (/\/api\/interpreter/.test(u)) { hits.overpass++; return r.fulfill({ status: 504, headers: { "Access-Control-Allow-Origin": "*" }, body: "busy" }); }
    return r.abort();
  });
  await ctx.addInitScript((c) => {
    try {
      localStorage.setItem("osap-home", "map");
      if (!localStorage.getItem("osap-atak-pts")) localStorage.setItem("osap-atak-pts", JSON.stringify([{ id: "ptph1", cc: "th", lat: c[0] + 0.0005, lon: c[1] + 0.001, n: "Photo east end", t: Date.now(), src: "photo", az: 270, azRef: "mag" }]));
    } catch (e) {}
  }, C0);
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_DZ && window.__asapMap && window.OSAP_SURVEY_GO, null, { timeout: 60000 }); await p.waitForTimeout(3000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
  return { ctx, p, errors, hits };
}
const st = (p) => p.evaluate(() => window.OSAP_SURVEY.state());
const settled = (p) => p.waitForFunction(() => { const s = window.OSAP_SURVEY && window.OSAP_SURVEY.state && window.OSAP_SURVEY.state(); return s && s.r && !s.busy.el && !s.busy.osm && (s.r.auto.elev || s.err.el) && (s.r.auto.osm || s.err.osm); }, null, { timeout: 30000 });
const text = (p) => p.evaluate(() => (document.getElementById("srv") || {}).innerText || "");
async function setF(p, sel, v) { await p.fill("#srv " + sel, String(v)); await p.dispatchEvent("#srv " + sel, "change"); await p.waitForTimeout(80); }

/* ---------- desktop ---------- */
{
  const { ctx, p, errors, hits } = await open({ viewport: { width: 1440, height: 900 } });
  ok(await p.evaluate(() => !document.querySelector('#atk-tools [data-atk="survey"]') && !window.OSAP_SURVEY), "desktop: no survey toolbar button, and the survey is not loaded until used");
  ok(await p.evaluate(() => (window.OSAP_AREA_TOOLS || []).some((t) => t.id === "survey" && /Site survey/.test(t.label) && t.point)), "desktop: Area menu lists Site survey, usable with no shape");
  await p.evaluate((c) => { window.__asapMap.setView(c, 15); window.OSAP_ATAK.ring(c[0], c[1]); }, C0); await p.waitForTimeout(200);
  await p.click('#atk-ring [data-rk="plans"]'); await p.waitForTimeout(150);
  ok(/Site survey here/.test(await p.textContent("#atk-pop")), "desktop: long-press > Plans lists Site survey here");
  await p.click('#atk-pop [data-pk="survey"]');
  await p.waitForFunction(() => window.OSAP_SURVEY && window.OSAP_SURVEY.isOpen && window.OSAP_SURVEY.isOpen(), null, { timeout: 15000 });
  await settled(p);
  let s = await st(p);
  const mg = await p.evaluate((c) => window.OSAP_GEO.mgrs(c[0], c[1], 5), C0);
  ok(s.r.kind === "hlz" && Math.abs(s.r.g.c[0] - C0[0]) < 1e-5 && (await text(p)).includes(mg), "desktop: opens an HLZ survey at the long-pressed point with its MGRS " + mg);

  /* airfield, 1000 x 30 m landing east */
  await p.selectOption('#srv [data-f="kind"]', "lz"); await p.waitForTimeout(100);
  await setF(p, '[data-f="axis"]', 90); await setF(p, '[data-f="len_m"]', 1000); await setF(p, '[data-f="wid_m"]', 30);
  await p.waitForTimeout(900); await settled(p);
  s = await st(p);
  const e = await p.evaluate(() => { const S = window.OSAP_SURVEY, r = S.state().r, x = S.core.ends(r.g); return { a: S.core.local(r.g.c, x.a), b: S.core.local(r.g.c, x.b) }; });
  ok(s.r.kind === "lz" && s.r.g.len_m === 1000 && s.r.g.wid_m === 30 && Math.abs(e.a[0] + 500) < 1 && Math.abs(e.b[0] - 500) < 1, "desktop: landing zone / airfield 1000 x 30 m on 090 puts A 500 m west and B 500 m east: " + JSON.stringify(e));
  const E = s.r.auto.elev;
  ok(E && Math.abs(E.z.c - 50) < 1.5 && E.gl != null && Math.abs(E.gl - 1) < 0.15, "desktop: elevation 50 m at the centre and a 1.0% gradient A to B from the terrain: " + JSON.stringify(E && { c: E.z.c, gl: E.gl }));
  ok(hits.tiles > 0 && hits.postpass >= 1 && hits.postpass <= 3, "desktop: elevation tiles and Postpass were used: " + JSON.stringify(hits));
  let t = await text(p);
  ok(/From sources/.test(t) && /Surveyed/.test(t) && /1\.0% A to B/.test(t), "desktop: gradient is shown From sources beside the surveyed field");
  const O = s.r.auto.osm, pw = O && O.items.find((x) => x.k === "power"), hs = O && O.items.find((x) => x.k === "bldg");
  ok(pw && /approach, 300 m out, breaks 20:1/.test(pw.where) && pw.h === 20 && !pw.hAssumed, "desktop: the 20 m power line 300 m before A is on the approach and breaks 20:1: " + (pw && pw.where));
  ok(hs && hs.where === "inside the site" && hs.hAssumed, "desktop: the house is inside the site (assumed height)");
  ok(O && O.aero.some((a) => a.kind === "runway" && a.ref === "09/27" && a.surface === "grass"), "desktop: the mapped runway is found");
  ok(/OpenStreetMap runway: grass/.test(t) && await p.evaluate(() => document.querySelector('#srv [data-o="surf"]').value === ""), "desktop: the runway's surface is shown From sources and NOT copied into the surveyed surface");
  ok(await p.evaluate(() => document.querySelectorAll(".leaflet-srvpane-pane path").length >= 3 && [...document.querySelectorAll(".svlbl span")].some((x) => /^A approach/.test(x.textContent))), "desktop: the site, its corridors and A / B are drawn on the map");

  /* the surveyor's own entries */
  await setF(p, '[data-o="surveyor"]', "SSG Test, 1-1 SFG");
  await p.selectOption('#srv [data-o="surf"]', "Grass"); await p.waitForTimeout(80);
  await setF(p, '[data-o="grad_l"]', "0.8");
  await p.click('#srv [data-sv="obadd"]'); await p.waitForTimeout(100);
  await p.fill('#srv [data-ob="d"][data-i="0"]', "Tree line"); await p.fill('#srv [data-ob="h"][data-i="0"]', "12");
  const og = await p.evaluate((q) => window.OSAP_GEO.mgrs(q[0], q[1], 5), at(-650, 10));
  await setF(p, '[data-ob="g"][data-i="0"]', og);
  t = await text(p);
  ok(/approach, 1(49|50|51) m out/.test(t), "desktop: the recorded obstacle's grid places it on the approach, about 150 m out: " + (t.match(/approach, \d+ m out/g) || []).join(" | "));
  await p.click('#srv [data-sv="phadd"][data-id="ptph1"]'); await p.waitForTimeout(100);
  await setF(p, '[data-f="name"]', "Test strip");
  await p.click('#srv [data-sv="save"]'); await p.waitForTimeout(600);
  let saved = await p.evaluate(() => JSON.parse(localStorage.getItem("osap-surveys") || "[]"));
  ok(saved.length === 1 && saved[0].kind === "lz" && saved[0].name === "Test strip" && saved[0].obs.surveyor === "SSG Test, 1-1 SFG" && saved[0].obs.surf === "Grass" && saved[0].obs.grad_l === "0.8" &&
    saved[0].obst.length === 1 && saved[0].obst[0].h === "12" && saved[0].photos[0] === "ptph1" && saved[0].auto.elev && saved[0].auto.osm, "desktop: Save keeps one record with the surveyed values, obstacle, photo and the from-sources lookups apart");
  ok(await p.evaluate(() => { window.OSAP_PLACES.open(); const tx = document.getElementById("plc").innerText; window.OSAP_PLACES.close(); return /Test strip/.test(tx) && /LZ \/ airfield survey/.test(tx); }), "desktop: My places lists the survey");

  /* drag B east by 200 m */
  const bxy = await p.evaluate(() => { const S = window.OSAP_SURVEY, r = S.state().r, b = S.core.ends(r.g).b, q = window.__asapMap.latLngToContainerPoint(b), m = window.__asapMap.getContainer().getBoundingClientRect(); return [m.left + q.x, m.top + q.y]; });
  const to = await p.evaluate((q) => { const x = window.__asapMap.latLngToContainerPoint(q), m = window.__asapMap.getContainer().getBoundingClientRect(); return [m.left + x.x, m.top + x.y]; }, at(700, 0));
  await p.mouse.move(bxy[0], bxy[1]); await p.mouse.down(); await p.mouse.move((bxy[0] + to[0]) / 2, to[1], { steps: 4 }); await p.mouse.move(to[0], to[1], { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(500);
  saved = await p.evaluate(() => JSON.parse(localStorage.getItem("osap-surveys") || "[]"));
  ok(saved[0] && Math.abs(saved[0].g.len_m - 1200) <= 15 && Math.abs(saved[0].g.axis - 90) <= 1, "desktop: dragging B 200 m east lengthens the strip to about 1200 m and saves it: " + (saved[0] && saved[0].g.len_m));
  await settled(p);

  /* PDF */
  await p.evaluate(() => { window.__pdf = null; window.__pdfHold = (info) => { const r = info.root; window.__pdf = { title: info.title, svg: !!r.querySelector("svg polygon"), inputs: r.querySelectorAll("input,select,button,textarea").length, text: r.innerText }; }; });
  await p.click('#srv [data-sv="pdf"]'); await p.waitForFunction(() => window.__pdf, null, { timeout: 15000 });
  const pdf = await p.evaluate(() => window.__pdf);
  ok(/^LZ survey: Test strip/.test(pdf.title) && pdf.svg && pdf.inputs === 0, "desktop: Export PDF prints the worksheet with the diagram and no form fields: " + pdf.title);
  ok(/Surveyed/.test(pdf.text) && /From sources \(not surveyed\)/.test(pdf.text) && /SSG Test/.test(pdf.text) && /Power line/.test(pdf.text) && /Tree line/.test(pdf.text) && /not the official form/.test(pdf.text) && /Photo east end/.test(pdf.text),
    "desktop: the printed worksheet keeps Surveyed and From sources apart and carries the obstacles, photo and the not-official label");
  if (OUT) await p.screenshot({ path: OUT + "/survey-desktop.png" });
  await p.click('#srv [data-sv="close"]');
  ok(await p.evaluate(() => !window.OSAP_SURVEY.isOpen() && !document.querySelector(".leaflet-srvpane-pane path")), "desktop: Close hides the worksheet and clears the map");
  await p.evaluate((id) => window.OSAP_SURVEY_GO({ id }), saved[0].id); await p.waitForTimeout(300);
  s = await st(p);
  ok(s.saved && s.r.name === "Test strip" && s.r.obs.surveyor === "SSG Test, 1-1 SFG", "desktop: reopening the saved survey finds it");

  /* DZ survey from the DZSO sheet: the same drop zone */
  await p.evaluate(() => window.OSAP_SURVEY.close());
  await p.evaluate((c) => window.OSAP_DZSO_GO({ at: c, name: "Test DZ" }), at(0, 3000));
  await p.waitForFunction(() => window.OSAP_DZSO && window.OSAP_DZSO.isOpen && window.OSAP_DZSO.isOpen(), null, { timeout: 15000 }); await p.waitForTimeout(400);
  await p.click('#dzso [data-dz="save"]'); await p.waitForTimeout(200);
  await p.click('#dzso [data-dz="survey"]'); await p.waitForTimeout(400);
  await p.waitForFunction(() => window.OSAP_SURVEY.isOpen() && window.OSAP_SURVEY.state().r.kind === "dz", null, { timeout: 5000 });
  s = await st(p);
  const dz = await p.evaluate(() => window.OSAP_DZ.list()[0]);
  const off = await p.evaluate((a) => window.OSAP_SURVEY.core.local(a.pi, a.c), { pi: dz.pi, c: s.r.g.c });
  ok(s.r.kind === "dz" && s.r.g.len_m === dz.len_m && s.r.g.wid_m === dz.wid_m && Math.abs(off[1] - (dz.len_m / 2 - dz.pi_lead_m)) < 1.5, "desktop: Survey this DZ opens a DZ survey on the same drop zone (centre " + Math.round(off[1]) + " m along the run-in from the PI)");
  await p.evaluate(() => window.OSAP_DZSO.close());
  await p.click('#srv [data-sv="save"]'); await p.waitForTimeout(200);
  await setF(p, '[data-f="len_m"]', 1200); await p.waitForTimeout(900);
  const dz2 = await p.evaluate(() => window.OSAP_DZ.list());
  s = await st(p);
  ok(dz2.length === 1 && dz2[0].len_m === 1200 && dz2[0].id === s.r.dz_id && Math.abs(dz2[0].pi[0] - dz.pi[0]) < 2e-5 && Math.abs(dz2[0].pi[1] - dz.pi[1]) < 2e-5, "desktop: changing the DZ survey's length changes the shared drop zone (one DZ, PI kept at its leading-edge distance)");
  await settled(p);

  /* an HLZ finder hand-over */
  await p.evaluate((c) => window.OSAP_SURVEY_GO({ kind: "hlz", at: c, size: 80, finder: { at: Date.now(), clearD: 92, slope: 2.1, smax: 4.3, elev: 51, surface: "grass (OSM)", appr: "clear straight through along 045°–225°", craft: "CH-47 and smaller" } }), at(0, -3000));
  await p.waitForTimeout(400); s = await st(p); t = await text(p);
  ok(s.r.kind === "hlz" && s.r.g.len_m === 80 && s.r.auto.finder && /HLZ finder: CH-47/.test(t) && await p.evaluate(() => document.querySelector('#srv [data-o="max_acft"]').value === ""), "desktop: an HLZ finder hand-over is kept as From sources, not as the surveyor's values");
  ok(errors.length === 0, "desktop: no page errors " + errors.join(" | "));
  await ctx.close();
}

/* ---------- OpenStreetMap down ---------- */
{
  const { ctx, p, errors } = await open({ viewport: { width: 1280, height: 800 } }, { osmFail: true });
  await p.evaluate((c) => window.OSAP_SURVEY_GO({ at: c, kind: "lz" }), C0);
  await p.waitForFunction(() => window.OSAP_SURVEY && window.OSAP_SURVEY.isOpen && window.OSAP_SURVEY.isOpen(), null, { timeout: 15000 }); await settled(p);
  const t = await text(p);
  ok(/This is a failure, not "no obstacles"/.test(t), "failure: a failed OpenStreetMap lookup is reported as a failure");
  ok(errors.length === 0, "failure: no page errors " + errors.join(" | "));
  await ctx.close();
}

/* ---------- phone ---------- */
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await p.evaluate(() => (window.OSAP_AREA_TOOLS || []).filter((t) => t.id === "survey")[0].run());
  await p.waitForFunction(() => window.OSAP_SURVEY && window.OSAP_SURVEY.isOpen && window.OSAP_SURVEY.isOpen(), null, { timeout: 15000 }); await settled(p);
  const r = await p.evaluate(() => { const e = document.getElementById("srv"), b = e.getBoundingClientRect(); return { w: b.width, over: document.documentElement.scrollWidth > innerWidth + 1, boxOver: [...e.querySelectorAll(".cbox > *:not(.tw)")].some((x) => x.scrollWidth > x.clientWidth + 2) }; });
  ok(r.w <= 391 && !r.over && !r.boxOver, "phone: the worksheet fits the screen with no sideways scroll: " + JSON.stringify(r));
  ok(/Shape on the map/.test(await p.evaluate(() => document.getElementById("srv").innerText)), "phone: Area > Site survey opens the worksheet at the map centre");
  if (OUT) await p.screenshot({ path: OUT + "/survey-phone.png" });
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}

await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
