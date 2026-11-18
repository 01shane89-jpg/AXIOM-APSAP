// Headless check of the sensor check on a conflict tab (assets/osap-conflicts.js sensorHtml, rules tools/sensor_lib.mjs sensor-v1).
// A fixture data/live/conflicts/sensors.js pairs satellite heat with one placed Myanmar report: its incident shows "Satellite heat
// nearby, may relate" with the satellite, time, distance and hours apart, and says it is not a confirmation; another incident
// shows nothing. Run from the repo root: node tests/cf_sensor_smoke.mjs   (playwright and Chromium; OUT=dir saves a screenshot)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
import { knownReports } from "../tools/cf_decisions.mjs";
const OUT = process.env.OUT || "", ID = "myanmar";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

const known = knownReports();
const reps = [...(known.get(ID) || new Map()).values()].filter((i) => i.geo && i.geo.la != null && i.geo.p !== "province" && !["legal", "talks", "humanitarian", "statement"].includes(i.kind)).sort((a, b) => (a.date < b.date ? 1 : -1));
// two placed reports far enough apart (and days apart) that the page keeps them as separate incidents
const A = reps[0], B = reps.find((r) => Math.abs(r.geo.la - A.geo.la) + Math.abs(r.geo.lo - A.geo.lo) > 1 && Math.abs(Date.parse(r.date) - Date.parse(A.date)) > 4 * 864e5);
if (!A || !B) { console.log("SKIP: need two placed " + ID + " reports apart in place and time"); server.close(); process.exit(0); }
const FIX = { schema: "osap-cf-sensors/1", rules: "sensor-v1", asof: "2026-11-18 00:00Z", src: [], skipped: {},
  by: { [ID]: { [A.fp]: [{ km: 3.4, h: -5.2, t: "2026-11-17T19:30", sat: "NOAA-21", frp: 14.2, conf: "h" }] } },
  seis_rules: "seismic-v1", seis_asof: "2026-11-18 00:00Z", seis_src: [],
  seis: { [ID]: { [A.fp]: [{ km: 6.2, h: -0.7, t: "2026-11-17T19:12:05Z", net: "EMSC", mag: 2.9, magType: "ml", dep: 1, type: "explosion", blast: true, url: "https://www.seismicportal.eu/eventdetails.html?unid=x", place: "MYANMAR" },
    { km: 21, h: -9, t: "2026-11-17T10:00:00Z", net: "USGS", mag: 4.2, magType: "mb", dep: 10, type: "earthquake", blast: false, url: "https://evil.example/", place: "" }] } } };
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await ctx.route(/data\/live\/conflicts\/sensors\.js/, (r) => r.fulfill({ contentType: "text/javascript", body: "window.OSAP_CF_SENSORS=" + JSON.stringify(FIX) + ";" }));
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("asap-period", JSON.stringify({ p: "all" })); } catch (e) {} });
const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#mm/timeline", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TSAP && window.OSAP_CONFLICT_TABS && window.OSAP_CONFLICTS, null, { timeout: 60000 });
await p.waitForTimeout(1500);
await p.evaluate((id) => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); window.OSAP_CONFLICT_TABS.open(id, "mm"); }, ID);
await p.waitForFunction(() => document.querySelector("#cf-list ol.cfl") && window.OSAP_CF_SENSORS, null, { timeout: 60000 });
await p.evaluate(() => { const s = document.querySelector('#cf-rail select[data-cff="days"]'); if (!s) return; const o = [...s.options].pop(); s.value = o.value; s.dispatchEvent(new Event("change", { bubbles: true })); });
await p.waitForTimeout(800);
const li = (fp) => p.evaluate((fp) => { const gs = document.getElementById("cf-list")._groups || []; const k = gs.findIndex((g) => g.all.some((x) => x.fp === fp));
  const e = document.querySelector('#cf-list li[data-k="' + k + '"]'); return k < 0 || !e ? null : { k, html: e.innerHTML, text: e.textContent }; }, fp);
const a = await li(A.fp), b = await li(B.fp);
ok(a && /Satellite heat nearby, may relate \(1\)/.test(a.text), "the paired report's incident shows the sensor check" + (a ? "" : " (report not listed)"));
ok(a && /NOAA-21/.test(a.text) && /3 km from the report's pin/.test(a.text) && /5 h before the report/.test(a.text) && /high confidence/.test(a.text), "it gives the satellite, distance, hours apart and confidence");
ok(a && /not a confirmation/.test(a.html) && /sensor-v1/.test(a.html), "it says it is not a confirmation and names its rules");
ok(b && !/Satellite heat nearby/.test(b.text), "an incident without a pairing shows nothing");
ok(a && /Seismic event nearby, may relate \(2\)/.test(a.text) && /EMSC event at 2026-11-17 19:12Z, magnitude 2.9 ml, depth 1 km, 6 km from the report's pin, under 1 h before the report/.test(a.text), "seismic: the closest event first with network, time, magnitude, depth, distance (" + (a ? a.text.slice(a.text.indexOf("Seismic"), a.text.indexOf("Seismic") + 200) : "") + ")");
ok(a && /EMSC lists it as <b>explosion<\/b>/.test(a.html) && /USGS lists it as earthquake/.test(a.text) && /often a default, not measured/.test(a.text), "seismic: the network's own label, and the 10 km default depth flagged");
ok(a && /does not tell an explosion from an earthquake/.test(a.html) && /seismic-v1/.test(a.html) && /CC BY 4.0/.test(a.html) && !/evil\.example/.test(a.html), "seismic: caveat, rules, licences; a link off the network's site is not shown");
ok(b && !/Seismic event nearby/.test(b.text), "seismic: an incident without a pairing shows nothing");
if (OUT) { await p.evaluate((k) => { const d = document.querySelector('#cf-list li[data-k="' + k + '"] details.cfmt:last-of-type'); if (d) { d.open = true; d.scrollIntoView(); } }, a.k); await p.screenshot({ path: OUT + "/cf-sensor.png" }); }
ok(!errors.length, "no page errors " + JSON.stringify(errors.slice(0, 3)));
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
