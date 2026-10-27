// Headless check that data sets ticked in Data sets show on a conflict tab, and that the weather legend follows the flood layers.
// Shane 2026-10-27 (Haiti, Haiti gang war tab, 90 d): Border, Insurgency and History of violence ticked, nothing on the map;
// and the Weather legend (Flooding now, Flood history) stayed on the map with both flood rows unticked.
// Causes: assets/osap-conflicts.js hid every map pane but its own list while a conflict tab was open, which took in tlpane, where
// every data set draws; Data sets > History of violence (assets/osap-cf-history.js) never drew while a conflict tab was open; and
// Clear map switched the flood layers off without the weather legend hearing of it (index.html setFlood, assets/osap-weather.js).
// Checks:
//   1. on a conflict tab with nothing ticked, the panes the data sets use draw nothing (Haiti, Thailand's Deep South, Ukraine)
//   2. Insurgency ticked on the Haiti gang war tab draws visible marks; History of violence ticked in Data sets draws too, and
//      steps aside when the tab's own History of violence is switched on (no double drawing)
//   3. the flood legend goes with Clear map, with an untick, and when a flood layer is switched from outside the list
//   4. the open data set's name pressed again leaves it, and its "not on the map" note goes after Clear map or an untick
// Run from the repo root: node tests/cf_datasets_smoke.mjs   (needs the playwright package and Chromium)
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
// the panes the data sets draw in, which now stay shown on a conflict tab
const DS_PANES = ["tlpane", "evlbl", "overlay", "provpane", "floodpane", "rainpane", "expopane", "infrapane", "vhpane"];

async function page(cc) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem("cfds")) { localStorage.clear(); localStorage.setItem("osap-home", "map"); sessionStorage.setItem("cfds", "1"); } } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#" + cc + "/timeline", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_DATASETS && window.OSAP_DISASTERX && document.querySelector("#ml-ds input"), null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  return { ctx, p, errors };
}
// visible marks per pane: drawn canvas pixels, and shown marker icons or pictures, counted only while the pane is visible
const drawn = (p) => p.evaluate((names) => {
  const out = {};
  names.forEach((n) => {
    const pane = document.querySelector("#map .leaflet-" + n + "-pane");
    if (!pane) { out[n] = { vis: null, px: 0, el: 0 }; return; }
    let px = 0;
    pane.querySelectorAll("canvas").forEach((c) => { if (!c.width || !c.height) return; const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) px++; });
    const el = [...pane.querySelectorAll(".leaflet-marker-icon, img.leaflet-tile-loaded, path")].filter((e) => e.getBoundingClientRect().width > 0).length;
    out[n] = { vis: getComputedStyle(pane).visibility === "visible" && getComputedStyle(pane).display !== "none", px, el };
  });
  return out;
}, DS_PANES);
const openCf = async (p, id) => {
  await p.evaluate((id) => document.querySelector('#view-seg [data-view="cf-' + id + '"]').click(), id);
  await p.waitForFunction(() => document.documentElement.getAttribute("data-cf") && document.querySelector("#cf-rail input[type=checkbox]"), null, { timeout: 20000 });
  await p.waitForTimeout(1500);
  // as in Shane's screenshot: none of the tab's own map layers on
  await p.evaluate(() => { for (let k = 0, i; k < 30 && (i = document.querySelector("#cf-rail input[type=checkbox]:checked")); k++) i.click(); });
  await p.waitForTimeout(1500);
};
const period = (p, label) => p.evaluate((label) => { const b = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === label); if (b) b.click(); }, label);
const tick = (p, sel, on) => p.evaluate(([sel, on]) => { const i = document.querySelector("#ml-ds " + sel); if (i && i.checked !== on) i.click(); return !!i; }, [sel, on]);

