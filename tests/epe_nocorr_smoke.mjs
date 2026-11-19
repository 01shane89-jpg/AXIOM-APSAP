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
  /* Shane 19 Nov: "i want to be able to have all the routes inside the corridor if i want" */
  const c0 = (s.plan.cm || []).length;
  await p.evaluate(() => document.querySelector('#epe [data-ep="cmall"]').click());
  await p.waitForTimeout(300);
  s = await st(p);
  const allC = (s.plan.cm || [])[c0];
  ok(allC && allC.k === "corr" && allC.name === "Corridor all routes" && (s.plan.cm || []).length === c0 + 1, "Corridor round all routes adds one corridor");
  const inside = (pt, ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [yi, xi] = ring[i], [yj, xj] = ring[j]; if ((yi > pt[0]) !== (yj > pt[0]) && pt[1] < (xj - xi) * (pt[0] - yi) / (yj - yi) + xi) c = !c; } return c; };
  const outs = s.plan.opts.flatMap((o) => o.route.coords.filter((q) => !inside(q, allC.pts)).map(() => o.dest.i.name));
  ok(s.plan.opts.length >= 2 && outs.length === 0, "every route (" + s.plan.opts.length + ") lies inside it" + (outs.length ? ": outside " + [...new Set(outs)].join(", ") : ""));
  ok(/one outline round \d+ routes/.test(await p.evaluate(() => document.getElementById("epe-cmmsg").textContent)), "and the panel says so with its area");
  /* a route set to No corridor is left out of it */
  await p.selectOption("#epe [data-ep-cw]", "none");
  await p.evaluate(() => document.querySelector('#epe [data-ep="cmall"]').click());
  await p.waitForTimeout(300);
  s = await st(p);
  const c2 = s.plan.cm[s.plan.cm.length - 1], selO = s.plan.opts.find((o) => o.id === sel), others = s.plan.opts.filter((o) => o.id !== sel);
  ok(c2 !== allC && others.every((o) => o.route.coords.every((q) => inside(q, c2.pts))) && /, 5 km beyond$/.test(c2.how) === false, "with one route set to No corridor, it wraps the others (" + c2.how + ")");
  /* Shane 19 Nov: "when i try to select the route it always selects the corridor": a tap on a route inside a corridor selects the route */
  const xy = await p.evaluate((id) => {
    const m = window.__asapMap, pl = window.OSAP_EPE.state().plan;
    /* the route point furthest from every other route (of any route but the selected one), so only that route lies under the finger */
    let c = null, best = -1; pl.opts.filter((o) => o.id !== id).forEach((o) => { const rest = pl.opts.filter((q) => q.id !== o.id).flatMap((q) => q.route.coords); o.route.coords.forEach((q) => { const d = Math.min(...rest.map((r) => (r[0] - q[0]) ** 2 + (r[1] - q[1]) ** 2)); if (d > best) { best = d; c = q; window.__want = o.id; } }); });
    m.setView(c, 13, { animate: false }); return new Promise((res) => setTimeout(() => { window.__tp = c; const pt = m.latLngToContainerPoint(c), r = m.getContainer().getBoundingClientRect(); res({ x: r.left + pt.x, y: r.top + pt.y, hit: (() => { const e = document.elementFromPoint(r.left + pt.x, r.top + pt.y); return e ? e.tagName + "#" + e.id + "." + (e.getAttribute("class") || "") + " in map: " + m.getContainer().contains(e) + " parent " + (e.parentElement && (e.parentElement.id || e.parentElement.className)) : ""; })(), panel: document.getElementById("epe").getBoundingClientRect().left }); }, 800));
  }, sel);
  if (process.env.DBG) console.log(JSON.stringify(xy), await p.evaluate(() => { const m = window.__asapMap; let n = 0; m.eachLayer((l) => { if (l instanceof L.Path && l.options.className === "epehit") n++; }); const cv = [...m.getContainer().querySelectorAll("canvas")].map((c) => { const r = c.getBoundingClientRect(); return c.parentElement.className.split(" ")[1] + " " + Math.round(r.left) + "," + Math.round(r.top) + " " + Math.round(r.width) + "x" + Math.round(r.height) + " pe=" + getComputedStyle(c).pointerEvents; }).join(" | "); let hits = []; m.eachLayer((l) => { if (l instanceof L.Path && l._containsPoint && l._map && l.options.interactive !== false) { try { if (l._containsPoint(m.latLngToLayerPoint(window.__tp))) hits.push(l.options.className || "?"); } catch (e) {} } }); const rs = []; m.eachLayer((l) => { if (l instanceof L.Canvas && l._container) rs.push(l); }); const pt = m.latLngToLayerPoint(window.__tp); const order = rs.map((r) => { const o2 = []; for (let o = r._drawLast; o; o = o.prev) { const l = o.layer; if (l && l.options && l.options.interactive !== false && l._containsPoint && l._containsPoint(pt)) o2.push(l.options.className || "?"); } return r._container.parentNode.className.split(" ")[1] + ":" + o2.join(","); }).join(" / "); return order + " || " + cv + " || hits " + hits.join(",") + " || hit lines " + n + ", msg " + document.getElementById("epe-cmmsg").textContent; }));
  await p.waitForTimeout(300);
  /* markers (checkpoints) can sit on the route here; this checks the route against the corridor under it */
  await p.addStyleTag({ content: ".leaflet-marker-icon{pointer-events:none!important}" });
  await p.mouse.click(xy.x, xy.y);
  await p.waitForTimeout(400);
  console.log("sel", (await st(p)).sel, "want", await p.evaluate(() => window.__want), "orig", sel, await p.evaluate(() => document.getElementById("epe-cmmsg").textContent)); ok((await st(p)).sel === (await p.evaluate(() => window.__want)) && !/Drag the round handles/.test(await p.evaluate(() => document.getElementById("epe-cmmsg").textContent)), "a tap on a route inside the corridor selects the route, not the corridor");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
