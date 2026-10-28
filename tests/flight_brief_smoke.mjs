// Headless check of the jumpmaster brief in the flight planner (assets/osap-flight.js): one printed page a DZ. A freefall plan
// on a saved drop zone (window.OSAP_DZ) whose DZSO sheet has comms filled in and a 13 kt wind limit, with forecast winds read.
// Checks: the Jumpmaster brief button exports through OSAP_PDF with its own title; the page holds the timeline (take-off,
// 20-minute warning, green and red light, landing), the HARP grid, the winds level by level and on the ground, the light and
// moon at the DZ, the DZSO comms and the forecast ground wind checked against the limit (within at 13 kt, over at 5 kt); the
// PDF is exactly one page on A4 and on US Letter; a plan with two DZs gives two pages; the plan's own Export PDF prints the
// plan alone (it printed the whole page behind it before); no page errors.
// Run from the repo root: node tests/flight_brief_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
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
const PLAN = { acft: "c130h", kt: 300, drop: 130, range: 2000, altFt: 12500, cruiseFt: 8000, timeMode: "tot", t: T, dzLen: 1000, dzWid: 400, wind: "none",
  jump: { type: "ff", K: 0, ft: 300, total: 8, doors: 1, ei: 1, gap: 8, open: 4000, cdr: 5, cfs: 20, cm: "fly" },
  pts: [{ role: "dep", name: "A", lat: 14.9, lon: 100.0 }, { role: "ip", name: "", lat: 14.9, lon: 100.5 }, { role: "dz", name: "Z", lat: 14.9, lon: 100.6, dzId: "dzbrief1" }, { role: "land", name: "B", lat: 14.9, lon: 101.2 }] };

const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 } });
const errors = [];
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
  const u = r.request().url();
  if (/api\.open-meteo\.com\/v1\/forecast/.test(u) && /hPa/.test(u)) return r.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(meteo(u)) });
  r.abort();
});
await ctx.addInitScript(() => { try { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("osap-home", "map");
  localStorage.setItem("osap-dz", JSON.stringify([{ id: "dzbrief1", name: "Brief", cc: "th", pi: [14.9, 100.6], axis: 90, len_m: 1000, wid_m: 400, shape: "rect", alt_ft: 12500,
    fields: { cs_ac: "REACH 21", cs_dz: "ANVIL", g2a: "255.0", code: "Letter A", abort: "Red smoke" } }]));
  localStorage.setItem("osap-dzso", JSON.stringify({ prof: "mff", wind: 13, gust: 18, K: 0, vis: 5 })); } } catch (e) {} });
const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TSAP && window.OSAP_FLIGHT_GO && window.OSAP_PDF, null, { timeout: 60000 }); await p.waitForTimeout(1500);
await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
await p.evaluate(() => window.OSAP_FLIGHT_GO({}));
await p.waitForFunction(() => window.OSAP_FLIGHT && window.OSAP_FLIGHT.isOpen(), null, { timeout: 15000 });
await p.evaluate((plan) => window.OSAP_FLIGHT.load(plan), PLAN);
await p.selectOption("#fl-wm", "fc"); await p.waitForSelector('[data-fl="wx"]'); await p.click('[data-fl="wx"]');
await p.waitForFunction(() => { const s = window.OSAP_FLIGHT.state().plan; return s.wx && s.wx.dz && s.wx.dz.length === 1; }, null, { timeout: 15000 });
await p.evaluate(() => { window.__pdfHold = (info) => new Promise((r) => { window.__pdfInfo = { title: info.title }; window.__pdfRelease = r; }); });

