// Headless check of the standalone hospital assessment (assets/osap-medplan.js, W.OSAP_MEDPLAN.hospital; Shane 2026-10-29
// "i want stand alone"): one hospital's assessment with no medical plan built. The same fixed test data as
// tests/medplan_smoke.mjs answers OpenStreetMap, OSRM, Wikidata and Open-Meteo, so the check is the same every run.
// Checks: a hospital's map-popup button opens its assessment straight away with every section, the sourced trauma level kept
// apart from the assessed equivalent, unknowns stated as "Not known" (never "no"), data age, sources and a SHA-256
// fingerprint; no medical plan is opened; long-press > Plans lists "Hospital assessment here", which lists the hospitals
// round the point nearest first and, once one is picked, adds the straight line, road time, main roads and flight time from
// that point and a drawn map; a hospital at the pressed point opens straight away; Reports lists it; a planner's check
// recorded on the standalone page changes the capability table and the fingerprint; Export PDF goes through OSAP_PDF; an
// open medical plan is left as it was; a name OSAP cannot match lists the hospitals instead; a failed lookup says so and
// offers Try again; and nothing is tagged as AI.
// Run from the repo root: node tests/hospital_assess_smoke.mjs   (needs the playwright package and Chromium)
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
const TILES = { mode: "", osm: 0, esri: 0, now: 0, max: 0 };
const PNG1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
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
function osrmAlts(url) {
  const pts = new URL(url).pathname.split("/").pop().split(";").map((x) => x.split(",").map(Number)), d = secsTo(pts[1][0], pts[1][1]);
  const step = (n, at) => ({ name: n, distance: 5000, duration: 300, maneuver: { type: "depart", location: at, bearing_after: 90 } });
  const line = (k) => [pts[0], [(pts[0][0] + pts[1][0]) / 2, pts[0][1] + k], pts[1]];
  return { code: "Ok", routes: [0, 0.2].map((k, i) => ({ duration: d * (1 + i * 0.3), distance: d * 10 * (1 + i * 0.4), geometry: { type: "LineString", coordinates: line(k) },
    legs: [{ distance: d * 10, duration: d, steps: [step(i ? "Bypass Road" : "Rama IV Road", pts[0])] }] })) };
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
    /* Postpass is down unless the case asks for it, so the Overpass checks below still run; with o.postpass it answers GeoJSON */
    if (/postpass\.geofabrik\.de/.test(u)) {
      const q = decodeURIComponent((r.request().postData() || "").replace(/\+/g, " "));
      calls.pp = (calls.pp || 0) + 1; (calls.ppSql = calls.ppSql || []).push(q);
      if (!o.postpass) return r.fulfill({ status: 503, body: "" });
      const els = /air_rescue_service/.test(q) ? OSMX.elements.filter((e) => !e.tags.country) : /'country' = 'US'/.test(q) ? OSMX.elements.filter((e) => e.tags.country) : OSM.elements;
      return J(r, { type: "FeatureCollection", features: els.map((e) => ({ type: "Feature", properties: { osm_type: e.type.charAt(0).toUpperCase(), osm_id: e.id, tags: e.tags }, geometry: { type: "Point", coordinates: [e.lon != null ? e.lon : e.center.lon, e.lat != null ? e.lat : e.center.lat] } })) });
    }
    if (/overpass|interpreter/.test(u)) {
      const q = decodeURIComponent(r.request().postData() || ""), x = /air_rescue_service/.test(q);
      if (x) { calls.overpassX++; return o.xFails ? r.fulfill({ status: 504, body: "" }) : J(r, OSMX); }
      if (/"country"="US"/.test(q)) { calls.overpassP = (calls.overpassP || 0) + 1; return J(r, { elements: OSMX.elements.filter((e) => e.tags.country) }); }
      calls.overpass++; return overpassFails ? r.fulfill({ status: 504, body: "" }) : J(r, OSM);
    }
    if (/\/table\/v1\//.test(u)) { calls.osrm++; return o.osrmFails ? r.fulfill({ status: 504, body: "" }) : J(r, osrm(u)); }
    /* the Route tab's alternates (phase 3 P/A/C): two lines, the second slower round a bend */
    if (/\/route\/v1\/.*alternatives=3/.test(u)) { calls.alt = (calls.alt || 0) + 1; return o.altFails ? r.fulfill({ status: 504, body: "" }) : J(r, osrmAlts(u)); }
    if (/\/route\/v1\//.test(u)) { calls.route++; return o.osrmFails ? r.fulfill({ status: 504, body: "" }) : J(r, osrmRoute(u)); }
    if (/valhalla.*sources_to_targets/.test(u)) { calls.vhm++; return o.vhFails ? r.fulfill({ status: 504, body: "" }) : J(r, vhMatrix(u)); }
    if (/valhalla.*\/route\?/.test(u) && /exclude_locations/.test(decodeURIComponent(u))) { calls.vhx = (calls.vhx || 0) + 1; return o.vhFails ? r.fulfill({ status: 504, body: "" }) : J(r, vhRoute(u)); }
    if (/valhalla.*\/route\?/.test(u)) { calls.vhr++; return o.vhFails ? r.fulfill({ status: 504, body: "" }) : J(r, vhRoute(u)); }
    if (/valhalla/.test(u)) { calls.iso++; return J(r, iso(u)); }
    if (/query\.wikidata\.org/.test(u) && /wikibase%3Aaround|wikibase:around/.test(u)) { calls.wdh = (calls.wdh || 0) + 1; return o.wdFails ? r.fulfill({ status: 504, body: "" }) : J(r, WDH); }
    if (/query\.wikidata\.org/.test(u)) { calls.wd++; return J(r, WD); }
    /* print map tiles (off unless a check sets TILES): "half" fails OpenStreetMap's odd columns, the Esri street map stands in */
    if (TILES.mode && /tile\.openstreetmap\.org\/|World_Street_Map/.test(u)) {
      const osm = /openstreetmap/.test(u), x = osm ? +u.split("/").slice(-2)[0] : 0;
      if (osm) { TILES.osm++; TILES.now++; TILES.max = Math.max(TILES.max, TILES.now); } else TILES.esri++;
      return new Promise((res) => setTimeout(res, osm ? 150 : 0)).then(() => {
        if (osm) TILES.now--;
        return osm && TILES.mode === "half" && x % 2 ? r.fulfill({ status: 503, body: "" }) : r.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG1 });
      });
    }
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
/* the toolbar's Med plan button (it closes an open plan, so it is only pressed when the plan is shut) */
async function medBtn(p) {
  await p.evaluate(() => { const m = document.getElementById("atk-pop"); if (m && !m.hidden) document.querySelector('#atk-tools [data-atk="area"]').click(); });
  if (await p.evaluate(() => { const m = document.getElementById("medplan"); return !m || m.hidden; })) await p.click('#atk-tools [data-atk="medplan"]');
}
async function openPlan(p) {
  await medBtn(p);
  await p.waitForFunction(() => { const t = document.querySelector("#mp-fac table"), w = document.querySelector("#mp-wx table"); return t && w && /min/.test(document.getElementById("mp-fac").textContent); }, null, { timeout: 20000 });
}

const HEX = /^[0-9a-f]{64}$/;
const square = (c, d) => [[c[0] - d, c[1] - d], [c[0] - d, c[1] + d], [c[0] + d, c[1] + d], [c[0] + d, c[1] - d]];
/* a hospital popup's button, as index.html puts it in OSAP's sourced hospitals layer */
async function popupBtn(p, sof, lat, lon, name) {
  await p.evaluate(([sof, lat, lon, name]) => {
    const d = document.createElement("div"); d.className = "pop"; d.id = "test-pop";
    d.innerHTML = '<p><button type="button" class="refresh" data-hosp-assess="' + sof + '" data-lat="' + lat + '" data-lon="' + lon + '" data-name="' + name + '">Hospital assessment</button></p>';
    document.body.appendChild(d);
  }, [sof, lat, lon, name]);
  await p.evaluate(() => document.querySelector("#test-pop [data-hosp-assess]").click());
  await p.evaluate(() => document.getElementById("test-pop").remove());
}
const fpDone = (p) => p.waitForFunction(() => { const c = document.getElementById("mps-fp"); return c && /^[0-9a-f]{64}$/.test(c.textContent); }, null, { timeout: 20000 });
const page = (p) => p.evaluate(() => {
  const b = document.getElementById("brief");
  return { shown: !!b && !b.hidden, h2: (b.querySelector("h2") || {}).textContent || "", h3: [...b.querySelectorAll("h3")].map((h) => h.textContent), text: b.textContent,
    fp: (document.getElementById("mps-fp") || {}).textContent || "", btn: [...b.querySelectorAll("[data-solo]")].map((x) => x.getAttribute("data-solo")),
    tag: [...b.querySelectorAll(".aitag")].map((x) => x.textContent), plan: (() => { const m = document.getElementById("medplan"); return !!m && !m.hidden; })() };
});

// ---------- desktop ----------
{
  const { ctx, p, errors, calls } = await open({ viewport: { width: 1400, height: 900 } }, { medfac: MF_ALL });
  // a hospital's map popup: its assessment straight away, no plan
  await popupBtn(p, "sof:th:hospital:trauma-test", 13.70, 100.40, "Trauma Test Hospital");
  await fpDone(p);
  let a = await page(p);
  ok(a.shown && /^Hospital assessment: Trauma Test Hospital/.test(a.h2), "popup: Hospital assessment opens for that hospital (" + a.h2 + ")");
  ok(!a.plan && calls.osrm === 0, "popup: no medical plan is opened or built");
  ok(["Location", "Capability and services", "Capability flags", "Planner's checks", "Landing", "Contacts and cover", "Data age", "Sources and fingerprint"].every((h) => a.h3.includes(h)) && !a.h3.some((h) => /point of injury|chosen point/.test(h)),
    "popup: every section, and no point-of-injury or chosen-point section without a chosen point: " + a.h3.join(" | "));
  ok(/Official trauma designation/.test(a.text) && /Level 1 trauma centre \(test\)/.test(a.text) && /Equivalent level/.test(a.text), "popup: the sourced trauma designation is shown with its source, the equivalent level on its own row");
  ok(/Not known/.test(a.text) && /Unknown is not the same as absent/.test(a.text), "popup: gaps say Not known, and unknown is never read as absent");
  ok(HEX.test(a.fp) && /osap\.hospital\.assess\/1/.test(a.text), "popup: SHA-256 fingerprint of the assessment record and its rule");
  ok(/OSAP stored copy, data as of 2026-09-30/.test(a.text) && /OSAP sourced list\s*As of 2026-09-27/.test(a.text), "popup: data age for the stored OpenStreetMap copy and OSAP's sourced list");
  ok(/02 777 1669/.test(a.text), "popup: the hospital's published emergency number from OSAP's stored phone list");
  ok(a.tag.every((t) => !/AI/.test(t)) && a.tag.includes("Automatic draft") && !/AI generated/.test(a.text), "popup: tagged Automatic draft, nothing tagged as AI");
  ok(["print", "map", "list", "close"].every((k) => a.btn.includes(k)), "popup: Export PDF, Show on map, Other hospitals here and Close " + a.btn.join(","));
  await p.waitForFunction(() => /\+66 2 777 1000/.test(document.getElementById("brief").textContent), null, { timeout: 10000 }).catch(() => {});
  ok(/\+66 2 777 1000/.test(await p.textContent("#brief")) && /Wikidata Q900001/.test(await p.textContent("#brief")), "popup: Wikidata's phone fills the gap, linked to its Wikidata item");
  await p.waitForFunction(() => { const i = document.getElementById("mpa-map"); return i && /^data:image\/png/.test(i.src); }, null, { timeout: 15000 }).catch(() => {});
  ok(await p.evaluate(() => /^data:image\/png/.test(document.getElementById("mpa-map").src) && /H this hospital/.test(document.getElementById("mpa-cap").textContent)), "popup: a map of the hospital, helipad and airfield is drawn");
  // Export PDF goes through OSAP_PDF with the page as the root
  await p.evaluate(() => { window.__pp = null; window.OSAP_PDF.print = (o) => { window.__pp = { title: o.title, root: o.root && o.root.id }; return Promise.resolve(); }; });
  await p.click('#brief [data-solo="print"]');
  await p.waitForFunction(() => window.__pp, null, { timeout: 10000 }).catch(() => {});
  const pp = await p.evaluate(() => window.__pp);
  ok(!!pp && pp.root === "brief" && /^Hospital assessment: Trauma Test Hospital/.test(pp.title), "Export PDF: prints the page through OSAP_PDF " + JSON.stringify(pp));
  // a planner's check on the standalone page
  const fp1 = a.fp;
  await p.selectOption('#mpa-chk select[name="cap"]', "dx.ct"); await p.selectOption('#mpa-chk select[name="exists"]', "yes"); await p.selectOption('#mpa-chk select[name="now"]', "available");
  await p.fill('#mpa-chk input[name="role"]', "ED charge nurse"); await p.click('#mpa-chk button[type="submit"]');
  await p.waitForFunction((f) => { const c = document.getElementById("mps-fp"); return c && /^[0-9a-f]{64}$/.test(c.textContent) && c.textContent !== f; }, fp1, { timeout: 10000 }).catch(() => {});
  a = await page(p);
  ok(a.fp !== fp1 && HEX.test(a.fp), "planner's check: the fingerprint changes with it");
  ok(await p.evaluate(() => /CT[\s\S]*V1/.test(document.getElementById("mpa-caps").textContent) && /ED charge nurse/.test(document.getElementById("mpa-chk").textContent) && /Latest/.test(document.getElementById("mps-age").textContent)),
    "planner's check: CT reads V1 in the capability flags, the check is listed and the data age shows it");
  await p.click('#brief [data-solo="close"]');
  ok(await p.evaluate(() => document.getElementById("brief").hidden && !window.OSAP_MEDPLAN._solo()), "Close: the page goes");

  // long-press > Plans > Hospital assessment here: the hospitals round the point
  await p.evaluate(() => window.OSAP_ATAK.ring(13.75, 100.5)); await p.waitForTimeout(150);
  await p.click('#atk-ring [data-rk="plans"]'); await p.waitForTimeout(150);
  ok(/Hospital assessment here/.test(await p.textContent("#atk-pop")), "long-press: Plans lists Hospital assessment here");
  await p.click('#atk-pop [data-pk="hosp"]');
  await p.waitForSelector("#brief table.mpsolo", { timeout: 20000 }).catch(() => {});
  const rows = await p.evaluate(() => [...document.querySelectorAll("#brief table.mpsolo tbody tr")].map((r) => r.cells[0].textContent));
  ok(rows.length >= 4 && /^Near Hospital/.test(rows[0]) && ["Far North Hospital", "Trauma Test Hospital", "Sourced Trauma Centre"].every((n) => rows.some((r) => r.startsWith(n))) && !rows.some((r) => /Distant Burn/.test(r)),
    "long-press: the hospitals within 25 km, nearest first " + JSON.stringify(rows));
  ok(await p.evaluate(() => /Trauma Level I \(official designation, reported\)/.test(document.querySelector("#brief table.mpsolo").textContent) && /No verified trauma designation/.test(document.querySelector("#brief table.mpsolo").textContent)), "long-press: each row says its sourced trauma level, or that none is verified");
  await p.click('#brief table.mpsolo tr:has-text("Trauma Test Hospital") [data-solo-pick]');
  await fpDone(p);
  await p.waitForFunction(() => /1 h 10 min/.test((document.getElementById("mpa-times") || {}).textContent || ""), null, { timeout: 15000 }).catch(() => {});
  a = await page(p);
  const tm = await p.evaluate(() => document.getElementById("mpa-times").textContent);
  ok(a.h3.includes("From the chosen point") && /Straight line/.test(tm) && /1 h 10 min/.test(tm) && /Rama IV Road/.test(tm) && /kn/.test(tm), "picked: straight line, road time, main roads and flight time from the chosen point: " + tm.slice(0, 200));
  await p.waitForFunction(() => /P the chosen point/.test((document.getElementById("mpa-cap") || {}).textContent || ""), null, { timeout: 15000 }).catch(() => {});
  ok(await p.evaluate(() => /^data:image\/png/.test(document.getElementById("mpa-map").src) && /P the chosen point/.test(document.getElementById("mpa-cap").textContent)), "picked: the map shows the chosen point and the road route");
  await p.click('#brief [data-solo="list"]');
  ok(await p.evaluate(() => !!document.querySelector("#brief table.mpsolo")), "Other hospitals here: back to the list");
  await p.click('#brief [data-solo="close"]');

  // a hospital at the pressed point opens straight away, with no chosen-point section
  await p.evaluate(() => window.OSAP_MEDPLAN.hospital({ at: [13.80, 100.50], from: [13.80, 100.50], pick: true }));
  await fpDone(p); a = await page(p);
  ok(/^Hospital assessment: Far North Hospital/.test(a.h2) && !a.h3.includes("From the chosen point"), "long-press on a hospital: its assessment opens straight away");
  await p.click('#brief [data-solo="close"]');

  // a name OSAP cannot match lists the hospitals instead
  await p.evaluate(() => window.OSAP_MEDPLAN.hospital({ at: [13.75, 100.5], name: "Imaginary Riverside Infirmary" }));
  await p.waitForSelector("#brief table.mpsolo", { timeout: 20000 }).catch(() => {});
  ok(/could not match Imaginary Riverside Infirmary/.test(await p.textContent("#brief")), "no match: says so and lists the hospitals nearby");
  await p.click('#brief [data-solo="close"]');

  // Reports lists it
  ok(await p.evaluate(() => window.OSAP_REPORTS.list().some((r) => r.id === "hospital" && r.ready && r.name === "Hospital assessment")), "Reports: Hospital assessment is listed and ready");

  // an open medical plan is left as it was
  await p.evaluate((P) => window.TSAP.areaApi.setArea(P), square(C0, 0.02)); await p.waitForTimeout(800);
  await openPlan(p);
  await p.waitForTimeout(1500);
  const before = await p.evaluate(() => ({ fac: document.getElementById("mp-fac").textContent, picks: window.OSAP_MEDPLAN._picks().map((x) => x.f.name) }));
  await popupBtn(p, "sof:th:hospital:near", 13.7601, 100.5101, "Near Hospital");
  await fpDone(p); a = await page(p);
  ok(/^Hospital assessment: Near Hospital/.test(a.h2) && /Standalone assessment/.test(a.text), "with a plan open: the standalone assessment opens");
  await p.click('#brief [data-solo="close"]'); await p.waitForTimeout(300);
  const after = await p.evaluate(() => ({ shown: !document.getElementById("medplan").hidden, fac: document.getElementById("mp-fac").textContent, picks: window.OSAP_MEDPLAN._picks().map((x) => x.f.name) }));
  ok(after.shown && after.fac === before.fac && JSON.stringify(after.picks) === JSON.stringify(before.picks), "with a plan open: the plan is unchanged after the standalone page closes " + JSON.stringify(after.picks));
  await p.click('#mp-fac tr:has-text("Far North Hospital") [data-mp-assess]');
  await p.waitForTimeout(500);
  ok(/Hospital assessment: Far North Hospital/.test(await p.textContent("#brief h2")) && /For the medical plan/.test(await p.textContent("#brief")), "with a plan open: the plan's own Assessment still works");
  ok(!errors.length, "desktop: no page errors " + errors.slice(0, 3).join(" | "));
  await ctx.close();
}

// ---------- phone ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, { medfac: MF_ALL });
  await popupBtn(p, "sof:th:hospital:far-north", 13.80, 100.50, "Far North Hospital");
  await fpDone(p);
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && !document.getElementById("brief").hidden), "phone: the assessment fits the screen with no sideways scroll");
  ok(!errors.length, "phone: no page errors " + errors.slice(0, 3).join(" | "));
  await ctx.close();
}

// ---------- failed lookup ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1400, height: 900 } }, { overpassFails: true, web: "fail", phones: null });
  await p.evaluate(() => { window.ASAP_SOF[window.TSAP.areaApi.cc || "th"].hospitals = []; });
  await p.evaluate(() => window.OSAP_MEDPLAN.hospital({ at: [13.75, 100.5], pick: true }));
  await p.waitForSelector("#brief .mpwarn", { timeout: 60000 }).catch(() => {});
  const t = await p.textContent("#brief").catch(() => "");
  ok(/The hospital lookup failed/.test(t) && /does not mean there is no hospital/.test(t) && await p.evaluate(() => !!document.querySelector('#brief [data-solo="retry"]')), "failed lookup: says so, never 'no hospital', and offers Try again");
  ok(!errors.length, "failed lookup: no page errors " + errors.slice(0, 3).join(" | "));
  await ctx.close();
}

await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
