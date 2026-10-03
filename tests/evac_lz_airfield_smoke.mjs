// Headless check of Route > Evacuation route to "Nearest landing zone (LZ)" and "Airfield of any size" (assets/osap-route.js,
// using the landing zone finder's scan() in assets/osap-lz.js). Elevation tiles, OpenStreetMap (Overpass) and the routers are
// answered by made-up test data (the same ground as tests/lz_smoke.mjs round 13.75 N, 100.50 E), so the check is the same
// every run.
// Checks: both destinations are offered; nearest LZ loads the finder on demand, searches round waypoint A without opening the
// Find LZ card, routes to candidates within the search radius and labels each "candidate from open data, verify on the
// ground"; the mapped helipad is offered; airfields of any size include an airstrip and a military airfield from
// OpenStreetMap with the mapped runway length, leave out a model-aircraft field and a disused one, and keep the reference
// airports; with Overpass down the reference airports still answer and the failure is said; a kept LZ plan opens offline
// with its note; no page errors.
// Run from the repo root: node tests/evac_lz_airfield_smoke.mjs   (needs playwright and Chromium; OUT=dir saves screenshots)
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

/* ---------- made-up elevation: terrarium PNG tiles (flat at 100 m, steep east of 100.512 E) ---------- */
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(b) { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const EAST = 100.512;
function elev(lat, lon) { return 100 + (lon > EAST ? (lon - EAST) * 108000 * 0.35 : 0); }
const tiles = new Map();
function tile(z, x, y) {
  const key = z + "/" + x + "/" + y; if (tiles.has(key)) return tiles.get(key);
  const n = 2 ** z, rgb = Buffer.alloc(256 * 256 * 3);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
    const lon = (x + (i + 0.5) / 256) / n * 360 - 180, lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + (j + 0.5) / 256) / n))) * 180 / Math.PI;
    const v = elev(lat, lon) + 32768, k = (j * 256 + i) * 3;
    rgb[k] = Math.floor(v / 256); rgb[k + 1] = Math.floor(v) % 256; rgb[k + 2] = Math.round((v % 1) * 256) % 256;
  }
  const b = png(256, 256, rgb); tiles.set(key, b); return b;
}

/* ---------- made-up OpenStreetMap ---------- */
const box = (s, w, n, e) => [{ lat: s, lon: w }, { lat: s, lon: e }, { lat: n, lon: e }, { lat: n, lon: w }, { lat: s, lon: w }];
const START = [13.749, 100.491];
const OBST = { elements: [
  { type: "way", id: 1, tags: { landuse: "forest" }, geometry: box(13.752, 100.484, 13.766, 100.4985) },
  { type: "way", id: 2, tags: { landuse: "residential", name: "Test Village" }, geometry: box(13.733, 100.488, 13.7445, 100.507) },
  { type: "way", id: 4, tags: { landuse: "farmland" }, geometry: box(13.7455, 100.484, 13.7515, 100.502) },
  { type: "way", id: 5, tags: { building: "house" }, geometry: box(13.7484, 100.4929, 13.7486, 100.4931) },
  { type: "way", id: 6, tags: { natural: "water" }, geometry: box(13.7525, 100.5045, 13.757, 100.5105) },
  { type: "way", id: 7, tags: { power: "line" }, geometry: [{ lat: 13.744, lon: 100.5035 }, { lat: 13.768, lon: 100.5035 }] },
  { type: "node", id: 8, lat: 13.7505, lon: 100.5005, tags: { aeroway: "helipad", name: "Test Pad" } }
] };
const STRIP = [14.02, 100.75], MIL = [13.62, 100.30];
const FIELDS = { elements: [
  { type: "way", id: 101, center: { lat: STRIP[0], lon: STRIP[1] }, tags: { aeroway: "airstrip", name: "Test Farm Strip", surface: "grass" } },
  { type: "way", id: 102, center: { lat: MIL[0], lon: MIL[1] }, tags: { aeroway: "aerodrome", military: "airfield", name: "Test Air Base", icao: "VTXX" } },
  { type: "node", id: 103, lat: 13.76, lon: 100.52, tags: { aeroway: "aerodrome", "aerodrome:type": "model", name: "Test RC Club" } },
  { type: "node", id: 104, lat: 13.77, lon: 100.47, tags: { aeroway: "aerodrome", name: "Old Strip", disused: "yes" } }
] };
const RUNWAY = { elements: [{ type: "way", id: 201, tags: { aeroway: "runway", surface: "grass" }, geometry: [{ lat: STRIP[0] - 0.004, lon: STRIP[1] }, { lat: STRIP[0] + 0.004, lon: STRIP[1] }] }] };

