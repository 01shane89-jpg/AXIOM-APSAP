// Headless check of the street-level bridge layer (assets/osap-bridges.js) behind Map overlays > Infrastructure > Bridges and tunnels:
// nothing is read live until the switch is on and the map is at zoom 13; then every bridge in view comes from OpenStreetMap through
// OSAP_OSM (Postpass, answered here by a fixture), drawn along its line in its limit colour with the bridge symbol; the popup is a
// crossing summary (carries, measured length, width, lanes, limits, structure, material, what it crosses) that says "not mapped"
// rather than guessing and never calls a weight limit an MLC; the stored OpenStreetMap bridge it covers steps aside; tags are
// escaped; a failed read is reported and the stored list still shows; switching off clears it. Unit checks of the tag readers too.
// Run from the repo root: node tests/bridges_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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

const F = "e".repeat(64);
const IX = { v: 1, at: "2026-10-31T10:00Z", sources: { osm: { name: "OpenStreetMap", ok: true } }, countries: { th: { br: 2, tn: 1 } } };
/* the stored list: one OpenStreetMap bridge inside the street view (steps aside there), one Wikidata bridge (stays) */
const BR = { v: 1, cc: "th", at: IX.at, layer: "bridge", lines: [], items: [
  { k: "br", t: "H", id: "osm:w101", nm: "Bridge on 9", la: 13.7501, lo: 100.5005, s: "osm", u: "https://www.openstreetmap.org/way/101", x: { len_m: 160 }, fp: F },
  { k: "br", t: "R", id: "wd:Q22", nm: "Rama VI Bridge", la: 13.752, lo: 100.503, s: "wdb", u: "https://www.wikidata.org/wiki/Q22", x: { len_m: 442 }, fp: F },
  { k: "tn", t: "P", id: "osm:w23", nm: "Tunnel on 3", la: 13.749, lo: 100.499, s: "osm", u: "https://www.openstreetmap.org/way/23", x: { len_m: 300 }, fp: F }] };
const line = (id, tags, a, b) => ({ type: "Feature", properties: { osm_type: "W", osm_id: id, tags }, geometry: { type: "LineString", coordinates: [a, b] } });
const GJ = { type: "FeatureCollection", features: [
  line(101, { highway: "motorway", bridge: "yes", ref: "9", name: "Kanchanaphisek <b>Rd</b>", lanes: "3", maxweight: "25", "bridge:structure": "beam", material: "concrete", width: "12", layer: "1", oneway: "yes" }, [100.4990, 13.7500], [100.5020, 13.7502]),
  line(102, { highway: "residential", bridge: "yes", maxweight: "5000 kg", maxheight: "14'0\"", maxwidth: "default" }, [100.5040, 13.7510], [100.5043, 13.7512]),
  line(103, { railway: "rail", bridge: "viaduct", gauge: "1000" }, [100.4980, 13.7490], [100.5010, 13.7485]),
  line(104, { highway: "footway", bridge: "yes" }, [100.5000, 13.7520], [100.5001, 13.7521])] };
const OVER = { type: "FeatureCollection", features: [{ type: "Feature", properties: { osm_type: "W", osm_id: 900, tags: { waterway: "river", name: "Chao Phraya" } }, geometry: { type: "Point", coordinates: [100.5, 13.75] } },
  { type: "Feature", properties: { osm_type: "W", osm_id: 901, tags: { highway: "primary", ref: "35" } }, geometry: { type: "Point", coordinates: [100.5, 13.75] } }] };

