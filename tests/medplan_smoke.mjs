// Headless check of the Medical plan (assets/osap-medplan.js) opened from its own Med plan button on the map toolbar, on a desktop and a
// phone. OpenStreetMap (Overpass), OSRM and Open-Meteo are answered by fixed test data here, so the check is the same every
// run; tools/probe_medplan.sh checks the real hosts. Checks: the toolbar has a Med plan button and the Area menu does not list it; the plan
// lists hospitals sorted by road drive time with MGRS grids, emergency and helipad flags; a clinic named after a doctor is
// withheld; phone numbers never appear; helipads and airfields are listed; "Use as HLZ" fills the HLZ field, which is kept on
// the device; a typed CCP can be the start point; weather flags come from the rules; the map shows numbered marks that go
// when the plan closes; Print prints only the plan; a failed OpenStreetMap lookup says so and offers Try again; and nothing
// in the plan carries the "AI generated" tag.
// Run from the repo root: node tests/medplan_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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

/* a small made-up neighbourhood round 13.75 N, 100.50 E */
const C0 = [13.75, 100.5];
const OSM = { osm3s: { timestamp_osm_base: "2026-09-30T06:00:00Z" }, elements: [
  { type: "node", id: 1, lat: 13.80, lon: 100.50, tags: { amenity: "hospital", name: "Far North Hospital", emergency: "yes", beds: "300", phone: "+66 2 123 4567", "addr:street": "North Road", "addr:city": "Testburi" } },
  { type: "way", id: 2, center: { lat: 13.76, lon: 100.51 }, tags: { amenity: "hospital", healthcare: "hospital", name: "Near Hospital", "operator:type": "public", "contact:phone": "+66 2 999 0000", website: "https://near.example.org/" } },
  { type: "node", id: 3, lat: 13.7605, lon: 100.5102, tags: { aeroway: "helipad" } },
  { type: "node", id: 4, lat: 13.74, lon: 100.49, tags: { amenity: "clinic", name: "Dr Somchai Clinic", phone: "+66 81 777 8888" } },
  { type: "node", id: 5, lat: 13.745, lon: 100.505, tags: { amenity: "clinic", name: "Community Health Centre 7" } },
  { type: "node", id: 6, lat: 13.748, lon: 100.502, tags: { amenity: "clinic", healthcare: "dentist", name: "Smile Dental" } },
  { type: "node", id: 7, lat: 13.91, lon: 100.60, tags: { aeroway: "aerodrome", name: "Test Airfield", icao: "VTXX", iata: "TXX" } },
  { type: "node", id: 8, lat: 13.70, lon: 100.45, tags: { aeroway: "helipad", name: "Riverside Pad" } },
  { type: "node", id: 9, lat: 13.71, lon: 100.46, tags: { aeroway: "helipad", disused: "yes" } },
  { type: "node", id: 10, lat: 13.70, lon: 100.40, tags: { amenity: "hospital", name: "Trauma Test Hospital", "healthcare:speciality": "trauma;surgery;neurosurgery" } },
  { type: "node", id: 12, lat: 13.7608, lon: 100.5108, tags: { amenity: "hospital", name: "โรงพยาบาลใกล้" } },
  { type: "node", id: 11, lat: 13.752, lon: 100.498, tags: { emergency: "ambulance_station", name: "City Ambulance Station", phone: "+66 2 111 2222" } }
] };
/* hospitals' published phone numbers (data/hospitals/th/phones.json): Far North's own OSM number stays; Trauma Test gets
   its emergency line and call centre from its website */
const PHONES = { schema: "osap-hospital-phones/1", cc: "th", read_at: "2026-10-03T23:39:00Z", hospitals: {
  n1: { p: { n: "02 000 0001", src: "embassy_list", name: "Test Embassy hospital list", url: "https://example.org/embassy.pdf", at: "2026-10-03" } },
  n10: { e: { n: "02 777 1669", src: "hospital_website", name: "Trauma Test Hospital website", url: "https://trauma.example.org/contact", at: "2026-10-03" },
    h: { n: "1719", src: "hospital_website", name: "Trauma Test Hospital website", url: "https://trauma.example.org/", at: "2026-10-03" } } } };
/* air rescue bases and U.S. posts (the second, wider Overpass request) */
const OSMX = { elements: [
  { type: "node", id: 20, lat: 13.90, lon: 100.60, tags: { emergency: "air_rescue_service", name: "Test Air Rescue", phone: "+66 2 555 0100" } },
  { type: "node", id: 31, lat: 13.74, lon: 100.53, tags: { healthcare: "blood_bank", name: "Test National Blood Centre", phone: "+66 2 256 4300" } },
  { type: "node", id: 32, lat: 13.80, lon: 100.55, tags: { healthcare: "blood_donation", name: "Test Donation Room" } },
  { type: "node", id: 33, lat: 12.68, lon: 100.88, tags: { amenity: "clinic", healthcare: "clinic", "healthcare:speciality": "hyperbaric_medicine;diving_medicine", name: "Test Hyperbaric Centre", phone: "+66 38 000 911" } },
  { type: "node", id: 21, lat: 13.7362, lon: 100.5465, tags: { office: "diplomatic", diplomatic: "embassy", country: "US", name: "Embassy of the United States", phone: "+66 2 205 4000" } }
] };
/* OSAP's sourced list for the test country: one trauma centre OSM lacks, a 24-hour emergency note for Near Hospital,
   an international airport and the U.S. Embassy */
const SOF = { asof: "2026-09-27", hospitals: [
  { id: "sof:th:hospital:sourced-trauma", name: "Sourced Trauma Centre", city: "Testburi", address: "1 Trauma Way", emergency_24h: null, trauma_level: "Level 2 trauma centre (test)", lat: 13.80, lon: 100.56, src: "https://example.org/trauma", srcname: "Test ministry list" },
  /* Shane 2026-10-02: only hospitals with a documented trauma level can be picked, so the test country documents three */
  { id: "sof:th:hospital:trauma-test", name: "Trauma Test Hospital", city: "Testburi", address: "", emergency_24h: null, trauma_level: "Level 1 trauma centre (test)", lat: 13.70, lon: 100.40, src: "https://example.org/tt", srcname: "Test registry" },
  { id: "sof:th:hospital:far-north", name: "Far North Hospital", city: "Testburi", address: "", emergency_24h: null, trauma_level: "Level 4 trauma centre (test)", lat: 13.80, lon: 100.50, src: "https://example.org/fn", srcname: "Test registry" },
  /* Shane 2026-10-03: beyond the search radius, a hospital whose own website documents burn, neuro and critical care; the
     wider search finds it when nothing nearer has those documented */
  { id: "sof:th:hospital:distant", name: "Distant Burn Centre", city: "Farburi", address: "", emergency_24h: null, trauma_level: null, lat: 12.60, lon: 100.90, src: "https://en.wikipedia.org/wiki/Test", srcname: "English Wikipedia",
    caps: Object.fromEntries(["ed.24_7", "dx.ct", "cc.icu", "cc.ventilator", "surg.neuro", "spec.burn", "surg.plastic"].map((k) => [k, { src: "https://distant.example.org/" + k, srcname: "Distant Burn Centre website", quote: "Test statement for " + k, asof: "2026-10-03" }])) },
  { id: "sof:th:hospital:near", name: "Near Hospital", city: "Testburi", address: "", emergency_24h: true, trauma_level: null, lat: 13.7601, lon: 100.5101, src: "https://example.org/near", srcname: "Test wiki" }
], airports: [{ name: "Test International", icao: "VTTT", iata: "TTT", type: "large_airport", scheduled_service: "yes", lat: 13.69, lon: 100.75, src: "https://ourairports.com/airports/VTTT/", srcname: "OurAirports" }],
  posts: [{ name: "U.S. Embassy Bangkok", kind: "embassy", address: "95 Wireless Road, Bangkok", lat: 13.736167, lon: 100.546444, src: "https://travel.state.gov/test", srcname: "travel.state.gov" }] };
/* road time by destination: Trauma Test 70 min, Sourced Trauma 40, Far North 10, Near 25, the airport 30 */
function secsTo(lon, lat) {
  const k = lat.toFixed(2) + "," + lon.toFixed(2);
  return { "12.60,100.90": 9000, "13.70,100.40": 4200, "13.80,100.56": 2400, "13.80,100.50": 600, "13.76,100.51": 1500, "13.69,100.75": 1800 }[k] ?? 700;
}
function osrm(url) {
  const pts = new URL(url).pathname.split("/").pop().split(";").slice(1).map((x) => x.split(",").map(Number));
  return { code: "Ok", durations: [[0].concat(pts.map((p) => secsTo(p[0], p[1])))], distances: [[0].concat(pts.map((p) => secsTo(p[0], p[1]) * 10))] };
}
function osrmRoute(url) {
  const pts = new URL(url).pathname.split("/").pop().split(";").map((x) => x.split(",").map(Number)), d = secsTo(pts[1][0], pts[1][1]);
  return { code: "Ok", routes: [{ duration: d, distance: d * 10, geometry: { type: "LineString", coordinates: [pts[0], [(pts[0][0] + pts[1][0]) / 2, pts[0][1]], pts[1]] },
    legs: [{ steps: [{ name: "Rama IV Road", distance: 5000 }, { name: "", distance: 50 }, { name: "Sukhumvit Road", ref: "3", distance: 2500 }, { name: "Soi 1", distance: 300 }] }] }] };
}
function iso(url) {
  const j = JSON.parse(new URL(url).searchParams.get("json")), c = j.locations[0], ring = (d) => [[c.lon - d, c.lat - d], [c.lon + d, c.lat - d], [c.lon + d, c.lat + d], [c.lon - d, c.lat + d], [c.lon - d, c.lat - d]];
  return { type: "FeatureCollection", features: j.contours.map((x) => ({ type: "Feature", properties: { contour: x.time }, geometry: { type: "Polygon", coordinates: [ring(x.time / 300)] } })) };
}
function vhMatrix(url) {
  const j = JSON.parse(new URL(url).searchParams.get("json"));
  return { sources_to_targets: [j.targets.map((t) => ({ time: secsTo(t.lon, t.lat), distance: secsTo(t.lon, t.lat) / 100 }))] };
}
/* a two-point Valhalla shape: polyline6 of [[lat, lon], [lat, lon]] */
function enc6(pts) {
  let out = "", pl = 0, pn = 0;
  const one = (v) => { v = v < 0 ? ~(v << 1) : v << 1; let s = ""; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
  for (const [la, lo] of pts) { const a = Math.round(la * 1e6), b = Math.round(lo * 1e6); out += one(a - pl) + one(b - pn); pl = a; pn = b; }
  return out;
}
function vhRoute(url) {
  const j = JSON.parse(new URL(url).searchParams.get("json")), a = j.locations[0], b = j.locations[1], d = secsTo(b.lon, b.lat);
  return { trip: { summary: { time: d, length: d / 100 }, legs: [{ shape: enc6([[a.lat, a.lon], [b.lat, b.lon]]), maneuvers: [{ street_names: ["Valhalla Road"], length: 4 }, { street_names: [], length: 0.1 }] }] } };
}
const WD = { results: { bindings: [
  { c: { value: "http://www.wikidata.org/entity/Q869" }, nLabel: { value: "191" }, u1Label: { value: "police" } },
  { c: { value: "http://www.wikidata.org/entity/Q869" }, nLabel: { value: "1669" }, d: { value: "emergency medical services number in Thailand" } },
  { c: { value: "http://www.wikidata.org/entity/Q869" }, nLabel: { value: "199" }, u2Label: { value: "Q12345" } }
] } };
/* Wikidata hospitals round the plan: one matches Trauma Test Hospital by location (30 m), one is far from every OSM hospital */
const WDH = { results: { bindings: [
  { h: { value: "http://www.wikidata.org/entity/Q900001" }, hLabel: { value: "Trauma Test Hospital" }, c: { value: "Point(100.4003 13.7002)" }, phone: { value: "+66 2 777 1000" }, web: { value: "https://trauma-test.example.org/" }, beds: { value: "250" } },
  { h: { value: "http://www.wikidata.org/entity/Q900002" }, hLabel: { value: "Elsewhere Hospital" }, c: { value: "Point(100.9 14.2)" }, phone: { value: "+66 2 000 0000" } }
] } };
function meteo() {
  const days = ["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"], ht = [], vis = [], g = [], lc = [], pr = [], at = [];
  days.forEach((d) => { for (let h = 0; h < 24; h++) { ht.push(d + "T" + String(h).padStart(2, "0") + ":00"); vis.push(d === "2026-10-01" && h === 5 ? 800 : 20000); g.push(10); lc.push(d === "2026-10-02" ? 95 : 20); pr.push(0); at.push(30); } });
  return { hourly: { time: ht, visibility: vis, wind_gusts_10m: g, cloud_cover_low: lc, precipitation: pr, apparent_temperature: at },
    daily: { time: days, sunrise: days.map((d) => d + "T23:00"), sunset: days.map((d) => d + "T11:10"), precipitation_sum: [10, 8, 6, 0, 25, 0], wind_gusts_10m_max: [10, 10, 10, 12, 35, 10],
      apparent_temperature_max: [33, 33, 33, 36, 40, 31], apparent_temperature_min: [24, 24, 24, 25, 25, 24] } };
}
/* OSAP's stored copy (data/medfac) for the fixture: every element in one 2-degree tile, the countries in reach listed as built */
const MF_ROWS = OSM.elements.map((e) => [e.type.charAt(0) + e.id, e.lat ?? e.center.lat, e.lon ?? e.center.lon, "th", e.tags]);
const MF_ALL = ["th", "kh", "la", "mm", "vn", "my"];
const mfIndex = (ccs, xs) => ({ v: 1, tile: 2, countries: Object.fromEntries(ccs.map((c) => [c, Object.assign({ at: "2026-09-30T02:00:00Z", n: {}, tiles: ["12_100"] }, (xs || []).includes(c) ? { x: { b: 2, d: 1, r: 1 } } : {})])), tiles: { "12_100": MF_ROWS.length } });
/* the stored blood services, chamber and air rescue base (data/medfac/x/th.json): the live extras answer without the embassy */
const MFX_TH = OSMX.elements.filter((e) => !e.tags.country).map((e) => [e.type.charAt(0) + e.id, e.lat, e.lon, "th", e.tags]);
async function open(opts, o) {
  o = typeof o === "object" ? o : { overpassFails: !!o };
  const overpassFails = o.overpassFails;
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [], calls = { overpass: 0, overpassX: 0, osrm: 0, route: 0, meteo: 0, wd: 0, iso: 0, vhm: 0, vhr: 0, medfac: 0 };
  const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(b) });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    if (/overpass|interpreter/.test(u)) {
      const q = decodeURIComponent(r.request().postData() || ""), x = /air_rescue_service/.test(q);
      if (x) { calls.overpassX++; return o.xFails ? r.fulfill({ status: 504, body: "" }) : J(r, OSMX); }
      if (/"country"="US"/.test(q)) { calls.overpassP = (calls.overpassP || 0) + 1; return J(r, { elements: OSMX.elements.filter((e) => e.tags.country) }); }
      calls.overpass++; return overpassFails ? r.fulfill({ status: 504, body: "" }) : J(r, OSM);
    }
    if (/\/table\/v1\//.test(u)) { calls.osrm++; return o.osrmFails ? r.fulfill({ status: 504, body: "" }) : J(r, osrm(u)); }
    if (/\/route\/v1\//.test(u)) { calls.route++; return o.osrmFails ? r.fulfill({ status: 504, body: "" }) : J(r, osrmRoute(u)); }
    if (/valhalla.*sources_to_targets/.test(u)) { calls.vhm++; return o.vhFails ? r.fulfill({ status: 504, body: "" }) : J(r, vhMatrix(u)); }
    if (/valhalla.*\/route\?/.test(u)) { calls.vhr++; return o.vhFails ? r.fulfill({ status: 504, body: "" }) : J(r, vhRoute(u)); }
    if (/valhalla/.test(u)) { calls.iso++; return J(r, iso(u)); }
    if (/query\.wikidata\.org/.test(u) && /wikibase%3Aaround|wikibase:around/.test(u)) { calls.wdh = (calls.wdh || 0) + 1; return o.wdFails ? r.fulfill({ status: 504, body: "" }) : J(r, WDH); }
    if (/query\.wikidata\.org/.test(u)) { calls.wd++; return J(r, WD); }
    if (/api\.open-meteo\.com\/v1\/forecast/.test(u)) { if (/hourly=visibility,wind_gusts_10m,cloud_cover_low/.test(u)) calls.meteo++; return J(r, meteo()); }
    return r.abort();
  });
  await ctx.route(/\/data\/medfac\//, (r) => {
    calls.medfac++;
    const u = r.request().url();
    if (!o.medfac) return r.fulfill({ status: 404, body: "" });
    if (/index\.json/.test(u)) return J(r, mfIndex(o.medfac, o.medfacX));
    const xm = /\/x\/([a-z]{2})\.json/.exec(u);
    if (xm) { calls.medfacX = (calls.medfacX || 0) + 1; return (o.medfacX || []).includes(xm[1]) ? J(r, xm[1] === "th" ? MFX_TH : []) : r.fulfill({ status: 404, body: "" }); }
    if (/t\/12_100\.json/.test(u)) return J(r, MF_ROWS);
    return r.fulfill({ status: 404, body: "" });
  });
  /* what hospitals state on their own websites (data/hospitals/<cc>/web.json) and the official records (th/registry.json):
     none unless a check supplies them */
  await ctx.route(/\/data\/hospitals\//, (r) => o.web === "fail" ? r.fulfill({ status: 503, body: "" }) : o.web && /\/th\/web\.json/.test(r.request().url()) ? J(r, o.web) :
    o.gov && /\/th\/registry\.json/.test(r.request().url()) ? J(r, o.gov) : o.phones !== null && /\/th\/phones\.json/.test(r.request().url()) ? J(r, o.phones || PHONES) : r.fulfill({ status: 404, body: "" }));
  /* the split view setting (shared with Find LZ, Watch, NAI/TAI) starts on; these checks start from the full window */
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); if (localStorage.getItem("osap.split") === null) localStorage.setItem("osap.split", "0"); } catch (e) {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base, { waitUntil: "domcontentloaded" }); await p.waitForFunction(() => window.TSAP && window.TSAP.areaApi && document.getElementById("atk-tools"), null, { timeout: 60000 });
  await p.waitForTimeout(3000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
  /* fixed "now" for the weather rows: 2026-09-30 12:00Z */
  await p.evaluate(() => { const T = Date.parse("2026-09-30T12:00:00Z"), R = Date.now; Date.now = () => T; window.__realNow = R; });
  await p.evaluate((S) => { window.ASAP_SOF = window.ASAP_SOF || {}; window.ASAP_SOF[window.TSAP.areaApi.cc || "th"] = Object.assign({ cc: "th", country: "Thailand" }, S); }, SOF);
  return { ctx, p, errors, calls };
}
const square = (c, d) => [[c[0] - d, c[1] - d], [c[0] - d, c[1] + d], [c[0] + d, c[1] + d], [c[0] + d, c[1] - d]];
async function areaMenu(p) {
  for (let i = 0; i < 2; i++) {
    await p.click('#atk-tools [data-atk="area"]'); await p.waitForTimeout(150);
    if (await p.evaluate(() => !document.getElementById("atk-pop").hidden)) break;
  }
  return p.textContent("#atk-pop");
}
/* the toolbar's Med plan button (it closes an open plan, so it is only pressed when the plan is shut) */
async function medBtn(p) {
  await p.evaluate(() => { const m = document.getElementById("atk-pop"); if (m && !m.hidden) document.querySelector('#atk-tools [data-atk="area"]').click(); });
  if (await p.evaluate(() => { const m = document.getElementById("medplan"); return !m || m.hidden; })) await p.click('#atk-tools [data-atk="medplan"]');
}
async function openPlan(p) {
  await medBtn(p);
  await p.waitForFunction(() => { const t = document.querySelector("#mp-fac table"), w = document.querySelector("#mp-wx table"); return t && w && /min/.test(document.getElementById("mp-fac").textContent); }, null, { timeout: 20000 });
}

