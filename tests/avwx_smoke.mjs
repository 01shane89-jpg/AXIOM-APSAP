// Headless check of the airfield reports in the Weather view (assets/osap-weather.js, data from tools/refresh_avwx.mjs on the
// live-avwx branch). Open-Meteo and the live-avwx cell files are answered with made-up data, so the check runs with no network.
// Checks: the Operational weather section lists the nearest airfields with a report (nearest first, distance and direction,
// flight category, METAR observed time in Zulu and local with its age, decoded line, raw METAR, TAF one change group per line,
// OFFICIAL label and source line); report text is shown as text, never as markup; an airfield too far away is left out;
// the 5-day chart carries the nearest airfield's report under the forecast and still prints on one landscape page; a missing
// cell file is no error; a failed download says FAILED and the rest of the section still works; and the page throws nothing.
// Run from the repo root: node tests/avwx_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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
function val(k, s, lat) {
  const t = T0 + s * 3600, lh = ((t + OFF) / 3600) % 24, day = Math.floor((t + OFF - (T0 + OFF)) / 86400), diur = Math.sin(((lh - 9) / 24) * 2 * Math.PI);
  const storm = day === 3 && lh >= 14 && lh < 18, fog = day === 2 && lh >= 4 && lh < 8;
  const wind = 9 + 5 * diur + (day === 4 ? 10 : 0);
  const V = {
    temperature_2m: 28 + 5 * diur, dew_point_2m: 21, relative_humidity_2m: 75 - 20 * diur, apparent_temperature: 31 + 6 * diur, precipitation: storm ? 6 : 0, rain: storm ? 6 : 0, showers: 0, snowfall: 0,
    weather_code: storm ? 95 : fog ? 45 : diur > 0.3 ? 2 : 1, cloud_cover: storm ? 100 : fog ? 100 : diur > 0.3 ? 45 : 15, cloud_cover_low: fog ? 100 : storm ? 90 : 10, cloud_cover_mid: 10, cloud_cover_high: 20,
    visibility: fog ? 400 : storm ? 3000 : 24000, wind_speed_10m: wind, wind_direction_10m: 230, wind_gusts_10m: wind * 1.6 + (storm ? 15 : 0), cape: storm ? 2500 : 300, lifted_index: storm ? -5 : 1,
    freezing_level_height: 4800, pressure_msl: 1008 - 2 * diur, precipitation_probability: storm ? 80 : 5, uv_index: Math.max(0, 9 * diur),
    us_aqi: 60, pm2_5: 15, dust: day === 4 ? 180 : 10, aerosol_optical_depth: 0.3, wave_height: 1, wave_direction: 200, wave_period: 6, swell_wave_height: 0.6, wind_wave_height: 0.4, sea_surface_temperature: 29
  };
  if (k in V) return Math.round(V[k] * 10) / 10;
  let m = /^cloud_cover_(\d+)hPa$/.exec(k); if (m) return storm && +m[1] >= 850 ? 90 : fog && +m[1] === 1000 ? 100 : 10;
  m = /^geopotential_height_(\d+)hPa$/.exec(k); if (m) return Math.round(44331 * (1 - Math.pow(+m[1] / 1013.25, 0.19)));
  m = /^wind_(speed|direction)_\d+hPa$/.exec(k); if (m) return m[1] === "speed" ? 25 : 250;
  return 0;
}
function answer(url) {
  const u = new URL(url), lats = (u.searchParams.get("latitude") || "13.75").split(","), lons = (u.searchParams.get("longitude") || "100.5").split(",");
  const keys = (u.searchParams.get("hourly") || "").split(",").filter(Boolean);
  const one = (lat, i) => ({ latitude: +lat, longitude: +lons[i], elevation: 12, timezone: "Asia/Bangkok", utc_offset_seconds: OFF,
    hourly: Object.fromEntries([["time", Array.from({ length: N }, (_, s) => T0 + s * 3600)], ...keys.map((k) => [k, Array.from({ length: N }, (_, s) => val(k, s, +lat))])]) });
  const list = lats.map(one);
  return list.length === 1 ? list[0] : list;
}


