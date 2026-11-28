// Headless check of Your sky on Today (assets/osap-yoursky.js). Fixtures stand in for Element 84 Earth Search, NASA CMR and
// Open-Meteo; the picture reader (OSAP_SAT.render, checked in its own tests) is replaced by a flat canvas; every other outside
// host is blocked.
//   - Before a tap the card only offers "Show my sky" and "Use the place on the map", and nothing is sent anywhere.
//   - "Use the place on the map" over Bangkok: only the point rounded to 0.01 degrees and a 4 km box leave the page; the newest
//     pass at 30% scene cloud or less is drawn with its time and cloud, the cloudier newer pass is named, the next picture and
//     radar passes and the country's satellite count are shown.
//   - Reloaded: the card starts again by itself on the map (remembered), and the position is never stored.
//   - Earth Search down: the card says the picture could not be read and still shows the radar pass; no page errors.
//   - "Show my sky" with the browser's position: the same card, around you. A 390 px phone: nothing scrolls sideways.
// Run from the repo root: node tests/yoursky_smoke.mjs   (playwright and Chromium). OUT=dir saves screenshots.
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
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

const NOW = Date.now(), DAY = 864e5, H = (ms) => new Date(ms).toISOString().slice(0, 19) + "Z";
// d days from now, less an hour: whole-day ages ("5 days ago", "in about 2 days") whatever the time of day the test runs
// (it once used 03:54Z on day d, which read "6 days ago" after midday UTC)
const at = (d) => NOW + d * DAY - 36e5;
const feat = (sat, t, cloud) => ({ id: "S2" + sat + "_47PPR_" + H(t).slice(0, 10).replace(/-/g, "") + "_0_L2A", properties: { platform: "sentinel-2" + sat.toLowerCase(), datetime: H(t), "eo:cloud_cover": cloud, "grid:code": "MGRS-47PPR" },
  assets: { visual: { href: "https://sentinel-cogs.example.org/47/P/PR/" + sat + H(t).slice(0, 10) + "/TCI.tif" } }, links: [{ rel: "self", href: "https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/x" + sat }] });
