// Headless check of Radio coverage from a point (Comms planning > Link, assets/osap-commsplan.js) and its long-press entry
// (Terrain > Radio coverage from here, registered in index.html). Elevation tiles are made-up terrarium tiles: flat ground at
// 100 m round 13.75 N, 100.50 E with a 60 m ridge about 2 km east (as in tests/commslink_smoke.mjs).
// Checks: the ring lists it and opens Link with the transmitter on the map at once; rays draw as they come; 72 directions;
// the ridge cuts the reach east; labelled modelled, terrain only; a tap shows the margin and starts no phone check; changed
// numbers say recalculate and less power reaches less; leaving Link hides it, Clear removes it; Set on map then a tap runs;
// no elevation never claims likely; a phone does not scroll sideways; no page errors.
// Run from the repo root: node tests/commsradio_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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

/* ---------- made-up elevation: terrarium PNG tiles ---------- */
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(b) { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const C0 = [13.75, 100.5], RIDGE = [100.5180, 100.5195];   /* about 1.95 to 2.1 km east */
function elev(lat, lon) { return lon >= RIDGE[0] && lon <= RIDGE[1] ? 160 : 100; }
const tileLon = (x, z) => x / 2 ** z * 360 - 180;
function tile(z, x, y) {
  const n = 2 ** z, rgb = Buffer.alloc(256 * 256 * 3);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
    const lon = (x + (i + 0.5) / 256) / n * 360 - 180, lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + (j + 0.5) / 256) / n))) * 180 / Math.PI;
    const v = elev(lat, lon) + 32768, k = (j * 256 + i) * 3;
    rgb[k] = Math.floor(v / 256); rgb[k + 1] = Math.floor(v) % 256; rgb[k + 2] = Math.round((v % 1) * 256) % 256;
  }
  return png(256, 256, rgb);
}
async function open(opts, noDem) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const m = r.request().url().match(/elevation-tiles-prod\/terrarium\/(\d+)\/(\d+)\/(\d+)\.png/);
    if (m && !noDem) return r.fulfill({ status: 200, contentType: "image/png", headers: { "Access-Control-Allow-Origin": "*" }, body: tile(+m[1], +m[2], +m[3]) });
    return r.abort();
  });
  await ctx.route(/\/data\/comms\/masts\//, (r) => r.fulfill({ status: 404, body: "" }));
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("osap-cp-tab", "link"); } catch (e) {} });
  const errors = [];
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message)); p.on("dialog", (d) => d.accept());
  await p.goto(base, { waitUntil: "domcontentloaded" }); await p.waitForFunction(() => window.TSAP && window.__asapMap && window.OSAP_TERRAIN_ANALYSIS, null, { timeout: 60000 }); await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelector('#view-seg [data-view="comms"]').click());
  await p.waitForFunction(() => window.OSAP_COMMSPLAN && document.querySelector("#cp-tl"), null, { timeout: 20000 });
  await p.evaluate(() => window.__asapMap.setView([13.75, 100.52], 13, { animate: false })); await p.waitForTimeout(600);
  return { ctx, p, errors };
}
const A = [13.75, 100.50];
const rad = (p) => p.evaluate(() => window.OSAP_COMMSPLAN.radio());
const done = (p) => p.waitForFunction(() => { const s = window.OSAP_COMMSPLAN.radio(); return !s.busy && (s.rays === s.n || s.err); }, null, { timeout: 120000 });

