// Headless check of winds aloft in the flight planner (assets/osap-flight.js). Open-Meteo is answered by made-up data, so the
// check is the same every run: near the ground (10 to 180 m) the wind is from 090 at 10 kt, on every pressure level from 270
// at 40 kt, with the 850 hPa level at 1500 m. Checks: the wind triangle (heading, ground speed, correction angle) and the
// level interpolation; one wind set by the analyst changes ground speed and times; Get forecast winds sends only the leg
// middles and dates and gives every leg its wind at cruise altitude (270/40) and the run-in its wind at drop altitude (090/10);
// leg times run on ground speed; the table shows wind, heading and TAS/GS; moving a point marks the winds out of date; a
// failed request says so and leaves the times as they were; no page errors.
// Run from the repo root: node tests/flight_winds_smoke.mjs   (needs the playwright package and Chromium)
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

const HPA = [1000, 925, 850, 700, 600, 500, 400, 300, 250, 200], Z = { 1000: 100, 925: 800, 850: 1500, 700: 3000, 600: 4200, 500: 5600, 400: 7200, 300: 9200, 250: 10400, 200: 11800 };
function meteo(url) {
  const u = new URL(url), lats = u.searchParams.get("latitude").split(","), d0 = Date.parse(u.searchParams.get("start_date") + "T00:00Z");
  const time = Array.from({ length: 72 }, (_, i) => d0 / 1000 + i * 3600), n = time.length, f = (v) => Array(n).fill(v);
  return lats.map(() => {
    const h = { time };
    for (const m of [10, 80, 120, 180]) { h["wind_speed_" + m + "m"] = f(10); h["wind_direction_" + m + "m"] = f(90); }
    for (const p of HPA) { h["wind_speed_" + p + "hPa"] = f(40); h["wind_direction_" + p + "hPa"] = f(270); h["geopotential_height_" + p + "hPa"] = f(Z[p]); }
    return { elevation: 20, hourly: h };
  });
}
/* due east legs along 14.9 N: DEP, IP, DZ, LDG */
const PLAN = { acft: "c130h", kt: 300, drop: 130, range: 2000, altFt: 500, cruiseFt: 8000, timeMode: "dep", t: Date.UTC(2026, 9, 29, 2, 0), dzLen: 1000, dzWid: 400,
  wind: "none", pts: [{ role: "dep", name: "A", lat: 14.9, lon: 100.0 }, { role: "ip", name: "", lat: 14.9, lon: 100.5 }, { role: "dz", name: "Z", lat: 14.9, lon: 100.6 }, { role: "land", name: "B", lat: 14.9, lon: 101.2 }] };

const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 } });
const errors = [], asked = [];
let fail = false;
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
  const u = r.request().url();
  if (/api\.open-meteo\.com\/v1\/forecast/.test(u) && /hPa/.test(u)) { asked.push(u); if (fail) return r.fulfill({ status: 503, body: "busy", headers: { "access-control-allow-origin": "*" } }); return r.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(meteo(u)) }); }
  r.abort();
});
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TSAP && window.OSAP_FLIGHT_GO, null, { timeout: 60000 }); await p.waitForTimeout(1500);
await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
await p.evaluate(() => window.OSAP_FLIGHT_GO({}));
await p.waitForFunction(() => window.OSAP_FLIGHT && window.OSAP_FLIGHT.isOpen(), null, { timeout: 15000 });

/* the maths */
const m = await p.evaluate(() => { const F = window.OSAP_FLIGHT; return { head: F.windTri(90, 100, 90, 20), left: F.windTri(90, 100, 0, 20), tail: F.windTri(90, 100, 270, 20),
  mid: F.interpWind([{ h: 0, dir: 90, kt: 10 }, { h: 1000, dir: 90, kt: 30 }], 500), above: F.interpWind([{ h: 0, dir: 90, kt: 10 }, { h: 1000, dir: 180, kt: 30 }], 5000) }; });
ok(Math.abs(m.head.gs - 80) < 1e-9 && Math.abs(m.head.hdg - 90) < 1e-9, "headwind 20 kt: ground speed 80, heading 090");
ok(Math.abs(m.left.wca + 11.537) < 0.01 && Math.abs(m.left.hdg - 78.46) < 0.01 && Math.abs(m.left.gs - 97.98) < 0.01, "wind from the left: crab left " + m.left.wca.toFixed(2) + "°, heading " + m.left.hdg.toFixed(1) + ", GS " + m.left.gs.toFixed(1));
ok(Math.abs(m.tail.gs - 120) < 1e-9, "tailwind 20 kt: ground speed 120");
ok(Math.abs(m.mid.kt - 20) < 1e-9 && Math.abs(m.mid.dir - 90) < 1e-9 && Math.abs(m.above.kt - 30) < 1e-9 && Math.abs(m.above.dir - 180) < 1e-9, "levels: halfway between, and the top level above it");

