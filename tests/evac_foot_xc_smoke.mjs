// Headless check of Route > Evacuation route on foot over open ground (assets/osap-route.js with the cross-country planner in
// assets/osap-xc.js). Elevation tiles, JRC surface water tiles and the routers are answered by made-up test data, so the check
// is the same every run: flat ground at 100 m from the start (13.749 N, 100.491 E) to the U.S. Embassy in Bangkok, a lake
// across the straight line between them, a sheer-sided hill just past the start, and a river, 100 m wide, that runs the full height of the area.
// Checks: the Walking choice shows only for Walk; comparing offers a cross-country line and a road-and-path line; the
// cross-country line goes round the lake and the hill, crosses the river once and lists it as WX (needs a bridge, ford or boat), is longer
// than the straight line and timed at flat off-path pace (about 3 km/h), and says it is an estimate; the consulate past 60 km is said to be
// too far for a cross-country line; "On roads and paths only" offers no cross-country line and "Cross-country" offers only
// that; with the elevation tiles down the path route still answers and the failure is said, and cross-country only says why
// it has no line; a kept cross-country plan opens offline; no page errors.
// Run from the repo root: node tests/evac_foot_xc_smoke.mjs   (needs playwright and Chromium; OUT=dir saves screenshots)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { deflateSync } from "node:zlib";
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

/* ---------- made-up tiles ---------- */
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(b) { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
function png(w, h, px, ch) {
  const row = w * ch + 1, raw = Buffer.alloc(row * h);
  for (let y = 0; y < h; y++) { raw[y * row] = 0; px.copy(raw, y * row + 1, y * w * ch, (y + 1) * w * ch); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = ch === 4 ? 6 : 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const START = [13.749, 100.491], EMB = [13.736167, 100.546444];
const LAKE = { s: 13.733, n: 13.752, w: 100.510, e: 100.525 };
const RIVER = { w: 100.5340, e: 100.5349 };
/* a flat-topped hill 500 m above the plain with sheer sides, across the line just past the start */
const MESA = { s: 13.738, n: 13.756, w: 100.497, e: 100.503 };
const inMesa = (p) => p[0] > MESA.s && p[0] < MESA.n && p[1] > MESA.w && p[1] < MESA.e;
const inLake = (p) => p[0] > LAKE.s && p[0] < LAKE.n && p[1] > LAKE.w && p[1] < LAKE.e;
const water = (lat, lon) => inLake([lat, lon]) || (lon > RIVER.w && lon < RIVER.e);
function ll(z, x, y, i, j) { const n = 2 ** z; return [Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + (j + 0.5) / 256) / n))) * 180 / Math.PI, (x + (i + 0.5) / 256) / n * 360 - 180]; }
const cache = new Map();
function dem(z, x, y) {
  const key = "d" + z + "/" + x + "/" + y; if (cache.has(key)) return cache.get(key);
  const px = Buffer.alloc(256 * 256 * 3);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) { const v = (inMesa(ll(z, x, y, i, j)) ? 600 : 100) + 32768, k = (j * 256 + i) * 3; px[k] = Math.floor(v / 256); px[k + 1] = v % 256; px[k + 2] = 0; }
  const b = png(256, 256, px, 3); cache.set(key, b); return b;
}
function gsw(z, x, y) {
  const key = "w" + z + "/" + x + "/" + y; if (cache.has(key)) return cache.get(key);
  const px = Buffer.alloc(256 * 256 * 4);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
    const [lat, lon] = ll(z, x, y, i, j), k = (j * 256 + i) * 4;
    if (water(lat, lon)) { px[k] = 0; px[k + 1] = 0; px[k + 2] = 254; px[k + 3] = 255; }
  }
  const b = png(256, 256, px, 4); cache.set(key, b); return b;
}

/* ---------- routers: a straight line along the roads ---------- */
function line(a, b, n = 30) { const out = []; for (let i = 0; i <= n; i++) { const t = i / n; out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); } return out; }
const metres = (a, b) => { const r = Math.PI / 180, x = (b[1] - a[1]) * r * Math.cos((a[0] + b[0]) / 2 * r), y = (b[0] - a[0]) * r; return Math.hypot(x, y) * 6371008.8; };
function km(c) { let m = 0; for (let i = 1; i < c.length; i++) m += metres(c[i - 1], c[i]); return m; }
const osrmRoute = (c) => { const m = km(c); return { distance: m, duration: m / 1.3, geometry: { coordinates: c.map((p) => [p[1], p[0]]) }, legs: [{ distance: m, duration: m / 1.3, steps: [] }] }; };

