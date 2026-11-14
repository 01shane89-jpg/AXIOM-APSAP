// Headless check that a finger tap on a live aircraft or ship opens its details on a phone. Shane, on an iPhone on the Texas
// page, tapped an aircraft and got nothing about it: the aircraft and ships were drawn on one canvas with no pane of its
// own, which Leaflet puts in the overlay pane, level with the map's own canvas, so the map-click finder in index.html
// reached the state outline drawn under them first and opened the outline's card instead. Each kind now draws in its own
// pane above the base map. Checks, on the Texas page and on Thailand (no outline), in a phone-sized touch screen: a tap on
// the aircraft, and one 10 px beside it (the touch hit margin), open the aircraft's details (call sign, type, altitude,
// speed, heading, Zulu and local time, source link), and a tap on a ship opens the ship's. The live-air files and Open
// Waters are answered from fixtures; every other outside host is blocked.
// Run from the repo root: node tests/traffic_tap_smoke.mjs   (BROWSER=webkit runs it in WebKit, the engine of every iPhone browser)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium, webkit } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const WK = process.env.BROWSER === "webkit";
const browser = WK ? await webkit.launch() : await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const tag = WK ? "webkit" : "chromium";
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + tag + ": " + m); if (!c) fails++; }

const F = ["hex", "cs", "reg", "t", "desc", "lat", "lon", "alt", "gs", "trk", "pos", "src", "sqk", "cat", "fl"];
const SRC = [{ id: "fi", name: "adsb.fi", site: "https://adsb.fi/", licence: "adsb.fi open data terms", nc: true, track: "https://globe.adsb.fi/?icao={hex}" }];
const PLACES = [
  // Texas: the state outline is a tappable shape under everything on the map
  { name: "Texas", q: "?st=TX#us/timeline", ac: [31.5, -101.5], cell: "30_-110", ship: [29.3, -94.7], zoom: 10 },
  { name: "Thailand", q: "#th/timeline", ac: [13.7, 100.6], cell: "10_100", ship: [13.3, 100.7], zoom: 10 }];

for (const P of PLACES) {
  const now = Math.round(Date.now() / 1000), built = new Date().toISOString();
  const AC = [["a1b2c3", "SWA123", "N123SW", "B738", "BOEING 737-800", P.ac[0], P.ac[1], 36000, 452, 60, now - 30, 0, "1200", "A3", 0]];
  const INDEX = { schema: "osap-air-traffic/1", built, sweep: 1, cell: 10, f: F, sources: SRC, status: [], asked: 1, unasked: 0, total: 1, cells: { [P.cell]: 1 }, circ: [] };
  const SHIPS = { type: "FeatureCollection", attribution: { aishub: "AISHub (https://www.aishub.net)" }, features: [{ type: "Feature", id: 563000009,
    geometry: { type: "Point", coordinates: [P.ship[1], P.ship[0]] }, properties: { mmsi: 563000009, name: "TAP CARGO", type: 70, kind: "vessel", sog: 11, cog: 90, heading: 90,
      flag: "SG", seen: new Date(Date.now() - 120e3).toISOString(), source: "aishub", station: "aishub", length: 180, beam: 30 } }] };
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await ctx.route(/raw\.githubusercontent\.com\/.*\/live-air\//, (r) => {
    const u = r.request().url();
    if (/index\.json$/.test(u)) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(INDEX) });
    if (u.endsWith("a/" + P.cell + ".json")) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schema: "osap-air-cell/1", built, cell: P.cell, ac: AC }) });
    return r.fulfill({ status: 404, body: "" });
  });
  await ctx.route(/ais\.openwaters\.io/, (r) => r.fulfill({ status: 200, contentType: "application/geo+json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(SHIPS) }));
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)(?!raw\.githubusercontent\.com\/.*\/live-air\/)(?!ais\.openwaters\.io)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("osap-traffic", JSON.stringify({ air: true, sea: true })); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + P.q, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.OSAP_TRAFFIC && window.__asapMap && document.documentElement.classList.contains("phone"), null, { timeout: 90000 });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.hide(); return 0; });
  const where = (ll) => p.evaluate((ll) => { const m = window.__asapMap, pt = m.latLngToContainerPoint(ll), r = m.getContainer().getBoundingClientRect(); return { x: r.left + pt.x, y: r.top + pt.y }; }, ll);
  // the details card on a phone (the report panel in the bottom sheet), or a pop-up where the page uses one
  const details = () => p.evaluate(() => { const e = document.querySelector(".leaflet-popup-content") || document.querySelector("#rv-pkg"); return e ? e.innerText : ""; });
  // close the last card the way a reader does (its × button) and drop the sheet back to its bar, so the next tap lands on the map
  const clear = async () => { await p.evaluate(() => { window.__asapMap.closePopup(); const x = document.querySelector("#rv-pkg .pkghead .x"); if (x) x.click();
    const b = document.querySelector("#rv-pkg"); if (b) b.innerHTML = ""; document.documentElement.setAttribute("data-sheet", "bar"); return 0; }); await p.waitForTimeout(400); };
  const tapAt = async (ll, dx) => {
    await p.evaluate(([ll, z]) => { window.__asapMap.setView(ll, z, { animate: false }); return 0; }, [ll, P.zoom]); await p.waitForTimeout(1800);
    await clear(); const c = await where(ll);
    await p.touchscreen.tap(c.x + dx, c.y); await p.waitForTimeout(1000);
    return details();
  };
  let d = await tapAt(P.ac, 0);
  const n = await p.evaluate(() => window.OSAP_TRAFFIC.layers().air.getLayers().length);
  ok(n === 1, P.name + ": the aircraft is drawn (" + n + ")");
  ok(/Aircraft · SWA123/.test(d), P.name + ": a tap on the aircraft opens its details, not something under it: " + JSON.stringify(d.slice(0, 80)));
  ok(/Type B738 \(BOEING 737-800\)/.test(d) && /36,000 ft/.test(d) && /452 kt/.test(d) && /heading 060°/.test(d) && /\d{4}Z/.test(d) && /adsb\.fi live track/.test(d),
    P.name + ": details give type, altitude, speed, heading, Zulu time and the source link");
  ok(/Z \/ \d{2}:\d{2} [A-Z]{2,5}/.test(d), P.name + ": the report time is in Zulu and local time");
  d = await tapAt(P.ac, 10);
  ok(/Aircraft · SWA123/.test(d), P.name + ": a tap 10 px beside the aircraft still opens it (touch hit margin): " + JSON.stringify(d.slice(0, 80)));
  d = await tapAt(P.ship, 0);
  ok(/TAP CARGO/.test(d) && /MMSI 563000009/.test(d), P.name + ": a tap on a ship opens the ship's details: " + JSON.stringify(d.slice(0, 80)));
  if (process.env.OUT) await p.screenshot({ path: process.env.OUT + "/traffic-tap-" + P.name.toLowerCase() + "-" + tag + ".png" });
  ok(errors.length === 0, P.name + ": no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
