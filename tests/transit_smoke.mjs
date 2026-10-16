// Headless check of the live public transport layer (assets/osap-transit.js): "Buses, trams, trains and ferries (live)" sits in
// Map overlays > Public transport right after Ships; nothing is fetched while off; vehicles come from the live-transit cell
// files (fixture), only the cells on screen; kinds filter; the pop-up gives route, age, MGRS, agency and licence; feed text
// is escaped; stale vehicles are left out; zoomed out to the world it asks to zoom in; a failing feed is reported, not hidden;
// the layer's pane shows on conflict tabs.
// Run from the repo root: node tests/transit_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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

const now = Math.round(Date.now() / 1000), built = new Date().toISOString();
const F = ["s", "id", "lat", "lon", "brg", "spd", "ts", "rid", "rt", "rn", "k", "col", "st"];
const V = [
  [0, "Bus 4021", 13.75, 100.5, 90, 32, now - 60, "R12", "12", "Central - Airport", "b", "FF0000", 2],
  [0, "Tram 7", 13.76, 100.52, null, null, now - 120, "T1", "T1", null, "t", null, 1],
  [1, "Ferry Chao Phraya", 13.74, 100.49, 180, 15, now - 30, "F1", "Orange flag", null, "f", null, null],
  [1, "<img src=x onerror=window.__xss=1>", 13.72, 100.55, 0, 0, now - 40, "X9", null, null, "r", null, null],
  [0, "Old bus", 13.7, 100.51, null, null, now - 3600, "R12", "12", null, "b", null, null], // an hour old: left out
  [1, "No time", 13.71, 100.53, null, null, null, "Z", null, null, "o", null, null]];
const INDEX = { schema: "osap-transit/1", built, cell: 5, f: F,
  sources: [{ id: "mdb-1", name: "Bangkok Mass Transit", feed: "Vehicles", cc: "TH", place: "Bangkok", licence: "CC BY 4.0", licence_url: "https://creativecommons.org/licenses/by/4.0/", nc: false, catalog: "https://mobilitydatabase.org/feeds/gtfs_rt/mdb-1" },
    { id: "mdb-2", name: "River Boats <b>Co</b>", feed: "", cc: "TH", place: "", licence: "agency open data terms (licence not stated in the catalog)", licence_url: "", nc: false, catalog: "javascript:alert(1)" }],
  status: { "mdb-1": [4, ""], "mdb-2": [3, ""] }, feeds_ok: 2, feeds_failed: 0, carried: 0, total: 54321, cells: { "10_100": V.length, "50_0": 4 } };

async function open(opts, mode = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [], hits = [];
  await ctx.route(/raw\.githubusercontent\.com\/.*\/live-transit\//, (r) => {
    const u = r.request().url(); hits.push(u);
    if (mode.down) return r.fulfill({ status: 404, body: "404: Not Found" });
    if (/index\.json$/.test(u)) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(INDEX) });
    if (/v\/10_100\.json$/.test(u)) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schema: "osap-transit-cell/1", built, cell: "10_100", v: V }) });
    return r.fulfill({ status: 404, body: "" });
  });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)(?!raw\.githubusercontent\.com\/.*\/live-transit\/)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_TRANSIT && document.getElementById("ml-transit"), null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(400);
  return { ctx, p, errors, hits };
}
const n = (p) => p.evaluate(() => window.OSAP_TRANSIT.layer().getLayers().length);
const om = (p) => p.evaluate(() => window.OSAP_ATAK.overlays("overlays"));
const popWhere = (p, test) => p.evaluate((t) => {
  const re = new RegExp(t);
  for (const m of window.OSAP_TRANSIT.layer().getLayers()) { const c = m.getPopup().getContent(), h = typeof c === "function" ? c(m) : c; if (re.test(h)) return h; }
  return ""; }, test);

