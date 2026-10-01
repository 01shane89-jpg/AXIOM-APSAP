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
  const errors = [], air = [], sea = [];
  await ctx.route(/raw\.githubusercontent\.com\/.*\/live-air\//, (r) => {
    const u = r.request().url(); air.push(u);
    if (mode.air === "down") return r.fulfill({ status: 404, body: "404: Not Found" });
    if (/index\.json$/.test(u)) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(INDEX) });
    if (/a\/10_100\.json$/.test(u)) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schema: "osap-air-cell/1", built, cell: "10_100", ac: AC }) });
    return r.fulfill({ status: 404, body: "" });
  });
  await ctx.route(/ais\.openwaters\.io/, (r) => {
    sea.push(r.request().url());
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
  return { ctx, p, errors, air, sea };
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