async function open(o = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 }, ...(o.state ? { storageState: o.state } : {}) });
  const errors = [], calls = { dem: 0, gsw: 0, osrm: 0 };
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { try { return answer(r); } catch (e) { console.log("mock error: " + e.message); return r.abort(); } });
  function answer(r) {
    const u = r.request().url();
    if (o.offline) return r.abort();
    let m = u.match(/elevation-tiles-prod\/terrarium\/(\d+)\/(\d+)\/(\d+)\.png/);
    if (m) { calls.dem++; return o.demDown ? r.fulfill({ status: 503, body: "" }) : r.fulfill({ status: 200, contentType: "image/png", headers: { "Access-Control-Allow-Origin": "*" }, body: dem(+m[1], +m[2], +m[3]) }); }
    m = u.match(/global-surface-water\/tiles2021\/occurrence\/(\d+)\/(\d+)\/(\d+)\.png/);
    if (m) { calls.gsw++; return r.fulfill({ status: 200, contentType: "image/png", headers: { "Access-Control-Allow-Origin": "*" }, body: gsw(+m[1], +m[2], +m[3]) }); }
    if (/routing\.openstreetmap\.de/.test(u)) {
      calls.osrm++;
      const cs = decodeURIComponent(u.split("/driving/")[1].split("?")[0]).split(";").map((x) => x.split(",").map(Number));
      return r.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ code: "Ok", routes: [osrmRoute(line([cs[0][1], cs[0][0]], [cs[1][1], cs[1][0]]))] }) });
    }
    if (/valhalla1\.openstreetmap\.de/.test(u)) return r.fulfill({ status: 400, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "{}" });
    return r.abort();
  }
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); p.__calls = calls; p.on("pageerror", (e) => errors.push(e.message)); p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) console.log("console: " + m.text().slice(0, 200)); });
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_EVAC, null, { timeout: 60000 }); await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  await p.evaluate((s) => window.OSAP_ROUTE_SEED([s]), START);
  await p.waitForFunction(() => window.OSAP_ROUTETAB && document.getElementById("rt-evac"), null, { timeout: 30000 }); await p.waitForTimeout(500);
  /* the one-route planner sits folded under the Evac link (EPE phase 1) */
  await p.evaluate(() => { document.getElementById("rt-evone").open = true; });
  return { ctx, p, errors, calls };
}
async function plan(p, how) {
  await p.evaluate((s) => window.OSAP_ROUTETAB.seed([s]), START); await p.waitForTimeout(0);
  await p.selectOption("#rt-evto", "posts");
  if (how) await p.selectOption("#rt-evfoot", how);
  await p.click('[data-rt="evac"]');
  try { await p.waitForFunction(() => document.querySelector("#rt-evres .rtalts") || document.querySelector("#rt-evres .rtbad"), null, { timeout: 90000 }); }
  catch (e) { console.log("stuck at: " + (await p.textContent("#rt-evres")).slice(0, 300) + " | calls " + JSON.stringify(p.__calls || {})); throw e; }
  await p.waitForTimeout(600);
  return p.evaluate(() => ({ b: [...document.querySelectorAll("#rt-evres .rtalts button")].map((x) => x.textContent), txt: document.getElementById("rt-evres").textContent }));
}
async function pick(p, re) {
  const i = await p.evaluate((src) => [...document.querySelectorAll("#rt-evres .rtalts button")].findIndex((b) => new RegExp(src).test(b.textContent)), re.source);
  if (i >= 0) { await p.click('#rt-evres .rtalts button[data-alt="' + i + '"]'); await p.waitForTimeout(500); }
  return { i, r: await p.evaluate(() => window.OSAP_ROUTETAB.route()), txt: await p.textContent("#rt-evres") };
}

