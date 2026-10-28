// Headless check of the one-page weather brief for a chosen place (assets/osap-weather.js briefAt, osap-atak.js Area and Plans menus).
// Open-Meteo and the airfield-report files are answered with made-up data, so the check runs with no network. Checks: Area > Weather brief
// opens the brief for the drawn shape; the brief has the nearest airfield's METAR as "Observed now", forecast, upper winds, light
// (BMNT/EENT) and Zulu/local times, and prints on one page; long-press > Plans > Weather brief here briefs that point and 25 km around;
// a saved point's cloud button briefs the point by its name; the Weather toolbar's "tap the map" button briefs the tapped spot; a
// forecast that fails shows FAILED with Try again instead of an endless wait; the page throws nothing.
// Run from the repo root: node tests/wxbrief_area_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
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

/* a made-up forecast in Open-Meteo's shape: Bangkok time, 9 days from yesterday's midnight UTC */
const OFF = 7 * 3600, T0 = Math.floor(Date.now() / 864e5) * 86400 - 86400, N = 9 * 24;
function val(k, s) {
  const t = T0 + s * 3600, lh = ((t + OFF) / 3600) % 24, diur = Math.sin(((lh - 9) / 24) * 2 * Math.PI);
  const V = { temperature_2m: 28 + 5 * diur, dew_point_2m: 21, relative_humidity_2m: 75 - 20 * diur, apparent_temperature: 31 + 6 * diur, precipitation: 0, rain: 0, showers: 0, snowfall: 0,
    weather_code: 2, cloud_cover: 40, cloud_cover_low: 10, cloud_cover_mid: 10, cloud_cover_high: 20, visibility: 24000, wind_speed_10m: 9 + 5 * diur, wind_direction_10m: 230, wind_gusts_10m: 18,
    cape: 300, lifted_index: 1, freezing_level_height: 4800, pressure_msl: 1008, precipitation_probability: 5, uv_index: Math.max(0, 9 * diur), us_aqi: 60, pm2_5: 15, dust: 10 };
  if (k in V) return Math.round(V[k] * 10) / 10;
  let m = /^cloud_cover_(\d+)hPa$/.exec(k); if (m) return 10;
  m = /^geopotential_height_(\d+)hPa$/.exec(k); if (m) return Math.round(44331 * (1 - Math.pow(+m[1] / 1013.25, 0.19)));
  m = /^wind_(speed|direction)_\d+hPa$/.exec(k); if (m) return m[1] === "speed" ? 25 : 250;
  return 0;
}
function answer(url) {
  const u = new URL(url), lats = (u.searchParams.get("latitude") || "13.75").split(","), lons = (u.searchParams.get("longitude") || "100.5").split(",");
  const keys = (u.searchParams.get("hourly") || "").split(",").filter(Boolean);
  const one = (lat, i) => ({ latitude: +lat, longitude: +lons[i], elevation: 12, timezone: "Asia/Bangkok", utc_offset_seconds: OFF,
    hourly: Object.fromEntries([["time", Array.from({ length: N }, (_, s) => T0 + s * 3600)], ...keys.map((k) => [k, Array.from({ length: N }, (_, s) => val(k, s))])]) });
  const list = lats.map(one);
  return list.length === 1 ? list[0] : list;
}
const NOW = Date.now(), H = 36e5;
const CELL = { schema: "osap-avwx/1", built: new Date(NOW - 5 * 6e4).toISOString(), cell: "10_100", st: [
  { id: "VTBL", n: "Lop Buri", c: "TH", la: 14.874, lo: 100.664, el: 23,
    m: { raw: "METAR VTBL 101100Z 24012G24KT 3000 TSRA BKN015CB 27/24 Q1007 <img src=x onerror=window.__xss=1>", t: NOW - 50 * 6e4, cat: "IFR", wd: 240, ws: 12, wg: 24, vis: 1.86, cig: 1500, tc: 27, dc: 24, alt: 29.74, wx: "TSRA" },
    f: { raw: "TAF VTBL 101100Z 1012/1112 24010KT 9999 FEW020 TEMPO 1014/1018 VRB20G35KT 3000 TSRA BKN015CB", it: NOW - H, vf: NOW - H, vt: NOW + 23 * H } } ] };
