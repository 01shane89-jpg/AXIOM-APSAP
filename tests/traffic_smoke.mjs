// Headless check of the live traffic layers (assets/osap-traffic.js): "All air traffic" sits in Map overlays > Live aircraft and
// "Ships (AIS)" in its own Ships section; nothing is fetched while off; aircraft come from the live-air cell files (fixture),
// only the cells on screen; ships come from Open Waters AIS (fixture) in boxes of at most 10° x 10°, with a zoom-in note beyond
// that; both pop-ups give the data, age and source; feed text is escaped; small private craft show no name; a failing feed is
// reported, not hidden.
// Run from the repo root: node tests/traffic_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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
const shown = (p, s) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && getComputedStyle(e).display !== "none" && e.getClientRects().length > 0; }, s);

const now = Math.round(Date.now() / 1000), built = new Date().toISOString();
const F = ["hex", "cs", "reg", "t", "desc", "lat", "lon", "alt", "gs", "trk", "pos", "src", "sqk", "cat", "fl"];
const AC = [
  ["880844", "AIQ3074", "HS-BBD", "A320", "AIRBUS A-320", 13.9, 100.6, 38000, 450, 145, now - 60, 0, "7247", "A3", 0],
  ["ae1234", "RCH123", "05-5140", "C17", "BOEING C-17", 13.5, 100.9, 28000, 420, 300, now - 90, 1, "1234", "A5", 1],
  ["880999", "THA1", "HS-TKA", "B77W", null, 13.8, 100.4, 9000, 250, 10, now - 30, 0, "7700", "A5", 0],
  ["881000", null, "HS-XYZ", "A321", null, 13.69, 100.75, null, 0, null, now - 30, 0, null, "A3", 4],
  ["88bad0", "<img src=x onerror=window.__xss=1>", null, null, null, 13.6, 100.3, 12000, 300, 90, now - 20, 1, null, null, 0],
  ["3c6444", "DLH9", null, null, null, 13.95, 100.85, 35000, 470, 270, now - 400, 2, null, null, 0],
  ["880old", "OLD1", null, null, null, 13.7, 100.5, 30000, 400, 90, now - 3600, 0, null, null, 0]];
const INDEX = { schema: "osap-air-traffic/1", built, sweep: 7, took_s: 290, cell: 10, f: F,
  sources: [{ id: "fi", name: "adsb.fi", site: "https://adsb.fi/", licence: "adsb.fi open data terms", nc: true, track: "https://globe.adsb.fi/?icao={hex}" },
    { id: "lol", name: "adsb.lol", site: "https://adsb.lol/", licence: "ODbL 1.0", nc: false, track: "https://globe.adsb.lol/?icao={hex}" },
    { id: "osky", name: "OpenSky Network", site: "https://opensky-network.org/", licence: "OpenSky Network terms (non-commercial and research use)", nc: true, track: "https://map.opensky-network.org/?icao={hex}" }],
  status: [], asked: 400, unasked: 0, total: 9123, cells: { "10_100": AC.length, "50_0": 3 }, circ: [] };
const ship = (mmsi, lat, lon, type, name, extra) => ({ type: "Feature", id: mmsi, geometry: { type: "Point", coordinates: [lon, lat] },
  properties: Object.assign({ mmsi, name, type, kind: "vessel", sog: 12.1, cog: 80, heading: 82, flag: "SG", seen: new Date(Date.now() - 120e3).toISOString(), source: "aishub", station: "aishub", length: 200, beam: 32 }, extra || {}) });
const SHIPS = { type: "FeatureCollection", attribution: { aishub: "Open Waters AIS (https://openwaters.io/ais/). AISHub (https://www.aishub.net)" }, features: [
  ship(563000001, 13.4, 100.55, 70, "CARGO ONE"), ship(563000002, 13.3, 100.6, 80, "TANKER TWO", { destination: "SG SIN", eta: "10-03 08:00" }),
  ship(563000003, 13.45, 100.7, 35, "WARSHIP"), ship(563000004, 13.35, 100.65, 37, "JOHN SMITH", { callsign: "PRIV1", sog: 0 }),
  ship(563000005, 13.38, 100.58, 60, "<b>FERRY</b>"), ship(1, 13.4, 100.6, 0, "BUOY", { kind: "aton" })] };

