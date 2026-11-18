// Headless check of military flight patterns and emergency squawks (rules milpat-v1, tools/milpat_lib.mjs): in Map overlays >
// Live aircraft, an aircraft flying an orbit (drones.json fixture, as on the live-drones branch) gets a dashed ring, a pop-up
// that names the shape and says it is not a mission, and a row in "Flying an orbit or racetrack now"; All air traffic lists
// the sweep's emergency squawks (index.json fixture) and a row takes the map there; works on a phone.
// Run from the repo root: node tests/milpat_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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


const NOW = Date.now(), nowS = Math.round(NOW / 1000);
const ring = Array.from({ length: 28 }, (_, i) => { const a = (i / 28) * 4 * Math.PI; return [34.2 + 0.18 * Math.cos(a), -95.4 + 0.22 * Math.sin(a), NOW - (27 - i) * 120e3]; });
const DR = { schema: "osap-live-air/1", built: new Date(NOW - 60e3).toISOString(), note: "test",
  sources: { lol: { name: "adsb.lol", site: "https://adsb.lol/", licence: "ODbL 1.0", nc: false, track: "https://globe.adsb.lol/?icao={hex}" } },
  status: [{ src: "adsb.lol", q: "military", ok: true, n: 2 }], drones: 0, military: 2, nopos: [],
  ac: [{ hex: "ae01ce", cs: "SHINR40", reg: "64-14845", t: "R135", desc: "Boeing RC-135V Rivet Joint", lat: ring[27][0], lon: ring[27][1], alt: 29000, gs: 320, trk: 90, pos_ms: NOW - 60e3, src: "lol", tr: ring,
    pat: { k: "orbit", rules: "milpat-v1", turn: 718, min: 54, km: 22, c: [34.2, -95.4], role: "reconnaissance or surveillance type" } },
    { hex: "ae1234", cs: "RCH123", t: "C17", lat: 13.5, lon: 100.9, alt: 28000, gs: 420, trk: 300, pos_ms: NOW - 60e3, src: "lol", tr: [[13.4, 100.8, NOW - 180e3], [13.5, 100.9, NOW - 60e3]] }] };
const F = ["hex", "cs", "reg", "t", "desc", "lat", "lon", "alt", "gs", "trk", "pos", "src", "sqk", "cat", "fl"];
const INDEX = { schema: "osap-air-traffic/1", built: new Date(NOW - 60e3).toISOString(), sweep: 7, took_s: 290, cell: 10, f: F,
  sources: [{ id: "lol", name: "adsb.lol", site: "https://adsb.lol/", licence: "ODbL 1.0", nc: false, track: "https://globe.adsb.lol/?icao={hex}" }],
  status: [], asked: 400, unasked: 0, total: 9123, cells: {}, circ: [], emerg_rules: "milpat-v1",
  emerg: [["880999", "THA1", "HS-TKA", "B77W", null, 13.8, 100.4, 9000, 250, 10, nowS - 30, 0, "7700", "A5", 0], ["4ca123", "RYR1", null, "B738", null, 50.1, 8.6, 12000, 300, 10, nowS - 60, 0, "7600", "A3", 0]] };

async function open(opts) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [];
  await ctx.route(/live-drones\/drones\.json/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DR) }));
  await ctx.route(/live-air\//, (r) => /index\.json$/.test(r.request().url()) ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(INDEX) }) : r.fulfill({ status: 404, body: "" }));
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)(?!raw\.githubusercontent\.com\/.*\/live-(air|drones)\/)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("osap-air", JSON.stringify({ uav: false, mil: true })); localStorage.setItem("osap-traffic", JSON.stringify({ air: true })); } catch (e) {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_AIR && window.OSAP_TRAFFIC && document.getElementById("ml-air"), null, { timeout: 60000 });
  await p.waitForTimeout(3000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(400);
  return { ctx, p, errors };
}
const om = (p) => p.evaluate(() => window.OSAP_ATAK.overlays("overlays"));
for (const [name, opts] of [["desktop", { viewport: { width: 1360, height: 860 } }], ["phone", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
  const { ctx, p, errors } = await open(opts);
  await om(p); await p.waitForTimeout(800);
  const st = await p.evaluate(() => document.getElementById("air-st").textContent);
  ok(/1 flying an orbit or racetrack now/.test(st), name + ": status counts the orbiting aircraft: " + st.slice(0, 200));
  ok(await p.evaluate(() => /Flying an orbit or racetrack now/.test(document.getElementById("air-list").textContent) && document.querySelectorAll('#air-list .airorb [data-airgo="ae01ce"]').length === 1 && !document.querySelector('#air-list [data-airgo="ae1234"]')), name + ": orbit list has the RC-135 and not the C-17 in transit");
  ok(await p.evaluate(() => { let n = 0; window.__asapMap.eachLayer((l) => { if (l.orbit === "ae01ce") n++; }); return n === 1; }), name + ": a dashed ring is drawn around the orbit");
  const pop = await p.evaluate(() => { let h = ""; window.__asapMap.eachLayer((l) => { if (l.getPopup && l.getPopup() && /SHINR40/.test(String(l.getPopup().getContent()))) h = l.getPopup().getContent(); }); return h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "); });
  ok(/Flying an orbit or racetrack/.test(pop) && /turned 718° clockwise in 54 min/.test(pop) && /within 22 km/.test(pop) && /R135 is a reconnaissance or surveillance type/.test(pop) && /not a mission/.test(pop) && /milpat-v1/.test(pop), name + ": pop-up names the shape, the type's role and says not a mission (" + pop.slice(0, 120) + ")");
  const em = await p.evaluate(() => (document.getElementById("tra-em") || {}).textContent || "");
  ok(/Emergency squawks now \(2\)/.test(em) && /THA1 · B77W · 7700 \(emergency\)/.test(em) && /7600 \(radio failure\)/.test(em) && /not confirmed/.test(em), name + ": emergency squawk list from the sweep: " + em.slice(0, 160));
  if (name === "phone") {
    const b = await p.evaluate(() => { const e = document.querySelector("#tra-em [data-trgo]"), r = e.getBoundingClientRect(); return { h: r.height, inside: r.right <= innerWidth + 1 }; });
    ok(b.h >= 44 && b.inside, "phone: emergency rows tappable and inside the screen " + JSON.stringify(b));
  }
  await p.evaluate(() => window.__asapMap.setView([0, 0], 3, { animate: false }));
  await p.evaluate(() => document.querySelector("#tra-em [data-trgo]").click()); await p.waitForTimeout(500);
  ok(await p.evaluate(() => { const c = window.__asapMap.getCenter(); return Math.abs(c.lat - 13.8) < 0.3 && Math.abs(c.lng - 100.4) < 0.3; }), name + ": an emergency row takes the map there");
  if (OUT) await p.screenshot({ path: OUT + "/milpat-" + name + ".png" });
  ok(errors.length === 0, name + ": no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