// ---------- 1 and 2: Haiti gang war ----------
{
  const { ctx, p, errors } = await page("ht");
  await openCf(p, "haiti"); await period(p, "90 d"); await p.waitForTimeout(1500);
  let d = await drawn(p);
  ok(DS_PANES.every((n) => !d[n].px && !d[n].el), "Haiti gang war, nothing ticked: the data set panes draw nothing " + JSON.stringify(d));
  ok(await tick(p, 'input[data-ds="insurgency"]', true), "Haiti: Data sets has an Insurgency row");
  await p.waitForTimeout(2500);
  d = await drawn(p);
  ok(d.tlpane.vis && d.tlpane.px > 0, "Insurgency ticked on the conflict tab shows on the map (tlpane visible, " + d.tlpane.px + " px)");
  ok(await tick(p, 'input[data-dsx="vh"]', true), "Haiti: Data sets has a History of violence row");
  await period(p, "All"); await p.waitForTimeout(4000);
  d = await drawn(p);
  ok(d.vhpane.vis && d.vhpane.px > 0, "History of violence ticked in Data sets draws on the conflict tab (" + d.vhpane.px + " px)");
  // the tab's own History of violence switched on: the Data sets copy steps aside, the tab's copy draws
  await p.evaluate(() => { const i = document.querySelector('#cf-rail input[data-cfh="on"]'); if (i && !i.checked) i.click(); });
  await p.waitForTimeout(4000);
  d = await drawn(p);
  const cf = await p.evaluate(() => { let n = 0; document.querySelectorAll("#map .leaflet-cfpane-pane canvas").forEach((c) => { if (!c.width) return; const a = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < a.length; i += 4) if (a[i]) n++; }); return n; });
  ok(!d.vhpane.px && cf > 0, "with the tab's own History of violence on, only the tab's copy draws (vhpane " + d.vhpane.px + " px, cfpane " + cf + " px)");
  await p.evaluate(() => { const i = document.querySelector('#cf-rail input[data-cfh="on"]'); if (i && i.checked) i.click(); });
  await p.waitForTimeout(3000);
  d = await drawn(p);
  ok(d.vhpane.px > 0, "and the Data sets copy comes back when the tab's own is switched off (" + d.vhpane.px + " px)");
  ok(!errors.length, "Haiti: no page errors " + errors.slice(0, 3).join(" | "));
  await ctx.close();
}

// ---------- 1: other conflict tabs, nothing ticked ----------
for (const [cc, id] of [["th", "thailand-deep-south"], ["ua", "russia-ukraine"]]) {
  const { ctx, p, errors } = await page(cc);
  const has = await p.evaluate((id) => !!document.querySelector('#view-seg [data-view="cf-' + id + '"]'), id);
  if (!has) { ok(false, cc + ": conflict tab cf-" + id + " is listed"); await ctx.close(); continue; }
  await openCf(p, id); await period(p, "All"); await p.waitForTimeout(2000);
  const d = await drawn(p);
  ok(DS_PANES.every((n) => !d[n].px && !d[n].el), "cf-" + id + ", nothing ticked: the data set panes draw nothing " + JSON.stringify(d));
  ok(!errors.length, cc + ": no page errors " + errors.slice(0, 3).join(" | "));
  await ctx.close();
}

