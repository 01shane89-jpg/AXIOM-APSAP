// Headless check of the Comms planning Link tab's terrain link (assets/osap-commsplan.js with OSAP_TERRAIN_ANALYSIS.profile and
// OSAP_RADIO.terrainLink). Elevation tiles are answered by made-up terrarium tiles: flat ground at 100 m round 13.75 N, 100.50 E
// with a 60 m high north-south ridge about 2 km east (the same ground as tests/terrain_smoke.mjs).
// Checks: Set A on map then two taps set A and B (the tap does not start a phone coverage check or open anything else) and the
// check runs by itself: BLOCKED by the ridge about 2 km from A, with the profile chart, the antenna height that clears it, the
// distance copied into the free-space link, and A, B and the line on the map; raising both antennas past the ridge but inside
// its Fresnel zone gives FRESNEL ZONE OBSTRUCTED, higher still CLEAR; changing the frequency recalculates; A and B survive a
// reload; Swap and Clear; leaving the tab takes the line off the map; no ground data gives UNKNOWN, never clear; on a 390 px
// phone nothing scrolls sideways; no page errors.
// Run from the repo root: node tests/commslink_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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
const A = [13.75, 100.50], B = [13.75, 100.54];
const px = (p, ll) => p.evaluate((ll) => { const q = window.__asapMap.latLngToContainerPoint(ll), r = document.getElementById("map").getBoundingClientRect(); return { x: r.left + q.x, y: r.top + q.y }; }, ll);
const tl = (p) => p.evaluate(() => window.OSAP_COMMSPLAN.terrainLink());
const done = (p) => p.waitForFunction(() => { const s = window.OSAP_COMMSPLAN.terrainLink(); return !s.busy && (s.res || s.err); }, null, { timeout: 60000 });
const setNum = (p, k, v) => p.evaluate(([k, v]) => { const i = document.querySelector('[data-cpl="' + k + '"]'); i.value = v; i.dispatchEvent(new Event("change", { bubbles: true })); }, [k, v]);