/* US federal inspection records (FHWA NBI via the USDOT NTAD ArcGIS service), three around Seattle */
const nbiF = (id, x, y, a) => ({ attributes: Object.assign({ OBJECTID: id, STATE_CODE_001: "53", STRUCTURE_NUMBER_008: "0000" + id, OWNER_022: "01", YEAR_BUILT_027: 1965, TRAFFIC_LANES_ON_028A: "2",
  ADT_029: 9815, YEAR_ADT_030: 2022, PERCENT_ADT_TRUCK_109: 8, DESIGN_LOAD_031: "5", DETOUR_KILOS_019: 3, OPEN_CLOSED_POSTED_041: "A", STRUCTURE_KIND_043A: "6", STRUCTURE_TYPE_043B: "06",
  MAIN_UNIT_SPANS_045: 2, APPR_SPANS_046: 5, MAX_SPAN_LEN_MT_048: 47.5, STRUCTURE_LEN_MT_049: 195.1, ROADWAY_WIDTH_MT_051: 7.5, DECK_WIDTH_MT_052: 8.4, VERT_CLR_OVER_MT_053: 99.99,
  VERT_CLR_UND_REF_054A: "H", VERT_CLR_UND_054B: 8.23, DECK_COND_058: "7", SUPERSTRUCTURE_COND_059: "7", SUBSTRUCTURE_COND_060: "7", CHANNEL_COND_061: "N", CULVERT_COND_062: "N",
  OPR_RATING_METH_063: "1", OPERATING_RATING_064: 89.8, INV_RATING_METH_065: "1", INVENTORY_RATING_066: 41.7, DATE_OF_INSPECT_090: "423", INSPECT_FREQ_MONTHS_091: 24,
  FRACTURE_092A: "N", STRAHNET_HIGHWAY_100: "1", SCOUR_CRITICAL_113: "N", BRIDGE_CONDITION: "G", LOWEST_RATING: 7 }, a), geometry: { x, y } });
const NBIJ = { features: [
  nbiF(11, -122.330, 47.600, { FACILITY_CARRIED_007: "I-90 E-S RAMP", FEATURES_DESC_006A: "I-5/AIRPORT WAY RAMP", LOCATION_009: "JCT I-5 &amp; MARTIN PE&#165;A" }),
  nbiF(12, -122.335, 47.602, { FACILITY_CARRIED_007: "OLIVE <img src=x onerror=alert(1)> WAY", FEATURES_DESC_006A: "DUWAMISH RIVER", SUBSTRUCTURE_COND_060: "4", CHANNEL_COND_061: "5",
    SCOUR_CRITICAL_113: "3", OPEN_CLOSED_POSTED_041: "P", BRIDGE_CONDITION: "P", LOWEST_RATING: 4, OPR_RATING_METH_063: "8", OPERATING_RATING_064: 1.12, FRACTURE_092A: "Y12" }),
  nbiF(13, -122.325, 47.598, { FACILITY_CARRIED_007: "SPOKANE ST", FEATURES_DESC_006A: "W WATERWAY", OPEN_CLOSED_POSTED_041: "K", BRIDGE_CONDITION: "F", DECK_COND_058: "5" })] };

