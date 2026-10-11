// Headless check of the Population density overlay (assets/osap-pop.js): the switch sits in Map overlays > Population (not in
// Data sets), is off at start and asks GIBS for nothing until switched on; switched on it asks for the GPW tiles of the chosen year,
// re-colours them (GIBS classes -> 7 classes, under 1 per km² clear), adds a legend with people per km², the year and the source;
// the year picker switches tiles; it stays on after a data set change (extrasOff) and after a reload, shows on a conflict tab, and
// switches off cleanly. GIBS is answered by a made-up tile here (no network); the real host was checked by tools/probe_population.sh.
// Run from the repo root: node tests/pop_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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

// a 256x256 RGBA PNG in four bands of GIBS GPW colours: under 1 per km² (255,242,209), 50-75 (251,165,74),
// 1000 and over (189,0,38), and no data (transparent)
function crc32(b) { let c, t = crc32.t || (crc32.t = Array.from({ length: 256 }, (_, n) => { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; })); c = ~0; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return (~c) >>> 0; }
function chunk(type, data) { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
const BANDS = [[255, 242, 209, 255], [251, 165, 74, 255], [189, 0, 38, 255], [0, 0, 0, 0]];
const raw = Buffer.alloc(256 * (1 + 256 * 4));
for (let y = 0; y < 256; y++) { const o = y * (1 + 1024); for (let x = 0; x < 256; x++) BANDS[Math.floor(y / 64)].forEach((v, i) => { raw[o + 1 + x * 4 + i] = v; }); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(256, 0); ihdr.writeUInt32BE(256, 4); ihdr[8] = 8; ihdr[9] = 6;
const TILE = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const shown = (p, s) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && getComputedStyle(e).display !== "none" && e.getClientRects().length > 0; }, s);
let got = [];
async function context(opts) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    if (/gibs\.earthdata\.nasa\.gov\/wmts\/epsg3857\/best\/GPW_Population_Density_/.test(u)) { got.push(u.match(/Density_(\d{4})/)[1]); return r.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: TILE }); }
    return r.abort();
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  return ctx;
}
async function open(ctx, hash = "") {
  const p = await ctx.newPage(), errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  got = [];
  await p.goto(base + hash, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_POP, null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
  return { p, errors };
}
// what is drawn: tile canvases in the population pane, and the colours in the bands of the first finished one
const drawn = (p) => p.evaluate(() => {
  const pane = window.__asapMap.getPane("poppane"), cs = pane ? [...pane.querySelectorAll("canvas")] : [];
  const c = cs.find((c) => c.complete) || null, px = [];
  if (c) { const g = c.getContext("2d"); [32, 96, 160, 224].forEach((y) => px.push([...g.getImageData(128, y, 1, 1).data])); }
  return { n: cs.length, px, legend: (document.body.innerHTML.match(/Population density, (\d{4})/) || [])[1] || "", perkm: /People per km²/.test(document.body.innerHTML) };
});
// canvas alpha is premultiplied, so a read-back colour can be off by a unit or two
const near = (a, b) => b.every((v, i) => Math.abs(a[i] - v) <= 3);
const om = (p) => p.evaluate(() => window.OSAP_ATAK.overlays("overlays")).then(() => p.waitForTimeout(400));
// ---------- desktop ----------
{
  const ctx = await context({ viewport: { width: 1360, height: 860 } });
  let { p, errors } = await open(ctx);
  let s = await drawn(p);
  ok(s.n === 0 && got.length === 0 && !s.legend, "starts off, no tile asked for (" + got.length + ")");
  await om(p);
  ok(await shown(p, "#atk-om #ml-pop input[data-pop]"), "Population density switch in the Overlays sheet");
  ok(await p.evaluate(() => { const a = document.getElementById("ml-elev"), b = document.getElementById("ml-pop"); return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); }), "Population sits below Elevation and terrain");
  await p.evaluate(() => window.OSAP_ATAK.overlays("datasets")); await p.waitForTimeout(300);
  ok(!(await shown(p, "#ml-pop")), "not in the Data sets panel");
  await om(p);
  await p.evaluate(() => window.__asapMap.setView([13.7, 100.5], 6, { animate: false }));
  await p.check("#ml-pop input[data-pop]"); await p.waitForTimeout(2000);
  s = await drawn(p);
  ok(s.n > 0 && got.length > 0 && got.every((y) => y === "2020"), "switched on: 2020 tiles asked for and drawn (" + s.n + " tiles)");
  ok(s.legend === "2020" && s.perkm, "legend: people per km², year 2020");
  ok(/GPW v4/.test(await p.evaluate(() => document.querySelector(".leaflet-control-attribution").innerHTML)), "source credited on the map");
  const [lo, mid, hi, none] = s.px;
  ok(lo && lo[3] === 0, "under 1 per km² left clear (" + lo + ")");
  ok(mid && near(mid, [253, 174, 97]) && mid[3] > 150, "50-75 per km² drawn in the 25-100 class colour (" + mid + ")");
  ok(hi && near(hi, [84, 0, 98]) && hi[3] > 200, "1,000+ per km² drawn in the top class colour (" + hi + ")");
  ok(none && none[3] === 0, "no data left clear (" + none + ")");
  if (OUT) await p.screenshot({ path: OUT + "/pop-z6.png" });
  got = [];
  await p.selectOption("#ml-pop select", "2005"); await p.waitForTimeout(1500);
  s = await drawn(p);
  ok(got.length > 0 && got.every((y) => y === "2005") && s.legend === "2005", "year picker: 2005 tiles and legend (" + [...new Set(got)].join() + ")");
  // a data set change switches the other overlays off, not this one
  await p.evaluate(() => { const i = document.querySelector("#ml-ds input[data-ds]"); if (i) i.click(); }); await p.waitForTimeout(1200);
  ok((await drawn(p)).n > 0 && await p.isChecked("#ml-pop input[data-pop]"), "stays on after a data set change");
  await p.evaluate(() => { location.hash = "#ua/cf-russia-ukraine"; }); await p.waitForTimeout(3000);
  const vis = await p.evaluate(() => { const pn = window.__asapMap.getPane("poppane"); return pn ? getComputedStyle(pn).visibility + "/" + getComputedStyle(pn).display : "none"; });
  ok(vis === "visible/block", "shows on a conflict tab (" + vis + ")");
  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await p.close();
  ({ p, errors } = await open(ctx));
  await p.waitForTimeout(1500);
  s = await drawn(p);
  ok(s.n > 0 && s.legend === "2005" && got.every((y) => y === "2005"), "still on, year kept, after a reload");
  await om(p);
  await p.uncheck("#ml-pop input[data-pop]"); await p.waitForTimeout(500);
  s = await drawn(p);
  ok(s.n === 0 && !s.legend, "switched off: tiles and legend gone");
  ok(errors.length === 0, "no page errors after reload " + errors.join(" | "));
  await ctx.close();
}
// ---------- phone ----------
{
  const ctx = await context({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  const { p, errors } = await open(ctx);
  await om(p);
  ok(await shown(p, "#ml-pop input[data-pop]"), "phone: switch reachable in Map overlays");
  await p.evaluate(() => window.OSAP_POP.set(true)); await p.waitForTimeout(1500);
  ok((await drawn(p)).n > 0, "phone: tiles drawn");
  if (OUT) await p.screenshot({ path: OUT + "/pop-phone.png" });
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
