// Headless check of real full screen in the evacuation planner (assets/osap-epe.js; Shane 19 Nov 2026: "i want full screen to
// be legit full screen", he chose both): Map full screen puts the map over the whole window with an Exit button and folds the
// planner to its bar; Exit brings the layout back; on a large screen Full makes the planner cover the whole window.
// Run from the repo root: node tests/epe_fullscreen_smoke.mjs   (needs the playwright package and Chromium)
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
const OLD = JSON.parse(await readFile(join(root, "tests/data/epe_plan_2026-11-19.json"), "utf8"));
const rect = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom }; }, sel);

for (const vp of [{ width: 1280, height: 800, tag: "laptop" }, { width: 390, height: 844, tag: "phone" }]) {
  const errors = [];
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: vp.width, height: vp.height } });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript((plan) => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("osap-epe-plans", JSON.stringify([plan])); localStorage.setItem("osap-epe-cur", JSON.stringify(plan.id)); } catch (e) {} }, OLD);
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_EPE_GO, null, { timeout: 60000 }); await p.waitForTimeout(2000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  await p.evaluate(() => window.OSAP_EPE_GO({}));
  await p.waitForFunction(() => window.OSAP_EPE && !document.getElementById("epe").hidden, null, { timeout: 20000 });
  if (!(await p.evaluate(() => window.OSAP_EPE.state().plan))) await p.click('#epe .epekept [data-ep-open="' + OLD.id + '"]');
  await p.waitForTimeout(300);
  const before = await rect(p, "#map");
  ok(!!(await p.$('#epe [data-ep="mapfs"]')), vp.tag + ": Map full screen button in the planner");
  await p.click('#epe [data-ep="mapfs"]'); await p.waitForTimeout(500);
  const m = await rect(p, "#map");
  ok(m && Math.abs(m.l) < 1 && Math.abs(m.t) < 1 && Math.abs(m.w - vp.width) < 2 && Math.abs(m.h - vp.height) < 2, vp.tag + ": the map fills the whole window (" + JSON.stringify(m) + ")");
  const top = await p.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return !!(e && e.closest("#map")); }, [Math.round(vp.width / 2), Math.round(vp.height / 3)]);
  ok(top, vp.tag + ": nothing covers the middle of the map");
  ok(await p.isVisible("#epe-fsx"), vp.tag + ": Exit full screen button shows");
  ok((await p.evaluate(() => document.getElementById("epe").getAttribute("data-osheet"))) === "min", vp.tag + ": the planner folds to its bar");
  await p.click("#epe-fsx"); await p.waitForTimeout(500);
  const a = await rect(p, "#map");
  ok(!(await p.evaluate(() => document.documentElement.classList.contains("epe-mapfs"))) && !(await p.isVisible("#epe-fsx")) && Math.abs(a.w - before.w) < 2 && Math.abs(a.t - before.t) < 2, vp.tag + ": Exit brings the layout back");
  if (vp.width > 700) {
    await p.evaluate(() => window.OSAP_SPLIT && window.OSAP_SPLIT.stop(document.getElementById("epe"), "full")); await p.waitForTimeout(500);
    const e = await rect(p, "#epe");
    ok(e && Math.abs(e.l) < 1 && Math.abs(e.t) < 1 && Math.abs(e.w - vp.width) < 2 && Math.abs(e.h - vp.height) < 2, vp.tag + ": Full covers the whole window (" + JSON.stringify(e) + ")");
  }
  /* closing the planner leaves map full screen too */
  await p.evaluate(() => document.querySelector('#epe [data-ep="mapfs"]') && document.querySelector('#epe [data-ep="mapfs"]').click()); await p.waitForTimeout(200);
  await p.evaluate(() => window.OSAP_EPE.close && window.OSAP_EPE.close()); await p.waitForTimeout(200);
  if (await p.evaluate(() => !!(window.OSAP_EPE.close))) ok(!(await p.evaluate(() => document.documentElement.classList.contains("epe-mapfs"))), vp.tag + ": closing the planner leaves full screen");
  ok(!errors.length, vp.tag + ": no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
