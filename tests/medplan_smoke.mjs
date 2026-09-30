// Headless check of the Medical plan (assets/osap-medplan.js) opened from Draw area on the map toolbar, on a desktop and a
// phone. OpenStreetMap (Overpass), OSRM and Open-Meteo are answered by fixed test data here, so the check is the same every
// run; tools/probe_medplan.sh checks the real hosts. Checks: the menu offers Medical plan only once an area is drawn; the plan
// lists hospitals sorted by road drive time with MGRS grids, emergency and helipad flags; a clinic named after a doctor is
// withheld; phone numbers never appear; helipads and airfields are listed; "Use as HLZ" fills the HLZ field, which is kept on
// the device; a typed CCP can be the start point; weather flags come from the rules; the map shows numbered marks that go
// when the plan closes; Print prints only the plan; a failed OpenStreetMap lookup says so and offers Try again; and nothing
// in the plan carries the "AI generated" tag.
// Run from the repo root: node tests/medplan_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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

/* a small made-up neighbourhood round 13.75 N, 100.50 E */
const C0 = [13.75, 100.5];
const OSM = { osm3s: { timestamp_osm_base: "2026-09-30T06:00:00Z" }, elements: [
  { type: "node", id: 1, lat: 13.80, lon: 100.50, tags: { amenity: "hospital", name: "Far North Hospital", emergency: "yes", beds: "300", phone: "+66 2 123 4567" } },
  { type: "way", id: 2, center: { lat: 13.76, lon: 100.51 }, tags: { amenity: "hospital", healthcare: "hospital", name: "Near Hospital", "operator:type": "public", "contact:phone": "+66 2 999 0000" } },
  { type: "node", id: 3, lat: 13.7605, lon: 100.5102, tags: { aeroway: "helipad" } },
  { type: "node", id: 4, lat: 13.74, lon: 100.49, tags: { amenity: "clinic", name: "Dr Somchai Clinic" } },
  { type: "node", id: 5, lat: 13.745, lon: 100.505, tags: { amenity: "clinic", name: "Community Health Centre 7" } },
  { type: "node", id: 6, lat: 13.748, lon: 100.502, tags: { amenity: "clinic", healthcare: "dentist", name: "Smile Dental" } },
  { type: "node", id: 7, lat: 13.91, lon: 100.60, tags: { aeroway: "aerodrome", name: "Test Airfield", icao: "VTXX", iata: "TXX" } },
  { type: "node", id: 8, lat: 13.70, lon: 100.45, tags: { aeroway: "helipad", name: "Riverside Pad" } },
  { type: "node", id: 9, lat: 13.71, lon: 100.46, tags: { aeroway: "helipad", disused: "yes" } }
] };
/* sources=0; destinations in the order the plan asks: hospitals nearest first (Near, Far North), then clinics. Far North is
   given the shorter drive so the sort by drive time shows. */
