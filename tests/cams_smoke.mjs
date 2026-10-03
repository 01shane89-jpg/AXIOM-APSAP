// Headless check of the traffic cameras (assets/osap-cams.js): the switch sits in Map overlays (Infrastructure), starts off and
// reads nothing until switched on; an area with no official open cameras says where they are; zoomed out it asks to zoom in;
// close in it draws the cameras from the agency lists in data/cams (the repo's own files); hover shows the still image, a click
// opens it larger with the agency, licence and a refresh; Singapore's image address comes from the live API; a camera with
// several views (Finland) switches between them; a failed image says so; a data set change switches it off; phone taps.
// The agencies' images and the Singapore API are answered here by fixtures. Run from the repo root: node tests/cams_smoke.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const OUT = process.env.OUT || "";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();
const reads = [];
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  if (/^data\/cams\//.test(path)) reads.push(path);
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const shown = (p, s) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && getComputedStyle(e).display !== "none" && e.getClientRects().length > 0; }, s);
// a 2x2 PNG, served as every agency image
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==", "base64");
const ix = JSON.parse(await readFile(join(root, "data/cams/index.json"), "utf8"));
const sgList = JSON.parse(await readFile(join(root, "data/cams/sg-lta.json"), "utf8")).cams;
const ctxMode = { v: "" }; // "fail": every agency image 404s; "hang": they answer after 4 s
async function open(opts, hash = "") {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [], imgs = [];
  ctxMode.v = "";
  await ctx.route(/api\.data\.gov\.sg\/v1\/transport\/traffic-images/, (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify({ items: [{ cameras: sgList.map((c) => ({ camera_id: c[0], timestamp: "2026-10-01T18:05:36+08:00", image: "https://images.data.gov.sg/api/traffic-images/2026/10/" + c[0] + ".jpg", location: { latitude: c[1], longitude: c[2] } })) }] }) }));
  // Thailand's river cameras: DWR's API gives a snapshot path, then the picture by POST
  const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "GET, POST" };
  await ctx.route(/telemetry\.dwr\.go\.th\/api\//, (r) => {
    const u = r.request().url(); imgs.push(u);
    if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: CORS });
    if (/reportCctv\/snapshot\//.test(u)) return r.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify({ value: "/TA210507/2026/10/3/14_05.jpg" }) });
    if (/file\/image\/cctv/.test(u)) return r.fulfill({ status: 200, contentType: "image/png", headers: CORS, body: PNG });
    return r.fulfill({ status: 404, headers: CORS, body: "" });
  });
  // iTIC live video: the playlist is refused here, so the pop-up must say the video is not available
  await ctx.route(/camerai1\.iticfoundation\.org/, (r) => { imgs.push(r.request().url()); return r.fulfill({ status: 404, headers: CORS, body: "" }); });
  await ctx.route(/tdcctv\.data\.one\.gov\.hk|images\.data\.gov\.sg|weathercam\.digitraffic\.fi|jamcams\.tfl\.gov\.uk/, (r) => {
    imgs.push(r.request().url());
    if (/BROKEN/.test(r.request().url()) || ctxMode.v === "fail") return r.fulfill({ status: 404, body: "" });
    if (ctxMode.v === "hang") return new Promise((ok) => setTimeout(ok, 4000)).then(() => r.fulfill({ status: 200, contentType: "image/png", body: PNG })).catch(() => {});
    return r.fulfill({ status: 200, contentType: "image/png", body: PNG });
  });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)(?!.*(data\.gov\.sg|tdcctv|weathercam|jamcams|telemetry\.dwr|camerai1\.iticfoundation))/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + hash, { waitUntil: "domcontentloaded" }); await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_CAMS, null, { timeout: 60000 }); await p.waitForTimeout(3500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(400);
  return { ctx, p, errors, imgs };
}
const st = (p) => p.evaluate(() => window.OSAP_CAMS.state());
const om = async (p, want) => {
  if (await shown(p, "#atk-om") === want) return;
  await p.evaluate((w) => { if (w) window.OSAP_ATAK.overlays("overlays"); else document.querySelector('#atk-om [data-om="x"]').click(); }, want); await p.waitForTimeout(300);
};
const icons = (p) => p.evaluate(() => document.querySelectorAll(".leaflet-campt-pane .cam-ic").length);
// the camera icon nearest the middle of the map, so the click lands on screen and clear of the panels
const iconAt = (p) => p.evaluate(() => {
  const mb = document.querySelector("#map, .leaflet-container").getBoundingClientRect(), cx = mb.x + mb.width / 2, cy = mb.y + mb.height / 2;
  let best = null, bd = 1e9;
  document.querySelectorAll(".leaflet-campt-pane .cam-ic").forEach((e) => { const b = e.getBoundingClientRect(), x = b.x + b.width / 2, y = b.y + b.height / 2, d = Math.hypot(x - cx, y - cy); if (d < bd) { bd = d; best = [x, y]; } });
  return best;
});
// moves the map and waits until the cameras for the new view are drawn (their list read)
async function at(p, ll, z) {
  const d0 = await p.evaluate(() => window.OSAP_CAMS.state().draws);
  await p.evaluate(([ll, z]) => window.__asapMap.setView(ll, z, { animate: false }), [ll, z]);
  await p.waitForFunction((d0) => { const s = window.OSAP_CAMS.state(); return s.draws > d0 && !/Loading/.test(s.msg); }, d0, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(300);
}

ok(ix.sources.length >= 5 && ix.sources.every((s) => s.n > 0 && s.box && s.agency && s.licence && s.page), "index: " + ix.sources.length + " sources, each with agency, licence, page, box and count");
ok(ix.sources.every((s) => s.live || true), "index: sources " + ix.sources.map((s) => s.id + ":" + s.n).join(" "));
// every camera image address is on the service worker's never-cache list, so a phone never shows yesterday's still from its tile cache
{
  const sw = await readFile(join(root, "sw.js"), "utf8");
  const NEVER = eval(sw.match(/const NEVER = (\[[\s\S]*?\]);/)[1]);
  const missed = new Set();
  for (const s of ix.sources) {
    if (s.live) continue;
    for (const c of JSON.parse(await readFile(join(root, `data/cams/${s.id}.json`), "utf8")).cams)
      for (const u of [].concat(c[4] || [], c[5] || [])) if (!NEVER.some((r) => r.test(u))) missed.add(s.id + " " + new URL(u).host);
  }
  ok(!missed.size, "sw.js never caches any camera image" + (missed.size ? ": missing " + [...missed].slice(0, 12).join(", ") : ""));
}
// ---------- desktop ----------
{
  const { ctx, p, errors, imgs } = await open({ viewport: { width: 1360, height: 860 } });
  let s = await st(p);
  ok(!s.on && s.drawn === 0 && reads.length === 0, "desktop: starts off, nothing read (" + reads.join(",") + ")");
  ok(!(await p.evaluate(() => !!document.querySelector("#atk-tools [data-ocam]"))), "desktop: no toolbar button of its own");
  await om(p, true);
  ok(await shown(p, '#atk-om #cam-sec input[data-cam]'), "desktop: Traffic cameras switch in the Overlays sheet");
  ok(await p.evaluate(() => { const s = document.getElementById("cam-sec"), h = s.parentElement; return h.id === "ml-roads" && !!h.querySelector("[data-roads]") && !!h.closest("#ml-infra") && !h.closest("#ml-infra").hidden; }), "desktop: under Infrastructure > Roads, next to road closures");
  await p.evaluate(() => window.__asapMap.setView([22.57, 88.36], 9, { animate: false }));
  await p.check("#cam-sec input[data-cam]"); await p.waitForTimeout(1500);
  s = await st(p);
  ok(s.on && s.drawn === 0 && /No official open cameras on screen.*Hong Kong/.test(s.msg), "desktop: Kolkata has none; the note says where they are: " + s.msg.slice(0, 120));
  ok(reads.length === 1 && reads[0] === "data/cams/index.json", "desktop: only the index is read (" + reads.join(",") + ")");
  await p.evaluate(() => { const d = document.querySelector("#cam-sec .cam-cov"); d.open = true; }); await p.waitForTimeout(300);
  ok(/Hong Kong/.test(await p.evaluate(() => document.querySelector("#cam-sec [data-camcov]").textContent)), "desktop: Where cameras are available lists the agencies");
  await om(p, false);
  await at(p, [22.3, 114.17], 6);
  s = await st(p);
  ok(s.drawn === 0 && /Zoom in/.test(s.msg), "desktop: zoomed out over Hong Kong asks to zoom in: " + s.msg);
  await at(p, [22.3, 114.17], 13);
  s = await st(p);
  ok(s.drawn > 20 && s.drawn <= 700 && (await icons(p)) === s.drawn, "desktop: Hong Kong close in draws " + s.drawn + " cameras: " + s.msg);
  ok(s.lists.includes("hk-td") && !s.lists.includes("us-caltrans"), "desktop: only the on-screen agency's list was read " + s.lists.join(","));
  ok(await p.evaluate(() => /Traffic camera/.test(document.body.innerHTML)), "desktop: legend entry");
  // hover: a small image
  const r = await iconAt(p);
  await p.mouse.move(r[0], r[1]); await p.waitForTimeout(700);
  const tip = await p.evaluate(() => { const t = document.querySelector(".cam-tt img.cam-tip"); return t ? { src: t.getAttribute("src"), rp: t.getAttribute("referrerpolicy"), w: t.naturalWidth } : null; });
  ok(tip && /tdcctv\.data\.one\.gov\.hk\/.+\.JPG\?t=\d+/.test(tip.src) && tip.rp === "no-referrer", "desktop: hover shows the agency's still image " + JSON.stringify(tip));
  await p.mouse.click(r[0], r[1]); await p.waitForTimeout(700);
  const pop = await p.evaluate(() => { const x = document.querySelector(".leaflet-popup-content"); return x ? { h: x.innerHTML, t: x.textContent } : { h: "", t: "" }; });
  ok(/<img[^>]*class="cam-big"/.test(pop.h) && /Transport Department/.test(pop.t) && /DATA\.GOV\.HK/.test(pop.t) && /Fetched \d{1,2} \w+ \d{4} \d{4}Z \/ \d\d:\d\d HKT/.test(pop.t), "desktop: click opens it larger with agency, licence and Zulu + local time: " + pop.t.slice(0, 220));
  ok(/MGRS/.test(pop.t) && /not a live video or a record/.test(pop.t), "desktop: position and what the image is");
  const n0 = imgs.length;
  await p.click(".leaflet-popup-content [data-camref]"); await p.waitForTimeout(500);
  ok(imgs.length > n0, "desktop: Refresh fetches the image again");
  if (OUT) await p.screenshot({ path: OUT + "/cams-hk.png" });
  // Singapore: the address comes from the live API
  await p.evaluate(() => window.__asapMap.closePopup());
  await at(p, [1.35, 103.82], 11);
  s = await st(p);
  ok(s.drawn > 0 && s.lists.includes("sg-lta"), "Singapore: " + s.drawn + " cameras");
  { const q = await iconAt(p); await p.mouse.click(q[0], q[1]); }
  await p.waitForTimeout(900);
  const sg = await p.evaluate(() => { const x = document.querySelector(".leaflet-popup-content"); const i = x && x.querySelector("img.cam-big"); return { src: i ? i.getAttribute("src") : "", t: x ? x.textContent : "" }; });
  ok(/images\.data\.gov\.sg\/api\/traffic-images\/2026\/10\/\d+\.jpg$/.test(sg.src) && /Image taken 1 Oct 2026 1005Z \/ 18:05 SGT/.test(sg.t), "Singapore: live image address and its time: " + sg.src + " | " + (sg.t.match(/Image taken[^.]*/) || [""])[0]);
  // Finland: several views
  await p.evaluate(() => window.__asapMap.closePopup());
  await at(p, [60.05374, 23.99616], 14);
  { const q = await iconAt(p); await p.mouse.click(q[0], q[1]); }
  await p.waitForTimeout(700);
  const v0 = await p.evaluate(() => document.querySelector(".leaflet-popup-content img.cam-big").getAttribute("src"));
  const nv = await p.evaluate(() => document.querySelectorAll(".leaflet-popup-content [data-camview]").length);
  if (nv > 1) { await p.click('.leaflet-popup-content [data-camview="1"]'); await p.waitForTimeout(400); }
  const v1 = await p.evaluate(() => document.querySelector(".leaflet-popup-content img.cam-big").getAttribute("src"));
  ok(nv > 1 && v0 !== v1 && /weathercam\.digitraffic\.fi/.test(v1), "Finland: " + nv + " views, switching changes the image " + v1);
  // Thailand: a river camera shows DWR's newest snapshot with the time in its path; a live road camera starts the video player
  await p.evaluate(() => window.__asapMap.closePopup());
  await at(p, [6.47985, 101.44526], 13);
  ok(await p.evaluate(() => window.OSAP_CAMS.open("th-dwr", "b0f778e3-029f-418d-8024-e22e3004a3c9")), "Thailand river camera drawn at Sai Buri River, Yala");
  await p.waitForTimeout(1200);
  const dwr = await p.evaluate(() => { const x = document.querySelector(".leaflet-popup-content"); const i = x && x.querySelector("img.cam-big"); return { src: i ? i.getAttribute("src") : "", t: x ? x.textContent : "" }; });
  ok(/^blob:/.test(dwr.src) && /River camera/.test(dwr.t) && /Image taken 3 Oct 2026 0705Z \/ 14:05/.test(dwr.t), "Thailand river camera: DWR snapshot and its time: " + dwr.src.slice(0, 30) + " | " + (dwr.t.match(/Image taken[^·]*/) || [""])[0]);
  await p.evaluate(() => window.__asapMap.closePopup());
  await at(p, [13.69257, 101.0709], 15);
  ok(await p.evaluate(() => window.OSAP_CAMS.open("th-itic", "ITICM_BMAMI0184")), "Thailand live camera drawn in Chachoengsao");
  await p.waitForFunction(() => /not available|did not start|cannot play/.test((document.querySelector(".leaflet-popup-content") || {}).textContent || ""), null, { timeout: 25000 }).catch(() => {});
  const live = await p.evaluate(() => ({ t: (document.querySelector(".leaflet-popup-content") || {}).textContent || "", hls: !!window.Hls }));
  ok(/Road camera · live video/.test(live.t) && /live video is not available right now/.test(live.t) && live.hls && imgs.some((u) => /camerai1\.iticfoundation\.org\/hls\/.+\.m3u8/.test(u)), "Thailand live camera: the player loads, asks iTIC for the stream and says plainly when it is off air");
  await p.evaluate(() => window.__asapMap.closePopup());
  await at(p, [60.05374, 23.99616], 14);
  { const q = await iconAt(p); await p.mouse.click(q[0], q[1]); }
  await p.waitForTimeout(700);
  // a failed image says so, with a link to open it directly
  const popText = () => p.evaluate(() => (document.querySelector(".leaflet-popup-content") || {}).textContent || "");
  ctxMode.v = "fail";
  await p.click(".leaflet-popup-content [data-camref]"); await p.waitForTimeout(700);
  ok(/No image from the agency right now/.test(await popText()) && await p.evaluate(() => !!document.querySelector('.leaflet-popup-content .cam-no a[target="_blank"]')),
    "desktop: a failed image says so and offers to open it directly");
  // a slow agency: Loading first, then a plain timeout message, never a blank box
  ctxMode.v = "hang";
  await p.evaluate(() => window.OSAP_CAMS.timing({ wait: 1500 }));
  await p.click(".leaflet-popup-content [data-camref]"); await p.waitForTimeout(400);
  ok(/Loading the image/.test(await popText()), "desktop: a slow image shows Loading meanwhile");
  await p.waitForTimeout(1600);
  ok(/did not answer in 2 s/.test(await popText()), "desktop: a camera that does not answer says so: " + ((await popText()).match(/[^.]*did not answer[^.]*/) || [""])[0]);
  // Refresh keeps the old image up until the new one has arrived
  ctxMode.v = ""; await p.evaluate(() => window.OSAP_CAMS.timing({ wait: 20000 }));
  await p.click(".leaflet-popup-content [data-camref]"); await p.waitForTimeout(600);
  ctxMode.v = "hang";
  await p.click(".leaflet-popup-content [data-camref]"); await p.waitForTimeout(400);
  ok(await p.evaluate(() => !!document.querySelector(".leaflet-popup-content [data-camloading] img.cam-big")), "desktop: Refresh keeps the previous image up while the new one loads");
  await p.waitForTimeout(4200); ctxMode.v = "";
  // auto-refresh while open
  await p.evaluate(() => window.__asapMap.closePopup());
  await p.evaluate(() => window.OSAP_CAMS.timing({ tick: 700 }));
  await at(p, [60.05374, 23.99616], 14);
  { const q = await iconAt(p); await p.mouse.click(q[0], q[1]); }
  await p.waitForTimeout(400);
  const a0 = imgs.length; await p.waitForTimeout(1800);
  ok(imgs.length >= a0 + 2, "desktop: the open pop-up renews its image on its own (" + (imgs.length - a0) + " fetches)");
  await p.evaluate(() => window.__asapMap.closePopup());
  const a1 = imgs.length; await p.waitForTimeout(1500);
  ok(imgs.length === a1, "desktop: closing the pop-up stops the renewing");
  // a data set change switches it off, like the other overlays
  await p.evaluate(() => window.__asapMap.closePopup());
  await p.evaluate(() => window.TSAP.setView("crime")); await p.waitForTimeout(1200);
  s = await st(p);
  ok(!s.on && s.drawn === 0, "desktop: a data set change switches the cameras off (" + s.drawn + " left)");
  ok(errors.length === 0, "desktop: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- phone, classic controls: a tap opens the image ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await p.evaluate(() => { window.OSAP_ATAK.mode(false); if (window.OSAP_TOOLS) window.OSAP_TOOLS.fold(false); }); await p.waitForTimeout(200);
  await p.evaluate(() => document.querySelector(".mlctl .mlbtn").click()); await p.waitForTimeout(200);
  ok(await shown(p, "#cam-sec input[data-cam]"), "phone classic: Traffic cameras switch in the Layers panel");
  await p.check("#cam-sec input[data-cam]");
  await p.evaluate(() => document.querySelector(".mlctl .mlbtn").click()); await p.waitForTimeout(200);
  await at(p, [51.507, -0.128], 13);
  const s = await st(p);
  ok(s.drawn > 0, "phone: London " + s.drawn + " cameras");
  const q = await iconAt(p);
  await p.touchscreen.tap(q[0], q[1]); await p.waitForTimeout(800);
  const pop = await p.evaluate(() => { const x = document.querySelector(".leaflet-popup-content"); return x ? x.innerHTML : ""; });
  ok(/jamcams\.tfl\.gov\.uk/.test(pop) && /Transport for London/.test(pop), "phone: a tap opens the image");
  ok((await p.evaluate(() => document.querySelectorAll(".cam-tt").length)) === 0, "phone: no hover box on a touch screen");
  if (OUT) await p.screenshot({ path: OUT + "/cams-phone.png" });
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