// ---------- 3: the flood legend follows the flood layers ----------
{
  const { ctx, p, errors } = await page("ht");
  const legend = () => p.evaluate(() => { const l = document.querySelector(".wxlegend"); return l ? l.textContent : ""; });
  const flood = (on) => p.evaluate((on) => ["now", "hist"].forEach((k) => { const i = document.querySelector('#ml-ds input[data-fx="' + k + '"]'); if (i && i.checked !== on) i.click(); }), on);
  await flood(true); await p.waitForTimeout(500);
  ok(/Flooding now/.test(await legend()) && /Flood history/.test(await legend()), "flood rows ticked: the weather legend lists Flooding now and Flood history");
  await flood(false); await p.waitForTimeout(500);
  ok(!/Flood/.test(await legend()), "flood rows unticked: the flood legend goes");
  await flood(true); await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelector('#ml-ds [data-dsall="0"]').click()); await p.waitForTimeout(500);
  const after = await p.evaluate(() => ({ dx: window.OSAP_DISASTERX.list().filter((x) => x.on).map((x) => x.id), ticks: [...document.querySelectorAll("#ml-ds input[data-fx]:checked")].map((i) => i.dataset.fx), mirror: [...document.querySelectorAll('#ml-wx input[data-wxl="fnow"]:checked, #ml-wx input[data-wxl="fhist"]:checked')].length }));
  ok(!after.dx.length && !after.ticks.length, "Clear map switches the flood layers and their ticks off " + JSON.stringify(after));
  ok(!/Flood/.test(await legend()), "Clear map: the flood legend goes too (it stayed before)");
  // the Weather panel's flood rows switch the same layers, and the legend follows
  await p.evaluate(() => window.OSAP_DISASTERX.set("now", true)); await p.waitForTimeout(500);
  ok(/Flooding now/.test(await legend()), "a flood layer switched on from outside the Data sets list shows in the legend");
  ok(await p.evaluate(() => !!(document.querySelector('#ml-ds input[data-fx="now"]') || {}).checked), "and its Data sets tick follows");
  await p.evaluate(() => window.OSAP_DISASTERX.set("now", false)); await p.waitForTimeout(500);
  ok(!/Flood/.test(await legend()), "switched off from outside: the legend goes");
  ok(!errors.length, "legend: no page errors " + errors.slice(0, 3).join(" | "));
  await ctx.close();
}

// ---------- 4: an open data set can be left, and its "not on the map" note goes once answered ----------
// Shane 2026-10-27 (Utah, Earthquakes and hazards): the box unticked, the row stayed chosen, and the note stayed after Clear map
{
  const { ctx, p, errors } = await page("ht");
  const hint = () => p.evaluate(() => { const h = document.querySelector(".dshint"); return h && !h.hidden ? h.textContent : ""; });
  const view = () => p.evaluate(() => document.documentElement.getAttribute("data-view"));
  const openRow = async (id) => { await p.evaluate((id) => document.querySelector('#ml-ds [data-dsopen="' + id + '"]').click(), id); await p.waitForTimeout(1500); };
  await openRow("hazards");
  ok(await view() === "hazards", "Earthquakes and hazards opens from its name");
  ok(/not on the map/.test(await hint()), "opened with its box unticked: the note offers Show on map");
  // something else on the map, so Clear map has work to do (it is disabled on an empty map)
  await tick(p, 'input[data-ds="news"]', true); await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelector('#ml-ds [data-dsall="0"]').click()); await p.waitForTimeout(500);
  ok(!(await hint()), "Clear map: the note goes and stays gone");
  await p.evaluate(() => document.querySelector('#ml-ds [data-dsall="1"]').click()); await p.waitForTimeout(1500);
  ok(await tick(p, 'input[data-ds="hazards"]', false), "its box can be unticked");
  await p.waitForTimeout(500);
  ok(!(await hint()), "unticked by hand: no note asking to put it back");
  await openRow("hazards");
  ok(await view() === "timeline", "its name pressed again leaves it: back to All reports");
  ok(await p.evaluate(() => document.querySelector('#ml-ds [data-dsopen="hazards"]').getAttribute("aria-pressed")) === "false", "and its row is no longer shown as chosen");
  await tick(p, 'input[data-ds="news"]', false); await p.waitForTimeout(300);
  await openRow("news");
  ok(/is not on the map/.test(await hint()), "another tab opened with its box unticked still gets the note (" + (await hint()) + ", view " + (await view()) + ")");
  ok(!errors.length, "open/leave: no page errors " + errors.slice(0, 3).join(" | "));
  await ctx.close();
}

await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