let state;
{
  const { ctx, p, errors, calls } = await open();
  await p.click('#rt-modes [data-mode="car"]'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.getElementById("rt-evfootl").hidden), "Drive: no Walking choice shown");
  await p.click('#rt-modes [data-mode="foot"]'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => !document.getElementById("rt-evfootl").hidden && document.getElementById("rt-evfoot").value === "both"), "Walk: the Walking choice shows, comparing by default");
  ok(await p.evaluate(() => !window.OSAP_XCOUNTRY), "the cross-country planner is not loaded until it is needed");

  const both = await plan(p);
  const bj = both.b.join(" | ");
  ok(/Cross-country ·/.test(bj) && /Roads and paths ·/.test(bj), "comparing: a cross-country line and a road-and-path line are offered (" + bj.slice(0, 260) + ")");
  ok(calls.dem > 0 && calls.gsw > 0, "elevation and surface water tiles were read (" + calls.dem + ", " + calls.gsw + ")");
  ok(/more than 60 km away in a straight line, too far for a cross-country line/.test(both.txt), "the consulate past 60 km is said to be too far for a cross-country line");

  const xc = await pick(p, /Cross-country ·/);
  const r = xc.r;
  ok(r && r.xc && !r.road, "the cross-country line is selected");
  const through = r ? r.coords.filter(inLake).length : -1;
  ok(through === 0, "the cross-country line goes round the lake (" + through + " points in it)");
  const over = r ? r.coords.filter(inMesa).length : -1;
  ok(over === 0, "the cross-country line goes round the sheer-sided hill, not over it (" + over + " points on it)");
  const straight = metres(START, EMB);
  ok(r && r.m > straight * 1.02, "it is longer than the straight line (" + Math.round(r && r.m) + " m vs " + Math.round(straight) + " m)");
  ok(r && r.s >= r.m / (3.1 / 3.6) && r.s < r.m / (2.9 / 3.6), "it is timed at flat off-path pace, about 3 km/h (" + Math.round(r && r.s / 60) + " min for " + Math.round(r && r.m) + " m)");
  ok(r && r.water.length === 1 && r.water[0].p[1] > RIVER.w - 0.002 && r.water[0].p[1] < RIVER.e + 0.002, "the river is crossed once and recorded (" + JSON.stringify(r && r.water) + ")");
  ok(/WX/.test(xc.txt) && /Water crossing, about .* needs a bridge, ford or boat/.test(xc.txt), "the crossing is listed as WX: needs a bridge, ford or boat");
  ok(/Cross-country line, an estimate/.test(xc.txt) && /does not see forest/.test(xc.txt), "the line is called an estimate and says what it cannot see");
  ok(/U\.S\. Embassy Bangkok|Embassy Bangkok/.test(xc.txt), "it ends at the embassy");
  const sum = await p.textContent("#rt-sum");
  ok(/Cross-country estimate at off-path walking pace/.test(sum), "the route summary says how the time was worked out");
  if (OUT) await p.screenshot({ path: OUT + "/evac-foot-xc.png" });
  await p.click('[data-rt="evsave"]'); await p.waitForTimeout(300);

  const paths = await plan(p, "paths");
  ok(paths.b.length && !paths.b.some((b) => /Cross-country/.test(b)), "On roads and paths only: no cross-country line (" + paths.b.length + " options)");
  const only = await plan(p, "xc");
  ok(only.b.length && only.b.every((b) => /Cross-country ·/.test(b)), "Cross-country only: every option is cross-country (" + only.b.length + ")");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  state = await ctx.storageState();
  await ctx.close();
}
{
  /* elevation down: the path route still answers and the failure is said; cross-country only says why */
  const { ctx, p, errors } = await open({ demDown: true });
  await p.click('#rt-modes [data-mode="foot"]'); await p.waitForTimeout(200);
  const both = await plan(p, "both");
  ok(both.b.some((b) => /Roads and paths ·/.test(b)) && /No cross-country line to .*elevation/.test(both.txt), "elevation down: the path route stands and the failure is said (" + both.txt.slice(0, 160) + ")");
  const only = await plan(p, "xc");
  ok(!only.b.length && /No evacuation route: no cross-country line could be worked out \(elevation/.test(only.txt), "elevation down, cross-country only: says why there is no line (" + only.txt.slice(0, 160) + ")");
  ok(!errors.length, "elevation down: no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}
{
  /* the kept cross-country plan opens offline */
  const { ctx, p, errors } = await open({ offline: true, state });
  await p.click("#rt-evsaved [data-evopen]"); await p.waitForTimeout(1000);
  const txt = await p.textContent("#rt-evres"), r = await p.evaluate(() => window.OSAP_ROUTETAB.route());
  ok(/Kept plan from/.test(txt) && r && r.xc && /WX/.test(txt) && /Cross-country line, an estimate/.test(txt), "kept cross-country plan opens offline with its water crossing");
  ok(!errors.length, "offline: no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
