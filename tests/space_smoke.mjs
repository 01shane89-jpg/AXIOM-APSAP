// Headless check of Check it from space (assets/osap-space.js, rules space-v1) and the Sensor picture button on Today's Story
// coverage cards (assets/osap-coverage.js). Fixtures stand in for the three outside sources (Element 84 Earth Search, NASA CMR,
// Open-Meteo) and for data/live/conflicts/sensor-links.js + sensors.js; every other outside host is blocked.
//   - Today: a card whose headline is a conflict report gets "Sensor picture"; one tap opens the Sensor picture box for that
//     report and Check it from space already filled in: the next expected passes with cloud forecast, radar marked, the rules.
//   - A card without such a headline has no button.
//   - Conflict tab: an incident with a strike report has a closed "Check it from space" line; opening it lists the passes.
//   - Only the rounded pin is sent to the outside sources. No page errors. OUT=dir saves screenshots.
// Run from the repo root: node tests/space_smoke.mjs   (playwright and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
import { knownReports } from "../tools/cf_decisions.mjs";
import { eligible } from "../tools/sensor_lib.mjs";
const OUT = process.env.OUT || "";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const readWin = async (f, k) => { const w = {}; try { new Function("window", await readFile(join(root, f), "utf8"))(w); } catch (e) {} return w[k]; };

// a conflict and one of its strike reports (eligible under sensor-v1, so the same report the sensor check looks at)
const known = knownReports();
let CID = "", REP = null;
for (const id of ["russia-ukraine", "iran-war", "israel-gaza", "myanmar", "sudan"]) {
  const r = [...(known.get(id) || new Map()).values()].filter(eligible).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (r) { CID = id; REP = r; break; }
}
if (!REP) { console.log("SKIP: no eligible strike report in the stored conflict files"); server.close(); process.exit(0); }
// a Today country with a Story coverage card, the first card's first headline standing for the report's link
const CC = "ua";
const threads = await readWin(`data/live/threads/${CC}.js`, "OSAP_THREADS"), stories = await readWin(`data/live/stories/${CC}.js`, "OSAP_STORIES");
const cards = threads && threads.threads && threads.threads.length ? threads.threads.map((t) => t.rows || []) : ((stories && stories.stories) || []).filter((s) => !s.b).map((s) => s.src || []);
if (!cards.length || !cards[0][0]) { console.log("SKIP: no Story coverage card for " + CC); server.close(); process.exit(0); }
const LINK = cards[0][0][5];
const LINKS = { schema: "osap-cf-links/1", asof: "2026-11-18 11:00Z", by: { [LINK]: [CID, REP.fp, REP.geo.la, REP.geo.lo, String(REP.date).slice(0, 16), REP.geo.p, REP.kind] } };
const SENS = { schema: "osap-cf-sensors/1", rules: "sensor-v1", asof: "2026-11-18 00:00Z", src: [], skipped: {},
  by: { [CID]: { [REP.fp]: [{ km: 2.1, h: -3.2, t: "2026-11-17T19:30", sat: "NOAA-20", frp: 9.5, conf: "n" }] } }, seis: {}, seis_rules: "seismic-v1", pic: {}, pic_rules: "picture-v1" };
// the outside sources: Sentinel-2 passes 2 and 12 days before now, radar 5 and 17 days before, cloud 20% every hour
const NOW = Date.now(), D = 864e5, t = (d) => new Date(NOW - d * D).toISOString();
const ES = { features: [{ properties: { platform: "sentinel-2c", datetime: t(2), "eo:cloud_cover": 3 } }, { properties: { platform: "sentinel-2c", datetime: t(12), "eo:cloud_cover": 50 } },
  { properties: { platform: "sentinel-2b", datetime: t(25), "eo:cloud_cover": 8 } }] };
