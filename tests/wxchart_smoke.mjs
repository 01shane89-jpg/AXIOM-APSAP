// Headless check of the 5-day weather chart (assets/osap-weather.js, Weather view > 5-day chart, Reports > 5-day weather chart).
// Open-Meteo is answered with a made-up but well-formed forecast (wind, a thunderstorm afternoon, a dusty day), so the check runs
// with no network. Checks: the chart opens with 5 days split into night and day halves; every row of the military layout is
// there (12H precip, temps with LO/HI, dew point, RH, wind chill or heat index, winds, crosswind on the chosen runway, sky/vis/wx,
// DA/PA, solar/lunar data, illumination, seven mission impact bars, local and Zulu time axes); the thunderstorm turns air rows red
// with a T; the dusty day reads DUST; the runway picker changes the crosswind; printing makes one landscape page; a phone scrolls
// the table sideways instead of the page; closing removes the landscape page rule; and the page throws nothing.
// Run from the repo root: node tests/wxchart_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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

async function open(viewport) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport, ...(viewport.width < 600 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const h = new URL(r.request().url()).host;
    if (/open-meteo\.com$/.test(h) && !/geocoding/.test(h)) return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(answer(r.request().url())) });
    return r.abort();
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("osap-wx-place-th", JSON.stringify({ k: "spot", name: "Lop Buri", lat: 14.8, lon: 100.65 })); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.OSAP_WX && window.OSAP_WX.chart && window.OSAP_REPORTS, null, { timeout: 60000 });
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  return { ctx, p, errors };
}

/* desktop */
{
  const { ctx, p, errors } = await open({ width: 1400, height: 900 });
  await p.evaluate(() => window.OSAP_WX.chart());
  await p.waitForSelector("#wxc-page", { timeout: 60000 });
  const r = await p.evaluate(() => {
    const pg = document.getElementById("wxc-page"), th = [...pg.querySelectorAll("table.wxct tr > th")].map((x) => x.textContent.trim());
    const bars = [...pg.querySelectorAll("tr.wxcimp")].map((tr) => ({ name: tr.querySelector("th").textContent, red: [...tr.querySelectorAll("rect")].filter((x) => x.getAttribute("fill") === "#d50000").length,
      letters: [...tr.querySelectorAll("text")].map((x) => x.textContent).join("") }));
    return { days: pg.querySelectorAll("th.wxcday").length, halves: pg.querySelector("table.wxct tr:nth-child(2)").querySelectorAll("td").length, th, bars, text: pg.textContent,
      style: !!document.getElementById("wxc-pagestyle"), x: pg.querySelector("tr.wxcxw td").textContent };
  });
  ok(r.days === 5 && r.halves === 10, `5 days in 10 halves (${r.days} days, ${r.halves} halves)`);
  for (const lbl of ["12H PRECIP", "TEMPS", "WINDS", "X-WINDS", "DA / PA", "ILLUM DATA", "HALO / HAHO", "STATIC LINE", "ROTARY WING", "FIXED WING", "GROUND OPS", "ISR", "NBC OPS", "TIME (LOCAL)", "TIME (ZULU)"])
    ok(r.th.some((t) => t.replace(/\s+/g, " ").includes(lbl)), "row " + lbl);
  ok(/SKY\/VIS\/WX/.test(r.th.join(" ")) && /SOLAR \/LUNARDATA\(LOCAL\)|SOLAR \/\s*LUNAR/.test(r.th.join(" ")), "sky and solar/lunar rows");
  ok(/LO: \d+F\/\d+C/.test(r.text) && /HI: \d+F\/\d+C/.test(r.text) && /DP:/.test(r.text) && /RH:/.test(r.text), "LO, HI, DP and RH in F and C");
  ok(/HEAT/.test(r.text) && /\d+(G\d+)? KTS/.test(r.text), "heat index and winds in knots");
  ok(/18\/36 L&R: \d+ KTS/.test(r.x), "crosswind on runway 18/36 by default: " + r.x);
  ok(/MAX DA: [+−]\d+FT/.test(r.text) && /MAX PA: [+−]\d+FT/.test(r.text), "max density and pressure altitude");
  ok(/BMNT:\d\d:\d\d/.test(r.text.replace(/\s/g, "")) && /EENT:\d\d:\d\d/.test(r.text.replace(/\s/g, "")) && /MR:/.test(r.text) && /MS:/.test(r.text), "BMNT, EENT, moonrise and moonset");
  ok(/\d+%/.test(r.text), "illumination percentages");
  ok(/SM \/ (NO CIG|\d+FT)/.test(r.text), "visibility in SM and ceiling");
  ok(/DUST/.test(r.text), "the dusty day reads DUST");
  const rw = r.bars.find((b) => b.name === "ROTARY WING"), sl = r.bars.find((b) => b.name === "STATIC LINE");
  ok(rw && rw.red > 0 && /T/.test(rw.letters), "the thunderstorm turns rotary wing red with a T: " + JSON.stringify(rw));
  ok(sl && /W/.test(sl.letters), "static line marks wind: " + JSON.stringify(sl));
  ok(r.bars.length === 7, "seven mission rows");
  ok(r.style, "landscape page rule added while the chart is open");
  ok(/NOT AN OFFICIAL FORECAST/.test(r.text) && /not doctrine/.test(r.text), "banner and threshold caveat");
  /* runway picker */
  await p.selectOption("select[data-wxrwy]", "9");
  await p.waitForTimeout(300);
  const x2 = await p.evaluate(() => document.querySelector("#wxc-page tr.wxcxw td").textContent);
  ok(/09\/27 L&R/.test(x2), "runway picker changes the crosswind runway: " + x2);
  if (OUT) await p.screenshot({ path: OUT + "/wxchart-desktop.png", fullPage: true });
  /* print: one landscape page */
  await p.emulateMedia({ media: "print" });
  const pdf = await p.pdf({ preferCSSPageSize: true, printBackground: true });
  const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
  const box = /\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\]/.exec(pdf.toString("latin1"));
  ok(pages === 1, "prints on one page (" + pages + ")");
  ok(box && +box[1] > +box[2], "page is landscape (" + (box ? box[1] + "x" + box[2] : "?") + ")");
  if (OUT) await writeFile(OUT + "/wxchart.pdf", pdf);
  await p.emulateMedia({ media: "screen" });
  await p.click('[data-wxb="close"]');
  ok(await p.evaluate(() => !document.getElementById("wxc-pagestyle") && document.getElementById("brief").hidden), "closing removes the landscape rule");
  /* the Reports menu entry */
  ok(await p.evaluate(() => window.OSAP_REPORTS.list().some((x) => x.id === "wxchart" || x[0] === "wxchart")), "Reports lists the 5-day weather chart");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
/* phone */
{
  const { ctx, p, errors } = await open({ width: 390, height: 844 });
  await p.evaluate(() => window.OSAP_WX.chart());
  await p.waitForSelector("#wxc-page", { timeout: 60000 });
  const r = await p.evaluate(() => ({ doc: document.documentElement.scrollWidth, vw: window.innerWidth, sc: document.querySelector("#wxc-page .wxscroll").scrollWidth > document.querySelector("#wxc-page .wxscroll").clientWidth }));
  ok(r.doc <= r.vw + 1 && r.sc, `phone: the table scrolls sideways, the page does not (page ${r.doc} of ${r.vw})`);
  if (OUT) await p.screenshot({ path: OUT + "/wxchart-phone.png" });
  ok(!errors.length, "phone: no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
