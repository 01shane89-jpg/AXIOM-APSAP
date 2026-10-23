// Headless check of the weather model picker and the animated weather layers (assets/osap-weather.js, toolbar Weather button).
// Open-Meteo and RainViewer are answered with made-up but well-formed data, so the check runs with no network. Checks: the Weather
// panel lists the global models with Best match first; the model layers ask Open-Meteo for the chosen model (none for Best match,
// models=<id> otherwise) and say which model they show; a model that leaves a variable empty is named as a gap, not drawn as dry;
// the rain forecast layer colours wet cells only; the wind flow canvas animates (frames advance) and stops when switched off;
// the time slider and Play step the forecast hour; the radar loop loads all 13 frames and changes frame; "reduce motion" draws
// the wind once and leaves it still and never starts the radar loop; a phone's panel does not overflow; and the page throws nothing.
// Run from the repo root: node tests/wxmodels_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
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
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

/* a made-up 5-day grid forecast: wind turns with latitude, rain only in the south-west of any view */
const T0 = Math.floor(Date.now() / 864e5) * 86400, N = 5 * 24;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
function answer(url) {
  const u = new URL(url), lats = (u.searchParams.get("latitude") || "13.75").split(",").map(Number), lons = (u.searchParams.get("longitude") || "100.5").split(",").map(Number);
  const keys = (u.searchParams.get("hourly") || "").split(",").filter(Boolean), model = u.searchParams.get("models") || "", mlat = lats.reduce((a, b) => a + b, 0) / lats.length;
  const one = (lat, i) => ({ latitude: lat, longitude: lons[i], elevation: 5, timezone: "GMT", utc_offset_seconds: 0,
    hourly: Object.fromEntries([["time", Array.from({ length: N }, (_, s) => T0 + s * 3600)], ...keys.map((k) => [k, Array.from({ length: N }, (_, s) => {
      if (model === "ecmwf_aifs025_single" && (k === "precipitation" || k === "wind_gusts_10m")) return null;
      const V = { temperature_2m: 25 + (lat - mlat), wind_speed_10m: 12 + (s % 24) / 2, wind_direction_10m: lat > mlat ? 45 : 225, wind_gusts_10m: 20, cloud_cover: 50,
        precipitation: lat < mlat ? 3.5 : 0, us_aqi: 40 };
      return k in V ? V[k] : 0;
    })])]) });
  const list = lats.map(one);
  return list.length === 1 ? list[0] : list;
}
const RVJ = { version: "2.0", generated: Math.floor(Date.now() / 1000), host: "https://tilecache.rainviewer.com",
  radar: { past: Array.from({ length: 13 }, (_, i) => ({ time: Math.floor(Date.now() / 600000) * 600 - (12 - i) * 600, path: "/v2/radar/f" + i })), nowcast: [] }, satellite: { infrared: [] } };

async function open(viewport, extra) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport, ...(viewport.width < 600 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}), ...(extra || {}) });
  const seen = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const url = r.request().url(), h = new URL(url).host;
    if (/^api\.open-meteo\.com$|^air-quality-api\.open-meteo\.com$/.test(h)) { seen.push(url); return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(answer(url)) }); }
    if (h === "api.rainviewer.com") return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(RVJ) });
    if (h === "tilecache.rainviewer.com") { seen.push(url); return r.fulfill({ status: 200, contentType: "image/png", body: PNG }); }
    return r.abort();
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.OSAP_WX && window.__asapMap, null, { timeout: 60000 });
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  await p.click('[data-atk="weather"]');
  await p.waitForSelector("#ml-wx #wx-model", { state: "visible", timeout: 30000 });
  return { ctx, p, errors, seen };
}
const tick = (p, k, on = true) => p.evaluate(([k, on]) => { const c = document.querySelector('#ml-wx input[data-wxl="' + k + '"]'); if (c.checked !== on) c.click(); }, [k, on]);
const gridNote = (p) => p.evaluate(() => document.getElementById("wxn-grid").textContent);
const fsr = (p) => p.evaluate(() => window.OSAP_WX._test.flowState());

