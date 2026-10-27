// Headless check that the list beside the map names what is on the map in the Route tab (index.html rvSofItems, rvRouteItem,
// rvPointItems; assets/osap-route.js OSAP_ROUTETAB.summary): the planned route is ONE item (name, length, time) whose
// waypoints fold open inside it by kind and MGRS, saved points are listed by name with "Saved point" and their MGRS, and no
// row reads the old generic "Map item". The router is mocked (a straight line). Run from the repo root:
// node tests/rv_mapitems_smoke.mjs (needs playwright + Chromium; OUT=dir saves screenshots)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const OUT = process.env.OUT || "";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
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

const WPS = [[14.80, 100.70], [14.90, 100.65]];
const PTS = [{ id: "p1", n: "WING 2", lat: 14.905, lon: 100.66, cc: "th", t: Date.now() }, { id: "p2", n: "Tadia DZ", lat: 14.82, lon: 100.75, cc: "th", t: Date.now() },
  { id: "p3", n: "Elsewhere", lat: 1.3, lon: 103.8, cc: "sg", t: Date.now() }];
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1600, height: 900 } });
const errors = [];
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
  const u = r.request().url();
  if (/routing\.openstreetmap\.de/.test(u)) {
    const cs = decodeURIComponent(u.split("/driving/")[1].split("?")[0]).split(";").map((x) => x.split(",").map(Number));
    const m = 12000 * (cs.length - 1);
    return r.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ code: "Ok", routes: [{ distance: m, duration: m / 20, geometry: { coordinates: cs }, legs: cs.slice(1).map(() => ({ distance: 12000, duration: 600, steps: [] })) }] }) });
  }
  r.abort();
});
await ctx.addInitScript((pts) => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("asap-rv-mode", "split"); localStorage.setItem("osap-atak-pts", JSON.stringify(pts)); } catch (e) {} }, PTS);
const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TSAP && window.FW && window.FW.map && document.querySelector('[data-atk="route"]'), null, { timeout: 60000 }); await p.waitForTimeout(2500);
await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
await p.evaluate((w) => window.OSAP_ROUTE_SEED(w), WPS);
await p.waitForFunction(() => window.OSAP_ROUTETAB && window.OSAP_ROUTETAB.state().routes === 1, null, { timeout: 30000 });
await p.evaluate(() => window.FW.map.fitBounds([[14.78, 100.6], [14.95, 100.8]], { animate: false }));
await p.waitForTimeout(800);
const list = () => p.evaluate(() => ({ n: document.getElementById("rv-n").textContent, cards: Array.prototype.map.call(document.querySelectorAll("#rv-list .rvcard"), (c) => ({ id: c.getAttribute("data-rv"), cls: c.className, t: c.textContent })) }));
let L1 = await list();
const route = L1.cards.filter((c) => /rvroute/.test(c.cls));
ok(route.length === 1, "the route is one item (" + route.length + ")");
ok(route[0] && /^Route · 12(\.0)? km · \d+ min/.test(route[0].t) && /A to B/.test(route[0].t), "the route item has its name, length and time: " + (route[0] && route[0].t));
ok(!L1.cards.some((c) => /^rt:\d+$/.test(c.id)), "waypoints are not separate items while the route is folded");
ok(!L1.cards.some((c) => /Map item/.test(c.t)), "no row reads \"Map item\"");
const pts = L1.cards.filter((c) => /^pt:/.test(c.id));
ok(pts.length === 2 && pts.every((c) => /^Saved point · \d+[A-Z] [A-Z]{2} \d+ \d+/.test(c.t)), "the two saved points in this country are listed with \"Saved point\" and MGRS");
ok(pts.some((c) => /WING 2/.test(c.t)) && pts.some((c) => /Tadia DZ/.test(c.t)) && !L1.cards.some((c) => /Elsewhere/.test(c.t)), "saved points are named; another country's point is left out");
ok(/^3 map items in this map area/.test(L1.n), "the count is the route plus the points: " + L1.n);
if (OUT) await p.screenshot({ path: OUT + "/rv-mapitems-folded.png" });

/* the route's item folds its waypoints open, each by kind and MGRS */
await p.click('#rv-list [data-rv="rt:route"]'); await p.waitForTimeout(400);
L1 = await list();
const stops = L1.cards.filter((c) => /rvstop/.test(c.cls));
ok(stops.length === 2 && /Start point · \d+[A-Z] /.test(stops[0].t) && /^Start point.*A$/.test(stops[0].t) && /Release point.*B$/.test(stops[1].t), "opened, the route shows its start and release point by name and MGRS: " + stops.map((s) => s.t).join(" | "));
ok(await p.evaluate(() => document.querySelector('#rv-list [data-rv="rt:route"]').getAttribute("aria-expanded") === "true"), "the route item says it is open");
if (OUT) await p.screenshot({ path: OUT + "/rv-mapitems-open.png" });

/* a waypoint and a saved point open their own popups */
await p.click('#rv-list [data-rv="rt:1"]'); await p.waitForTimeout(500);
ok(await p.evaluate(() => { const h = document.querySelector(".leaflet-popup h3"); return !!h && /^B/.test(h.textContent); }), "a waypoint opens its popup");
await p.evaluate(() => window.FW.map.closePopup());
await p.click('#rv-list [data-rv="pt:p1"]'); await p.waitForTimeout(500);
ok(await p.evaluate(() => { const b = document.querySelector(".leaflet-popup .atk-ptpop b"); return !!b && b.textContent === "WING 2"; }), "a saved point opens its own popup");
await p.evaluate(() => window.FW.map.closePopup());

/* the list follows the route: a third waypoint shows in the route, still one item */
await p.evaluate(() => window.OSAP_ROUTE_SEED([[14.80, 100.70], [14.85, 100.72], [14.90, 100.65]]));
await p.waitForFunction(() => window.OSAP_ROUTETAB.state().wps.length === 3 && window.OSAP_ROUTETAB.state().routes === 1, null, { timeout: 30000 });
await p.evaluate(() => window.FW.map.fitBounds([[14.78, 100.6], [14.95, 100.8]], { animate: false }));
await p.waitForTimeout(800);
L1 = await list();
ok(L1.cards.filter((c) => /rvroute/.test(c.cls)).length === 1 && L1.cards.filter((c) => /rvstop/.test(c.cls)).length === 3 && L1.cards.some((c) => /^Waypoint · /.test(c.t)), "after a change the route is still one item, now with 3 waypoints");

/* Clear: the route's item goes away */
await p.evaluate(() => document.querySelector('[data-rt="clear"]').click()); await p.waitForTimeout(600);
L1 = await list();
ok(!L1.cards.some((c) => /rvroute|rvstop/.test(c.cls)) && L1.cards.filter((c) => /^pt:/.test(c.id)).length === 2, "after Clear only the saved points are listed");
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