async function open(mode = "ok", nbiMode = "ok") {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1360, height: 860 } });
  const errors = [], pp = [], nb = [];
  await ctx.route(/\/data\/infra\//, (r) => {
    const u = new URL(r.request().url()).pathname;
    if (/index\.json$/.test(u)) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(IX) });
    if (/\/th\/bridge\.json$/.test(u)) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(BR) });
    return r.fulfill({ status: 404, body: "" });
  });
  await ctx.route(/postpass\.geofabrik\.de/, (r) => {
    const sql = decodeURIComponent((r.request().postData() || "").replace(/^data=/, "").replace(/\+/g, " ")); pp.push(sql);
    if (mode === "fail") return r.fulfill({ status: 504, body: "x" });
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(/ST_Crosses/.test(sql) ? OVER : GJ) });
  });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)(?!postpass)/, (r) => r.abort());
  await ctx.route(/services\.arcgis\.com\/xOi1kZaI0eWDREZv\/arcgis\/rest\/services\/NTAD_National_Bridge_Inventory/, (r) => {
    nb.push(decodeURIComponent(r.request().url()));
    if (nbiMode === "fail") return r.fulfill({ status: 500, body: "x" });
    return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(NBIJ) });
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_INFRA && window.OSAP_INFRA.state().mounted, null, { timeout: 60000 }); await p.waitForTimeout(1500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(400);
  return { ctx, p, errors, pp, nb };
}
const view = (p, c, z) => p.evaluate(([c, z]) => window.__asapMap.setView(c, z, { animate: false }), [c, z]).then(() => p.waitForTimeout(900));
const bst = (p) => p.evaluate(() => window.OSAP_BRIDGES ? window.OSAP_BRIDGES.state() : null);
const popWith = async (p, re) => {
  await p.evaluate((re) => { const R = new RegExp(re); let done = false; window.__asapMap.eachLayer((l) => { if (done || !l.getPopup || !l.getPopup()) return; let c = l.getPopup().getContent(); if (typeof c === "function") c = c(l); if (R.test(c)) { l.openPopup(l.getLatLng ? l.getLatLng() : l.getCenter()); done = true; } }); }, re);
  await p.waitForTimeout(800);
  return p.evaluate(() => { const x = document.querySelector(".leaflet-popup-content") || document.querySelector("#rv-pkg:not([hidden]) .pkgpop"); return x ? x.innerHTML : ""; });
};
const turnOn = async (p) => {
  await p.evaluate(() => window.OSAP_ATAK.overlays("overlays")); await p.waitForTimeout(300);
  await p.check('#inf-sec input[data-inf="bridge"]');
  await p.waitForFunction(() => !!window.OSAP_BRIDGES, null, { timeout: 10000 });
  await p.evaluate(() => { const b = document.querySelector('#atk-om [data-om="x"]'); if (b) b.click(); }); await p.waitForTimeout(300);
};