const NOW = Date.now(), H = 36e5;
const CELL = { schema: "osap-avwx/1", built: new Date(NOW - 5 * 6e4).toISOString(), cell: "10_100", st: [
  { id: "VTBL", n: "Lop Buri", c: "TH", la: 14.874, lo: 100.664, el: 23,
    m: { raw: "METAR VTBL 101100Z 24012G24KT 3000 TSRA BKN015CB 27/24 Q1007 <img src=x onerror=window.__xss=1>", t: NOW - 50 * 6e4, cat: "IFR", wd: 240, ws: 12, wg: 24, vis: 1.86, visp: null, cig: 1500, sky: "BKN015", tc: 27, dc: 24, alt: 29.74, wx: "TSRA" },
    f: { raw: "TAF VTBL 101100Z 1012/1112 24010KT 9999 FEW020 TEMPO 1014/1018 VRB20G35KT 3000 TSRA BKN015CB PROB30 TEMPO 1100/1104 4000 BR FM110600 06005KT CAVOK", it: NOW - H, vf: NOW - H, vt: NOW + 23 * H } },
  { id: "VTBD", n: "Bangkok Intl", c: "TH", la: 13.913, lo: 100.607, el: 6,
    m: { raw: "METAR VTBD 101100Z 09006KT 9999 FEW020 31/23 Q1008 NOSIG", t: NOW - 3 * H, cat: "VFR", wd: 90, ws: 6, wg: null, vis: 6, visp: true, cig: null, sky: "FEW020", tc: 31, dc: 23, alt: 29.76, wx: null }, f: null },
  { id: "VTSP", n: "Phuket Intl", c: "TH", la: 8.11, lo: 98.32, el: 25,
    m: { raw: "METAR VTSP 101100Z 27010KT 9999 SCT020 30/25 Q1008", t: NOW - 30 * 6e4, cat: "VFR", wd: 270, ws: 10, vis: 6, visp: true, cig: null, tc: 30, dc: 25, alt: 29.76 }, f: null } ] };
let mode = "ok";
const asked = [];
async function open(viewport) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport, ...(viewport.width < 600 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url(), h = new URL(u).host;
    if (/open-meteo\.com$/.test(h) && !/geocoding/.test(h)) return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(answer(u)) });
    if (/raw\.githubusercontent\.com\/.*\/live-avwx\/c\//.test(u)) {
      asked.push(u.replace(/.*live-avwx\//, ""));
      if (mode === "fail") return r.fulfill({ status: 500, body: "boom", headers: { "access-control-allow-origin": "*" } });
      if (/\/10_100\.json$/.test(u)) return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(CELL) });
      return r.fulfill({ status: 404, body: "404: Not Found", headers: { "access-control-allow-origin": "*" } });
    }
    return r.abort();
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("osap-wx-place-th", JSON.stringify({ k: "spot", name: "Lop Buri", lat: 14.8, lon: 100.65 })); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.OSAP_WX && window.OSAP_WX.chart && window.OSAP_WX.airfields, null, { timeout: 60000 });
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  return { ctx, p, errors };
}
async function weatherView(p) {
  await p.evaluate(() => window.TSAP.setView("weather"));
  await p.waitForSelector("#wx-ops .avwx", { timeout: 60000, state: "attached" });
}

