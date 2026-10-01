// Headless check of the Medical plan (assets/osap-medplan.js) opened from Draw area on the map toolbar, on a desktop and a
// phone. OpenStreetMap (Overpass), OSRM and Open-Meteo are answered by fixed test data here, so the check is the same every
// run; tools/probe_medplan.sh checks the real hosts. Checks: the menu offers Medical plan only once an area is drawn; the plan
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
  { type: "node", id: 10, lat: 13.70, lon: 100.40, tags: { amenity: "hospital", name: "Trauma Test Hospital", "healthcare:speciality": "trauma;surgery" } },
  { type: "node", id: 11, lat: 13.752, lon: 100.498, tags: { emergency: "ambulance_station", name: "City Ambulance Station", phone: "+66 2 111 2222" } }
] };
/* air rescue bases and U.S. posts (the second, wider Overpass request) */
const OSMX = { elements: [
  { type: "node", id: 20, lat: 13.90, lon: 100.60, tags: { emergency: "air_rescue_service", name: "Test Air Rescue", phone: "+66 2 555 0100" } },
  { type: "node", id: 21, lat: 13.7362, lon: 100.5465, tags: { office: "diplomatic", diplomatic: "embassy", country: "US", name: "Embassy of the United States", phone: "+66 2 205 4000" } }
] };
/* OSAP's sourced list for the test country: one trauma centre OSM lacks, a 24-hour emergency note for Near Hospital,
   an international airport and the U.S. Embassy */
const SOF = { asof: "2026-09-27", hospitals: [
  { id: "sof:th:hospital:sourced-trauma", name: "Sourced Trauma Centre", city: "Testburi", address: "1 Trauma Way", emergency_24h: null, trauma_level: "Level 1 trauma centre (test)", lat: 13.80, lon: 100.56, src: "https://example.org/trauma", srcname: "Test ministry list" },
  { id: "sof:th:hospital:near", name: "Near Hospital", city: "Testburi", address: "", emergency_24h: true, trauma_level: null, lat: 13.7601, lon: 100.5101, src: "https://example.org/near", srcname: "Test wiki" }
], airports: [{ name: "Test International", icao: "VTTT", iata: "TTT", type: "large_airport", scheduled_service: "yes", lat: 13.69, lon: 100.75, src: "https://ourairports.com/airports/VTTT/", srcname: "OurAirports" }],
  posts: [{ name: "U.S. Embassy Bangkok", kind: "embassy", address: "95 Wireless Road, Bangkok", lat: 13.736167, lon: 100.546444, src: "https://travel.state.gov/test", srcname: "travel.state.gov" }] };