const ES = { type: "FeatureCollection", features: [feat("B", at(-2), 71.4), feat("C", at(-5), 12.1), feat("A", at(-8), 3), feat("C", at(-15), 9), feat("A", at(-18), 40)] };
const s1t = (d) => { const t = Math.floor((NOW + d * DAY) / DAY) * DAY + 23.1 * 36e5; return { time_start: H(t), title: "OPERA_L2_RTC-S1_T062-131234-IW1_" + H(t).replace(/[-:]/g, "").slice(0, 15) + "Z_20261127T000000Z_S1D_30_v1.0" }; };
const CMR = { feed: { entry: [s1t(-9), s1t(-21)] } };
const hours = []; const cc = []; for (let k = -24; k < 16 * 24; k++) { hours.push(new Date(Math.floor(NOW / 36e5) * 36e5 + k * 36e5).toISOString().slice(0, 16)); cc.push(42); }
const OM = { hourly: { time: hours, cloud_cover: cc } };

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
async function today(opts = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: opts.vp || { width: 1400, height: 950 }, ...(opts.geo ? { geolocation: opts.geo, permissions: ["geolocation"] } : {}) });
  const sent = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url(), h = new URL(u).hostname;
    // Your sky's own asks (the app's weather reads its own forecast points from Open-Meteo, never the person's)
    if (/earth-search|cmr\.earthdata/.test(h) || (/open-meteo/.test(h) && /hourly=cloud_cover&forecast_days=16/.test(u))) sent.push(u);
    if (/earth-search/.test(h)) return opts.esDown ? r.fulfill({ status: 503, body: "" }) : r.fulfill({ contentType: "application/json", body: JSON.stringify(ES) });
    if (/cmr\.earthdata/.test(h)) return r.fulfill({ contentType: "application/json", body: JSON.stringify(CMR) });
    if (/open-meteo/.test(h) && /hourly=cloud_cover&forecast_days=16/.test(u)) return r.fulfill({ contentType: "application/json", body: JSON.stringify(OM) });
    return r.abort();
  });
  await ctx.addInitScript(() => {
    try { localStorage.setItem("osap-home", "today"); } catch (e) {}
    // the picture reader is checked in its own tests: here it answers with a flat canvas, and says which pass it was given
    const hook = () => { if (!window.OSAP_SAT) return setTimeout(hook, 50);
      window.OSAP_SAT.render = (pass, bb, w, h) => { window.__skyRender = { key: pass.key, bb, w, h }; const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").fillRect(0, 0, w, h); return Promise.resolve({ canvas: c, filled: 1, clip: 0, bands: false }); }; };
    hook();
  });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#timeline", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.OSAP_TODAY && window.OSAP_SKYQ && window.TSAP && window.__asapMap, null, { timeout: 60000 });
  await p.evaluate(() => { window.__asapMap.setView([13.756331, 100.501765], 12, { animate: false }); if (!window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.show(); });
  await p.waitForSelector("#td-sky:not([hidden])", { timeout: 30000 });
  return { p, ctx, errors, sent };
}
const card = (p) => p.evaluate(() => (document.getElementById("td-sky") || {}).innerText || "");
const done = (p) => p.waitForFunction(() => { const s = window.OSAP_SKYQ.state(); return s.step === "done" && (s.drawn || s.err) && s.space && s.sats; }, null, { timeout: 30000 }).catch(() => {});

{
  const { p, ctx, errors, sent } = await today();
  const t = await card(p);
  ok(/Show my sky/.test(t) && /Use the place on the map/.test(t) && /rounded to about 1 km/.test(t), "before a tap: two buttons and the privacy line");
  await p.waitForTimeout(1500);
  ok(sent.length === 0, "nothing is sent before a tap (" + sent.length + ")");
  await p.click('#td-sky [data-ysky="map"]');
  await done(p);
  const s = await p.evaluate(() => ({ st: window.OSAP_SKYQ.state(), r: window.__skyRender, ls: localStorage.getItem("osap-sky") }));
  const txt = await card(p);
  ok(s.st.pt && s.st.pt.la === 13.76 && s.st.pt.lo === 100.5, "the point is rounded to 0.01 degrees (" + JSON.stringify(s.st.pt) + ")");
  // Open-Meteo latitude=..&longitude=..; NASA CMR point=lon,lat
  const pts = sent.map((u) => { const d = decodeURIComponent(u), m = d.match(/latitude=(-?[\d.]+)&longitude=(-?[\d.]+)/), q = d.match(/point=(-?[\d.]+),(-?[\d.]+)/); return m ? [0, m[1], m[2]] : q ? [0, q[2], q[1]] : null; }).filter(Boolean);
  ok(pts.length >= 2 && pts.every((m) => [m[1], m[2]].every((v) => (v.split(".")[1] || "").length <= 3) && Math.abs(+m[1] - 13.76) < 0.002 && Math.abs(+m[2] - 100.5) < 0.002), "every point sent is the rounded one (" + pts.map((m) => m[1] + "," + m[2]).join(" ") + ")");
  ok(!sent.some((u) => /13\.7563|100\.5017/.test(decodeURIComponent(u))), "the exact centre never leaves the page");
  const bb = s.r && s.r.bb, kmW = bb && (bb[2] - bb[0]) * 111.32 * Math.cos(13.76 * Math.PI / 180);
  ok(bb && Math.abs(kmW - 4) < 0.05 && Math.abs((bb[1] + bb[3]) / 2 - 13.76) < 1e-4, "the picture is a 4 km box around the point (" + (kmW && kmW.toFixed(2)) + " km)");
  ok(s.r && /^S2C_/.test(s.r.key) && s.st.pic && Math.round(s.st.pic.cloud) === 12, "the newest pass at 30% scene cloud or less is drawn, not the newer cloudy one (" + (s.r && s.r.key) + ")");
  ok(/Sentinel-2C/.test(txt) && /scene cloud 12%/.test(txt) && /5 days ago/.test(txt), "its satellite, age and scene cloud are shown");
  ok(/A newer pass .*scene cloud 71%.*was cloudier/.test(txt), "the cloudier newer pass is named");
  ok(/Next picture/i.test(txt) && /in about 2 days · Sentinel-2A · cloud forecast 42%/.test(txt), "next picture pass (Sentinel-2A's track, 10 days after its last) with its cloud forecast");
  ok(/Next radar pass/i.test(txt) && /Sentinel-1D T062/.test(txt) && /sees through cloud/.test(txt), "next radar pass with its track");
  ok(/Over the country, 12 hours/i.test(txt) && /reconnaissance or imaging satellites/.test(txt) && /not just this spot/.test(txt), "the country's satellite count, said to be for the whole country");
  ok(/Contains modified Copernicus Sentinel data/.test(txt) && /rules sky-v1/.test(txt), "credit and rules shown");
  ok(s.ls && !/13\.|100\./.test(s.ls) && JSON.parse(s.ls).src === "map", "only the choice is remembered, never the position (" + s.ls + ")");
  ok(await p.evaluate(() => !!document.querySelector("#td-sky .yspic canvas")), "the picture is on the card");
  // Skyline match (assets/osap-skyline.js) owns the "sky-css" style and data-sky buttons: this card must not take either
  ok(await p.evaluate(() => !!document.getElementById("ysky-css") && !document.getElementById("sky-css") && !document.querySelector("#td-sky [data-sky]")), "no clash with Skyline match's style or buttons");
  if (OUT) await p.locator("#td-sky").screenshot({ path: OUT + "/sky-map.png" });
  // reloaded: starts again by itself
  await p.reload({ waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.OSAP_TODAY && window.OSAP_SKYQ && window.__asapMap, null, { timeout: 60000 });
  await p.evaluate(() => { if (!window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.show(); });
  await done(p);
  // the map can still be settling after a reload (seen 0.01 to 0.02 apart): the card must be on the map's place within about 5 km, not exactly
  const again = await p.evaluate(() => { const s = window.OSAP_SKYQ.state(), m = window.__asapMap.getCenter(); return { step: s.step, drawn: s.drawn, pt: s.pt, la: Math.round(m.lat * 100) / 100, lo: Math.round(m.lng * 100) / 100 }; });
  ok(again.step === "done" && again.drawn && /Sentinel-2C/.test(await card(p)) && Math.abs(again.pt.la - again.la) <= 0.05 && Math.abs(again.pt.lo - again.lo) <= 0.05, "after a reload the card runs again by itself, on the map's place (" + JSON.stringify(again) + ")");
  // Compare two dates opens Satellite before/after on the point
  await p.click('#td-sky [data-ysky="cmp"]');
  await p.waitForFunction(() => window.OSAP_SAT.isOpen && window.OSAP_SAT.isOpen(), null, { timeout: 10000 }).catch(() => {});
  const c = await p.evaluate(() => { const m = window.__asapMap.getCenter(), q = window.OSAP_SKYQ.state().pt; return { open: window.OSAP_SAT.isOpen(), la: m.lat, lo: m.lng, pla: q.la, plo: q.lo, today: window.OSAP_TODAY.isOpen() }; });
  ok(c.open && !c.today && Math.abs(c.la - c.pla) < 0.001 && Math.abs(c.lo - c.plo) < 0.001, "Compare two dates closes Today and opens Satellite before/after on the point (" + JSON.stringify(c) + ")");
  ok(!errors.length, "no page errors " + JSON.stringify(errors.slice(0, 3)));
  await ctx.close();
}
{
  const { p, ctx, errors } = await today({ esDown: true });
  await p.click('#td-sky [data-ysky="map"]');
  await done(p);
  const txt = await card(p);
  ok(/picture could not be read just now/.test(txt) && /Sentinel-2 pass list could not be read/.test(txt), "Earth Search down: said plainly, no endless wait");
  ok(/Sentinel-1D T062/.test(txt), "the radar pass is still shown");
  ok(!errors.length, "no page errors " + JSON.stringify(errors.slice(0, 3)));
  await ctx.close();
}
{
  const { p, ctx, errors } = await today({ geo: { latitude: 13.7563, longitude: 100.5018, accuracy: 25 }, vp: { width: 390, height: 844 } });
  await p.click('#td-sky [data-ysky="me"]');
  // the location may move the app to the person's country (a reload): wait for the card to come back
  await p.waitForTimeout(2500);
  await p.waitForFunction(() => window.OSAP_SKYQ && window.OSAP_TODAY, null, { timeout: 60000 });
  await p.evaluate(() => { if (!window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.show(); });
  await done(p);
  const txt = await card(p);
  ok(/Around you \(13\.76, 100\.50/.test(txt) && /Sentinel-2C/.test(txt), "Show my sky: the card around you, rounded");
  const wide = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1 || [...document.querySelectorAll("#td-sky *")].some((e) => e.getBoundingClientRect().right > window.innerWidth + 1));
  ok(!wide, "390 px phone: nothing runs off the side");
  if (OUT) await p.locator("#td-sky").screenshot({ path: OUT + "/sky-phone.png" });
  ok(!errors.length, "no page errors " + JSON.stringify(errors.slice(0, 3)));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