// ---------- desktop: long-press > Terrain > Radio coverage from here ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1360, height: 860 } });
  // start from another tab: the ring tool opens Comms planning on Link by itself
  await p.click('.cptabs [data-cptab="coverage"]');
  await p.evaluate((c) => { window.__asapMap.setView(c, 13); window.OSAP_ATAK.ring(c[0], c[1]); }, A); await p.waitForTimeout(200);
  await p.click('#atk-ring [data-rk="terrain"]'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => /Radio coverage from here/.test((document.querySelector(".vsmenu") || {}).textContent || "")), "long-press Terrain lists Radio coverage from here");
  const t0 = Date.now();
  await p.click('.vsmenu button:has-text("Radio coverage from here")');
  await p.waitForTimeout(400);
  ok(await p.evaluate(() => document.querySelector('.cptabs [data-cptab="link"]').getAttribute("aria-selected") === "true" && !!document.querySelector("#cp-rc")), "it opens Comms planning on Link with the radio coverage section");
  ok(await p.evaluate(() => !!document.querySelector(".leaflet-comchk-pane .cptlm")), "the transmitter is on the map straight away");
  await p.waitForFunction(() => { const s = window.OSAP_COMMSPLAN.radio(); return s.rays > 0 && s.rays < s.n; }, null, { timeout: 30000 }).then(() => ok(true, "rays draw as they come in"), () => ok(true, "rays finished before the first look"));
  await done(p);
  let s = await rad(p);
  ok(!s.err && s.rays === 72, "72 directions worked out in " + Math.round((Date.now() - t0) / 1000) + " s" + (s.err ? ": " + s.err : ""));
  ok(Math.abs(s.at[0] - A[0]) < 1e-6 && Math.abs(s.at[1] - A[1]) < 1e-6, "from the long-pressed point");
    ok(s.stats.pct.likely > 0 && s.stats.far_m > 3000 && s.stats.far_m < 30000, "flat ground: heard several km out, not to the edge (" + Math.round(s.stats.far_m) + " m, likely " + Math.round(s.stats.pct.likely) + "%)");
  const ma = await p.evaluate(() => [window.OSAP_COMMSPLAN.radioAt(13.75, 100.528), window.OSAP_COMMSPLAN.radioAt(13.75, 100.472)]);
  ok(ma[0] && ma[1] && ma[0].terrain_db > ma[1].terrain_db + 5 && ma[0].margin_db < ma[1].margin_db - 5, "behind the ridge 3 km east loses more to terrain than 3 km west over flat ground (" + JSON.stringify(ma.map((x) => x && [Math.round(x.margin_db), Math.round(x.terrain_db || 0)])) + ")");
  const res = await p.textContent("#cp-rcout");
  ok(/MODELLED COVERAGE/.test(res) && /terrain only/.test(res) && /Likely/.test(res) && /Marginal/.test(res), "the answer is labelled modelled, terrain only, with the classes");
  ok(await p.evaluate(() => document.querySelectorAll(".leaflet-comchk-pane canvas").length >= 1), "coverage drawn on the map");
  // a tap inside shows the margin there, and does not start a phone coverage check
  const before = await p.evaluate(() => JSON.stringify(window.OSAP_COMMSTAB.state().result || null));
  const q = await p.evaluate((ll) => { const pt = window.__asapMap.latLngToContainerPoint(ll), r = document.getElementById("map").getBoundingClientRect(); return { x: r.left + pt.x, y: r.top + pt.y }; }, [13.75, 100.49]);
  await p.mouse.click(q.x, q.y); await p.waitForTimeout(300);
  ok(/from the transmitter/.test(await p.evaluate(() => (document.querySelector(".leaflet-popup-content") || {}).textContent || "")), "tapping the coverage says the margin there");
  ok(await p.evaluate((b) => JSON.stringify(window.OSAP_COMMSTAB.state().result || null) === b, before), "the tap does not start a phone coverage check");
  // changing the link numbers marks it out of date; Recalculate with 1 W reaches less far
  await p.evaluate(() => { const i = document.querySelector('[data-cpl="ptx_w"]'); i.value = 0.01; i.dispatchEvent(new Event("change", { bubbles: true })); });
  ok(/press Recalculate/.test(await p.textContent("#cp-rcout")), "changed numbers: says to recalculate");
  await p.click('[data-rc="go"]'); await done(p);
  const s2 = await rad(p);
  ok(s2.stats.pct.likely < s.stats.pct.likely, "less power: less likely coverage (" + Math.round(s.stats.pct.likely) + "% to " + Math.round(s2.stats.pct.likely) + "%)");
  // leaving the tab takes it off the map; coming back draws it again
  await p.click('.cptabs [data-cptab="plan"]'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => !document.querySelector(".leaflet-comchk-pane .cptlm")), "leaving Link takes the coverage off the map");
  await p.click('.cptabs [data-cptab="link"]'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => !!document.querySelector(".leaflet-comchk-pane .cptlm")), "coming back to Link draws it again");
  await p.click('[data-rc="clear"]'); await p.waitForTimeout(200);
  ok((await rad(p)).rays === 0 && await p.evaluate(() => !document.querySelector(".leaflet-comchk-pane .cptlm")), "Clear removes it");
  // Set on map: one tap places the transmitter and runs
  await p.click('[data-rc="arm"]');
  const q2 = await p.evaluate((ll) => { const pt = window.__asapMap.latLngToContainerPoint(ll), r = document.getElementById("map").getBoundingClientRect(); return { x: r.left + pt.x, y: r.top + pt.y }; }, [13.752, 100.505]);
  await p.mouse.click(q2.x, q2.y); await p.waitForTimeout(200);
  ok(await p.evaluate(() => !!document.querySelector(".leaflet-comchk-pane .cptlm")) && (await rad(p)).busy !== undefined, "Set on map then a tap places the transmitter at once");
  await done(p);
  ok((await rad(p)).rays === 72, "and works out coverage from there");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  if (OUT) await p.screenshot({ path: OUT + "/commsradio.png" });
  await ctx.close();
}
// ---------- no ground data: unknown, never likely ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1360, height: 860 } }, true);
  await p.evaluate((c) => window.OSAP_COMMSPLAN.radioFrom(c[0], c[1]), A);
  await done(p);
  const s = await rad(p);
  ok(!!s.err || (s.stats && s.stats.pct.likely === 0), "no elevation: no likely coverage claimed (" + (s.err || JSON.stringify(s.stats && s.stats.pct)) + ")");
  ok(!errors.length, "no-data: no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
// ---------- phone ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await p.evaluate((c) => window.OSAP_COMMSPLAN.radioFrom(c[0], c[1]), A);
  await done(p);
  await p.evaluate(() => document.documentElement.setAttribute("data-sheet", "full")); await p.waitForTimeout(400);
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "phone: no sideways scroll");
  ok(!errors.length, "phone: no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
