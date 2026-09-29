// Headless check of map point icons (assets/osap-milsym.js): the picker (affiliation, domain, search, echelon and
// modifiers), military symbols drawn on the map with milsymbol, shapes and pins, recently used, default marker, an invalid
// stored icon ignored, and the symbol kept after a reload.
// Run from the repo root: node tests/milsym_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const shown = (p, s) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && getComputedStyle(e).display !== "none" && e.getClientRects().length > 0; }, s);
const pts = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("osap-atak-pts") || "[]"));
const photos = (p, pid) => p.evaluate((pid) => window.OSAP_POINTS.photos(pid).then((a) => a.map((r) => ({ id: r.id, size: r.size, type: r.type, sha256: r.sha256, camera: r.camera, name: r.name }))), pid);

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


const sym = (p) => p.evaluate(() => (JSON.parse(localStorage.getItem("osap-atak-pts") || "[]")[0] || {}).sym || "");
// ---------- phone ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  ok(await p.evaluate(() => !window.ms && !window.OSAP_MSCAT), "phone: the symbol library is not loaded until it is needed");
  await p.click('#atk-tools [data-atk="point"]'); await p.click('#atk-pop [data-pk="centre"]'); await p.waitForTimeout(200);
  ok(await shown(p, "#pt-ed .pt-icb") && /Default marker/.test(await p.textContent("#pt-ed .pt-icl")), "phone: the point sheet has an Icon row showing the default marker");
  await p.click('#pt-ed [data-pe="icon"]');
  ok(await shown(p, "#ms-pick"), "phone: Change opens the icon picker");
  await p.waitForFunction(() => document.querySelectorAll("#ms-pick .ms-fn").length > 0, null, { timeout: 20000 });
  ok(await p.evaluate(() => !!window.ms && !!window.OSAP_MSCAT && Object.keys(window.OSAP_MSCAT.e).length >= 15), "phone: milsymbol and the 2525D function list load on first open");
  const pk = await p.evaluate(() => { const r = document.getElementById("ms-pick").getBoundingClientRect(), m = document.getElementById("map").getBoundingClientRect(); return { l: r.left - m.left, w: r.width, mw: m.width }; });
  ok(pk.l <= 1 && Math.abs(pk.w - pk.mw) <= 2, "phone: the picker is a bottom sheet across the map " + JSON.stringify(pk));
  ok(await p.evaluate(() => document.querySelectorAll("#ms-pick [data-aff]").length === 4 && document.querySelectorAll("#ms-pick [data-dom]").length === 8), "phone: four affiliations and eight domains");
  // search: infantry, hostile, company, HQ
  await p.click('#ms-pick [data-aff="6"]');
  await p.fill("#ms-pick .ms-q", "infantry"); await p.waitForTimeout(400);
  const inf = await p.evaluate(() => [...document.querySelectorAll("#ms-pick .ms-fn")].map((b) => b.getAttribute("data-fn") + " " + b.querySelector("b").textContent));
  ok(inf.some((s) => s === "10:121100 Infantry"), "phone: search finds Infantry (" + inf.length + " results)");
  await p.click('#ms-pick [data-fn="10:121100"]'); await p.waitForTimeout(150);
  await p.selectOption('#ms-pick [data-md="ech"]', "15");
  await p.selectOption('#ms-pick [data-md="hq"]', "2");
  ok(/Hostile · Land unit · Infantry · Company, battery, troop · Headquarters/.test(await p.textContent("#ms-pick .ms-desc")), "phone: preview names the built symbol: " + (await p.textContent("#ms-pick .ms-desc")));
  if (OUT) await p.screenshot({ path: OUT + "/phone-picker.png" });
  await p.click('#ms-pick [data-mk="use"]'); await p.waitForTimeout(300);
  ok((await sym(p)) === "ms:10061002151211000000", "phone: the point saves the 2525D code: " + (await sym(p)));
  ok(!(await shown(p, "#ms-pick")) && await shown(p, "#pt-ed"), "phone: back on the point sheet after choosing");
  ok(await p.evaluate(() => { const m = document.querySelector(".leaflet-atakpane-pane .atk-pt.atk-sym"); return !!m && !!m.querySelector("svg") && m.getBoundingClientRect().width > 20; }), "phone: the map shows the military symbol");
  ok(/Infantry/.test(await p.textContent("#pt-ed .pt-icl")), "phone: the Icon row names the symbol");
  // domains: air list shows air functions; the friendly affiliation changes the code
  await p.click('#pt-ed [data-pe="icon"]'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.querySelector('#ms-pick [data-aff="6"]').getAttribute("aria-checked") === "true" && !!document.querySelector('#ms-pick [data-fn="10:121100"][aria-pressed="true"]')), "phone: reopening the picker keeps the current symbol selected");
  await p.click('#ms-pick [data-dom="air"]'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => [...document.querySelectorAll("#ms-pick .ms-fn")].every((b) => /^0[12]:|^51:/.test(b.getAttribute("data-fn")))), "phone: the Air domain lists only air symbols");
  await p.click('#ms-pick [data-aff="3"]');
  await p.click('#ms-pick .ms-fn'); await p.click('#ms-pick [data-mk="use"]'); await p.waitForTimeout(200);
  ok(/^ms:1003010000110/.test(await sym(p)), "phone: a friendly air symbol is saved: " + (await sym(p)));
  // recent row, shapes and pins
  await p.click('#pt-ed [data-pe="icon"]'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.querySelectorAll("#ms-pick .ms-rec [data-sym]").length) === 2, "phone: recently used shows the two symbols used");
  await p.click('#ms-pick [data-tab="shp"]');
  await p.click('#ms-pick [data-sym="sh:diamond:e03131"]'); await p.waitForTimeout(200);
  ok((await sym(p)) === "sh:diamond:e03131", "phone: a red diamond shape can be chosen");
  await p.click('#pt-ed [data-pe="icon"]'); await p.click('#ms-pick [data-sym="ms:10061002151211000000"]'); await p.waitForTimeout(200);
  ok((await sym(p)) === "ms:10061002151211000000", "phone: tapping a recent symbol uses it at once");
  await p.click('#pt-ed [data-pe="icon"]'); await p.click('#ms-pick [data-tab="shp"]'); await p.click('#ms-pick [data-sym="pn:1a73e8"]'); await p.waitForTimeout(200);
  ok((await sym(p)) === "pn:1a73e8", "phone: a blue pin can be chosen");
  await p.click('#pt-ed [data-pe="icon"]'); await p.click('#ms-pick [data-tab="shp"]'); await p.click('#ms-pick [data-sym=""]'); await p.waitForTimeout(200);
  ok((await sym(p)) === "" && await p.evaluate(() => !document.querySelector(".atk-pt.atk-sym") && !!document.querySelector(".atk-pt i")), "phone: Default puts the teal diamond back");
  // a tampered icon string is ignored, never drawn into the page
  await p.evaluate(() => { const a = JSON.parse(localStorage.getItem("osap-atak-pts")); a[0].sym = 'sh:"><img src=x onerror=alert(1)>:ff0000'; localStorage.setItem("osap-atak-pts", JSON.stringify(a)); window.OSAP_ATAK.pts.draw(); });
  ok(await p.evaluate(() => !document.querySelector(".atk-pt img") && !!document.querySelector(".atk-pt i")), "phone: an invalid stored icon falls back to the default marker");
  // back button and escape close the picker only
  await p.click('#pt-ed [data-pe="icon"]'); await p.click('#ms-pick [data-mk="back"]');
  ok(!(await shown(p, "#ms-pick")) && await shown(p, "#pt-ed"), "phone: Back returns to the point sheet");
  // after a reload the military symbol is drawn again (library loads because a point needs it)
  await p.click('#pt-ed [data-pe="icon"]'); await p.click('#ms-pick [data-sym="ms:10061002151211000000"]'); await p.waitForTimeout(200);
  await p.click('#pt-ed .pt-foot [data-pe="x"]');
  const r2 = await open(null, ctx);
  await r2.p.waitForFunction(() => !!document.querySelector(".atk-pt.atk-sym svg"), null, { timeout: 20000 }).catch(() => {});
  ok(await r2.p.evaluate(() => !!document.querySelector(".atk-pt.atk-sym svg")), "phone: after a reload the point still shows its symbol");
  await r2.p.evaluate(() => { document.querySelector(".leaflet-atakpane-pane .atk-pt").dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await r2.p.waitForTimeout(500);
  ok(/Hostile · Land unit · Infantry/.test(await r2.p.textContent(".leaflet-popup .atk-psym").catch(() => "")), "phone: the popup names the symbol");
  if (OUT) await r2.p.screenshot({ path: OUT + "/phone-map-symbol.png" });
  ok(errors.length === 0 && r2.errors.length === 0, "phone: no page errors " + errors.concat(r2.errors).join(" | "));
  await ctx.close();
}
// ---------- desktop ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1400, height: 900 } });
  await p.click('#atk-tools [data-atk="point"]'); await p.click('#atk-pop [data-pk="centre"]'); await p.waitForTimeout(200);
  await p.click('#pt-ed [data-pe="icon"]');
  await p.waitForFunction(() => document.querySelectorAll("#ms-pick .ms-fn").length > 0, null, { timeout: 20000 });
  const pk = await p.evaluate(() => { const r = document.getElementById("ms-pick").getBoundingClientRect(), m = document.getElementById("map").getBoundingClientRect(); return { right: m.right - r.right, w: r.width }; });
  ok(pk.right <= 1 && pk.w <= 402, "desktop: the picker is a side sheet " + JSON.stringify(pk));
  await p.click('#ms-pick [data-dom="cm"]'); await p.waitForTimeout(200);
  await p.fill("#ms-pick .ms-q", "checkpoint"); await p.waitForTimeout(400);
  ok(await p.evaluate(() => !!document.querySelector('#ms-pick [data-fn="25:130300"]')), "desktop: map graphics include Checkpoint");
  if (OUT) await p.screenshot({ path: OUT + "/desktop-picker.png" });
  await p.keyboard.press("Escape");
  ok(!(await shown(p, "#ms-pick")) && await shown(p, "#pt-ed"), "desktop: Escape closes the picker first, not the point sheet");
  ok(errors.length === 0, "desktop: no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
