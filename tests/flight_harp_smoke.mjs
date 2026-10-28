// Headless check of the freefall release point (HARP) in the flight planner (assets/osap-flight.js). A due-east run-in (090)
// at 130 kt, exit 12,500 ft AGL, opening 4,000 ft, canopy 5 m/s and 20 kt, forward throw 300 m.
// Checks: the fall from 12,500 to 4,000 ft takes a believable 40 to 60 s with no wind and no drift; with a set wind from 270
// at 20 kt the freefall drift is that wind times the fall time and the HARP sits that far plus the forward throw west of the
// PI; with "open upwind and drift down" the canopy drift (20 kt x 4,000 ft / 5 m/s) is added and the canopies open that far
// upwind; a wind under canopy as strong as the canopy warns; choosing freefall in the panel sets 12,500 ft and shows the
// opening, canopy fields, HARP and canopy reach; forecast winds keep the DZ levels and drive the HARP with a wind table from
// exit to the ground; the map, text, KML and forDz say HARP; no page errors.
// Run from the repo root: node tests/flight_harp_smoke.mjs   (needs the playwright package and Chromium)
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
const near = (a, b, t) => Math.abs(a - b) <= t;

const HPA = [1000, 925, 850, 700, 600, 500, 400, 300, 250, 200], Z = { 1000: 100, 925: 800, 850: 1500, 700: 3000, 600: 4200, 500: 5600, 400: 7200, 300: 9200, 250: 10400, 200: 11800 };
function meteo(url) {
  const u = new URL(url), lats = u.searchParams.get("latitude").split(","), d0 = Date.parse(u.searchParams.get("start_date") + "T00:00Z");
  const time = Array.from({ length: 72 }, (_, i) => d0 / 1000 + i * 3600), n = time.length, f = (v) => Array(n).fill(v);
  return lats.map(() => {
    const h = { time };
    for (const m of [10, 80, 120, 180]) { h["wind_speed_" + m + "m"] = f(6 + m / 20); h["wind_direction_" + m + "m"] = f(350); }
    for (const p of HPA) { h["wind_speed_" + p + "hPa"] = f(25); h["wind_direction_" + p + "hPa"] = f(300); h["geopotential_height_" + p + "hPa"] = f(Z[p]); }
    return { elevation: 20, hourly: h };
  });
}
const T = Date.UTC(2026, 9, 29, 2, 0);
const PLAN = { acft: "c130h", kt: 300, drop: 130, range: 2000, altFt: 1250, cruiseFt: 8000, timeMode: "tot", t: T, dzLen: 1000, dzWid: 400, wind: "none",
  jump: { type: "sl", K: 3, ft: 230, total: 20, doors: 2, ei: 1, gap: 8 },
  pts: [{ role: "dep", name: "A", lat: 14.9, lon: 100.0 }, { role: "ip", name: "", lat: 14.9, lon: 100.5 }, { role: "dz", name: "Z", lat: 14.9, lon: 100.6 }, { role: "land", name: "B", lat: 14.9, lon: 101.2 }] };

const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 } });
const errors = [];
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
  const u = r.request().url();
  if (/api\.open-meteo\.com\/v1\/forecast/.test(u) && /hPa/.test(u)) return r.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(meteo(u)) });
  r.abort();
});
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TSAP && window.OSAP_FLIGHT_GO, null, { timeout: 60000 }); await p.waitForTimeout(1500);
await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
await p.evaluate(() => window.OSAP_FLIGHT_GO({}));
await p.waitForFunction(() => window.OSAP_FLIGHT && window.OSAP_FLIGHT.isOpen(), null, { timeout: 15000 });
await p.evaluate((plan) => window.OSAP_FLIGHT.load(plan), PLAN);
const drop = () => p.evaluate(() => { const F = window.OSAP_FLIGHT, s = F.state().plan, R = F.legs(s), x = F.drops(s, R)[0], G = window.OSAP_GEO;
  const off = (q) => { const inv = G.inverse(x.pi, q); return { n: inv.m * Math.cos(inv.b1 * Math.PI / 180), e: inv.m * Math.sin(inv.b1 * Math.PI / 180) }; };
  return { x, h: off(x.carp), o: off(x.ff ? x.ff.openAt : x.pi), plan: s }; });
const set = async (sel, v) => { await p.fill(sel, String(v)); await p.dispatchEvent(sel, "change"); await p.waitForTimeout(80); };

