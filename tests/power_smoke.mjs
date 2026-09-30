// Headless check of the power grid section (assets/osap-power.js): its switches sit in Map overlays (Infrastructure); lines, substations
// and plants load from OpenStreetMap (Overpass, answered here by a fixture) only when switched on and zoomed in, 200 kV and up at
// region zoom and everything close in, coloured by voltage with a map legend; a busy server is reported, not hidden; the WRI plants
// already in a country's reference data show at any zoom; outage headlines come from the news pool; classic layout on a phone.
// Run from the repo root: node tests/power_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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
const settle = (p, ms = 3500) => p.waitForTimeout(ms);
const shown = (p, s) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && getComputedStyle(e).display !== "none" && e.getClientRects().length > 0; }, s);

// a small grid near Bangkok: one 500 kV, one 230 kV and one 115 kV line, a cable, two substations and two plants
const FIX = { elements: [
  { type: "way", id: 1, tags: { power: "line", voltage: "500000;230000", name: "Test 500" }, geometry: [{ lat: 13.70, lon: 100.40 }, { lat: 13.80, lon: 100.60 }] },
  { type: "way", id: 2, tags: { power: "line", voltage: "230000" }, geometry: [{ lat: 13.72, lon: 100.45 }, { lat: 13.78, lon: 100.55 }] },
  { type: "way", id: 3, tags: { power: "line", voltage: "115000" }, geometry: [{ lat: 13.74, lon: 100.47 }, { lat: 13.76, lon: 100.52 }] },
  { type: "way", id: 4, tags: { power: "cable", voltage: "230000" }, geometry: [{ lat: 13.73, lon: 100.50 }, { lat: 13.75, lon: 100.56 }] },
  { type: "node", id: 5, lat: 13.75, lon: 100.50, tags: { power: "substation", voltage: "230000", name: "Test sub <b>x</b>" } },
  { type: "way", id: 6, center: { lat: 13.76, lon: 100.53 }, tags: { power: "substation" } },
  { type: "way", id: 7, center: { lat: 13.71, lon: 100.49 }, tags: { power: "plant", name: "Big plant", "plant:output:electricity": "1,200 MW" } },
  { type: "way", id: 8, center: { lat: 13.77, lon: 100.51 }, tags: { power: "plant", name: "Rooftop", "plant:output:electricity": "2 MW" } }
] };
async function open(opts, hash = "", overpass = "ok") {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [], queries = [];
  await ctx.route(/overpass/, async (r) => {
    queries.push(decodeURIComponent((r.request().postData() || "").replace(/^data=/, "").replace(/\+/g, " ")));
    if (overpass === "busy") return r.fulfill({ status: 429, body: "busy" });
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FIX) });
  });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)(?!.*overpass)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + hash, { waitUntil: "domcontentloaded" }); await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_POWER, null, { timeout: 60000 }); await settle(p);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(400);
  return { ctx, p, errors, queries };
}
const grid = (p) => p.evaluate(() => {
  const pp = document.querySelector(".leaflet-pwrpt-pane"), st = window.OSAP_POWER.state();
  return { st, paths: st.drawn.lines, subs: pp ? pp.querySelectorAll(".pwr-sub").length : 0, plants: st.drawn.points + st.drawn.wri - (pp ? pp.querySelectorAll(".pwr-sub").length : 0),
    legend: /Power grid · voltage/.test(document.body.innerHTML) };
});
const om = async (p, want) => {
  if (await shown(p, "#atk-om") === want) return;
  await p.evaluate((w) => { if (w) window.OSAP_ATAK.overlays("overlays"); else document.querySelector('#atk-om [data-om="x"]').click(); }, want); await p.waitForTimeout(300);
};
// ---------- pure helpers ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1360, height: 860 } });
  const u = await p.evaluate(() => { const P = window.OSAP_POWER; return {
    kv: [P.kv({ voltage: "400000;220000" }), P.kv({ voltage: "" }), P.kv({ voltage: "33000" })],
    mw: [P.mw({ "plant:output:electricity": "1,200 MW" }), P.mw({ "plant:output:electricity": "1.5 GW" }), P.mw({ "plant:output:electricity": "yes" })],
    band: [P.band(765).l, P.band(230).l, P.band(null).l],
    out: [P.isOutage(["th", "", "Power Cuts Scheduled Across Bangkok Region Today"]), P.isOutage(["ua", "", "Drone strike hits substation in Kharkiv"]),
      P.isOutage(["ng", "", "New power plant will create jobs"]), P.isOutage(["us", "", "Election results announced"])] }; });
  ok(u.kv[0] === 400 && u.kv[1] === null && u.kv[2] === 33, "voltage: highest circuit in kV, none when not mapped " + JSON.stringify(u.kv));
  ok(u.mw[0] === 1200 && u.mw[1] === 1500 && u.mw[2] === null, "plant output in MW " + JSON.stringify(u.mw));
  ok(u.band[0] === "500 kV and up" && u.band[1] === "200 to 299 kV" && u.band[2] === "Voltage not mapped", "voltage bands");
  ok(u.out.join() === "true,true,false,false", "outage headlines: cuts and attacks on grid assets in, plant openings and other news out " + u.out.join());

  // ---------- desktop, tactical toolbar ----------
  ok(!(await p.evaluate(() => !!document.querySelector("#atk-tools [data-opwr]"))), "desktop: no toolbar button of its own");
  let g = await grid(p);
  ok(!g.st.lines && !g.st.subs && !g.st.plants && g.paths.length === 0, "desktop: everything starts off, nothing drawn");
  await om(p, true);
  ok(await shown(p, '#atk-om #pwr-sec input[data-pwr="lines"]'), "desktop: Power grid switches in the Overlays sheet");
  ok(await p.evaluate(() => { const s = document.getElementById("pwr-sec"), h = s.parentElement; return h.id === "ml-infra" ? !h.hidden : /Infrastructure/.test(s.textContent); }), "desktop: under an Infrastructure heading");
  await p.evaluate(() => { const d = document.querySelector("#pwr-sec .pwr-out"); d.open = true; }); await p.waitForTimeout(1500);
  const news = await p.evaluate(() => document.querySelector("#pwr-sec [data-pwrnews]").textContent);
  ok(/Headlines from the news pool|No outage headlines/.test(news), "desktop: outage reports read from the news pool: " + news.slice(0, 90));
  await p.evaluate(() => window.__asapMap.setView([13.75, 100.5], 6, { animate: false }));
  await p.check('#pwr-sec input[data-pwr="lines"]'); await p.waitForTimeout(1200);
  g = await grid(p);
  ok(g.paths.length === 0 && /Zoom in/.test(g.st.msg), "desktop: zoomed out, nothing fetched and a zoom-in note: " + g.st.msg);
  await p.evaluate(() => window.__asapMap.setView([13.75, 100.5], 9, { animate: false })); await p.waitForTimeout(1800);
  g = await grid(p);
  ok(g.paths.length === 4 && g.paths.includes("#c2255c") && g.paths.includes("#f08c00") && g.paths.includes("#1c7ed6"), "desktop: region zoom draws the lines coloured by voltage " + g.paths.join(" "));
  ok(g.subs === 0 && g.plants === 0, "desktop: substations and plants stay off until ticked");
  ok(g.legend, "desktop: voltage legend on the map");
  await p.check('#pwr-sec input[data-pwr="subs"]'); await p.check('#pwr-sec input[data-pwr="plants"]'); await p.waitForTimeout(1800);
  g = await grid(p);
  ok(g.subs === 2 && g.plants === 1, "desktop: region zoom shows substations and only the 100 MW+ plant (" + g.subs + " subs, " + g.plants + " plants)");
  await p.evaluate(() => window.__asapMap.setView([13.75, 100.5], 12, { animate: false }));
  await p.waitForFunction(() => / on screen\.$/.test(window.OSAP_POWER.state().msg), null, { timeout: 15000 }).catch(() => {});
  g = await grid(p);
  ok(g.plants === 2, "desktop: close in, every plant (" + g.plants + ") " + g.st.msg + " z" + await p.evaluate(() => window.__asapMap.getZoom()));
  ok(/on screen/.test(g.st.msg), "desktop: count note: " + g.st.msg);
  await om(p, false);
  { const r = await p.evaluate(() => { const b = document.querySelector(".leaflet-pwrpt-pane .pwr-sub").getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; }); await p.mouse.click(r[0], r[1]); }
  await p.waitForTimeout(500);
  const pop = await p.evaluate(() => { const x = document.querySelector(".leaflet-popup-content") || document.querySelector("#rv-pkg"); return x ? x.innerHTML : ""; });
  ok(/Substation · OpenStreetMap/.test(pop) && /Test sub/.test(pop) && !/<b>x<\/b>/.test(pop), "desktop: substation opens its details, naming OpenStreetMap and escaping tags");
  if (OUT) await p.screenshot({ path: OUT + "/power-desktop.png" });
  await om(p, true);
  await p.uncheck('#pwr-sec input[data-pwr="lines"]'); await p.uncheck('#pwr-sec input[data-pwr="subs"]'); await p.uncheck('#pwr-sec input[data-pwr="plants"]'); await p.waitForTimeout(500);
  g = await grid(p);
  ok(g.paths.length === 0 && g.subs === 0 && g.plants === 0 && !g.legend, "desktop: all off clears the map and the legend");
  ok(errors.length === 0, "desktop: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- the queries sent: 200 kV and up at region zoom, everything close in ----------
{
  const { ctx, p, errors, queries } = await open({ viewport: { width: 1360, height: 860 } });
  await p.evaluate(() => { window.__asapMap.setView([13.75, 100.5], 9, { animate: false }); window.OSAP_POWER.set("lines", true); }); await p.waitForTimeout(1500);
  await p.evaluate(() => { window.__asapMap.setView([13.75, 100.5], 12, { animate: false }); }); await p.waitForTimeout(1500);
  ok(queries.length === 2, "queries: one per view (" + queries.length + ")");
  ok(/voltage/.test(queries[0] || "") && !/substation/.test(queries[0] || ""), "queries: region zoom asks only for 200 kV+ lines");
  ok(/way\["power"="line"\];/.test(queries[1] || ""), "queries: close in asks for every line");
  await p.evaluate(() => { window.__asapMap.setView([13.75, 100.5], 9, { animate: false }); }); await p.waitForTimeout(1500);
  ok(queries.length === 2, "queries: a view seen before is drawn from memory, not asked again");
  ok(errors.length === 0, "queries: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- busy server ----------
{
  const { ctx, p, errors, queries } = await open({ viewport: { width: 1360, height: 860 } }, "", "busy");
  await p.evaluate(() => { window.__asapMap.setView([13.75, 100.5], 10, { animate: false }); window.OSAP_POWER.set("lines", true); }); await p.waitForTimeout(2000);
  const g = await grid(p);
  ok(/busy/.test(g.st.msg) && queries.length === 2, "busy: tries the second Overpass server, then says the server is busy (" + queries.length + " tries): " + g.st.msg);
  ok(errors.length === 0, "busy: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- WRI plants from the country's reference data, at any zoom ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1360, height: 860 } }, "#ng/timeline");
  const n = await p.evaluate(() => (((window.ASAP_SOF || {}).ng || {}).power || []).filter((i) => i.lat != null).length);
  await p.evaluate(() => { window.__asapMap.setZoom(5, { animate: false }); window.OSAP_POWER.set("plants", true); }); await p.waitForTimeout(800);
  const g = await grid(p);
  ok(n > 0 && g.plants === n, "Nigeria: the " + n + " WRI plants show zoomed out (" + g.plants + " drawn)");
  ok(errors.length === 0, "Nigeria: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- phone, classic controls ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await p.evaluate(() => { window.OSAP_ATAK.mode(false); if (window.OSAP_TOOLS) window.OSAP_TOOLS.fold(false); }); await p.waitForTimeout(200);
  await p.evaluate(() => document.querySelector(".mlctl .mlbtn").click()); await p.waitForTimeout(200);
  ok(await shown(p, '#pwr-sec input[data-pwr="lines"]'), "phone classic: Power grid switches in the Layers panel");
  await p.evaluate(() => window.__asapMap.setView([13.75, 100.5], 9, { animate: false }));
  await p.check('#pwr-sec input[data-pwr="lines"]'); await p.waitForTimeout(1800);
  const g = await grid(p);
  ok(g.paths.length === 4, "phone classic: lines drawn");
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