/* desktop */
{
  const { ctx, p, errors, seen } = await open({ width: 1400, height: 900 });
  const opts = await p.evaluate(() => [...document.querySelectorAll("#wx-model option")].map((o) => o.value));
  ok(opts[0] === "best_match" && ["ecmwf_ifs025", "gfs_seamless", "icon_seamless", "ukmo_seamless", "jma_seamless"].every((m) => opts.includes(m)) && opts.length >= 9, "model menu lists Best match first and the global models (" + opts.length + ")");

  await tick(p, "rain"); await tick(p, "flow");
  await p.waitForFunction(() => /valid/.test(document.getElementById("wxn-grid").textContent), null, { timeout: 20000 });
  const fc = seen.filter((u) => /api\.open-meteo\.com\/v1\/forecast/.test(u));
  ok(fc.length >= 1 && !/models=/.test(fc[fc.length - 1]) && /precipitation/.test(fc[fc.length - 1]), "Best match asks Open-Meteo without a models parameter, with precipitation");
  ok(/Best match/.test(await gridNote(p)), "the grid note names the model");
  const cells = await p.evaluate(() => window.OSAP_WX._test.cells("rain"));
  ok(cells.wet > 0 && cells.wet < cells.all, "rain forecast colours wet cells only (" + cells.wet + " of " + cells.all + ")");
  await p.waitForTimeout(800);
  const f1 = await fsr(p); await p.waitForTimeout(700); const f2 = await fsr(p);
  ok(f1.on && f1.field && f1.parts > 500 && f2.frames > f1.frames + 5, "wind flow animates (" + f1.parts + " streaks, " + (f2.frames - f1.frames) + " frames in 0.7 s)");
  const painted = await p.evaluate(() => { const c = document.querySelector("canvas.wxflow"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 0) n++; return n; });
  ok(painted > 200, "wind flow canvas has streaks on it (" + painted + " sampled pixels)");
  if (OUT) await p.screenshot({ path: OUT + "/wxmodels-desktop.png" });

  await p.selectOption("#wx-model", "ecmwf_ifs025");
  await p.waitForFunction(() => /ECMWF IFS.*valid/.test(document.getElementById("wxn-grid").textContent), null, { timeout: 20000 });
  ok(/models=ecmwf_ifs025/.test(seen.filter((u) => /v1\/forecast/.test(u)).pop()), "choosing ECMWF asks for models=ecmwf_ifs025");
  ok(await p.evaluate(() => JSON.parse(localStorage.getItem("osap-wx-layers")).model === "ecmwf_ifs025"), "the model choice is remembered on the device");
  ok(/most skilful/.test(await p.evaluate(() => document.getElementById("wx-mnote").textContent)), "the model note describes the chosen model");

  await p.selectOption("#wx-model", "ecmwf_aifs025_single");
  await p.waitForFunction(() => /AIFS.*valid/.test(document.getElementById("wxn-grid").textContent), null, { timeout: 20000 });
  ok(/gives nothing for: Rain, model forecast/.test(await gridNote(p)), "a model without rain says so instead of drawing it dry");
  const wetAifs = (await p.evaluate(() => window.OSAP_WX._test.cells("rain"))).wet;
  ok(wetAifs === 0, "no rain cells drawn from an empty model variable");
  await p.selectOption("#wx-model", "gfs_seamless");
  await p.waitForFunction(() => /GFS.*valid/.test(document.getElementById("wxn-grid").textContent), null, { timeout: 20000 });

  await p.evaluate(() => { const r = document.getElementById("wx-hour"); r.value = "24"; r.dispatchEvent(new Event("input", { bubbles: true })); });
  ok(/^\+24 h/.test(await p.evaluate(() => document.getElementById("wx-tlbl").textContent)), "the time slider sets +24 h");
  await p.click("#wx-play");
  await p.waitForTimeout(2000);
  const h2 = await p.evaluate(() => +document.getElementById("wx-hour").value);
  ok(h2 >= 27 && (await p.getAttribute("#wx-play", "aria-pressed")) === "true", "Play steps the forecast forward 3 hours at a time (now +" + h2 + " h)");
  await p.click("#wx-play");
  const h3 = await p.evaluate(() => +document.getElementById("wx-hour").value); await p.waitForTimeout(1200);
  ok(h3 === await p.evaluate(() => +document.getElementById("wx-hour").value), "Pause stops it");

  await tick(p, "radar");
  await p.waitForFunction(() => /Radar frame/.test((document.getElementById("wxn-radar") || {}).textContent || ""), null, { timeout: 15000 });
  await p.click("#wx-rloop");
  await p.waitForFunction(() => /looping 13 frames/.test(document.getElementById("wxn-radar").textContent), null, { timeout: 15000 });
  const fr = new Set(seen.filter((u) => /tilecache/.test(u)).map((u) => /radar\/(f\d+)/.exec(u)[1]));
  ok(fr.size === 13, "radar loop loads all 13 frames (" + fr.size + ")");
  const s1 = await p.evaluate(() => document.getElementById("wxn-radar").textContent); await p.waitForTimeout(2600);
  const s2 = await p.evaluate(() => document.getElementById("wxn-radar").textContent);
  ok(s1 !== s2 && /Loop, frame/.test(s2), "radar loop changes frame (" + s2 + ")");
  await p.click("#wx-rloop");
  await tick(p, "radar", false);

  await tick(p, "flow", false);
  const f3 = await fsr(p); await p.waitForTimeout(500); const f4 = await fsr(p);
  ok(!f3.on && f3.frames === f4.frames && await p.evaluate(() => document.querySelector("canvas.wxflow").style.display === "none"), "switching wind flow off stops and hides it");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}

