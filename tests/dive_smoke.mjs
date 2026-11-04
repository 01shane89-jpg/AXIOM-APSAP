// Headless check of the dive plan and dive medical plan (assets/osap-dive.js) on a desktop and a phone. The marine forecast,
// the wind forecast and OpenStreetMap (Overpass) are answered by made-up test data, so the check is the same every run; the
// Navy dive tables are the real data/dive/usn-rev7-air.json.
// Test site: 12.55 N, 100.85 E (Gulf of Thailand). Made-up chambers: a naval one 30 km north (healthcare=hyperbaric_chamber,
// military=naval_base, opening_hours 24/7, a phone) and a civilian hospital unit 120 km east (speciality hyperbaric, operator
// type public, no hours). Forecast: waves 0.8 m, current 1.0 km/h, wind 8 kn gusting 12 kn every hour.
// Checks: nothing loaded until used; Plans menu, long-press > Plans and the Area menu offer the dive plan; it opens at the
// pressed point with its MGRS; the planning-aid warning is shown; 78 fsw / 47 min reads Table 9-9 80/50 with 17 min at 20 fsw
// (manual page 9-72) and group M; a repetitive dive shows Table 9-8 group, residual nitrogen time and ESDT; metres convert to
// fsw; Table 9-6 waits are shown for the highest group; each forecast hour is called Good, and No-go once a limit is lowered;
// the chambers list military/civilian and hours only where tagged, with distance and flight times; DAN's lines are listed;
// the manual's air-evacuation wording (1,000 feet) is shown; Save stores one record; Export PDF prints the table reading and
// no form fields; with the tables unreachable the sheet says so and reads nothing; the phone sheet fits; no page errors.
// Run from the repo root: node tests/dive_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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

const SITE = [12.55, 100.85];
const hours = (() => { const out = [], t0 = Date.now() - (Date.now() % 3600000) - 86400000; for (let i = 0; i < 24 * 9; i++) out.push(new Date(t0 + i * 3600000).toISOString().slice(0, 16)); return out; })();
const fill = (v) => hours.map(() => v);
const MARINE = { hourly: { time: hours, wave_height: fill(0.8), swell_wave_height: fill(0.6), swell_wave_period: fill(8), swell_wave_direction: fill(120), sea_surface_temperature: fill(29.1), ocean_current_velocity: fill(1.0), ocean_current_direction: fill(200), sea_level_height_msl: fill(0.4) } };
const WIND = { hourly: { time: hours, wind_speed_10m: fill(8), wind_gusts_10m: fill(12), wind_direction_10m: fill(45) } };
const OVERPASS = { osm3s: { timestamp_osm_base: "2026-11-04T00:00:00Z" }, elements: [
  { type: "node", id: 901, lat: SITE[0] + 0.27, lon: SITE[1], tags: { healthcare: "hyperbaric_chamber", name: "Test Naval Recompression Chamber", military: "naval_base", opening_hours: "24/7", phone: "+66 38 000 000" } },
  { type: "way", id: 902, center: { lat: SITE[0], lon: SITE[1] + 1.1 }, tags: { amenity: "hospital", "healthcare:speciality": "general;hyperbaric", name: "Test Hospital Hyperbaric Unit", "operator:type": "public" } },
  { type: "node", id: 903, lat: SITE[0] + 0.1, lon: SITE[1], tags: { amenity: "hospital", name: "Ordinary Hospital" } }
] };