async function pages(name) {
  const out = [];
  for (const format of ["A4", "Letter"]) {
    await p.emulateMedia({ media: "print" });
    const buf = await p.pdf({ format, printBackground: true });
    await p.emulateMedia({ media: null });
    if (process.env.SHOT) await writeFile(process.env.SHOT + "/" + name + "-" + format + ".pdf", buf);
    out.push((buf.toString("latin1").match(/\/Type\s*\/Page(?![a-z])/g) || []).length);
  }
  return out;
}
await p.click('[data-fl="brief"]');
await p.waitForFunction(() => window.__pdfInfo, null, { timeout: 15000 });
ok((await p.evaluate(() => window.__pdfInfo.title)) === "Jumpmaster brief: Flight plan" || /^Jumpmaster brief: /.test(await p.evaluate(() => window.__pdfInfo.title)), "the button exports a PDF titled Jumpmaster brief");
const t = await p.evaluate(() => document.querySelector(".pdfx-root").innerText);
ok(/A take-off/.test(t) && /20 minutes warning/.test(t) && /Green light, pass 1 \(8\)/.test(t) && /Red light, pass 1/.test(t) && /B landing/.test(t), "timeline: take-off, warnings, green and red light, landing");
ok(/HARP\s*47P/.test(t) && /Opening\s*4000 ft AGL/.test(t) && /12500 ft \(exit\)/.test(t) && /Ground \(10 m\), forecast\s*350° 7 kt/.test(t), "release point, opening and winds level by level and on the ground");
ok(/At green light\s*(day|dark|civil twilight|nautical twilight)/.test(t) && /Sunset/.test(t) && /Moon\s*\d+% lit/.test(t) && /Moon(rise|set)/.test(t), "light and moon at the DZ");
ok(/Aircraft call sign\s*REACH 21/.test(t) && /No-drop signal\s*Red smoke/.test(t) && /Surface wind\s*13 kt, gust 18 kt/.test(t) && /Forecast against it\s*within \(7 kt\)/.test(t), "DZSO comms and limits, forecast ground wind within the 13 kt limit");
let n = await pages("brief1");
ok(n[0] === 1 && n[1] === 1, "one page on A4 and on Letter (" + n.join(", ") + ")");
await p.evaluate(() => window.__pdfRelease()); await p.waitForTimeout(200);

/* a lower limit: over it */
await p.evaluate(() => { localStorage.setItem("osap-dzso", JSON.stringify({ prof: "mff", wind: 5, gust: 5, K: 0, vis: 5 })); window.__pdfInfo = null; });
const t2 = await p.evaluate(() => window.OSAP_FLIGHT.brief(window.OSAP_FLIGHT.state().plan));
ok(/over the limit \(7 kt\)/.test(t2), "a 5 kt limit shows the forecast over it");

/* two DZs: two pages */
await p.evaluate(() => { const s = window.OSAP_FLIGHT.state().plan; s.pts.splice(3, 0, { role: "ip", name: "", lat: 14.9, lon: 100.8 }, { role: "dz", name: "Y", lat: 14.9, lon: 100.9 }); window.OSAP_FLIGHT.load(s); window.__pdfInfo = null; });
await p.click('[data-fl="brief"]'); await p.waitForFunction(() => window.__pdfInfo, null, { timeout: 15000 });
n = await pages("brief2");
ok(n[0] === 2 && n[1] === 2 && (await p.evaluate(() => document.querySelectorAll(".pdfx-root .flbr").length)) === 2, "two DZs: a page each (" + n.join(", ") + ")");
await p.evaluate(() => window.__pdfRelease());
/* the plan's own Export PDF prints the plan alone, not the page behind it */
await p.evaluate(() => { window.__pdfInfo = null; }); await p.click('[data-fl="pdf"]'); await p.waitForFunction(() => window.__pdfInfo, null, { timeout: 15000 });
const t3 = await p.evaluate(() => document.querySelector(".pdfx-root").innerText);
await p.emulateMedia({ media: "print" });
const vis = await p.evaluate(() => [...document.body.children].filter((e) => e.id !== "pdfx-sheet" && e.getClientRects().length && getComputedStyle(e).display !== "none").length);
await p.emulateMedia({ media: null });
ok(/Total \d+ nm/.test(t3) && vis === 0, "Export PDF prints the plan on its own sheet (" + vis + " other page parts showing)");
await p.evaluate(() => window.__pdfRelease());
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
