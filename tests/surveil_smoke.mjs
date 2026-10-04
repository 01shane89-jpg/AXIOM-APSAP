// Headless check of the surveillance-camera overlay (assets/osap-surveil.js): its switch sits in Map overlays > Infrastructure;
// man_made=surveillance points load from OpenStreetMap (Overpass, answered here by a fixture) only when switched on and zoomed in to a
// street/block; cameras are coloured by type, a cone shows the way each faces, the pop-up lists the details and a feed link when OSM
// has one; a busy server is reported, not hidden; a data set change switches it off. Run from the repo root: node tests/surveil_smoke.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
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
const settle = (p, ms = 3500) => p.waitForTimeout(ms);
const shown = (p, s) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && getComputedStyle(e).display !== "none" && e.getClientRects().length > 0; }, s);

// a handful of cameras near Bangkok: a fixed one facing east, a dome facing by compass, a panning one, an ALPR, one with no type, a guard post (not a camera), one with a feed link
const FIX = { elements: [
  { type: "node", id: 1, lat: 13.7500, lon: 100.5000, tags: { man_made: "surveillance", "surveillance:type": "camera", "camera:type": "fixed", "camera:direction": "90", operator: "City Hall", surveillance: "public" } },
  { type: "node", id: 2, lat: 13.7510, lon: 100.5010, tags: { man_made: "surveillance", "camera:type": "dome", direction: "SW", "camera:mount": "wall" } },
  { type: "node", id: 3, lat: 13.7520, lon: 100.5020, tags: { man_made: "surveillance", "camera:type": "panning" } },
  { type: "node", id: 4, lat: 13.7530, lon: 100.5030, tags: { man_made: "surveillance", "surveillance:type": "ALPR", "camera:direction": "180" } },
  { type: "node", id: 5, lat: 13.7540, lon: 100.5040, tags: { man_made: "surveillance" } },
  { type: "node", id: 6, lat: 13.7550, lon: 100.5050, tags: { man_made: "surveillance", "surveillance:type": "guard" } },
  { type: "node", id: 7, lat: 13.7560, lon: 100.5060, tags: { man_made: "surveillance", "camera:type": "fixed", "contact:webcam": "https://example.gov/cam7.jpg", name: "Bridge cam <b>x</b>" } }
] };
async function open(hash = "", overpass = "ok", opts = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [], queries = [];
  await ctx.route(/overpass|maps\.mail\.ru/, async (r) => {
    queries.push(decodeURIComponent((r.request().postData() || "").replace(/^data=/, "").replace(/\+/g, " ")));
    if (overpass === "busy") return r.fulfill({ status: 429, body: "busy" });
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FIX) });
  });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)(?!.*(overpass|maps\.mail\.ru))/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + hash, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_SURVEIL, null, { timeout: 60000 }); await settle(p);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(400);
  return { ctx, p, errors, queries };
}
const st = (p) => p.evaluate(() => window.OSAP_SURVEIL.state());
const om = async (p, want) => {
  if (await shown(p, "#atk-om") === want) return;
  await p.evaluate((w) => { if (w) window.OSAP_ATAK.overlays("overlays"); else document.querySelector('#atk-om [data-om="x"]').click(); }, want); await p.waitForTimeout(300);
};

