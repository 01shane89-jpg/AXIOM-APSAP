// Headless check of Map overlays > Restricted airspace (assets/osap-airspace.js): the section sits after Airspace and sea warnings,
// is off at start and fetches nothing; switched on far out it loads only the index and asks to zoom in; at zoom 6 it fetches only
// the countries in view, draws their areas and the key; a pop-up shows the name, type, limits, the "by NOTAM" note and the
// OpenAIP credit, with a planted <img> left as text; it stays on after a reload and switches off cleanly; a build without the
// data folder says the layer is not available; on a phone the section fits.
// The files are built here (no network). Run from the repo root: node tests/airspace_smoke.mjs   (needs playwright + Chromium; OUT=dir saves screenshots)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const OUT = process.env.OUT || "";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

const SOURCE = { name: "OpenAIP", nc: true, credit: "© OpenAIP, CC BY-NC 4.0" };
const sq = (x, y, d) => [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]];
const FILES = {
  "index.json": { source: SOURCE, asof: "2026-11-27T03:00Z", types: {}, countries: { th: { n: 3, b: [[5.6, 97.3], [20.5, 105.7]] }, fr: { n: 1, b: [[41.3, -5.2], [51.1, 9.6]] } } },
  "th.json": { source: SOURCE, cc: "th", asof: "x", a: [
    { n: "VTP1 <img src=x onerror=\"window.__xss=1\">", t: 3, lo: "GND", hi: "FL150", g: sq(100.4, 13.7, 0.3) },
    { n: "VTR22 TEST RANGE", t: 1, lo: "GND", hi: "5000 FT MSL", notam: true, g: sq(101.0, 14.2, 0.4) },
    { n: "VTD5 GUNNERY", t: 2, lo: "SFC", hi: "UNL", g: sq(99.8, 12.8, 0.5) },
    { n: "UNKNOWN TYPE", t: 99, g: sq(100.0, 14.5, 0.2) } ] },
  "fr.json": { source: SOURCE, cc: "fr", asof: "x", a: [{ n: "LF-P23", t: 3, g: sq(2.3, 48.8, 0.1) }] },
};
let asked = [], missing = false;
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  const m = /^data\/live\/airspace\/(.+)$/.exec(path);
  if (m) { asked.push(m[1]); if (missing || !FILES[m[1]]) { res.writeHead(404); return res.end(); } res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify(FILES[m[1]])); }
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const shown = (p, s) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && getComputedStyle(e).display !== "none" && e.getClientRects().length > 0; }, s);
async function context(opts) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  return ctx;
}
async function open(ctx) {
  const p = await ctx.newPage(), errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_AIRSPACE && document.getElementById("ml-asp"), null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
  return { p, errors };
}
const om = (p) => p.evaluate(() => window.OSAP_ATAK.overlays("overlays")).then(() => p.waitForTimeout(400));
const view = (p, c, z) => p.evaluate(([c, z]) => window.__asapMap.setView(c, z, { animate: false }), [c, z]).then(() => p.waitForTimeout(1200));
const st = (p) => p.textContent("#as-st");
const popOf = (p, name) => p.evaluate((name) => {
  let hit = null;
  window.__asapMap.eachLayer((l) => { if (!hit && l.getPopup && l.getPopup()) { const c = l.getPopup().getContent(); const h = typeof c === "function" ? c(l) : String(c); if (/aspop/.test(h) && h.indexOf(name) >= 0) hit = l; } });
  if (!hit) return null;
  window.__asapMap.closePopup(); hit.openPopup();
  const el = [...document.querySelectorAll(".leaflet-popup-content .aspop")].filter((e) => e.textContent.indexOf(name) >= 0).pop();
  return el ? { text: el.textContent, imgs: el.querySelectorAll("img").length } : null;
}, name);

