// Headless check of the Area study (assets/osap-areastudy.js) opened from Draw area on the map toolbar, on a desktop and a
// phone. Every outside host is answered by fixed test data here (OpenStreetMap's Overpass, the elevation tiles, Open-Meteo's
// forecast and history, Wikidata, OSAP's stored health facilities), so the check is the same every run.
// Checks: the Area menu lists Area study; the study opens for the drawn area with all eight parts; terrain heights and the
// slope table come from the elevation tiles; the forecast and the 12-month climate table are drawn; OpenStreetMap places,
// power, masts, roads, airfields, military areas and border posts are counted inside the outline; OSAP's reference data
// (advisory, WRI plant, airport, port, embassy) and its UCDP file are used with their source links; hospitals come from the
// stored copy; emergency numbers come from Wikidata; only the country brief's text carries the "AI generated" tag; every
// link is http(s); the fingerprint is a SHA-256; a failed OpenStreetMap look-up says so and Try again works; an area too
// large for a live look-up is refused without asking; the print view shows every part with a map; the phone layout fits.
// Run from the repo root: node tests/areastudy_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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

/* a terrarium elevation tile at zoom 12: height rises 0.5 m per pixel eastwards across tiles, so the test area is one gentle, seamless slope */
function crc32(b) { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } c = 0xffffffff; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
function demTile(tx) {
  const raw = Buffer.alloc(256 * (1 + 256 * 3));
  for (let y = 0; y < 256; y++) { raw[y * 769] = 0; for (let x = 0; x < 256; x++) { const v = 100 + 0.5 * Math.max(0, (tx - 3180) * 256 + x) + 32768, i = y * 769 + 1 + x * 3; raw[i] = v >> 8; raw[i + 1] = v & 255; raw[i + 2] = Math.round((v % 1) * 256); } }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(256, 0); ih.writeUInt32BE(256, 4); ih[8] = 8; ih[9] = 2; ih[10] = 0; ih[11] = 0; ih[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/* the test area: a square of 0.2 degrees round 13.75 N, 100.50 E */
const C0 = [13.75, 100.5];
const square = (c, d) => [[c[0] - d, c[1] - d], [c[0] - d, c[1] + d], [c[0] + d, c[1] + d], [c[0] + d, c[1] - d]];
const cnt = (n) => ({ type: "count", id: 0, tags: { nodes: "0", ways: String(n), relations: "0", total: String(n) } });
const OSM = { osm3s: { timestamp_osm_base: "2026-10-01T06:00:00Z" }, elements: [
  { type: "node", id: 1, lat: 13.76, lon: 100.51, tags: { place: "city", name: "Testburi", population: "250,000", "population:date": "2020" } },
  { type: "node", id: 2, lat: 13.70, lon: 100.45, tags: { place: "town", name: "Little Town" } },
  { type: "node", id: 99, lat: 15.0, lon: 101.0, tags: { place: "town", name: "Far Away Town", population: "900000" } },
  cnt(37),
  { type: "way", id: 3, center: { lat: 13.72, lon: 100.55 }, tags: { power: "plant", name: "Test Power Station", "plant:source": "gas", "plant:output:electricity": "700 MW" } },
  cnt(12), cnt(80), cnt(9),
  { type: "node", id: 4, lat: 13.74, lon: 100.52, tags: { man_made: "mast", "communication:mobile_phone": "yes" } },
  { type: "node", id: 5, lat: 13.75, lon: 100.53, tags: { man_made: "tower", "tower:type": "broadcasting" } },
  { type: "node", id: 6, lat: 13.76, lon: 100.54, tags: { man_made: "mast" } },
  { type: "node", id: 7, lat: 13.78, lon: 100.48, tags: { aeroway: "aerodrome", name: "Test Airfield", icao: "VTXX", surface: "asphalt" } },
  { type: "node", id: 8, lat: 13.77, lon: 100.47, tags: { aeroway: "helipad" } },
  { type: "way", id: 9, center: { lat: 13.69, lon: 100.58 }, tags: { landuse: "port", name: "River Port" } },
  { type: "way", id: 10, tags: { highway: "motorway", ref: "7" } }, { type: "way", id: 11, tags: { highway: "motorway", ref: "7" } },
  { type: "way", id: 12, tags: { highway: "trunk", ref: "AH2;4" } }, { type: "way", id: 13, tags: { highway: "primary", name: "Rama IV Road" } },
  cnt(25), cnt(3),
  { type: "way", id: 14, center: { lat: 13.73, lon: 100.46 }, tags: { landuse: "military", name: "Test Barracks", military: "barracks" } },
  { type: "node", id: 15, lat: 13.71, lon: 100.49, tags: { military: "checkpoint" } },
  { type: "node", id: 16, lat: 13.80, lon: 100.60, tags: { barrier: "border_control", name: "Test Border Post" } }
] };
const MF_ROWS = [
  ["n101", 13.755, 100.505, "th", { amenity: "hospital", name: "Testburi Hospital", emergency: "yes", beds: "400" }],
  ["n102", 13.70, 100.70, "th", { amenity: "hospital", name: "Outside Hospital" }],
  ["n103", 13.74, 100.50, "th", { amenity: "clinic", name: "Community Clinic" }],
  ["n104", 13.745, 100.495, "th", { amenity: "hospital" }]
];
function meteo() {
  const days = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"];
  return { timezone: "Asia/Bangkok", utc_offset_seconds: 25200, daily: { time: days, temperature_2m_max: days.map(() => 33), temperature_2m_min: days.map(() => 24), precipitation_sum: days.map((d, i) => i), precipitation_probability_max: days.map(() => 60),
    wind_gusts_10m_max: days.map(() => 18), sunrise: days.map((d) => d + "T06:05"), sunset: days.map((d) => d + "T18:01") } };
}
function archive() {
  const time = [], hi = [], lo = [], p = [];
  for (let t = Date.UTC(2016, 0, 1); t <= Date.UTC(2025, 11, 31); t += 864e5) {
    const d = new Date(t).toISOString().slice(0, 10), m = +d.slice(5, 7);
    time.push(d); hi.push(m === 4 ? 36 : 31); lo.push(m === 12 ? 18 : 24); p.push(m >= 6 && m <= 10 ? 8 : m === 1 ? 0 : 0.5);
  }
  return { timezone: "Asia/Bangkok", daily: { time, temperature_2m_max: hi, temperature_2m_min: lo, precipitation_sum: p } };
}
const WD = { results: { bindings: [{ c: { value: "http://www.wikidata.org/entity/Q869" }, nLabel: { value: "1669" }, d: { value: "emergency medical services number in Thailand" } }, { c: { value: "http://www.wikidata.org/entity/Q869" }, nLabel: { value: "191" }, u1Label: { value: "police" } }] } };
const SOF = { asof: "2026-09-27",
  advisory: { level: 1, level_text: "Exercise normal precautions", issued: "2026-07-07", areas: [{ area: "Test border", level: 2, reason: "risk of armed conflict" }], src: "https://travel.state.gov/test-advisory", srcname: "travel.state.gov" },
  power: [{ name: "WRI Test Plant", fuel: "Gas", capacity_mw: 1200, lat: 13.71, lon: 100.52, src: "https://datasets.wri.org/test", srcname: "WRI Global Power Plant Database v1.3.0, CC BY 4.0" }],
  airports: [{ name: "Test International", icao: "VTTT", iata: "TTT", lat: 13.69, lon: 100.75, longest_runway: { length_ft: 13123, surface: "CON" }, src: "https://ourairports.com/airports/VTTT/" }],
  seaports: [{ name: "Test Harbour", unlocode: "TH TST", lat: 13.6, lon: 100.6, src: "https://service.unece.org/trade/locode/th.htm" }],
  hospitals: [{ name: "Sourced Trauma Centre", city: "Testburi", trauma_level: "Level 1 trauma centre (test)", lat: 13.80, lon: 100.56, src: "https://example.org/trauma", srcname: "Test ministry list" }],
  posts: [{ name: "U.S. Embassy Bangkok", kind: "embassy", address: "95 Wireless Road, Bangkok", lat: 13.736167, lon: 100.546444, src: "https://travel.state.gov/test", srcname: "travel.state.gov" }] };
const BRIEF = { as_of: "2026-09-26", pmesii: { social: { text: "Test social text about the whole country.", src: [0] }, infrastructure: { text: "Test infrastructure text.", src: [0] } },
  threat: { overall: { rating: "Moderate", reason: "Test overall reason." }, categories: [{ name: "Terrorism / insurgency", rating: "Moderate", reason: "Test reason.", src: [0] }] },
  sources: [{ title: "Test source", url: "https://example.org/brief-source" }], gaps: ["Test gap."] };
const UCDP = { asof: "2026-10-01 09:45Z", src: "https://ucdp.uu.se/downloads/test.csv", items: [
  { id: "u1", date: "2026-08-20", lat: 13.74, lon: 100.51, where: "in Testburi", type: "state-based", sideA: "Government of Test", sideB: "Test Front", best: 2, low: 2, high: 3 },
  { id: "u2", date: "2026-08-21", lat: 16.0, lon: 102.0, where: "far away", type: "non-state", sideA: "A", sideB: "B", best: 1, low: 1, high: 1 }] };

async function open(opts, o = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [], calls = { overpass: 0, dem: 0, meteo: 0, era: 0, wd: 0, medfac: 0 };
  const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(b) });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    if (/overpass|interpreter/.test(u)) { calls.overpass++; calls.lastQ = decodeURIComponent(r.request().postData() || ""); return o.overpassFails && !o.up ? r.fulfill({ status: 504, body: "" }) : J(r, OSM); }
    if (/elevation-tiles-prod\/terrarium/.test(u)) { calls.dem++; return r.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: demTile(+u.split("/").slice(-2)[0]) }); }
    if (/archive-api\.open-meteo\.com/.test(u)) { calls.era++; return J(r, archive()); }
    if (/api\.open-meteo\.com\/v1\/forecast/.test(u)) { calls.meteo++; return J(r, meteo()); }
    if (/query\.wikidata\.org/.test(u)) { calls.wd++; return J(r, WD); }
    return r.abort();
  });
  await ctx.route(/\/data\/medfac\//, (r) => {
    calls.medfac++;
    const u = r.request().url();
    if (/index\.json/.test(u)) return J(r, { v: 1, tile: 2, countries: { th: { at: "2026-09-30T02:00:00Z", n: {}, tiles: ["12_100"] } }, tiles: { "12_100": MF_ROWS.length } });
    if (/t\/12_100\.json/.test(u)) return J(r, MF_ROWS);
    return r.fulfill({ status: 404, body: "" });
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("asap-period", "30d"); } catch (e) {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base, { waitUntil: "domcontentloaded" }); await p.waitForFunction(() => window.TSAP && window.TSAP.areaApi && document.getElementById("atk-tools") && window.OSAP_AREASTUDY, null, { timeout: 60000 });
  await p.waitForTimeout(3000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
  await p.evaluate(([S, B, U]) => { const c = window.TSAP.areaApi.cc || "th"; window.ASAP_SOF = window.ASAP_SOF || {}; window.ASAP_SOF[c] = Object.assign({ cc: c, country: "Thailand" }, S);
    window.ASAP_BRIEF = window.ASAP_BRIEF || {}; window.ASAP_BRIEF[c] = Object.assign({ cc: c }, B); window.ASAP_UCDP = U; }, [SOF, BRIEF, UCDP]);
  return { ctx, p, errors, calls };
}
async function areaMenu(p) {
  for (let i = 0; i < 2; i++) {
    await p.click('#atk-tools [data-atk="area"]'); await p.waitForTimeout(150);
    if (await p.evaluate(() => !document.getElementById("atk-pop").hidden)) break;
  }
  return p.textContent("#atk-pop");
}
const done = (p) => p.waitForFunction(() => { const t = document.getElementById("astudy"); return t && !t.hidden && !/(Reading|Looking up)[^.]*…/.test(t.textContent) && /[0-9a-f]{64}/.test((document.getElementById("as-fp") || {}).textContent || ""); }, null, { timeout: 30000 }).then(() => true, () => false);

