// Headless check of the photo and video check (assets/osap-photocheck.js): it opens from a point's popup (Check a photo here) and
// from My work (Check a photo); a JPEG with EXIF shows its camera, time with offset and GPS (pinned on the map); the sun check
// draws the expected shadow; a measured shadow bearing lists the matching time; the search links open in a new tab and send
// nothing; a video steps frame by frame and a frame becomes a picture; Save to My work keeps a note; no network request is made
// for the file; the window fits a phone with no sideways scroll; Close removes the map drawing.
// Run from the repo root: node tests/photocheck_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const OUT = process.env.OUT || "";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg" };
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
function ok(c, m, x) { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x))); if (!c) fails++; }
const shown = (p, s) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && getComputedStyle(e).display !== "none" && e.getClientRects().length > 0; }, s);

/* EXIF: Make Canon, DateTimeOriginal 2026:09:28 09:30:00 +07:00, GPS 13.75 N 100.5 E */
function tiff() {
  const ents0 = [[0x010F, 2, "Canon"], [0x0110, 2, "EOS R6"], [0x8769, 4, 0], [0x8825, 4, 0]];
  const entsE = [[0x9003, 2, "2026:09:28 09:30:00"], [0x9011, 2, "+07:00"]];
  const entsG = [[1, 2, "N"], [2, 5, [[13, 1], [45, 1], [0, 1]]], [3, 2, "E"], [4, 5, [[100, 1], [30, 1], [0, 1]]]];
  const sz = (e) => 2 + e.length * 12 + 4, o0 = 8, oE = o0 + sz(ents0), oG = oE + sz(entsE);
  let dataAt = oG + sz(entsG); const head = Buffer.alloc(dataAt), data = [];
  head.write("II", 0, "latin1"); head.writeUInt16LE(42, 2); head.writeUInt32LE(8, 4);
  ents0[2][2] = oE; ents0[3][2] = oG;
  [[o0, ents0], [oE, entsE], [oG, entsG]].forEach(([o, es]) => {
    head.writeUInt16LE(es.length, o); let p = o + 2;
    for (const [tag, ty, v] of es) {
      let b; if (ty === 2) b = Buffer.from(v + "\0", "latin1"); else if (ty === 4) { b = Buffer.alloc(4); b.writeUInt32LE(v); } else { b = Buffer.alloc(8 * v.length); v.forEach(([x, y], i) => { b.writeUInt32LE(x, i * 8); b.writeUInt32LE(y, i * 8 + 4); }); }
      head.writeUInt16LE(tag, p); head.writeUInt16LE(ty, p + 2); head.writeUInt32LE(ty === 2 ? b.length : ty === 4 ? 1 : v.length, p + 4);
      if (b.length <= 4) b.copy(head, p + 8); else { head.writeUInt32LE(dataAt, p + 8); data.push(b); dataAt += b.length; }
      p += 12;
    }
    head.writeUInt32LE(0, p);
  });
  return Buffer.concat([head, ...data]);
}
function withExif(jpeg) {
  const body = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff()]), seg = Buffer.alloc(4); seg.writeUInt16BE(0xFFE1, 0); seg.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), seg, body, jpeg.subarray(2)]);
}

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const external = [];
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { external.push(r.request().url()); r.abort(); });
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#th/map", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_PHOTOCHECK && window.OSAP_WORK, null, { timeout: 60000 });
await p.waitForTimeout(2500);
await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
ok(await p.evaluate(() => typeof window.OSAP_PHOTOCHECK.open === "function" && !document.querySelector('#atk-tools [data-atk="photo"]')), "loaded, and no new toolbar button");