/* road time by destination: Trauma Test 70 min, Sourced Trauma 40, Far North 10, Near 25, the airport 30 */
function secsTo(lon, lat) {
  const k = lat.toFixed(2) + "," + lon.toFixed(2);
  return { "13.70,100.40": 4200, "13.80,100.56": 2400, "13.80,100.50": 600, "13.76,100.51": 1500, "13.69,100.75": 1800 }[k] ?? 700;
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
const WD = { results: { bindings: [
  { c: { value: "http://www.wikidata.org/entity/Q869" }, nLabel: { value: "191" }, useLabel: { value: "police" } },
  { c: { value: "http://www.wikidata.org/entity/Q869" }, nLabel: { value: "1669" }, useLabel: { value: "emergency medical services" } }
] } };
function meteo() {
  const days = ["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"], ht = [], vis = [], g = [], lc = [], pr = [], at = [];
  days.forEach((d) => { for (let h = 0; h < 24; h++) { ht.push(d + "T" + String(h).padStart(2, "0") + ":00"); vis.push(d === "2026-10-01" && h === 5 ? 800 : 20000); g.push(10); lc.push(d === "2026-10-02" ? 95 : 20); pr.push(0); at.push(30); } });
  return { hourly: { time: ht, visibility: vis, wind_gusts_10m: g, cloud_cover_low: lc, precipitation: pr, apparent_temperature: at },
    daily: { time: days, sunrise: days.map((d) => d + "T23:00"), sunset: days.map((d) => d + "T11:10"), precipitation_sum: [10, 8, 6, 0, 25, 0], wind_gusts_10m_max: [10, 10, 10, 12, 35, 10],
      apparent_temperature_max: [33, 33, 33, 36, 40, 31], apparent_temperature_min: [24, 24, 24, 25, 25, 24] } };
}
async function open(opts, overpassFails) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [], calls = { overpass: 0, overpassX: 0, osrm: 0, route: 0, meteo: 0, wd: 0, iso: 0 };
  const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(b) });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    if (/overpass|interpreter/.test(u)) {
      const x = /air_rescue_service/.test(decodeURIComponent(r.request().postData() || ""));
      if (x) { calls.overpassX++; return J(r, OSMX); }
      calls.overpass++; return overpassFails ? r.fulfill({ status: 504, body: "" }) : J(r, OSM);
    }
    if (/\/table\/v1\//.test(u)) { calls.osrm++; return J(r, osrm(u)); }
    if (/\/route\/v1\//.test(u)) { calls.route++; return J(r, osrmRoute(u)); }
    if (/valhalla/.test(u)) { calls.iso++; return J(r, iso(u)); }
    if (/query\.wikidata\.org/.test(u)) { calls.wd++; return J(r, WD); }
    if (/api\.open-meteo\.com\/v1\/forecast/.test(u)) { if (/hourly=visibility,wind_gusts_10m,cloud_cover_low/.test(u)) calls.meteo++; return J(r, meteo()); }
    return r.abort();
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
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
async function openPlan(p) {
  await areaMenu(p);
  await p.click('#atk-pop [data-pk="med"]');
  await p.waitForFunction(() => { const t = document.querySelector("#mp-fac table"), w = document.querySelector("#mp-wx table"); return t && w && /min/.test(document.getElementById("mp-fac").textContent); }, null, { timeout: 20000 });
}

// ---------- desktop ----------
{
  const { ctx, p, errors, calls } = await open({ viewport: { width: 1400, height: 900 } });
  await p.evaluate(() => { try { window.TSAP.areaApi.setArea(null); } catch (e) {} });
  ok(!/Medical plan/.test(await areaMenu(p)), "desktop: no Medical plan in the Area menu before an area is drawn");
  await p.click('#atk-tools [data-atk="area"]'); await p.waitForTimeout(100);
  await p.evaluate((P) => window.TSAP.areaApi.setArea(P), square(C0, 0.02));
  ok(/Medical plan/.test(await areaMenu(p)), "desktop: Area menu offers Medical plan once an area is drawn");
  await p.click('#atk-tools [data-atk="area"]'); await p.waitForTimeout(100);
  await openPlan(p);
  ok(await p.evaluate(() => !!window.OSAP_MEDPLAN && !document.getElementById("medplan").hidden), "desktop: Medical plan in the Area menu opens the plan");
  ok(/Centred on the centre of the area/.test(await p.textContent("#medplan")), "desktop: with no point of injury set, the plan is centred on the area's centre");
  await p.waitForFunction(() => document.querySelectorAll("#mp-rt h4").length === 3 && !/Working out the route/.test(document.getElementById("mp-rt").textContent), null, { timeout: 10000 });
  const fac = await p.textContent("#mp-fac");
  const order = (await p.$$eval("#mp-fac table", (t) => [...t[0].querySelectorAll("tbody tr td:nth-child(2) b")].map((x) => x.textContent)));
  ok(order.join("|") === "Trauma Test Hospital|Sourced Trauma Centre|Far North Hospital|Near Hospital", "desktop: hospitals ranked by capability, then drive time: " + order.join(", "));
  ok(await p.evaluate(() => /Most capable/.test(document.querySelector("#mp-fac tbody tr td:nth-child(2)").textContent)), "desktop: the first hospital is marked Most capable");
  ok(/Trauma centre \(sourced\)/.test(fac) && /Level 1 trauma centre \(test\)/.test(fac) && await p.evaluate(() => [...document.querySelectorAll("#mp-fac a")].some((a) => a.href === "https://example.org/trauma")), "desktop: a stated trauma designation shows with its source link");
  ok(/Trauma speciality listed/.test(fac), "desktop: an OSM trauma speciality counts as stated, linked to OSM");
  ok(/Medium \(estimated\)/.test(fac) && /Estimated from: emergency department, 300 beds/.test(fac), "desktop: other hospitals rated as estimates with the reasons shown");
  ok(/24-hour emergency \(Test wiki\)/.test(fac), "desktop: an OSM hospital is matched to its sourced record");
  ok(!/Role [1-4]\b/.test(fac), "desktop: no military Role designation is invented for a civilian hospital");
  ok(/10 min/.test(fac) && /25 min/.test(fac), "desktop: drive times shown (10 min, 25 min)");
  const gh = await p.$$eval("#mp-fac table", (t) => [...t[0].querySelectorAll("tbody tr")].map((r) => (r.querySelector(".mpgh") || {}).textContent || ""));
  ok(gh[0] === "Beyond golden hour" && gh[1] === "Inside golden hour" && gh[2] === "Inside golden hour", "desktop: golden-hour badges from treat-and-load plus drive: " + gh.join(", "));
  ok(/Helipad on site/.test(fac) || /helipad on site/.test(fac), "desktop: a helipad next to a hospital counts");
  ok(/47P [A-Z]{2} \d{4} \d{4}/.test(fac), "desktop: facilities carry MGRS grids");
  ok(/name withheld/.test(fac) && !/Somchai/.test(await p.textContent("#medplan")) && !/777 8888/.test(await p.innerHTML("#medplan")), "desktop: a clinic named after a doctor is withheld, with its phone");
  ok(/Community Health Centre 7/.test(fac) && !/Smile Dental/.test(fac), "desktop: public clinic listed, dentist left out");
  ok(await p.evaluate(() => !!document.querySelector('#mp-fac a[href="tel:+6629990000"]')) && /Website/.test(fac) && /Address: North Road, Testburi/.test(fac), "desktop: hospital phone, website and address shown");
  ok(/listed in OpenStreetMap/.test(fac), "desktop: each published number says where it is listed");
  ok(/flight|kn/i.test(fac) && /at 120 kn/.test(fac), "desktop: flight time from the POI at the stated cruise speed");
  const rt = await p.textContent("#mp-rt");
  ok(/Route 1: to H1 Trauma Test Hospital/.test(rt) && /Most capable inside the golden hour/.test(rt) && /Nearest by road/.test(rt), "desktop: routes to the most capable, the best inside the golden hour and the nearest");
  ok(/Main roads: Rama IV Road \(5\.0 km\) → 3 Sukhumvit Road \(2\.5 km\)/.test(rt), "desktop: each route lists its main roads");
  const ghs = await p.textContent("#mp-gh");
  ok(/60 minutes from injury/.test(ghs) && /10 minutes to treat and load/.test(ghs) && /green outline/.test(ghs), "desktop: golden-hour section states its thresholds and the drawn reach");
  const ems = await p.textContent("#mp-ems");
  ok(/1669: emergency medical services/.test(ems) && /191: police/.test(ems) && ems.indexOf("1669") < ems.indexOf("191"), "desktop: local emergency numbers, ambulance first");
  ok(await p.evaluate(() => [...document.querySelectorAll("#mp-ems a")].some((a) => a.href === "https://www.wikidata.org/wiki/Q869#P2852")), "desktop: emergency numbers link to their Wikidata source");
  ok(/City Ambulance Station/.test(ems) && /111 2222/.test(ems), "desktop: ambulance stations near the POI with their published phone");
  const mev = await p.textContent("#mp-mev");
  ok(/Test Air Rescue/.test(mev) && /555 0100/.test(mev) && /to the POI at 120 kn/.test(mev), "desktop: air rescue base with phone and flight time to the POI");
  ok(/launch, fly in, 10 min on the ground, fly to H1/.test(mev) && /(Inside|Beyond) golden hour|golden-hour limit/.test(mev), "desktop: medevac call-to-hospital time against the golden hour");
  const air = await p.textContent("#mp-air");
  ok(/Riverside Pad/.test(air) && /Test Airfield/.test(air) && /VTXX/.test(air), "desktop: helipads and airfields listed with ICAO code");
  ok(await p.evaluate(() => document.querySelectorAll("#mp-air table")[0].querySelectorAll("tbody tr").length === 2), "desktop: disused helipad left out");
  const wx = await p.textContent("#mp-wx");
  ok(/2026-10-01/.test(wx) && /visibility below 1\.6 km/.test(wx) && /gusts to 35 kn/.test(wx) && /high heat-injury risk/.test(wx), "desktop: weather flags from the rules (visibility, gusts, heat)");
  ok(/low cloud cover up to 95%/.test(wx), "desktop: low cloud flag");
  ok(!/2026-09-29/.test(wx), "desktop: past days are not listed as forecast");
  ok(/24 mm of rain in the last 3 days/.test(wx) && /ground is probably wet/.test(wx), "desktop: ground state from the last 3 days of rain (24 mm: wet)");
  ok(calls.overpass === 1 && calls.overpassX === 1 && calls.osrm === 1 && calls.route === 3 && calls.meteo === 1 && calls.wd === 1 && calls.iso === 1, "desktop: one request per source, three routes " + JSON.stringify(calls));
  ok(await p.evaluate(() => document.querySelectorAll(".mpicon").length === 12), "desktop: numbered marks on the map (centre, 4 hospitals, 2 clinics, ambulance station, 2 helipads, airfield, air rescue base)");
  const lines = () => p.evaluate(() => { let r = 0, g = 0; window.__asapMap.eachLayer((l) => { if (l instanceof L.Polygon) { if (/#1e7a3a|#c77700/.test(l.options.color)) g++; } else if (l instanceof L.Polyline && /#D7141A|#222|#1d5fa8/.test(l.options.color)) r++; }); return { r, g }; });
  const ln = await lines();
  ok(ln.r === 3 && ln.g === 2, "desktop: three routes and two golden-hour outlines drawn on the map " + JSON.stringify(ln));
  ok(await p.evaluate(() => /Automatic draft/.test(document.querySelector("#medplan .mphead").textContent) && !/AI generated/.test(document.getElementById("medplan").textContent)), "desktop: labelled Automatic draft, no AI tag");
  ok(/published numbers of institutions/.test(await p.textContent("#medplan")), "desktop: the plan says how phone numbers are sourced");
  await p.waitForFunction(() => /^[0-9a-f]{64}$/.test((document.getElementById("mp-fp") || {}).textContent || ""), null, { timeout: 5000 }).catch(() => {});
  ok(/^[0-9a-f]{64}$/.test(await p.textContent("#mp-fp")), "desktop: plan fingerprint is a SHA-256");
  // cruise speed changes flight times without new requests
  await p.fill('#mp-mev [data-mpf="rwkn"]', "240"); await p.waitForTimeout(1000);
  ok(/to the POI at 240 kn/.test(await p.textContent("#mp-mev")) && calls.overpass === 1, "desktop: a new cruise speed recomputes flight times on the device");
  // out of country
  await p.check('#mp-oc [data-mp-oc]');
  await p.waitForFunction(() => /D1/.test(document.getElementById("mp-oc").textContent) && /Road route to P1/.test(document.getElementById("mp-oc").textContent), null, { timeout: 15000 });
  const oc = await p.textContent("#mp-oc");
  ok(/Test International/.test(oc) && /VTTT \/ TTT/.test(oc) && /30 min/.test(oc), "out of country: departure airport with drive time");
  ok(/Receiving hospitals in nearby countries/.test(oc) && await p.evaluate(() => document.querySelectorAll("#mp-oc tbody tr").length >= 2), "out of country: sourced hospitals in nearby countries");
  ok(/at 250 kn \+ 15 min launch/.test(oc), "out of country: flight times state the speed and launch time");
  ok(/U\.S\. Embassy Bangkok/.test(oc) && /205 4000/.test(oc) && /1-888-407-4747/.test(oc) && /\+1 202-501-4444/.test(oc) && /travel\.state\.gov/.test(oc), "out of country: embassy address and phone, State Department emergency numbers with source");
  ok(await p.evaluate(() => [...document.querySelectorAll(".mpicon")].some((m) => m.textContent === "P1")), "out of country: the airport is marked on the map");
  // point of injury picked on the map
  await p.click('#medplan [data-mp="pick"]');
  ok(await p.evaluate(() => document.getElementById("medplan").hidden && !!document.getElementById("mp-pickbar")), "POI: Pick on map hides the plan and asks for a tap");
  const box = await p.evaluate(() => { const r = window.__asapMap.getContainer().getBoundingClientRect(); return { x: r.left + r.width / 2 + 40, y: r.top + r.height / 2 + 30 }; });
  await p.evaluate(({ x, y }) => { const m = window.__asapMap; m.fire("click", { latlng: m.containerPointToLatLng([x - m.getContainer().getBoundingClientRect().left, y - m.getContainer().getBoundingClientRect().top]) }); }, box);
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
  // Print prints only the plan
  const pr = await p.evaluate(() => new Promise((res) => { window.print = () => res(document.documentElement.classList.contains("medprint")); document.querySelector('#medplan [data-mp="print"]').click(); }));
  ok(pr, "desktop: Print marks the page so only the plan prints");
  await p.emulateMedia({ media: "print" });
  await p.evaluate(() => document.documentElement.classList.add("medprint"));
  ok(await p.evaluate(() => [...document.body.children].every((e) => e.id === "medplan" || getComputedStyle(e).display === "none") && getComputedStyle(document.getElementById("medplan")).display !== "none" && getComputedStyle(document.querySelector('#medplan [data-mp="print"]')).display === "none"), "desktop: in print only the plan shows, without its buttons");
  if (OUT) await p.screenshot({ path: OUT + "/print.png", fullPage: true });
  if (OUT) await p.pdf({ path: OUT + "/medplan.pdf", format: "A4", margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" } });
  await p.evaluate(() => document.documentElement.classList.remove("medprint")); await p.emulateMedia({ media: "screen" });
  if (OUT) await p.screenshot({ path: OUT + "/desk-plan.png" });
  await p.click('#medplan [data-mp="close"]');
  ok(await p.evaluate(() => document.getElementById("medplan").hidden && !document.querySelector(".mpicon")) && (await lines()).r === 0 && (await lines()).g === 0, "desktop: Close hides the plan and takes the marks, routes and outlines off the map");
  ok(!errors.length, "desktop: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- phone, and OpenStreetMap down ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, true);
  await p.evaluate((P) => window.TSAP.areaApi.setArea(P), square(C0, 0.02));
  await p.evaluate(() => { const b = document.getElementById("atk-tools"); if (b && b.classList.contains("folded")) b.querySelector('[data-atk="fold"]').click(); });
  await areaMenu(p); await p.click('#atk-pop [data-pk="med"]');
  await p.waitForFunction(() => /could not be reached/.test((document.getElementById("mp-fac") || {}).textContent || ""), null, { timeout: 20000 });
  ok(/Try again/.test(await p.textContent("#mp-fac")), "phone: OpenStreetMap down says so and offers Try again");
  await p.waitForFunction(() => document.querySelector("#mp-wx table"), null, { timeout: 10000 });
  ok(true, "phone: weather still shows when OpenStreetMap is down");
  await p.waitForFunction(() => /1669/.test(document.getElementById("mp-ems").textContent), null, { timeout: 10000 });
  ok(true, "phone: emergency numbers still show when OpenStreetMap is down");
  ok(await p.evaluate(() => document.getElementById("medplan").scrollWidth <= window.innerWidth + 1 && document.querySelector("#medplan .mpbox").getBoundingClientRect().width <= window.innerWidth), "phone: the plan fits the screen width");
  if (OUT) await p.screenshot({ path: OUT + "/phone-plan.png" });
  ok(!errors.length, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- rule helpers ----------
{
  const ctx = await browser.newContext({ serviceWorkers: "block" }), p = await ctx.newPage();
  await p.goto(base + "tests/", { waitUntil: "domcontentloaded" }).catch(() => {});
  p.on("pageerror", (e) => console.log("helper page error: " + e.message));
  await p.addScriptTag({ url: base + "assets/osap-geo.js" }); await p.addScriptTag({ url: base + "assets/osap-medplan.js" });
  const r = await p.evaluate(() => { const M = window.OSAP_MEDPLAN; return {
    a: M._facName({ name: "Klinik dr. Budi" }, "clinic"), b: M._facName({ name: "Dr. Smith's Surgery" }, "clinic"), c: M._facName({ name: "Bangkok Hospital" }, "hospital"),
    d: M._facName({ name: "Hospital Drive Clinic" }, "clinic"), e: M._parseGrid("13.75, 100.5"), f: M._parseGrid("47P PR 6300 2000"), g: M._parseGrid("nonsense"),
    h: M._wxFlags({ vis: 5000, gust: 12, lc: 10, rain: 1, hi: 25, lo: 10 }).length,
    i: M._capability({ name: "X", lat: 0, lon: 0, er: "yes", pad: true, beds: 600 }, []).tier, j: M._capability({ name: "Y", lat: 0, lon: 0 }, []).tier,
    k: M._golden(45 * 60).c + M._golden(55 * 60).c + M._golden(61 * 60).c, l: Math.round(M._flightS(222240, 120) / 60),
    m: M._phoneOf({ phone: "+66 2 123 4567;+66 2 765 4321" }), n: M._phoneOf({ phone: "call us" }), o: M._webOf({ website: "javascript:alert(1)" }), q: M._webOf({ website: "www.x.org" }) }; });
  ok(/withheld/.test(r.a) && /withheld/.test(r.b) && r.c === "Bangkok Hospital" && r.d === "Hospital Drive Clinic", "rules: doctor-named clinics withheld, others kept");
  ok(r.e && r.e[0] === 13.75 && r.f && Math.abs(r.f[0] - 13.7) < 1 && r.g === null, "rules: grids parse from lat, lon and MGRS; nonsense does not");
  ok(r.h === 0, "rules: calm weather raises no flags");
  ok(r.i === 3 && r.j === 0, "rules: emergency dept + helipad + 600 beds rate High (estimated); nothing listed rates Not known");
  ok(r.k === "gar", "rules: golden hour inside up to 50 min, at the limit to 60, beyond after");
  ok(r.l === 60, "rules: 120 nautical miles at 120 kn is 60 minutes");
  ok(r.m === "+66 2 123 4567" && r.n === "" && r.o === "" && r.q === "https://www.x.org", "rules: only well-formed phones and web links are shown");
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? `${fails} check(s) failed` : "all medical plan checks passed");
process.exit(fails ? 1 : 0);
