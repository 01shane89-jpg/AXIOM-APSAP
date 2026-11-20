// Skyline match (assets/osap-skyline.js) in a real browser: Photo and video check offers "Skyline match" under a photo; the window
// shows the photo, taps trace the skyline; Search scores the map's area (elevation answered here from a made-up terrain of hills
// in place of Mapterhorn, no network) and finds the spot the skyline was traced from; the reading, the proposals table, the map
// markers with view wedges, the photo-vs-terrain chart, the copied record (rules, photo SHA-256, inputs, "proposal, not
// verified"); too few taps says so; on a phone it fits. No page errors. OUT=dir saves screenshots.
// Run from the repo root: node tests/skyline_smoke.mjs   (playwright and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright";
const SK = createRequire(import.meta.url)("../assets/osap-skyline.js");
const OUT = process.env.OUT || "";
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const RAD = Math.PI / 180;
const HILLS = [[45.03, 7.05, 1400, 0.012], [44.98, 7.08, 900, 0.008], [45.06, 6.96, 1800, 0.02], [44.95, 6.94, 1100, 0.01]];
const elev = (la, lo) => 200 + HILLS.reduce((s, h) => s + h[2] * Math.exp(-(((la - h[0]) ** 2 + ((lo - h[1]) * Math.cos(45 * RAD)) ** 2) / (2 * h[3] ** 2))), 0);
const cam = [45.0, 7.0], heading = 40, fov = 66, aspect = 0.75;
const sky = SK.horizon(elev, cam[0], cam[1], 1.7, 25), f = 0.5 / Math.tan(fov / 2 * RAD), PTS = [];
for (let k = 0; k <= fov; k += 4) { const az = heading - fov / 2 + k, e = sky[((Math.round(az) % 360) + 360) % 360] + 1, x = Math.tan((k - fov / 2) * RAD) * f; PTS.push([0.5 + x, 0.5 - Math.tan(e * RAD) * Math.sqrt(f * f + x * x) / aspect]); }
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
async function start(opts) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#th/map", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_PHOTOCHECK && window.OSAP_SKYLINE && window.OSAP_LIDAR, null, { timeout: 60000 });
  await p.waitForTimeout(2000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
  // elevation from the made-up hills, in place of Mapterhorn
  await p.evaluate((H) => {
    const R = Math.PI / 180, el = (la, lo) => 200 + H.reduce((s, h) => s + h[2] * Math.exp(-(((la - h[0]) ** 2 + ((lo - h[1]) * Math.cos(45 * R)) ** 2) / (2 * h[3] ** 2))), 0);
    window.__demCalls = 0;
    window.OSAP_LIDAR.dem = (z, x, y, sig, size) => { window.__demCalls++; const n = 2 ** z, h = new Float32Array(size * size);
      for (let j = 0; j < size; j++) { const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + (j + 0.5) / size) / n))) / R; for (let i = 0; i < size; i++) h[j * size + i] = el(lat, (x + (i + 0.5) / size) / n * 360 - 180); }
      return Promise.resolve({ h, z, size }); };
  }, HILLS);
  return { ctx, p, errors };
}
{
  const { ctx, p, errors } = await start({ viewport: { width: 1360, height: 900 } });
  await p.evaluate(() => window.OSAP_PHOTOCHECK.open()); await p.waitForTimeout(400);
  const png = Buffer.from((await p.evaluate(() => { const c = document.createElement("canvas"); c.width = 400; c.height = 300; const x = c.getContext("2d"); x.fillStyle = "#87b5e0"; x.fillRect(0, 0, 400, 300); x.fillStyle = "#4a6b3a"; x.beginPath(); x.moveTo(0, 170); x.lineTo(120, 110); x.lineTo(220, 150); x.lineTo(400, 120); x.lineTo(400, 300); x.lineTo(0, 300); x.fill(); return c.toDataURL("image/png"); })).split(",")[1], "base64");
  await p.setInputFiles("#phc input[data-phc-file]", { name: "ridge.png", mimeType: "image/png", buffer: png }); await p.waitForTimeout(800);
  ok(await p.evaluate(() => !!document.querySelector("#phc [data-phc-sky]")), "Photo and video check offers Skyline match under a photo");
  await p.click("#phc [data-phc-sky]"); await p.waitForTimeout(400);
  ok(await p.evaluate(() => window.OSAP_SKYLINE.isOpen() && !!document.querySelector("#sky .pic img")), "Skyline match opens with the photo");
  ok(/SHA-256 [0-9a-f]{64}/.test(await p.textContent("#sky .note")), "the photo's SHA-256 is carried over");
  // taps on the photo
  const box = await p.evaluate(() => { const r = document.querySelector("#sky .pic img").getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
  for (const [x, y] of [[0.1, 0.5], [0.3, 0.37], [0.6, 0.5]]) await p.mouse.click(box[0] + x * box[2], box[1] + y * box[3]);
  ok(await p.evaluate(() => window.OSAP_SKYLINE.state().pts === 3 && document.querySelectorAll("#sky .pic svg circle").length === 3 && !!document.querySelector("#sky .pic svg polyline")), "taps on the photo trace the skyline");
  await p.click('#sky [data-sky="undo"]'); await p.click('#sky [data-sky="undo"]');
  await p.click('#sky [data-sky="run"]'); await p.waitForTimeout(200);
  ok(/at least 3 taps/.test(await p.textContent("#sky .err")), "too few taps: it says what to do");
  // the skyline as traced from the known spot
  await p.evaluate(([pts]) => { window.OSAP_SKYLINE.setPoints(pts); }, [PTS]);
  await p.fill('#sky [data-sky="fov"]', String(fov)); await p.dispatchEvent('#sky [data-sky="fov"]', "change");
  await p.selectOption('#sky [data-sky="area"]', "10");
  await p.evaluate(() => { window.__asapMap.setView([45.01, 7.01], 12, { animate: false }); });
  await p.evaluate(() => { const s = window.OSAP_SKYLINE; s.__aspect = s.state().aspect; });
  // the photo here is 4:3, the trace was made for 4:3
  const t0 = Date.now();
  await p.click('#sky [data-sky="run"]');
  ok(await p.evaluate(() => window.OSAP_SKYLINE.state().busy && !!document.querySelector("#sky .bar")), "searching shows a progress bar and Stop");
  await p.waitForFunction(() => !window.OSAP_SKYLINE.state().busy, null, { timeout: 120000 });
  const took = Date.now() - t0, rec = await p.evaluate(() => window.OSAP_SKYLINE.result());
  ok(rec && rec.proposals.length >= 3, "proposals listed (" + (rec && rec.proposals.length) + ", " + took + " ms)");
  const best = rec.proposals[0], dkm = SK.km([best.lat, best.lon], cam);
  ok(dkm < 1 && Math.abs(best.facing_deg - heading) <= 8, "the best proposal is within 1 km of the spot the skyline was traced from (smooth made-up hills look alike along the line of sight) (" + dkm.toFixed(2) + " km off, facing " + best.facing_deg + "°)");
  ok(rec.rules === "skyline-v1" && rec.status === "proposal, not verified" && /^[0-9a-f]{64}$/.test(rec.photo.sha256) && rec.inputs.fov === fov && /Mapterhorn/.test(rec.elevation) && /MGRS|\d/.test(best.mgrs || ""), "the record: rules, status, photo SHA-256, inputs, elevation source, grid");
  const vt = await p.textContent("#sky .verd");
  ok(/fits clearly better|Several spots fit/.test(vt), "the plain-words reading: " + vt.trim().slice(0, 90));
  ok(await p.evaluate(() => document.querySelectorAll("#sky tbody tr").length >= 3 && !!document.querySelector("#sky svg polyline[stroke-dasharray]")), "proposals table and the photo-vs-terrain chart");
  ok(await p.evaluate(() => { let n = 0, w = 0; window.__asapMap.eachLayer((l) => { if (l instanceof window.L.CircleMarker && l.getTooltip && /Proposal \d/.test(String(l.getTooltip() && l.getTooltip().getContent()))) n++; if (l instanceof window.L.Polygon && l.options.dashArray === "4 4") w++; }); return n >= 3 && w >= 3; }), "proposals on the map with view wedges");
  ok(/never a confirmation/.test(await p.textContent("#sky .note")), "says proposals, never a confirmation");
  await p.click('#sky [data-sky="sel:1"]'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => window.OSAP_SKYLINE.state().sel === 1 && document.querySelector('#sky [data-sky="sel:1"]').getAttribute("aria-pressed") === "true"), "picking another proposal selects it");
  ok(await p.evaluate(() => window.__demCalls) > 0 && await p.evaluate(() => window.__demCalls) <= 64, "elevation tiles asked once per tile, bounded (" + await p.evaluate(() => window.__demCalls) + ")");
  if (OUT) await p.screenshot({ path: OUT + "/skyline.png" });
  ok(!errors.length, "no page errors " + JSON.stringify(errors.slice(0, 3)));
  await ctx.close();
}
{
  const { ctx, p, errors } = await start({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  await p.evaluate(() => { const c = document.createElement("canvas"); c.width = 400; c.height = 300; c.getContext("2d").fillRect(0, 0, 10, 10); window.OSAP_SKYLINE.open({ url: c.toDataURL(), name: "x.png", sha: "a".repeat(64) }); }); await p.waitForTimeout(400);
  const fit = await p.evaluate(() => [document.documentElement.scrollWidth <= innerWidth + 1, Math.min(...[...document.querySelectorAll("#sky button:not([data-osheet-go]), #sky select, #sky input")].map((b) => b.getBoundingClientRect().height))]);
  ok(fit[0] && fit[1] >= 40, "phone: no sideways scroll, controls at least 40 px " + JSON.stringify(fit) + await p.evaluate(() => [...document.querySelectorAll("#sky button:not([data-osheet-go]), #sky select, #sky input")].filter((b) => b.getBoundingClientRect().height < 40).map((b) => b.outerHTML.slice(0, 80)).join(" | ")));
  if (OUT) await p.screenshot({ path: OUT + "/skyline-phone.png" });
  ok(!errors.length, "phone: no page errors " + JSON.stringify(errors.slice(0, 3)));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