let wxFail = false;
const AREA = [[14.6, 100.4], [14.6, 100.9], [15.0, 100.9], [15.0, 100.4]];
async function open(viewport, init) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport, ...(viewport.width < 600 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url(), h = new URL(u).host, cors = { "access-control-allow-origin": "*" };
    if (/open-meteo\.com$/.test(h) && !/geocoding/.test(h)) return wxFail ? r.fulfill({ status: 500, body: "boom", headers: cors }) : r.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(answer(u)) });
    if (/live-avwx\//.test(u)) return /\/10_100\.json$/.test(u) ? r.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(CELL) }) : r.fulfill({ status: 404, body: "404: Not Found", headers: cors });
    return r.abort();
  });
  await ctx.addInitScript(init);
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.OSAP_WX && window.OSAP_WX.briefAt && window.OSAP_ATAK && window.__asapMap, null, { timeout: 60000 });
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  return { ctx, p, errors };
}
const briefText = (p) => p.evaluate(() => { const g = document.getElementById("wxb-page"); return g ? { h2: g.querySelector("h2").textContent, text: g.textContent, xss: !!window.__xss, img: !!g.querySelector("img[src=x]") } : null; });
async function waitBrief(p, re) {
  await p.waitForFunction((src) => { const g = document.getElementById("wxb-page"); return g && /Upper winds/.test(g.textContent) && new RegExp(src).test(g.querySelector("h2").textContent); }, re.source, { timeout: 60000 });
}