// a point's popup offers Check a photo here, which opens the window with the point as the place
await p.evaluate(() => { window.__asapMap.setView([13.75, 100.5], 14); window.OSAP_ATAK.pts.add(window.L.latLng(13.75, 100.5), "Bridge"); window.OSAP_POINTS && window.OSAP_POINTS.close(); });
await p.waitForTimeout(300);
await p.evaluate(() => { const m = document.querySelector(".leaflet-atakpane-pane .atk-pt"); m.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await p.waitForTimeout(500);
ok(await p.evaluate(() => !!document.querySelector('.leaflet-popup [data-pp="photo"]')), "the point's popup has Check a photo here");
await p.click('.leaflet-popup [data-pp="photo"]'); await p.waitForTimeout(400);
ok(await shown(p, "#phc"), "the check window opens");
ok(/point Bridge/.test(await p.textContent("#phc .phc-place")), "the point is the place for the sun check");
ok(await p.evaluate(() => document.getElementById("phc").classList.contains("osplit")), "it docks beside the map (split view)");

// a JPEG with EXIF
const jpg = withExif(Buffer.from((await p.evaluate(() => { const c = document.createElement("canvas"); c.width = 160; c.height = 100; const x = c.getContext("2d"); x.fillStyle = "#2b8a3e"; x.fillRect(0, 0, 160, 100); return c.toDataURL("image/jpeg", 0.9); })).split(",")[1], "base64"));
const before = external.length;
await p.setInputFiles("#phc input[data-phc-file]", { name: "IMG_<b>1</b>.jpg", mimeType: "image/jpeg", buffer: jpg }); await p.waitForTimeout(800);
const meta = await p.textContent("#phc .phc-meta");
ok(/Canon EOS R6/.test(meta), "camera make and model shown");
ok(/2026-09-28 09:30:00 UTC\+07:00/.test(meta), "camera time with its offset shown");
ok(/13\.75000, 100\.50000/.test(meta), "GPS position shown");
ok(/can be edited or faked/.test(meta), "the faked-metadata caveat is shown");
ok(await p.evaluate(() => !document.querySelector("#phc .phc-file b") && /IMG_<b>1<\/b>\.jpg/.test(document.querySelector("#phc .phc-file").textContent)), "the file name is shown as text, not markup");
ok(/SHA-256 [0-9a-f]{64}/.test(await p.textContent("#phc .phc-file")), "the file's SHA-256 is shown");
ok(await p.evaluate(() => document.getElementById("phc-d").value === "2026-09-28" && document.getElementById("phc-t").value === "09:30" && document.getElementById("phc-o").value === "+07:00"), "the sun check takes the photo's date, time and offset");
const sun = await p.textContent("#phc .phc-sun");
ok(/azimuth \d+\.\d°/.test(sun) && /Shadows/.test(sun), "the sun's azimuth, elevation and the shadow direction are shown");
const lines = await p.evaluate(() => { let n = 0, red = 0; window.__asapMap.eachLayer((l) => { if (l instanceof window.L.Polyline && l.options.color === "#1c1c1c") n++; if (l instanceof window.L.CircleMarker && l.options.fillColor === "#c92a2a") red++; }); return { n, red }; });
ok(lines.n === 1 && lines.red === 1, "the expected shadow and the GPS pin are on the map", lines);

// the reverse: the shadow bearing at 09:30 gives back about 09:30
const bearing = await p.evaluate(() => { const C = window.OSAP_PHOTOCHECK.core; return C.shadow(C.solar(Date.UTC(2026, 8, 28, 2, 30), 13.75, 100.5)).bearing.toFixed(1); });
await p.fill("#phc-b", bearing); await p.dispatchEvent("#phc-b", "change"); await p.waitForTimeout(300);
const runs = await p.textContent("#phc .phc-runs");
ok(/09:(29|30|31) \(UTC\+07:00\) · 02(29|30|31)Z/.test(runs), "the measured shadow gives the time back, local and Zulu", runs.slice(0, 120));

// search links: new tab, nothing sent
const links = await p.evaluate(() => [...document.querySelectorAll("#phc .phc-srch a")].map((a) => ({ t: a.textContent, h: a.href, tg: a.target, rel: a.rel })));
ok(links.length === 4 && links.every((l) => l.tg === "_blank" && /noopener/.test(l.rel) && /^https:\/\//.test(l.h)) && links.map((l) => l.t).join() === "Google Lens,Bing Visual Search,Yandex Images,TinEye", "four search links open in a new tab", links.map((l) => l.t));
ok(await p.evaluate(() => { const a = document.querySelector('#phc [data-phc="save"]'); return !a.hidden && /^blob:/.test(a.href); }), "Save the picture gives the file back from the device");
ok(external.length === before, "picking and checking the file made no request off this machine", external.slice(before));

// phone fit
ok(await p.evaluate(() => { const b = document.querySelector("#phc .phc-box"); return b.scrollWidth <= b.clientWidth + 1; }), "no sideways scroll on a phone");
if (OUT) await p.screenshot({ path: OUT + "/photocheck-phone.png" });

// save to My work
await p.fill("#phc-note", "Shadows fit the morning.");
await p.click('#phc [data-phc="work"]'); await p.waitForTimeout(300);
const wk = await p.evaluate(() => Object.values(JSON.parse(localStorage.getItem("osap-work") || "{}").items || {}).filter((it) => it.snap && it.snap.layer === "photocheck"));
ok(wk.length === 1 && /Shadows fit the morning/.test(wk[0].note) && /Canon/.test(wk[0].note) && /Sun at/.test(wk[0].note) && wk[0].cc === "th", "Save to My work keeps the check and the note", wk[0] && wk[0].note.slice(0, 80));

// close removes the drawing
await p.click('#phc [data-phc="x"]'); await p.waitForTimeout(200);
ok(!(await shown(p, "#phc")), "Close hides the window");
ok(await p.evaluate(() => { let n = 0; window.__asapMap.eachLayer((l) => { if (l instanceof window.L.Polyline && l.options.color === "#1c1c1c") n++; }); return n === 0; }), "Close removes the shadow from the map");

// My work offers Check a photo and lists the saved check
await p.evaluate(() => window.OSAP_WORK.open("mine")); await p.waitForTimeout(300);
ok(/Photo check: IMG_<b>1<\/b>\.jpg/.test(await p.textContent("#mywk")) && /Your own photo check/.test(await p.textContent("#mywk")), "My work lists the saved check");
ok(await p.evaluate(() => !!document.querySelector('#mywk [data-wk-act="photo"]')), "My work has Check a photo");
await p.click('#mywk [data-wk-act="photo"]'); await p.waitForTimeout(300);
ok(await shown(p, "#phc") && !(await shown(p, "#mywk")), "Check a photo opens the window from My work");

// a video: step a frame, take it as a picture
const webm = await p.evaluate(async () => {
  const c = document.createElement("canvas"); c.width = 64; c.height = 48; const x = c.getContext("2d");
  const s = c.captureStream(30), r = new MediaRecorder(s, { mimeType: "video/webm" }), parts = [];
  r.ondataavailable = (e) => parts.push(e.data); let i = 0;
  const t = setInterval(() => { x.fillStyle = "hsl(" + (i++ * 20) + ",80%,50%)"; x.fillRect(0, 0, 64, 48); }, 33);
  r.start(); await new Promise((ok) => setTimeout(ok, 1200)); r.stop(); await new Promise((ok) => (r.onstop = ok)); clearInterval(t);
  const b = new Blob(parts, { type: "video/webm" }); return Array.from(new Uint8Array(await b.arrayBuffer()));
});
await p.setInputFiles("#phc input[data-phc-file]", { name: "clip.webm", mimeType: "video/webm", buffer: Buffer.from(webm) });
await p.waitForFunction(() => { const v = document.querySelector("#phc video"); return v && v.readyState >= 1; }, null, { timeout: 15000 }).catch(() => {});
ok(await p.evaluate(() => !!document.querySelector("#phc video")), "a video shows with frame controls");
await p.evaluate(() => { const v = document.querySelector("#phc video"); v.currentTime = 0.3; }); await p.waitForTimeout(400);
const t0 = await p.evaluate(() => document.querySelector("#phc video").currentTime);
await p.click('#phc [data-phc="ff"]'); await p.waitForTimeout(400);
const t1 = await p.evaluate(() => document.querySelector("#phc video").currentTime);
ok(Math.abs(t1 - t0 - 1 / 30) < 0.005, "Frame ▶ steps one frame", { t0, t1 });
await p.waitForFunction(() => document.querySelector("#phc video").readyState >= 2, null, { timeout: 10000 }).catch(() => {});
await p.click('#phc [data-phc="frame"]'); await p.waitForTimeout(800);
ok(await p.evaluate(() => { const i = document.querySelector("#phc img.phc-media"); return !!i && /A frame from clip\.webm at/.test(document.querySelector("#phc .phc-file").textContent); }), "Take this frame makes a picture of the frame");
ok(await p.evaluate(() => { const a = document.querySelector('#phc [data-phc="save"]'); return !a.hidden && /-frame-/.test(a.getAttribute("download")); }), "the frame can be saved for a reverse search");
await p.click('#phc [data-phc="back"]'); await p.waitForTimeout(300);
ok(await p.evaluate(() => !!document.querySelector("#phc video")), "Back to the video");

ok(errors.length === 0, "no page errors", errors);
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