async function open(opts, mode = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [], air = [], sea = [], live = [];
  // live positions for the area on screen (netlify/edge-functions/osap-air.js); without mode.live the local server answers 404,
  // as GitHub Pages would, and the page keeps to the sweep
  if (mode.live) await ctx.route(/\/api\/air\?/, (r) => {
    live.push(r.request().url());
    if (mode.live === "down") return r.fulfill({ status: 502, contentType: "application/json", body: '{"error":"adsb.fi busy; adsb.lol HTTP 503"}' });
    const t = Math.round(Date.now() / 1000);
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schema: "osap-air-live/1", built: new Date().toISOString(), lat: 13.75, lon: 100.5, nm: 90,
      src: { id: "lol", name: "adsb.lol", site: "https://adsb.lol/", licence: "ODbL 1.0", nc: false, track: "https://globe.adsb.lol/?icao={hex}" }, f: F,
      ac: [["880844", "AIQ3074", "HS-BBD", "A320", "AIRBUS A-320", 13.95, 100.65, 37000, 452, 146, t - 2, 0, "7247", "A3", 0],
        ["8a0001", "LIVE1", null, "AT76", null, 13.6, 100.7, 8000, 220, 30, t - 1, 0, null, "A2", 0]] }) });
  });
  await ctx.route(/raw\.githubusercontent\.com\/.*\/live-air\//, (r) => {
    const u = r.request().url(); air.push(u);
    if (mode.air === "down") return r.fulfill({ status: 404, body: "404: Not Found" });
    if (/index\.json$/.test(u)) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mode.air === "stale" ? { ...INDEX, built: new Date(Date.now() - 340 * 60e3).toISOString() } : INDEX) });
    if (/a\/10_100\.json$/.test(u)) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schema: "osap-air-cell/1", built, cell: "10_100", ac: AC }) });
    // each aircraft's current flight kept by the sweep (tools/air_tracks.mjs), by the first two hex digits (mode.track)
    if (/t\/88\.json$/.test(u) && mode.track === "ok") {
      const t = Math.round(Date.now() / 1000);
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schema: "osap-air-tracks/2", built, keep_s: 72000, f: ["t", "lat", "lon", "alt", "gnd"], df: ["ident", "name", "nm", "t"],
        tr: { "880844": [[t - 3600, 13.682, 100.748, null, 1], [t - 3000, 13.75, 100.72, 12000, 0], [t - 2400, 13.8, 100.68, 30000, 0], [t - 120, 13.89, 100.61, 38000, 0]],
          "880999": [[t - 900, 13.5, 100.5, 30000, 0], [t - 600, 13.6, 100.45, 30000, 0]] },
        dep: { "880844": ["VTBS", "Suvarnabhumi <b>Airport</b>", 0.1, t - 3600] } }) });
    }
    return r.fulfill({ status: 404, body: "" });
  });
  await ctx.route(/ais\.openwaters\.io/, (r) => {
    const u = r.request().url();
    if (/\/vessels\/\d+\/track/.test(u)) {
      (mode.tracks || (mode.tracks = [])).push(u);
      const h = (n) => new Date(Date.now() - n * 3600e3).toISOString().slice(0, 19) + "Z";
      return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ type: "Feature", id: 563000002,
        attribution: { aishub: "Open Waters AIS (https://openwaters.io/ais/). AISHub (https://www.aishub.net)" },
        geometry: { type: "LineString", coordinates: [[100.2, 13.0], [100.3, 13.1], [100.4, 13.2], [100.55, 13.28], [100.6, 13.3]] },
        properties: { mmsi: 563000002, breaks: [3], times: [h(20), h(18), h(16), h(2), h(0.05)], simplified: true, points: 5 } }) });
    }
    sea.push(u);
    if (mode.sea === "busy") return r.fulfill({ status: 429, body: "too many requests" });
    return r.fulfill({ status: 200, contentType: "application/geo+json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(SHIPS) });
  });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)(?!raw\.githubusercontent\.com\/.*\/live-air\/)(?!ais\.openwaters\.io)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_TRAFFIC && document.getElementById("ml-sea"), null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(400);
  return { ctx, p, errors, air, sea, live };
}
const count = (p) => p.evaluate(() => { const L = window.OSAP_TRAFFIC.layers(); return { air: L.air.getLayers().length, sea: L.sea.getLayers().length, A: window.OSAP_TRAFFIC.air().shown, V: window.OSAP_TRAFFIC.sea().shown }; });
const om = (p) => p.evaluate(() => window.OSAP_ATAK.overlays("overlays"));
const popOf = (p, grp, i) => p.evaluate(([g, i]) => {
  const m = window.OSAP_TRAFFIC.layers()[g].getLayers()[i]; m.openPopup(); return new Promise((r) => setTimeout(() => {
    const x = document.querySelector(".leaflet-popup-content") || document.querySelector("#rv-pkg"); r(x ? x.innerHTML : ""); }, 600)); }, [grp, i]);