const CMR = { feed: { entry: [{ time_start: t(5), title: "OPERA_L2_RTC-S1_T087-000001-IW1_x_y_S1C_30_v1.0" }, { time_start: t(17), title: "OPERA_L2_RTC-S1_T087-000001-IW1_x_y_S1C_30_v1.0" }] } };
const hours = []; for (let k = -24; k < 17 * 24; k++) hours.push(new Date(Math.floor(NOW / 36e5) * 36e5 + k * 36e5).toISOString().slice(0, 16));
const OM = { hourly: { time: hours, cloud_cover: hours.map(() => 20) } };

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const asked = [];
async function page(hash, home) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 950 } });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    if (u.startsWith("https://earth-search.aws.element84.com/v1/search")) { asked.push(u); return r.fulfill({ contentType: "application/json", body: JSON.stringify(ES), headers: { "access-control-allow-origin": "*" } }); }
    if (u.startsWith("https://cmr.earthdata.nasa.gov/search/granules.json")) { asked.push(u); return r.fulfill({ contentType: "application/json", body: JSON.stringify(CMR), headers: { "access-control-allow-origin": "*" } }); }
    if (u.startsWith("https://api.open-meteo.com/v1/forecast")) { asked.push(u); return r.fulfill({ contentType: "application/json", body: JSON.stringify(OM), headers: { "access-control-allow-origin": "*" } }); }
    return r.abort();
  });
  await ctx.route(/data\/live\/conflicts\/sensor-links\.js/, (r) => r.fulfill({ contentType: "text/javascript", body: "window.OSAP_CF_LINKS=" + JSON.stringify(LINKS) + ";" }));
  await ctx.route(/data\/live\/conflicts\/sensors\.js/, (r) => r.fulfill({ contentType: "text/javascript", body: "window.OSAP_CF_SENSORS=" + JSON.stringify(SENS) + ";" }));
  await ctx.addInitScript((h) => { try { localStorage.setItem("osap-home", h); localStorage.setItem("asap-period", JSON.stringify({ p: "all" })); } catch (e) {} }, home);
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + hash, { waitUntil: "domcontentloaded" });
  return { p, ctx, errors };
}

// ---------- Today > Story coverage ----------
{
  const { p, ctx, errors } = await page("#" + CC + "/timeline", "today");
  await p.waitForFunction(() => window.OSAP_TODAY && window.OSAP_COVERAGEQ && window.TSAP, null, { timeout: 60000 });
  await p.evaluate(() => { if (!window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.show(); });
  await p.waitForFunction(() => document.querySelector("#td-cover .cvlist > li [data-cvsp]"), null, { timeout: 40000 }).catch(() => {});
  const btns = await p.evaluate(() => [...document.querySelectorAll("#td-cover .cvlist > li")].map((li) => !!li.querySelector("[data-cvsp]")));
  ok(btns[0] === true, "the card carrying the strike report has a Sensor picture button");
  ok(btns.length > 1 && btns.slice(1).every((b) => !b), "cards without one have no button (" + btns.length + " cards)");
  await p.click("#td-cover .cvlist > li [data-cvsp]");
  await p.waitForFunction(() => document.querySelector("#td-cover .cvspbox .ospx[open] .ospbody .ospl"), null, { timeout: 20000 }).catch(() => {});
  const box = await p.evaluate(() => { const b = document.querySelector("#td-cover .cvspbox"); return b ? { text: b.textContent, html: b.innerHTML } : null; });
  ok(box && /Sensor picture, may relate/i.test(box.text) && /Satellite heat nearby, may relate \(1\)/.test(box.text), "one tap shows the conflict tab's Sensor picture box for the report");
  ok(box && /1 strike report in the .+ tab/.test(box.text) && /Open the .+ tab/.test(box.text), "it names the conflict tab and offers to open it");
  ok(box && /Next expected passes over the pin/.test(box.text) && /Sentinel-2C/.test(box.text) && /20%/.test(box.text), "Check it from space is filled in: the next Sentinel-2 pass with its cloud forecast");
  ok(box && /Sentinel-1C T087/.test(box.text) && /radar, cloud does not matter/.test(box.text), "the radar pass is listed and needs no cloud");
  ok(box && /Already passed since the report/.test(box.text) || /No Sentinel pass over the pin is listed since the report yet/.test(box && box.text), "it says what passed since the report");
  ok(box && /space-v1/.test(box.html) && /not a picture of the event/.test(box.text) && /none confirms a report/.test(box.text), "rules named; never a confirmation");
  const wide = await p.evaluate(() => { const b = document.querySelector("#td-cover .cvspbox"); return b ? b.scrollWidth - b.clientWidth : 0; });
  ok(wide <= 2, "the box fits its card (" + wide + " px over)");
  if (OUT) { await p.locator("#td-cover .cvspbox").scrollIntoViewIfNeeded(); await p.locator("#td-cover .cvlist > li").first().screenshot({ path: OUT + "/space-today.png" }); }
  // a phone
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(400);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(over <= 1, "on a 390 px phone nothing scrolls sideways (" + over + ")");
  if (OUT) { await p.locator("#td-cover .cvspbox").scrollIntoViewIfNeeded(); await p.screenshot({ path: OUT + "/space-phone.png" }); }
  // the button closes the box again
  await p.click("#td-cover .cvlist > li [data-cvsp]");
  ok(await p.evaluate(() => !document.querySelector("#td-cover .cvspbox")), "a second tap closes it");
  ok(!errors.length, "Today: no page errors " + JSON.stringify(errors.slice(0, 3)));
  await ctx.close();
}
ok(asked.length >= 3 && asked.every((u) => !/\d\.\d{4,}/.test(u.replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, ""))), "only the pin rounded to 3 decimals is sent (" + asked.length + " requests)");

