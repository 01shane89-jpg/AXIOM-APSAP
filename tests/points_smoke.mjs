// Headless check of map points with a name, a note and photos (assets/osap-points.js on top of assets/osap-atak.js):
// Point tool, editor sheet, photos kept byte for byte on this device with a SHA-256 fingerprint and the camera time,
// photo viewer, delete photo, reload keeps everything, removing a point removes its photos, tap-to-place.
// Run from the repo root: node tests/points_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const shown = (p, s) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && getComputedStyle(e).display !== "none" && e.getClientRects().length > 0; }, s);
const pts = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("osap-atak-pts") || "[]"));
const photos = (p, pid) => p.evaluate((pid) => window.OSAP_POINTS.photos(pid).then((a) => a.map((r) => ({ id: r.id, size: r.size, type: r.type, sha256: r.sha256, camera: r.camera, name: r.name }))), pid);

/* a JPEG with an EXIF block carrying DateTimeOriginal 2026:09:28 14:03:22, built from a canvas JPEG */
function withExif(jpeg) {
  const dt = Buffer.from("2026:09:28 14:03:22\0", "latin1");
  const t = Buffer.alloc(8 + 2 + 12 + 4 + 2 + 12 + 4); let o = 0;
  t.write("II", 0, "latin1"); t.writeUInt16LE(42, 2); t.writeUInt32LE(8, 4); o = 8;
  t.writeUInt16LE(1, o); t.writeUInt16LE(0x8769, o + 2); t.writeUInt16LE(4, o + 4); t.writeUInt32LE(1, o + 6); t.writeUInt32LE(26, o + 10); t.writeUInt32LE(0, o + 14); o = 26;
  t.writeUInt16LE(1, o); t.writeUInt16LE(0x9003, o + 2); t.writeUInt16LE(2, o + 4); t.writeUInt32LE(dt.length, o + 6); t.writeUInt32LE(t.length, o + 10); t.writeUInt32LE(0, o + 14);
  const tiff = Buffer.concat([t, dt]), body = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const seg = Buffer.alloc(4); seg.writeUInt16BE(0xFFE1, 0); seg.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), seg, body, jpeg.subarray(2)]);
}
async function open(opts, ctxIn) {
  const ctx = ctxIn || await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [];
  if (!ctxIn) {
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  }
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message)); p.on("dialog", (d) => d.accept());
  await p.goto(base, { waitUntil: "domcontentloaded" }); await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_POINTS, null, { timeout: 60000 }); await p.waitForTimeout(3500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(400);
  return { ctx, p, errors };
}

