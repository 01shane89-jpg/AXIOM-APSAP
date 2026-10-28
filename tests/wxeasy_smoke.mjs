// Headless check of the easy-read weather (assets/osap-weather.js: Weather view top, Weather > Easy-read page, Reports > Weather, easy read).
// Shane 2026-10-28: "most people have no idea what they are looking at"; "has graphics of the weather by day".
// Checks: 7 day cards with a picture, °C and °F, rain chance and wind in mph; the thunderstorm day shows Storms; the summary says
// Now, Next 24 hours and when storms are likely; Flying reads No-go with the reason and when; Good / Marginal / No-go legend; impact cells
// show ✓ ! ✕ instead of G A R; the terms list explains the short words; the easy page and the one-page brief each print on one page on A4
// and Letter; a phone fits the strip without sideways scrolling; no page errors.
// Open-Meteo is answered with the made-up forecast of tests/wxchart_smoke.mjs (a thunderstorm afternoon on day 3, fog on day 2, a dusty
// windy day 4), so the check runs with no network.
// Run from the repo root: node tests/wxeasy_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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

async function pages(p) {
  await p.emulateMedia({ media: "print" });
  const out = [];
  for (const format of ["A4", "Letter"]) { const pdf = await p.pdf({ format, printBackground: true }); out.push((pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length); }
  await p.emulateMedia({ media: "screen" });
  return out;
}
/* desktop: the printable easy-read page */
{
  const { ctx, p, errors } = await open({ width: 1400, height: 900 });
  ok(await p.evaluate(() => window.OSAP_REPORTS.list().some((x) => x.id === "wxeasy" || x[0] === "wxeasy")), "Reports lists Weather, easy read");
  await p.evaluate(() => window.OSAP_WX.easy());
  await p.waitForSelector("#wxe-page .wxstrip", { timeout: 60000 });
  const r = await p.evaluate(() => {
    const g = document.getElementById("wxe-page"), days = [...g.querySelectorAll(".wxday")];
    return { n: days.length, icons: g.querySelectorAll(".wxday svg.wxico[aria-label]").length, kinds: days.map((d) => d.querySelector(".wxdk").textContent), first: days[0].textContent,
      sum: [...g.querySelectorAll("ul.wxezs li")].map((x) => x.textContent), acts: [...g.querySelectorAll("table.wxact tr")].map((x) => x.textContent), text: g.textContent };
  });
  ok(r.n === 7 && r.icons === 7, `7 day cards with pictures (${r.n}, ${r.icons} pictures)`);
  ok(r.kinds.includes("Storms"), "the thunderstorm day shows Storms: " + r.kinds.join(", "));
  ok(/Today/.test(r.first) && /\d+°/.test(r.first) && /°F/.test(r.first) && /%/.test(r.first) && /mph/.test(r.first), "a card has the day, °C and °F, rain chance and wind in mph: " + r.first);
  ok(r.sum.some((x) => /^Now: /.test(x) && /°C \(\d+°F\)/.test(x) && /mph \(\d+ kt\)/.test(x)), "Now line in plain words with °F and mph: " + r.sum[0]);
  ok(r.sum.some((x) => /^Next 24 hours: /.test(x)), "Next 24 hours line");
  ok(r.sum.some((x) => /^Thunderstorms: likely on \w+ afternoon, from about \w+ \d\d:\d\d local \(\d{4}Z\)/.test(x)), "storms: which day, part of day, local and Zulu: " + r.sum.find((x) => /^Thunderstorms/.test(x)));
  const fly = r.acts.find((x) => /^Flying/.test(x)) || "";
  ok(/No-go/.test(fly) && /Mainly (low cloud|thunderstorm|gusts|visibility)/.test(fly) && /local \(\d{4}Z\)/.test(fly) && /helicopters|planes|drones/.test(fly), "Flying: No-go, why, when and who: " + fly);
  ok(r.acts.some((x) => /^On the ground/.test(x)), "On the ground line");
  ok(/Good: little or no effect/.test(r.text) && /Marginal: possible, but take care/.test(r.text) && /No-go: unsafe/.test(r.text), "legend spells out Good, Marginal, No-go");
  ok(/not a forecaster, not AI/.test(r.text) && /Not analyst-approved/.test(r.text), "says how it was made");
  ok(/Ceiling/.test(r.text) && /knots/.test(r.text), "words used: ceiling and knots explained");
  if (OUT) await p.screenshot({ path: OUT + "/wxeasy-page.png", fullPage: true });
  const pg = await pages(p);
  ok(pg[0] === 1 && pg[1] === 1, "easy page prints on one page (A4 " + pg[0] + ", Letter " + pg[1] + ")");
  await p.click('[data-wxb="close"]');
  /* the one-page brief: symbols and legend, still one page */
  await p.evaluate(() => window.OSAP_WX.brief());
  await p.waitForSelector("#wxb-page table.wxm", { timeout: 60000 });
  const b = await p.evaluate(() => { const g = document.getElementById("wxb-page"); return { cells: [...g.querySelectorAll("td.wxc")].map((x) => x.textContent.trim()), text: g.textContent }; });
  ok(b.cells.length && b.cells.every((c) => ["✓", "!", "✕", "–"].includes(c)) && b.cells.includes("✕"), "brief impact cells are ✓ ! ✕, not letters");
  ok(/No-go: unsafe/.test(b.text) && /No-go: thunderstorms/.test(b.text), "brief legend and thresholds in words");
  const bp = await pages(p);
  ok(bp[0] === 1 && bp[1] === 1, "brief still prints on one page (A4 " + bp[0] + ", Letter " + bp[1] + ")");
  await p.click('[data-wxb="close"]');
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
/* desktop: the Weather view opens with the easy read; specialists' tables below; terms list */
{
  const { ctx, p, errors } = await open({ width: 1400, height: 900 });
  await p.evaluate(() => { const v = document.querySelector('#view-seg button[data-view="weather"]'); if (v) v.click(); });
  const sec = await p.waitForSelector("#wx-ops .wxez .wxstrip", { timeout: 60000 }).catch(() => null);
  ok(!!sec, "Weather view shows the easy read");
  if (sec) {
    const r = await p.evaluate(() => {
      const s = document.getElementById("wx-ops"), ez = s.querySelector(".wxez"), det = [...s.querySelectorAll("h3")].find((h) => /Details for specialists/.test(h.textContent));
      return { order: !!(det && (ez.compareDocumentPosition(det) & Node.DOCUMENT_POSITION_FOLLOWING)), terms: !!s.querySelector("details.wxterms dl"), easyBtn: !!s.querySelector("[data-wxeasy]"),
        cells: [...s.querySelectorAll("table.wxsm td.wxc")].map((x) => x.textContent.trim()), legend: /No-go: unsafe/.test(s.textContent) };
    });
    ok(r.order, "easy read comes before the specialists' details");
    ok(r.terms, "What do these terms mean? list");
    ok(r.easyBtn, "Easy-read page button");
    ok(r.cells.length && r.cells.every((c) => ["✓", "!", "✕", "–"].includes(c)), "section impact cells are ✓ ! ✕");
    ok(r.legend, "section legend");
    if (OUT) await p.screenshot({ path: OUT + "/wxeasy-section.png" });
  }
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
/* phone */
{
  const { ctx, p, errors } = await open({ width: 390, height: 844 });
  await p.evaluate(() => window.OSAP_WX.easy());
  await p.waitForSelector("#wxe-page .wxstrip", { timeout: 60000 });
  const r = await p.evaluate(() => ({ doc: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth, pg: document.getElementById("wxe-page").scrollWidth, pw: document.getElementById("wxe-page").clientWidth }));
  ok(r.doc <= 391 && r.pg <= r.pw + 1, `phone: the page fits a 390 px screen (page ${r.doc}, content ${r.pg} of ${r.pw})`);
  if (OUT) await p.screenshot({ path: OUT + "/wxeasy-phone.png", fullPage: true });
  ok(!errors.length, "phone: no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
