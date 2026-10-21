// Headless check of the Medical plan when OpenStreetMap does not answer (Shane 2026-10-20: a plan in Louisiana with Thailand
// selected read "RED: blocking error · still reading" for five minutes with nothing moving, and offered Thailand's 1669).
// Overpass never answers here; the U.S. is outside OSAP's stored copy. Checks: the plan is the U.S. plan, a spinner says it is
// still reading (no red error while reading), and the hospital lookup ends with a clear failure within 75 s.
// Run from the repo root: node tests/medplan_hang_smoke.mjs   (needs the playwright package and Chromium)
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
    if (/overpass|interpreter/.test(u)) { calls.op = (calls.op || 0) + 1; return; } if (0) return J(r, /air_rescue_service|"country"="US"/.test(decodeURIComponent(r.request().postData() || "")) ? { elements: [] } : OSM);
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
  
  await ctx.addInitScript((env) => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("osap.split", "0"); if (env) localStorage.setItem("osap-medplan-th", JSON.stringify({ env: env })); } catch (e) {} }, o.env || "");
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#th/map", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.TSAP.areaApi && window.OSAP_MEDPLAN && window.OSAP_SEA, null, { timeout: 60000 });
  await p.waitForTimeout(2000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  await p.evaluate((S) => { window.ASAP_SOF = window.ASAP_SOF || {}; window.ASAP_SOF.th = Object.assign({ cc: "th", country: "Thailand" }, S); }, SOF);
  await p.evaluate((at) => window.OSAP_MEDPLAN.open({ at: at }), o.at);
  return { ctx, p, errors, calls };
}
const settle = (p) => p.waitForFunction(() => { const f = document.getElementById("mp-fac"); return f && !/Looking up/.test(f.textContent) && !/Working out the route/.test((document.getElementById("mp-rt") || {}).textContent || ""); }, null, { timeout: 30000 }).then(() => p.waitForTimeout(1500));


const o = await open({ at: [30.45, -91.15] });
const t0 = Date.now();
await o.p.waitForTimeout(3000);
const early = await o.p.evaluate(() => ({ h: (document.querySelector("#medplan h2") || {}).textContent || "", val: (document.getElementById("mp-val") || {}).innerHTML || "", wait: !!document.querySelector("#medplan .mpwait") }));
ok(/United States/.test(early.h) && !/Thailand/.test(early.h), "a point in Louisiana is the United States' plan, not the selected country's (" + early.h + ")");
ok(/mpbusy/.test(early.val) && !/blocking error/.test(early.val) && early.wait, "while reading: a spinner and 'Building the plan', no red error");
await o.p.waitForFunction(() => /could not be reached|lookup failed/.test((document.getElementById("mp-fac") || {}).textContent || ""), null, { timeout: 90000 }).catch(() => {});
const secs = (Date.now() - t0) / 1000 + 3, fac = await o.p.evaluate(() => (document.getElementById("mp-fac") || {}).textContent || "");
ok(secs < 80 && /could not be reached|lookup failed/.test(fac), "the hospital lookup ends with a clear failure in " + Math.round(secs) + " s");
ok(!/1669|Sky Doctor/.test(await o.p.textContent("#medplan")), "no Thai emergency number or air service in a U.S. plan");
ok(!o.errors.length, "no page errors " + o.errors.join(" | "));
await o.ctx.close(); await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all checks passed");
process.exit(fails ? 1 : 0);