await p.evaluate((plan) => window.OSAP_FLIGHT.load(plan), PLAN);
const legsOf = () => p.evaluate(() => { const r = window.OSAP_FLIGHT.legs(window.OSAP_FLIGHT.state().plan); return { legs: r.legs.map((l) => ({ kt: l.kt, gs: l.gs, s: l.s, nm: l.nm, w: l.wind, hdg: l.hdg, tc: l.tc, runin: l.runin })), t: r.t, warn: r.warn }; });
const calm = await legsOf();
ok(calm.legs.every((l) => !l.w && l.gs === l.kt), "no wind: ground speed = airspeed");

/* one wind set by the analyst: 270 at 30 kt, a tailwind on these eastbound legs */
await p.selectOption("#fl-wm", "man"); await p.waitForSelector("#fl-wd");
await p.fill("#fl-wd", "270"); await p.dispatchEvent("#fl-wd", "change"); await p.fill("#fl-wk", "30"); await p.dispatchEvent("#fl-wk", "change"); await p.waitForTimeout(100);
const man = await legsOf();
ok(man.legs.every((l) => l.w && Math.abs(l.gs - (l.kt + 30)) < 0.6), "set wind 270/30: ground speed = TAS + 30 on every leg (" + man.legs.map((l) => Math.round(l.gs)).join(", ") + ")");
ok(man.t[3] < calm.t[3] && Math.abs(man.legs[0].s - man.legs[0].nm / man.legs[0].gs * 3600) < 1e-6, "times run on ground speed: landing earlier with the tailwind");

/* forecast winds */
await p.selectOption("#fl-wm", "fc"); await p.waitForSelector('[data-fl="wx"]');
await p.click('[data-fl="wx"]');
await p.waitForFunction(() => window.OSAP_FLIGHT.state().plan.wx, null, { timeout: 10000 });
await p.waitForTimeout(200);
const fc = await legsOf();
const q = new URL(asked[0]);
ok(asked.length === 1 && q.searchParams.get("latitude").split(",").length === 4 && /^2026-10-28$/.test(q.searchParams.get("start_date")) && /^2026-10-30$/.test(q.searchParams.get("end_date")) &&
  [...q.searchParams.keys()].sort().join() === "end_date,hourly,latitude,longitude,start_date,timeformat,timezone,wind_speed_unit", "one request with only the 3 leg middles and the DZ, the dates and the variables");
ok(fc.legs.filter((l) => !l.runin).every((l) => l.w && l.w.dir === 270 && l.w.kt === 40), "cruise legs (8000 ft) get the pressure-level wind 270/40");
ok(fc.legs[1].runin && fc.legs[1].w && fc.legs[1].w.dir === 90 && fc.legs[1].w.kt === 10, "the run-in (500 ft over a 20 m DZ) gets the low wind 090/10");
ok(Math.abs(fc.legs[0].gs - 340) < 1 && Math.abs(fc.legs[1].gs - 120) < 1 && !fc.warn.length, "ground speeds 340 kt cruise, 120 kt run-in, no warnings");
const tbl = await p.textContent("#fl-card table");
ok(/Wind/.test(tbl) && /Heading/.test(tbl) && /TAS\/GS/.test(tbl) && /300\/340/.test(tbl) && /270° 40 kt/.test(tbl), "leg table shows wind, heading and TAS/GS");
ok(/wind 270/.test(await p.evaluate(() => window.OSAP_FLIGHT.text(window.OSAP_FLIGHT.state().plan))), "copy as text carries the winds");

/* moving a point marks those winds out of date */
await p.evaluate(() => { const s = window.OSAP_FLIGHT.state().plan; s.pts[3].lat = 15.6; window.OSAP_FLIGHT.load(s); });
const st = await legsOf();
ok(!st.legs[2].w && st.legs[0].w && st.warn.some((w) => /No forecast wind for 1 leg/.test(w)), "a moved point: that leg loses its wind and the plan says so");

/* a failed request */
fail = true;
const before = await legsOf();
await p.click('[data-fl="wx"]');
await p.waitForFunction(() => /did not load/.test((document.querySelector("#fl-card .flmsg.err") || {}).textContent || ""), null, { timeout: 10000 }).catch(() => {});
const after = await legsOf();
ok(/did not load \(HTTP 503\)/.test(await p.textContent("#fl-card .flmsg.err")) && after.t[3] === before.t[3], "a failed request says so and the times stay");
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