// ---------- desktop ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1360, height: 860 } });
  ok(/Terrain link: A to B/.test(await p.textContent("#cp-pane")), "the Link tab opens with the terrain link section first");
  await p.click('[data-tl="a"]');
  ok((await tl(p)).arm === "a" && /Tap the map for A/.test(await p.textContent("#cp-tl")), "Set A on map waits for a tap");
  const comBefore = await p.evaluate(() => JSON.stringify(window.OSAP_COMMSTAB.state().result || null));
  let q = await px(p, A); await p.mouse.click(q.x, q.y); await p.waitForTimeout(300);
  let s = await tl(p);
  ok(s.pts.a && Math.abs(s.pts.a[0] - A[0]) < 0.001 && Math.abs(s.pts.a[1] - A[1]) < 0.001 && s.arm === "b", "the tap sets A and then waits for B");
  q = await px(p, B); await p.mouse.click(q.x, q.y);
  await done(p); s = await tl(p);
  ok(await p.evaluate((b) => JSON.stringify(window.OSAP_COMMSTAB.state().result || null) === b, comBefore), "setting the ends does not start a phone coverage check");
  ok(!(await p.evaluate(() => document.querySelector(".leaflet-popup"))), "and opens nothing else on the map");
  ok(s.res && s.res.verdict === "blocked", "2 m antennas across the 60 m ridge: blocked (" + (s.res && s.res.verdict) + ")");
  ok(s.res && Math.abs(s.res.worst.dist_m - 2000) < 250, "the tightest point is the ridge about 2 km from A (" + (s.res && Math.round(s.res.worst.dist_m)) + " m)");
  const out = await p.textContent("#cp-tlout");
  ok(/BLOCKED BY TERRAIN/.test(out) && /Antenna height to clear 60%/.test(out) && /knife-edge/.test(out) && /Margin with terrain/.test(out), "the result names the verdict, the terrain loss, the margin and the antenna height that clears it");
  ok(await p.evaluate(() => !!document.querySelector("#cp-tlout svg.cptlc polygon") && !!document.querySelector("#cp-tlout svg.cptlc path")), "a profile chart with the ground and Fresnel zone");
  ok(Math.abs(+(await p.inputValue('[data-cpl="d_km"]')) - 4.31) < 0.05, "the A to B distance goes into the free-space link (" + (await p.inputValue('[data-cpl="d_km"]')) + " km)");
  ok(await p.evaluate(() => document.querySelectorAll(".cptlm").length === 2), "A and B are marked on the map");
  if (OUT) await p.screenshot({ path: OUT + "/commslink-blocked.png" });
  // raise both antennas past the ridge (line at 170 m over 160 m ground) but inside its Fresnel zone, then well clear
  await setNum(p, "ha_m", 70); await setNum(p, "hb_m", 70); await p.waitForTimeout(200);
  s = await tl(p);
  ok(s.res.verdict === "fresnel" && /FRESNEL ZONE OBSTRUCTED/.test(await p.textContent("#cp-tlout")), "70 m antennas: the line clears the ridge but its Fresnel zone does not (" + s.res.verdict + ")");
  await setNum(p, "ha_m", 120); await setNum(p, "hb_m", 120); await p.waitForTimeout(200);
  ok((await tl(p)).res.verdict === "clear", "120 m antennas: clear");
  const f1 = (await tl(p)).res.worst.f1_m;
  await setNum(p, "f_mhz", 2400); await p.waitForTimeout(200);
  ok((await tl(p)).res.worst.f1_m < f1 / 3, "a higher frequency recalculates with a narrower Fresnel zone");
  if (OUT) await p.screenshot({ path: OUT + "/commslink-clear.png" });
  // the ends are kept
  await p.reload({ waitUntil: "domcontentloaded" }); await p.waitForFunction(() => window.TSAP && window.__asapMap, null, { timeout: 60000 }); await p.waitForTimeout(2000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  await p.evaluate(() => document.querySelector('#view-seg [data-view="comms"]').click());
  await p.waitForFunction(() => window.OSAP_COMMSPLAN && document.querySelector("#cp-tl"), null, { timeout: 20000 });
  s = await tl(p);
  ok(s.pts.a && s.pts.b && /47P/.test(await p.textContent("#cptl-a")), "A and B are kept after a reload, shown as grid references");
  await p.click('[data-tl="go"]'); await done(p);
  ok((await tl(p)).res.verdict === "clear", "Check terrain runs again from the kept ends");
  await p.click('[data-tl="swap"]'); await done(p); s = await tl(p);
  ok(Math.abs(s.pts.a[1] - B[1]) < 0.001 && Math.abs(s.res.worst.dist_m - 2310) < 250, "Swap A and B swaps the ends and rechecks (ridge now about 2.3 km from A)");
  await p.click('.cptabs [data-cptab="plan"]'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => !document.querySelector(".cptlm")), "leaving the Link tab takes A, B and the line off the map");
  await p.click('.cptabs [data-cptab="link"]'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.querySelectorAll(".cptlm").length === 2), "coming back draws them again");
  await p.click('[data-tl="clear"]'); s = await tl(p);
  ok(!s.pts.a && !s.pts.b && !s.res && await p.evaluate(() => !document.querySelector(".cptlm")), "Clear removes both ends, the result and the map marks");
  ok(errors.length === 0, "desktop: no page errors " + errors.join(" | "));
  await ctx.close();
}

// ---------- no elevation data ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1360, height: 860 } }, true);
  await p.evaluate(([a, b]) => { localStorage.setItem("osap-cp-link", JSON.stringify({ tA: a, tB: b })); }, [A, B]);
  await p.click('.cptabs [data-cptab="plan"]'); await p.click('.cptabs [data-cptab="link"]');
  await p.click('[data-tl="go"]'); await done(p);
  const s = await tl(p);
  ok((s.res && s.res.verdict === "unknown") || !!s.err, "no elevation tiles: UNKNOWN or an error, never clear (" + (s.res ? s.res.verdict : s.err) + ")");
  ok(!/CLEAR\b/.test(await p.textContent("#cp-tlout")) || /UNKNOWN/.test(await p.textContent("#cp-tlout")), "the result does not say clear");
  ok(errors.length === 0, "no data: no page errors " + errors.join(" | "));
  await ctx.close();
}

// ---------- phone ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await p.evaluate(([a, b]) => { localStorage.setItem("osap-cp-link", JSON.stringify({ tA: a, tB: b })); }, [A, B]);
  await p.evaluate(() => { document.querySelector('.cptabs [data-cptab="plan"]').click(); document.querySelector('.cptabs [data-cptab="link"]').click(); });
  await p.evaluate(() => document.querySelector('[data-tl="go"]').click()); await done(p);
  ok((await tl(p)).res.verdict === "blocked", "phone: the check runs");
  ok(await p.evaluate(() => { const r = document.querySelector(".rail"); return [...r.querySelectorAll("#cp-tl *")].every((e) => e.getBoundingClientRect().right <= innerWidth + 1); }), "phone: nothing in the terrain link runs off the side");
  if (OUT) await p.screenshot({ path: OUT + "/commslink-phone.png", fullPage: true });
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}

await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
