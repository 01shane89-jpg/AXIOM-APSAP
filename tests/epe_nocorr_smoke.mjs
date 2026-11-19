// Headless check of "No corridor" (assets/osap-epe.js; Shane 19 Nov 2026: "I need to be able to choose not to have a corridor"):
// per route, no band or circles on the map, no corridor made from the route, kept with the plan, said in the KMZ and the CONOP;
// a width brings the corridor back.
// Run from the repo root: node tests/epe_nocorr_smoke.mjs   (needs the playwright package and Chromium)
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
const OLD = JSON.parse(await readFile(join(root, "tests/data/epe_plan_2026-11-19.json"), "utf8"));

async function context(state) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 }, acceptDownloads: true, ...(state ? { storageState: state } : {}) });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript((plan) => { try { localStorage.setItem("osap-home", "map"); if (!localStorage.getItem("osap-epe-plans")) { localStorage.setItem("osap-epe-plans", JSON.stringify([plan])); localStorage.setItem("osap-epe-cur", JSON.stringify(plan.id)); } } catch (e) {} }, OLD);
  return ctx;
}
async function page(ctx, errors) {
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_EPE_GO, null, { timeout: 60000 }); await p.waitForTimeout(2000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  await p.evaluate(() => window.OSAP_EPE_GO({}));
  await p.waitForFunction(() => window.OSAP_EPE && !document.getElementById("epe").hidden, null, { timeout: 20000 });
  return p;
}
const st = (p) => p.evaluate(() => window.OSAP_EPE.state());
const kept = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("osap-epe-plans") || "[]"));
const drawn = async (p) => (await st(p)).drawn;


{
  const errors = [], ctx = await context(null), p = await page(ctx, errors);
  let s = await st(p);
  if (!s.plan) { await p.click('#epe .epekept [data-ep-open="' + OLD.id + '"]'); s = await st(p); }
  ok(!!s.sel && !!(await p.$("#epe .epecorr")), "a route is selected and shows its corridor");
  const sel = s.sel;
  ok(s.dr && s.dr.band > 0, "its corridor band is on the map (" + JSON.stringify(s.dr) + ")");
  ok(await p.evaluate(() => document.querySelector("#epe [data-ep-cw] option").value === "none"), "the width list starts with No corridor");
  await p.selectOption("#epe [data-ep-cw]", "none");
  await p.waitForTimeout(300);
  s = await st(p);
  ok((await p.$$(".epecorrband")).length === 0 && (await p.$$("path.epecirc")).length === 0 && s.dr.band === 0 && s.dr.circ === 0,"No corridor: no band and no circles on the map");
  ok(await p.evaluate(() => /No corridor \(analyst's choice\)/.test(document.querySelector("#epe .epecorr h4").textContent) && document.querySelector("#epe details.epecirc").hidden), "the panel says No corridor and hides the circles");
  ok(await p.evaluate(() => document.querySelector('#epe [data-ep="cmband"]').disabled && document.querySelector('#epe [data-ep="gcorr"]').disabled), "Corridor from the route and Corridor on landmarks are off for it");
  const n0 = (s.plan.cm || []).length;
  await p.evaluate(() => { const b = document.querySelector('#epe [data-ep="cmband"]'); b.disabled = false; b.click(); });
  ok(((await st(p)).plan.cm || []).length === n0, "and a forced tap still makes no corridor");
  const kept = await p.evaluate((sel) => JSON.parse(localStorage.getItem("osap-epe-plans")).flatMap((x) => x.opts).find((o) => o.id === sel), sel);
  ok(kept && kept.corr && kept.corr.none === true && kept.corr.w === 2, "kept with the plan (width kept as the search distance)");
  const kml = await p.evaluate(() => window.OSAP_EPE.planKml());
  ok(/Corridor: No corridor \(analyst&apos;s choice\)|Corridor: No corridor \(analyst's choice\)/.test(kml), "the KMZ says so");
  const h = await p.evaluate(() => window.OSAP_EPE.conopHtml());
  ok(/None \(analyst(&#39;|')s choice\)/.test(h), "the CONOP route table says None for its corridor");
  /* a width brings it back */
  await p.selectOption("#epe [data-ep-cw]", "5");
  await p.waitForTimeout(300);
  s = await st(p);
  ok(s.dr.band > 0 && !s.plan.opts.find((o) => o.id === sel).corr.none, "choosing 5 km brings the corridor back");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