// ---------- desktop ----------
{
  const { ctx, p, errors, hits } = await open({ viewport: { width: 1360, height: 860 } });
  await om(p); await p.waitForTimeout(400);
  ok(await shown(p, '#atk-om #ml-transit input[data-trn="on"]'), "desktop: switch in Overlays > Public transport");
  ok(await p.evaluate(() => { const s = document.getElementById("ml-sea"); return !!s && s.nextElementSibling && s.nextElementSibling.id === "ml-transit"; }), "desktop: Public transport sits right after Ships");
  ok(hits.length === 0, "desktop: nothing fetched while off (" + hits.length + ")");
  await p.evaluate(() => window.__asapMap.setView([13.74, 100.52], 13, { animate: false }));
  await p.check('#ml-transit input[data-trn="on"]'); await p.waitForTimeout(1500);
  ok(hits.some((u) => /index\.json$/.test(u)) && hits.some((u) => /v\/10_100\.json$/.test(u)) && !hits.some((u) => /50_0/.test(u)), "desktop: reads the index and only the cell on screen " + hits.map((u) => u.replace(/.*live-transit\//, "")).join(","));
  ok((await n(p)) === 5, "desktop: five vehicles drawn (the hour-old one left out): " + (await n(p)));
  const st = await p.evaluate(() => document.getElementById("trn-st").textContent);
  ok(/54,321 vehicles from 2 agency feeds/.test(st) && /5 on screen/.test(st), "desktop: status line: " + st);
  const cov = await p.evaluate(() => document.getElementById("trn-cov").textContent);
  ok(/Thailand 7/.test(cov), "desktop: coverage line names the country and count: " + cov);
  ok(await p.evaluate(() => /Public transport \(live\)/.test(document.querySelector(".leaflet-control-container").innerHTML)), "desktop: legend on the map");
  let pop = await popWhere(p, "Bus 4021");
  ok(/Bus 12/.test(pop) && /Central - Airport/.test(pop) && /32 km\/h/.test(pop) && /heading 090°/.test(pop) && /MGRS/.test(pop) && /Bangkok Mass Transit/.test(pop) &&
    /creativecommons\.org\/licenses\/by\/4\.0/.test(pop) && /mobilitydatabase\.org\/feeds\/gtfs_rt\/mdb-1/.test(pop) && /min ago|under a minute/.test(pop) && /on the way to stop/.test(pop),
    "desktop: bus pop-up: route, speed, heading, MGRS, age, agency, licence link and feed record");
  pop = await popWhere(p, "Ferry Chao Phraya");
  ok(/Ferry Orange flag/.test(pop) && /River Boats &lt;b&gt;Co/.test(pop) && !/javascript:/.test(pop) && /licence not stated/.test(pop), "desktop: ferry pop-up escapes agency text, drops a non-https link, says licence not stated");
  pop = await popWhere(p, "onerror");
  ok(/&lt;img/.test(pop) && !/<img/.test(pop) && /Route ID X9/.test(pop), "desktop: vehicle label escaped; unnamed route shown by its ID");
  pop = await popWhere(p, "No time");
  ok(/time not given by the feed/.test(pop), "desktop: a vehicle with no time says so");
  await p.uncheck('#ml-transit input[data-trnk="b"]'); await p.waitForTimeout(300);
  ok((await n(p)) === 4, "desktop: unticking Buses hides the bus");
  await p.check('#ml-transit input[data-trnk="b"]');
  // a real click opens the pop-up and fills the fingerprint
  pop = await p.evaluate(() => { const m = window.OSAP_TRANSIT.layer().getLayers()[0]; m.openPopup(); return new Promise((r) => setTimeout(() => {
    const x = document.querySelector(".leaflet-popup-content") || document.querySelector("#rv-pkg"); r(x ? x.innerHTML : ""); }, 600)); });
  ok(/Record fingerprint (<[^>]+>)?[0-9a-f]{16}/.test(pop), "desktop: opened pop-up carries a record fingerprint " + (pop.match(/Record fingerprint.{0,80}/) || [""])[0]);
  if (OUT) { await p.evaluate(() => window.__asapMap.closePopup()); await p.screenshot({ path: OUT + "/transit-desktop.png" }); }
  await p.evaluate(() => window.__asapMap.setView([10, 100], 2, { animate: false })); await p.waitForTimeout(1200);
  ok((await n(p)) === 0 && /Zoom in to see them/.test(await p.evaluate(() => document.getElementById("trn-st").textContent)), "desktop: zoomed out to the world, asks to zoom in");
  await p.uncheck('#ml-transit input[data-trn="on"]'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => !/Public transport \(live\)/.test(document.querySelector(".leaflet-control-container").innerHTML)), "desktop: switching off clears the legend");
  ok(!(await p.evaluate(() => window.__xss)), "desktop: no injected script ran");
  ok(errors.length === 0, "desktop: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- feed down ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1360, height: 860 } }, { down: true });
  await p.evaluate(() => window.__asapMap.setView([13.74, 100.52], 12, { animate: false })); await om(p);
  await p.check('#ml-transit input[data-trn="on"]'); await p.waitForTimeout(1500);
  const t = await p.evaluate(() => document.getElementById("trn-st").textContent);
  ok(/Could not load the live public transport files \(HTTP 404/.test(t), "down: says it could not load: " + t);
  ok(errors.length === 0, "down: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- conflict tabs keep the layer visible ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1360, height: 860 } });
  const vis = await p.evaluate(() => { document.documentElement.setAttribute("data-cf", "x"); const e = window.__asapMap.getPane("transitpane"); const v = e && getComputedStyle(e).visibility; document.documentElement.removeAttribute("data-cf"); return v; });
  ok(vis === "visible", "conflict tabs: transit pane not hidden (" + vis + ")");
  ok(errors.length === 0, "conflict: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- phone ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await p.evaluate(() => window.__asapMap.setView([13.74, 100.52], 13, { animate: false })); await om(p); await p.waitForTimeout(400);
  ok(await shown(p, '#ml-transit input[data-trn="on"]'), "phone: switch reachable in Overlays");
  await p.check('#ml-transit input[data-trn="on"]'); await p.waitForTimeout(1500);
  ok((await n(p)) === 5, "phone: vehicles draw (" + (await n(p)) + ")");
  if (OUT) await p.screenshot({ path: OUT + "/transit-phone-panel.png" });
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