/* choose freefall in the panel */
await p.selectOption("#fl-jt", "ff"); await p.waitForSelector("#fl-op");
let d = await drop();
ok(d.plan.altFt === 12500 && d.plan.jump.type === "ff" && d.plan.jump.open === 4000 && d.plan.jump.ft === 300 && d.x.rk === "HARP", "freefall sets exit 12,500 ft AGL, opening 4,000 ft, forward throw 300 m, HARP");
ok(!(await p.$("#fl-k")) && !!(await p.$("#fl-cdr")) && !!(await p.$("#fl-cfs")) && !!(await p.$("#fl-cm")), "panel swaps K for the canopy fields");
ok(d.x.ff.ffS >= 40 && d.x.ff.ffS <= 60 && near(d.x.drift, 0, 1e-9) && near(d.h.e, -300, 1), "no wind: freefall " + d.x.ff.ffS + " s, no drift, HARP 300 m back (" + Math.round(d.h.e) + " m E)");
ok(near(d.x.ff.canS, 4000 * 0.3048 / 5, 0.01) && near(d.x.ff.reach, 20 * 0.514444 * d.x.ff.canS, 1), "under canopy " + Math.round(d.x.ff.canS) + " s, still-air reach " + Math.round(d.x.ff.reach) + " m");

/* a set wind from 270 at 20 kt, canopies flown to the DZ */
await p.selectOption("#fl-wm", "man"); await p.waitForSelector("#fl-wd"); await set("#fl-wd", 270); await set("#fl-wk", 15);
d = await drop();
const ffD = 15 * 0.514444 * d.x.ff.ffS;
ok(near(d.x.ff.ffM, ffD, 2) && near(d.x.ff.canM, 0, 1e-9) && near(d.h.e, -(ffD + 300), 3) && near(d.h.n, 0, 2), "270/15: freefall drift " + Math.round(d.x.ff.ffM) + " m (= wind x fall time), HARP " + Math.round(-d.h.e) + " m west");
ok(near(d.o.e, 0, 1) && near(d.o.n, 0, 1) && !d.x.warn.some((w) => /cannot hold/.test(w)), "canopies open over the PI, no canopy warning at 15 kt");
await set("#fl-wk", 25); d = await drop();
ok(d.x.warn.some((w) => /mean wind under canopy \(25 kt\) is as strong as the canopy's forward speed \(20 kt\)/.test(w)), "25 kt under a 20 kt canopy warns");
await set("#fl-wk", 15);
await p.selectOption("#fl-cm", "drift"); await p.waitForTimeout(100); d = await drop();
const canD = 15 * 0.514444 * 4000 * 0.3048 / 5;
ok(near(d.x.ff.canM, canD, 3) && near(d.x.drift, d.x.ff.ffM + canD, 4) && near(d.o.e, -canD, 4), "drift down: canopy drift " + Math.round(d.x.ff.canM) + " m added, canopies open " + Math.round(-d.o.e) + " m upwind");
const ui = await p.textContent("#fl-card");
ok(/HARP 47P/.test(ui) && /Canopy reach in still air/.test(ui) && /Freefall to 4000 ft AGL/.test(ui) && /canopies open upwind/.test(ui), "panel shows the HARP, freefall, canopy drift and reach");
await p.waitForTimeout(200);
ok((await p.evaluate(() => [...document.querySelectorAll(".leaflet-flpane-pane .flcarp")].map((x) => x.textContent).join())) === "HARP,Canopies open", "map labels the HARP and where canopies open");
const ex = await p.evaluate(() => { const F = window.OSAP_FLIGHT, s = F.state().plan; return { t: F.text(s), k: F.kml(s) }; });
ok(/HARP 47P/.test(ex.t) && /Freefall \d+ s to 4000 ft AGL/.test(ex.t) && /<name>HARP DZ<\/name>/.test(ex.k), "text and KML carry the HARP");

/* forecast winds level by level */
await p.selectOption("#fl-cm", "fly");
await p.selectOption("#fl-wm", "fc"); await p.waitForSelector('[data-fl="wx"]'); await p.click('[data-fl="wx"]');
await p.waitForFunction(() => { const s = window.OSAP_FLIGHT.state().plan; return s.wx && s.wx.dz && s.wx.dz.length === 1 && s.wx.dz[0].lv && s.wx.dz[0].lv.length; }, null, { timeout: 15000 });
d = await drop();
const tb = d.x.ff.table, row = (f) => tb.filter((r) => r.ft === f)[0];
ok(/Open-Meteo levels/.test(d.x.wind && d.x.wind.src) && d.x.ff.ffM > 300 && near(d.x.wind.dir, 300, 6), "forecast: HARP from the DZ levels (" + Math.round(d.x.ff.ffM) + " m, upwind toward " + Math.round(d.x.wind.dir) + ")");
ok(tb[0].ft === 12500 && tb[0].what === "exit" && row(4000).what === "opening" && tb[tb.length - 1].ft === 0 && near(row(12500).dir, 300, 0.5) && near(row(12500).kt, 25, 0.1), "wind table exit to ground: " + tb.map((r) => r.ft).join(","));
const fd = await p.evaluate(() => { const s = window.OSAP_FLIGHT.state().plan; s.pts[2].dzId = "dzharptest"; window.OSAP_FLIGHT.load(s); return window.OSAP_FLIGHT.forDz("dzharptest"); });
ok(fd && fd.release === "HARP" && fd.open_ft === 4000 && Array.isArray(fd.carp), "forDz says HARP and the opening altitude");
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
