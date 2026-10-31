// Headless check of Photo to map (assets/osap-points.js + the Point menu in assets/osap-atak.js):
// Point > Take a photo here opens a sheet with the live GPS grid and compass heading; Take photo saves a new point at the
// fix with the photo kept byte for byte, its grid, heading, sources and accuracy beside it; a heading wedge on the map;
// the heading can be corrected; OSAP camera shows grid, heading and time over the live picture and saves a clean still;
// no GPS = Take photo locked, map centre offered; no compass = saved without a heading.
// The compass is a stand-in for assets/osap-heading.js (window.OSAP_HEADING), the shared helper from the compass work.
// Run from the repo root: node tests/photo_map_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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
const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const shown = (p, s) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && getComputedStyle(e).display !== "none" && e.getClientRects().length > 0; }, s);
const pts = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("osap-atak-pts") || "[]"));
const photos = (p, pid) => p.evaluate((pid) => window.OSAP_POINTS.photos(pid).then((a) => a.map((r) => ({ size: r.size, sha256: r.sha256, geo: r.geo, exifGps: r.exifGps || null }))), pid);

/* a stand-in for OSAP_HEADING: request() resolves to the given answer, emit() sends a reading to the subscribers */
const stub = (answer) => `(() => {
  const subs = []; let last = null, asked = 0;
  window.OSAP_HEADING = { supported: () => true, request: () => { asked++; return Promise.resolve(${JSON.stringify(answer)}); },
    start: (f) => subs.push(f), stop: (f) => { const i = subs.indexOf(f); if (i >= 0) subs.splice(i, 1); }, get: () => last,
    once: () => Promise.resolve(last), _subs: subs, _asked: () => asked,
    emit: (r) => { last = r; subs.slice().forEach((f) => f(r)); } };
})()`;
async function open(opts, answer) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  if (answer !== null) await ctx.addInitScript(stub(answer));
  const errors = [], p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message)); p.on("dialog", (d) => d.accept());
  await p.goto(base, { waitUntil: "domcontentloaded" }); await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_POINTS, null, { timeout: 60000 }); await p.waitForTimeout(3500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(400);
  return { ctx, p, errors };
}
async function jpeg(p) { return Buffer.from((await p.evaluate(() => { const c = document.createElement("canvas"); c.width = 320; c.height = 200; const x = c.getContext("2d"); x.fillStyle = "#1864ab"; x.fillRect(0, 0, 320, 200); return c.toDataURL("image/jpeg", 0.9); })).split(",")[1], "base64"); }
/* the same JPEG with a camera GPS block: 13 45' 0" N, 100 30' 0" E, image direction 090 true */
function withGps(j) {
  const n = 5, t = Buffer.alloc(8 + 2 + 12 + 4 + 2 + n * 12 + 4 + 7 * 8); t.write("II", 0, "latin1"); t.writeUInt16LE(42, 2); t.writeUInt32LE(8, 4);
  let o = 8; t.writeUInt16LE(1, o); t.writeUInt16LE(0x8825, o + 2); t.writeUInt16LE(4, o + 4); t.writeUInt32LE(1, o + 6); t.writeUInt32LE(26, o + 10); t.writeUInt32LE(0, o + 14);
  o = 26; t.writeUInt16LE(n, o); let e = o + 2, d = o + 2 + n * 12 + 4;
  const asc = (tag, ch) => { t.writeUInt16LE(tag, e); t.writeUInt16LE(2, e + 2); t.writeUInt32LE(2, e + 4); t.write(ch, e + 8, "latin1"); e += 12; };
  const rat = (tag, vals) => { t.writeUInt16LE(tag, e); t.writeUInt16LE(5, e + 2); t.writeUInt32LE(vals.length, e + 4); t.writeUInt32LE(d, e + 8); e += 12; vals.forEach(([a, b]) => { t.writeUInt32LE(a, d); t.writeUInt32LE(b, d + 4); d += 8; }); };
  asc(1, "N"); rat(2, [[13, 1], [45, 1], [0, 1]]); asc(3, "E"); rat(4, [[100, 1], [30, 1], [0, 1]]); rat(17, [[90, 1]]);
  const body = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), t]), seg = Buffer.alloc(4); seg.writeUInt16BE(0xFFE1, 0); seg.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([j.subarray(0, 2), seg, body, j.subarray(2)]);
}
const GEO = { latitude: 13.7563, longitude: 100.5018, accuracy: 6 };

