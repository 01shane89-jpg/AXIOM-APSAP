// Headless check of the Medical plan from a point at sea (Shane 2026-10-05: "I tried to make it do a med plan from the sea and
// it gave me a ground evac option"). The plan is opened in the Andaman Sea south-west of Phuket, on Ko Phi Phi (an island the
// coastline outlines leave out) and in the open ocean west of the Nicobars. Overpass, OSRM, Valhalla, Open-Meteo and Wikidata
// are answered by fixed test data; the coastline outlines (assets/regions) and the ports layer (data/infra/<cc>/port.json)
// are the repo's own files. Checks: at sea there is no road route, drive time, alternate or road reach from the water; road
// legs start at the landing port, and the port can be changed; "On land" restores the land plan; a road within 300 m makes
// a small island land; with no port in reach no road is asked for at all; the plan record and CONOP say the POI is at sea.
// Run from the repo root: node tests/medplan_sea_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
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

const SEA = [7.6, 98.1], ISLAND = [7.7407, 98.7784], OCEAN = [5.8, 90.0];
const OSM = { osm3s: { timestamp_osm_base: "2026-10-05T00:00:00Z" }, elements: [
  { type: "node", id: 101, lat: 7.8898, lon: 98.3899, tags: { amenity: "hospital", name: "Test Phuket Hospital", emergency: "yes", beds: "400" } },
  { type: "node", id: 102, lat: 7.8806, lon: 98.3851, tags: { amenity: "hospital", name: "Test Town Hospital", emergency: "yes" } }
] };
const SOF = { asof: "2026-10-05", hospitals: [
  { id: "sof:th:hospital:test-phuket", name: "Test Phuket Hospital", city: "Phuket", address: "", emergency_24h: true, trauma_level: "Level 1 trauma centre (test)", lat: 7.8898, lon: 98.3899, src: "https://example.org/phuket", srcname: "Test registry" }
], airports: [], posts: [] };
function pts(url) { return new URL(url).pathname.split("/").pop().split(";").map((x) => x.split(",").map(Number)); }
const near = (a, b) => Math.abs(a[0] - b[0]) < 1e-3 && Math.abs(a[1] - b[1]) < 1e-3;

async function open(o) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 } });
  const errors = [], calls = { origins: [], iso: 0, nearest: 0, alt: [] };
  const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(b) });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    if (/overpass|interpreter/.test(u)) return J(r, /air_rescue_service|"country"="US"/.test(decodeURIComponent(r.request().postData() || "")) ? { elements: [] } : OSM);
    if (/\/nearest\/v1\//.test(u)) { calls.nearest++; return J(r, { code: "Ok", waypoints: [{ distance: o.roadM == null ? 9000 : o.roadM, location: [0, 0] }] }); }
    if (/\/table\/v1\//.test(u)) { const P = pts(u); calls.origins.push(P[0]); return J(r, { code: "Ok", durations: [[0].concat(P.slice(1).map(() => 900))], distances: [[0].concat(P.slice(1).map(() => 9000))] }); }
    if (/\/route\/v1\//.test(u)) {
      const P = pts(u.split("?")[0]); if (/alternatives=3/.test(u)) calls.alt.push(P[0]); else calls.origins.push(P[0]);
      return J(r, { code: "Ok", routes: [{ duration: 900, distance: 9000, geometry: { type: "LineString", coordinates: [P[0], P[1]] }, legs: [{ distance: 9000, duration: 900, steps: [{ name: "Test Road", distance: 9000, duration: 900, maneuver: { type: "depart", location: P[0], bearing_after: 90 } }] }] }] });
    }
    if (/valhalla.*sources_to_targets|valhalla.*\/route\?/.test(u)) return r.fulfill({ status: 504, body: "" });
    if (/valhalla/.test(u)) { calls.iso++; return J(r, { type: "FeatureCollection", features: [] }); }
    if (/query\.wikidata\.org/.test(u)) return J(r, { results: { bindings: [] } });
    if (/api\.open-meteo\.com/.test(u)) return J(r, { hourly: { time: [] }, daily: { time: [] } });
    return r.abort();
  });
  await ctx.route(/\/data\/(medfac|hospitals)\//, (r) => r.fulfill({ status: 404, body: "" }));
  await ctx.addInitScript((env) => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("osap.split", "0"); if (env) localStorage.setItem("osap-medplan-th", JSON.stringify({ env: env })); } catch (e) {} }, o.env || "");
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.TSAP.areaApi && window.OSAP_MEDPLAN && window.OSAP_SEA, null, { timeout: 60000 });
  await p.waitForTimeout(2000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  await p.evaluate((S) => { window.ASAP_SOF = window.ASAP_SOF || {}; window.ASAP_SOF.th = Object.assign({ cc: "th", country: "Thailand" }, S); }, SOF);
  await p.evaluate((at) => window.OSAP_MEDPLAN.open({ at: at }), o.at);
  return { ctx, p, errors, calls };
}
const settle = (p) => p.waitForFunction(() => { const f = document.getElementById("mp-fac"); return f && !/Looking up/.test(f.textContent) && !/Working out the route/.test((document.getElementById("mp-rt") || {}).textContent || ""); }, null, { timeout: 30000 }).then(() => p.waitForTimeout(1500));

