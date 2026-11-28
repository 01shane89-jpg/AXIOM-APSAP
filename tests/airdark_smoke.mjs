// Headless check of aircraft gone quiet mid-flight (rules airdark-v1, tools/airdark_lib.mjs): in Map overlays > Live aircraft,
// "Aircraft gone quiet mid-flight" is off and fetches nothing until switched on; on, it reads dark.json (fixture, as on the
// live-air branch), counts the events, draws the hot-spot boxes, a marker per event with its flight and a dashed line, lists
// them, a row takes the map there and opens its pop-up (or the Details panel the page moves pop-ups into) that gives the gap, the caveats and no registration; works on a phone.
// Run from the repo root: node tests/airdark_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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

const nowS = Math.round(Date.now() / 1000);
const DARK = { schema: "osap-airdark/1", rules: "airdark-v1", built: new Date((nowS - 60) * 1000).toISOString(),
  boxes: [{ id: "gulf", name: "Persian Gulf, Iraq and Iran", bbox: [43, 23, 63, 38] }, { id: "baltic", name: "Baltic Sea and Kaliningrad", bbox: [12, 53.5, 30, 60.5] }],
  thresholds: {}, reasons: ["transponder switched off or set to stop broadcasting position", "transponder failure"],
  sources: [{ id: "fi", name: "adsb.fi", site: "https://adsb.fi/", licence: "adsb.fi open data terms", nc: true, track: "https://globe.adsb.fi/?icao={hex}" }],
  watching: 3,
  events: [
    { k: "quiet", hex: "73a001", cs: "IRA123", type: "B738", desc: null, mil: false, lat: 32.0, lon: 52.5, alt: 30000, gs: 420, trk: 90, sqk: "1000", last_t: nowS - 1500, t: nowS - 900,
      box: "gulf", field_nm: 80, misses: 4, dr: [32.0, 55.4], trail: [[nowS - 2700, 32, 51.5, 30000], [nowS - 2100, 32, 52, 30000], [nowS - 1500, 32, 52.5, 30000]], src: 0 },
    { k: "quiet", hex: "48c0de", cs: "LOT7", type: "E195", mil: false, lat: 55.5, lon: 19.5, alt: 34000, gs: 440, trk: 45, last_t: nowS - 7200, t: nowS - 6600,
      box: "baltic", field_nm: 40, misses: 3, dr: [56.2, 21.0], trail: [[nowS - 8400, 55, 18.5, 34000], [nowS - 7200, 55.5, 19.5, 34000]], src: 0,
      back: { t: nowS - 5400, lat: 56.4, lon: 21.6, alt: 33000, gap_min: 30, nm: 85 } },
  ] };
let fetched = 0;
async function open(opts, on) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [];
  await ctx.route(/live-air\/dark\.json/, (r) => { fetched++; r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DARK) }); });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)(?!raw\.githubusercontent\.com\/.*\/live-air\/dark\.json)/, (r) => r.abort());
  await ctx.addInitScript((on) => { try { localStorage.setItem("osap-home", "map"); if (on) localStorage.setItem("osap-airdark", JSON.stringify({ on: true })); } catch (e) {} }, on);
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_AIRDARK && document.getElementById("ml-airdark"), null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(400);
  return { ctx, p, errors };
}
const layers = (p) => p.evaluate(() => { const c = {}; const g = window.OSAP_AIRDARK.layer(); if (g && window.__asapMap.hasLayer(g)) g.eachLayer((l) => { c[l.ad] = (c[l.ad] || 0) + 1; }); return c; });

// off by default: nothing fetched, nothing drawn
{
  fetched = 0;
  const { ctx, p, errors } = await open({ viewport: { width: 1360, height: 860 } }, false);
  ok(fetched === 0 && !(await p.evaluate(() => window.OSAP_AIRDARK.on())), "off by default: dark.json not fetched");
  await p.evaluate(() => window.OSAP_ATAK.overlays("overlays")); await p.waitForTimeout(600);
  await p.evaluate(() => { const c = document.querySelector('#ml-airdark [data-airdark="on"]'); c.click(); }); await p.waitForTimeout(1200);
  ok(fetched === 1 && (await p.evaluate(() => window.OSAP_AIRDARK.on() && JSON.parse(localStorage.getItem("osap-airdark")).on === true)), "switching on loads the file and is remembered");
  ok(errors.length === 0, "off/on: no page errors " + errors.join(" | "));
  await ctx.close();
}
for (const [name, opts] of [["desktop", { viewport: { width: 1360, height: 860 } }], ["phone", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
  const { ctx, p, errors } = await open(opts, true);
  await p.evaluate(() => window.OSAP_ATAK.overlays("overlays")); await p.waitForTimeout(1000);
  const st = await p.evaluate(() => document.getElementById("ad-st").textContent);
  ok(/1<\/b>|\b1 gone quiet/.test(st) && /1 heard again/.test(st) && /3 being watched/.test(st) && !/Stale/.test(st), name + ": status counts the events: " + st);
  const c = await layers(p);
  ok(c.box === 2 && c.quiet === 1 && c.back === 1 && c.trail === 2 && c.dr === 1 && c.gap === 1, name + ": boxes, markers, flights and dashed lines drawn " + JSON.stringify(c));
  const rows = await p.evaluate(() => [...document.querySelectorAll("#ad-list [data-adgo]")].map((b) => b.textContent));
  ok(rows.length === 2 && /Quiet since/.test(rows[0]) && /IRA123/.test(rows[0]) && /Back after 30 min/.test(rows[1]) && /LOT7/.test(rows[1]), name + ": list: " + JSON.stringify(rows));
  if (name === "phone") {
    const b = await p.evaluate(() => { const e = document.querySelector("#ad-list [data-adgo]"), r = e.getBoundingClientRect(); return { h: r.height, inside: r.right <= innerWidth + 1 }; });
    ok(b.h >= 44 && b.inside, "phone: rows tappable and inside the screen " + JSON.stringify(b));
  }
  await p.evaluate(() => window.__asapMap.setView([0, 0], 3, { animate: false }));
  await p.evaluate(() => document.querySelector('#ad-list [data-adhex="73a001"]').click()); await p.waitForTimeout(700);
  ok(await p.evaluate(() => { const c = window.__asapMap.getCenter(); return Math.abs(c.lat - 32) < 0.3 && Math.abs(c.lng - 52.5) < 0.3; }), name + ": a row takes the map there");
  const pop = await p.evaluate(() => { const e = document.querySelector(".leaflet-popup .adpop, #rv-pkg .adpop"); return e ? e.textContent.replace(/\s+/g, " ") : ""; });
  ok(/Gone quiet mid-flight: IRA123/.test(pop) && /Not heard for 25 min by 4 sweeps/.test(pop) && /dead reckoning/.test(pop) && /not proof|None of them is proof/.test(pop) && /Track on adsb\.fi/.test(pop) && /airdark-v1/.test(pop) && /80 nm from the nearest airfield/.test(pop), name + ": pop-up gives the gap, the guess and the caveats (" + pop.slice(0, 160) + ")");
  ok(!/registration/i.test(pop.replace(/Registrations are not shown/i, "")), name + ": no registration in the pop-up");
  if (OUT) await p.screenshot({ path: OUT + "/airdark-" + name + ".png" });
  await p.evaluate(() => window.OSAP_AIRDARK.set(false)); await p.waitForTimeout(300);
  ok(Object.keys(await layers(p)).length === 0, name + ": switching off clears the map");
  ok(errors.length === 0, name + ": no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
