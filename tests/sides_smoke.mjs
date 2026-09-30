// Headless check of Country sides (assets/osap-sides.js): nothing is marked at first; marking a country in Layers tints it on the
// map in its side's colours and adds a legend key; Russia is drawn whole (data/basemap/sides-full.js), not only its Far East; the
// choice survives a reload and a data set change, is kept on this device only, and the On/Off switch hides it; Thailand's page
// has the section too; on a conflict tab a military site in a country marked friend takes the friend frame and says why.
// Run from the repo root: node tests/sides_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1500, height: 950 } });
const sent = [];
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { if (r.request().method() !== "GET") sent.push(r.request().url()); r.abort(); });
const FIX = { schema: "osap-cf-sites/1", id: "russia-ukraine", asof: "2026-09-29 15:00Z", built: "2026-09-29 15:00Z", sources: [{ id: "wikidata", ok: true, n: 2 }],
  sites: [{ n: "Test Air Base", k: "air", la: 48.5, lo: 35.0, cc: "ua", wd: "Q1" }, { n: "Other Air Base", k: "air", la: 47.5, lo: 34.0, cc: "zz", wd: "Q2" }] };
await ctx.route(/conflicts\/sites\/russia-ukraine\.js/, (r) => r.fulfill({ contentType: "text/javascript", body: '(window.OSAP_CF_SITES=window.OSAP_CF_SITES||{})["russia-ukraine"]=' + JSON.stringify(FIX) + ";" }));
await ctx.addInitScript(() => { try { if (!sessionStorage.getItem("t0")) { sessionStorage.setItem("t0", "1"); localStorage.setItem("osap-home", "map"); localStorage.removeItem("osap-sides"); } } catch (e) {} });
const p = await ctx.newPage(), errors = [];
p.on("pageerror", (e) => errors.push(e.message));
async function open(hash, cc) {
  await p.goto(base + hash, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(4000);
  await p.waitForFunction((c) => window.TSAP && window.TSAP.country === c && document.getElementById("ml-sides"), cc, { timeout: 60000 });
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
}
// the map draws on a canvas, so read the tint shapes from Leaflet's own layers
const paths = () => p.evaluate(() => { const o = []; window.__asapMap.eachLayer((l) => { if (l.feature && l.options && l.options.pane === "sidespane") o.push({ f: l.options.fillColor, d: l.options.dashArray || "" }); }); return o; });
function tint() { return p.evaluate(() => { const b = []; window.__asapMap.eachLayer((l) => { if (l.options && l.options.pane === "sidespane" && l.getBounds && l.feature) b.push(l.getBounds().toBBoxString()); }); return b; }); }
// Layers: the tactical toolbar's Overlays sheet, or the classic Layers button
async function layers() {
  if (await p.evaluate(() => { const e = document.getElementById("sd-cc"); return !!(e && e.offsetParent); })) return;
  if (await p.evaluate(() => document.documentElement.classList.contains("atak"))) await p.click('#atk-tools [data-atk="overlays"]');
  else await p.evaluate(() => document.querySelector(".mlctl .mlbtn").click());
  await p.waitForTimeout(250);
}
async function mark(cc, side) { await layers(); await p.selectOption("#sd-cc", cc); await p.click('#sd-seg [data-side="' + side + '"]'); await p.waitForTimeout(500); }

await open("#vn/timeline", "vn");
ok((await paths()).length === 0, "nothing is tinted before the user marks a country");
ok(await p.evaluate(() => document.getElementById("sd-cc").value === "vn"), "the country list starts on the open country");
ok(await p.evaluate(() => !!document.querySelector("#ml-panel #ml-sides")), "the Country sides section is in Layers");
await mark("cn", "h");
let ps = await paths();
ok(ps.length === 1 && /#D7372E/i.test(ps[0].f) && !ps[0].d, "China marked hostile draws one red, solid-edged tint (" + JSON.stringify(ps) + ")");
ok(await p.evaluate(() => /Country sides/.test((document.querySelector('[data-lg="sides"]') || {}).textContent || "") && /Hostile/.test(document.querySelector('[data-lg="sides"]').textContent) && /China/.test(document.querySelector('[data-lg="sides"]').textContent)),
  "the map legend lists Hostile: China");
await mark("vn", "a");
ps = await paths();
ok(ps.length === 2 && ps.some((x) => /#2F7FE0/i.test(x.f) && x.d), "Vietnam marked assumed friend draws blue with a dashed edge");
await mark("ru", "s");
await p.waitForFunction(() => !!window.OSAP_SIDES_FULL, null, { timeout: 10000 });
await p.waitForTimeout(400);
const bb = await tint();
ok(bb.some((s) => { const v = s.split(",").map(Number); return v[0] < 30 && v[2] > 180; }), "Russia is drawn whole, from Kaliningrad across the dateline (" + bb.join(" | ") + ")");
ok(await p.evaluate(() => { const s = JSON.parse(localStorage.getItem("osap-sides")); return s.m.cn === "h" && s.m.vn === "a" && s.m.ru === "s" && s.show === true; }), "the marks are kept in this browser");
if (OUT) await p.screenshot({ path: OUT + "/sides-vn.png" });
// a data set change unticks the Layers extras (extrasOff); Country sides is not one of them
await p.evaluate(() => { const b = document.querySelector('#view-seg button[data-view]:not([aria-pressed="true"])'); if (b) b.click(); });
await p.waitForTimeout(800);
ok((await paths()).length === 3, "changing data set keeps the tints");
await layers(); await p.click("#sd-show"); await p.waitForTimeout(300);
ok((await paths()).length === 0 && !(await p.evaluate(() => document.querySelector('[data-lg="sides"]'))), "switching Country sides off hides the tints and the legend");
await p.click("#sd-show"); await p.waitForTimeout(300);
// the chip unmarks a country
await layers(); await p.click('#sd-list .sd-x[data-cc="vn"]'); await p.waitForTimeout(300);
ok((await paths()).length === 2 && await p.evaluate(() => !JSON.parse(localStorage.getItem("osap-sides")).m.vn), "unmarking a country removes its tint");

// Thailand has no outline layer of its own; the tint draws there too, and survives a reload
await open("#th/timeline", "th");
ok((await paths()).length === 2, "after a reload, on Thailand's page, the two marks still draw");

// conflict tab: a site in a country marked friend takes the friend frame; a site in an unmarked country keeps the unknown frame
await open("#ua/timeline", "ua");
await mark("ua", "f");
await p.keyboard.press("Escape"); await p.waitForTimeout(1000);
await p.evaluate(() => document.querySelector('#view-seg [data-view="cf-russia-ukraine"]').click());
await p.waitForFunction(() => document.querySelector("#cfs .cfk"), null, { timeout: 30000 });
await p.evaluate(() => { setTimeout(() => window.__asapMap.setView([48, 34.5], 8), 50); });
await p.waitForTimeout(2500);
ok(await p.evaluate(() => getComputedStyle(window.__asapMap.getPane("sidespane")).visibility !== "hidden" && [...(function () { const o = []; window.__asapMap.eachLayer((l) => { if (l.feature && l.options.pane === "sidespane") o.push(l); }); return o; })()].length === 3),
  "on the conflict tab the tints stay visible (China, Russia, Ukraine)");
const fr = await p.evaluate(() => ({ f: document.querySelectorAll("#map .msym.msk-ms_air_f").length, u: document.querySelectorAll("#map .msym.msk-ms_air").length }));
ok(fr.f === 1 && fr.u === 1, "the Ukrainian site has the friend frame and the other keeps the unknown frame (" + JSON.stringify(fr) + ")");
await p.evaluate(() => { window.__asapMap.eachLayer((m) => { if (m.getLatLng && m.getLatLng().lat === 48.5 && m.getPopup && m.getPopup()) m.openPopup(); }); });
await p.waitForTimeout(500);
ok(await p.evaluate(() => /you marked Ukraine friend/.test((document.querySelector(".leaflet-popup-content") || {}).textContent || "")), "the pop-up says the frame is the user's own mark");
ok(await p.evaluate(() => /you marked friend/i.test((document.querySelector('[data-lg="cf-sites"]') || {}).textContent || "")), "the Military sites legend explains the friend frame");
if (OUT) await p.screenshot({ path: OUT + "/sides-ua.png" });
await p.evaluate(() => window.OSAP_SIDES.set("ua", null)); await p.waitForTimeout(600);
ok(await p.evaluate(() => document.querySelectorAll("#map .msym.msk-ms_air_f").length === 0 && document.querySelectorAll("#map .msym.msk-ms_air").length === 2), "unmarking redraws the site in the unknown frame");
ok(!sent.length, "nothing is sent anywhere" + (sent.length ? ": " + sent.join(" ") : ""));
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
