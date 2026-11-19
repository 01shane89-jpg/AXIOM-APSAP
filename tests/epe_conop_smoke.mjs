// Headless check of the evacuation plan as a CONOP (assets/osap-epe.js; Shane 19 Nov 2026: "i want to be able to export this
// info as a CONOP"): the five paragraphs filled from the plan, the planner's blanks bracketed, a DRAFT banner, the analyst's
// control measures and ground-to-air signals, Word without maps, and the two buttons by Save plan.
// Run from the repo root: node tests/epe_conop_smoke.mjs   (needs the playwright package and Chromium)
// Run from the repo root: node tests/epe_tree_smoke.mjs   (needs the playwright package and Chromium)
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


const markText = (p, cls) => p.evaluate((c) => [...document.querySelectorAll(c)].map((m) => m.textContent.trim()), cls);
{
  const errors = [], ctx = await context(null), p = await page(ctx, errors);
  let s = await st(p);
  if (!s.plan) { await p.click('#epe .epekept [data-ep-open="' + OLD.id + '"]'); s = await st(p); }
  await p.evaluate(() => { const E = window.OSAP_EPE; E.addCm("pl", [[14.55, 100.6], [14.55, 100.9]], "PL BLUE"); E.addCm("pt", [[14.7, 100.8]], "Rally Bravo"); E.addCm("gtas", [[14.75, 100.75]], "Signal 1"); });
  await p.waitForTimeout(200);
  const h = await p.evaluate(() => window.OSAP_EPE.conopHtml());
  ok(["1. SITUATION", "2. MISSION", "3. EXECUTION", "4. SUSTAINMENT", "5. COMMAND AND SIGNAL"].every((t) => h.includes(t)), "the five paragraphs");
  ok(/CONCEPT OF OPERATIONS/.test(h) && /<b>DRAFT\.<\/b>/.test(h) && /not approved/.test(h), "titled and marked DRAFT, not approved");
  ok((h.match(/class="bl"/g) || []).length >= 10 && h.includes("[Commander") === false && h.includes("[purpose]"), "the planner's blanks are bracketed");
  ok(/Phase I, Preparation/.test(h) && /Phase II, Movement/.test(h) && /Phase III, Arrival/.test(h), "phases from the primary route");
  ok(/Routes \(PACE\)/.test(h) && /OSAP proposal|set by the analyst/.test(h), "routes by PACE role, with who set each status");
  ok(h.includes("PL BLUE") && h.includes("Rally Bravo") && h.includes("Signal 1") && /ICAO Annex 12/.test(h), "the analyst's phase line, point and ground-to-air signal");
  ok(/ANNEX A\. Evacuation map/.test(h) && /<svg/.test(h), "Annex A has the map");
  const hw = await p.evaluate(() => window.OSAP_EPE.conopHtml(true));
  ok(!/<svg/.test(hw) && hw.includes("5. COMMAND AND SIGNAL"), "the Word version leaves the maps out");
  ok(!/<script/i.test(h) && !/<script/i.test(hw), "no script in the CONOP");
  /* the buttons */
  ok(!!(await p.$('#epe [data-ep="conop"]')) && !!(await p.$('#epe [data-ep="conopw"]')), "CONOP (PDF) and CONOP (Word) sit by Save plan");
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 15000 }), p.click('#epe [data-ep="conopw"]')]);
  const fp = await dl.path(), body = await readFile(fp, "utf8");
  ok(/^osap-conop-.*\.doc$/.test(dl.suggestedFilename()) && body.includes("CONCEPT OF OPERATIONS"), "CONOP (Word) downloads a .doc: " + dl.suggestedFilename());
  const [pop] = await Promise.all([p.waitForEvent("popup", { timeout: 15000 }), p.click('#epe [data-ep="conop"]')]);
  await pop.waitForTimeout(800);
  ok(/CONCEPT OF OPERATIONS/.test(await pop.evaluate(() => document.body.innerText)), "CONOP (PDF) opens the CONOP page to print");
  if (OUT) await pop.screenshot({ path: OUT + "/conop.png", fullPage: true });
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
