// Rain radar sources (assets/osap-weather.js NAT_RADAR, 2026-11-07): the free app shows RainViewer and, when RainViewer does
// not answer, falls back to the national weather-service radar networks; the sold version (assets/osap-sold.js) never asks
// RainViewer and always shows the national networks. Every outside request is answered by the test (no network). Writes nothing.
// Run from the repo root: node tests/radar_backup_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp" };
const root = process.cwd(), SOLD_JS = readFileSync("assets/osap-sold.js", "utf8");
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
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const RVJ = { version: "2.0", generated: Math.floor(Date.now() / 1000), host: "https://tilecache.rainviewer.com",
  radar: { past: Array.from({ length: 13 }, (_, i) => ({ time: Math.floor(Date.now() / 600000) * 600 - (12 - i) * 600, path: "/v2/radar/f" + i })), nowcast: [] }, satellite: { infrared: [] } };
const JMAT = [{ basetime: "20261107144500", validtime: "20261107144500", elements: ["hrpns", "hrpns_nd"] }];
const NAT = /geo\.weather\.gc\.ca|nowcoast\.noaa\.gov\/geoserver\/observations\/weather_radar|maps\.dwd\.de|openwms\.fmi\.fi|geoservices\.knmi\.nl|jma\.go\.jp\/bosai\/jmatile\/data\/nowc\/\d/;

async function run(sold, rvUp, view) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1300, height: 850 } });
  const rv = [], nat = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const url = r.request().url(), h = new URL(url).host;
    if (/rainviewer\.com/.test(h)) { rv.push(url); if (!rvUp) return r.fulfill({ status: 503, body: "down" }); }
    if (h === "api.rainviewer.com") return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(RVJ) });
    if (/targetTimes_N1\.json$/.test(url)) return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(JMAT) });
    if (NAT.test(url)) nat.push(url);
    if (/\.png|GetMap|request=GetMap/i.test(url)) return r.fulfill({ status: 200, contentType: "image/png", body: PNG });
    return r.abort();
  });
  const js = SOLD_JS.replace("window.OSAP_SOLD = false;", "window.OSAP_SOLD = " + sold + ";");
  await ctx.route("**/assets/osap-sold.js", (r) => r.fulfill({ contentType: "text/javascript", body: js }));
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.OSAP_WX && window.__asapMap, null, { timeout: 60000 });
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  await p.evaluate((v) => window.__asapMap.setView(v[0], v[1], { animate: false }), view);
  await p.click('[data-atk="weather"]');
  await p.waitForSelector('#ml-wx input[data-wxl="radar"]', { state: "attached", timeout: 30000 });
  await p.evaluate(() => { const c = document.querySelector('#ml-wx input[data-wxl="radar"]'); if (!c.checked) c.click(); });
  await p.waitForFunction(() => /Radar frame|National radar/.test((document.getElementById("wxn-radar") || {}).textContent || ""), null, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(2500);
  const note = await p.evaluate(() => (document.getElementById("wxn-radar") || {}).textContent || "");
  const lic = await p.evaluate(() => { const r = document.querySelector('[data-wxrow="radar"] .wxlic'); return r ? r.textContent : ""; });
  await ctx.close();
  return { rv, nat, note, lic, errors };
}

const US = [[39, -95], 5], DE = [[51, 10], 6], JP = [[36, 138], 6];
const a = await run(false, true, US);
ok(a.rv.some((u) => /tilecache/.test(u)) && /Radar frame/.test(a.note), "free app, RainViewer up: RainViewer tiles drawn (" + a.rv.length + " requests; note: " + a.note + ")");
ok(a.nat.length === 0, "free app, RainViewer up: national networks not asked (" + a.nat.length + ")");
const b = await run(false, false, DE);
ok(/National radar networks/.test(b.note) && /did not answer/.test(b.note), "free app, RainViewer down: national networks stand in, and the note says why (" + b.note + ")");
ok(b.nat.some((u) => /maps\.dwd\.de/.test(u)), "free app, RainViewer down, over Germany: DWD radar asked (" + b.nat.filter((u) => /dwd/.test(u)).length + ")");
ok(!b.errors.length, "free app, RainViewer down: no page errors " + b.errors.slice(0, 2).join(" | "));
const c = await run(true, true, US);
ok(c.rv.length === 0, "sold app: RainViewer never asked (" + c.rv.length + ")");
ok(c.nat.some((u) => /geo\.weather\.gc\.ca/.test(u)), "sold app over North America: ECCC GeoMet radar asked (" + c.nat.filter((u) => /gc\.ca/.test(u)).length + ")");
ok(!c.nat.some((u) => /maps\.dwd\.de|openwms\.fmi\.fi|knmi/.test(u)), "sold app over North America: the European networks are not asked outside their area");
ok(/National radar networks/.test(c.note) && /ECCC/.test(c.lic) && !/RainViewer/.test(c.lic), "sold app: note and licence name the national networks, not RainViewer (" + c.lic + ")");
const d = await run(true, true, JP);
ok(d.nat.some((u) => /jmatile\/data\/nowc\/20261107144500\/none\/20261107144500\/surf\/hrpns\//.test(u)), "sold app over Japan: JMA nowcast tiles of the newest base time asked (" + d.nat.length + ")");
ok(!c.errors.length && !d.errors.length, "sold app: no page errors " + c.errors.concat(d.errors).slice(0, 2).join(" | "));
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