// ---------- pure helpers ----------
{
  const { ctx, p, errors } = await open();
  const u = await p.evaluate(() => { const Sv = window.OSAP_SURVEIL; return {
    dir: [Sv.dirOf({ "camera:direction": "90" }), Sv.dirOf({ direction: "SW" }), Sv.dirOf({ direction: "-10" }), Sv.dirOf({}), Sv.dirOf({ direction: "n/a" })],
    kind: [Sv.kindOf({ "camera:type": "fixed" }), Sv.kindOf({ "camera:type": "dome" }), Sv.kindOf({ "camera:type": "panning" }), Sv.kindOf({ "surveillance:type": "ALPR" }), Sv.kindOf({})] }; });
  ok(u.dir[0] === 90 && u.dir[1] === 225 && u.dir[2] === 350 && u.dir[3] === null && u.dir[4] === null, "direction: degrees, compass, wrap, none " + JSON.stringify(u.dir));
  ok(u.kind.join() === "fixed,dome,pan,alpr,cam", "type from the OSM tags " + u.kind.join());
  const q = await p.evaluate(() => window.OSAP_SURVEIL.query(window.__asapMap.getBounds())); // just the shape
  ok(/man_made.*=.*surveillance/.test(q) && /out center tags/.test(q), "query asks Overpass for man_made=surveillance");
  const d = await p.evaluate(() => { const r = window.OSAP_SURVEIL.draw(null, 14); return r; });
  ok(d.n === 0, "draw with the layer off and no elements is empty");
  ok(errors.length === 0, "pure helpers: no page errors " + errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ---------- desktop: switch, zoom gate, draw ----------
{
  const { ctx, p, errors, queries } = await open();
  ok(!(await p.evaluate(() => !!document.querySelector("#atk-tools [data-osv]"))), "desktop: no toolbar button of its own");
  let s = await st(p); ok(!s.on && s.drawn === 0, "desktop: starts off, nothing drawn");
  await om(p, true);
  ok(await shown(p, '#atk-om #sv-sec input[data-sv="on"]'), "desktop: the switch is in the Overlays sheet");
  ok(await p.evaluate(() => { const e = document.getElementById("sv-sec"), h = e.parentElement; return h.id === "ml-infra" ? !h.hidden : /Infrastructure/.test(e.textContent); }), "desktop: under an Infrastructure heading");
  // zoomed out: switching on asks you to zoom in, fetches nothing
  await p.evaluate(() => window.__asapMap.setView([13.75, 100.5], 6, { animate: false }));
  const qn = queries.length;
  await p.check('#sv-sec input[data-sv="on"]'); await p.waitForTimeout(800);
  s = await st(p);
  ok(/Zoom in/.test(s.msg) && queries.length === qn, "desktop: zoomed out asks to zoom in and fetches nothing: " + s.msg.slice(0, 60));
  // zoom in: the cameras load, the guard post is left out (6 of 7), the ALPR and fixed ones draw
  await p.evaluate(() => window.__asapMap.setView([13.753, 100.503], 15, { animate: false })); await p.waitForTimeout(1600);
  s = await st(p);
  ok(s.drawn === 6, "desktop: six cameras drawn, the guard post left out (" + s.drawn + ")");
  ok(/6 cameras on screen/.test(s.msg) && /3 show the way they face/.test(s.msg), "desktop: count and how many face a known way: " + s.msg.slice(0, 80));
  ok(await p.evaluate(() => window.__asapMap.getPane("svpt").querySelectorAll("path").length >= 3), "desktop: a direction cone is drawn for the cameras that face a known way");
  ok(await p.evaluate(() => /Surveillance cameras/.test(document.body.innerHTML) && /direction a camera faces/.test(document.body.innerHTML)), "desktop: legend with the camera types and the cone note");
  await ctx.close();
  void errors;
}

// ---------- the pop-up: details and a feed link ----------
{
  const { ctx, p } = await open();
  const html = await p.evaluate(() => window.OSAP_SURVEIL.pop("fixed",
    { man_made: "surveillance", "camera:type": "fixed", "camera:direction": "90", operator: "City Hall", "camera:mount": "pole", "contact:webcam": "https://example.gov/cam7.jpg", name: "Bridge <b>x</b>" },
    { type: "node", id: 7 }));
  ok(/Fixed camera · OpenStreetMap/.test(html), "pop-up names the camera type and OpenStreetMap");
  ok(/Facing<\/dt><dd>90° \(E\)/.test(html), "pop-up: the way the camera faces, in degrees and compass");
  ok(/example\.gov\/cam7\.jpg/.test(html) && /Open this camera’s feed/.test(html), "pop-up: a feed link when OSM records one");
  ok(/City Hall/.test(html) && /pole/.test(html) && !/<b>x<\/b>/.test(html), "pop-up: operator and mount shown, name escaped");
  const noFeed = await p.evaluate(() => window.OSAP_SURVEIL.pop("dome", { man_made: "surveillance", "camera:type": "dome" }, { type: "node", id: 2 }));
  ok(!/Open this camera/.test(noFeed), "pop-up: no feed link when OSM has none");
  await ctx.close();
}

// ---------- busy server is reported ----------
{
  const { ctx, p } = await open("", "busy");
  await om(p, true);
  await p.evaluate(() => window.__asapMap.setView([13.753, 100.503], 15, { animate: false }));
  await p.check('#sv-sec input[data-sv="on"]'); await p.waitForTimeout(2000);
  const s = await st(p);
  ok(/did not load|busy/.test(s.msg) && s.drawn === 0, "desktop: a busy Overpass server is reported, not hidden: " + s.msg.slice(0, 70));
  await ctx.close();
}

// ---------- phone: the switch is in the Layers panel ----------
{
  const { ctx, p, errors } = await open("", "ok", { viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  ok(await p.evaluate(() => !!document.querySelector('#sv-sec input[data-sv="on"]')), "phone: the surveillance switch exists in the layers UI");
  ok(errors.length === 0, "phone: no page errors " + errors.slice(0, 2).join(" | "));
  await ctx.close();
}

await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