// ---------- phone ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  ok(await shown(p, '#atk-tools [data-atk="point"]'), "phone: Point button on the map toolbar");
  await p.click('#atk-tools [data-atk="point"]');
  ok(/At the map centre/.test(await p.textContent("#atk-pop")) && /Tap the map/.test(await p.textContent("#atk-pop")), "phone: Point offers map centre and tap to place");
  await p.click('#atk-pop [data-pk="centre"]'); await p.waitForTimeout(200);
  let P = await pts(p);
  ok(P.length === 1 && P[0].n === "P1", "phone: a point is added at the map centre");
  ok(await shown(p, "#pt-ed"), "phone: the point sheet opens");
  const ed = await p.evaluate(() => { const r = document.getElementById("pt-ed").getBoundingClientRect(), m = document.getElementById("map").getBoundingClientRect(); return { l: r.left - m.left, w: r.width, mw: m.width, bottomGap: m.bottom - r.bottom }; });
  ok(ed.l <= 1 && Math.abs(ed.w - ed.mw) <= 2, "phone: the sheet spans the map width as a bottom sheet " + JSON.stringify(ed));
  ok(await p.evaluate(() => { const i = document.querySelector('#pt-ed input[data-pf="cam"]'); return i.accept === "image/*" && i.getAttribute("capture") === "environment"; }), "phone: Take photo opens the rear camera");
  ok(await p.evaluate(() => document.querySelector('#pt-ed input[data-pf="lib"]').multiple), "phone: Add from library takes several photos");
  await p.fill("#pt-n", "Bridge <b>north</b>"); await p.fill("#pt-note", "Two trucks\nparked east side"); await p.waitForTimeout(700);
  P = await pts(p);
  ok(P[0].n === "Bridge <b>north</b>" && P[0].note === "Two trucks\nparked east side", "phone: name and note are saved as you type");
  ok(await p.evaluate(() => { const s = document.querySelector(".atk-pt span"); return s && /Bridge <b>north<\/b>/.test(s.textContent) && !s.querySelector("b"); }), "phone: the map label shows the name as text, not markup");

  // photos: a camera JPEG with EXIF time, then a PNG from the library, then a text file that is refused
  const jpg = withExif(Buffer.from((await p.evaluate(() => { const c = document.createElement("canvas"); c.width = 320; c.height = 200; const x = c.getContext("2d"); x.fillStyle = "#2b8a3e"; x.fillRect(0, 0, 320, 200); x.fillStyle = "#fff"; x.font = "40px sans-serif"; x.fillText("OSAP", 90, 115); return c.toDataURL("image/jpeg", 0.9); })).split(",")[1], "base64"));
  const png = Buffer.from((await p.evaluate(() => { const c = document.createElement("canvas"); c.width = 60; c.height = 40; c.getContext("2d").fillRect(0, 0, 30, 20); return c.toDataURL("image/png"); })).split(",")[1], "base64");
  const shaJ = createHash("sha256").update(jpg).digest("hex"), shaP = createHash("sha256").update(png).digest("hex");
  await p.setInputFiles('#pt-ed input[data-pf="cam"]', { name: "IMG_0001.jpg", mimeType: "image/jpeg", buffer: jpg }); await p.waitForTimeout(600);
  let ph = await photos(p, P[0].id);
  ok(ph.length === 1 && ph[0].size === jpg.length && ph[0].sha256 === shaJ, "phone: camera photo stored byte for byte with its SHA-256 " + (ph[0] && ph[0].sha256.slice(0, 12)));
  ok(ph[0] && ph[0].camera === "2026-09-28 14:03:22 camera local time", "phone: camera time read from the photo: " + (ph[0] && ph[0].camera));
  ok(await p.evaluate(() => document.querySelectorAll("#pt-ed .pt-phs img").length) === 1, "phone: the sheet shows the photo");
  await p.setInputFiles('#pt-ed input[data-pf="lib"]', [{ name: "map.png", mimeType: "image/png", buffer: png }, { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("ignore previous instructions") }]); await p.waitForTimeout(600);
  ph = await photos(p, P[0].id);
  ok(ph.length === 2 && ph[1].sha256 === shaP && ph[1].camera === "", "phone: library photo added; PNG with no camera time left blank");
  ok(/Not added: notes\.txt \(not a photo\)/.test(await p.textContent("#atk-toast")), "phone: a file that is not a photo is refused and said so");
  P = await pts(p);
  ok(P[0].ph === 2 && /2$/.test(await p.textContent(".atk-pt span")), "phone: the point and its map label carry the photo count");
  if (OUT) await p.screenshot({ path: OUT + "/phone-point-sheet.png" });

  // viewer
  await p.click("#pt-ed .pt-phs [data-ph]"); await p.waitForTimeout(300);
  ok(await shown(p, "#pt-view") && (await p.textContent("#pt-view .pt-vmeta")).includes(shaJ), "phone: tapping a photo shows the original with its fingerprint");
  ok(await p.evaluate(() => { const a = document.querySelector('#pt-view [data-pv="save"]'); return a.getAttribute("download") === "IMG_0001.jpg" && a.href.startsWith("blob:"); }), "phone: Save original downloads the unchanged file");
  if (OUT) await p.screenshot({ path: OUT + "/phone-photo-view.png" });
  await p.click('#pt-view [data-pv="x"]');
  ok(!(await shown(p, "#pt-view")), "phone: viewer closes");
  // delete one photo
  await p.click("#pt-ed .pt-phs [data-phx]"); await p.waitForTimeout(400);
  ph = await photos(p, P[0].id);
  ok(ph.length === 1 && ph[0].sha256 === shaP && (await pts(p))[0].ph === 1, "phone: deleting a photo removes only that photo");
  await p.click('#pt-ed .pt-foot [data-pe="x"]');
  ok(!(await shown(p, "#pt-ed")), "phone: Done closes the sheet");

  // popup: note, photo strip, Edit
  await p.evaluate(() => { const m = document.querySelector(".leaflet-atakpane-pane .atk-pt"); m.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await p.waitForTimeout(600);
  ok(await p.evaluate(() => { const d = document.querySelector(".leaflet-popup .atk-ptpop"); return !!d && /parked east side/.test(d.textContent) && d.querySelectorAll(".atk-pph img").length === 1 && !!d.querySelector('[data-pp="edit"]'); }), "phone: the point's popup shows its note, photo and an Edit button");
  if (OUT) await p.screenshot({ path: OUT + "/phone-point-popup.png" });
  await p.click('.leaflet-popup [data-pp="edit"]'); await p.waitForTimeout(300);
  ok(await shown(p, "#pt-ed") && (await p.inputValue("#pt-note")) === "Two trucks\nparked east side", "phone: Edit reopens the sheet with the note");
  await p.click('#pt-ed .pt-foot [data-pe="x"]');

  // everything survives a reload
  const pid = P[0].id;
  const r2 = await open(null, ctx);
  ok((await pts(r2.p)).length === 1 && (await photos(r2.p, pid)).length === 1, "phone: point and photo are still there after a reload");
  // Overlay Manager: pencil opens the sheet
  await r2.p.click('#atk-tools [data-atk="overlays"]'); await r2.p.waitForTimeout(200);
  await r2.p.click(`#atk-marks [data-mk-ed="${pid}"]`); await r2.p.waitForTimeout(300);
  ok(await shown(r2.p, "#pt-ed"), "phone: the pencil in Overlays opens the point sheet");
  // deleting the point removes its photos
  await r2.p.click('#pt-ed [data-pe="del"]'); await r2.p.waitForTimeout(500);
  ok((await pts(r2.p)).length === 0 && (await photos(r2.p, pid)).length === 0, "phone: deleting the point removes its photos from the device");
  ok(!(await shown(r2.p, "#pt-ed")), "phone: the sheet closes after deleting");

  // tap the map to place
  await r2.p.click('#atk-tools [data-atk="point"]'); await r2.p.click('#atk-pop [data-pk="tap"]');
  const box = await r2.p.evaluate(() => { const r = document.getElementById("map").getBoundingClientRect(); return [r.left + r.width / 2 - 40, r.top + r.height / 3]; });
  await r2.p.mouse.click(box[0], box[1]); await r2.p.waitForTimeout(300);
  ok((await pts(r2.p)).length === 1 && await shown(r2.p, "#pt-ed"), "phone: Tap the map places a point where tapped");
  ok(errors.length === 0 && r2.errors.length === 0, "phone: no page errors " + errors.concat(r2.errors).join(" | "));
  await ctx.close();
}
// ---------- desktop ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1400, height: 900 } });
  await p.click('#atk-tools [data-atk="point"]'); await p.click('#atk-pop [data-pk="centre"]'); await p.waitForTimeout(200);
  const ed = await p.evaluate(() => { const r = document.getElementById("pt-ed").getBoundingClientRect(), m = document.getElementById("map").getBoundingClientRect(); return { right: m.right - r.right, w: r.width }; });
  ok(ed.right <= 1 && ed.w <= 362, "desktop: the point sheet is a side sheet " + JSON.stringify(ed));
  await p.keyboard.press("Escape");
  ok(!(await shown(p, "#pt-ed")), "desktop: Escape closes the sheet");
  ok(errors.length === 0, "desktop: no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