// ---------- tag readers ----------
{
  const { ctx, p, errors, pp, nb } = await open();
  ok(await p.evaluate(() => !window.OSAP_BRIDGES && !document.getElementById("osap-bridges-js")), "start: the bridge file is not loaded before the switch is on");
  await view(p, [13.75, 100.5], 9);
  await turnOn(p);
  const t = await p.evaluate(() => { const T = window.OSAP_BRIDGES._t; return {
    a: T.tonnes("25"), b: T.tonnes("5000 kg"), c: T.tonnes("10 st"), d: T.tonnes("none"), e: T.metres("4.2 m"), f: T.metres("14'6\""), g: T.metres("default"),
    len: Math.round(T.lineLen([{ lat: 0, lon: 0 }, { lat: 0, lon: 0.01 }])), r1: T.read({ highway: "primary", maxweight: "12" }, 50).cls, r2: T.read({ highway: "primary", maxweight: "40" }, 50).cls,
    r3: T.read({ highway: "primary" }, 50).cls, r4: T.read({ highway: "footway" }, 5).cls, r5: T.read({ highway: "primary", maxheight: "3.8" }, 50).cls }; });
  ok(t.a === 25 && t.b === 5 && Math.abs(t.c - 9.07) < 0.01 && t.d === null, "weights read in tonnes (t, kg, short tons), 'none' is not a number " + JSON.stringify(t));
  ok(t.e === 4.2 && Math.abs(t.f - 4.42) < 0.01 && t.g === null, "heights read in metres (m, feet and inches)");
  ok(Math.abs(t.len - 1113) <= 2, "length measured along the line (" + t.len + " m for 0.01 degree at the equator)");
  ok(t.r1 === "tight" && t.r2 === "lim" && t.r3 === "none" && t.r4 === "foot" && t.r5 === "tight", "limit classes from tagged values only");
  const u = await p.evaluate(() => { const T = window.OSAP_BRIDGES._t; return {
    d1: T.inspDate("423"), d2: T.inspDate("1299"), d3: T.inspDate("1323"), d4: T.inspDate(""),
    c1: T.nbiRead({ BRIDGE_CONDITION: "G", OPEN_CLOSED_POSTED_041: "A" }).cls, c2: T.nbiRead({ BRIDGE_CONDITION: "G", SCOUR_CRITICAL_113: "3" }).cls,
    c3: T.nbiRead({ BRIDGE_CONDITION: "G", OPEN_CLOSED_POSTED_041: "P" }).cls, c4: T.nbiRead({ DECK_COND_058: "4", SUPERSTRUCTURE_COND_059: "8" }).overall,
    c5: T.nbiRead({ DECK_COND_058: "N" }).cls, c6: T.nbiRead({ OPEN_CLOSED_POSTED_041: "K", BRIDGE_CONDITION: "G" }).cls,
    r1: T.rating(89.8, "1"), r2: T.rating(1.12, "8"), r3: T.rating(0, "5"), r4: T.rating(null, "1"),
    us1: T.inUS(L.latLngBounds([47.59, -122.34], [47.61, -122.32])), us2: T.inUS(L.latLngBounds([13.7, 100.4], [13.8, 100.6])), us3: T.inUS(L.latLngBounds([18.4, -66.1], [18.5, -66.0])) }; });
  ok(u.d1 === "Apr 2023" && u.d2 === "Dec 1999" && u.d3 === "" && u.d4 === "", "inspection dates read from month and two-digit year " + JSON.stringify([u.d1, u.d2, u.d3, u.d4]));
  ok(u.c1 === "good" && u.c2 === "bad" && u.c3 === "fair" && u.c4 === "Poor" && u.c5 === "unk" && u.c6 === "bad", "US condition classes from the coded values only " + JSON.stringify(u));
  ok(/^89\.8 t gross \(load factor\)$/.test(u.r1) && /as coded/.test(u.r2) && /not converted/.test(u.r2) && /^0 t gross \(no rating analysis performed\)$/.test(u.r3) && u.r4 === null, "load ratings: tonnes only for tonne methods, rating factors left as coded");
  ok(u.us1 && !u.us2 && u.us3, "US and territories found by view (Seattle yes, Bangkok no, San Juan yes)");
  // ---------- below street level: no live read ----------
  let s = await bst(p);
  ok(pp.length === 0 && /Zoom in to street level/.test(s.msg), "zoom 9: nothing read live, a zoom hint shows: " + s.msg);
  ok(await p.evaluate(() => { const m = document.querySelector("#inf-sec .br-msg"); return !!m && !m.hidden && /street level/.test(m.textContent); }), "the hint sits under the Bridges and tunnels switch");
  // ---------- street level ----------
  await view(p, [13.7505, 100.501], 13);
  await p.waitForFunction(() => window.OSAP_BRIDGES.state().n > 0 && !window.OSAP_BRIDGES.state().busy, null, { timeout: 10000 }); await p.waitForTimeout(400);
  s = await bst(p);
  ok(nb.length === 0, "outside the US the federal inventory is not asked");
  ok(pp.length === 1 && /postpass_line/.test(pp[0]) && /tags \? 'bridge'/.test(pp[0]) && /'footway'/.test(pp[0]), "one Postpass read for the view, footbridges left out at zoom 13");
  ok(s.n === 4 && /3 bridges in view/.test(s.msg) && /Footbridges show closer in \(zoom 14/.test(s.msg) && /Tap one/.test(s.msg), "count leaves the footbridge out below zoom 14: " + s.msg);
  ok(s.drawn.lines === 6 && s.drawn.points === 3, "each bridge drawn along its line (casing and colour) with a symbol: " + JSON.stringify(s.drawn));
  ok(await p.evaluate(() => { let sym = 0; window.__asapMap.eachLayer((l) => { if (l.options && /^br:/.test(l.options.lgk || "") && l.options.sym === "i_bridge") sym++; }); return sym === 3; }), "bridge markers are the 2525D bridge symbol");
  const infra = await p.evaluate(() => window.OSAP_INFRA.state());
  ok(await p.evaluate(() => { let osm = 0, wd = 0; window.__asapMap.eachLayer((l) => { const c = l.getPopup && l.getPopup() && l.getPopup().getContent(); if (typeof c !== "string") return; if (/Bridge on 9/.test(c)) osm++; if (/Rama VI/.test(c)) wd++; }); return osm === 0 && wd === 1; }),
    "the stored OpenStreetMap bridge steps aside where the live view covers it; the Wikidata one stays " + JSON.stringify(infra.shown));
  ok(await p.evaluate(() => /Bridges in view/.test(document.querySelector(".leaflet-control-container").innerHTML) && /Restrictive for heavy vehicles/.test(document.querySelector(".leaflet-control-container").innerHTML)), "legend explains the colours");
  let pop = await popWith(p, "Kanchanaphisek");
  ok(/Crossing summary/.test(pop) && /Motorway/.test(pop) && /one way/.test(pop) && /\d+ m \(measured along the mapped line\)/.test(pop), "popup: carries and measured length");
  ok(/Width<\/dt><dd>12 m/.test(pop) && /Lanes<\/dt><dd>3/.test(pop) && /Weight limit<\/dt><dd>25 t/.test(pop) && /Beam/.test(pop) && /concrete/.test(pop), "popup: width, lanes, weight limit, structure, material");
  ok(/Height limit<\/dt><dd><span class="br-nt">none posted in the map/.test(pop) && /Axle load limit<\/dt><dd><span class="br-nt">/.test(pop), "popup: missing limits say so instead of guessing");
  ok(/not an MLC/.test(pop) && /reconnaissance/.test(pop) && /ODbL/.test(pop) && /openstreetmap\.org\/way\/101/.test(pop) && /Postpass|postpass/.test(pop), "popup: MLC caution, source link and licence");
  ok(!/<b>Rd<\/b>/.test(pop), "popup: tags are escaped");
  await p.waitForTimeout(600);
  pop = await p.evaluate(() => (document.querySelector(".leaflet-popup-content") || document.querySelector("#rv-pkg .pkgpop")).innerHTML);
  ok(/Crosses<\/dt><dd data-brover="\d+">Chao Phraya, 35/.test(pop) && pp.some((q) => /ST_Crosses/.test(q)), "popup: what it crosses, asked when it opens (" + (/data-brover="\d+">([^<]*)/.exec(pop) || [])[1] + ")");
  ok(/Fingerprint <code class="fp">[0-9a-f]{16}/.test(pop), "popup: SHA-256 fingerprint of the record as read");
  pop = await popWith(p, "5000 kg");
  ok(/Restrictive for heavy vehicles/.test(pop) && /Weight limit<\/dt><dd>5 t \(mapped as/.test(pop) && /Height limit<\/dt><dd>4\.27 m \(mapped as/.test(pop) && /Width limit<\/dt><dd>the country's normal road limit/.test(pop), "popup: kg and feet limits converted with the mapped text kept");
  if (OUT) await p.screenshot({ path: OUT + "/bridges-desktop.png" });
  // ---------- footbridges from zoom 14 (an imagery base map zooms that close) ----------
  await p.evaluate(() => { const x = document.querySelector("#rv-pkg .pkghead .x"); if (x) x.click(); window.__asapMap.closePopup(); window.__asapMap.setMaxZoom(20); }); await p.waitForTimeout(800);
  await view(p, [13.7505, 100.501], 14);
  await p.waitForFunction(() => !window.OSAP_BRIDGES.state().busy, null, { timeout: 10000 }); await p.waitForTimeout(500);
  s = await bst(p);
  ok(pp.filter((q) => !/ST_Crosses/.test(q)).length === 2 && !/'footway'/.test(pp.filter((q) => !/ST_Crosses/.test(q))[1]) && /4 bridges in view/.test(s.msg), "zoom 14: read again with footbridges: " + s.msg);
  // ---------- panning inside what was read: no new read ----------
  const before = pp.length;
  await view(p, [13.7506, 100.5012], 14);
  ok(pp.length === before, "a small pan inside the area already read asks nothing new");
  // ---------- off ----------
  await p.evaluate(() => window.OSAP_ATAK.overlays("overlays")); await p.waitForTimeout(300);
  await p.uncheck('#inf-sec input[data-inf="bridge"]'); await p.waitForTimeout(400);
  s = await bst(p);
  ok(!s.on && s.drawn.lines === 0 && s.drawn.points === 0 && !s.msg && !/Bridges in view/.test(await p.evaluate(() => document.querySelector(".leaflet-control-container").innerHTML)), "switch off: lines, symbols, note and legend cleared");
  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- United States: federal inspection records join ----------
{
  const { ctx, p, errors, nb } = await open();
  await view(p, [47.600, -122.330], 9);
  await turnOn(p);
  ok(nb.length === 0, "US, zoom 9: the inventory is not asked below street level");
  await view(p, [47.600, -122.330], 13);
  await p.waitForFunction(() => window.OSAP_BRIDGES.state().us.n > 0 && !window.OSAP_BRIDGES.state().us.busy && !window.OSAP_BRIDGES.state().busy, null, { timeout: 15000 }); await p.waitForTimeout(500);
  const s = await bst(p);
  ok(nb.length === 1 && /RECORD_TYPE_005A='1'/.test(nb[0]) && /esriGeometryEnvelope/.test(nb[0]) && /OPERATING_RATING_064/.test(nb[0]) && /SCOUR_CRITICAL_113/.test(nb[0]) && /STRUCTURE_LEN_MT_049 DESC/.test(nb[0]), "one keyless read of the federal inventory for the view");
  ok(s.us.n === 3 && s.drawn.us === 3 && s.us.src.nc === false && /Public domain/.test(s.us.src.lic), "three US records drawn, tagged public domain (kept in the paid version) " + JSON.stringify(s.drawn));
  ok(/3 US inspection records \(FHWA National Bridge Inventory\)/.test(s.msg), "the note under the switch counts them: " + s.msg);
  ok(await p.evaluate(() => { let n = 0; window.__asapMap.eachLayer((l) => { if (l.options && /^nbi:/.test(l.options.lgk || "") && l.options.sym === "i_bridge" && l.options.badge) n++; }); return n === 3; }), "each record is the 2525D bridge symbol with a condition badge");
  ok(await p.evaluate(() => /US inspection records/.test(document.querySelector(".leaflet-control-container").innerHTML) && /Poor, closed or scour critical/.test(document.querySelector(".leaflet-control-container").innerHTML)), "legend explains the badges");
  let pop = await popWith(p, "I-90 E-S RAMP");
  ok(/US federal inspection record/.test(pop) && /I-90 E-S RAMP over I-5\/AIRPORT WAY RAMP/.test(pop) && /Overall \(FHWA\)<\/dt><dd>Good, lowest rating 7 \(Good\)/.test(pop), "US popup: title and FHWA overall condition");
  ok(/JCT I-5 &amp; MARTIN PE¥A</.test(pop), "US popup: entities in the record text decoded once, then escaped");
  ok(/Deck<\/dt><dd>7 \(Good\)/.test(pop) && /Last inspected<\/dt><dd>Apr 2023 \(every 24 months\)/.test(pop) && /Status<\/dt><dd>Open, no restriction/.test(pop) && /Scour<\/dt><dd>Not over water/.test(pop), "US popup: component ratings, inspection date, status, scour");
  ok(/Operating rating<\/dt><dd>89\.8 t gross/.test(pop) && /Inventory rating<\/dt><dd>41\.7 t gross/.test(pop) && /Designed for<\/dt><dd>HS 20 loading/.test(pop) && /not a military load class/.test(pop), "US popup: load ratings in tonnes, design load, MLC caution");
  ok(/Built<\/dt><dd>1965/.test(pop) && /Prestressed concrete, continuous box beam/.test(pop) && /Clearance over the deck<\/dt><dd>nothing overhead/.test(pop) && /Clearance underneath<\/dt><dd>8\.23 m \(over a road\)/.test(pop) && /9,815 vehicles \(2022 count\), 8% trucks/.test(pop) && /STRAHNET/.test(pop), "US popup: structure, clearances, traffic, defense highway");
  ok(/OBJECTID%3D11/.test(pop) && /Public domain/.test(pop) && /not a verified current condition/.test(pop) && /MGRS|47\.60000/.test(pop), "US popup: source record link, licence, claim wording, position");
  await p.waitForTimeout(500);
  pop = await p.evaluate(() => (document.querySelector(".leaflet-popup-content") || document.querySelector("#rv-pkg .pkgpop")).innerHTML);
  ok(/data-nbifp="\d+"><br>Fingerprint <code class="fp">[0-9a-f]{16}/.test(pop), "US popup: SHA-256 fingerprint of the record as read");
  /* a tall popup pans the map (the Details panel narrows it): back to the same view before the next one */
  const back = async () => { await p.evaluate(() => { const x = document.querySelector("#rv-pkg .pkghead .x"); if (x) x.click(); window.__asapMap.closePopup(); }); await p.waitForTimeout(300);
    await view(p, [47.600, -122.330], 13); await p.waitForFunction(() => !window.OSAP_BRIDGES.state().us.busy && window.OSAP_BRIDGES.state().drawn.us === 3, null, { timeout: 15000 }); };
  await back();
  pop = await popWith(p, "DUWAMISH");
  ok(/Poor, closed or scour critical/.test(pop) && /SCOUR CRITICAL/.test(pop) && /Posted for load/.test(pop) && /Fracture critical/.test(pop) && /1\.12 as coded/.test(pop) && /Channel and banks<\/dt><dd>5 \(Fair\)/.test(pop), "US popup: poor, scour critical, posted, fracture critical, rating factor left as coded");
  ok(!/<img/.test(pop) && /&lt;img/.test(pop), "US popup: record text is escaped");
  await back();
  pop = await popWith(p, "SPOKANE ST");
  ok(/Status<\/dt><dd>Closed/.test(pop) && /Poor, closed or scour critical/.test(pop), "US popup: a closed bridge is badged red whatever its rating");
  if (OUT) await p.screenshot({ path: OUT + "/bridges-us.png" });
  await back();
  const nb0 = nb.length;
  await view(p, [47.6005, -122.3305], 13);
  ok(nb.length === nb0, "a small pan inside the area already read asks the inventory nothing new");
  await p.evaluate(() => window.OSAP_ATAK.overlays("overlays")); await p.waitForTimeout(300);
  await p.uncheck('#inf-sec input[data-inf="bridge"]'); await p.waitForTimeout(400);
  ok((await bst(p)).drawn.us === 0, "switch off clears the US records");
  ok(errors.length === 0, "US: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- the US inventory fails: tried three times, reported, the OpenStreetMap bridges still show ----------
{
  const { ctx, p, errors, nb } = await open("ok", "fail");
  await view(p, [47.600, -122.330], 13);
  await turnOn(p);
  await p.waitForFunction(() => window.OSAP_BRIDGES && window.OSAP_BRIDGES.state().us.err, null, { timeout: 30000 });
  const s = await bst(p);
  ok(nb.length === 3, "the federal inventory is tried three times before giving up (" + nb.length + ")");
  ok(/US inspection records could not be read just now/.test(s.msg) && s.n === 4 && s.drawn.us === 0, "US failure reported in plain words; OpenStreetMap bridges still read: " + s.msg);
  ok(errors.length === 0, "US failure: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- the live read fails ----------
{
  const { ctx, p, errors } = await open("fail");
  await view(p, [13.7505, 100.501], 14);
  await turnOn(p);
  await p.waitForFunction(() => window.OSAP_BRIDGES && window.OSAP_BRIDGES.state().err, null, { timeout: 60000 });
  const s = await bst(p), infra = await p.evaluate(() => window.OSAP_INFRA.state());
  ok(/could not be read just now/.test(s.err) && /major bridges list still shows/.test(s.err), "failure reported in plain words: " + s.err);
  ok((infra.shown.bridge || 0) >= 2, "the stored bridges still draw when the live read fails " + JSON.stringify(infra.shown));
  ok(errors.length === 0, "failure: no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
