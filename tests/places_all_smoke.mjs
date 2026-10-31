// Headless check that My places (assets/osap-places.js) manages every saved map object, not only points and routes (Shane
// 2026-10-31): NAI/TAI areas, imported KML shapes and saved viewsheds are listed; each one's own box and its folder's box hide
// and show it on the map; Show all / Hide all set every box at once and delete nothing; Go to shows a hidden one; it survives a
// reload; Map overlays > Your marks opens My places.
// Run from the repo root: node tests/places_all_smoke.mjs   (needs playwright + Chromium; OUT=dir saves screenshots)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
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
const shown = (p, s) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && getComputedStyle(e).display !== "none" && e.getClientRects().length > 0; }, s);
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

async function open(ctx) {
  const errors = [];
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message)); p.on("dialog", (d) => d.accept());
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_PLACES && window.OSAP_AOI && window.OSAP_TERRAIN_ANALYSIS, null, { timeout: 60000 }); await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
  return { p, errors };
}
// what is on the map: NAI/TAI labels, imported shape paths, viewshed names, point marks
const onMap = (p) => p.evaluate(() => ({
  aoi: document.querySelectorAll(".leaflet-tooltip.aoilbl").length,
  sh: document.querySelectorAll(".leaflet-wsshapes-pane path").length,
  vs: document.querySelectorAll(".vsname").length,
  pt: document.querySelectorAll(".leaflet-atakpane-pane .atk-pt").length,
}));
const store = (p, k) => p.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), k);

