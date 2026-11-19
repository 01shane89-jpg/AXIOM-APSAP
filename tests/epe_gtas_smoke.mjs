// Headless check of ground-to-air signals in an evacuation plan (assets/osap-epe.js; Shane 19 Nov 2026: "we need to add a
// ground to air signal option in the evac plan"): the ICAO Annex 12 survivor code (V, X, N, Y, arrow) or a custom code, with
// its length, arrow direction and a note, at a typed grid or a map tap; kept in the plan, drawn with its symbol, its own map
// switch, in the KMZ with its meaning. Routers and other hosts are blocked.
// Run from the repo root: node tests/epe_gtas_smoke.mjs   (needs the playwright package and Chromium)
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


const gts = (p) => p.evaluate(() => (window.OSAP_EPE.state().plan.cm || []).filter((x) => x.k === "gtas"));
let state;
{
  const errors = [], ctx = await context(null), p = await page(ctx, errors);
  let s = await st(p);
  if (!s.plan) { await p.click('#epe .epekept [data-ep-open="' + OLD.id + '"]'); s = await st(p); }
  ok(await p.evaluate(() => document.querySelectorAll("#epe-gts option").length) === 6, "Add signal offers V, X, N, Y, arrow and a custom code");
  /* V at a typed grid */
  await p.selectOption("#epe-gts", "V"); await p.fill("#epe-gtn", "Orange panels on the school field"); await p.fill("#epe-gtg", "47P PS 8258 3769");
  await p.click('#epe-gtf button[type="submit"]');
  let l = await gts(p);
  ok(l.length === 1 && l[0].sig === "V" && l[0].sz === 3 && l[0].note === "Orange panels on the school field" && Math.abs(l[0].pts[0][0] - 14.8072) < 0.0005, "V (require assistance) is placed at the typed grid with its note");
  ok(/Require assistance/.test(await p.textContent("#epe .epecmls")) && /Laid out 3 m long/.test(await p.textContent("#epe .epecmls")), "the list says what it means and how big");
  /* arrow needs a direction */
  await p.selectOption("#epe-gts", "ARR"); await p.fill("#epe-gtb", ""); await p.fill("#epe-gtg", "14.70, 100.80");
  await p.click('#epe-gtf button[type="submit"]');
  ok((await gts(p)).length === 1 && /direction in degrees/.test(await p.textContent("#epe-cmmsg")), "an arrow with no direction is not placed, and it says why");
  await p.selectOption("#epe-gts", "ARR"); await p.fill("#epe-gtb", "45"); await p.fill("#epe-gtz", "6"); await p.fill("#epe-gtg", "14.70, 100.80");
  await p.click('#epe-gtf button[type="submit"]');
  l = await gts(p);
  ok(l.length === 2 && l[1].sig === "ARR" && l[1].brg === 45 && l[1].sz === 6, "an arrow keeps its direction and length");
  ok(/pointing 45° \(NE\)/.test(await p.textContent("#epe .epecmls")), "and says where it points");
  ok(await p.evaluate(() => /rotate\(45deg\)/.test([...document.querySelectorAll(".epegtas b")].map((b) => b.getAttribute("style")).join())), "the arrow is drawn turned to 45°");
  /* custom code */
  await p.selectOption("#epe-gts", "C"); await p.fill("#epe-gtt", ""); await p.fill("#epe-gtg", "14.72, 100.82");
  await p.click('#epe-gtf button[type="submit"]');
  ok((await gts(p)).length === 2 && /own letter or code/.test(await p.textContent("#epe-cmmsg")), "a custom signal needs its code");
  await p.fill("#epe-gtt", "lz7"); await p.click('#epe-gtf button[type="submit"]');
  l = await gts(p);
  ok(l.length === 3 && l[2].sig === "C" && l[2].txt === "LZ7", "a custom code is kept in capitals");
  /* X by a map tap */
  await p.selectOption("#epe-gts", "X"); await p.fill("#epe-gtg", ""); await p.click('#epe-gtf button[type="submit"]');
  const px = await p.evaluate(() => { const m = window.__asapMap, q = m.latLngToContainerPoint([14.75, 100.75]), r = m.getContainer().getBoundingClientRect(); return { x: r.left + q.x, y: r.top + q.y }; });
  await p.mouse.click(px.x, px.y); await p.waitForTimeout(300);
  l = await gts(p);
  ok(l.length === 4 && l[3].sig === "X" && Math.abs(l[3].pts[0][0] - 14.75) < 0.02, "X (require medical) placed by a tap on the map");
  ok(await p.evaluate(() => [...document.querySelectorAll(".epegtas b")].map((b) => b.textContent).join()) === "V,↑,LZ7,X", "each drawn on the map with its symbol");
  /* its switch */
  const n0 = await drawn(p);
  await p.click("#epe details.epeshow summary");
  await p.uncheck('#epe [data-ep-show="gtas"]');
  ok((await drawn(p)) === n0 - 4, "the Ground-to-air signals switch hides the 4 signals");
  await p.check('#epe [data-ep-show="gtas"]');
  /* KMZ */
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 15000 }), p.click('#epe [data-ep="pkmz"]')]);
  const txt = (await readFile(await dl.path())).toString("utf8");
  ok(/Signal V: Require assistance/.test(txt) && /Require medical assistance/.test(txt) && /pointing 45° \(NE\)/.test(txt) && /your own code LZ7/.test(txt) && /files\/gtas\.png/.test(txt), "the KMZ has every signal with its meaning and icon");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  state = await ctx.storageState();
  await ctx.close();
}
{
  const errors = [], ctx = await context(state), p = await page(ctx, errors);
  let s = await st(p);
  if (!s.plan) { await p.click('#epe .epekept [data-ep-open="' + OLD.id + '"]'); }
  const l = await gts(p);
  ok(l.length === 4 && l.map((x) => x.sig).join() === "V,ARR,C,X", "after a reload the plan has its 4 signals");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "ALL PASS");