async function open(opts, flags = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [], hits = { marine: 0, wind: 0, overpass: 0 };
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url(), H = { "Access-Control-Allow-Origin": "*" };
    if (/marine-api\.open-meteo\.com/.test(u)) { hits.marine++; return r.fulfill({ status: 200, contentType: "application/json", headers: H, body: JSON.stringify(MARINE) }); }
    if (/api\.open-meteo\.com\/v1\/forecast/.test(u) && /wind_gusts_10m/.test(u) && /wind_direction_10m/.test(u)) { hits.wind++; return r.fulfill({ status: 200, contentType: "application/json", headers: H, body: JSON.stringify(WIND) }); }
    if (/\/api\/interpreter/.test(u) && /hyperbaric/.test(decodeURIComponent(r.request().postData() || ""))) { hits.overpass++; return r.fulfill({ status: 200, contentType: "application/json", headers: H, body: JSON.stringify(OVERPASS) }); }
    return r.abort();
  });
  if (flags.noTables) await ctx.route(/\/data\/dive\/usn-rev7-air\.json/, (r) => r.fulfill({ status: 404, body: "" }));
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.__asapMap && window.OSAP_DIVE_GO, null, { timeout: 60000 }); await p.waitForTimeout(3000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
  return { ctx, p, errors, hits };
}
const settled = (p) => p.waitForFunction(() => { const s = window.OSAP_DIVE && window.OSAP_DIVE.state && window.OSAP_DIVE.state(); return s && s.r && !s.busy.wx && !s.busy.ch && (s.ch || s.chErr); }, null, { timeout: 30000 });
const text = (p) => p.evaluate(() => (document.getElementById("dive") || {}).innerText || "");
async function setF(p, sel, v) { await p.fill("#dive " + sel, String(v)); await p.dispatchEvent("#dive " + sel, "change"); await p.waitForTimeout(80); }