/* desktop: section and chart */
{
  const { ctx, p, errors } = await open({ width: 1400, height: 900 });
  await weatherView(p);
  const r = await p.evaluate(() => {
    const s = document.querySelector("#wx-ops"), av = s.querySelector(".avwx");
    return { h3: [...s.querySelectorAll("h3")].map((x) => x.textContent), ids: [...av.querySelectorAll(".avhd b")].map((x) => x.textContent), text: av.textContent,
      raws: [...av.querySelectorAll("code.avraw")].map((x) => x.innerHTML), cat: av.querySelector(".avcat") && av.querySelector(".avcat").textContent, img: !!av.querySelector("img"), xss: !!window.__xss };
  });
  ok(r.h3.some((x) => /Airfield reports near Lop Buri\s*OFFICIAL/.test(x)), "section has an OFFICIAL airfield reports heading: " + r.h3.join(" | "));
  ok(r.ids.join(",") === "VTBL,VTBD", "nearest first, far airfield left out: " + r.ids.join(","));
  ok(/\d+ km N of Lop Buri/.test(r.text), "distance and direction from the place");
  ok(r.cat === "IFR", "flight category shown: " + r.cat);
  ok(/observed .*Z/.test(r.text) && /5\d min old/.test(r.text), "METAR time in Zulu with its age");
  ok(/Wind 240° 12G24 kt/.test(r.text) && /Ceiling 1,500 ft/.test(r.text) && /QNH 1007 hPa \/ 29\.74 inHg/.test(r.text), "decoded wind, ceiling and QNH");
  ok(/OLD/.test(r.text), "a 3-hour-old METAR is flagged OLD");
  ok(r.raws.some((x) => /^TAF VTBL[^<]*<br>TEMPO 1014\/1018[^<]*<br>PROB30 TEMPO 1100\/1104[^<]*<br>FM110600/.test(x)), "TAF one change group per line");
  ok(!r.img && !r.xss && r.raws.some((x) => /&lt;img/.test(x)), "report text shown as text, not markup");
  ok(/issues no TAF/.test(r.text), "airfield without a TAF says so");
  ok(/Aviation Weather Center/.test(r.text) && /Zulu and local/.test(r.text) && /Not for flight planning/.test(r.text), "source and caveat line");
  ok(asked.some((u) => /10_100\.json$/.test(u)) && asked.length <= 9, "reads the cell around the place (" + asked.join(",") + ")");
  await p.evaluate(() => document.querySelector("#wx-ops .avwx").scrollIntoView());
  if (OUT) await p.locator("#wx-ops .avwx").screenshot({ path: OUT + "/avwx-section.png" });
  await p.evaluate(() => window.OSAP_WX.chart());
  await p.waitForSelector("#wxc-page .wxcav", { timeout: 30000 });
  const c = await p.evaluate(() => { const x = document.querySelector("#wxc-page .wxcav"); return { t: x.textContent, n: x.querySelectorAll(".avhd").length, f: document.querySelector("#wxc-page footer").textContent }; });
  ok(c.n === 1 && /OBSERVED \(OFFICIAL, NOT MODEL\)/.test(c.t) && /Aviation Weather Center/.test(c.f) && /METAR VTBL/.test(c.t) && /TAF VTBL/.test(c.t), "chart carries the nearest airfield's METAR and TAF");
  if (OUT) await p.screenshot({ path: OUT + "/avwx-chart.png", fullPage: true });
  await p.emulateMedia({ media: "print" });
  const pdf = await p.pdf({ preferCSSPageSize: true, printBackground: true });
  const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
  ok(pages === 1, "chart with the airfield report still prints on one page (" + pages + ")");
  if (OUT) await writeFile(OUT + "/avwx-chart.pdf", pdf);
  await p.emulateMedia({ media: "screen" });
  await p.click('[data-wxb="close"]');
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
/* download fails: the section says so and the forecast is still there */
{
  mode = "fail";
  const { ctx, p, errors } = await open({ width: 1200, height: 900 });
  await weatherView(p);
  const r = await p.evaluate(() => ({ t: document.querySelector("#wx-ops .avwx, #wx-ops").textContent }));
  ok(/FAILED/.test(r.t) && /Airfield reports could not be loaded/.test(r.t) && /Next 7 days/.test(r.t), "failed download says FAILED, forecast stays");
  ok(!errors.length, "fail: no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
/* phone: no sideways page scroll from long reports */
{
  mode = "ok";
  const { ctx, p, errors } = await open({ width: 390, height: 844 });
  await weatherView(p);
  const r = await p.evaluate(() => { const a = document.querySelector("#wx-ops .avwx"); return { w: a.scrollWidth, cw: a.clientWidth }; });
  ok(r.w <= r.cw + 1, `phone: reports wrap inside the panel (${r.w} of ${r.cw})`);
  if (OUT) await p.screenshot({ path: OUT + "/avwx-phone.png" });
  ok(!errors.length, "phone: no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