for (const vp of [{ width: 1400, height: 900, tag: "desktop" }, { width: 390, height: 844, tag: "phone", mobile: true }]) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.mobile, hasTouch: !!vp.mobile });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  let { p, errors } = await open(ctx);
  const T = vp.tag;
  await p.evaluate(() => {
    const c = window.TSAP.country, now = Date.now();
    localStorage.setItem("osap-atak-pts", JSON.stringify([{ id: "pa1", cc: c, lat: 14.8, lon: 100.6, n: "HLZ", t: now }]));
    localStorage.setItem("osap-aoi", JSON.stringify([{ id: "aoi-t1", type: "NAI", name: "1", cc: c, pts: [[14.8, 100.6], [14.9, 100.6], [14.9, 100.7], [14.8, 100.7]] }]));
    localStorage.setItem("osap-shapes", JSON.stringify([{ id: "sh-k1", kind: "poly", name: "Objective Gold", cc: c, pts: [[14.7, 100.5], [14.75, 100.5], [14.75, 100.55]], added: now }]));
    localStorage.setItem("osap-viewsheds", JSON.stringify([{ id: "vstest1", name: "Viewshed 01", mode: "viewshed", on: true, radius_m: 3000, target_height_m: 2, result: { visible_pct: 40 }, observer: { lat: 14.85, lon: 100.65, height_m: 2 }, visible: [{ o: [[14.84, 100.64], [14.86, 100.64], [14.86, 100.66]], h: [] }], horizon: [] }]));
  });
  await p.close(); ({ p, errors } = await open(ctx));
  await p.evaluate(() => window.__asapMap.setView([14.8, 100.6], 11)); await p.waitForTimeout(400);
  let m = await onMap(p);
  ok(m.aoi === 1 && m.sh >= 1 && m.vs === 1 && m.pt === 1, T + ": the area, shape, viewshed and point are drawn " + JSON.stringify(m));
  // Map overlays > Your marks opens My places
  await p.click('#atk-tools [data-atk="overlays"]'); await p.waitForTimeout(250);
  ok(await shown(p, "[data-mk-places]"), T + ": Map overlays > Your marks has My places");
  await p.click("[data-mk-places]"); await p.waitForTimeout(200);
  ok(await shown(p, "#plc"), T + ": and it opens My places");
  const top = await p.evaluate(() => [...document.querySelectorAll("#plc .pltree > ul > li.pli .pln")].map((x) => x.textContent));
  ok(["NAI 1 Area", "Objective Gold Shape", "Viewshed 01 Viewshed", "HLZ Point"].every((n) => top.includes(n)), T + ": every kind of saved map object is listed " + JSON.stringify(top));
  // each item's own box
  await p.uncheck('#plc [data-pli="ai:aoi-t1"]'); await p.uncheck('#plc [data-pli="sh:sh-k1"]'); await p.uncheck('#plc [data-pli="vs:vstest1"]'); await p.waitForTimeout(250);
  m = await onMap(p);
  ok(m.aoi === 0 && m.sh === 0 && m.vs === 0 && m.pt === 1, T + ": each item's own box takes it off the map " + JSON.stringify(m));
  ok((await store(p, "osap-viewsheds"))[0].on === false, T + ": a viewshed's box is its own switch (the terrain panel's)");
  ok((await store(p, "osap-aoi")).length === 1 && (await store(p, "osap-shapes")).length === 1, T + ": hiding deletes nothing");
  await p.check('#plc [data-pli="ai:aoi-t1"]'); await p.check('#plc [data-pli="sh:sh-k1"]'); await p.check('#plc [data-pli="vs:vstest1"]'); await p.waitForTimeout(250);
  m = await onMap(p);
  ok(m.aoi === 1 && m.sh >= 1 && m.vs === 1, T + ": ticking them brings them back " + JSON.stringify(m));
  // a folder
  const fa = await p.evaluate(() => window.OSAP_PLACES.newFolder("")); await p.keyboard.press("Enter"); await p.waitForTimeout(150);
  for (const k of ["ai:aoi-t1", "sh:sh-k1", "vs:vstest1"]) { await p.selectOption(`#plc [data-plmv="${k}"]`, fa); await p.waitForTimeout(120); }
  await p.uncheck(`#plc [data-plf="${fa}"]`); await p.waitForTimeout(250);
  m = await onMap(p);
  ok(m.aoi === 0 && m.sh === 0 && m.vs === 0 && m.pt === 1, T + ": unticking the folder hides the area, shape and viewshed in it, the point outside stays " + JSON.stringify(m));
  ok((await store(p, "osap-viewsheds"))[0].on !== false, T + ": the viewshed keeps its own switch on while its folder is off");
  // reload keeps the folder off
  await p.close(); ({ p, errors } = await open(ctx));
  await p.evaluate(() => window.__asapMap.setView([14.8, 100.6], 11)); await p.waitForTimeout(400);
  m = await onMap(p);
  ok(m.aoi === 0 && m.sh === 0 && m.vs === 0 && m.pt === 1, T + ": still hidden after a reload " + JSON.stringify(m));
  await p.evaluate(() => window.OSAP_PLACES.open()); await p.waitForTimeout(150);
  await p.evaluate(() => { const b = document.querySelector("#plc .plbar [data-pl=all1]"); b.click(); }); await p.waitForTimeout(250);
  m = await onMap(p);
  ok(m.aoi === 1 && m.sh >= 1 && m.vs === 1 && m.pt === 1, T + ": Show all brings everything back " + JSON.stringify(m));
  await p.evaluate(() => document.querySelector("#plc .plbar [data-pl=all0]").click()); await p.waitForTimeout(250);
  m = await onMap(p);
  ok(m.aoi === 0 && m.sh === 0 && m.vs === 0 && m.pt === 0, T + ": Hide all takes everything you saved off the map " + JSON.stringify(m));
  const kept = await p.evaluate(() => ["osap-atak-pts", "osap-aoi", "osap-shapes", "osap-viewsheds"].map((k) => JSON.parse(localStorage.getItem(k)).length));
  ok(kept.every((n) => n === 1), T + ": Hide all deletes nothing " + JSON.stringify(kept));
  if (OUT) await p.screenshot({ path: OUT + "/places-all-" + T + ".png" });
  await p.evaluate(() => { const f = document.querySelector("#plc [data-plfold]"); if (f && f.getAttribute("aria-expanded") === "false") f.click(); }); await p.waitForTimeout(150);
  await p.evaluate(() => document.querySelector('#plc [data-plgo="ai:aoi-t1"]').click()); await p.waitForTimeout(300);
  m = await onMap(p);
  ok(m.aoi === 1 && m.sh === 0, T + ": Go to on a hidden area shows just that area " + JSON.stringify(m));
  // a damaged hide list with an unknown kind is ignored
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem("osap-places")); s.hide["zz:x"] = 1; s.hide["<b>"] = 1; localStorage.setItem("osap-places", JSON.stringify(s)); });
  ok(await p.evaluate(() => !("zz:x" in window.OSAP_PLACES.state().hide)), T + ": an unknown kind in the hide list is dropped");
  ok(errors.length === 0, T + ": no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