/* ---------- desktop ---------- */
{
  const { ctx, p, errors, hits } = await open({ viewport: { width: 1440, height: 900 } });
  ok(await p.evaluate(() => !document.querySelector('#atk-tools [data-atk="dive"]') && !window.OSAP_DIVE), "desktop: no dive toolbar button, and the dive plan is not loaded until used");
  ok(await p.evaluate(() => (window.OSAP_AREA_TOOLS || []).some((t) => t.id === "dive" && t.point)), "desktop: Area menu lists the dive plan, usable with no shape");
  await p.click('#atk-tools [data-atk="plans"]'); await p.waitForTimeout(150);
  ok(/Dive plan and dive medical plan/.test(await p.textContent("#atk-pop")), "desktop: the Plans menu lists Dive plan and dive medical plan");
  await p.keyboard.press("Escape"); await p.waitForTimeout(100);
  await p.evaluate((c) => { window.__asapMap.setView(c, 11); window.OSAP_ATAK.ring(c[0], c[1]); }, SITE); await p.waitForTimeout(200);
  await p.click('#atk-ring [data-rk="plans"]'); await p.waitForTimeout(150);
  ok(/Dive plan here/.test(await p.textContent("#atk-pop")), "desktop: long-press > Plans lists Dive plan here");
  await p.click('#atk-pop [data-pk="dive"]');
  await p.waitForFunction(() => window.OSAP_DIVE && window.OSAP_DIVE.isOpen && window.OSAP_DIVE.isOpen(), null, { timeout: 15000 });
  await settled(p);
  let t = await text(p), s = await p.evaluate(() => window.OSAP_DIVE.state());
  const mg = await p.evaluate((c) => window.OSAP_GEO.mgrs(c[0], c[1], 5), SITE);
  ok(Math.abs(s.r.at[0] - SITE[0]) < 1e-4 && Math.abs(s.r.at[1] - SITE[1]) < 1e-4 && (await p.inputValue('#dive [data-f="grid"]')) === mg, "desktop: opens at the long-pressed point with its MGRS " + mg);
  ok(/OSAP does no decompression calculation of its own/.test(t) && /Diving Supervisor checks each schedule against the manual/.test(t), "desktop: the planning-aid warning is shown");
  ok(/Diver to complete/.test(t), "desktop: the diver's own fields are marked Diver to complete");

  /* the profile: 78 fsw for 47 min */
  await p.waitForFunction(() => !/Loading the Navy dive tables/.test(document.getElementById("dive").innerText), null, { timeout: 15000 });
  await setF(p, '[data-f="d"][data-i="0"]', 78); await setF(p, '[data-f="bt"][data-i="0"]', 47);
  t = await text(p); s = await p.evaluate(() => window.OSAP_DIVE.state());
  const d1 = s.series.dives[0];
  ok(d1.p.table === "9-9" && d1.p.depth === 80 && d1.p.row.bt === 50 && d1.p.row.air.stops["20"] === 17 && d1.groupOut === "M", "desktop: 78 fsw / 47 min reads Table 9-9 80/50, 17 min at 20 fsw, group M");
  ok(/Table 9-9: 80 fsw \/ 50 min/.test(t) && /manual page 9-72/.test(t), "desktop: the sheet names the table, the schedule and the manual page");
  /* a repetitive dive 2 hours later to 50 fsw for 20 min */
  await p.click('#dive [data-dv="adddive"]'); await p.waitForTimeout(100);
  await setF(p, '[data-f="si"][data-i="1"]', "2:00"); await setF(p, '[data-f="d"][data-i="1"]', 50); await setF(p, '[data-f="bt"][data-i="1"]', 20);
  s = await p.evaluate(() => window.OSAP_DIVE.state()); t = await text(p);
  const d2 = s.series.dives[1];
  ok(d2.gIn === "M" && d2.gNew && d2.rnt && d2.rnt.t > 0 && d2.esdt === d2.rnt.t + 20 && /Residual nitrogen time for group/.test(t) && /Equivalent single dive time/.test(t), "desktop: the repetitive dive shows the new group " + (d2.gNew) + ", residual nitrogen time " + (d2.rnt && d2.rnt.t) + " and ESDT " + d2.esdt + " from Table 9-8");
  ok(/Highest repetitive group in the plan: [A-Z]/.test(t) && /Commercial flight \(cabin 8,000 ft\): wait \d+:\d\d/.test(t), "desktop: Table 9-6 waits are shown, with the commercial flight wait");
  /* metres */
  await p.selectOption('#dive [data-f="unit"]', "m"); await p.waitForTimeout(100);
  await setF(p, '[data-f="d"][data-i="0"]', 18); await setF(p, '[data-f="bt"][data-i="0"]', 30);
  s = await p.evaluate(() => window.OSAP_DIVE.state());
  ok(s.series.dives[0].d === 60 && /\(60 fsw\)/.test(await text(p)), "desktop: 18 m is read as 60 fsw (3.28084 ft per metre, rounded up)");

  /* conditions */
  t = await text(p);
  ok(hits.marine > 0 && hits.wind > 0 && s.wx.length >= 5 && s.wx.every((x) => x.call.k === "Good") && /0\.8/.test(t) && /29\.1/.test(t), "desktop: the marine forecast hours round the dive are read and called Good");
  await setF(p, '[data-f="lim.hs"]', 0.5);
  s = await p.evaluate(() => window.OSAP_DIVE.state());
  ok(s.wx.every((x) => x.call.k === "No-go" && /waves/.test(x.call.why)), "desktop: lowering the wave limit to 0.5 m makes every hour No-go");

  /* the dive medical plan */
  t = await text(p);
  ok(hits.overpass > 0 && s.ch && s.ch.list.length === 2 && s.ch.list[0].name === "Test Naval Recompression Chamber" && !s.ch.list.some((c) => c.name === "Ordinary Hospital"), "desktop: the two chambers are listed, nearest first, and an ordinary hospital is not");
  ok(s.ch.list[0].mil.k === "Military" && s.ch.list[0].hours === "24/7" && s.ch.list[1].mil.k === "Civilian" && s.ch.list[1].hours === "", "desktop: military/civilian and hours come only from the tags");
  ok(/24\/7/.test(t) && /Not stated/.test(t) && /Tel \+66 38 000 000/.test(t) && /No phone in OpenStreetMap/.test(t), "desktop: hours, Not stated and the phone (or its absence) are shown");
  ok(/30\.0 km|30 km/.test(t) && /16 NM/.test(t) && /8 min \/ 4 min/.test(t), "desktop: distance and flight times at 120 / 250 kn are shown for the naval chamber");
  ok(/\+1-919-684-9111/.test(t) && /\+39 06 4211 5685/.test(t), "desktop: DAN's diving emergency lines are listed");
  ok(/no more than 1,000 feet is preferable/.test(t) && /not on Table 9-6/.test(t), "desktop: the manual's air-evacuation wording is shown, and a casualty is kept off Table 9-6");
  ok(await p.evaluate(() => document.querySelectorAll(".dvmk").length >= 3), "desktop: the site and the chambers are on the map");

  /* save, PDF */
  await setF(p, '[data-f="name"]', "Test reef");
  await p.click('#dive [data-dv="save"]'); await p.waitForTimeout(150);
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem("osap-dives") || "[]"));
  ok(saved.length === 1 && saved[0].name === "Test reef" && saved[0].dives.length === 2 && saved[0].unit === "m", "desktop: Save keeps one record with both dives in metres");
  await p.evaluate(() => { window.__pdf = null; window.__pdfHold = (info) => { const r = info.root; window.__pdf = { title: info.title, text: r.innerText, inputs: r.querySelectorAll("input,select,textarea,button").length }; }; });
  await p.click('#dive [data-dv="pdf"]'); await p.waitForFunction(() => window.__pdf, null, { timeout: 30000 });
  const pdf = await p.evaluate(() => window.__pdf);
  ok(/^Dive plan: Test reef/.test(pdf.title) && pdf.inputs === 0 && /Table 9-7|Table 9-9/.test(pdf.text) && /Test Naval Recompression Chamber/.test(pdf.text) && /\+1-919-684-9111/.test(pdf.text) && /Planning aid/.test(pdf.text), "desktop: Export PDF prints the table reading, chambers and DAN lines with no form fields");
  if (OUT) await p.screenshot({ path: OUT + "/dive-desktop.png" });
  await p.click('#dive [data-dv="close"]'); await p.waitForTimeout(100);
  await p.evaluate((c) => window.OSAP_DIVE_GO({ at: [c[0] + 0.0001, c[1]] }), SITE); await p.waitForTimeout(300);
  s = await p.evaluate(() => window.OSAP_DIVE.state());
  ok(s.saved && s.r.name === "Test reef", "desktop: opening near a saved site reopens its dive plan");
  ok(errors.length === 0, "desktop: no page errors " + errors.join(" | "));
  await ctx.close();
}

