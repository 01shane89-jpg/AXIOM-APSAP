// Headless check of the map compass (assets/osap-compass.js) and the shared phone-compass reader (assets/osap-heading.js):
// the north arrow is a button that opens the Compass card; a computer with no compass gets bearings to the pointer and says
// it has no compass; degrees/mils is remembered; on a phone the heading (true = magnetic + WMM declination) shows on the
// card and the arrow, a heading cone sits on the location dot, the camera azimuth is worked out from the phone's tilt, and
// "Heading up" turns the 3D view (opened flat) with the phone, "North up" goes back to the flat map.
// Run from the repo root: node tests/compass_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".css": "text/css" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"], ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const shown = (p, s) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && getComputedStyle(e).display !== "none" && e.getClientRects().length > 0; }, s);
const txt = (p, s) => p.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent : null; }, s);
async function open(opts, init) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("asap-map-layers", JSON.stringify({ base: "topo" })); } catch (e) {} });
  if (init) await ctx.addInitScript(init);
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base, { waitUntil: "domcontentloaded" }); await p.waitForFunction(() => window.TSAP && window.OSAP_COMPASS && window.OSAP_HEADING, null, { timeout: 60000 }); await p.waitForTimeout(3000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(400);
  return { ctx, p, errors };
}
// a reading from the phone's sensor, as Chrome on Android sends it (alpha counter-clockwise from north)
const orient = (p, a, b = 0, g = 0, n = 1) => p.evaluate(([a, b, g, n]) => {
  for (let i = 0; i < n; i++) { const e = new Event("deviceorientationabsolute"); Object.assign(e, { alpha: a, beta: b, gamma: g, absolute: true }); window.dispatchEvent(e); }
}, [a, b, g, n]);
const angDiff = (x, y) => Math.abs((((x - y) % 360) + 540) % 360 - 180);

// ---------- computer: no compass, bearings to the pointer ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1360, height: 860 } });
  ok(await p.evaluate(() => { const a = document.querySelector(".o3n-ctl"); return !!a && a.getAttribute("role") === "button" && a.tabIndex === 0 && getComputedStyle(a).pointerEvents !== "none"; }), "desktop: the north arrow is a compass button");
  await p.click(".o3n-ctl"); await p.waitForTimeout(300);
  ok(await shown(p, "#ocp"), "desktop: tapping it opens the Compass card");
  ok(await p.evaluate(() => { const c = document.getElementById("ocp").getBoundingClientRect(), a = document.querySelector(".o3n-ctl").getBoundingClientRect(); return c.top >= a.bottom && Math.abs(c.left - a.left) < 4; }), "desktop: the card sits under the arrow");
  ok(!(await p.evaluate(() => window.OSAP_COMPASS.state().running)), "desktop: the compass sensor is not started on a computer until asked");
  ok(/^Declination \d+\.\d° [EW] \(WMM 2025, map centre\)$/.test(await txt(p, "#ocp .ocp-dc")), "desktop: declination at the map centre shown (" + await txt(p, "#ocp .ocp-dc") + ")");
  await p.evaluate(() => window.__asapMap.setView([13.75, 100.5], 9, { animate: false }));
  const box = await p.evaluate(() => { const r = document.getElementById("map").getBoundingClientRect(); return { x: r.left + r.width * 0.75, y: r.top + r.height / 2 }; });
  await p.mouse.move(box.x, box.y); await p.waitForTimeout(200);
  const brg = await txt(p, "#ocp .ocp-brg");
  ok(/From map centre to pointer/.test(brg) && /\b0(8\d|9\d)° T\b/.test(brg) && /° M/.test(brg) && /km/.test(brg), "desktop: bearing and distance from the map centre to the pointer, true and magnetic (" + brg + ")");
  await p.click('#ocp [data-ocp="start"]');
  await p.waitForFunction(() => /no compass/i.test(document.querySelector("#ocp .ocp-st").textContent), null, { timeout: 8000 }).catch(() => {});
  ok(/no compass/i.test(await txt(p, "#ocp .ocp-st")) && !(await p.evaluate(() => window.OSAP_COMPASS.state().running)), "desktop: Start compass on a computer says there is no compass and stops");
  await p.click('#ocp [data-ocp="unit"]'); await p.mouse.move(box.x, box.y + 1); await p.waitForTimeout(200);
  ok(/\d{4} mils T/.test(await txt(p, "#ocp .ocp-brg")), "desktop: Mils switches bearings to mils (" + await txt(p, "#ocp .ocp-brg") + ")");
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  ok(!(await shown(p, "#ocp")), "desktop: Escape closes the card");
  await p.reload({ waitUntil: "domcontentloaded" }); await p.waitForFunction(() => window.OSAP_COMPASS, null, { timeout: 60000 }); await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  ok(await p.evaluate(() => window.OSAP_COMPASS.state().mils), "desktop: mils remembered after a reload");
  ok(errors.length === 0, "desktop: no page errors " + JSON.stringify(errors.slice(0, 3)));
  await ctx.close();
}

