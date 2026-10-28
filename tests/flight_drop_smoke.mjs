// Headless check of the drop in the flight planner (assets/osap-flight.js): release point, passes, green and red light and
// time warnings. A due-east run-in (090) at 130 kt over a 1000 x 400 m DZ with the PI in the middle, 1250 ft AGL.
// Checks: with no wind the CARP is the forward throw (230 m) straight back along the run-in and the plan says so; with a wind
// set from 360 at 10 kt the drift is K x A x V = 3 x 12.5 x 10 = 375 m and the CARP is 375 m north and 230 m west of the PI;
// green light is the CARP's distance before the time over the PI at the run-in ground speed; 20 jumpers in 2 doors at 1 s
// need 10 a door but 500 m past the PI holds 8, so 2 passes (16 and 4) 8 minutes apart with red light 7 s and 1 s after green,
// and a warning says why; the time warnings are 20, 10, 6, 1 minutes and 30 seconds before green; with forecast winds the
// drift equals the DZSO sheet's own maths for the same levels (the DZSO maths is loaded for it); the map shows the CARP and
// the green-to-red line; text, KML and forDz carry the CARP; no page errors.
// Run from the repo root: node tests/flight_drop_smoke.mjs   (needs the playwright package and Chromium)
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
  const inv = G.inverse(x.pi, x.carp), n = inv.m * Math.cos(inv.b1 * Math.PI / 180), e = inv.m * Math.sin(inv.b1 * Math.PI / 180);
  return { x, n, e, tot: R.t[2], gs: R.legs[1].gs }; });

/* no wind */
let d = await drop();
ok(near(d.x.drift, 0, 1e-9) && near(d.n, 0, 1) && near(d.e, -230, 1) && near(d.x.along, 230, 1), "no wind: CARP 230 m back along the run-in (" + Math.round(d.e) + " m east, " + Math.round(d.n) + " m north)");
ok(d.x.warn.some((w) => /forward throw only/.test(w)), "and the plan says it is forward throw only");

/* a set wind from 360 at 10 kt */
await p.selectOption("#fl-wm", "man"); await p.waitForSelector("#fl-wd");
await p.fill("#fl-wd", "360"); await p.dispatchEvent("#fl-wd", "change"); await p.fill("#fl-wk", "10"); await p.dispatchEvent("#fl-wk", "change"); await p.waitForTimeout(100);
d = await drop();
ok(near(d.x.drift, 375, 1e-6), "drift D = K x A x V = 3 x 12.5 x 10 = " + d.x.drift + " m");
ok(near(d.n, 375, 2) && near(d.e, -230, 2), "CARP 375 m north (upwind) and 230 m west of the PI (" + Math.round(d.n) + " N, " + Math.round(d.e) + " E)");
ok(near(d.x.green, d.tot - d.x.along / (d.gs * 0.514444) * 1000, 1) && d.x.green < d.tot, "green light = time over the PI less the CARP distance at " + Math.round(d.gs) + " kt GS");
ok(d.x.passes.length === 2 && d.x.passes[0].jumpers === 16 && d.x.passes[1].jumpers === 4 && d.x.fit === 8 && near(d.x.room, 500, 1e-6), "20 jumpers, 2 doors: 8 a door fit in 500 m, so passes of 16 and 4");
ok(near(d.x.passes[0].red - d.x.passes[0].green, 7000, 1) && near(d.x.passes[1].red - d.x.passes[1].green, 1000, 1) && near(d.x.passes[1].green - d.x.passes[0].green, 8 * 60000, 1), "red light 7 s and 1 s after green, passes 8 min apart");
ok(d.x.warn.some((w) => /10 jumpers a door need .* this DZ has 500 m, so 8 a door fit and it takes 2 passes/.test(w)), "the plan says why it takes 2 passes");
ok(d.x.calls.map((c) => Math.round((d.x.green - c.t) / 1000)).join() === "1200,600,360,60,30", "time warnings 20, 10, 6, 1 min and 30 s before green");
const ui = await p.textContent("#fl-card");
ok(/CARP/.test(ui) && /Green light/.test(ui) && /Time warning/.test(ui) && /not the aircrew's computed air release point/.test(ui), "panel shows CARP, passes and time warnings with the caveat");
await p.waitForTimeout(200);
ok((await p.evaluate(() => [...document.querySelectorAll(".leaflet-flpane-pane .flcarp")].map((x) => x.textContent).join())) === "CARP", "map shows the CARP");
const ex = await p.evaluate(() => { const F = window.OSAP_FLIGHT, s = F.state().plan; return { t: F.text(s), k: F.kml(s) }; });
ok(/CARP 47P/.test(ex.t) && /Pass 2: 4 jumpers/.test(ex.t) && /20 minutes/.test(ex.t) && /<name>CARP DZ<\/name>/.test(ex.k), "text and KML carry the CARP, passes and calls");

/* forecast winds: the drift is the DZSO sheet's own maths */
await p.selectOption("#fl-wm", "fc"); await p.waitForSelector('[data-fl="wx"]'); await p.click('[data-fl="wx"]');
await p.waitForFunction(() => { const s = window.OSAP_FLIGHT.state().plan; return s.wx && s.wx.dz && s.wx.dz.length === 1; }, null, { timeout: 15000 });
d = await drop();
const ref = await p.evaluate(() => { const C = window.OSAP_DZSO.core, lv = [10, 80, 120, 180].map((m) => ({ h: m, kt: 6 + m / 20, dir: 350 })).concat([[925, 800], [850, 1500], [700, 3000]].map((x) => ({ h: x[1] - 20, kt: 25, dir: 300 })));
  const w = C.meanWind(lv, 1250 * 0.3048); return { w, D: C.drift(3, 1250, Math.round(w.kt * 10) / 10) }; });
ok(!!d.x.wind && near(d.x.wind.dir, Math.round(ref.w.dir), 0.5) && near(d.x.drift, ref.D, 0.5), "forecast drift " + Math.round(d.x.drift) + " m from mean wind " + Math.round(d.x.wind.dir) + "/" + d.x.wind.kt + " = the DZSO sheet's maths (" + Math.round(ref.D) + " m)");
const fd = await p.evaluate(() => { const s = window.OSAP_FLIGHT.state().plan; s.pts[2].dzId = "dzflighttest"; window.OSAP_FLIGHT.load(s); return window.OSAP_FLIGHT.forDz("dzflighttest"); });
ok(fd && Array.isArray(fd.carp) && /^2026-10-29T01:59/.test(fd.green) && fd.passes === 2, "forDz gives the DZSO sheet the CARP, green light and passes " + JSON.stringify({ carp: fd && fd.carp, green: fd && fd.green }));
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
