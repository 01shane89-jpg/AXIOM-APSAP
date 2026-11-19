// Headless check of editing an evacuation plan by dragging on the map (assets/osap-epe.js; Shane 19 Nov 2026: "I would like to
// be able to edit items on the map by draging them"): a phase line's and an area's points show round handles after Move
// points (or a tap on the shape), dragging one with a mouse or a finger moves that point, the shape follows, the grid is
// said, and it is kept; Done hides the handles; a node on a route drags to a new place, is kept, and the legs either side are
// worked out again. Routers and other hosts are blocked, so the re-routing reports an error and nothing else changes.
// Run from the repo root: node tests/epe_drag_smoke.mjs   (needs the playwright package and Chromium)
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


const cmK = (p, k) => p.evaluate((k) => (window.OSAP_EPE.state().plan.cm || []).filter((x) => x.k === k), k);
{
  const errors = [], ctx = await context(null), p = await page(ctx, errors);
  let s = await st(p);
  if (!s.plan) { await p.click('#epe .epekept [data-ep-open="' + OLD.id + '"]'); s = await st(p); }
  await p.evaluate(() => { const m = window.__asapMap; m.setView([14.6, 100.75], 10, { animate: false }); });
  await p.evaluate(() => window.OSAP_EPE.addCm("pl", [[14.55, 100.6], [14.55, 100.9]], "PL BLUE"));
  await p.evaluate(() => window.OSAP_EPE.addCm("corr", [[14.7, 100.6], [14.7, 100.75], [14.62, 100.75], [14.62, 100.6]], "Corridor 1"));
  await p.waitForTimeout(200);
  const pl = (await cmK(p, "pl"))[0], co = (await cmK(p, "corr"))[0];
  ok(!(await p.$(".epevx")), "no handles until asked");
  await p.click('#epe [data-ep-cmed="' + pl.id + '"]');
  ok((await p.$$(".epevx")).length === 2, "Move points shows a handle on each point of the phase line");
  ok(/Done/.test(await p.textContent('#epe [data-ep-cmed="' + pl.id + '"]')), "and the button turns into Done");

  /* mouse drag of the line's first point */
  let h = await (await p.$('.epevx [data-vx="0"]')).boundingBox();
  await p.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await p.mouse.down(); await p.mouse.move(h.x + 40, h.y - 60, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(300);
  let a = (await cmK(p, "pl"))[0];
  ok(a.pts[0][0] > pl.pts[0][0] + 0.05 && a.pts[1][0] === pl.pts[1][0], "dragging moves that point only (" + pl.pts[0] + " to " + a.pts[0] + ")");
  ok((await kept(p))[0].cm.find((x) => x.id === pl.id).pts[0][0] === a.pts[0][0], "and the move is kept with the plan");
  ok(/PL BLUE: point 1 moved to 47P/.test(await p.textContent("#epe-cmmsg")), "it says the new grid");
  await p.click('#epe [data-ep-cmed="' + pl.id + '"]');
  ok(!(await p.$(".epevx")), "Done hides the handles");

  /* a finger: tap the corridor, then drag a corner by touch */
  const cpx = await p.evaluate(() => { const m = window.__asapMap, q = m.latLngToContainerPoint([14.66, 100.675]), r = m.getContainer().getBoundingClientRect(); return { x: r.left + q.x, y: r.top + q.y }; });
  await p.mouse.click(cpx.x, cpx.y); await p.waitForTimeout(200);
  ok((await p.$$(".epevx")).length === 4, "a tap on the corridor shows its 4 corner handles");
  h = await (await p.$('.epevx [data-vx="2"]')).boundingBox();
  const cdp = await ctx.newCDPSession(p), x0 = h.x + h.width / 2, y0 = h.y + h.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + i * 8, y: y0 + i * 6 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await p.waitForTimeout(300);
  a = (await cmK(p, "corr"))[0];
  ok(a.pts[2][0] < co.pts[2][0] - 0.02 && a.pts[2][1] > co.pts[2][1] + 0.02 && a.pts[0][0] === co.pts[0][0], "a finger drags a corner too (" + co.pts[2] + " to " + a.pts[2] + ")");
  ok((await kept(p))[0].cm.find((x) => x.id === co.id).pts[2][0] === a.pts[2][0], "and that is kept");

  /* a node on a route */
  await p.evaluate(() => { const S = window.OSAP_EPE.state(), o = S.plan.opts.find((x) => x.id === S.sel); o.nodes = [{ id: "n-test", type: "assembly", lat: 14.6, lon: 100.75, name: "Assembly area 1", by: Date.now() }]; });
  await p.click('#epe [data-ep-cmed="' + co.id + '"]');
  await p.waitForTimeout(300);
  const nd = await p.evaluateHandle(() => [...document.querySelectorAll(".epend")].pop());
  const nb = nd.asElement() && await nd.asElement().boundingBox();
  if (nb) { await p.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2); await p.mouse.down(); await p.mouse.move(nb.x + 50, nb.y + 40, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(500); }
  s = await st(p);
  const n2 = s.plan.opts.find((x) => x.id === s.sel).nodes[0];
  ok(nb && (n2.lat !== 14.6 || n2.lon !== 100.75), "a node drags to a new place (" + (n2 && [n2.lat, n2.lon]) + ")");
  ok((await kept(p))[0].opts.find((x) => x.id === s.sel).nodes[0].lat === n2.lat, "and that is kept");
  ok(/Assembly area 1 moved to 47P/.test(await p.textContent("#epe")), "it says where it moved and works out the legs again");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "ALL PASS");