const popWhere = (p, grp, test) => p.evaluate(([g, t]) => {
  const ms = window.OSAP_TRAFFIC.layers()[g].getLayers(), re = new RegExp(t);
  for (const m of ms) { const c = typeof m.getPopup().getContent() === "function" ? m.getPopup().getContent()(m) : m.getPopup().getContent(); if (re.test(c)) return c; }
  return ""; }, [grp, test]);

// ---------- desktop ----------
{
  const { ctx, p, errors, air, sea } = await open({ viewport: { width: 1360, height: 860 } });
  await om(p); await p.waitForTimeout(400);
  ok(await shown(p, '#atk-om #ml-air input[data-trf="air"]'), "desktop: All air traffic switch in Overlays > Live aircraft");
  ok(await shown(p, '#atk-om #ml-sea input[data-trf="sea"]'), "desktop: Ships (AIS) switch in its own Ships section");
  ok(await p.evaluate(() => document.getElementById("ml-air").nextElementSibling.id === "ml-sea"), "desktop: Ships sits right after Live aircraft");
  ok(air.length === 0 && sea.length === 0, "desktop: nothing fetched while off (" + air.length + "/" + sea.length + ")");
  await p.evaluate(() => window.__asapMap.setView([13.7, 100.6], 9, { animate: false }));
  await p.check('#ml-air input[data-trf="air"]'); await p.waitForTimeout(1500);
  let c = await count(p);
  ok(air.some((u) => /index\.json$/.test(u)) && air.some((u) => /a\/10_100\.json$/.test(u)) && !air.some((u) => /50_0/.test(u)), "desktop: reads the index and only the cell on screen " + air.map((u) => u.replace(/.*live-air\//, "")).join(","));
  ok(c.air === 5, "desktop: five aircraft drawn (ground and hour-old ones left out): " + c.air);
  const st = await p.evaluate(() => document.getElementById("tra-st").textContent);
  ok(/9,123 aircraft worldwide/.test(st) && /5 on screen in the air/.test(st), "desktop: status line: " + st);
  ok(await p.evaluate(() => /Air traffic \(ADS-B\)/.test(document.body.innerHTML)), "desktop: air traffic legend on the map");
  const age = await p.evaluate(() => (document.querySelector(".tra-age") || {}).textContent || "");
  ok(/^data (under a minute|\d+ min) old \(swept /.test(age) && !/Stale/.test(age), "desktop: legend on the map gives the data age: " + age);
  await p.check('#ml-air input[data-trf="ground"]'); await p.waitForTimeout(400);
  ok((await count(p)).air === 6, "desktop: Include aircraft on the ground adds the one on the ground");
  let pop = await popWhere(p, "air", "AIQ3074");
  ok(/AIRBUS A-320/.test(pop) && /HS-BBD/.test(pop) && /38,000 ft/.test(pop) && /MGRS/.test(pop) && /globe\.adsb\.fi\/\?icao=880844/.test(pop) && /non-commercial/.test(pop) && /min ago|under a minute/.test(pop),
    "desktop: aircraft pop-up has type, registration, altitude, MGRS, age and a link to its source");
  pop = await popWhere(p, "air", "RCH123");
  ok(/Military aircraft/.test(pop) && /adsb\.lol/.test(pop) && /ODbL/.test(pop), "desktop: military flag and adsb.lol credit");
  pop = await popWhere(p, "air", "DLH9");
  ok(/OpenSky Network live track/.test(pop) && /map\.opensky-network\.org\/\?icao=3c6444/.test(pop) && /7 min ago/.test(pop), "desktop: OpenSky aircraft credited, with its own age");
  pop = await popWhere(p, "air", "THA1");
  ok(/Squawking 7700 \(emergency\)/.test(pop) && /Not confirmed/.test(pop), "desktop: emergency squawk shown as broadcast, not confirmed");
  pop = await popWhere(p, "air", "88BAD0");
  ok(/&lt;img/.test(pop) && !/<img/.test(pop), "desktop: call sign text is escaped");
  // ships
  await p.evaluate(() => window.__asapMap.setView([13.4, 100.6], 10, { animate: false }));
  await p.check('#ml-sea input[data-trf="sea"]'); await p.waitForTimeout(1500);
  c = await count(p);
  ok(sea.length >= 1 && sea.every((u) => { const q = new URL(u).searchParams.get("bbox").split(",").map(Number); return (q[2] - q[0]) * (q[3] - q[1]) <= 100.01 && q[0] < q[2] && q[1] < q[3]; }), "desktop: asks Open Waters for boxes of at most 100 square degrees " + sea.length);
  ok(c.sea === 5, "desktop: five ships drawn, the buoy left out: " + c.sea);
  pop = await popWhere(p, "sea", "TANKER TWO");
  ok(/MMSI 563000002/.test(pop) && /Singapore/.test(pop) && /SG SIN/.test(pop) && /openwaters\.io\/ais\/vessels\/563000002/.test(pop) && /AISHub/.test(pop) && /MGRS/.test(pop), "desktop: ship pop-up: MMSI, flag, destination, position, source link and credit");
  pop = await popWhere(p, "sea", "563000004");
  ok(/Sailing or pleasure craft/.test(pop) && !/JOHN SMITH/.test(pop) && !/PRIV1/.test(pop), "desktop: small private craft show no name or call sign");
  pop = await popWhere(p, "sea", "563000005");
  ok(/&lt;b&gt;FERRY/.test(pop), "desktop: ship name text is escaped");
  await p.uncheck('#ml-sea input[data-trk="tanker"]'); await p.waitForTimeout(300);
  ok((await count(p)).sea === 4, "desktop: unticking Tankers hides the tanker");
  ok(await p.evaluate(() => /Ships \(AIS\)/.test(document.body.innerHTML) && !/>Tankers</.test(document.querySelector(".leaflet-control-container").innerHTML)), "desktop: ship legend lists the shown kinds");
  // the real pop-up opens on click and gets a fingerprint
  pop = await popOf(p, "sea", 0);
  ok(/Record fingerprint [0-9a-f]{16}/.test(pop) || /Fingerprint/.test(pop), "desktop: opened pop-up carries a record fingerprint");
  if (OUT) { await p.evaluate(() => window.__asapMap.closePopup()); await p.screenshot({ path: OUT + "/traffic-desktop.png" }); }
  // zoomed out: no ship request, a zoom-in note; aircraft too
  const before = sea.length;
  await p.evaluate(() => window.__asapMap.setView([10, 100], 3, { animate: false })); await p.waitForTimeout(1500);
  c = await count(p);
  { const t = await p.evaluate(() => document.getElementById("trs-st").textContent); ok(sea.length === before && c.sea === 0 && /Zoom in to see ships/.test(t), "desktop: zoomed out, no ship request and a zoom-in note (" + (sea.length - before) + " requests, " + c.sea + " ships) " + t); }
  ok(c.air === 0 && /Zoom in to see them/.test(await p.evaluate(() => document.getElementById("tra-st").textContent)), "desktop: zoomed out to the world, aircraft ask to zoom in");
  await p.uncheck('#ml-air input[data-trf="air"]'); await p.uncheck('#ml-sea input[data-trf="sea"]'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => !/Air traffic \(ADS-B\)|Ships \(AIS\)/.test(document.querySelector(".leaflet-control-container").innerHTML)), "desktop: switching off clears both legends");
  ok(!(await p.evaluate(() => window.__xss)), "desktop: no injected script ran");
  ok(errors.length === 0, "desktop: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- the antimeridian: boxes split, none crosses 180° ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1000, height: 700 } });
  await p.evaluate(() => window.__asapMap.setView([-17, 179.5], 7, { animate: false })); await p.waitForTimeout(300);
  const b = await p.evaluate(() => window.OSAP_TRAFFIC.boxes());
  ok(Array.isArray(b) && b.length >= 2 && b.every((q) => q[1] >= -180 && q[3] <= 180 && q[1] < q[3] && (q[2] - q[0]) * (q[3] - q[1]) <= 100.01), "dateline: boxes split at 180° " + JSON.stringify(b));
  ok(errors.length === 0, "dateline: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- feeds failing ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1360, height: 860 } }, { air: "down", sea: "busy" });
  await p.evaluate(() => { window.__asapMap.setView([13.4, 100.6], 9, { animate: false }); }); await om(p);
  await p.check('#ml-air input[data-trf="air"]'); await p.check('#ml-sea input[data-trf="sea"]'); await p.waitForTimeout(1500);
  const a = await p.evaluate(() => document.getElementById("tra-st").textContent), s = await p.evaluate(() => document.getElementById("trs-st").textContent);
  ok(/Could not load the live air traffic files \(HTTP 404/.test(a), "down: air says it could not load: " + a);
  ok(/Could not load ships \(HTTP 429/.test(s), "busy: ships say the feed refused: " + s);
  ok(errors.length === 0, "failing: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- sweep stopped: the map says the positions are old ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1360, height: 860 } }, { air: "stale" });
  await p.evaluate(() => { window.__asapMap.setView([13.4, 100.6], 9, { animate: false }); }); await om(p);
  await p.check('#ml-air input[data-trf="air"]'); await p.waitForTimeout(1500);
  const age = await p.evaluate(() => (document.querySelector(".tra-age") || {}).textContent || "");
  const a = await p.evaluate(() => document.getElementById("tra-st").textContent);
  ok(/^Stale: data 5 h 40 min old/.test(age) && /sweep has not run since/.test(age), "stale: legend on the map says stale with the age: " + age);
  ok(/^Stale: OSAP's sweep has not run since/.test(a), "stale: status line says stale: " + a);
  ok(errors.length === 0, "stale: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- live positions for the area on screen, Refresh now ----------
{
  const { ctx, p, errors, live } = await open({ viewport: { width: 1360, height: 860 } }, { live: "ok" });
  await p.evaluate(() => { window.__asapMap.setView([13.7, 100.6], 9, { animate: false }); }); await om(p);
  await p.check('#ml-air input[data-trf="air"]'); await p.waitForTimeout(1800);
  const q = live[0] ? new URL(live[0]).searchParams : null;
  ok(q && Math.abs(+q.get("lat") - 13.7) < 0.01 && Math.abs(+q.get("lon") - 100.6) < 0.01 && +q.get("nm") > 0 && +q.get("nm") <= 250, "live: asks for the circle on screen " + (live[0] || "nothing"));
  const c = await count(p);
  ok(c.air === 2, "live: inside the live circle only the live answer is drawn (no sweep copies): " + c.air);
  const age = await p.evaluate(() => (document.querySelector(".tra-age") || {}).textContent || "");
  ok(/^Live for the area on screen: adsb\.lol, asked \d+ s ago \(updates every 15 s\)/.test(age), "live: legend says live, source and seconds: " + age);
  const pop = await popWhere(p, "air", "LIVE1");
  ok(/adsb\.lol live track/.test(pop) && /asked live by OSAP's server/.test(pop) && /ODbL/.test(pop), "live: pop-up credits the live source");
  const n = live.length;
  await p.click("#tra-st [data-trf-now]"); await p.waitForTimeout(800);
  ok(live.length > n, "live: Refresh now asks again (" + n + " -> " + live.length + ")");
  await p.evaluate(() => window.__asapMap.setView([20, 100], 4, { animate: false })); await p.waitForTimeout(1500);
  const st = await p.evaluate(() => document.getElementById("tra-st").textContent);
  ok(/Zoom in for live positions/.test(st), "live: zoomed out, says zoom in for live and keeps the sweep: " + st);
  ok(errors.length === 0, "live: no page errors " + errors.join(" | "));
  await ctx.close();
}
{
  const { ctx, p, errors } = await open({ viewport: { width: 1360, height: 860 } }, { live: "down" });
  await p.evaluate(() => { window.__asapMap.setView([13.7, 100.6], 9, { animate: false }); }); await om(p);
  await p.check('#ml-air input[data-trf="air"]'); await p.waitForTimeout(1800);
  const c = await count(p), st = await p.evaluate(() => document.getElementById("tra-st").textContent);
  ok(c.air === 5 && /Live positions unavailable \(the live providers did not answer\)/.test(st), "live down: falls back to the sweep and says so (" + c.air + "): " + st);
  ok(errors.length === 0, "live down: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- paths: trails behind each one, the whole path when one is selected ----------
{
  const mode = { live: "ok", track: "ok" };
  const { ctx, p, errors } = await open({ viewport: { width: 1360, height: 860 } }, mode);
  await p.evaluate(() => { window.__asapMap.setView([13.7, 100.6], 9, { animate: false }); }); await om(p);
  ok(await p.evaluate(() => document.querySelectorAll('input[data-trf="trail"]').length === 2 && [...document.querySelectorAll('input[data-trf="trail"]')].every((x) => x.checked)), "paths: Trails switch in both sections, on by default");
  await p.check('#ml-air input[data-trf="air"]'); await p.waitForTimeout(1800);
  // 880844 was seen by the sweep (60 s ago) and again live (2 s ago): a trail joins the two
  let tr = await p.evaluate(() => window.OSAP_TRAFFIC.trails("air"));
  ok(tr["880844"] && tr["880844"].length === 2 && tr["880844"][0][0] < tr["880844"][1][0], "paths: both positions of one aircraft kept, in time order " + JSON.stringify(tr["880844"]));
  let n = await p.evaluate(() => window.OSAP_TRAFFIC.layers().airTrails.getLayers().length);
  ok(n === 1, "paths: one trail drawn (the aircraft seen twice): " + n);
  ok((await count(p)).air === 2, "paths: trails are not counted as aircraft");
  // select it: the flight as the sweep kept it from takeoff, joined to the newer positions seen here
  let pop = await p.evaluate(() => { const ms = window.OSAP_TRAFFIC.layers().air.getLayers(); const m = ms.find((x) => /AIQ3074/.test(x.getTooltip() && typeof x.getTooltip().getContent() === "function" ? x.getTooltip().getContent()(x) : "")); m.openPopup();
    return new Promise((r) => setTimeout(() => r((document.querySelector("[data-trpath]") || {}).textContent || ""), 900)); });
  let path = await p.evaluate(() => window.OSAP_TRAFFIC.path());
  ok(path && path.kind === "air" && path.id === "880844" && path.st === "ok" && path.pts.length === 6 && path.gaps === 1, "paths: aircraft path = the sweep's 4 points from the ground + the 2 newer seen here, the 38-min silence dotted: " + (path && path.pts.length));
  ok(/Path on the map \(OSAP's air traffic sweep/.test(pop) && /6 positions/.test(pop) && /Left from Suvarnabhumi <b>Airport<\/b> \(VTBS\)/.test(pop) && /not a flight plan/.test(pop) && /as broadcast, not verified/.test(pop), "paths: pop-up says where the path came from: " + pop);
  ok(await p.evaluate(() => window.OSAP_TRAFFIC.layers().path.getLayers().length >= 3), "paths: selected path drawn (line, outline, earliest point)");
  // first heard in the air: the page says where it took off is not known, and claims no airfield
  { const t2 = await p.evaluate(() => { window.OSAP_TRAFFIC.pick("air", "880999"); return new Promise((r) => setTimeout(() => r((window.OSAP_TRAFFIC.path() || {}).st), 900)); });
    const txt = await p.evaluate(() => { const e = document.createElement("div"); e.setAttribute("data-trpath", "air:880999"); document.body.appendChild(e); window.OSAP_TRAFFIC.pick("air", "880999"); const x = e.textContent; e.remove(); return x; });
    ok(t2 === "ok" && /Where it took off is not known: OSAP first heard this flight in the air/.test(txt) && !/Left from/.test(txt), "paths: flight first heard in the air: departure not known, none claimed: " + txt); }
  await p.evaluate(() => { const m = window.OSAP_TRAFFIC.layers().air.getLayers().find((x) => /AIQ3074/.test(x.getTooltip().getContent()(x))); m.openPopup(); }); await p.waitForTimeout(600);
  ok(await p.evaluate(() => /Selected aircraft's path/.test(document.querySelector(".leaflet-control-container").innerHTML)), "paths: legend names the selected path with Hide path");
  // trails off: none drawn, path stays; Hide path clears it
  await p.uncheck('#ml-air input[data-trf="trail"]'); await p.waitForTimeout(400);
  ok(await p.evaluate(() => window.OSAP_TRAFFIC.layers().airTrails.getLayers().length === 0 && !document.querySelector('#ml-sea input[data-trf="trail"]').checked), "paths: Trails off hides them (both switches follow)");
  await p.check('#ml-air input[data-trf="trail"]'); await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelector('[data-trpath-act="hide"]').click()); await p.waitForTimeout(300);
  ok(await p.evaluate(() => !window.OSAP_TRAFFIC.path() && window.OSAP_TRAFFIC.layers().path.getLayers().length === 0), "paths: Hide path clears it");
  // ships: Open Waters' own track, its gap dotted; 7 days on request; private craft get no history
  await p.evaluate(() => window.__asapMap.setView([13.4, 100.6], 10, { animate: false }));
  await p.check('#ml-sea input[data-trf="sea"]'); await p.waitForTimeout(1500);
  pop = await p.evaluate(() => { const m = window.OSAP_TRAFFIC.layers().sea.getLayers().find((x) => /TANKER TWO/.test(x.getTooltip().getContent()(x))); m.openPopup();
    return new Promise((r) => setTimeout(() => r((document.querySelector("[data-trpath]") || {}).textContent || ""), 900)); });
  path = await p.evaluate(() => window.OSAP_TRAFFIC.path());
  ok(path && path.kind === "sea" && path.st === "ok" && path.pts.length === 5 && path.gaps === 1, "paths: ship path from Open Waters, 5 points, 1 gap: " + JSON.stringify(path && { n: path.pts.length, g: path.gaps, st: path.st }));
  ok(/Open Waters AIS track, AISHub/.test(pop) && /1 gap where no receiver heard it \(dotted\)/.test(pop) && /Show 7 days/.test(pop), "paths: ship pop-up gives source, gap and 7 days: " + pop);
  await p.evaluate(() => document.querySelector('[data-trpath-act="week"]').click()); await p.waitForTimeout(900);
  const tq = mode.tracks || [];
  ok(tq.some((u) => /\/vessels\/563000002\/track\?from=/.test(u)), "paths: Show 7 days asks with a start date " + tq.join(" "));
  await p.evaluate(() => { const m = window.OSAP_TRAFFIC.layers().sea.getLayers().find((x) => /Pleasure craft/.test(x.getTooltip().getContent()(x))); m.openPopup(); }); await p.waitForTimeout(600);
  path = await p.evaluate(() => window.OSAP_TRAFFIC.path());
  ok(path && path.st === "private" && path.pts.length === 0, "paths: no path history fetched for small private craft");
  // switching the layer off clears its path
  await p.evaluate(() => { const m = window.OSAP_TRAFFIC.layers().sea.getLayers().find((x) => /CARGO ONE/.test(x.getTooltip().getContent()(x))); m.openPopup(); }); await p.waitForTimeout(900);
  await p.uncheck('#ml-sea input[data-trf="sea"]'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => !window.OSAP_TRAFFIC.path()), "paths: switching Ships off clears the ship's path");
  ok(errors.length === 0, "paths: no page errors " + errors.join(" | "));
  await ctx.close();
}
// aircraft path where the sweep's flight file does not load: the positions seen here, and it says why
{
  const { ctx, p, errors } = await open({ viewport: { width: 1360, height: 860 } }, { live: "ok", track: "down" });
  await p.evaluate(() => { window.__asapMap.setView([13.7, 100.6], 9, { animate: false }); }); await om(p);
  await p.check('#ml-air input[data-trf="air"]'); await p.waitForTimeout(1800);
  await p.evaluate(() => { const m = window.OSAP_TRAFFIC.layers().air.getLayers().find((x) => /AIQ3074/.test(x.getTooltip().getContent()(x))); m.openPopup(); }); await p.waitForTimeout(900);
  const path = await p.evaluate(() => window.OSAP_TRAFFIC.path()), t = await p.evaluate(() => (document.querySelector("[data-trpath]") || {}).textContent || "");
  ok(path && path.st === "err" && path.pts.length === 2 && /positions seen since the map was opened/.test(t) && /OSAP's flight record did not load \(HTTP 404/.test(t), "paths down: falls back to positions seen here and says why: " + t);
  ok(errors.length === 0, "paths down: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- an open aircraft stays open through the 15-second live refresh (Shane 18 Nov: "the info pop-up is only up for a
// few seconds then disappears") ----------
{
  const { ctx, p, errors, live } = await open({ viewport: { width: 1360, height: 860 } }, { live: "ok" });
  await p.evaluate(() => { window.__asapMap.setView([13.7, 100.6], 9, { animate: false }); }); await om(p);
  await p.check('#ml-air input[data-trf="air"]'); await p.waitForTimeout(1800);
  // where the Details panel is hidden (Map layout, a conflict tab) the details stay a pop-up on the map
  await p.evaluate(() => document.documentElement.setAttribute("data-cf", "1"));
  await p.evaluate(() => { const m = window.OSAP_TRAFFIC.layers().air.getLayers().find((x) => /AIQ3074/.test(x.getTooltip().getContent()(x))); m.openPopup(); }); await p.waitForTimeout(600);
  const open1 = await p.evaluate(() => !!document.querySelector(".leaflet-popup-content .trafpop"));
  const n = live.length;
  await p.evaluate(() => window.OSAP_TRAFFIC.refresh()); await p.waitForTimeout(1500);
  await p.evaluate(() => window.OSAP_TRAFFIC.refresh()); await p.waitForTimeout(1500);
  const after = await p.evaluate(() => { const c = document.querySelector(".leaflet-popup-content .trafpop"); return c ? c.textContent : ""; });
  ok(open1 && live.length > n && /AIQ3074/.test(after), "keep open: the open aircraft's pop-up survives two live refreshes (" + (live.length - n) + " asks)");
  const c = await count(p);
  ok(c.air === 2, "keep open: no duplicate marker for the open aircraft: " + c.air);
  await p.evaluate(() => window.__asapMap.closePopup()); await p.evaluate(() => window.OSAP_TRAFFIC.refresh()); await p.waitForTimeout(1500);
  ok((await count(p)).air === 2, "keep open: after closing, the next refresh draws it as usual");
  // ships the same way (their refresh is every minute)
  await p.evaluate(() => window.__asapMap.setView([13.4, 100.6], 10, { animate: false }));
  await p.check('#ml-sea input[data-trf="sea"]'); await p.waitForTimeout(1500);
  await p.evaluate(() => { const m = window.OSAP_TRAFFIC.layers().sea.getLayers().find((x) => /TANKER TWO/.test(x.getTooltip().getContent()(x))); m.openPopup(); }); await p.waitForTimeout(600);
  await p.evaluate(() => window.OSAP_TRAFFIC.reload()); await p.waitForTimeout(1500);
  await p.evaluate(() => window.OSAP_TRAFFIC.reload()); await p.waitForTimeout(1500);
  const shipAfter = await p.evaluate(() => { const c = document.querySelector(".leaflet-popup-content .trafpop"); return c ? c.textContent : ""; });
  ok(/TANKER TWO/.test(shipAfter) && (await count(p)).sea === 5, "keep open: the open ship's pop-up survives two ship refreshes, no duplicate marker");
  ok(errors.length === 0, "keep open: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- phone ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await p.evaluate(() => window.__asapMap.setView([13.4, 100.6], 9, { animate: false })); await om(p); await p.waitForTimeout(400);
  ok(await shown(p, '#ml-sea input[data-trf="sea"]'), "phone: Ships switch reachable in Overlays");
  await p.check('#ml-sea input[data-trf="sea"]'); await p.check('#ml-air input[data-trf="air"]'); await p.waitForTimeout(1500);
  const c = await count(p);
  ok(c.sea > 0 && c.air > 0, "phone: both draw (" + c.air + " aircraft, " + c.sea + " ships)");
  if (OUT) await p.screenshot({ path: OUT + "/traffic-phone-panel.png" });
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
