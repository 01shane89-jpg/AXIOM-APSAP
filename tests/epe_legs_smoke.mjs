// Headless check of EPE phase 2, legs and nodes (assets/osap-epe.js): on the selected option the analyst places nodes on the
// map (assembly area, pickup point...), which split it into numbered legs, each routed on its own; adding a node routes only
// the leg it splits. A leg marked unusable is worked out again from the node before it, every other leg kept; with no other
// line it stays unusable and the option is proposed Blocked. Nodes can be renamed and reordered; all of it is kept on the
// device, and a plan kept before legs opens as one leg. Routers mocked as in tests/epe_smoke.mjs.
// Run from the repo root: node tests/epe_legs_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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

const START = [13.69, 102.5];
function line(a, b, bend, n = 40) {
  const out = [];
  /* bent sideways (square to the line), so an alternative is a different way and not the same road run on further */
  const dl = b[0] - a[0], dn = b[1] - a[1], len = Math.hypot(dl, dn) || 1, px = -dn / len, py = dl / len;
  for (let i = 0; i <= n; i++) { const t = i / n, k = Math.sin(Math.PI * t) * bend; out.push([a[0] + dl * t + px * k, a[1] + dn * t + py * k]); }
  return out;
}
function km(c) { let m = 0; for (let i = 1; i < c.length; i++) { const dy = (c[i][0] - c[i - 1][0]) * 111000, dx = (c[i][1] - c[i - 1][1]) * 111000 * Math.cos(c[i][0] * Math.PI / 180); m += Math.hypot(dx, dy); } return m; }
function enc6(c) {
  let s = "", pl = 0, po = 0;
  const one = (v) => { v = v < 0 ? ~(v << 1) : v << 1; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } s += String.fromCharCode(v + 63); };
  for (const [la, lo] of c) { const a = Math.round(la * 1e6), b = Math.round(lo * 1e6); one(a - pl); one(b - po); pl = a; po = b; }
  return s;
}
const osrmRoute = (c, kmh) => { const m = km(c); return { distance: m, duration: m / (kmh / 3.6), geometry: { coordinates: c.map((p) => [p[1], p[0]]) }, legs: [{ distance: m, duration: m / (kmh / 3.6), steps: [] }] }; };
const calls = { osrm: 0, valhalla: 0, overpass: 0 };
let sameOnly = false;
const J = (r, body) => r.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });

async function context(state) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 }, ...(state ? { storageState: state } : {}) });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
    const u = r.request().url();
    if (/routing\.openstreetmap\.de/.test(u)) {
      calls.osrm++;
      const cs = decodeURIComponent(u.split("/driving/")[1].split("?")[0]).split(";").map((x) => x.split(",").map(Number));
      const a = [cs[0][1], cs[0][0]], b = [cs[1][1], cs[1][0]];
      return J(r, { code: "Ok", routes: sameOnly ? [osrmRoute(line(a, b, 0), 80)] : [osrmRoute(line(a, b, 0), 80), osrmRoute(line(a, b, 0.05), 70)] });
    }
    if (/valhalla1\.openstreetmap\.de/.test(u)) {
      calls.valhalla++;
      const q = JSON.parse(decodeURIComponent(u.split("json=")[1]));
      const a = [q.locations[0].lat, q.locations[0].lon], b = [q.locations[1].lat, q.locations[1].lon], c = line(a, b, sameOnly ? 0 : 0.35), m = km(c);
      return J(r, { trip: { summary: { length: m / 1000, time: m / (70 / 3.6) }, legs: [{ shape: enc6(c), summary: { length: m / 1000, time: m / (70 / 3.6) }, maneuvers: [] }] } });
    }
    if (/overpass|maps\.mail\.ru/.test(u)) {
      calls.overpass++;
      const q = decodeURIComponent((r.request().postData() || "").replace(/^data=/, ""));
      if (/aeroway"="runway"/.test(q)) return J(r, { elements: [] });
      return J(r, { elements: [{ type: "node", id: 77, lat: 13.80, lon: 102.62, tags: { aeroway: "airstrip", name: "Test Strip" } }] });
    }
    return r.abort();
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  return ctx;
}
async function page(ctx, errors) {
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_EVAC && window.OSAP_EPE_GO, null, { timeout: 60000 }); await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  return p;
}
const st = (p) => p.evaluate(() => window.OSAP_EPE && window.OSAP_EPE.state());