/* ---------- the tables unreachable ---------- */
{
  const { ctx, p, errors } = await open({ viewport: { width: 1280, height: 800 } }, { noTables: true });
  await p.evaluate((c) => window.OSAP_DIVE_GO({ at: c }), SITE);
  await p.waitForFunction(() => /could not be loaded/.test((document.getElementById("dive") || {}).innerText || ""), null, { timeout: 15000 });
  await setF(p, '[data-f="d"][data-i="0"]', 60); await setF(p, '[data-f="bt"][data-i="0"]', 30);
  const t = await text(p), s = await p.evaluate(() => window.OSAP_DIVE.state());
  ok(/The Navy dive tables could not be loaded/.test(t) && /Use the manual/.test(t) && s.series === null && !/Table 9-7:/.test(t), "failure: with the tables unreachable the sheet says so and reads no schedule");
  ok(errors.length === 0, "failure: no page errors " + errors.join(" | "));
  await ctx.close();
}

/* ---------- phone ---------- */
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await p.evaluate(() => (window.OSAP_AREA_TOOLS || []).filter((t) => t.id === "dive")[0].run());
  await p.waitForFunction(() => window.OSAP_DIVE && window.OSAP_DIVE.isOpen && window.OSAP_DIVE.isOpen(), null, { timeout: 15000 }); await settled(p);
  await p.waitForFunction(() => !/Loading the Navy dive tables/.test(document.getElementById("dive").innerText), null, { timeout: 15000 });
  await setF(p, '[data-f="d"][data-i="0"]', 100); await setF(p, '[data-f="bt"][data-i="0"]', 30);
  const r = await p.evaluate(() => { const e = document.getElementById("dive"), b = e.querySelector(".cbox").getBoundingClientRect(); return { w: b.width, over: document.documentElement.scrollWidth > innerWidth + 1, boxOver: [...e.querySelectorAll(".cbox > *:not(.tw):not(.card)")].some((x) => x.scrollWidth > x.clientWidth + 2) }; });
  ok(r.w <= 391 && !r.over && !r.boxOver, "phone: the sheet fits the screen with no sideways scroll: " + JSON.stringify(r));
  ok(/Table 9-9: 100 fsw \/ 30 min/.test(await text(p)), "phone: Area > Dive plan opens and reads 100/30 from Table 9-9");
  if (OUT) await p.screenshot({ path: OUT + "/dive-phone.png" });
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}

await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