// ---------- phone: live heading, cone, camera azimuth, heading up ----------
{
  // the browser's motion sensor permissions are granted, as a phone does after the person allows them
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    geolocation: { latitude: 13.7563, longitude: 100.5018, accuracy: 15 }, permissions: ["geolocation", "accelerometer", "gyroscope", "magnetometer"] });
  await p.evaluate(() => window.OSAP_LOC.use());
  await p.waitForFunction(() => window.OSAP_LOC.here(), null, { timeout: 15000 }).catch(() => {});
  ok(!!(await p.evaluate(() => window.OSAP_LOC.here())), "phone: location on (test position Bangkok)");
  await p.evaluate(() => document.querySelector(".o3n-ctl").click()); await p.waitForTimeout(300);
  ok(await p.evaluate(() => window.OSAP_COMPASS.state().running), "phone: opening the compass starts the phone's compass");
  await orient(p, 270);       // alpha 270 = facing east
  await p.waitForTimeout(250);
  const r = await p.evaluate(() => window.OSAP_HEADING.get());
  const decl = await p.evaluate(() => window.OSAP_GEO.decl(13.7563, 100.5018));
  ok(r && Math.abs(r.mag - 90) < 0.2 && Math.abs(r.tru - (90 + decl)) < 0.2 && Math.abs(r.decl - decl) < 0.1, "phone: heading magnetic 90°, true = magnetic + declination (" + JSON.stringify(r) + ")");
  ok(r && r.basis === "top" && Math.abs(r.cam - r.mag) < 0.2, "phone: lying flat, the photo azimuth falls back to the top edge");
  const t = (await txt(p, ".o3n-ctl .ocp-tag")) || "";
  ok(t === String(Math.round(90 + decl)).padStart(3, "0") + "°T", "phone: the arrow shows the true heading (" + t + ")");
  ok((await txt(p, '#ocp [data-ocp-v="mag"]')) === "090°", "phone: the card shows magnetic 090°");
  const cone = await p.evaluate(() => { const s = document.querySelector(".ocp-cone svg"); return s ? s.style.transform : ""; });
  ok(angDiff(parseFloat((cone.match(/rotate\(([-\d.]+)deg\)/) || [])[1]), 90 + decl) < 0.2 && await p.evaluate(() => window.OSAP_COMPASS.state().cone), "phone: heading cone on the location dot points the true heading (" + cone + ")");
  ok(await p.evaluate(() => { const c = document.querySelector(".ocp-cone"); return !!c && c.closest(".leaflet-mylocpane-pane") && c.parentNode.firstChild === c; }), "phone: the cone sits in the location pane, under the dot");
  // upright, camera facing east: alpha 270, beta 90
  await orient(p, 270, 90, 0); await p.waitForTimeout(250);
  const rc = await p.evaluate(() => window.OSAP_HEADING.get());
  ok(rc && rc.basis === "camera" && angDiff(rc.cam, 90) < 0.5 && angDiff(rc.camTru, 90 + decl) < 0.5, "phone: held upright, the back camera azimuth is 090° magnetic (" + JSON.stringify(rc) + ")");
  const once = await p.evaluate(() => { const pr = window.OSAP_HEADING.once(2000); const e = new Event("deviceorientationabsolute"); Object.assign(e, { alpha: 270, beta: 0, gamma: 0, absolute: true }); setTimeout(() => window.dispatchEvent(e), 100); return pr; });
  ok(once && isFinite(once.mag), "phone: once() hands back one reading for a photo");
  await orient(p, 270, 0, 0, 30); await p.waitForTimeout(200);
  ok(await shown(p, '#ocp [data-ocp="up"]'), "phone: Heading up offered once the heading is live");
  await p.evaluate(() => document.querySelector('#ocp [data-ocp="up"]').click());
  await p.waitForFunction(() => window.OSAP_COMPASS.state().turning, null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(1500);
  let g = await p.evaluate(() => { const gl = window.OSAP_3D.gl; return gl ? { b: gl.getBearing(), p: gl.getPitch(), f: window.OSAP_COMPASS.state().follow } : null; });
  ok(g && g.f && angDiff(g.b, 90 + decl) < 1.5 && g.p < 1, "phone: Heading up opens the turning map flat, turned to the heading (" + JSON.stringify(g) + ")");
  await orient(p, 180, 0, 0, 40); await p.waitForTimeout(600);   // now facing south
  g = await p.evaluate(() => ({ b: window.OSAP_3D.gl.getBearing(), h: window.OSAP_HEADING.get().tru }));
  ok(angDiff(g.b, g.h) < 1.5 && angDiff(g.h, 180 + decl) < 3, "phone: the map turns as the phone turns (" + JSON.stringify(g) + ")");
  ok(await p.evaluate(() => !!document.querySelector("#o3d .ocp-cone3")), "phone: your position and cone drawn in the turned map");
  ok(await shown(p, "#ocp") && await p.evaluate(() => document.querySelector('#ocp [data-ocp="up"]').textContent === "North up"), "phone: the card stays over the turned map with a North up button");
  await p.evaluate(() => document.querySelector('#ocp [data-ocp="up"]').click()); await p.waitForTimeout(800);
  ok(!(await p.evaluate(() => window.OSAP_3D.isOpen())) && !(await p.evaluate(() => window.OSAP_COMPASS.state().follow)), "phone: North up goes back to the flat north-up map");
  // the 3D view's own compass also stops following
  await p.evaluate(() => window.OSAP_COMPASS.headingUp());
  await p.waitForFunction(() => window.OSAP_COMPASS.state().turning, null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(800);
  await p.evaluate(() => document.querySelector("#o3d .o3-cmp").click()); await p.waitForTimeout(900);
  g = await p.evaluate(() => ({ f: window.OSAP_COMPASS.state().follow, b: window.OSAP_3D.gl.getBearing() }));
  await orient(p, 90, 0, 0, 10); await p.waitForTimeout(400);
  const b2 = await p.evaluate(() => window.OSAP_3D.gl.getBearing());
  ok(!g.f && angDiff(b2, 0) < 1, "phone: the 3D compass turns it back to north up and it stays there (" + JSON.stringify(g) + ", then " + b2.toFixed(1) + ")");
  await p.evaluate(() => document.querySelector("#o3d .o3-2d").click()); await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector("#ocp .ocp-x").click()); await p.waitForTimeout(200);
  ok(!(await shown(p, "#ocp")), "phone: card closes");
  ok(errors.length === 0, "phone: no page errors " + JSON.stringify(errors.slice(0, 3)));
  await ctx.close();
}

await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