/* ---------- routers: a straight line ---------- */
function line(a, b, n = 30) { const out = []; for (let i = 0; i <= n; i++) { const t = i / n; out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); } return out; }
function km(c) { let m = 0; for (let i = 1; i < c.length; i++) { const dy = (c[i][0] - c[i - 1][0]) * 111000, dx = (c[i][1] - c[i - 1][1]) * 111000 * Math.cos(c[i][0] * Math.PI / 180); m += Math.hypot(dx, dy); } return m; }
const osrmRoute = (c) => { const m = km(c); return { distance: m, duration: m / 15, geometry: { coordinates: c.map((p) => [p[1], p[0]]) }, legs: [{ distance: m, duration: m / 15, steps: [] }] }; };

async function open(o = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 }, ...(o.state ? { storageState: o.state } : {}) });
  const errors = [], calls = { lz: 0, fields: 0, runways: 0, osrm: 0, log: [] };
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    try { return answer(r); } catch (e) { console.log("mock error: " + e.message); return r.abort(); }
  });
  function answer(r) {
    const u = r.request().url();
    if (o.offline) return r.abort();
    const m = u.match(/elevation-tiles-prod\/terrarium\/(\d+)\/(\d+)\/(\d+)\.png/);
    if (m) return r.fulfill({ status: 200, contentType: "image/png", headers: { "Access-Control-Allow-Origin": "*" }, body: tile(+m[1], +m[2], +m[3]) });
    if (/\/api\/interpreter/.test(u)) {
      let q = "";
      try { const b = r.request().postDataBuffer(); q = decodeURIComponent(String(b ? b.toString("utf8") : "").replace(/^data=/, "").replace(/\+/g, " ")); } catch (e) { console.log("could not read the Overpass body: " + e.message); }
      calls.log.push(q.slice(0, 60));
      const json = (j) => r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(j) });
      if (/aeroway"="runway"\]\(around/.test(q)) { calls.runways++; return o.osmDown ? r.fulfill({ status: 504, body: "busy" }) : json(RUNWAY); }
      if (/aerodrome\|airstrip\|heliport/.test(q)) { calls.fields++; return o.osmDown ? r.fulfill({ status: 504, body: "busy" }) : json(FIELDS); }
      calls.lz++; return json(OBST);
    }
    if (/routing\.openstreetmap\.de/.test(u)) {
      calls.osrm++;
      const cs = decodeURIComponent(u.split("/driving/")[1].split("?")[0]).split(";").map((x) => x.split(",").map(Number));
      /* the road stops 300 m short of the end, as it would short of an LZ in a field */
      const a = [cs[0][1], cs[0][0]], b = [cs[1][1], cs[1][0]], end = [b[0] - 0.0027, b[1]];
      return r.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ code: "Ok", routes: [osrmRoute(line(a, end))] }) });
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
  return { ctx, p, errors, calls };
}
async function plan(p, to) {
  await p.evaluate((s) => window.OSAP_ROUTETAB.seed([s]), START); await p.waitForTimeout(300);
  await p.selectOption("#rt-evto", to);
  await p.click('[data-rt="evac"]');
  try { await p.waitForFunction(() => document.querySelector("#rt-evres .rtalts") || document.querySelector("#rt-evres .rtbad"), null, { timeout: 90000 }); }
  catch (e) { console.log("stuck at: " + (await p.textContent("#rt-evres")).slice(0, 300) + " | calls " + JSON.stringify(p.__calls || {})); throw e; }
  await p.waitForTimeout(600);
  return p.evaluate(() => ({ b: [...document.querySelectorAll("#rt-evres .rtalts button")].map((x) => x.textContent), txt: document.getElementById("rt-evres").textContent,
    st: window.OSAP_ROUTETAB.state(), card: !!document.getElementById("lz-card") && !document.getElementById("lz-card").hidden }));
}
const metres = (a, b) => { const r = Math.PI / 180, x = (b[1] - a[1]) * r * Math.cos((a[0] + b[0]) / 2 * r), y = (b[0] - a[0]) * r; return Math.hypot(x, y) * 6371008.8; };