const legs = (s, id) => s.plan.opts.find((o) => o.id === id).legs || [];
const idle = (p) => p.waitForFunction(() => { const s = window.OSAP_EPE.state(); return !s.lbusy; }, null, { timeout: 90000 });
let state, optId;
{
  const errors = [], ctx = await context(null), p = await page(ctx, errors);
  await p.evaluate(() => { window.ASAP_ROADS = { items: [] }; window.TSAP.records.length = 0; ["ASAP_GDACS", "ASAP_QUAKES", "ASAP_NQ", "ASAP_UCDP", "ASAP_EONET"].forEach((k) => { window[k] = null; }); });
  await p.evaluate((s) => window.OSAP_EPE_GO({ at: s, how: "test" }), START);
  await p.waitForFunction(() => window.OSAP_EPE && !document.getElementById("epe").hidden, null, { timeout: 20000 });
  await p.click('#epe [data-ep="plan"]');
  await p.waitForFunction(() => { const s = window.OSAP_EPE.state(); return !s.busy && s.plan; }, null, { timeout: 90000 });
  let s = await st(p);
  const o = s.plan.opts[0]; optId = o.id;
  ok(await p.evaluate(() => /1 leg: place a node to split it/.test(document.querySelector("#epe .epelegs").textContent)), "a fresh option is one leg and says how to split it");
  ok(await p.evaluate(() => !!document.querySelector('#epe [data-ep="node"]') && document.querySelectorAll("#epe [data-ep-ntype] option").length === 8), "node kinds offered: 8 (assembly to safe haven)");
  const D = [o.dest.i.lat, o.dest.i.lon], at = (f) => [START[0] + (D[0] - START[0]) * f, START[1] + (D[1] - START[1]) * f];

  /* a node placed by tapping the map */
  await p.selectOption("#epe [data-ep-ntype]", "assembly");
  await p.click('#epe [data-ep="node"]');
  const px = await p.evaluate((ll) => { const m = window.__asapMap, q = m.latLngToContainerPoint(ll), r = m.getContainer().getBoundingClientRect(); return { x: r.left + q.x, y: r.top + q.y }; }, at(0.33));
  await p.mouse.click(px.x, px.y);
  await idle(p);
  s = await st(p);
  let L1 = legs(s, optId), on = s.plan.opts.find((x) => x.id === optId);
  ok(L1.length === 2 && on.nodes.length === 1 && on.nodes[0].type === "assembly" && /Assembly area 1/.test(on.nodes[0].name), "a node tapped on the map splits the option into 2 legs (" + L1.length + ")");
  ok(L1[0].b.id === on.nodes[0].id && L1[1].a.id === on.nodes[0].id, "the legs meet at the node");

  /* a second node: only the leg it splits is routed again */
  const c0 = { ...calls };
  await p.evaluate(([id, ll]) => window.OSAP_EPE.addNode(id, "pickup", ll[0], ll[1]), [optId, at(0.66)]);
  await idle(p);
  s = await st(p); const L2 = legs(s, optId);
  ok(L2.length === 3, "two nodes: 3 legs");
  ok(JSON.stringify(L2[0].coords) === JSON.stringify(L1[0].coords), "the first leg is kept as it was");
  ok(/2 legs routed, the rest kept/.test(s.lmsg) && calls.osrm - c0.osrm === 2, "only the 2 new legs are routed (" + (calls.osrm - c0.osrm) + " OSRM calls): " + s.lmsg);
  on = s.plan.opts.find((x) => x.id === optId);
  const sumM = L2.reduce((a, l) => a + l.m, 0);
  ok(Math.abs(on.route.m - sumM) < 2 && on.route.s > 0 && on.route.legs.length === 3, "the option's distance and time are the sum of its legs");

  /* leg 2 marked unusable: only leg 2 is worked out again, from the node before it */
  const c1 = { ...calls };
  await p.click('#epe [data-ep-fail="L2"]');
  await idle(p);
  s = await st(p); const L3 = legs(s, optId);
  ok(L3.length === 3 && JSON.stringify(L3[0].coords) === JSON.stringify(L2[0].coords) && JSON.stringify(L3[2].coords) === JSON.stringify(L2[2].coords), "a 3-leg plan recalculates only the failed leg: legs 1 and 3 unchanged");
  ok(JSON.stringify(L3[1].coords) !== JSON.stringify(L2[1].coords) && L3[1].failed.length === 1 && !L3[1].bad, "leg 2 has a different line and keeps the failed one on record");
  ok(sameP(L3[1].a, L2[1].a) && sameP(L3[1].b, L2[1].b), "leg 2 still runs from the node before it to the node after it");
  ok(calls.osrm - c1.osrm === 1, "one leg routed (" + (calls.osrm - c1.osrm) + " OSRM, " + (calls.valhalla - c1.valhalla) + " Valhalla calls)");
  ok(/a different line found/.test(s.lmsg), "says a different line was found: " + s.lmsg);

  /* no other line: the leg stays unusable and the option is proposed Blocked */
  sameOnly = true;
  await p.click('#epe [data-ep-fail="L1"]');
  await idle(p);
  s = await st(p); on = s.plan.opts.find((x) => x.id === optId);
  ok(on.legs[0].bad > 0 && on.prop.st === "Blocked" && /Leg 1/.test(on.prop.why), "no other line: leg 1 stays unusable and OSAP proposes Blocked (" + on.prop.why + ")");
  ok(await p.evaluate(() => !!document.querySelector('#epe [data-ep-unfail="L1"]') && document.querySelector('#epe [data-ep-leg="L1"]').classList.contains("bad")), "the leg shows as unusable with a Usable again button");
  sameOnly = false;
  await p.click('#epe [data-ep-unfail="L1"]');
  s = await st(p); on = s.plan.opts.find((x) => x.id === optId);
  ok(!on.legs[0].bad && on.prop.st !== "Blocked", "Usable again clears it");

  /* the analyst names and orders nodes */
  await p.fill("#epe [data-ep-nname]", "RV Bravo"); await p.press("#epe [data-ep-nname]", "Tab");
  s = await st(p); on = s.plan.opts.find((x) => x.id === optId);
  ok(on.nodes[0].name === "RV Bravo" && on.legs[0].b.name === "RV Bravo", "a node can be renamed and its legs follow");
  const drawn = await p.evaluate(() => ({ nodes: document.querySelectorAll(".epend").length, legs: document.querySelectorAll(".epelg").length }));
  ok(drawn.nodes === 2 && drawn.legs === 3, "nodes and leg numbers drawn on the map (" + JSON.stringify(drawn) + ")");
  const nid = on.nodes[1].id;
  await p.click('#epe [data-ep-nup="' + nid + '"]');
  await idle(p);
  s = await st(p); on = s.plan.opts.find((x) => x.id === optId);
  ok(on.nodes[0].id === nid && on.legs.length === 3 && on.legs[0].b.id === nid, "moving a node earlier reorders the legs");
  if (OUT) await p.screenshot({ path: OUT + "/epe-legs.png" });
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  state = await ctx.storageState();
  await ctx.close();
}
{
  const errors = [], ctx = await context(state), p = await page(ctx, errors);
  await p.evaluate(() => window.OSAP_EPE_GO({}));
  await p.waitForFunction(() => window.OSAP_EPE && !document.getElementById("epe").hidden, null, { timeout: 20000 });
  const s = await st(p), on = s.plan && s.plan.opts.find((x) => x.id === optId);
  ok(on && on.nodes.length === 2 && on.legs.length === 3 && on.nodes.some((n) => n.name === "RV Bravo") && on.legs.every((l) => l.coords.length > 1), "after a reload the nodes, their names and the legs are kept");
  /* a phase 1 plan with no legs still opens as one leg */
  await p.evaluate(() => { const a = JSON.parse(localStorage.getItem("osap-epe-plans")); const q = JSON.parse(JSON.stringify(a[0])); q.id = "epe-v1"; q.v = 1; q.opts.forEach((o) => { delete o.legs; delete o.nodes; }); a.push(q); localStorage.setItem("osap-epe-plans", JSON.stringify(a)); window.OSAP_EPE.open({}); });
  await p.click('#epe [data-ep-open="epe-v1"]');
  ok(await p.evaluate(() => /1 leg/.test(document.querySelector("#epe .epelegs").textContent)), "a plan kept before legs opens as one leg");
  ok(!errors.length, "after reload: no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}
function sameP(a, b) { return Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lon - b.lon) < 1e-6; }
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