// ---------- desktop ----------
{
  const { ctx, p, errors, calls } = await open({ viewport: { width: 1400, height: 900 } });
  await p.evaluate(() => { try { window.TSAP.areaApi.setArea(null); } catch (e) {} });
  ok(!/Medical plan/.test(await areaMenu(p)), "desktop: the Area menu no longer lists Medical plan");
  ok(await p.evaluate(() => { const b = document.querySelector('#atk-tools [data-atk="medplan"]'); return !!b && /Med plan/.test(b.textContent); }), "desktop: Med plan has its own toolbar button");
  await medBtn(p); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.querySelector('#atk-tools [data-atk="medplan"]').getAttribute("aria-pressed") === "true"), "desktop: the Med plan button shows pressed while the plan is open");
  ok(await p.evaluate(() => { const m = document.getElementById("medplan"); return !!m && !m.hidden && /Planned from a point, no drawn area needed/.test(m.textContent); }), "desktop: Medical plan with no area opens straight away on the map centre, no shape needed");
  await p.waitForFunction(() => { const t = document.querySelector("#mp-fac table"), w = document.querySelector("#mp-wx table"); return t && w; }, null, { timeout: 20000 }).catch(() => {});
  await p.evaluate(() => { const b = document.querySelector('#medplan [data-mp="close"]'); if (b) b.click(); }); await p.waitForTimeout(150);
  await p.evaluate((P) => window.TSAP.areaApi.setArea(P), square(C0, 0.02));
  await p.waitForTimeout(1500); Object.keys(calls).forEach((k) => { if (k !== "wd") calls[k] = 0; }); /* the checks below count the requests of one fresh open (Wikidata is cached a week on the device) */
  await p.evaluate(() => { const m = document.getElementById("atk-pop"); if (!m.hidden) document.querySelector('#atk-tools [data-atk="area"]').click(); });
  ok(await p.evaluate(() => document.querySelector('#atk-tools [data-atk="medplan"]').getAttribute("aria-pressed") === "false"), "desktop: closing the plan releases the Med plan button");
  ok(!/Medical plan/.test(await areaMenu(p)), "desktop: still not in the Area menu once an area is drawn");
  await openPlan(p);
  ok(await p.evaluate(() => !!window.OSAP_MEDPLAN && !document.getElementById("medplan").hidden), "desktop: the Med plan button opens the plan for the drawn area");
  ok(/Centred on the centre of the area/.test(await p.textContent("#medplan")), "desktop: with no point of injury set, the plan is centred on the area's centre");
  await p.waitForFunction(() => document.querySelectorAll("#mp-rt h4").length === 3 && !/Working out the route/.test(document.getElementById("mp-rt").textContent), null, { timeout: 10000 });
  const fac = await p.textContent("#mp-fac");
  const order = (await p.$$eval("#mp-fac table", (t) => [...t[0].querySelectorAll("tbody tr td:nth-child(2) b")].map((x) => x.textContent)));
  ok(order.join("|") === "Trauma Test Hospital|Sourced Trauma Centre|Far North Hospital|Near Hospital|Distant Burn Centre", "desktop: hospitals ranked by capability, then drive time: " + order.join(", "));
  ok(await p.evaluate(() => { const r = [...document.querySelectorAll("#mp-fac tbody tr")]; return /Primary/.test(r.find((x) => /Far North Hospital/.test(x.textContent)).textContent) && /Tertiary/.test(r[0].textContent); }), "desktop: the hospital table marks each pick's role");
  ok(/Trauma Level I \(official designation, reported\)/.test(fac) && /Level 1 trauma centre \(test\)/.test(fac) && await p.evaluate(() => [...document.querySelectorAll("#mp-fac a")].some((a) => a.href === "https://example.org/trauma")), "desktop: a stated trauma level shows as stated, with its source link");
  ok(/No verified trauma designation/.test(fac) && !/Role [123] equivalent/.test(fac) && /Observed T5 basic emergency facility \(inferred\); could be T4 if 24\/7 emergency department, blood bank and X-ray or ultrasound are confirmed/.test(fac), "desktop: an observed T-class with what would raise it; no Role estimate");
  ok(/No verified trauma designation/.test(fac) && !/Role [123] equivalent/.test(fac), "desktop: hospitals with no stated trauma level read Trauma level not known, never a Role estimate");
  ok(!/(Basic|Medium|High) \(estimated\)/.test(fac) && !/Not known: no services listed/.test(fac), "desktop: no Low, Medium or High ratings");
  ok(/Listed services: emergency department, 300 beds/.test(fac), "desktop: the services listed for each hospital are shown");
  ok(await p.evaluate(() => { const rows = [...document.querySelectorAll("#mp-fac tr")]; const nr = rows.find((r) => /Near Hospital/.test(r.textContent)), tr = rows.find((r) => /Trauma Test Hospital/.test(r.textContent));
    return !!nr && /No verified trauma designation/.test(nr.textContent) && /Not picked for any casualty type: the needed capabilities are not documented by a credible source/.test(nr.textContent) && !!tr && !/Not picked for any/.test(tr.textContent); }), "desktop: a hospital with no credibly documented capability is marked not picked; picked ones are not");
  ok(await p.evaluate(() => [...document.querySelectorAll("#mp-fac .mptier")].every((t) => /Primary, Secondary and Tertiary are chosen per casualty type from capabilities documented by a credible source/.test(t.title) && /never worked out from what a hospital has/.test(t.title))), "desktop: each level label explains the ranking rule");
  ok(/24-hour emergency \(Test wiki\)/.test(fac), "desktop: an OSM hospital is matched to its sourced record");
  ok(/10 min/.test(fac) && /25 min/.test(fac), "desktop: drive times shown (10 min, 25 min)");
  ok(/Near Hospital \(โรงพยาบาลใกล้\)/.test(fac) && order.length === 5, "desktop: a hospital mapped twice in OSM is listed once, with its other name");
  const gh = await p.$$eval("#mp-fac table", (t) => [...t[0].querySelectorAll("tbody tr")].map((r) => (r.querySelector(".mpgh") || {}).textContent || ""));
  ok(gh[0] === "Beyond golden hour" && gh[1] === "Inside golden hour" && gh[2] === "Inside golden hour", "desktop: golden-hour badges from treat-and-load plus drive: " + gh.join(", "));
  ok(/Helipad on site/.test(fac) || /helipad on site/.test(fac), "desktop: a helipad next to a hospital counts");
  ok(/47P [A-Z]{2} \d{4} \d{4}/.test(fac), "desktop: facilities carry MGRS grids");
  ok(/name withheld/.test(fac) && !/Somchai/.test(await p.textContent("#medplan")) && !/777 8888/.test(await p.innerHTML("#medplan")), "desktop: a clinic named after a doctor is withheld, with its phone");
  ok(/Community Health Centre 7/.test(fac) && !/Smile Dental/.test(fac), "desktop: public clinic listed, dentist left out");
  ok(await p.evaluate(() => !!document.querySelector('#mp-fac a[href="tel:+6629990000"]')) && /Website/.test(fac) && /Address: North Road, Testburi/.test(fac), "desktop: hospital phone, website and address shown");
  ok(/listed in OpenStreetMap/.test(fac), "desktop: each published number says where it is listed");
  await p.waitForFunction(() => /Wikidata Q900001/.test(document.getElementById("mp-fac").textContent), null, { timeout: 8000 }).catch(() => {});
  const wdRow = await p.evaluate(() => [...document.querySelectorAll("#mp-fac tbody tr")].map((r) => r.textContent).find((t) => /Trauma Test Hospital/.test(t)) || "");
  ok(/\+66 2 777 1000 \(Wikidata Q900001, matched by location, \d+ m\)/.test(wdRow) && /Website \(Wikidata Q900001/.test(wdRow) && !/listed in OpenStreetMap/.test(wdRow) && !/000 0000/.test(await p.textContent("#mp-fac")), "desktop: a hospital OSM lists without contacts gets Wikidata's phone and website, each labelled: " + wdRow.slice(0, 200));
  await p.waitForFunction(() => /Call centre: 1719/.test(document.getElementById("mp-fac").textContent), null, { timeout: 8000 }).catch(() => {});
  const phRow = await p.evaluate(() => [...document.querySelectorAll("#mp-fac tbody tr")].map((r) => r.innerHTML).find((t) => /Trauma Test Hospital/.test(t)) || "");
  ok(/Emergency: <a href="tel:027771669">02 777 1669<\/a> \(<a [^>]*href="https:\/\/trauma\.example\.org\/contact"[^>]*>the hospital's website<\/a>, read 2026-10-03\)/.test(phRow) && /Call centre: <a href="tel:1719">1719<\/a>/.test(phRow),
    "phones: a hospital's emergency line and call centre from its own website, each with its page and date");
  ok(!/02 000 0001/.test(await p.textContent("#mp-fac")) && /\+66 2 123 4567/.test(await p.textContent("#mp-fac")), "phones: a number OpenStreetMap lists is kept; the stored list only fills gaps");
  ok(/OSAP stored list of hospitals' published phone numbers.*read 2026-10-03, numbers for 2 hospitals in the country/.test(await p.textContent("#mp-src")), "phones: the sources list names the stored phone list and its date");
  ok(/flight|kn/i.test(fac) && /at 120 kn/.test(fac), "desktop: flight time from the POI at the stated cruise speed");
  const rt = await p.textContent("#mp-rt");
  ok(/Primary: H3 Far North Hospital/.test(rt) && /Secondary: H2 Sourced Trauma Centre/.test(rt) && /Tertiary: H1 Trauma Test Hospital/.test(rt), "desktop: routes to the Primary, Secondary and Tertiary hospitals");
  const pst = await p.textContent("#mp-pst");
  ok(/Primary\s*H3 Far North Hospital/.test(pst) && /Secondary\s*H2 Sourced Trauma Centre/.test(pst) && /Tertiary\s*H1 Trauma Test Hospital/.test(pst), "desktop: Primary, Secondary and Tertiary named at the top of the plan");
  ok(/Primary for major trauma: Trauma Level IV \(official designation, reported\), \d+ min from injury by (road|air) \(inside golden hour\); documented: official trauma designation/.test(pst) && /Tertiary for major trauma: Trauma Level I \(/.test(pst), "desktop: each pick has a one-line reason: " + pst.slice(0, 200));
  const roles = await p.evaluate(() => [...document.querySelectorAll("#mp-pst table.mproles tbody tr")].map((r) => [...r.children].map((c) => c.textContent)));
  ok(roles.length === 4 && /^Major trauma/.test(roles[0][0]) && /Far North Hospital/.test(roles[0][1]) && /Sourced Trauma Centre/.test(roles[0][2]) && /Trauma Test Hospital/.test(roles[0][3])
    && /Severe head injury/.test(roles[1][0]) && /Distant Burn Centre/.test(roles[1][3]) && /Wider search: nothing within \d+ km has this documented/.test(roles[1][3]) && /Distant Burn Centre/.test(roles[2][3])
    && /Complex limb/.test(roles[3][0]) && /Gap/.test(roles[3][3]) && /No hospital within \d+ km, nor any of the 1 documented hospitals farther out \(up to 1500 km\), has documented orthopaedic/i.test(roles[3][3])
    && /Nearest with part documented: H\d+ Distant Burn Centre, [\d.]+ km \(plastic surgery and ICU documented; orthopaedic surgery and vascular surgery not\)/i.test(roles[3][3]),
    "desktop: a role table per casualty type; with nothing near documented, the wider search finds the nearest documented hospital; a type no documented hospital covers is a gap that says so " + JSON.stringify(roles).slice(0, 400));
  ok(await p.evaluate(() => { const r = [...document.querySelectorAll("#mp-fac tbody tr")].find((x) => /Distant Burn Centre/.test(x.textContent)); return !!r && /Beyond the \d+ km search: added as a hospital with documented capability/.test(r.textContent); }),
    "desktop: the hospital found by the wider search is listed and marked");
  ok(await p.evaluate(() => { const f = window.OSAP_MEDPLAN._roles().filter((x) => x.casualty_category === "cat.major_burn" && x.role === "tertiary")[0]; return f.state === "filled" && f.choice.met.join() === "spec.burn,cc.icu,surg.plastic"; }),
    "desktop: capabilities documented one by one on the hospital's own website count as credible; Wikipedia, the record's main source, does not");
  /* bypass by time to required care: with air evacuation on, Tertiary (Trauma Test) is inside the golden hour by air, so
     Primary and Secondary are both bypassed and kept as stabilisation options */
  const bt = await p.evaluate(() => { const R = window.OSAP_MEDPLAN._roles().filter((x) => x.casualty_category === "cat.major_trauma"), g = (k) => R.filter((x) => x.role === k)[0];
    return { p: [g("primary").stop, g("primary").stabilisation_option, (g("secondary").bypassed[0] || {}).reason, !!(g("secondary").bypassed[0] || {}).via_time], s: g("secondary").stop, t: [g("tertiary").stop, g("tertiary").via && g("tertiary").via.from] }; });
  ok(JSON.stringify(bt) === JSON.stringify({ p: [false, true, "direct_inside_golden_hour", true], s: false, t: [true, "secondary"] }) && /POI → Tertiary/.test(roles[0][0]) && /Bypass: go direct to Secondary/.test(roles[0][1]) && /Stabilisation option/.test(roles[0][1]) && /Bypass: go direct to Tertiary/.test(roles[0][2]),
    "desktop: bypass by time to required care: direct to Tertiary by air inside the golden hour, Primary and Secondary kept as stabilisation options " + JSON.stringify(bt) + " " + roles[0].join(" | ").slice(0, 300));
  await p.fill('#mp-pst [data-mpf="dwell"]', "0"); await p.waitForTimeout(1100);
  ok(/its time there \(0 min\), transfer activation/.test(await p.textContent("#mp-pst")), "desktop: the time at a stop can be set, and the comparison uses it");
  await p.fill('#mp-pst [data-mpf="handoff"]', "2"); await p.waitForTimeout(1100);
  ok(/plus handoff \(2 min\)/.test(await p.textContent("#mp-pst")) && /Time to required care direct: to Trauma Test Hospital \d+ min \+ handoff 2 min = \d+ min; required care not confirmed available now\./.test(await p.textContent("#mp-pst")), "phase 2: handoff can be set, and the Tertiary shows its time to required care part by part, not confirmed now");
  await p.fill('#mp-pst [data-mpf="dwell"]', "30"); await p.waitForTimeout(1100);
  ok(!/Trauma Test Hospital/.test(roles[1][1] + roles[2][1] + roles[3][1]) && /Head trauma \(neurosurgery\):.*for information; the planned destination is the Severe head injury row/.test(await p.textContent("#mp-pst")), "desktop: OpenStreetMap-only neurosurgery never makes a severe head injury pick (shown for information only)");
  ok(/Phone: \+66 2 777 1000 \(Wikidata Q900001/.test(pst) && /Listed: /.test(pst) && await p.evaluate(() => document.querySelectorAll("#mp-pst [data-mp-assess]").length === 3 && document.querySelectorAll("#mp-pst [data-mp-go]").length === 3), "desktop: each pick shows its contacts, what is listed, and its own Assessment and Map buttons");
  ok(await p.evaluate(() => [...document.querySelectorAll("#mp-pst [data-mp-assess]")].every((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.right <= innerWidth; })), "desktop: the picks' Assessment buttons are on screen");
  ok(await p.evaluate(() => ["PRI", "SEC", "TER"].every((t) => [...document.querySelectorAll(".mpicon")].some((m) => m.textContent === t))), "desktop: the three picks are marked on the map");
  ok(/Main roads: Rama IV Road \(5\.0 km\) → 3 Sukhumvit Road \(2\.5 km\)/.test(rt), "desktop: each route lists its main roads");
  const ghs = await p.textContent("#mp-gh");
  ok(/60 minutes from injury/.test(ghs) && /10 minutes to treat and load/.test(ghs) && /green 30 minutes/.test(ghs) && /light blue ring/.test(ghs), "desktop: golden-hour section states its thresholds, the road reach and the air rings");
  const ems = await p.textContent("#mp-ems");
  ok(/1669: emergency medical services number in Thailand/.test(ems) && (await p.$$eval("#mp-ems li", (l) => l.map((x) => x.textContent))).includes("199") && !/Q12345/.test(ems) && /191: police/.test(ems) && ems.indexOf("1669") < ems.indexOf("191"), "desktop: local emergency numbers, ambulance first");
  ok(await p.evaluate(() => [...document.querySelectorAll("#mp-ems a")].some((a) => a.href === "https://www.wikidata.org/wiki/Q869#P2852")), "desktop: emergency numbers link to their Wikidata source");
  ok(/City Ambulance Station/.test(ems) && /111 2222/.test(ems), "desktop: ambulance stations near the POI with their published phone");
  const mev = await p.textContent("#mp-mev");
  ok(/Test Air Rescue/.test(mev) && /555 0100/.test(mev) && /to the POI at 120 kn/.test(mev), "desktop: air rescue base with phone and flight time to the POI");
  ok(/International SOS assistance centre, Bangkok/.test(mev) && /\+66 2 206 7777/.test(mev) && /read 2026-10-01/.test(mev) && await p.evaluate(() => [...document.querySelectorAll("#mp-mev a")].some((a) => a.href === "https://www.internationalsos.com/assistance-centres")) && /International SOS assistance centres/.test(await p.textContent("#mp-src")), "desktop: the nearest International SOS assistance centres show with their published numbers and source");
  ok(/TRICARE Overseas, Pacific Area regional call centre: \+65-6339-2676/.test(mev) && !/Eurasia-Africa/.test(mev) && await p.evaluate(() => [...document.querySelectorAll("#mp-mev a")].some((a) => /web\.archive\.org\/web\/20260423013428\/https:\/\/www\.tricare\.mil/.test(a.href))), "desktop: the TRICARE Overseas Pacific call centre shows in medevac, with its source");
  ok(/launch, fly in, 10 min on the ground, fly to H1/.test(mev) && /(Inside|Beyond) golden hour|golden-hour limit/.test(mev), "desktop: medevac call-to-hospital time against the golden hour");
  const air = await p.textContent("#mp-air");
  ok(/Riverside Pad/.test(air) && /Test Airfield/.test(air) && /VTXX/.test(air), "desktop: helipads and airfields listed with ICAO code");
  ok(await p.evaluate(() => document.querySelectorAll("#mp-air table")[0].querySelectorAll("tbody tr").length === 2), "desktop: disused helipad left out");
  const wx = await p.textContent("#mp-wx");
  ok(/2026-10-01/.test(wx) && /visibility below 1\.6 km/.test(wx) && /gusts to 35 kn/.test(wx) && /high heat-injury risk/.test(wx), "desktop: weather flags from the rules (visibility, gusts, heat)");
  ok(/low cloud cover up to 95%/.test(wx), "desktop: low cloud flag");
  ok(!/2026-09-29/.test(wx), "desktop: past days are not listed as forecast");
  ok(/24 mm of rain in the last 3 days/.test(wx) && /ground is probably wet/.test(wx), "desktop: ground state from the last 3 days of rain (24 mm: wet)");
  ok(calls.overpass === 1 && calls.overpassX === 1 && calls.osrm === 1 && calls.route === 3 && calls.meteo === 1 && calls.wd === 1 && calls.iso === 1 && calls.vhm === 0, "desktop: one request per source, three routes " + JSON.stringify(calls));
  /* head trauma (Shane): where neurosurgery is, sourced, else the likely place labelled as an estimate */
  const hd = await p.evaluate(() => (document.querySelector("#mp-pst .mpneuro") || {}).textContent || "");
  ok(/^Head trauma \(neurosurgery\):/.test(hd) && /H\d+ Trauma Test Hospital, \d+ min from injury by (air|road)/.test(hd) && /neurosurgery stated by OpenStreetMap healthcare:speciality/.test(hd) && !/Not known/.test(hd), "head trauma: the nearest hospital that states neurosurgery is named with its time and source: " + hd.slice(0, 220));
  /* the nearest blood bank (Shane) */
  await p.waitForFunction(() => /Test National Blood Centre/.test(document.getElementById("mp-fac").textContent), null, { timeout: 8000 }).catch(() => {});
  const bl = await p.evaluate(() => { const f = document.getElementById("mp-fac").textContent; return { f: f.slice(f.indexOf("Nearest blood bank"), f.indexOf("Nearest blood bank") + 400), mk: [...document.querySelectorAll(".mpicon.bl")].map((m) => m.textContent) }; });
  ok(/Test National Blood Centre\s*Blood bank/.test(bl.f) && /\+66 2 256 4300/.test(bl.f) && /Test Donation Room\s*Blood donation centre/.test(bl.f) && /km/.test(bl.f) && bl.mk.includes("B1") && bl.mk.includes("B2"), "blood: the nearest blood banks are listed with contacts, distance and their own map marks " + JSON.stringify(bl).slice(0, 260));
  /* the nearest dive decompression chamber (Shane) */
  const dc = await p.evaluate(() => { const f = document.getElementById("mp-fac").textContent, i = f.indexOf("Nearest dive decompression"); return { f: f.slice(i, i + 520), mk: [...document.querySelectorAll(".mpicon.dc")].map((m) => m.textContent) }; });
  ok(/Test Hyperbaric Centre/.test(dc.f) && /healthcare:speciality=hyperbaric_medicine/.test(dc.f) && /\+66 38 000 911/.test(dc.f) && /km/.test(dc.f) && /fly as low as safely possible/.test(dc.f) && dc.mk.includes("D1"), "chamber: the nearest decompression chamber is listed with its source, contacts, distance, a D mark and the low-altitude note " + JSON.stringify(dc).slice(0, 240));
  /* air times count the aircraft's flight from its base to the POI (Shane) */
  await p.waitForFunction(() => /Aircraft base: Test Air Rescue/.test(document.getElementById("mp-gh").textContent), null, { timeout: 8000 }).catch(() => {});
  const airMin = () => p.evaluate(() => { const m = /(\d+) min from injury by air/.exec(document.getElementById("mp-pst").textContent) || /(\d+) h (\d+) min from injury by air/.exec(document.getElementById("mp-pst").textContent); return m ? +m[1] : null; });
  const ab = await p.evaluate(() => ({ gh: document.getElementById("mp-gh").textContent, mev: document.getElementById("mp-mev").textContent, fac: document.getElementById("mp-fac").textContent }));
  const withBase = await airMin();
  ok(/Aircraft base: Test Air Rescue, [\d.]+ km from the POI, \d+ min to fly to it \(nearest air rescue base in OpenStreetMap\)/.test(ab.gh) && /Aircraft base used for every air time: Test Air Rescue/.test(ab.mev) && /from the call, with the aircraft's flight in/.test(ab.fac), "air times: the aircraft's base is named and its flight to the POI is counted " + ab.gh.slice(ab.gh.indexOf("Aircraft base"), ab.gh.indexOf("Aircraft base") + 120));
  await p.selectOption("#medplan [data-mp-base]", "poi");
  await p.waitForFunction(() => /set to start at the point of injury/.test(document.getElementById("mp-gh").textContent), null, { timeout: 8000 }).catch(() => {});
  const atPoi = await airMin();
  ok(withBase != null && atPoi != null && atPoi < withBase, "air times: starting the aircraft at the POI drops the flight in (" + withBase + " → " + atPoi + " min)");
  await p.selectOption("#medplan [data-mp-base]", "");
  await p.waitForFunction(() => /nearest air rescue base in OpenStreetMap/.test(document.getElementById("mp-gh").textContent), null, { timeout: 8000 }).catch(() => {});
  ok((await airMin()) === withBase, "air times: back to the nearest air rescue base");
  /* turning a hospital off: it leaves the picks and the map, the next one is picked, and the choice is kept */
  const offId = await p.evaluate(() => { const r = [...document.querySelectorAll("#mp-fac tbody tr")].find((x) => /Sourced Trauma Centre/.test(x.textContent)); return r && r.querySelector("[data-mp-off]").getAttribute("data-mp-off"); });
  const mk0 = await p.evaluate(() => document.querySelectorAll(".mpicon").length);
  await p.click(`#mp-fac [data-mp-off="${offId}"]`);
  await p.waitForFunction(() => /Secondary\s*H\d+ Trauma Test Hospital/.test(document.getElementById("mp-pst").textContent), null, { timeout: 8000 }).catch(() => {});
  const offd = await p.evaluate((id) => ({ pst: document.getElementById("mp-pst").textContent, row: [...document.querySelectorAll("#mp-fac tbody tr")].find((x) => x.querySelector(`[data-mp-off="${id}"]`)).className,
    mk: document.querySelectorAll(".mpicon").length, saved: localStorage.getItem("osap-medplan-off-th"), note: /1 hospital is turned off/.test(document.getElementById("mp-fac").textContent) }), offId);
  ok(!/Sourced Trauma Centre/.test(offd.pst) && /Secondary\s*H\d+ Trauma Test Hospital/.test(offd.pst) && offd.row === "mpoff" && offd.note && offd.mk === mk0 - 1 && JSON.parse(offd.saved || "[]").includes(offId), "desktop: unticking a hospital drops it from the picks (the next one is picked), greys its row and is kept on the device " + JSON.stringify(offd).slice(0, 220));
  await p.click('#medplan [data-mp="allon"]');
  await p.waitForFunction(() => /Primary\s*H3 Far North Hospital/.test(document.getElementById("mp-pst").textContent), null, { timeout: 8000 }).catch(() => {});
  ok(/Primary\s*H3 Far North Hospital/.test(await p.textContent("#mp-pst")) && !(await p.$("#mp-fac tr.mpoff")), "desktop: Turn all back on restores the picks");
  await p.click('#mp-pst [data-mp-offbtn]');
  await p.waitForFunction(() => !/Primary\s*H\d+ Far North/.test(document.getElementById("mp-pst").textContent), null, { timeout: 8000 }).catch(() => {});
  ok(/Primary\s*H\d+ Sourced Trauma Centre/.test(await p.textContent("#mp-pst")) && !!(await p.$("#mp-fac tr.mpoff")), "desktop: Turn off on a pick drops it and picks the next");
  /* Shane 2026-10-02: with every documented hospital off, nothing is picked, and an undocumented hospital is never put in */
  /* the third off makes the wider search's hospital (documented 24-hour emergency, CT and ICU, beyond the radius) the Primary */
  for (let i = 0; i < 2; i++) { await p.click('#mp-pst [data-mp-offbtn]'); await p.waitForTimeout(400); }
  await p.waitForFunction(() => /Primary\s*H\d+ Distant Burn Centre/.test(document.getElementById("mp-pst").textContent), null, { timeout: 8000 }).catch(() => {});
  ok(/Primary\s*H\d+ Distant Burn Centre/.test(await p.textContent("#mp-pst")) && /found by the wider search \(nothing nearer has it documented\)/.test(await p.textContent("#mp-pst")), "desktop: with every documented hospital near turned off, the nearest documented one farther out is the Primary, and says why");
  await p.click('#mp-pst [data-mp-offbtn]'); await p.waitForTimeout(400);
  await p.waitForFunction(() => /No Primary, Secondary or Tertiary/.test(document.getElementById("mp-pst").textContent), null, { timeout: 8000 }).catch(() => {});
  const none = await p.textContent("#mp-pst .mpwarn");
  ok(/No Primary, Secondary or Tertiary for major trauma: no hospital within \d+ km, nor OSAP's documented hospitals farther out \(up to 1500 km\), has the needed capabilities documented by a credible source \(or the ones that do are turned off\)/.test(none) && /reference only and are not eligible/.test(none) && !/Near Hospital/.test(none)
    && (await p.evaluate(() => window.OSAP_MEDPLAN._picks().length)) === 0, "desktop: with no documented hospital, the plan says so plainly and picks none, never an undocumented one: " + none.slice(0, 160));
  await p.click('#medplan [data-mp="allon"]');
  await p.waitForFunction(() => /Primary\s*H3 Far North Hospital/.test(document.getElementById("mp-pst").textContent), null, { timeout: 8000 }).catch(() => {});
  ok(/no stored copy|not read: HTTP 404/.test(await p.textContent("#mp-src")), "desktop: with no stored copy, the plan says so and asks OpenStreetMap live");
  ok(await p.evaluate(() => document.querySelectorAll(".mpicon").length === 16), "desktop: numbered marks on the map (centre, 5 hospitals incl. the wider search, 2 clinics, ambulance station, 2 helipads, airfield, air rescue base, 2 blood services, 1 chamber)");
  const lines = () => p.evaluate(() => { let r = 0, g = 0, a = 0; window.__asapMap.eachLayer((l) => { if (l instanceof L.Polygon) { if (/#1e7a3a|#c77700/.test(l.options.color)) g++; } else if (l instanceof L.Polyline && /#D7141A|#222|#6a3d9a/.test(l.options.color)) r++; else if (l instanceof L.Circle && /#6fa8dc|#1d5fa8/.test(l.options.color)) a++; }); return { r, g, a }; });
  const ln = await lines();
  ok(ln.r === 3 && ln.g === 2 && ln.a === 2, "desktop: three routes, two road-reach outlines and two air rings drawn on the map " + JSON.stringify(ln));
  await p.uncheck('#mp-gh [data-mp-opt="ar"]'); await p.waitForTimeout(200);
  const ln2 = await lines();
  await p.uncheck('#mp-gh [data-mp-opt="gr"]'); await p.waitForTimeout(200);
  const ln3 = await lines();
  ok(ln2.a === 0 && ln2.g === 2 && ln3.g === 0 && ln3.r === 3, "desktop: air and ground rings switch off separately " + JSON.stringify([ln2, ln3]));
  await p.check('#mp-gh [data-mp-opt="ar"]'); await p.check('#mp-gh [data-mp-opt="gr"]'); await p.waitForTimeout(200);
  ok(JSON.stringify(await lines()) === JSON.stringify(ln), "desktop: and back on");
  await p.uncheck('#mp-gh [data-mp-opt="air"]'); await p.waitForTimeout(300);
  ok(/by road/.test(await p.textContent("#mp-pst")) && !/by air/.test(await p.textContent("#mp-pst")), "desktop: with air evacuation off, the picks use road time only");
  /* by road, Tertiary (80 min with treat-and-load) is beyond the golden hour, so Secondary (50 min) becomes a planned stop */
  const road = await p.evaluate(() => [...document.querySelectorAll("#mp-pst table.mproles tbody tr")][0].textContent);
  ok(/POI → Secondary → Tertiary/.test(road) && /Reached via Secondary in about .*beyond the golden hour/.test(road), "desktop: by road, Tertiary beyond the golden hour, so Secondary is a planned stop " + road.slice(0, 260));
  /* Primary is the quickest hospital that gives a meaningful, credibly documented increase in care, never just the closest:
     with Far North three hours away, Near Hospital (25 min, OpenStreetMap and wiki only) is passed over with its reason */
  const far = await p.evaluate(() => {
    const M = window.OSAP_MEDPLAN, f = M._picks()[0].f, s0 = f.s; f.s = 3 * 3600;
    const r = M._roles().filter((x) => x.casualty_category === "cat.major_trauma" && x.role === "primary")[0], out = { pick: r.choice && r.choice.f.name, by: r.bypassed.map((b) => b.f.name + ":" + b.reason) };
    f.s = s0; return out;
  });
  ok(far.pick === "Sourced Trauma Centre" && far.by.includes("Near Hospital:receiving_capability_unconfirmed"), "desktop: the closest hospital is not Primary without documented capability; it is listed as bypassed with the reason " + JSON.stringify(far));
  await p.check('#mp-gh [data-mp-opt="air"]'); await p.waitForTimeout(300);
  /* side panel: the plan moves to the side and the map beside it stays usable */
  await p.click('#medplan [data-mp="dock"]'); await p.waitForTimeout(200);
  const dk = await p.evaluate(() => {
    const el = document.getElementById("medplan"), r = el.querySelector(".mpbox").getBoundingClientRect(), hit = document.elementFromPoint(40, Math.round(innerHeight / 2));
    return { dock: el.classList.contains("dock"), left: Math.round(r.left), w: Math.round(r.width), vw: innerWidth, map: !!(hit && hit.closest(".leaflet-container")), btn: el.querySelector('[data-mp="dock"]').textContent, modal: el.getAttribute("aria-modal"), kept: localStorage.getItem("osap.split") };
  });
  ok(dk.dock && dk.left > dk.vw / 2 - 2 && dk.map && dk.btn === "Full window" && dk.modal === "false" && dk.kept === "1", "desktop: Side panel moves the plan right and leaves the map usable " + JSON.stringify(dk));
  await p.click('#mp-fac tr:has-text("Far North Hospital") [data-mp-go]'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => !document.getElementById("medplan").hidden && !!document.querySelector(".mpicon")), "desktop: Map on a hospital keeps the side panel open with the plan on the map");
  await p.click('#medplan [data-mp="dock"]'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => !document.getElementById("medplan").classList.contains("dock") && document.querySelector('#medplan [data-mp="dock"]').textContent === "Side panel" && localStorage.getItem("osap.split") === "0"), "desktop: Full window puts it back (one split view setting)");
  ok(await p.evaluate(() => /Automatic draft/.test(document.querySelector("#medplan .mphead").textContent) && !/AI generated/.test(document.getElementById("medplan").textContent)), "desktop: labelled Automatic draft, no AI tag");
  ok(/published numbers of institutions/.test(await p.textContent("#medplan")), "desktop: the plan says how phone numbers are sourced");
  await p.waitForFunction(() => /^[0-9a-f]{64}$/.test((document.getElementById("mp-fp") || {}).textContent || ""), null, { timeout: 5000 }).catch(() => {});
  ok(/^[0-9a-f]{64}$/.test(await p.textContent("#mp-fp")), "desktop: plan fingerprint is a SHA-256");
  // cruise speed changes flight times without new requests
  await p.fill('#mp-mev [data-mpf="rwkn"]', "240");
  await p.waitForFunction(() => /to the POI at 240 kn/.test(document.getElementById("mp-mev").textContent), null, { timeout: 5000 }).catch(() => {});
  ok(/to the POI at 240 kn/.test(await p.textContent("#mp-mev")) && calls.overpass === 1, "desktop: a new cruise speed recomputes flight times on the device");
  // out of country
  await p.check('#mp-oc [data-mp-oc]');
  await p.waitForFunction(() => /D1/.test(document.getElementById("mp-oc").textContent) && /Road route to P1/.test(document.getElementById("mp-oc").textContent), null, { timeout: 15000 });
  const oc = await p.textContent("#mp-oc");
  ok(/Test International/.test(oc) && /VTTT \/ TTT/.test(oc) && /30 min/.test(oc), "out of country: departure airport with drive time");
  ok(/International SOS assistance centre, (Bangkok|Kuala Lumpur|Singapore)/.test(oc), "out of country: International SOS assistance centres listed with the emergency contacts");
  ok(/Receiving hospitals in nearby countries/.test(oc) && await p.evaluate(() => document.querySelectorAll("#mp-oc tbody tr").length >= 2), "out of country: sourced hospitals in nearby countries");
  ok(/at 250 kn \+ 15 min launch/.test(oc), "out of country: flight times state the speed and launch time");
  ok(/U\.S\. Embassy Bangkok/.test(oc) && /205 4000/.test(oc) && /1-888-407-4747/.test(oc) && /\+1 202-501-4444/.test(oc) && /travel\.state\.gov/.test(oc), "out of country: embassy address and phone, State Department emergency numbers with source");
  ok(await p.evaluate(() => [...document.querySelectorAll(".mpicon")].some((m) => m.textContent === "P1")), "out of country: the airport is marked on the map");
  /* strategic evacuation out of Asia-Pacific: east through Hawaii to a west-coast Level I, or west to Germany */
  const se = await p.evaluate(() => [...document.querySelectorAll("#mp-oc table.mpse tbody tr")].map((r) => r.textContent));
  ok(se.length === 2 && /^West\s*Suggested/.test(se[0]) && /Singapore General Hospital.*Landstuhl Regional Medical Center.*Level II trauma centre, ACS verified/.test(se[0]) &&
    /^East/.test(se[1]) && /U\.S\. Naval Hospital Okinawa.*Tripler Army Medical Center.*UC San Diego Health, Hillcrest.*Level I trauma centre/.test(se[1]), "out of country: two strategic chains, shorter first, each stop with its level and source: " + se.map((x) => x.slice(0, 90)).join(" | "));
  ok(/at 450 kn with 2 h on the ground/.test(oc) && /\d+ h \d{2} min/.test(se[0]), "out of country: chain times are labelled estimates at the stated speed");
  ok(await p.evaluate(() => ["HAW", "DEU", "SGP", "JPN", "USA"].every((t) => [...document.querySelectorAll(".mpicon")].some((m) => m.textContent === t))), "out of country: every chain stop is marked on the map");
  await p.click('#medplan [data-mp="dock"]'); await p.click('#mp-oc [data-mp="strat"]'); await p.waitForTimeout(400);
  ok(await p.evaluate(() => window.__asapMap.getZoom() <= 4 && !document.getElementById("medplan").hidden), "out of country: Show on the map zooms out to the whole chain, beside the side panel");
  await p.click('#medplan [data-mp="dock"]');
  await p.fill('#mp-oc [data-mpf="sjkn"]', "300");
  await p.waitForFunction(() => /at 300 kn with 2 h/.test(document.getElementById("mp-oc").textContent), null, { timeout: 5000 }).catch(() => {});
  ok(/at 300 kn with 2 h/.test(await p.textContent("#mp-oc")), "out of country: a new strategic cruise speed recomputes the chains");
  await p.fill('#mp-oc [data-mpf="sjkn"]', "450"); await p.waitForTimeout(1200);
  // point of injury picked on the map
  await p.click('#medplan [data-mp="pick"]');
  ok(await p.evaluate(() => document.getElementById("medplan").hidden && !!document.getElementById("mp-pickbar")), "POI: Pick on map hides the plan and asks for a tap");
  const box = await p.evaluate(() => { const r = window.__asapMap.getContainer().getBoundingClientRect(); return { x: r.left + r.width / 2 + 40, y: r.top + r.height / 2 + 30 }; });
  await p.mouse.click(box.x, box.y);
  await p.waitForFunction(() => !document.getElementById("medplan").hidden && /Centred on the anticipated point of injury/.test(document.getElementById("medplan").textContent), null, { timeout: 5000 });
  ok(/^\d{2}[A-Z] [A-Z]{2} \d{4} \d{4}$/.test(await p.inputValue("#mpf-poi")), "POI: the tapped point fills the POI grid: " + await p.inputValue("#mpf-poi"));
  await p.waitForFunction(() => document.querySelector("#mp-fac table"), null, { timeout: 10000 });
  ok(calls.overpass === 2 && calls.osrm >= 3 && await p.evaluate(() => [...document.querySelectorAll(".mpicon")].some((m) => m.textContent === "POI")), "POI: everything is looked up again from the POI and it is marked on the map");
  // a typed POI
  await p.fill("#mpf-poi", "13.7600, 100.5100"); await p.click('#medplan [data-mp="setpoi"]');
  await p.waitForFunction(() => /13\.76000, 100\.51000/.test(document.getElementById("medplan").textContent), null, { timeout: 5000 });
  ok(true, "POI: a typed lat, lon becomes the POI");
  await p.fill("#mpf-poi", "nowhere"); await p.click('#medplan [data-mp="setpoi"]');
  ok(/Not a grid/.test(await p.textContent("#medplan .mppoi")), "POI: a typed non-grid says so");
  await p.waitForFunction(() => document.querySelector("#mp-air table"), null, { timeout: 10000 });
  // Use as HLZ fills the field and it is kept on the device
  await p.click('#mp-air [data-mp-set="hlz"]');
  const hlz = await p.inputValue("#mpf-hlz1");
  ok(/^\d{2}[A-Z] [A-Z]{2} \d{4} \d{4}/.test(hlz), "desktop: Use as HLZ fills the HLZ with the grid: " + hlz);
  await p.fill("#mpf-unit", "Test element"); await p.fill("#mpf-ccp1", "13.7400, 100.4900"); await p.fill("#mpf-medevac1", "Test Air Rescue, +66 2 555 0100"); await p.waitForTimeout(900);
  const kept = await p.evaluate(() => { const k = Object.keys(localStorage).filter((x) => /^osap-medplan-[a-z]+$/.test(x))[0]; return k && JSON.parse(localStorage.getItem(k)); });
  ok(kept && kept.unit === "Test element" && kept.hlz1 === hlz && kept.oc === 1, "desktop: fields kept on this device");
  ok(/Emergency medevac provider and phone: Test Air Rescue/.test(await p.textContent("#mp-mev")), "desktop: the medevac provider typed in prints in the medevac section");
  ok(await p.evaluate(() => [...document.querySelectorAll("#mp-from option")].some((o) => o.value === "ccp1")), "desktop: the typed CCP is offered as the centre");
  const before = calls.osrm;
  await p.selectOption("#mp-from", "ccp1");
  await p.waitForFunction(() => /Centred on Casualty collection point/.test(document.getElementById("medplan").textContent) && document.querySelector("#mp-fac table"), null, { timeout: 10000 });
  ok(calls.osrm > before, "desktop: drive times recomputed from the CCP");
  ok(await p.inputValue("#mpf-unit") === "Test element", "desktop: fields survive a new centre");
  // Plan status (Build Plan v2 phase 0): one plan record, checked by fixed rules
  await p.waitForFunction(() => window.OSAP_MEDPLAN_MODEL && /AMBER|GREEN/.test((document.querySelector("#mp-val .mpvs") || {}).textContent || ""), null, { timeout: 20000 });
  const vs0 = await p.evaluate(() => ({ t: document.querySelector("#mp-val .mpvs").textContent, n: document.querySelectorAll("#mp-val li").length, txt: document.getElementById("mp-val").textContent }));
  ok(vs0.n >= 10 && /Definitive care facility/.test(vs0.txt) && /Definitive facility acceptance/.test(vs0.txt), "plan status: the plan is checked by fixed rules and the result shown (" + vs0.t + ", " + vs0.n + " checks)");
  await p.fill("#mpf-recv1", "Nowhere Memorial Hospital");
  await p.waitForFunction(() => /RED/.test((document.querySelector("#mp-val .mpvs") || {}).textContent || ""), null, { timeout: 10000 });
  ok(/does not match the calculated definitive destination/.test(await p.textContent("#mp-val")), "plan status: a receiving facility in unit details that is not the calculated destination is a blocking error");
  await p.click('#medplan [data-mp="print"]');
  const held = await p.evaluate(() => ({ dis: document.getElementById("mpd-print").disabled, msg: (document.getElementById("mpd-held") || {}).textContent || "" }));
  ok(held.dis && /^Blocking error: .*Nowhere Memorial Hospital/.test(held.msg), "plan status: printing is held while a blocking error stands: " + held.msg.slice(0, 120));
  await p.click("#mpd-close");
  await p.fill("#mpf-recv1", "");
  await p.waitForFunction(() => !/RED/.test((document.querySelector("#mp-val .mpvs") || {}).textContent || ""), null, { timeout: 10000 });
  ok(true, "plan status: clearing the receiving facility clears the blocking error");
  // Print view: every page, with the map, then Print
  await p.click('#medplan [data-mp="print"]');
  await p.waitForFunction(() => /^data:image\/png/.test((document.getElementById("mpd-map") || {}).src || ""), null, { timeout: 20000 });
  const pv = await p.evaluate(() => { const b = document.getElementById("brief"), d = b.querySelector(".mpdoc"); return { shown: !b.hidden && document.documentElement.classList.contains("briefing"), t: d.textContent, h3: [...d.querySelectorAll("h3")].map((h) => h.textContent), btn: d.querySelectorAll("button,input,select").length, w: document.getElementById("mpd-map").naturalWidth }; });
  ok(pv.shown && pv.w >= 1000, "print view: opens with a drawn map " + pv.w);
  await p.waitForFunction(() => /^data:image\/png/.test((document.querySelector("#brief .mpscmap img") || {}).src || ""), null, { timeout: 20000 });
  ok(/East: JPN → HAW → USA/.test(await p.textContent("#brief .mpscmap figcaption")), "print view: the strategic chains have their own world map in section 6");
  if (OUT) await (await p.$("#brief .mpscmap")).screenshot({ path: OUT + "/chain-map.png" });
  ok(["Primary, Secondary", "1. Golden hour", "2. Receiving", "3. Routes", "4. Emergency", "5. Evacuation landing", "6. Evacuate out", "7. Health", "8. Evacuation weather", "9. Unit", "10. Sources"].every((x) => pv.h3.some((h) => h.indexOf(x) === 0)), "print view: every section is there: " + pv.h3.join(" | "));
  ok(pv.btn === 0 && /Test element/.test(pv.t) && /Primary/.test(pv.t), "print view: fields print as their values, no buttons or inputs");
  ok(!/Looking up|Reading…|Still reading/.test(pv.t) && /Plan status/.test(pv.t), "print view: the plan status prints and no lookup is left in progress");
  const pa3 = await p.evaluate(() => [...document.querySelectorAll("#brief .mpdoc .mpaprint")].map((x) => ({ h: x.querySelector("h3").textContent, ct: /Contacts and cover/.test(x.textContent), cap: /Capability and services/.test(x.textContent), ids: x.querySelectorAll("[id]").length, brk: getComputedStyle(x).breakBefore })));
  ok(pa3.length === 3 && /^Hospital assessment, Primary: H3 Far North Hospital/.test(pa3[0].h) && /Secondary/.test(pa3[1].h) && /Tertiary/.test(pa3[2].h) && pa3.every((x) => x.ct && x.cap && !x.ids && x.brk === "page"), "print view: the full assessment of Primary, Secondary and Tertiary prints, each from a new page " + JSON.stringify(pa3.map((x) => x.h)));
  const prn = await p.evaluate(() => new Promise((res) => { window.print = () => res(true); document.getElementById("mpd-print").click(); setTimeout(() => res(false), 5000); }));
  ok(prn, "print view: Print or save PDF opens the print dialog");
  await p.emulateMedia({ media: "print" });
  ok(await p.evaluate(() => [...document.body.children].every((e) => e.id === "brief" || getComputedStyle(e).display === "none") && getComputedStyle(document.getElementById("mpd-print").parentElement).display === "none"), "print view: in print only the plan pages show, without the bar");
  if (OUT) { const pdf = await p.pdf({ path: OUT + "/medplan.pdf", format: "A4", margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" } }); console.log("pdf pages: " + (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length); }
  const pages = (( await p.pdf({ format: "A4" })).toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length;
  ok(pages >= 3, "print view: the plan prints on several pages, not one (" + pages + ")");
  await p.emulateMedia({ media: "screen" });
  if (OUT) await p.screenshot({ path: OUT + "/print-view.png", fullPage: true });
  await p.click("#mpd-close");
  ok(await p.evaluate(() => document.getElementById("brief").hidden && !document.getElementById("medplan").hidden), "print view: Back returns to the plan");
  // Hospital assessment: one hospital as printable pages, every gap stated, TRICARE never assumed
  ok(/TRICARE: not known, confirm with TRICARE Overseas/.test(await p.textContent("#mp-fac")), "plan rows: each hospital says its TRICARE status is not known");
  await p.click('#mp-fac tr:has-text("Far North Hospital") [data-mp-assess]');
  await p.waitForFunction(() => /^data:image\/png/.test((document.getElementById("mpa-map") || {}).src || ""), null, { timeout: 20000 });
  const as = await p.evaluate(() => { const d = document.querySelector("#brief .mpdoc"); const row = (k) => { const th = [...d.querySelectorAll("table.mpas th")].find((x) => x.textContent === k); return th ? th.nextElementSibling.textContent : null; };
    return { h2: d.querySelector("h2").textContent, h3: [...d.querySelectorAll("h3")].map((h) => h.textContent), ed: row("Emergency department"), beds: row("Beds"), icu: row("Intensive care (ICU)"), surg: row("Surgery"), or: row("Operating rooms"), s24: row("24-hour surgeon"), oh: row("Opening hours"),
      blood: row("Blood bank"), ct: row("CT and MRI"), pad: row("Helipad"), af: row("Nearest airfield"), tc: row("TRICARE"), mgrs: row("Grid (MGRS)"), road: row("By road"), air: row("By air"), rt: row("Route"), cap: row("Official trauma designation"), cls: row("Observed class"), flag: [...d.querySelectorAll("table.mpas")].map((t) => [...t.querySelectorAll("tr")].find((r) => r.querySelector("th").textContent === "Emergency department" && /REPORTED/.test(r.textContent))).filter(Boolean).map((r) => r.querySelector("td").textContent)[0] || "", unk: row("Unknown"),
      ct2: row("Contacts"), tclinks: [...d.querySelectorAll("a")].filter((a) => /tricare/.test(a.href)).length, btn: [...d.querySelectorAll("button,input,select")].filter((x) => !x.closest(".noprint")).length, w: document.getElementById("mpa-map").naturalWidth }; });
  ok(/Hospital assessment: Far North Hospital/.test(as.h2) && ["Location", "From the point of injury", "Capability and services", "Landing", "Contacts and cover"].every((h) => as.h3.includes(h)), "assessment: opens for the hospital with every section " + as.h3.join(" | "));
  ok(as.w >= 900, "assessment: has its own map " + as.w);
  ok(/^Yes/.test(as.ed) && /^300/.test(as.beds) && /Trauma Level IV \(official designation, reported\)/.test(as.cap) && /not yet verified with the designating authority/.test(as.cap), "assessment: emergency department, beds and the official designation as reported, with its source");
  ok(as.h3.includes("Capability flags") && /^Observed T5/.test(as.cls) && /^V4 Community source REPORTED, confidence LOW · available now: UNKNOWN \(no planner's check\) · OpenStreetMap emergency=yes/.test(as.flag) && /^U Unknown No source states: 24\/7 emergency department, Trauma team/.test(as.unk), "assessment: capability flags with status, confidence and source; unknown listed as unknown: " + [as.cls, as.flag, as.unk.slice(0, 80)].join(" | "));
  ok(/^Not known/.test(as.icu) && /^Not known/.test(as.surg) && /^Not known/.test(as.blood) && /^Not known/.test(as.ct), "assessment: every gap says Not known (surgery, ICU, blood bank, CT/MRI)");
  ok(/^Not known/.test(as.or) && /^Not known/.test(as.s24) && /ask the hospital/.test(as.s24) && /^Not known/.test(as.oh), "assessment: operating rooms, 24-hour surgeon and opening hours rows, Not known where nothing is published");
  ok(/47P [A-Z]{2} \d{4} \d{4}/.test(as.mgrs) && /min/.test(as.road) && /golden hour/i.test(as.road) && /kn/.test(as.air), "assessment: MGRS, road and air times from the point of injury against the golden hour");
  ok(/Main roads/.test(as.rt), "assessment: the road route with its main roads: " + as.rt);
  ok(as.pad && as.af && /\+66 2 123 4567/.test(as.ct2), "assessment: helipad, nearest airfield and contacts lines");
  ok(/TRICARE status not known/.test(as.tc) && !/accept/i.test(as.tc.replace(/acceptance/g, "")) && as.tclinks >= 2, "assessment: TRICARE status not known, never assumed, with where to confirm: " + as.tc);
  ok(/Pacific Area regional call centre: \+65-6339-2676/.test(as.tc), "assessment: TRICARE line gives the Pacific call centre to confirm with");
  ok(as.btn === 0, "assessment: no buttons inside the printed pages");
  // Phase 1: a planner's check, graded V1, with an expiring "available now"; it outranks the designation for the pick
  const chk = async (cap, ex, now, extra) => p.evaluate(([cap, ex, now, extra]) => {
    const f = document.querySelector("#brief form[data-mp-chk]"); f.elements.cap.value = cap; f.elements.exists.value = ex; f.elements.now.value = now; f.elements.method.value = "phone";
    f.elements.role.value = (extra && extra.role) || "ED charge nurse"; f.elements.note.value = (extra && extra.note) || ""; f.elements.h.value = (extra && extra.h) || "24";
    f.querySelector("button[type=submit]").click();
    return { msg: (document.querySelector("#brief .mpchkmsg") || {}).textContent || "", flags: document.getElementById("mpa-caps").textContent, log: document.getElementById("mpa-chk").textContent, logHtml: document.getElementById("mpa-chk").innerHTML };
  }, [cap, ex, now, extra]);
  ok(await p.evaluate(() => /No planner has checked this hospital/.test(document.getElementById("mpa-chk").textContent) && document.querySelector("#brief form[data-mp-chk]").classList.contains("noprint")), "checks: none yet, and the form does not print");
  let ck = await chk("dx.ct", "yes", "available", { note: "<b>CT up</b>" });
  ok(/^Recorded CT,/.test(ck.msg) && /CTV1 Human verified VERIFIED, confidence HIGH · available now: AVAILABLE \(checked .* by phone call, ED charge nurse; expires/.test(ck.flags) && /Planner's check \(phone call\)/.test(ck.flags), "checks: a phone check makes CT V1 human verified and available now, with its expiry: " + ck.flags.slice(ck.flags.indexOf("CTV1"), ck.flags.indexOf("CTV1") + 160));
  ok(/<b>CT up<\/b>/.test(ck.log) && /&lt;b&gt;CT up&lt;\/b&gt;/.test(ck.logHtml), "checks: a typed note is shown as text, never as markup");
  ck = await chk("dx.ct", "no", "available");
  ok(/^Not recorded: check cannot be available now when the hospital does not have it/.test(ck.msg), "DENY checks: available now but does not have it is refused");
  ok(/Primary\s*H3 Far North Hospital/.test(await p.textContent("#mp-pst")), "checks: Far North is Primary before any check of its emergency department");
  ck = await chk("ed.basic", "yes", "unavailable", { note: "ED closed for flooding" });
  const pst2 = await p.textContent("#mp-pst");
  ok(/available now: UNAVAILABLE/.test(ck.flags) && !/Primary\s*H3 Far North Hospital/.test(pst2), "checks: emergency department not available now takes Far North off Primary, even with its designation: " + pst2.slice(0, 120));
  ck = await chk("ed.basic", "unknown", "unknown");
  ok(/Primary\s*H3 Far North Hospital/.test(await p.textContent("#mp-pst")) && /replaced by a newer check/.test(ck.log) && /ED closed for flooding/.test(ck.log), "checks: \"not said\" for both undoes it; the older check stays listed as replaced");
  const stored = await p.evaluate(() => JSON.parse(localStorage.getItem("osap-medcheck-th") || "[]"));
  ok(stored.length === 3 && stored.every((c) => c.by === "planner on this device" && c.expires_at && c.at) && stored[2].supersedes === stored[1].id, "checks: kept on this device as an append-only log, each naming the check it replaced");
  ok(/Capabilities confirmed available now/.test(await p.textContent("#mp-val")), "checks: the plan status says whether the definitive facility's critical capabilities are confirmed available now");
  const aprn = await p.evaluate(() => new Promise((res) => { window.print = () => res(true); document.getElementById("mpa-print").click(); setTimeout(() => res(false), 5000); }));
  ok(aprn, "assessment: Print or save PDF opens the print dialog");
  await p.emulateMedia({ media: "print" });
  const apages = ((await p.pdf({ format: "A4" })).toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length;
  ok(apages >= 1 && await p.evaluate(() => getComputedStyle(document.getElementById("mpa-print").parentElement).display === "none"), "assessment: prints without the bar (" + apages + " pages)");
  if (OUT) await p.pdf({ path: OUT + "/assessment.pdf", format: "A4", margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" } });
  await p.emulateMedia({ media: "screen" });
  if (OUT) await p.screenshot({ path: OUT + "/assessment.png", fullPage: true });
  await p.click("#mpa-close");
  ok(await p.evaluate(() => document.getElementById("brief").hidden && !document.getElementById("medplan").hidden), "assessment: Back returns to the plan");
  const r0 = calls.route;
  await p.click('#mp-fac tr:has-text("Near Hospital") [data-mp-assess]');
  await p.waitForFunction(() => /^data:image\/png/.test((document.getElementById("mpa-map") || {}).src || ""), null, { timeout: 20000 });
  ok(calls.route > r0 && /Main roads/.test(await p.textContent("#brief")), "assessment: a hospital that is not a pick gets its road route asked when opened");
  ok(/Test wiki/.test(await p.textContent("#brief")), "assessment: a sourced hospital names its source");
  await p.click("#mpa-close");
  if (OUT) await p.screenshot({ path: OUT + "/desk-plan.png" });
  await p.click('#medplan [data-mp="close"]');
  ok(await p.evaluate(() => document.getElementById("medplan").hidden && !document.querySelector(".mpicon")) && JSON.stringify(await lines()) === '{"r":0,"g":0,"a":0}', "desktop: Close hides the plan and takes the marks, routes, outlines and rings off the map");
  ok(!errors.length, "desktop: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- from a point, no drawn area ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1400, height: 900 } });
  await p.evaluate(() => { try { window.TSAP.areaApi.setArea(null); } catch (e) {} localStorage.setItem("osap-atak-pts", JSON.stringify([{ id: "pa", cc: "th", lat: 13.70, lon: 100.45, n: "Alpha", t: 1 }])); });
  await p.evaluate(() => window.OSAP_MEDPLAN.open({ at: [13.76, 100.51] }));
  await p.waitForFunction(() => document.querySelector("#mp-fac table") && /min/.test(document.getElementById("mp-fac").textContent), null, { timeout: 20000 }).catch(() => {});
  const pt = await p.evaluate(() => ({ t: document.getElementById("medplan").textContent, poi: document.getElementById("mpf-poi").value, opts: [...document.querySelectorAll("#mp-from option")].map((o) => o.textContent), pst: (document.getElementById("mp-pst") || {}).textContent || "", mk: [...document.querySelectorAll(".mpicon")].some((m) => m.textContent === "POI") }));
  ok(/Planned from a point, no drawn area needed/.test(pt.t) && /Centred on the anticipated point of injury/.test(pt.t) && /^\d{2}[A-Z] [A-Z]{2} \d{4} \d{4}$/.test(pt.poi) && /Primary/.test(pt.pst) && pt.mk, "point: the plan opens on a point with no drawn area, the point as the POI: " + pt.poi);
  ok(pt.opts.some((x) => /^Your point Alpha: 47P/.test(x)) && pt.opts.some((x) => /Map centre when opened/.test(x)), "point: your dropped points are offered as other points of injury: " + pt.opts.join(" | "));
  await p.selectOption("#mp-from", "pt:pa");
  await p.waitForFunction(() => /Centred on your point Alpha/.test(document.getElementById("medplan").textContent), null, { timeout: 5000 }).catch(() => {});
  ok(/Centred on your point Alpha/.test(await p.textContent("#medplan")), "point: choosing your point re-centres the plan on it");
  await p.click('#medplan [data-mp="close"]');
  await p.evaluate(() => window.OSAP_MEDPLAN.open({ centre: true })); await p.waitForTimeout(300);
  ok(/Centred on the map centre|Centred on the anticipated point of injury/.test(await p.textContent("#medplan")) && !/Draw an area first/.test(await p.textContent("#medplan")), "point: from the Reports menu it opens on the map centre, never asking for an area");
  ok(!errors.length, "point: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- phone, and OpenStreetMap down ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, true);
  await p.evaluate((P) => window.TSAP.areaApi.setArea(P), square(C0, 0.02));
  await p.evaluate(() => { const b = document.getElementById("atk-tools"); if (b && b.classList.contains("folded")) b.querySelector('[data-atk="fold"]').click(); });
  await medBtn(p);
  await p.waitForFunction(() => /could not be reached/.test((document.getElementById("mp-fac") || {}).textContent || ""), null, { timeout: 20000 });
  ok(/Try again/.test(await p.textContent("#mp-fac")), "phone: OpenStreetMap down says so and offers Try again");
  ok(/Sourced Trauma Centre/.test(await p.textContent("#mp-fac")) && /only OSAP's researched hospitals/.test(await p.textContent("#mp-fac")), "phone: OpenStreetMap down still lists OSAP's sourced hospitals, and says that is all");
  await p.waitForFunction(() => /Sourced Trauma Centre/.test((document.getElementById("mp-rt") || {}).textContent || "") && /min/.test(document.getElementById("mp-rt").textContent), null, { timeout: 15000 });
  ok(true, "phone: routes are still planned to the sourced hospitals");
  await p.waitForFunction(() => document.querySelector("#mp-wx table"), null, { timeout: 10000 });
  ok(true, "phone: weather still shows when OpenStreetMap is down");
  await p.waitForFunction(() => /1669/.test(document.getElementById("mp-ems").textContent), null, { timeout: 10000 });
  ok(true, "phone: emergency numbers still show when OpenStreetMap is down");
  ok(await p.evaluate(() => document.getElementById("medplan").scrollWidth <= window.innerWidth + 1 && document.querySelector("#medplan .mpbox").getBoundingClientRect().width <= window.innerWidth), "phone: the plan fits the screen width");
  if (OUT) await p.screenshot({ path: OUT + "/phone-plan.png" });
  await p.click('#medplan [data-mp="dock"]'); await p.waitForTimeout(200);
  const hs = await p.evaluate(() => { const r = document.querySelector("#medplan .mpbox").getBoundingClientRect(), hit = document.elementFromPoint(20, 120); return { top: Math.round(r.top), vh: innerHeight, w: Math.round(r.width), vw: innerWidth, map: !!(hit && hit.closest(".leaflet-container")) }; });
  ok(hs.top > hs.vh * 0.4 && hs.w <= hs.vw && hs.map, "phone: Half screen puts the plan in the lower half with the map usable above " + JSON.stringify(hs));
  await p.click('#medplan [data-mp="dock"]'); await p.waitForTimeout(150);
  ok(!errors.length, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- OSAP's stored copy covers the area: Overpass is not asked, and when it is down the plan still lists hospitals ----------
{
  const { ctx, p, errors, calls } = await open({ viewport: { width: 1400, height: 900 } }, { overpassFails: true, medfac: MF_ALL });
  await p.evaluate((P) => window.TSAP.areaApi.setArea(P), square(C0, 0.02));
  await medBtn(p);
  await p.waitForFunction(() => { const t = document.querySelector("#mp-fac table"); return t && /min/.test(document.getElementById("mp-fac").textContent); }, null, { timeout: 20000 });
  const fac = await p.textContent("#mp-fac");
  ok(/Sourced Trauma Centre/.test(fac) && /Far North Hospital/.test(fac) && /Trauma Test Hospital/.test(fac) && /Community Health Centre 7/.test(fac), "stored: hospitals and clinics from the stored copy");
  ok(/From OSAP's stored copy of OpenStreetMap \(2026-09-30\)/.test(fac) && !/could not be reached/.test(fac), "stored: says where the list came from, with its date");
  ok(calls.overpass === 0, "stored: Overpass is not asked when the stored copy covers every country in reach (" + calls.overpass + ")");
  ok(/name withheld/.test(fac) && !/Somchai/.test(await p.textContent("#medplan")), "stored: the doctor-named clinic stays withheld");
  ok(await p.evaluate(() => !!document.querySelector('#mp-fac [data-mp="live"]')), "stored: offers a live OpenStreetMap check");
  await p.click('#mp-fac [data-mp="live"]');
  await p.waitForFunction(() => /could not be reached/.test(document.getElementById("mp-fac").textContent) && document.querySelector("#mp-fac table"), null, { timeout: 20000 });
  ok(calls.overpass >= 1 && /Far North Hospital/.test(await p.textContent("#mp-fac")) && /stored copy/.test(await p.textContent("#mp-fac")), "stored: a failed live check keeps the stored list and says so " + calls.overpass + " " + (await p.textContent("#mp-fac")).slice(0, 300));
  ok(!errors.length, "stored: no page errors " + errors.join(" | "));
  await ctx.close();
}
{
  const { ctx, p, errors, calls } = await open({ viewport: { width: 1400, height: 900 } }, { overpassFails: true, medfac: ["kh"] });
  await p.evaluate((P) => window.TSAP.areaApi.setArea(P), square(C0, 0.02));
  await medBtn(p);
  await p.waitForFunction(() => /does not yet cover/.test((document.getElementById("mp-fac") || {}).textContent || ""), null, { timeout: 25000 });
  const fac = await p.textContent("#mp-fac");
  ok(/Far North Hospital/.test(fac) && /does not yet cover Thailand: facilities there are missing/.test(fac) && !/Laos|Myanmar/.test(fac) && !/No hospital/.test(fac), "stored, partly: lists the stored hospitals and names the countries not yet stored: " + fac.slice(0, 400));
  ok(calls.overpass >= 1, "stored, partly: Overpass is asked for the rest");
  const tc = await p.evaluate(() => ["th", "de", "br", "ca", "pk", "af", "jp", "ir"].map((c) => window.OSAP_MEDPLAN._tcArea(c)).join(","));
  ok(tc === "pac,ea,la,la,ea,,pac,ea", "stored, partly: TRICARE areas follow the page's own descriptions, none where it names nothing: " + tc);
  const cn = await p.evaluate(() => [window.OSAP_MEDPLAN._ccNear([15.89442, 100.11841], 150000).map((c) => c.id), window.OSAP_MEDPLAN._ccNear([18.8, 100.8], 150000).map((c) => c.id)]);
  ok(cn[0].includes("th") && !cn[0].includes("la") && cn[1].includes("la"), "stored, partly: countries in reach follow their borders, not bounding boxes (Nakhon Sawan " + cn[0] + "; Nan " + cn[1] + ")");
  ok(!errors.length, "stored, partly: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- blood banks, chambers and air rescue from OSAP's stored copy (Shane 2026-10-03: "could not be looked up", Overpass timed out) ----------
{
  const { ctx, p, errors, calls } = await open({ viewport: { width: 1400, height: 900 } }, { xFails: true, medfac: MF_ALL, medfacX: MF_ALL });
  await p.evaluate((P) => window.TSAP.areaApi.setArea(P), square(C0, 0.02));
  await medBtn(p);
  await p.waitForFunction(() => /Test National Blood Centre/.test((document.getElementById("mp-fac") || {}).textContent || ""), null, { timeout: 25000 }).catch(() => {});
  const f = await p.textContent("#mp-fac"), bl = f.slice(f.indexOf("Nearest blood bank")), mev = await p.textContent("#mp-mev");
  ok(/Test National Blood Centre/.test(bl) && /Test Donation Room/.test(bl) && /Test Hyperbaric Centre/.test(bl) && /Test Air Rescue/.test(mev) && !/could not be looked up|could not be read/.test(f + mev), "stored extras: blood services, the chamber and the air rescue base come from the stored copy while live Overpass is down " + bl.slice(0, 300));
  ok(/From OSAP's stored copy of OpenStreetMap \(2026-09-30\)/.test(bl), "stored extras: says they come from the stored copy, with its date");
  ok(calls.overpassX === 0 && calls.medfacX >= 1, "stored extras: no live extras request when the copy covers every country within 500 km " + JSON.stringify(calls));
  ok(!errors.length, "stored extras: no page errors " + errors.join(" | "));
  await ctx.close();
}
{
  /* only Thailand's extras are stored and the live check fails: Thailand's are listed, the countries missing are named */
  const { ctx, p, errors, calls } = await open({ viewport: { width: 1400, height: 900 } }, { xFails: true, medfac: MF_ALL, medfacX: ["th"] });
  await p.evaluate((P) => window.TSAP.areaApi.setArea(P), square(C0, 0.02));
  await medBtn(p);
  await p.waitForFunction(() => /does not yet cover/.test((document.getElementById("mp-fac") || {}).textContent || ""), null, { timeout: 60000 }).catch(() => {});
  const f = await p.textContent("#mp-fac"), bl = f.slice(f.indexOf("Nearest blood bank"));
  ok(/Test National Blood Centre/.test(bl) && /Test Hyperbaric Centre/.test(bl) && /stored copy does not yet cover [A-Z][a-z]+.* and the live OpenStreetMap check failed/.test(bl) && !/could not be looked up/.test(bl), "stored extras, partly: lists what is stored and names the countries not yet stored " + bl.slice(0, 500));
  ok(calls.overpassX >= 1, "stored extras, partly: Overpass is asked for the rest " + JSON.stringify(calls));
  ok(!errors.length, "stored extras, partly: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- print view on an iPhone-sized screen: the plan is one long page the phone prints in full ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, { medfac: MF_ALL });
  await p.evaluate((P) => window.TSAP.areaApi.setArea(P), square(C0, 0.02));
  await p.evaluate(() => { const b = document.getElementById("atk-tools"); if (b && b.classList.contains("folded")) b.querySelector('[data-atk="fold"]').click(); });
  await medBtn(p);
  await p.waitForFunction(() => document.querySelectorAll("#mp-rt h4").length === 3 && !/Working out the route/.test(document.getElementById("mp-rt").textContent), null, { timeout: 25000 });
  /* Shane 2026-10-03: on a phone the role table was squeezed into three narrow columns, one word per line, Tertiary cut off */
  const rl = await p.evaluate(() => {
    const t = document.querySelector("#mp-pst table.mproles"), tw = t.getBoundingClientRect().width, cells = [...t.querySelectorAll("tbody td")];
    return { tw: Math.round(tw), vw: innerWidth, sw: document.getElementById("mp-pst").scrollWidth, cw: document.getElementById("mp-pst").clientWidth, n: cells.length,
      narrow: cells.filter((c) => c.getBoundingClientRect().width < tw * 0.85).length, labels: cells.slice(0, 3).map((c) => getComputedStyle(c, "::before").content).join(" "),
      head: getComputedStyle(t.querySelector("thead")).display };
  });
  ok(rl.n >= 12 && rl.narrow === 0 && rl.sw <= rl.cw + 1 && rl.tw <= rl.vw && rl.head === "none" && /Primary.*Secondary.*Tertiary/.test(rl.labels), "phone: Primary, Secondary and Tertiary stack full width with their labels, nothing cut off " + JSON.stringify(rl));
  if (OUT) await p.evaluate(() => document.querySelector("#mp-pst table.mproles").scrollIntoView());
  if (OUT) await p.screenshot({ path: OUT + "/phone-roles.png" });
  await p.click('#medplan [data-mp="print"]');
  await p.waitForFunction(() => /^data:image\/png/.test((document.getElementById("mpd-map") || {}).src || ""), null, { timeout: 20000 });
  await p.waitForTimeout(300);
  const ph = await p.evaluate(() => ({ flow: getComputedStyle(document.getElementById("brief")).position, h: document.documentElement.scrollHeight, vh: innerHeight, w: document.querySelector(".mpdoc").getBoundingClientRect().width, vw: innerWidth,
    img: document.getElementById("mpd-map").getBoundingClientRect().width, plan: getComputedStyle(document.getElementById("medplan")).display }));
  ok(ph.flow !== "fixed" && ph.h > 4 * ph.vh && ph.plan === "none", "phone print view: the plan is the page itself, in normal flow, so iPhone prints every page " + JSON.stringify(ph));
  ok(ph.w <= ph.vw && ph.img > 300 && ph.img <= ph.vw, "phone print view: fits the screen, map across the width");
  /* Shane 2026-10-03: the iPhone printed or saved only page 1. Printing at phone width matches the phone layout, which pins
     html and body to one screen with overflow hidden; the print rules must let the report run its full length */
  await p.emulateMedia({ media: "print" });
  const pr = await p.evaluate(() => { const st = (e) => getComputedStyle(e); return { ho: st(document.documentElement).overflowY, bo: st(document.body).overflowY, bh: document.body.getBoundingClientRect().height,
    h: document.documentElement.scrollHeight, vh: innerHeight, phone: document.documentElement.classList.contains("phone"), last: /Sources and fingerprint/.test(document.getElementById("brief").textContent) }; });
  ok(pr.ho === "visible" && pr.bo === "visible" && pr.bh > 4 * pr.vh && pr.h > 4 * pr.vh && pr.last, "phone print: html and body run the full length of the plan, so every page prints " + JSON.stringify(pr));
  await p.emulateMedia({ media: "screen" });
  if (OUT) await p.screenshot({ path: OUT + "/phone-print-view.png", fullPage: true });
  await p.click("#mpd-close");
  await p.evaluate(() => document.querySelector('#mp-fac [data-mp-assess]').click());
  await p.waitForFunction(() => /^data:image\/png/.test((document.getElementById("mpa-map") || {}).src || ""), null, { timeout: 20000 });
  await p.waitForTimeout(300);
  const pa = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: innerWidth, w: document.querySelector(".mpdoc").getBoundingClientRect().width, img: document.getElementById("mpa-map").getBoundingClientRect().width, flow: getComputedStyle(document.getElementById("brief")).position }));
  ok(pa.sw <= pa.vw + 1 && pa.w <= pa.vw && pa.img > 300 && pa.flow !== "fixed", "phone assessment: fits the screen with no sideways scroll, map across the width " + JSON.stringify(pa));
  if (OUT) await p.screenshot({ path: OUT + "/phone-assessment.png", fullPage: true });
  ok(!errors.length, "phone print view: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- hospitals' own websites (build prompt phase 6) ----------
const WEB = { schema: "osap-hospital-web/1", cc: "th", read_at: "2026-10-03T07:48:05Z", facilities: [
  { key: "osm:w2", osm: "w2", sof: "", name: "Near Hospital", lat: 13.76, lon: 100.51, website: "https://near.example.org/",
    caps: { "dx.ct": [{ url: "https://near.example.org/ct", title: "CT", excerpt: "CT scanner open 24 hours", observed: "2026-10-03", sha256: "a".repeat(64) }] } },
  { key: "osm:n99", osm: "n99", sof: "", name: "Website Only Hospital", lat: 13.73, lon: 100.52, website: "https://wo.example.org/",
    caps: { "ed.24_7": [{ url: "https://wo.example.org/er", title: "ER", excerpt: "Emergency room open 24 hours <b>x</b>", observed: "2026-10-03", sha256: "b".repeat(64) }] } }] };
{
  const { ctx, p, errors } = await open({ viewport: { width: 1400, height: 900 } }, { medfac: MF_ALL, web: WEB });
  await p.evaluate((P) => window.TSAP.areaApi.setArea(P), square(C0, 0.02));
  await openPlan(p);
  ok(/Website Only Hospital/.test(await p.textContent("#mp-fac")), "websites: a hospital documented only by its own website is listed");
  ok(/Hospitals' own websites, read automatically/.test(await p.textContent("#mp-src")) && /read 2026-10-03, 2 hospitals/.test(await p.textContent("#mp-src")), "websites: the sources list names the website reading and its date");
  await p.click('#mp-fac tr:has-text("Near Hospital") [data-mp-assess]');
  await p.waitForFunction(() => /Capability flags/.test((document.getElementById("brief") || {}).textContent || ""), null, { timeout: 20000 });
  const b = await p.textContent("#brief");
  ok(/CT scanner open 24 hours/.test(b) && /Near Hospital website/.test(b) && /hospital website text \(automatic match\)/.test(b) && /aaaaaaaaaaaa/.test(b), "websites: the assessment quotes the hospital's page, names it and shows the evidence SHA-256");
  ok(/REPORTED/.test(b) && !/CONFIRMED|VERIFIED<\/b>, confidence MODERATE · <a[^>]*near\.example/.test(b), "websites: a hospital's own claim is reported, never confirmed");
  await p.click("#mpa-close");
  await p.click('#mp-fac tr:has-text("Website Only Hospital") [data-mp-assess]');
  await p.waitForFunction(() => /Capability flags/.test((document.getElementById("brief") || {}).textContent || ""), null, { timeout: 20000 });
  ok(await p.evaluate(() => !document.querySelector("#brief b b") && /<b>x<\/b>/.test(document.getElementById("brief").textContent)), "websites: quoted page text is shown as text, never as markup");
  await p.click("#mpa-close");
  ok(!errors.length, "websites: no page errors " + errors.join(" | "));
  await ctx.close();
}
{
  const { ctx, p, errors } = await open({ viewport: { width: 1400, height: 900 } }, { medfac: MF_ALL, web: "fail" });
  await p.evaluate((P) => window.TSAP.areaApi.setArea(P), square(C0, 0.02));
  await openPlan(p);
  const src = await p.textContent("#mp-src");
  ok(/Hospitals' own websites, read automatically/.test(src) && /not read: HTTP 503/.test(src) && /Near Hospital/.test(await p.textContent("#mp-fac")), "websites: an unreadable file is reported as not read and the plan still lists hospitals");
  ok(!errors.length, "websites down: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- official hospital records, Thailand (build prompt phase 7) ----------
const HA_SRC = { name: "HA Thailand open data: test", page: "https://data.ha.or.th/dataset/test", url: "", licence: "CC BY", last_modified: "" };
const GOVDOC = { schema: "osap-th-registry/1", cc: "th", built: "2026-10-03T10:00:00Z", source_type: "government_registry",
  sources: { hospital: HA_SRC, accreditation: HA_SRC, pdsc: Object.assign({}, HA_SRC, { name: "HA Thailand open data: certifications test" }), level: HA_SRC }, hospitals: [
  { hcode: "99001", name_th: "\u0e42\u0e23\u0e07\u0e1e\u0e22\u0e32\u0e1a\u0e32\u0e25\u0e43\u0e01\u0e25\u0e49\u0e17\u0e14\u0e2a\u0e2d\u0e1a", name_en: "Near Hospital", province: "Testburi", health_region: "13", type_th: "\u0e23\u0e1e\u0e28.", type_en: "Regional hospital",
    kind: "hospital", beds_requested: 500, beds_open: 450, specialties_reported: "", level: "A", level_th: "A", level_en: "A (advanced: regional referral)",
    ha: { stage_th: "x", stage_en: "Advanced HA accreditation", accredited: true, from: "2025-01-01", to: "2028-12-31", note: "" },
    programs: [{ kind: "programme", name_th: "stroke-th <b>y</b>", name_en: "Stroke care", stage: "PDSC", from: "2025-02-01", to: "2028-01-31", caps: ["spec.stroke"], src: "pdsc" },
      { kind: "programme", name_th: "hip-th", name_en: "Hip fracture surgery in older people", stage: "PDSC", from: "2021-01-01", to: "2024-01-01", caps: ["surg.ortho"], src: "pdsc" }],
    lat: 13.76, lon: 100.51, osm: "w2", coord_basis: "OpenStreetMap entry with the same name", retrieved: "2026-10-03", sha256: "c".repeat(64) },
  { hcode: "99002", name_th: "x", name_en: "Sourced Trauma Centre", province: "Testburi", type_th: "x", type_en: "General hospital", kind: "hospital", beds_open: 120, level: "S", level_en: "S (standard: provincial)",
    ha: null, programs: [{ kind: "network", name_th: "er-th", name_en: "Emergency care system", stage: "HNC", from: "2025-01-01", to: "2029-01-01", caps: ["ed.basic"], src: "hnc" }],
    lat: 13.8002, lon: 100.5601, osm: "", coord_basis: "MOPH location", retrieved: "2026-10-03", sha256: "d".repeat(64) },
  { hcode: "99003", name_th: "y", name_en: "Unplaced Hospital", province: "Testburi", kind: "hospital", programs: [], lat: null, lon: null, osm: "", coord_basis: "not placed", retrieved: "2026-10-03", sha256: "e".repeat(64) }] };
{
  const { ctx, p, errors } = await open({ viewport: { width: 1400, height: 900 } }, { medfac: MF_ALL, gov: GOVDOC });
  await p.evaluate((P) => window.TSAP.areaApi.setArea(P), square(C0, 0.02));
  await openPlan(p);
  const src = await p.textContent("#mp-src");
  ok(/Official hospital records \(HA Thailand open data\)/.test(src) && /built 2026-10-03, 3 hospitals, 2 placed on the map; 2 in this plan/.test(src), "official records: the sources list names the registry, its date, the placed count and how many plan hospitals it covers " + src.slice(0, 300));
  await p.click('#mp-fac tr:has-text("Near Hospital") [data-mp-assess]');
  await p.waitForFunction(() => /Capability flags/.test((document.getElementById("brief") || {}).textContent || ""), null, { timeout: 20000 });
  const b = await p.textContent("#brief"), h = await p.innerHTML("#brief");
  ok(/Official record/.test(b) && /99001/.test(b) && /Regional hospital/.test(b) && /A \(advanced: regional referral\)/.test(b) && /450 open, 500 registered/.test(b) && /Advanced HA accreditation \(x\), 2025-01-01 to 2028-12-31/.test(b), "official records: the assessment shows the H code, type, MOPH level, beds and HA accreditation");
  ok(/Stroke care/.test(b) && /Hip fracture surgery in older people[^<]*2021-01-01 to 2024-01-01 expired/.test(b), "official records: certified programmes are listed and a past end date reads expired");
  ok(/<th scope="row">Stroke<\/th><td><span class="mpgrade mpg-v2"[^>]*>V2 Official source<\/span> <b>VERIFIED<\/b>, confidence HIGH/.test(h) && /HA Thailand open data: certifications test/.test(b) && /cccccccccccc/.test(b), "official records: a current certificate makes its capability VERIFIED at HIGH confidence, with the source and SHA-256");
  ok(/<th scope="row">Orthopaedic surgery<\/th><td><span class="mpgrade mpg-v2"[^>]*>V2 Official source<\/span> <b>REPORTED<\/b>, confidence LOW · available now: <b>UNKNOWN<\/b> \(no planner's check\) · <a[^>]*>[^<]*<\/a> <code>[^<]*expired/.test(h), "official records: an expired certificate leaves its capability REPORTED at LOW confidence, marked expired");
  ok(!/<th scope="row">Cardiac catheterisation<\/th><td><b>(VERIFIED|NOT_AVAILABLE)/.test(h), "official records: no certificate is never read as no capability");
  ok(/450 open \(official record, H code 99001\)/.test(b) && /teaching or referral hospital: MOPH service level A/.test(b), "official records: beds open and the MOPH level A referral status come from the official record");
  ok(await p.evaluate(() => !document.querySelector("#brief b b") && /<b>y<\/b>/.test(document.getElementById("brief").textContent)), "official records: registry text is shown as text, never as markup");
  await p.click("#mpa-close");
  ok(!errors.length, "official records: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- road routing falls back to Valhalla, then to a labelled estimate ----------
{
  const { ctx, p, errors, calls } = await open({ viewport: { width: 1400, height: 900 } }, { osrmFails: true, medfac: MF_ALL });
  await p.evaluate((P) => window.TSAP.areaApi.setArea(P), square(C0, 0.02));
  await medBtn(p);
  await p.waitForFunction(() => /answered by valhalla1/.test((document.getElementById("mp-src") || {}).textContent || "") && /Valhalla Road/.test(document.getElementById("mp-rt").textContent), null, { timeout: 30000 });
  ok(/10 min/.test(await p.textContent("#mp-fac")) && calls.vhm === 1 && calls.vhr === 3, "routing: OSRM down, Valhalla gives drive times and routes " + JSON.stringify(calls));
  ok(!errors.length, "routing: no page errors " + errors.join(" | "));
  await ctx.close();
}
{
  const { ctx, p, errors } = await open({ viewport: { width: 1400, height: 900 } }, { osrmFails: true, vhFails: true, medfac: MF_ALL });
  await p.evaluate((P) => window.TSAP.areaApi.setArea(P), square(C0, 0.02));
  await medBtn(p);
  await p.waitForFunction(() => /\(estimate\)/.test((document.getElementById("mp-fac") || {}).textContent || ""), null, { timeout: 40000 });
  const fac = await p.textContent("#mp-fac");
  ok(/No road router answered/.test(fac) && /straight line × 1\.4 at 50 km\/h/.test(fac) && /golden hour/i.test(fac), "routing: no router at all gives labelled estimates and golden-hour badges");
  ok(/Primary/.test(await p.textContent("#mp-pst")), "routing: the picks still stand on estimated times");
  ok(!errors.length, "routing estimate: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- every source down: the plan never says there is no hospital ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1400, height: 900 } }, { overpassFails: true });
  await p.evaluate(() => { const s = window.ASAP_SOF[window.TSAP.areaApi.cc || "th"]; s.hospitals = []; });
  await p.evaluate((P) => window.TSAP.areaApi.setArea(P), square(C0, 0.02));
  await medBtn(p);
  await p.waitForFunction(() => /lookup failed/.test((document.getElementById("mp-fac") || {}).textContent || ""), null, { timeout: 30000 });
  const t = await p.textContent("#medplan");
  ok(/does not mean there is no hospital/.test(t) && !/No hospital within/.test(t) && /No routes: the hospital lookup failed/.test(t), "all down: says the lookup failed, never that there is no hospital");
  ok(!errors.length, "all down: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- rule helpers ----------
{
  const ctx = await browser.newContext({ serviceWorkers: "block" }), p = await ctx.newPage();
  await p.goto(base + "tests/", { waitUntil: "domcontentloaded" }).catch(() => {});
  p.on("pageerror", (e) => console.log("helper page error: " + e.message));
  await p.addScriptTag({ url: base + "assets/osap-geo.js" });
  for (const f of ["base-provider", "resolver", "sof-provider", "web-provider", "osm-provider", "countries/th-provider"]) await p.addScriptTag({ url: base + "assets/hospital-sources/" + f + ".js" });
  for (const f of ["osap-facility-intel", "osap-medplan-decide", "osap-medplan-model"]) await p.addScriptTag({ url: base + "assets/" + f + ".js" });
  await p.addScriptTag({ url: base + "assets/osap-medplan.js" });
  const r = await p.evaluate(() => { const M = window.OSAP_MEDPLAN; return {
    a: M._facName({ name: "Klinik dr. Budi" }, "clinic"), b: M._facName({ name: "Dr. Smith's Surgery" }, "clinic"), c: M._facName({ name: "Bangkok Hospital" }, "hospital"),
    d: M._facName({ name: "Hospital Drive Clinic" }, "clinic"), e: M._parseGrid("13.75, 100.5"), f: M._parseGrid("47P PR 6300 2000"), g: M._parseGrid("nonsense"),
    h: M._wxFlags({ vis: 5000, gust: 12, lc: 10, rain: 1, hi: 25, lo: 10 }).length,
    cx: M._capability({ name: "X", lat: 0, lon: 0, er: "no", sofRec: { name: "X", src: "https://x.example/", srcname: "X website", caps: { "ed.basic": { src: "https://x.example/er", srcname: "X website", quote: "Emergency room", quote_basis: "hospital website text (automatic match)", asof: "2026-10-03" } } } }, []).caps["ed.basic"],
    i: M._capability({ name: "X", lat: 0, lon: 0, er: "yes", pad: true, beds: 600 }, []).tier, il: M._capability({ name: "X", lat: 0, lon: 0, er: "yes", pad: true, beds: 600 }, []).low,
    lows: [M._capability({ name: "A", lat: 0, lon: 0, specRaw: "general_surgery" }, []).low, M._capability({ name: "B", lat: 0, lon: 0, er: "yes", beds: 120 }, []).low,
      M._capability({ name: "G", lat: 0, lon: 0, sofRec: { name: "G", notes: "Mahidol University", src: "x" } }, []).low, M._capability({ name: "Y", lat: 0, lon: 0 }, []).low], j: M._capability({ name: "Y", lat: 0, lon: 0 }, []).tier,
    k: M._golden(45 * 60).c + M._golden(55 * 60).c + M._golden(61 * 60).c, l: Math.round(M._flightS(222240, 120) / 60),
    m: M._phoneOf({ phone: "+66 2 123 4567;+66 2 765 4321" }), n: M._phoneOf({ phone: "call us" }), o: M._webOf({ website: "javascript:alert(1)" }), q: M._webOf({ website: "www.x.org" }),
    r1: M._capability({ name: "A", lat: 0, lon: 0, specRaw: "general_surgery" }, []).tier, r2: M._capability({ name: "B", lat: 0, lon: 0, er: "yes", beds: 120 }, []).tier,
    r3: M._capability({ name: "C", lat: 0, lon: 0, er: "yes" }, []).tier, r4: M._capability({ name: "D", lat: 0, lon: 0, specRaw: "surgery;intensive_care" }, []).tier,
    rk: [M._capability({ name: "L1", lat: 0, lon: 0, sofRec: { trauma_level: "Level I trauma center", src: "x" } }, []), M._capability({ name: "L2", lat: 0, lon: 0, sofRec: { trauma_level: "Level 2", src: "x" } }, []),
      M._capability({ name: "TC", lat: 0, lon: 0, sofRec: { trauma_level: "Major Trauma Centre (NSW)", src: "x" } }, []), M._capability({ name: "U", lat: 0, lon: 0, sofRec: { name: "U", notes: "Mahidol University", src: "x" } }, []),
      M._capability({ name: "S", lat: 0, lon: 0, specRaw: "surgery" }, [])].map(M._rankOf),
    tc: (() => { const R = (k) => ({ status: "REPORTED", confidence: "LOW" }), C = (ks) => Object.fromEntries(ks.map((k) => [k, R(k)]));
      const t3 = ["ed.basic", "ed.24_7", "blood.bank", "dx.xray", "dx.ct", "cc.icu", "surg.general", "surg.or_emergency", "surg.anaesthesia", "surg.ortho"];
      const rich = M._capability({ name: "Rich", lat: 0, lon: 0, er: "yes", beds: 900, specRaw: "trauma;neurosurgery;intensive;orthopaedics;vascular_surgery;cardiothoracic_surgery;plastic_surgery;radiology" }, []);
      return { u: M._tClass({})["class"], t5: M._tClass(C(["ed.basic"]))["class"], t3: [M._tClass(C(t3))["class"], M._tcText({ tc: M._tClass(C(t3)) })],
        none: M._tClass({ "ed.basic": { status: "NOT_AVAILABLE", confidence: "LOW" } })["class"], nolev: rich.trauma === null && rich.lvl === null ? 3 : 0 }; })(),
    r5: M._tierLabel(M._capability({ name: "E", lat: 0, lon: 0, sofRec: { trauma_level: "Level II trauma center (ACS)", src: "x" } }, [])), r6: M._tierLabel(M._capability({ name: "F", lat: 0, lon: 0, sofRec: { trauma_level: "Major Trauma Centre (NSW)", src: "x" } }, [])),
    ref: (() => { const f = M._capability({ name: "G", lat: 0, lon: 0, sofRec: { name: "G", notes: "Mahidol University; Emergency and Trauma Center on site", src: "x", srcname: "English Wikipedia" } }, []); return [f.tier, f.why[0], M._tierLabel(f)]; })(),
    nref: M._capability({ name: "H", lat: 0, lon: 0, sofRec: { name: "H", notes: "Major private international hospital", src: "x" } }, []).tier,
    tk: M._tileKeys([13.75, 100.5], 50000), tk2: M._tileKeys([0.5, 179.5], 100000), p6: M._poly6("_izlhA~rlgdF_{geCn{s|J"),
    wh: M._facName({ "osap:withheld": "1" }, "clinic"),
    hc: M._sortOsm([{ type: "node", id: 1, lat: 0, lon: 0, tags: { amenity: "hospital", name: "Ban Test Health Center" } }, { type: "node", id: 2, lat: 0.01, lon: 0, tags: { amenity: "hospital", name: "\u0e42\u0e23\u0e07\u0e1e\u0e22\u0e32\u0e1a\u0e32\u0e25\u0e2a\u0e48\u0e07\u0e40\u0e2a\u0e23\u0e34\u0e21\u0e2a\u0e38\u0e02\u0e20\u0e32\u0e1e\u0e15\u0e33\u0e1a\u0e25 X" } }], [0, 0]) }; });
  ok(/withheld/.test(r.a) && /withheld/.test(r.b) && r.c === "Bangkok Hospital" && r.d === "Hospital Drive Clinic", "rules: doctor-named clinics withheld, others kept");
  ok(r.e && r.e[0] === 13.75 && r.f && Math.abs(r.f[0] - 13.7) < 1 && r.g === null, "rules: grids parse from lat, lon and MGRS; nonsense does not");
  ok(r.h === 0, "rules: calm weather raises no flags");
  ok(r.cx.status === "CONTRADICTED" && r.cx.source.url === "https://x.example/er" && r.cx.conflict && /emergency=no/.test(r.cx.conflict.how), "rules: a website stating an emergency room against OpenStreetMap emergency=no is CONTRADICTED, both kept, never NOT_AVAILABLE");
  ok(r.i === 2 && r.il === true && r.j === 0, "rules: emergency dept + 600 beds ranks only with surgery-level hospitals, low confidence (a bed count never ranks top); nothing listed is level not known");
  ok(r.rk[0] > r.rk[1] && r.rk[1] > r.rk[2] && r.rk[2] > r.rk[3] && r.rk[3] > r.rk[4], "rules: Level 1 above Level 2 above a level-less trauma centre above every hospital without a stated level " + JSON.stringify(r.rk));
  ok(JSON.stringify(r.lows) === "[false,true,false,false]", "rules: low confidence only where no services are listed and nothing is sourced " + JSON.stringify(r.lows));
  ok(r.k === "gar", "rules: golden hour inside up to 50 min, at the limit to 60, beyond after");
  ok(r.l === 60, "rules: 120 nautical miles at 120 kn is 60 minutes");
  ok(r.m === "+66 2 123 4567" && r.n === "" && r.o === "" && r.q === "https://www.x.org", "rules: only well-formed phones and web links are shown");
  ok(r.ref[0] === 3 && /teaching or referral hospital: Mahidol University/.test(r.ref[1]) && /English Wikipedia/.test(r.ref[1]) && r.ref[2] === "No verified trauma designation" && r.nref === 0, "rules: a university teaching or referral hospital in the sourced list ranks top of the not-known group, with its source; a private hospital note is not: " + JSON.stringify([r.ref, r.nref]));
  ok(r.r1 === 2 && r.r2 === 2 && r.r3 === 1 && r.r4 === 3, "rules: surgery is Role 2, ED + 100 beds Role 2, ED alone Role 1, surgery + intensive care Role 3 " + [r.r1, r.r2, r.r3, r.r4]);
  ok(r.r5 === "Trauma Level II (official designation, reported)" && r.r6 === "Trauma centre, level not stated (reported)", "rules: a stated trauma level reads as stated: " + r.r5 + ", " + r.r6);
  ok(r.tc.u === "UNKNOWN" && r.tc.t5 === "T5" && r.tc.t3[0] === "T3" && /could be T2 if neurosurgery 24\/7, mechanical ventilation and trauma surgeon or trauma team are confirmed/.test(r.tc.t3[1]) && r.tc.none === "NONE"
    && !/Level/.test(r.tc.t3[1]) && r.tc.nolev === 3, "rules: T-class from flags (unknown stays unknown, a met class names what would raise it, no emergency department is NONE); never worded as a level; capabilities never give an official designation " + JSON.stringify(r.tc));
  ok(r.tk.includes("12_100") && r.tk2.includes("0_178") && r.tk2.includes("0_-180"), "rules: stored-copy tiles cover the reach, across the date line " + r.tk2.join(" "));
  ok(r.p6.length === 2 && Math.abs(r.p6[0][0] - 38.5) < 1e-6 && Math.abs(r.p6[1][1] + 126.453) < 1e-6, "rules: Valhalla route shapes decode " + JSON.stringify(r.p6));
  ok(/withheld/.test(r.wh), "rules: a clinic withheld in the stored copy stays withheld");
  ok(r.hc.H.length === 0 && r.hc.nC === 2, "rules: health centres and health-promoting hospitals mapped as hospitals count as clinics");
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? `${fails} check(s) failed` : "all medical plan checks passed");
process.exit(fails ? 1 : 0);