function osrm(url) {
  const n = new URL(url).pathname.split("/").pop().split(";").length - 1;
  const secs = [null, 1500, 600, 300, 400, 500, 600], dists = [0, 9000, 6000, 2000, 3000, 4000, 5000];
  return { code: "Ok", durations: [[0].concat(Array.from({ length: n }, (_, i) => secs[i + 1] ?? 700))], distances: [[0].concat(Array.from({ length: n }, (_, i) => dists[i + 1] ?? 7000))] };
}
function meteo() {
  const days = ["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"], ht = [], vis = [], g = [], lc = [], pr = [], at = [];
  days.forEach((d) => { for (let h = 0; h < 24; h++) { ht.push(d + "T" + String(h).padStart(2, "0") + ":00"); vis.push(d === "2026-10-01" && h === 5 ? 800 : 20000); g.push(10); lc.push(d === "2026-10-02" ? 95 : 20); pr.push(0); at.push(30); } });
  return { hourly: { time: ht, visibility: vis, wind_gusts_10m: g, cloud_cover_low: lc, precipitation: pr, apparent_temperature: at },
    daily: { time: days, sunrise: days.map((d) => d + "T23:00"), sunset: days.map((d) => d + "T11:10"), precipitation_sum: [10, 8, 6, 0, 25, 0], wind_gusts_10m_max: [10, 10, 10, 12, 35, 10],
      apparent_temperature_max: [33, 33, 33, 36, 40, 31], apparent_temperature_min: [24, 24, 24, 25, 25, 24] } };
}
async function open(opts, overpassFails) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [], calls = { overpass: 0, osrm: 0, meteo: 0 };
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    if (/overpass|interpreter/.test(u)) { calls.overpass++; return overpassFails ? r.fulfill({ status: 504, body: "" }) : r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(OSM) }); }
    if (/\/table\/v1\//.test(u)) { calls.osrm++; return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(osrm(u)) }); }
    if (/api\.open-meteo\.com\/v1\/forecast/.test(u)) { if (/hourly=visibility,wind_gusts_10m,cloud_cover_low/.test(u)) calls.meteo++; return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(meteo()) }); }
    return r.abort();
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base, { waitUntil: "domcontentloaded" }); await p.waitForFunction(() => window.TSAP && window.TSAP.areaApi && document.getElementById("atk-tools"), null, { timeout: 60000 });
  await p.waitForTimeout(3000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
  /* fixed "now" for the weather rows: 2026-09-30 12:00Z */
  await p.evaluate(() => { const T = Date.parse("2026-09-30T12:00:00Z"), R = Date.now; Date.now = () => T; window.__realNow = R; });
  return { ctx, p, errors, calls };
}
const square = (c, d) => [[c[0] - d, c[1] - d], [c[0] - d, c[1] + d], [c[0] + d, c[1] + d], [c[0] + d, c[1] - d]];
async function areaMenu(p) {
  for (let i = 0; i < 2; i++) {
    await p.click('#atk-tools [data-atk="area"]'); await p.waitForTimeout(150);
    if (await p.evaluate(() => !document.getElementById("atk-pop").hidden)) break;
  }
  return p.textContent("#atk-pop");
}
async function openPlan(p) {
  await areaMenu(p);
  await p.click('#atk-pop [data-pk="med"]');
  await p.waitForFunction(() => { const t = document.querySelector("#mp-fac table"), w = document.querySelector("#mp-wx table"); return t && w && /min/.test(document.getElementById("mp-fac").textContent); }, null, { timeout: 20000 });
}