// ---------- desktop ----------
{
  const { ctx, p, errors, calls } = await open({ viewport: { width: 1400, height: 900 } });
  await p.evaluate((P) => window.TSAP.areaApi.setArea(P), square(C0, 0.1)); await p.waitForTimeout(500);
  ok(/Area study/.test(await areaMenu(p)), "desktop: Area menu lists Area study");
  ok(calls.era === 0 && !/poly:"/.test(calls.lastQ || ""), "desktop: nothing is fetched before the study is picked " + JSON.stringify(calls));
  await p.click('#atk-pop [data-pk="study"]');
  ok(await done(p), "desktop: the study opens and every part finishes");
  const t = await p.textContent("#astudy");
  ok(["At a glance", "1. Terrain and elevation", "2. Weather and climate", "3. Population and settlements", "4. Infrastructure", "5. Security and threats", "6. Medical", "7. Key contacts", "8. Sources, gaps and fingerprint"].every((h) => t.includes(h)), "desktop: all eight parts and the glance table are there");
  const ter = await p.textContent("#as-ter");
  ok(/Gently rolling|Flat|Hilly/.test(ter) && /Highest point/.test(ter) && /47P [A-Z]{2} \d{4} \d{4}/.test(ter), "desktop: terrain word, highest point with MGRS grid");
  const hm = ter.match(/Heights run from ([\d,]+) m to ([\d,]+) m/);
  ok(hm && +hm[1].replace(/,/g, "") > 1000 && +hm[2].replace(/,/g, "") < 1800 && +hm[2].replace(/,/g, "") - +hm[1].replace(/,/g, "") > 200, "desktop: heights come from the elevation tiles: " + (hm ? hm[0] : ter.slice(0, 120)));
  ok(/On foot/.test(ter) && /Wheeled 4x4/.test(ter) && /Tracked/.test(ter) && /100%/.test(ter), "desktop: movement-by-slope table for three movers " + ter.slice(0, 900));
  ok(await p.$$eval("#as-wx table", (x) => x.length === 2 && x[0].querySelectorAll("tbody tr").length === 7 && x[1].querySelectorAll("tbody tr").length === 12), "desktop: 7-day forecast and 12-month climate tables");
  const wx = await p.textContent("#as-wx");
  ok(/Warmest month Apr/.test(wx) && /coolest Dec/.test(wx) && /Wet months[^:]*: Jun, Jul, Aug, Sep, Oct/.test(wx) && /Dry months[^:]*: Jan/.test(wx), "desktop: climate words follow the stated rules");
  ok(/06:05|23:05Z|2305Z/.test(wx), "desktop: sunrise shown with Zulu and local time");
  const pop = await p.textContent("#as-pop");
  ok(/1 city, 1 town and 37 villages/.test(pop) && /Testburi/.test(pop) && /250,000/.test(pop) && !/Far Away Town/.test(pop), "desktop: places inside the outline with population tags and the village count");
  ok(/not added up/.test(pop), "desktop: population tags are not summed");
  const inf = await p.textContent("#as-inf");
  ok(/1 power plant, 12 substations, 80 power line sections \(9 sections at 200 kV/.test(inf) && /Test Power Station/.test(inf), "desktop: power from OpenStreetMap");
  ok(/WRI Test Plant/.test(inf) && /1,200 MW/.test(inf), "desktop: WRI plant from the reference data");
  ok(/3 masts: 1 mobile phone, 1 radio or TV broadcast, 1 with no service tagged/.test(inf), "desktop: masts sorted by service");
  ok(/Motorways:\s*7/.test(inf) && /Trunk roads:\s*AH2/.test(inf) && /Rama IV Road/.test(inf) && /25 mapped track sections, 3 stations/.test(inf), "desktop: main roads by class and railway");
  ok(/1 airfield or airstrip, 1 helipad/.test(inf) && /Test Airfield/.test(inf) && /Test International/.test(inf) && /13,123 ft/.test(inf), "desktop: airfields from OSM and airports from the reference data");
  ok(/River Port/.test(inf) && /Test Harbour/.test(inf), "desktop: ports from OSM and UN/LOCODE");
  const sec = await p.textContent("#as-sec");
  ok(/Level 1, Exercise normal precautions/.test(sec) && /Test border \(Level 2/.test(sec), "desktop: advisory and its named areas");
  ok(/1 UCDP event inside the area/.test(sec) && /Test Front/.test(sec) && !/far away/.test(sec), "desktop: UCDP events inside the outline only");
  ok(/Reports inside the area/.test(sec), "desktop: reports part present");
  ok(/1 military area or site, 1 checkpoint, 0 border posts/.test(sec) && /Test Barracks/.test(sec), "desktop: military areas and checkpoints inside the outline (the border post outside is left out)");
  const med = await p.textContent("#as-med");
  ok(/1 named hospital and 1 clinic mapped inside the area/.test(med) && /Testburi Hospital/.test(med) && /Outside Hospital/.test(med) && /Sourced Trauma Centre/.test(med), "desktop: hospitals from the stored copy and the sourced list");
  ok(await p.evaluate(() => !!document.querySelector('#as-med [data-as-go="med"]')), "desktop: Open the Medical plan offered");
  const con = await p.textContent("#as-con");
  ok(/1669/.test(con) && /U\.S\. Embassy Bangkok/.test(con) && /International SOS/.test(con) && /1-888-407-4747/.test(con), "desktop: emergency numbers, embassy, State Department and ISOS");
  ok(await p.evaluate(() => [...document.querySelectorAll("#astudy .aitag")].filter((x) => /AI generated/.test(x.textContent)).every((x) => /Country (context|threat ratings)/.test(x.closest("h4") ? x.closest("h4").textContent : "")) &&
    [...document.querySelectorAll("#astudy .aitag")].filter((x) => /AI generated/.test(x.textContent)).length === 3), "desktop: only the country brief's text carries the AI generated tag");
  ok(await p.evaluate(() => [...document.querySelectorAll("#astudy a[href]")].every((a) => /^(https?:|tel:|#asd-)/.test(a.getAttribute("href")))), "desktop: every link is http(s), tel or an in-study citation");
  ok(/[0-9a-f]{64}/.test(await p.textContent("#as-fp")), "desktop: study fingerprint is a SHA-256");
  ok(/OSM data as of 2026-10-01/.test(await p.textContent("#as-src")) && /Test gap/.test(await p.textContent("#as-src")), "desktop: sources list with dates, and the brief's gaps");
  ok(/poly:"/.test(calls.lastQ) && !/out tags qt 300;.*bbox/.test(calls.lastQ), "desktop: the OpenStreetMap request is clipped to the drawn outline");
  const g = await p.textContent("#as-glance");
  ok(/km²/.test(g) && /Gently rolling|Flat|Hilly/.test(g) && /Testburi/.test(g) && /Level 1/.test(g) && /1 UCDP event/.test(g), "desktop: glance table filled from the parts");
  if (OUT) await p.screenshot({ path: OUT + "/areastudy-desktop.png", fullPage: false });
  // print view
  await p.click('#astudy [data-as="print"]');
  await p.waitForFunction(() => { const i = document.getElementById("asd-map"); return i && /^data:image\/png/.test(i.src); }, null, { timeout: 20000 }).catch(() => {});
  const pv = await p.evaluate(() => { const b = document.getElementById("brief"); return { open: !b.hidden && document.documentElement.classList.contains("briefing"), map: /^data:image\/png/.test((document.getElementById("asd-map") || {}).src || ""),
    parts: b.querySelectorAll(".asdoc h3").length, buttons: b.querySelectorAll(".asdoc button").length, pages: b.querySelectorAll(".asdoc .aspg").length }; });
  ok(pv.open && pv.map && pv.parts === 9 && pv.buttons === 0 && pv.pages >= 3, "desktop: print view shows every part with a map, no buttons, page breaks: " + JSON.stringify(pv));
  if (OUT) await p.screenshot({ path: OUT + "/areastudy-print.png", fullPage: false });
  await p.click("#asd-close"); await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.getElementById("brief").hidden && !document.getElementById("astudy").hidden), "desktop: Back returns to the study");
  // too large for a live look-up
  const before = calls.overpass;
  await p.evaluate(() => window.OSAP_AREASTUDY.close());
  await p.evaluate((P) => window.TSAP.areaApi.setArea(P), square([15, 101], 2)); await p.waitForTimeout(400);
  await p.evaluate(() => window.OSAP_AREASTUDY.open()); await p.waitForTimeout(1500);
  ok(calls.overpass === before && /too large for a live OpenStreetMap look-up/.test(await p.textContent("#as-pop")), "desktop: a very large area is not sent to Overpass, and says why");
  ok(errors.length === 0, "desktop: no page errors " + errors.join(" | "));
  await ctx.close();
}

// ---------- OpenStreetMap down, then Try again ----------
{
  const down = { overpassFails: true };
  const { ctx, p, errors, calls } = await open({ viewport: { width: 1200, height: 900 } }, down);
  await p.evaluate((P) => window.TSAP.areaApi.setArea(P), square(C0, 0.1)); await p.waitForTimeout(300);
  await p.evaluate(() => window.OSAP_AREASTUDY.open());
  await p.waitForFunction(() => /failed/.test((document.getElementById("as-pop") || {}).textContent || ""), null, { timeout: 30000 }).catch(() => {});
  const t = await p.textContent("#as-inf");
  ok(/failed/.test(t) && !/0 power plant/.test(t) && /WRI Test Plant/.test(t), "outage: a failed look-up says it failed (never zero) and reference data still shows");
  ok(/OpenStreetMap parts[^.]*not read/.test(await p.textContent("#as-src")), "outage: the gap is listed under Known gaps");
  down.up = true;
  await p.click('#as-pop [data-as-retry="osm"]');
  await p.waitForFunction(() => /Testburi/.test((document.getElementById("as-pop") || {}).textContent || ""), null, { timeout: 20000 }).catch(() => {});
  ok(/Testburi/.test(await p.textContent("#as-pop")), "outage: Try again fills the parts in");
  ok(errors.length === 0, "outage: no page errors " + errors.join(" | "));
  await ctx.close();
}

// ---------- phone ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await p.evaluate((P) => window.TSAP.areaApi.setArea(P), square(C0, 0.1)); await p.waitForTimeout(500);
  ok(/Area study/.test(await areaMenu(p)), "phone: Area menu lists Area study");
  await p.click('#atk-pop [data-pk="study"]');
  ok(await done(p), "phone: the study opens and finishes");
  ok(await p.evaluate(() => { const o = document.getElementById("astudy"), b = o.querySelector(".asbox"); return b.getBoundingClientRect().width <= innerWidth + 1 && o.scrollWidth <= o.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1; }), "phone: the study fits the screen width (wide tables scroll inside their own box)");
  if (OUT) await p.screenshot({ path: OUT + "/areastudy-phone.png", fullPage: false });
  await p.keyboard.press("Escape");
  ok(await p.evaluate(() => document.getElementById("astudy").hidden), "phone: Escape closes the study");
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}

await browser.close(); server.close();
console.log(fails ? fails + " check(s) failed" : "all area study checks passed");
process.exit(fails ? 1 : 0);