// ---------- phone, GPS and compass allowed ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, geolocation: GEO, permissions: ["geolocation"] }, "granted");
  await p.click('#atk-tools [data-atk="point"]');
  ok(await p.evaluate(() => { const b = document.querySelector('#atk-pop [data-pk]'); return b && b.getAttribute("data-pk") === "snap" && /Take a photo here/.test(b.textContent); }), "phone: Take a photo here is the first item in the Point menu");
  await p.click('#atk-pop [data-pk="snap"]'); await p.waitForTimeout(800);
  ok(await shown(p, "#pt-snap"), "phone: the Photo to map sheet opens");
  ok(await p.evaluate(() => window.OSAP_HEADING._asked() === 1), "phone: compass access asked for inside the tap (iOS needs that)");
  const sheet = await p.evaluate(() => { const r = document.getElementById("pt-snap").getBoundingClientRect(), m = document.getElementById("map").getBoundingClientRect(); return { w: r.width, mw: m.width, bot: m.bottom - r.bottom }; });
  ok(Math.abs(sheet.w - sheet.mw) <= 2, "phone: sheet is a full-width bottom sheet " + JSON.stringify(sheet));
  const grid = await p.textContent("#pt-snap .sn-grid");
  ok(/47P/.test(grid) && /device GPS ±6 m/.test(grid), "phone: live grid from the GPS with its accuracy: " + grid.trim());
  ok(await p.evaluate(() => { const i = document.querySelector('#pt-snap input[data-ps="cam"]'); return !i.disabled && i.getAttribute("capture") === "environment" && i.accept === "image/*"; }), "phone: Take photo opens the rear camera once there is a fix");
  ok(/Starting compass/.test(await p.textContent("#pt-snap .sn-hd")), "phone: heading says it is starting before the first reading");
  await p.evaluate(() => window.OSAP_HEADING.emit({ mag: 10, tru: 9, decl: -1, cam: 47.4, camTru: 46.4, basis: "camera", acc: 12, src: "iOS compass", t: Date.now() }));
  const hd = await p.textContent("#pt-snap .sn-hd");
  ok(/047° magnetic/.test(hd) && /843 mils/.test(hd) && /046° true/.test(hd) && /±12°/.test(hd), "phone: heading uses the camera direction, magnetic, mils, true, accuracy: " + hd.trim());
  if (OUT) await p.screenshot({ path: OUT + "/photo-map-sheet.png" });
  // press Take photo (notes grid and heading now), then the phone turns while the camera is open
  await p.evaluate(() => document.querySelector('#pt-snap input[data-ps="cam"]').dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
  await p.evaluate(() => window.OSAP_HEADING.emit({ mag: 100, tru: 99, decl: -1, cam: 80, camTru: 79, basis: "camera", acc: 12, src: "iOS compass", t: Date.now() }));
  const j = withGps(await jpeg(p)), sha = createHash("sha256").update(j).digest("hex");
  await p.setInputFiles('#pt-snap input[data-ps="cam"]', { name: "image.jpg", mimeType: "image/jpeg", buffer: j }); await p.waitForTimeout(900);
  const P = await pts(p), pt = P[P.length - 1];
  ok(P.length === 1 && pt.src === "photo" && /^Photo \d{4}Z$/.test(pt.n), "phone: a photo point is saved at once: " + (pt && pt.n));
  ok(pt && Math.abs(pt.lat - GEO.latitude) < 1e-5 && Math.abs(pt.lon - GEO.longitude) < 1e-5 && pt.acc === 6, "phone: at the GPS fix, with its accuracy");
  ok(pt && pt.az === 47.4 && pt.azRef === "magnetic" && pt.azTru === 46.4, "phone: heading at the moment Take photo was pressed, not after: " + (pt && pt.az));
  ok(!(await shown(p, "#pt-snap")) && await shown(p, "#pt-ed"), "phone: the sheet closes and the point opens for a name and note");
  const ph = await photos(p, pt.id);
  ok(ph.length === 1 && ph[0].size === j.length && ph[0].sha256 === sha, "phone: the original photo is kept byte for byte with its SHA-256");
  const g = ph[0] && ph[0].geo;
  ok(g && /^47P/.test(g.grid) && g.pos.src === "device GPS" && g.pos.acc === 6 && g.heading.mag === 47.4 && g.heading.tru === 46.4 && g.heading.basis === "camera" && g.heading.src === "iOS compass", "phone: grid, heading, sources and accuracy saved beside the photo");
  ok(g && g.heading.turned === 33 && g.heading.after === 80, "phone: how far the phone turned while the camera was open is kept: " + (g && g.heading.turned));
  ok(ph[0] && ph[0].exifGps && ph[0].exifGps.lat === 13.75 && ph[0].exifGps.lon === 100.5 && ph[0].exifGps.dir === 90, "phone: GPS the camera wrote into the photo is read too: " + JSON.stringify(ph[0] && ph[0].exifGps));
  ok(await p.evaluate(() => !document.querySelector("#pt-ed .pt-az").hidden && document.getElementById("pt-az").value === "47"), "phone: the point sheet shows the heading");
  ok(await p.evaluate(() => { const a = document.querySelector(".atk-pt .atk-az svg"); return !!a && /rotate\(47deg\)/.test(a.style.transform); }), "phone: a heading wedge is drawn on the map at 047°");
  await p.fill("#pt-az", "52"); await p.dispatchEvent("#pt-az", "change"); await p.waitForTimeout(200);
  let q = (await pts(p))[0];
  ok(q.az === 52 && q.azEd === 1, "phone: the heading can be corrected");
  ok((await photos(p, pt.id))[0].geo.heading.mag === 47.4, "phone: the compass reading kept with the photo is not changed by a correction");
  ok(await p.evaluate(() => /rotate\(52deg\)/.test(document.querySelector(".atk-pt .atk-az svg").style.transform)), "phone: the wedge follows the correction");
  await p.click('#pt-ed [data-pe="x"]').catch(() => {});
  await p.evaluate(() => { const m = [...document.querySelectorAll(".atk-pt")].pop(); m && m.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await p.waitForTimeout(400);
  const pop = await p.evaluate(() => { const e = document.querySelector(".atk-ptpop .atk-paz"); return e ? e.textContent : ""; });
  ok(/Facing 052° magnetic/.test(pop) && /924 mils/.test(pop) && /\(corrected\)/.test(pop), "phone: the popup says which way the photo faces: " + pop);
  await p.evaluate(() => { const b = document.querySelector(".atk-ptpop .atk-pph [data-ph]"); if (b) b.click(); }); await p.waitForTimeout(500);
  const meta = await p.evaluate(() => document.querySelector("#pt-view .pt-vmeta").textContent);
  ok(/Taken at: 47P/.test(meta) && /device GPS ±6 m/.test(meta) && /Facing: 047° magnetic/.test(meta) && /33° different/.test(meta) && /GPS written in the photo/.test(meta), "phone: the photo viewer shows where and which way it was taken");
  if (OUT) await p.screenshot({ path: OUT + "/photo-map-viewer.png" });
  await p.evaluate(() => document.querySelector('#pt-view [data-pv="x"]').click());
  ok(await p.evaluate((id) => !window.OSAP_PLACES || window.OSAP_PLACES.shown("pt:" + id), pt.id), "phone: the photo is a saved point in My places (pt:" + pt.id + ")");
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}

// ---------- phone, OSAP camera with the data on screen (Chromium's fake camera) ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, geolocation: GEO, permissions: ["geolocation", "camera"] }, "granted");
  await p.click('#atk-tools [data-atk="point"]'); await p.click('#atk-pop [data-pk="snap"]'); await p.waitForTimeout(800);
  ok(await shown(p, '#pt-snap [data-ps="osc"]') && await shown(p, '#pt-snap .sn-app'), "camera: sheet offers Open camera (data on screen) and Phone camera app");
  await p.evaluate(() => window.OSAP_HEADING.emit({ mag: 300, tru: 299.2, decl: -0.8, cam: 271.2, camTru: 270.4, basis: "camera", acc: 8, src: "device compass", t: Date.now() }));
  await p.click('#pt-snap [data-ps="osc"]');
  await p.waitForFunction(() => { const v = document.querySelector("#pt-cam video"); return v && v.videoWidth > 0; }, null, { timeout: 15000 }).catch(() => {});
  ok(await shown(p, "#pt-cam") && !(await shown(p, "#pt-snap")), "camera: the OSAP camera fills the screen");
  ok(await p.evaluate(() => document.querySelector("#pt-cam video").videoWidth > 0), "camera: the live picture is running");
  const hud = await p.evaluate(() => ({ hd: document.querySelector("#pt-cam .cm-hd").textContent, hd2: document.querySelector("#pt-cam .cm-hd2").textContent, grid: document.querySelector("#pt-cam .cm-grid").textContent, time: document.querySelector("#pt-cam .cm-time").textContent }));
  ok(hud.hd === "271° M" && /4821 mils/.test(hud.hd2) && /270° T/.test(hud.hd2) && /±8°/.test(hud.hd2), "camera: heading on screen: " + hud.hd + " " + hud.hd2);
  ok(/^47P PR 62366 21280/.test(hud.grid) && /±6 m/.test(hud.grid) && /\d\d:\d\d:\d\dZ/.test(hud.time) && /local/.test(hud.time), "camera: grid and Zulu + local time on screen: " + hud.grid + " | " + hud.time);
  await p.evaluate(() => window.OSAP_HEADING.emit({ mag: 20, tru: 19, decl: -1, cam: 95, camTru: 94, basis: "camera", acc: 8, src: "device compass", t: Date.now() }));
  ok(await p.textContent("#pt-cam .cm-hd") === "095° M", "camera: the heading on screen follows the phone");
  if (OUT) await p.screenshot({ path: OUT + "/photo-map-camera.png" });
  await p.click('#pt-cam [data-cm="shut"]');
  await p.waitForFunction(() => /1 saved/.test(document.querySelector("#pt-cam .cm-n").textContent), null, { timeout: 15000 }).catch(() => {});
  let P = await pts(p);
  ok(P.length === 1 && P[0].src === "photo" && P[0].az === 95 && P[0].azTru === 94, "camera: shutter saves a point with the heading at the shutter: " + (P[0] && P[0].az));
  ok(await shown(p, "#pt-cam") && /1 saved/.test(await p.textContent("#pt-cam .cm-n")), "camera: stays open for the next photo and counts what is saved");
  const ph = await p.evaluate((pid) => window.OSAP_POINTS.photos(pid).then((a) => a.map((r) => ({ type: r.type, size: r.size, name: r.name, sha: r.sha256, geo: r.geo, head: Array.from(new Uint8Array(r.buf.slice(0, 3))) }))), P[0] && P[0].id);
  /* a phone's takePhoto gives a JPEG; Chromium's fake camera gives a PNG: the bytes must match the type and the name */
  const magic = ph[0] && (ph[0].type === "image/jpeg" ? ph[0].head.join() === "255,216,255" && /\.jpg$/.test(ph[0].name) : ph[0].type === "image/png" ? ph[0].head.join() === "137,80,78" && /\.png$/.test(ph[0].name) : false);
  ok(ph.length === 1 && magic && ph[0].size > 1000 && /^OSAP-\d{8}T\d{6}Z\./.test(ph[0].name) && ph[0].sha.length === 64, "camera: the camera still is stored as it came, with its SHA-256 with its SHA-256: " + (ph[0] && ph[0].name + " " + ph[0].size + " B"));
  ok(ph[0] && /OSAP camera/.test(ph[0].geo.capture.how) && /not drawn into the photo/.test(ph[0].geo.capture.overlay) && ph[0].geo.heading.mag === 95 && /^47P/.test(ph[0].geo.grid), "camera: how it was taken is recorded, data kept beside the photo: " + (ph[0] && ph[0].geo.capture.how));
  await p.click('#pt-cam [data-cm="shut"]');
  await p.waitForFunction(() => /2 saved/.test(document.querySelector("#pt-cam .cm-n").textContent), null, { timeout: 15000 }).catch(() => {});
  ok((await pts(p)).length === 2, "camera: a second shot is a second point");
  await p.click('#pt-cam [data-cm="x"]'); await p.waitForTimeout(300);
  ok(!(await shown(p, "#pt-cam")) && !(await shown(p, "#pt-snap")) && await p.evaluate(() => !document.querySelector("#pt-cam video").srcObject && window.OSAP_HEADING._subs.length === 0), "camera: Done closes it and lets go of the camera and compass");
  ok(errors.length === 0, "camera: no page errors " + errors.join(" | "));
  await ctx.close();
}

// ---------- desktop, location refused, a computer with no compass (the real helper, which gets no reading) ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1280, height: 860 } }, null);
  await p.click('#atk-tools [data-atk="point"]'); await p.click('#atk-pop [data-pk="snap"]'); await p.waitForTimeout(1500);
  ok(await p.evaluate(() => document.querySelector('#pt-snap input[data-ps="cam"]').disabled), "no GPS: Take photo stays locked");
  ok(/not allowed/.test(await p.textContent("#pt-snap .sn-grid")) && await shown(p, '#pt-snap [data-ps="centre"]'), "no GPS: says why and offers the map centre");
  await p.waitForFunction(() => /without a heading/.test(document.querySelector("#pt-snap .sn-hd").textContent), null, { timeout: 10000 }).catch(() => {});
  ok(/without a heading/.test(await p.textContent("#pt-snap .sn-hd")), "no compass: says the photo is saved without a heading");
  await p.click('#pt-snap [data-ps="centre"]');
  ok(/map centre, chosen by you/.test(await p.textContent("#pt-snap .sn-grid")) && !(await p.evaluate(() => document.querySelector('#pt-snap input[data-ps="cam"]').disabled)), "no GPS: map centre unlocks Take photo and is labelled as your choice");
  await p.setInputFiles('#pt-snap input[data-ps="cam"]', { name: "a.jpg", mimeType: "image/jpeg", buffer: await jpeg(p) }); await p.waitForTimeout(900);
  const pt = (await pts(p))[0];
  ok(pt && pt.src === "photo" && pt.az === undefined && pt.acc === undefined, "no GPS: saved at the map centre with no heading");
  const g = pt && (await photos(p, pt.id))[0].geo;
  ok(g && /map centre/.test(g.pos.src) && g.pos.acc === null && g.heading === null, "no GPS: the photo records that the place was the map centre, and no heading");
  ok(await p.evaluate(() => !document.querySelector(".atk-pt .atk-az")), "no heading: no wedge on the map");
  ok(errors.length === 0, "desktop: no page errors " + errors.join(" | "));
  await ctx.close();
}

// ---------- compass refused ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, geolocation: GEO, permissions: ["geolocation"] }, "denied");
  await p.click('#atk-tools [data-atk="point"]'); await p.click('#atk-pop [data-pk="snap"]'); await p.waitForTimeout(800);
  ok(/Compass not allowed/.test(await p.textContent("#pt-snap .sn-hd")) && await shown(p, '#pt-snap [data-ps="allow"]'), "compass refused: says so and offers Allow compass");
  await p.click('#pt-snap [data-ps="x"]');
  ok(!(await shown(p, "#pt-snap")) && await p.evaluate(() => window.OSAP_HEADING._subs.length === 0), "close: the sheet closes and lets go of the compass");
  ok(errors.length === 0, "compass refused: no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