// ---------- desktop ----------
{
  const ctx = await context({ viewport: { width: 1360, height: 860 } });
  let { p, errors } = await open(ctx);
  ok(asked.length === 0 && (await p.evaluate(() => window.OSAP_AIRSPACE.shown())) === 0, "starts off, nothing fetched");
  await om(p);
  ok(await shown(p, "#atk-om #ml-asp input[data-as=on]"), "switch in the Overlays sheet");
  ok(await p.evaluate(() => document.querySelector("#ml-asp .mlh").textContent === "Restricted airspace"), "section heading 'Restricted airspace'");
  ok(await p.evaluate(() => { const a = document.getElementById("ml-warn"), b = document.getElementById("ml-asp"); return !!(a && b && a.nextElementSibling === b); }), "sits right after Airspace and sea warnings");
  await view(p, [20, 100], 3);
  await p.check("#ml-asp input[data-as=on]"); await p.waitForTimeout(1200);
  ok(asked.join() === "index.json", "far out: only the index is fetched (" + asked.join() + ")");
  ok(/Zoom in closer/.test(await st(p)), "far out: asks to zoom in");
  await view(p, [13.9, 100.6], 7);
  ok(asked.includes("th.json") && !asked.includes("fr.json"), "zoom 7 over Thailand: only th.json fetched (" + asked.join() + ")");
  ok((await p.evaluate(() => window.OSAP_AIRSPACE.shown())) === 3, "three areas drawn, the unknown type skipped");
  ok(/3 areas drawn/.test(await st(p)) && /2026-11-27 03:00Z/.test(await st(p)), "status gives the count and data time: " + (await st(p)));
  ok(/^Prohibited/.test(await p.textContent("#as-key")) && /ADIZ/.test(await p.textContent("#as-key")), "colour key shown, Prohibited first");
  ok(await p.evaluate(() => { const r = [...document.querySelectorAll("#as-key .askey")].map((e) => e.getBoundingClientRect()); return r.length === 8 && r.every((a, i) => r.every((b, j) => i === j || a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5)); }), "key entries do not overlap");
  ok(/OpenAIP/.test(await p.textContent(".leaflet-control-attribution")), "OpenAIP credited in the map's attribution line while on");
  let pp = await popOf(p, "VTP1");
  ok(pp && pp.imgs === 0 && /<img src=x/.test(pp.text) && !(await p.evaluate(() => window.__xss)), "pop-up: planted markup shown as text, never run");
  ok(pp && /Prohibited/.test(pp.text) && /From GND to FL150/.test(pp.text) && /Not for navigation/.test(pp.text) && /OpenAIP, CC BY-NC 4\.0/.test(pp.text), "pop-up: type, limits, not-for-navigation and credit");
  pp = await popOf(p, "VTR22");
  ok(pp && /Active only when a NOTAM says so/.test(pp.text), "pop-up: 'by NOTAM' area says so");
  if (OUT) await p.screenshot({ path: OUT + "/airspace-desktop.png" });
  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await p.close();
  asked = [];
  ({ p, errors } = await open(ctx));
  await view(p, [13.9, 100.6], 7);
  ok((await p.evaluate(() => window.OSAP_AIRSPACE.shown())) === 3, "still on after a reload");
  await om(p);
  await p.uncheck("#ml-asp input[data-as=on]"); await p.waitForTimeout(500);
  ok((await p.evaluate(() => window.OSAP_AIRSPACE.shown())) === 0 && (await st(p)) === "" && (await p.textContent("#as-key")) === "", "switched off: areas, status and key gone");
  ok(!/OpenAIP/.test(await p.textContent(".leaflet-control-attribution")), "switched off: OpenAIP credit leaves the attribution line");
  ok(errors.length === 0, "no page errors after reload " + errors.join(" | "));
  await ctx.close();
}
// ---------- a build without the data (the commercial version) ----------
{
  missing = true; asked = [];
  const ctx = await context({ viewport: { width: 1360, height: 860 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-airspace", "1"); } catch (e) {} });
  const { p, errors } = await open(ctx);
  await view(p, [13.9, 100.6], 7);
  ok(/not available in this version/.test(await st(p)), "no data folder: says the layer is not available");
  ok(errors.length === 0, "no page errors without data " + errors.join(" | "));
  await ctx.close(); missing = false;
}
// ---------- phone ----------
{
  const ctx = await context({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  const { p, errors } = await open(ctx);
  await om(p);
  ok(await shown(p, "#ml-asp input[data-as=on]"), "phone: switch reachable in Map overlays");
  ok(await p.evaluate(() => [...document.querySelectorAll(".mlchips > *")].some((c) => /^Restricted airspace/.test(c.textContent.trim()))), "phone: 'Restricted airspace' chip in the section bar");
  ok(await p.evaluate(() => { const d = document.getElementById("ml-asp"); return d.scrollWidth <= d.clientWidth + 1 && d.getBoundingClientRect().right <= innerWidth + 1; }), "phone: section fits the width");
  ok(await p.evaluate(() => [...document.querySelectorAll("#ml-asp .mlrow")].every((r) => r.getBoundingClientRect().height >= 40)), "phone: switch row at least 40 px tall");
  if (OUT) await p.screenshot({ path: OUT + "/airspace-phone.png" });
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
