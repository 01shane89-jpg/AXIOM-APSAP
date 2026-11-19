// Headless check of the evacuation plan's ground write-up and landmarks (assets/osap-epe.js; Shane 19 Nov 2026: "all the aspects
// of the plan need to be geographically explained", the evac corridor "has gegraphically identifiable borders", "phaselines
// should be associated with geographical landmarks"): one OpenStreetMap query (a made-up fixture here) gives each route its
// roads, towns and crossings by km, each point its town and road, each phase line its ends and crossing; a phase line goes onto
// the river or railway that crosses the route (or stays straight, marked); Phase lines on landmarks; Corridor on landmarks
// with each side on a canal or highway running the same way, the set width where none fits (marked); KMZ carries it all;
// OpenStreetMap down: nothing is made up.
// Run from the repo root: node tests/epe_geo_smoke.mjs   (needs the playwright package and Chromium)
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


/* a made-up piece of OpenStreetMap round option o2 (Don Mueang, 137 km): the road it runs on, a river and a railway across it,
   a canal on its left and a highway on its right running the same way, three villages */
const O2 = OLD.opts.find((o) => o.id === "o2").route.coords;
function hv(a, b) { const r = Math.PI / 180, dl = (b[0] - a[0]) * r, dn = (b[1] - a[1]) * r, x = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) ** 2; return 12742000 * Math.asin(Math.sqrt(x)); }
function at(km) { let run = 0; for (let i = 1; i < O2.length; i++) { const s = hv(O2[i - 1], O2[i]); if (run + s >= km * 1000) { const f = (km * 1000 - run) / s; return { p: [O2[i - 1][0] + (O2[i][0] - O2[i - 1][0]) * f, O2[i - 1][1] + (O2[i][1] - O2[i - 1][1]) * f], i }; } run += s; } return { p: O2[O2.length - 1], i: O2.length - 1 }; }
function norm(km) { const a = at(km - 0.5).p, b = at(km + 0.5).p, cl = Math.cos(a[0] * Math.PI / 180), dx = (b[1] - a[1]) * cl, dy = b[0] - a[0], l = Math.hypot(dx, dy); return [dx / l, dy / l]; }
function off(km, m) { const q = at(km).p, [tx, ty] = norm(km), cl = Math.cos(q[0] * Math.PI / 180); return [q[0] + tx * m / 111320, q[1] - ty * m / (111320 * cl)]; } /* + m: left of the way of travel */
function across(km, half) { return [off(km, -half), off(km, half)]; }
function parallel(k0, k1, m) { const o = []; for (let k = k0; k <= k1; k += 1) o.push(off(k, m)); return o; }
const G = (g) => g.map(([lat, lon]) => ({ lat, lon }));
const OSM = { elements: [
  { type: "way", id: 1, tags: { highway: "trunk", ref: "1", name: "Phahon Yothin Road" }, geometry: G(O2) },
  { type: "way", id: 2, tags: { waterway: "river", name: "Pa Sak River" }, geometry: G(across(40, 4000)) },
  { type: "way", id: 3, tags: { railway: "rail", name: "Northern Line" }, geometry: G(across(20, 4000)) },
  { type: "way", id: 4, tags: { waterway: "canal", name: "Khlong Rangsit" }, geometry: G(parallel(60, 110, 1500)) },
  { type: "way", id: 5, tags: { highway: "primary", ref: "340" }, geometry: G(parallel(30, 120, -2000)) },
  { type: "node", id: 6, lat: off(10, 500)[0], lon: off(10, 500)[1], tags: { place: "village", name: "Ban Mi" } },
  { type: "node", id: 7, lat: off(60, -1000)[0], lon: off(60, -1000)[1], tags: { place: "town", name: "Tha Rua" } },
  { type: "node", id: 8, lat: off(120, 300)[0], lon: off(120, 300)[1], tags: { place: "town", name: "Rangsit" } },
] };
let osmCalls = 0;
{
  const errors = [], ctx = await context(null);
  await ctx.route(/overpass|postpass|maps\.mail\.ru/, (r) => { osmCalls++; r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(OSM) }); });
  const p = await page(ctx, errors);
  let s = await st(p);
  if (!s.plan) { await p.click('#epe .epekept [data-ep-open="' + OLD.id + '"]'); s = await st(p); }
  await p.click('#epe [data-ep-sel="o2"]');
  const near = across(42, 2000), far = across(90, 2000);
  const pls = await p.evaluate(([a, b]) => [window.OSAP_EPE.addCm("pl", a, "PL BLUE").id, window.OSAP_EPE.addCm("pl", b, "PL GOLD").id], [near, far]);
  ok(!!(await p.$('#epe [data-ep="gdesc"]')) && !!(await p.$('#epe [data-ep="gpl"]')) && !!(await p.$('#epe [data-ep="gcorr"]')), "The ground: Describe the ground, Phase lines on landmarks, Corridor on landmarks");
  await p.click('#epe [data-ep="gdesc"]');
  await p.waitForFunction(() => window.OSAP_EPE.state().plan.geo, null, { timeout: 20000 });
  s = await st(p);
  const t = s.plan.geo.t, r2 = t["r:o2"] || "";
  ok(osmCalls === 1, "one OpenStreetMap query for the whole plan (" + osmCalls + ")");
  ok(/^From 47P/.test(r2) && /to Don Mueang/.test(r2) && /heading \d+° \([NSEW]+\) overall/.test(r2), "the route: from and to by grid, its length and heading (" + r2.slice(0, 160) + "…)");
  ok(/Follows 1 \(Phahon Yothin Road\) for 13\d\.?\d? km/.test(r2), "the road it follows, and for how far");
  ok(/Passes Ban Mi \(km 1[01]/.test(r2) && /Tha Rua \(km 6\d/.test(r2) && /Rangsit \(km 1[12]\d/.test(r2), "the towns it passes, by km");
  ok(/Crosses the railway Northern Line at km 2\d/.test(r2) && /the river Pa Sak River at km 4\d/.test(r2), "the river and railway it crosses, by km");
  const cp = s.plan.opts.find((o) => o.id === "o2").cps[1];
  ok(/^km \d+/.test(t[cp.id] || "") && /of (Ban Mi|Tha Rua|Rangsit)|in (Ban Mi|Tha Rua|Rangsit)/.test(t[cp.id]) && /the road 1 \(Phahon Yothin Road\)/.test(t[cp.id]), "a checkpoint: its km, the town it is near and the road it is on (" + t[cp.id] + ")");
  ok(/Runs \d/.test(t[pls[0]]) && /Crosses .*km 4\d/.test(t[pls[0]]), "a phase line: its length, ends and where it crosses the route");
  ok(/unverified on the ground/.test(await p.textContent("#epe .epegeo")), "and it says this is read off the map, unverified on the ground");
  ok(s.plan.geo.src.startsWith("OpenStreetMap contributors"), "the source is kept with the text");

  /* PL on a landmark */
  await p.click('#epe [data-ep-gsnap="' + pls[0] + '"]'); await p.waitForTimeout(400);
  let x = (await st(p)).plan.cm.find((c) => c.id === pls[0]);
  ok(x.land && x.land.name === "Pa Sak River" && x.land.kind === "river" && x.pts.length >= 2, "PL BLUE goes onto the Pa Sak River, which crosses the route 2 km from it");
  ok((await p.evaluate(() => [...document.querySelectorAll(".epecmlb")].map((m) => m.textContent).join("|"))).includes("PL BLUE = Pa Sak River"), "and its map label says PL BLUE = Pa Sak River");
  await p.click('#epe [data-ep-gsnap="' + pls[1] + '"]'); await p.waitForTimeout(400);
  x = (await st(p)).plan.cm.find((c) => c.id === pls[1]);
  ok(x.land && x.land.none && x.pts.length === 2, "PL GOLD has no landmark within 5 km: it stays straight");
  ok((await p.evaluate(() => [...document.querySelectorAll(".epecmlb")].map((m) => m.textContent).join("|"))).includes("PL GOLD (straight)"), "and its label says so");

  /* phase lines on landmarks, for the route */
  const n0 = (await st(p)).plan.cm.filter((c) => c.k === "pl").length;
  await p.click('#epe [data-ep="gpl"]'); await p.waitForTimeout(400);
  const made = (await st(p)).plan.cm.filter((c) => c.k === "pl").slice(n0);
  ok(made.length === 1 && made[0].land.name === "Northern Line", "Phase lines on landmarks puts one on each named railway and river that crosses the route, skipping the Pa Sak River that PL BLUE already holds and the road the route runs on (" + made.map((c) => c.name + "=" + c.land.name).join(", ") + ")");
  ok(/phase lines? on landmarks:/i.test(await p.textContent("#epe .epegeo")), "and says which");

  /* corridor on landmarks */
  await p.click('#epe [data-ep="gcorr"]'); await p.waitForTimeout(600);
  const co = (await st(p)).plan.cm.filter((c) => c.k === "corr").pop();
  const ed = co && co.edges || [];
  ok(co && co.pts.length > 20 && /landmarks/.test(co.name), "Corridor on landmarks makes a corridor round the route");
  ok(ed.some((e) => e.side === "L" && e.name === "Khlong Rangsit" && e.kind === "canal" && e.b - e.a >= 30), "its left side follows Khlong Rangsit where the canal runs beside the route");
  ok(ed.some((e) => e.side === "R" && e.name === "340" && e.kind === "road" && e.b - e.a >= 50), "its right side follows highway 340");
  ok(ed.some((e) => e.kind === "buffer"), "where nothing fits the side is the set width, marked as such");
  ok(!ed.some((e) => /Phahon Yothin/.test(e.name)), "a side never runs on the road the route itself follows");
  const lbls = await p.evaluate(() => [...document.querySelectorAll(".epecmlb")].map((m) => m.textContent).join("|"));
  ok(/Khlong Rangsit/.test(lbls) && /set width \(no feature\)/.test(lbls), "each stretch is named on the map");
  const tc = (await st(p)).plan.geo.t[co.id] || "";
  ok(/left side km \d+(\.\d)? to \d+(\.\d)? follows the canal Khlong Rangsit/.test(tc) && /is a set distance \(no feature fits\)/.test(tc), "and the write-up names each border (" + tc.slice(0, 200) + "…)");

  /* in the KMZ */
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 15000 }), p.click('#epe [data-ep="pkmz"]')]);
  const kml = (await readFile(await dl.path())).toString("utf8");
  ok(/Ground: From 47P/.test(kml) && /PL BLUE = Pa Sak River/.test(kml) && /follows the canal Khlong Rangsit/.test(kml), "the KMZ carries the write-up and the landmark names");
  /* in the printed plan */
  const np = await p.evaluate(() => window.OSAP_EPE.pkgs().length);
  await p.click('#epe [data-ep="pkg"]');
  await p.waitForFunction((n) => window.OSAP_EPE.pkgs().length === n + 1 && !window.OSAP_EPE.abusy(), np, { timeout: 20000 });
  const ph = await p.evaluate(() => { const k = window.OSAP_EPE.pkgs(); return window.OSAP_EPE.printHtml(k[k.length - 1].id); });
  ok(/<h2>The ground<\/h2>/.test(ph) && /unverified on the ground/.test(ph) && /PL BLUE = Pa Sak River/.test(ph) && /follows the canal Khlong Rangsit/.test(ph) && /From 47P/.test(ph), "the printed plan has The ground: every part described, landmarks named, marked unverified");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}
{
  /* OpenStreetMap down: nothing changes and it says so */
  const errors = [], ctx = await context(null);
  await ctx.route(/overpass|postpass|maps\.mail\.ru/, (r) => r.fulfill({ status: 504, body: "gateway timeout" }));
  const p = await page(ctx, errors);
  let s = await st(p);
  if (!s.plan) { await p.click('#epe .epekept [data-ep-open="' + OLD.id + '"]'); }
  await p.click('#epe [data-ep="gdesc"]');
  await p.waitForFunction(() => /did not answer/.test(document.querySelector("#epe .epegeo").textContent), null, { timeout: 60000 }).catch(() => {});
  ok(/did not answer/.test(await p.textContent("#epe .epegeo")) && !(await st(p)).plan.geo, "OpenStreetMap down: no write-up is made up, and it says so");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "ALL PASS");
