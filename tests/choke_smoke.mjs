// Headless check of shipping chokepoints against last year (assets/osap-choke.js): the switch sits in Map overlays > Ships with
// its AIS caveat and NC credit; nothing is fetched while off; data/live/choke/index.json (the committed file) draws one marker
// per chokepoint; a pop-up gives the last 7 days against the base year, a sparkline, the AIS caveat and the source; the World
// Bank price table shows with its CC BY credit and no cause; a list row moves the map; a missing file is reported; phone fit.
// Run from the repo root: node tests/choke_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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



import fs from "node:fs";
const FILE = JSON.parse(fs.readFileSync("data/live/choke/index.json", "utf8"));
async function open(opts, mode = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [], got = [];
  await ctx.route(/data\/live\/choke\/index\.json/, (r) => { got.push("choke"); return mode.down ? r.fulfill({ status: 404, body: "" }) : r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FILE) }); });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_CHOKE && document.getElementById("ml-choke"), null, { timeout: 60000 });
  await p.waitForTimeout(2000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(400);
  return { ctx, p, errors, got };
}
const om = (p) => p.evaluate(() => window.OSAP_ATAK.overlays("overlays"));
const txt = (h) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const hz = FILE.choke.find((c) => c.name === "Strait of Hormuz");
{
  const { ctx, p, errors, got } = await open({ viewport: { width: 1360, height: 860 } });
  await om(p); await p.waitForTimeout(400);
  ok(await shown(p, '#atk-om #ml-sea #ml-choke input[data-choke="on"]'), "desktop: switch in Overlays > Ships");
  const intro = await p.evaluate(() => document.getElementById("ml-choke").textContent);
  ok(/Shipping chokepoints: traffic against last year/.test(intro) && /transponder off is not counted/.test(intro) && /NC/.test(intro), "desktop: row, AIS caveat and NC credit");
  ok(got.length === 0, "desktop: nothing fetched while off");
  await p.check('#ml-choke input[data-choke="on"]'); await p.waitForTimeout(1500);
  const n = await p.evaluate(() => window.OSAP_CHOKE.layer().getLayers().length);
  ok(got.includes("choke") && n === FILE.choke.length, "desktop: one marker per chokepoint (" + n + ")");
  const pop = txt(await p.evaluate(() => { const l = window.OSAP_CHOKE.layer().getLayers().find((x) => x.choke === "chokepoint6"); const c = l.getPopup().getContent(); return typeof c === "function" ? c(l) : c; }));
  ok(new RegExp("Strait of Hormuz " + hz.avg7 + " tracked ships a day").test(pop) && new RegExp(String(hz.chgBase) + "% against the " + hz.base.label).test(pop), "desktop: Hormuz pop-up against the base year (" + pop.slice(0, 140) + ")");
  ok(/transponder off is not counted/.test(pop) && /IMF PortWatch/.test(pop) && /NC/.test(pop) && /Same 4 weeks a year before/.test(pop), "desktop: pop-up caveat, source, comparisons");
  ok(await p.evaluate(() => { const l = window.OSAP_CHOKE.layer().getLayers().find((x) => x.choke === "chokepoint6"); const c = l.getPopup().getContent(); return /<svg class="ckspark"/.test(c) && /<polyline/.test(c); }), "desktop: pop-up has a sparkline");
  const pr = await p.evaluate(() => document.getElementById("ck-prices").textContent);
  ok(/World prices/.test(pr) && /Crude oil, Brent/.test(pr) && /Urea/.test(pr) && /does not say what caused/.test(pr) && /CC BY 4.0/.test(pr), "desktop: price table with credit and no cause");
  const st = await p.evaluate(() => document.getElementById("ck-st").textContent);
  ok(/Ship counts to \d{4}-\d{2}-\d{2}/.test(st), "desktop: status names the latest day: " + st);
  ok(await p.evaluate(() => document.querySelectorAll("#ck-list [data-ckgo]").length >= 3), "desktop: list of the biggest falls");
  await p.evaluate(() => window.__asapMap.setView([0, 0], 3, { animate: false }));
  const first = FILE.choke.find((c) => c.chgBase != null);
  await p.click("#ck-list [data-ckgo]"); await p.waitForTimeout(600);
  ok(await p.evaluate((f) => { const c = window.__asapMap.getCenter(); return Math.abs(c.lat - f.lat) < 0.5 && Math.abs(c.lng - f.lon) < 0.5; }, first), "desktop: a list row takes the map to " + first.name);
  if (OUT) await p.screenshot({ path: OUT + "/choke-desktop.png" });
  await p.uncheck('#ml-choke input[data-choke="on"]'); await p.waitForTimeout(300);
  ok(!(await p.evaluate(() => window.__asapMap.hasLayer(window.OSAP_CHOKE.layer()))), "desktop: switching off removes the layer");
  ok(errors.length === 0, "desktop: no page errors " + errors.join(" | "));
  await ctx.close();
}
{
  const { ctx, p, errors } = await open({ viewport: { width: 1360, height: 860 } }, { down: true });
  await om(p); await p.check('#ml-choke input[data-choke="on"]'); await p.waitForTimeout(1200);
  const st = await p.evaluate(() => document.getElementById("ck-st").textContent);
  ok(/Could not load: not published yet/.test(st), "down: says it could not load: " + st);
  ok(errors.length === 0, "down: no page errors " + errors.join(" | "));
  await ctx.close();
}
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await om(p); await p.waitForTimeout(400);
  await p.check('#ml-choke input[data-choke="on"]'); await p.waitForTimeout(1500);
  const b = await p.evaluate(() => { const e = document.querySelector("#ck-list [data-ckgo]"), r = e.getBoundingClientRect(), t = document.querySelector("#ck-prices table").getBoundingClientRect(); return { h: r.height, inside: r.right <= innerWidth + 1, table: t.right <= innerWidth + 1 }; });
  ok(b.h >= 44 && b.inside && b.table, "phone: list rows 44px+ and the price table inside the screen " + JSON.stringify(b));
  if (OUT) { await p.evaluate(() => document.getElementById("ck-prices").scrollIntoView()); await p.screenshot({ path: OUT + "/choke-phone.png" }); }
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
