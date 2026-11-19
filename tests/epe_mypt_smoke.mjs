// Headless check of the analyst's own named points in an evacuation plan (assets/osap-epe.js; Shane 19 Nov 2026: "I need to
// be able to add custom points in the evacuation plan and name them whatever I want. but they live in the evac plan"):
// Add point takes any name and a typed grid (MGRS or lat, lon), or the next map tap; the point is kept in that plan only
// (plan.cm, k "pt"), listed with its grid, renamed in the list, dragged on the map, switched with "Your points", and
// exported in the plan KMZ; it survives a reload. Routers and other hosts are blocked.
// Run from the repo root: node tests/epe_mypt_smoke.mjs   (needs the playwright package and Chromium)
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


const cmOf = (p) => p.evaluate(() => (window.OSAP_EPE.state().plan.cm || []).filter((x) => x.k === "pt"));
let state;
{
  const errors = [], ctx = await context(null), p = await page(ctx, errors);
  let s = await st(p);
  if (!s.plan) { await p.click('#epe .epekept [data-ep-open="' + OLD.id + '"]'); s = await st(p); }
  ok(s.plan && s.plan.id === OLD.id, "the 19 Nov plan is open");
  ok(!!(await p.$("#epe #epe-ptf #epe-ptn")) && !!(await p.$("#epe #epe-ptf #epe-ptg")), "Add point: a name and a grid");

  /* by a typed MGRS grid, with a free name */
  await p.fill("#epe-ptn", "Rally point Bravo (school gate)"); await p.fill("#epe-ptg", "47P PS 8258 3769");
  await p.click('#epe #epe-ptf button[type="submit"]');
  let l = await cmOf(p);
  ok(l.length === 1 && l[0].name === "Rally point Bravo (school gate)" && Math.abs(l[0].pts[0][0] - 14.8072) < 0.0005 && Math.abs(l[0].pts[0][1] - 100.6966) < 0.0005, "a typed MGRS grid adds the point with the name given (" + (l[0] && l[0].pts[0]) + ")");
  ok(l[0] && l[0].how === "Typed grid", "and says it came from a typed grid");
  ok((await p.inputValue('#epe [data-ep-cmname="' + l[0].id + '"]')) === "Rally point Bravo (school gate)" && /Your point · 47P PS 82584 37694/.test(await p.textContent("#epe .epecmls")), "the plan lists it with its grid");
  ok((await kept(p))[0].cm.some((x) => x.k === "pt" && x.name === "Rally point Bravo (school gate)"), "it is kept with this plan");
  ok(!(await p.evaluate(() => Object.keys(localStorage).some((k) => /osap-atak-pts|osap-places/.test(k) && /Rally point Bravo/.test(localStorage.getItem(k))))), "and not in the global map points");

  /* lat, lon */
  await p.fill("#epe-ptn", "Fuel cache"); await p.fill("#epe-ptg", "14.70, 100.80");
  await p.click('#epe #epe-ptf button[type="submit"]');
  l = await cmOf(p);
  ok(l.length === 2 && l[1].name === "Fuel cache" && l[1].pts[0][0] === 14.7 && l[1].pts[0][1] === 100.8, "lat, lon works too");
  /* a bad grid */
  await p.fill("#epe-ptn", "Nowhere"); await p.fill("#epe-ptg", "not a grid");
  await p.click('#epe #epe-ptf button[type="submit"]');
  ok((await cmOf(p)).length === 2 && /not understood/.test(await p.textContent("#epe-cmmsg")), "a grid that is not understood adds nothing and says so");

  /* no grid: the next map tap places it */
  await p.fill("#epe-ptn", "Helo alternate"); await p.fill("#epe-ptg", "");
  await p.click('#epe #epe-ptf button[type="submit"]');
  ok(/Tap the map where Helo alternate is/.test(await p.textContent("#epe-cmmsg")), "with no grid it asks for a tap on the map");
  const px = await p.evaluate(() => { const m = window.__asapMap, q = m.latLngToContainerPoint([14.75, 100.75]), r = m.getContainer().getBoundingClientRect(); return { x: r.left + q.x, y: r.top + q.y }; });
  await p.mouse.click(px.x, px.y); await p.waitForTimeout(300);
  l = await cmOf(p);
  ok(l.length === 3 && l[2].name === "Helo alternate" && Math.abs(l[2].pts[0][0] - 14.75) < 0.02, "a tap places it with its name");

  /* rename in the list */
  await p.fill('#epe [data-ep-cmname="' + l[1].id + '"]', "Fuel cache 2"); await p.press('#epe [data-ep-cmname="' + l[1].id + '"]', "Tab");
  ok((await cmOf(p))[1].name === "Fuel cache 2", "it can be renamed");

  /* on the map, its own switch */
  const n0 = await drawn(p);
  await p.click("#epe details.epeshow summary");
  ok(!!(await p.$('#epe [data-ep-show="mypt"]')), "On the map has a Your points switch");
  await p.uncheck('#epe [data-ep-show="mypt"]');
  const n1 = await drawn(p);
  ok(n1 === n0 - 3, "switching it off hides the 3 points (" + n0 + " to " + n1 + ")");
  await p.check('#epe [data-ep-show="mypt"]');
  ok((await drawn(p)) === n0, "and on brings them back");

  /* drag one */
  const before = (await cmOf(p))[1];
  const mk = await p.evaluateHandle((nm) => [...document.querySelectorAll(".epecmmk")].find((m) => m.textContent.indexOf(nm) >= 0), "Fuel cache 2");
  const bb = mk.asElement() && await mk.asElement().boundingBox();
  if (bb) { await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.mouse.down(); await p.mouse.move(bb.x + 70, bb.y + 60, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(300); }
  const aft = (await cmOf(p)).find((x) => x.id === before.id);
  ok(bb && aft && (aft.pts[0][0] !== before.pts[0][0] || aft.pts[0][1] !== before.pts[0][1]), "dragging moves it (" + before.pts[0] + " to " + (aft && aft.pts[0]) + ")");
  ok((await kept(p))[0].cm.find((x) => x.id === before.id).pts[0][0] === aft.pts[0][0], "and the move is kept");

  /* in the KMZ */
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 15000 }), p.click('#epe [data-ep="pkmz"]')]);
  const txt = (await readFile(await dl.path())).toString("latin1");
  ok(/Rally point Bravo \(school gate\)/.test(txt) && /Fuel cache 2/.test(txt) && /Helo alternate/.test(txt), "the plan KMZ has all three by name");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  state = await ctx.storageState();
  await ctx.close();
}
{
  const errors = [], ctx = await context(state), p = await page(ctx, errors);
  let s = await st(p);
  if (!s.plan) { await p.click('#epe .epekept [data-ep-open="' + OLD.id + '"]'); }
  const l = await cmOf(p);
  ok(l.length === 3 && l.map((x) => x.name).join("|") === "Rally point Bravo (school gate)|Fuel cache 2|Helo alternate", "after a reload the plan has its 3 points");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "ALL PASS");