/* desktop: drawn area through Area > Weather brief, then a long-press point, then a saved point */
{
  const { ctx, p, errors } = await open({ width: 1400, height: 900 }, (a) => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("asap-area-th", JSON.stringify(a)); localStorage.setItem("osap-atak-pts", "[]"); } catch (e) {} });
  await p.evaluate((a) => { localStorage.setItem("asap-area-th", JSON.stringify(a)); }, AREA);
  ok(await p.evaluate(() => (window.OSAP_AREA_TOOLS || []).some((t) => t.id === "wxbrief" && t.label === "Weather brief")), "Area menu lists Weather brief");
  await p.evaluate(() => window.OSAP_AREA_TOOLS.find((t) => t.id === "wxbrief").run());
  await waitBrief(p, /Drawn area/);
  await p.waitForFunction(() => /VTBL/.test((document.getElementById("wxb-page") || {}).textContent || ""), null, { timeout: 20000 });
  let r = await briefText(p);
  ok(/Drawn area, Thailand/.test(r.h2), "brief is for the drawn area: " + r.h2);
  ok(/Observed now, nearest airfield \(METAR/.test(r.text) && /VTBL/.test(r.text) && /IFR/.test(r.text) && /Ceiling 1,500 ft/.test(r.text) && /TAF in force/.test(r.text), "observed now: nearest METAR decoded, flight category and TAF");
  ok(/BMNT/.test(r.text) && /EENT/.test(r.text) && /Moon lit/.test(r.text), "light: BMNT, EENT and moon");
  ok(/850 hPa/.test(r.text) && /Freezing level/.test(r.text), "upper winds and freezing level");
  ok(/Sky, ceiling/.test(r.text) && /Vis/.test(r.text), "forecast with ceiling and visibility");
  ok(/Warnings, cyclones and floods/.test(r.text), "warnings section");
  ok(/Zulu \/ local/.test(r.text) && /\d{4}Z/.test(r.text), "Zulu and local times");
  ok(!r.xss && !r.img, "METAR text is escaped");
  ok(await p.evaluate(() => !!document.querySelector('#brief [data-wxb="print"]')), "Export PDF button");
  if (OUT) await p.screenshot({ path: OUT + "/wxbrief-area.png", fullPage: true });
  await p.emulateMedia({ media: "print" });
  let pdf;
  for (const format of ["A4", "Letter"]) {
    pdf = await p.pdf({ format, printBackground: true });
    const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
    ok(pages === 1, format + ": prints on one page (" + pages + ")");
  }
  if (OUT) await writeFile(OUT + "/wxbrief-area.pdf", pdf);
  await p.emulateMedia({ media: "screen" });
  await p.click('[data-wxb="close"]');
  ok(await p.evaluate(() => document.getElementById("brief").hidden), "Close hides the brief");

  /* long-press > Plans > Weather brief here */
  await p.evaluate(() => window.OSAP_ATAK.ring(14.3, 100.6));
  await p.click('#atk-ring [data-rk="plans"]');
  const items = await p.$$eval("[data-pk]", (b) => b.map((x) => x.getAttribute("data-pk") + ":" + x.textContent));
  ok(items.includes("wxbrief:Weather brief here"), "Plans lists Weather brief here: " + items.join(", "));
  await p.click('[data-pk="wxbrief"]');
  await waitBrief(p, /25 km around/);
  r = await briefText(p);
  ok(/^Point /.test(r.h2) && /25 km around/.test(r.h2), "long-press brief is the point and 25 km around: " + r.h2);
  await p.click('[data-wxb="close"]');
  ok(await p.evaluate(() => { const s = JSON.parse(localStorage.getItem("osap-wx-place-th")); return s.k === "spot" && Math.abs(s.lat - 14.3) < 1e-3; }), "the point is remembered as the Weather place");

  /* a saved point's weather button */
  await p.evaluate(() => { window.OSAP_ATAK.pts.add(window.L.latLng(14.9, 100.7)); });
  await p.evaluate(() => window.OSAP_ATAK.overlays("overlays"));
  const wb = await p.waitForSelector("[data-mk-wx]", { timeout: 10000 }).catch(() => null);
  ok(!!wb, "saved point has a weather brief button");
  if (wb) {
    const nm = await p.evaluate(() => { const id = document.querySelector("[data-mk-wx]").getAttribute("data-mk-wx"); return window.OSAP_ATAK.pts.all().find((x) => x.id === id).n; });
    await p.evaluate(() => document.querySelector("[data-mk-wx]").click());
    await waitBrief(p, /25 km around/);
    r = await briefText(p);
    ok(r.h2.startsWith(nm), "saved point brief uses its name: " + r.h2);
    await p.click('[data-wxb="close"]');
  }
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
/* desktop: Weather toolbar > tap the map, and a failing forecast */
{
  const { ctx, p, errors } = await open({ width: 1400, height: 900 }, () => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  await p.evaluate(() => window.OSAP_ATAK.overlays("weather"));
  const btn = await p.waitForSelector("#ml-wx [data-wxbpick]", { state: "visible", timeout: 20000 });
  ok(/One-page weather brief: Thailand/.test(await p.$eval("#ml-wx [data-wxbrief]", (b) => b.textContent)), "toolbar brief button names the place");
  await btn.click();
  ok(await p.$eval("#ml-wx [data-wxbpick]", (b) => b.getAttribute("aria-pressed") === "true" && /Tap the map/.test(b.textContent)), "tap button arms");
  await p.evaluate(() => { const m = window.__asapMap; m.fire("click", { latlng: window.L.latLng(13.9, 100.6) }); });
  await waitBrief(p, /25 km around/);
  ok(/^Point /.test((await briefText(p)).h2), "tapped spot opens its brief");
  await p.click('[data-wxb="close"]');
  wxFail = true;
  await p.evaluate(() => window.OSAP_WX.briefAt({ lat: 16.1, lon: 101.2, name: "Fail test" }));
  await p.waitForFunction(() => /FAILED/.test((document.getElementById("wxb-page") || {}).textContent || ""), null, { timeout: 60000 });
  ok(await p.evaluate(() => !!document.querySelector('#wxb-page [data-wxbrief]') && !!document.querySelector('#brief [data-wxb="close"]')), "failed forecast shows FAILED with Try again and Close");
  wxFail = false;
  await p.click('#wxb-page [data-wxbrief]');
  await waitBrief(p, /Fail test/);
  ok(true, "Try again loads the brief");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