// ---------- unit: land or sea from the repo's own outlines ----------
{
  const ctx = await browser.newContext({ serviceWorkers: "block" }), p = await ctx.newPage();
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await p.goto(base + "tests/../index.html", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.OSAP_SEA && window.OSAP_COUNTRIES, null, { timeout: 60000 });
  const r = await p.evaluate(async () => {
    const S = window.OSAP_SEA, out = {};
    for (const [k, a] of [["phuket", [7.88, 98.39]], ["bangkok", [13.75, 100.5]], ["andaman", [7.6, 98.1]], ["colombo_off", [6.95, 79.79]], ["ocean", [5.8, 90]]]) out[k] = await S.where(a[0], a[1]);
    out.nm = S.nm([5.5, 98.0], [7.8804, 98.3923]);
    out.ports = await S.ports(7.6, 98.1, 400, 5);
    return out;
  });
  ok(r.phuket.sea === false && r.bangkok.sea === false, "sea: Phuket town and Bangkok are land");
  ok(r.andaman.sea === true && r.andaman.coast_km > 20 && r.colombo_off.sea === true && r.ocean.sea === true, "sea: the Andaman Sea, 7 km off Colombo and the open ocean are sea (" + r.andaman.coast_km + " km, " + r.colombo_off.coast_km + " km)");
  ok(Math.abs(r.nm - 144.5) < 1.5, "sea: great-circle NM with R 3,440.065 NM (northern Malacca to Phuket " + r.nm.toFixed(1) + ")");
  ok(r.ports.items.length === 5 && r.ports.items[0].km < 40 && r.ports.items.every((x, i, a) => !i || a[i - 1].km <= x.km) && r.ports.items.some((x) => x.src === "wpi" && /Phuket/.test(x.name)), "sea: nearest ports from the ports layer, nearest first, WPI Phuket among them: " + r.ports.items.map((x) => x.name).join(", "));
  await ctx.close();
}