let state;
{
  const { ctx, p, errors, calls } = await open();
  const opts = await p.evaluate(() => [...document.querySelectorAll("#rt-evto option")].map((o) => o.value + ":" + o.textContent));
  ok(opts.some((o) => /^lz:Nearest landing zone/.test(o)) && opts.some((o) => /^airfields:Airfield of any size/.test(o)), "Evacuation route offers Nearest landing zone and Airfield of any size (" + opts.join(" | ") + ")");
  ok(await p.evaluate(() => !window.OSAP_LZ), "the landing zone finder is not loaded until it is needed");

  /* nearest LZ */
  const lz = await plan(p, "lz");
  ok(lz.b.length >= 1 && /Landing zone candidate|Mapped helipad/.test(lz.b.join(" ")), "nearest LZ: routed to a landing zone (" + (lz.b[0] || lz.txt).slice(0, 120) + ")");
  ok(calls.lz >= 1, "nearest LZ: the finder searched OpenStreetMap obstacles round the start (" + calls.lz + ")");
  const end = lz.st.wps[lz.st.wps.length - 1];
  ok(end && metres(START, [end.lat, end.lon]) <= 2100, "nearest LZ: the destination is within the 2 km search (" + (end ? Math.round(metres(START, [end.lat, end.lon])) : "?") + " m)");
  ok(/verify on the ground/.test(lz.txt) && /not a surveyed LZ/.test(lz.txt), "nearest LZ: labelled a candidate from open data, verify on the ground");
  ok(/The road ends about .* short of it/.test(lz.txt), "nearest LZ: the off-road stretch past the road's end is shown");
  ok(!lz.card, "nearest LZ: the Find LZ card stays closed");
  const all = await p.evaluate(() => [...document.querySelectorAll("#rt-evres .rtalts button")].length);
  ok(all >= 1, "nearest LZ: options listed (" + all + ")");
  if (OUT) await p.screenshot({ path: OUT + "/evac-lz.png" });
  await p.click('[data-rt="evsave"]'); await p.waitForTimeout(300);

  /* airfields of any size */
  const af = await plan(p, "airfields");
  const names = af.b.join(" | ");
  ok(/Test Farm Strip \(Airstrip\)/.test(names) || /Test Air Base \(VTXX\) \(Military airfield\)/.test(names), "airfields: an airstrip or military airfield from OpenStreetMap is offered (" + names.slice(0, 200) + ")");
  ok(!/RC Club|Old Strip/.test(af.txt), "airfields: model-aircraft and disused fields are left out");
  ok(calls.fields >= 1, "airfields: OpenStreetMap was asked (" + calls.fields + ")");
  ok(/Mapped is not open/.test(af.txt), "airfields: says mapped is not open");
  /* the strip's runway: plan from next to the strip so it is the nearest */
  await p.evaluate((s) => window.OSAP_ROUTETAB.seed([s]), [STRIP[0] - 0.05, STRIP[1]]);
  await p.click('[data-rt="evac"]');
  await p.waitForFunction(() => document.querySelector("#rt-evres .rtalts") && /Test Farm Strip/.test(document.getElementById("rt-evres").textContent), null, { timeout: 60000 }).catch(() => {});
  const si = await p.evaluate(() => [...document.querySelectorAll("#rt-evres .rtalts button")].findIndex((b) => /Test Farm Strip/.test(b.textContent)));
  if (si > 0) { await p.click('#rt-evres .rtalts button[data-alt="' + si + '"]'); await p.waitForTimeout(500); }
  const strip = await p.evaluate(() => (document.querySelector("#rt-evres .rtevd") || {}).textContent || "");
  ok(/Test Farm Strip/.test(strip) && /Longest mapped runway about 890 m \(grass\)|Longest mapped runway about 8[89]0 m/.test(strip), "airfields: the strip shows its mapped runway length (" + strip.slice(0, 160) + ")");
  ok(calls.runways >= 1, "airfields: runways asked of OpenStreetMap (" + calls.runways + ")");
  if (OUT) await p.screenshot({ path: OUT + "/evac-airfield.png" });
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  state = await ctx.storageState();
  await ctx.close();
}
{
  /* Overpass down: the reference airports still answer and the failure is said */
  const { ctx, p, errors } = await open({ osmDown: true });
  const af = await plan(p, "airfields");
  ok(af.b.length >= 1 && /airport/i.test(af.b.join(" ")), "Overpass down: reference airports still offered (" + (af.b[0] || af.txt).slice(0, 120) + ")");
  ok(/OpenStreetMap airfields did not load/.test(af.txt), "Overpass down: the failure is said, not hidden");
  ok(!errors.length, "Overpass down: no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}
{
  /* the kept LZ plan opens offline with its note */
  const { ctx, p, errors } = await open({ offline: true, state });
  await p.click("#rt-evsaved [data-evopen]"); await p.waitForTimeout(1000);
  const txt = await p.evaluate(() => document.getElementById("rt-evres").textContent);
  ok(/Kept plan from/.test(txt) && /verify on the ground/.test(txt) && /Landing zone candidate|Mapped helipad/.test(txt), "kept LZ plan opens offline with its kind and note");
  ok(!errors.length, "offline: no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