/* reduce motion: the wind is drawn once and left still; the radar loop never starts */
{
  const { ctx, p, errors } = await open({ width: 1200, height: 800 }, { reducedMotion: "reduce" });
  await tick(p, "flow");
  await p.waitForFunction(() => /valid/.test(document.getElementById("wxn-grid").textContent), null, { timeout: 20000 });
  await p.waitForTimeout(300);
  const a = await fsr(p); await p.waitForTimeout(800); const b = await fsr(p);
  ok(a.still && a.frames > 0 && a.frames === b.frames, "reduce motion: wind streaks drawn once, not animated");
  await tick(p, "radar"); await p.click("#wx-rloop");
  await p.waitForFunction(() => /Radar frame/.test(document.getElementById("wxn-radar").textContent), null, { timeout: 15000 });
  ok(!/looping/.test(await p.evaluate(() => document.getElementById("wxn-radar").textContent)), "reduce motion: the radar loop does not start");
  ok(!errors.length, "no page errors (reduce motion)" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}

/* phone */
{
  const { ctx, p, errors } = await open({ width: 390, height: 844 });
  await tick(p, "flow"); await tick(p, "rain");
  await p.waitForFunction(() => /valid/.test(document.getElementById("wxn-grid").textContent), null, { timeout: 20000 });
  const r = await p.evaluate(() => { const w = document.getElementById("ml-wx"), t = w.querySelector(".wxtime").getBoundingClientRect(), s = document.getElementById("wx-model").getBoundingClientRect();
    return { over: w.scrollWidth - w.clientWidth, tr: t.right, sr: s.right, vw: innerWidth }; });
  ok(r.over <= 1 && r.tr <= r.vw && r.sr <= r.vw, "phone: model menu and time slider fit the screen (overflow " + r.over + ")");
  await p.waitForTimeout(600);
  const f = await fsr(p);
  ok(f.parts > 0 && f.parts <= 1500 && f.frames > 0, "phone: wind flow runs with fewer streaks (" + f.parts + ")");
  if (OUT) await p.screenshot({ path: OUT + "/wxmodels-phone.png" });
  ok(!errors.length, "no page errors (phone)" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}

await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "ALL PASSED");
process.exit(fails ? 1 : 0);