// ---------- at sea: no road from the water ----------
{
  const { ctx, p, errors, calls } = await open({ at: SEA });
  await settle(p);
  const sea = await p.textContent("#mp-sea");
  ok(/The point of injury is at sea/.test(sea) && /No road starts here/.test(sea) && /Helicopter hoist/.test(sea) && /fixed-wing air ambulance cannot collect from a ship/.test(sea), "at sea: the plan says the POI is at sea, with boat, deck landing and hoist as the ways off");
  ok(/Ports to land the casualty at/.test(sea) && /\d+(\.\d)? NM/.test(sea) && /Rawai Pier/.test(sea), "at sea: ports listed with NM distance (Rawai Pier nearest)");
  ok(calls.origins.length > 0 && !calls.origins.some((o) => near([o[1], o[0]], SEA)), "at sea: no road time or route starts at the point of injury (" + calls.origins.length + " road requests)");
  const port = await p.evaluate(() => { const s = window.OSAP_MEDPLAN && document.querySelector('#mp-sea input[data-mp-port]:checked'); return s ? s.getAttribute("data-mp-port") : ""; });
  ok(!!port && calls.origins.every((o) => near([o[1], o[0]], [7.7722, 98.3287])), "at sea: every road leg starts at the chosen landing port (" + port + ")");
  ok(calls.alt.every((o) => !near([o[1], o[0]], SEA)), "at sea: no alternate line starts at the point of injury");
  ok(calls.iso === 0 && /No road reach: the point of injury is at sea/.test(await p.textContent("#mp-gh")), "at sea: no road reach is drawn round a point at sea");
  const fac = await p.textContent("#mp-fac");
  ok(/by road from Rawai Pier/.test(fac) && /by boat to Rawai Pier/.test(await p.innerHTML("#mp-fac")), "at sea: hospital times say boat to the port, then road from it");
  const plan = await p.evaluate(() => { const v = document.getElementById("mp-val"); return v ? v.textContent : ""; });
  ok(/Point of injury at sea/.test(plan) && /Road legs start at Rawai Pier/.test(plan), "at sea: plan status warns the POI is at sea and names the landing port");
  ok(/Boat and road evac/.test(await p.textContent("#mp-conop")) && /by boat to Rawai Pier/.test(await p.textContent("#mp-conop")) && /accepted deck landing or hoist/.test(await p.textContent("#mp-conop")), "at sea: the CONOP shows the boat leg and the deck or hoist gap");
  ok(await p.evaluate(() => [...document.querySelectorAll(".mpicon.pt")].some((x) => x.textContent === "PORT")), "at sea: the landing port is marked on the map");
  /* another port: road legs start again from it */
  const n0 = calls.origins.length;
  await p.evaluate(() => { const r = [...document.querySelectorAll('#mp-sea input[data-mp-port]')].find((x) => !x.checked && /Phuket/.test(x.closest("tr").textContent)); r.click(); });
  await p.waitForTimeout(2500);
  ok(calls.origins.slice(n0).length > 0 && calls.origins.slice(n0).every((o) => near([o[1], o[0]], [7.8333, 98.4])) && /by road from Phuket/.test(await p.textContent("#mp-fac")), "at sea: choosing Phuket port re-routes every road leg from it");
  /* the planner says it is on land: the land plan comes back */
  await p.selectOption("#mp-env", "land"); await settle(p);
  ok(!/at sea/.test(await p.textContent("#mp-sea")) && calls.iso > 0, "at sea: 'On land' gives the land plan back (road reach drawn)");
  /* at sea the plan links to the sea transit assessment, starting from the POI */
  await p.selectOption("#mp-env", "sea"); await settle(p);
  await p.click("#mp-sea [data-mp-seatr]");
  ok(await p.evaluate(() => { const e = document.getElementById("seatr"), w = window.OSAP_SEATRANSIT.state().plan.wps; return e && !e.hidden && document.getElementById("medplan").hidden && w.length === 1 && Math.abs(w[0].lat - 7.6) < 1e-3; }), "at sea: 'Sea transit assessment' opens with the POI as the first waypoint");
  ok(errors.length === 0, "at sea: no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}

// ---------- a small island the outlines miss: a road within 300 m makes it land ----------
{
  const { ctx, p, errors, calls } = await open({ at: ISLAND, roadM: 40 });
  await settle(p);
  ok(calls.nearest > 0 && /treated as land \(an island\)/.test(await p.textContent("#mp-sea")) && calls.origins.some((o) => near([o[1], o[0]], ISLAND)), "island: Ko Phi Phi with a mapped road 40 m away is planned as land");
  ok(errors.length === 0, "island: no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}

// ---------- open ocean, no port in reach: no road asked for at all ----------
{
  const { ctx, p, errors, calls } = await open({ at: OCEAN });
  await settle(p);
  const sea = await p.textContent("#mp-sea");
  ok(/The point of injury is at sea/.test(sea) && /No port within 400 km/.test(sea) && /prolonged onboard care/.test(sea), "ocean: no port in reach is said plainly, with prolonged onboard care");
  ok(calls.origins.length === 0 && calls.alt.length === 0, "ocean: no road time or route is asked for (" + calls.origins.length + ")");
  ok(errors.length === 0, "ocean: no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}

await browser.close(); server.close();
console.log(fails ? fails + " check(s) failed" : "all checks passed");
process.exit(fails ? 1 : 0);