// ---------- desktop ----------
{
  const { ctx, p, errors, calls } = await open({ viewport: { width: 1400, height: 900 } });
  await p.evaluate(() => { try { window.TSAP.areaApi.setArea(null); } catch (e) {} });
  ok(!/Medical plan/.test(await areaMenu(p)), "desktop: no Medical plan in the Area menu before an area is drawn");
  await p.click('#atk-tools [data-atk="area"]'); await p.waitForTimeout(100);
  await p.evaluate((P) => window.TSAP.areaApi.setArea(P), square(C0, 0.02));
  ok(/Medical plan/.test(await areaMenu(p)), "desktop: Area menu offers Medical plan once an area is drawn");
  await p.click('#atk-tools [data-atk="area"]'); await p.waitForTimeout(100);
  await openPlan(p);
  ok(await p.evaluate(() => !!window.OSAP_MEDPLAN && !document.getElementById("medplan").hidden), "desktop: Medical plan in the Area menu opens the plan");
  const fac = await p.textContent("#mp-fac");
  const order = await p.$$eval("#mp-fac table:first-of-type tbody tr td:nth-child(2)", (t) => t.map((x) => x.firstChild.textContent));
  ok(order[0] === "Far North Hospital" && order[1] === "Near Hospital", "desktop: hospitals sorted by road drive time: " + order.join(", "));
  ok(/10 min/.test(fac) && /25 min/.test(fac), "desktop: drive times shown (10 min, 25 min)");
  ok(/Emergency dept \(OSM\)/.test(fac) && /300 beds/.test(fac), "desktop: emergency department and beds from OSM tags");
  ok(/Helipad on site/.test(fac), "desktop: a helipad next to a hospital marks it Helipad on site");
  ok(/47P [A-Z]{2} \d{4} \d{4}/.test(fac), "desktop: facilities carry MGRS grids");
  ok(/name withheld/.test(fac) && !/Somchai/.test(await p.textContent("#medplan")), "desktop: a clinic named after a doctor is withheld");
  ok(/Community Health Centre 7/.test(fac) && !/Smile Dental/.test(fac), "desktop: public clinic listed, dentist left out");
  ok(!/\+66|123 4567|999 0000/.test(await p.innerHTML("#medplan")), "desktop: no phone numbers anywhere in the plan");
  const air = await p.textContent("#mp-air");
  ok(/Riverside Pad/.test(air) && /Test Airfield/.test(air) && /VTXX/.test(air), "desktop: helipads and airfields listed with ICAO code");
  ok(await p.evaluate(() => document.querySelectorAll("#mp-air table")[0].querySelectorAll("tbody tr").length === 2), "desktop: disused helipad left out");
  ok(await p.evaluate(() => [...document.querySelectorAll("#mp-fac a, #mp-air a")].every((a) => /^https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/\d+$/.test(a.href))), "desktop: every facility and site links to its OpenStreetMap object");
  const wx = await p.textContent("#mp-wx");
  ok(/2026-10-01/.test(wx) && /visibility below 1\.6 km/.test(wx) && /gusts to 35 kn/.test(wx) && /high heat-injury risk/.test(wx), "desktop: weather flags from the rules (visibility, gusts, heat)");
  ok(/low cloud cover up to 95%/.test(wx), "desktop: low cloud flag");
  ok(!/2026-09-29/.test(wx), "desktop: past days are not listed as forecast");
  ok(/24 mm of rain in the last 3 days/.test(wx) && /ground is probably wet/.test(wx), "desktop: ground state from the last 3 days of rain (24 mm: wet)");
  ok(calls.overpass === 1 && calls.osrm === 1 && calls.meteo === 1, `desktop: one Overpass, one OSRM table and one forecast request (${calls.overpass}/${calls.osrm}/${calls.meteo})`);
  ok(await p.evaluate(() => document.querySelectorAll(".mpicon").length === 8), "desktop: numbered marks on the map (start, 2 hospitals, 2 clinics, 2 helipads, 1 airfield)");
  ok(await p.evaluate(() => /Automatic draft/.test(document.querySelector("#medplan .mphead").textContent) && !/AI generated/.test(document.getElementById("medplan").textContent)), "desktop: labelled Automatic draft, no AI tag");
  await p.waitForFunction(() => /^[0-9a-f]{64}$/.test((document.getElementById("mp-fp") || {}).textContent || ""), null, { timeout: 5000 }).catch(() => {});
  ok(/^[0-9a-f]{64}$/.test(await p.textContent("#mp-fp")), "desktop: plan fingerprint is a SHA-256");
  // Use as HLZ fills the field and it is kept on the device
  await p.click('#mp-air [data-mp-set="hlz"]');
  const hlz = await p.inputValue("#mpf-hlz1");
  ok(/^\d{2}[A-Z] [A-Z]{2} \d{4} \d{4}/.test(hlz), "desktop: Use as HLZ fills the HLZ with the grid: " + hlz);
  await p.fill("#mpf-unit", "Test element"); await p.fill("#mpf-ccp1", "13.7400, 100.4900"); await p.waitForTimeout(800);
  const kept = await p.evaluate(() => { const k = Object.keys(localStorage).filter((x) => /^osap-medplan-/.test(x))[0]; return k && JSON.parse(localStorage.getItem(k)); });
  ok(kept && kept.unit === "Test element" && kept.hlz1 === hlz, "desktop: fields kept on this device");
  ok(await p.evaluate(() => [...document.querySelectorAll("#mp-from option")].some((o) => o.value === "ccp1")), "desktop: the typed CCP is offered as the start point");
  await p.selectOption("#mp-from", "ccp1");
  await p.waitForFunction(() => /CCP|Casualty collection point/.test(document.getElementById("mp-fac").textContent) && document.querySelector("#mp-fac table"), null, { timeout: 10000 });
  ok(calls.osrm === 2 && /Casualty collection point/.test(await p.textContent("#mp-fac")), "desktop: drive times recomputed from the CCP");
  ok(await p.inputValue("#mpf-unit") === "Test element", "desktop: fields survive a new start point");
  // Print prints only the plan
  const pr = await p.evaluate(() => new Promise((res) => { window.print = () => res(document.documentElement.classList.contains("medprint")); document.querySelector('#medplan [data-mp="print"]').click(); }));
  ok(pr, "desktop: Print marks the page so only the plan prints");
  await p.emulateMedia({ media: "print" });
  await p.evaluate(() => document.documentElement.classList.add("medprint"));
  ok(await p.evaluate(() => [...document.body.children].every((e) => e.id === "medplan" || getComputedStyle(e).display === "none") && getComputedStyle(document.getElementById("medplan")).display !== "none" && getComputedStyle(document.querySelector('#medplan [data-mp="print"]')).display === "none"), "desktop: in print only the plan shows, without its buttons");
  if (OUT) await p.screenshot({ path: OUT + "/print.png", fullPage: true });
  if (OUT) await p.pdf({ path: OUT + "/medplan.pdf", format: "A4", margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" } });
  await p.evaluate(() => document.documentElement.classList.remove("medprint")); await p.emulateMedia({ media: "screen" });
  if (OUT) await p.screenshot({ path: OUT + "/desk-plan.png" });
  await p.click('#medplan [data-mp="close"]');
  ok(await p.evaluate(() => document.getElementById("medplan").hidden && !document.querySelector(".mpicon")), "desktop: Close hides the plan and takes the marks off the map");
  ok(!errors.length, "desktop: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- phone, and OpenStreetMap down ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, true);
  await p.evaluate((P) => window.TSAP.areaApi.setArea(P), square(C0, 0.02));
  await p.evaluate(() => { const b = document.getElementById("atk-tools"); if (b && b.classList.contains("folded")) b.querySelector('[data-atk="fold"]').click(); });
  await areaMenu(p); await p.click('#atk-pop [data-pk="med"]');
  await p.waitForFunction(() => /could not be reached/.test((document.getElementById("mp-fac") || {}).textContent || ""), null, { timeout: 20000 });
  ok(/Try again/.test(await p.textContent("#mp-fac")), "phone: OpenStreetMap down says so and offers Try again");
  await p.waitForFunction(() => document.querySelector("#mp-wx table"), null, { timeout: 10000 });
  ok(true, "phone: weather still shows when OpenStreetMap is down");
  ok(await p.evaluate(() => document.getElementById("medplan").scrollWidth <= window.innerWidth + 1 && document.querySelector("#medplan .mpbox").getBoundingClientRect().width <= window.innerWidth), "phone: the plan fits the screen width");
  if (OUT) await p.screenshot({ path: OUT + "/phone-plan.png" });
  ok(!errors.length, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- rule helpers ----------
{
  const ctx = await browser.newContext({ serviceWorkers: "block" }), p = await ctx.newPage();
  await p.goto(base + "tests/", { waitUntil: "domcontentloaded" }).catch(() => {});
  await p.addScriptTag({ url: base + "assets/osap-geo.js" }); await p.addScriptTag({ url: base + "assets/osap-medplan.js" });
  const r = await p.evaluate(() => { const M = window.OSAP_MEDPLAN; return {
    a: M._facName({ name: "Klinik dr. Budi" }, "clinic"), b: M._facName({ name: "Dr. Smith's Surgery" }, "clinic"), c: M._facName({ name: "Bangkok Hospital" }, "hospital"),
    d: M._facName({ name: "Hospital Drive Clinic" }, "clinic"), e: M._parseGrid("13.75, 100.5"), f: M._parseGrid("47P PR 6300 2000"), g: M._parseGrid("nonsense"),
    h: M._wxFlags({ vis: 5000, gust: 12, lc: 10, rain: 1, hi: 25, lo: 10 }).length }; });
  ok(/withheld/.test(r.a) && /withheld/.test(r.b) && r.c === "Bangkok Hospital" && r.d === "Hospital Drive Clinic", "rules: doctor-named clinics withheld, others kept");
  ok(r.e && r.e[0] === 13.75 && r.f && Math.abs(r.f[0] - 13.7) < 1 && r.g === null, "rules: grids parse from lat, lon and MGRS; nonsense does not");
  ok(r.h === 0, "rules: calm weather raises no flags");
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? `${fails} check(s) failed` : "all medical plan checks passed");
process.exit(fails ? 1 : 0);