// ---------- the conflict tab ----------
{
  const c0 = ((await readWin("data/live/conflicts/index.js", "OSAP_CONFLICTS")).conflicts.find((c) => c.id === CID) || { countries: [CC] }).countries[0];
  const { p, ctx, errors } = await page("#" + c0 + "/timeline", "map");
  await p.waitForFunction(() => window.TSAP && window.OSAP_CONFLICT_TABS && window.OSAP_CONFLICTS && window.OSAP_SPACE, null, { timeout: 60000 });
  await p.waitForTimeout(1200);
  await p.evaluate(([id, c]) => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); window.OSAP_CONFLICT_TABS.open(id, c); }, [CID, c0]);
  await p.waitForFunction(() => document.querySelector("#cf-list ol.cfl"), null, { timeout: 60000 });
  await p.evaluate(() => { const s = document.querySelector('#cf-rail select[data-cff="days"]'); if (!s) return; const o = [...s.options].pop(); s.value = o.value; s.dispatchEvent(new Event("change", { bubbles: true })); });
  await p.waitForTimeout(800);
  const k = await p.evaluate((fp) => (document.getElementById("cf-list")._groups || []).findIndex((g) => g.all.some((x) => x.fp === fp)), REP.fp);
  const sel = '#cf-list li[data-k="' + k + '"] details.ospx';
  const has = k >= 0 && await p.evaluate((s) => { const d = document.querySelector(s); return d ? { open: d.open, sum: d.querySelector("summary").textContent } : null; }, sel);
  ok(has && !has.open && /Check it from space: next Sentinel passes/.test(has.sum), "the strike incident has a closed Check it from space line" + (k < 0 ? " (report not listed)" : ""));
  const n0 = asked.length;
  if (has) {
    await p.click(sel + " > summary");
    await p.waitForFunction((s) => document.querySelector(s + " .ospbody .ospl"), sel, { timeout: 20000 }).catch(() => {});
    const txt = await p.evaluate((s) => document.querySelector(s).textContent, sel);
    ok(/Sentinel-2C/.test(txt) && /Sentinel-1C/.test(txt) && /Newest imagery here/.test(txt) && /Satellite before\/after here/.test(txt), "opening it lists the passes and the imagery buttons");
    ok(asked.length > n0, "the sources are asked only when the line is opened");
    if (OUT) { await p.locator(sel).scrollIntoViewIfNeeded(); await p.locator(sel).screenshot({ path: OUT + "/space-cf.png" }); }
  }
  const noStrike = await p.evaluate(() => { const gs = document.getElementById("cf-list")._groups || []; const k = gs.findIndex((g) => g.all.every((x) => ["talks", "legal", "statement", "humanitarian"].includes(x.kind)));
    const e = k < 0 ? null : document.querySelector('#cf-list li[data-k="' + k + '"]'); return e ? !e.querySelector("details.ospx") : null; });
  ok(noStrike !== false, "an incident of talks or statements has no Check it from space" + (noStrike === null ? " (none listed)" : ""));
  ok(!errors.length, "conflict tab: no page errors " + JSON.stringify(errors.slice(0, 3)));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
