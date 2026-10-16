// Headless check of EPE phase 4, route dependencies and borders (assets/osap-epe.js): bridges, tunnels, ferries, level
// crossings and border posts that lie along the option's road legs (not ones crossing over it), in route order; the detour
// if a bridge is lost, and "no way round" said as such; a closure report shown, otherwise "no source", never open; the border
// crossing card with country entered, hours, U.S. advisory and the other crossing; "Add a cross-border option".
// Routers and Overpass mocked as in tests/epe_smoke.mjs.
// Run from the repo root: node tests/epe_deps_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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
let sameOnly = false, airEls = [], depEls = [], noWayRound = null;
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
      const a = [q.locations[0].lat, q.locations[0].lon], b = [q.locations[1].lat, q.locations[1].lon], nw = noWayRound && (q.exclude_locations || []).some((x) => Math.abs(x.lat - noWayRound[0]) < 1e-3 && Math.abs(x.lon - noWayRound[1]) < 1e-3), c = line(a, b, sameOnly || nw ? 0 : 0.35), m = km(c);
      return J(r, { trip: { summary: { length: m / 1000, time: m / (70 / 3.6) }, legs: [{ shape: enc6(c), summary: { length: m / 1000, time: m / (70 / 3.6) }, maneuvers: [] }] } });
    }
    if (/overpass|maps\.mail\.ru/.test(u)) {
      calls.overpass++;
      const q = decodeURIComponent((r.request().postData() || "").replace(/^data=/, ""));
      if (/aeroway"="runway"/.test(q)) return J(r, { elements: [] });
      if (/level_crossing/.test(q)) { calls.deps = (calls.deps || 0) + 1; return J(r, { elements: depEls }); }
      if (/ferry_terminal/.test(q)) { calls.corr = (calls.corr || 0) + 1; return J(r, { elements: airEls }); }
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




const idle = (p) => p.waitForFunction(() => { const s = window.OSAP_EPE.state(); return !s.lbusy && !window.OSAP_EPE.dbusy() && !/Routing to the nearest official/.test(s.msg); }, null, { timeout: 120000 });
const opt = (s, id) => s.plan.opts.find((o) => o.id === id);
let state, optId;
{
  const errors = [], ctx = await context(null), p = await page(ctx, errors);
  await p.evaluate(() => { window.ASAP_ROADS = { items: [] }; window.TSAP.records.length = 0; ["ASAP_GDACS", "ASAP_QUAKES", "ASAP_NQ", "ASAP_UCDP", "ASAP_EONET"].forEach((k) => { window[k] = null; }); });
  await p.evaluate((s) => window.OSAP_EPE_GO({ at: s, how: "test" }), START);
  await p.waitForFunction(() => window.OSAP_EPE && !document.getElementById("epe").hidden, null, { timeout: 20000 });
  await p.click('#epe [data-ep="plan"]');
  await p.waitForFunction(() => { const s = window.OSAP_EPE.state(); return !s.busy && s.plan; }, null, { timeout: 90000 });
  let s = await st(p);

  /* a cross-border option: the nearest official crossings by road */
  const n0 = s.plan.opts.length;
  ok(await p.evaluate(() => !!document.querySelector('#epe [data-ep="xopt"]')), "Add a cross-border option offered");
  await p.click('#epe [data-ep="xopt"]');
  await idle(p);
  s = await st(p);
  const xo = s.plan.opts.find((o) => o.kind === "crossings");
  ok(s.plan.opts.length === n0 + 1 && xo && xo.kindName === "Border crossing" && xo.route.m > 0 && xo.prop.st !== "Available", "a Border crossing option is added and routed (" + (xo ? xo.dest.i.name : s.msg) + ")");
  ok(/never shown as open/.test(s.msg), "it says a crossing is never shown as open");

  const o = s.plan.opts[0]; optId = o.id;
  await p.click('#epe [data-ep-sel="' + optId + '"]');
  const D = [o.dest.i.lat, o.dest.i.lon], at = (f, side = 0) => [START[0] + (D[0] - START[0]) * f + side, START[1] + (D[1] - START[1]) * f - side];
  const seg = (f0, f1, n = 4) => Array.from({ length: n }, (_, i) => { const q = at(f0 + (f1 - f0) * i / (n - 1)); return { lat: q[0], lon: q[1] }; });
  const BR = at(0.3), TUN = at(0.5), FER = at(0.62), LC = at(0.4), BX = at(0.9);
  const perp = [{ lat: BR[0] + 0.01, lon: BR[1] + 0.01 }, { lat: BR[0] - 0.01, lon: BR[1] - 0.01 }].map((x, i) => i ? { lat: at(0.33)[0] - 0.004, lon: at(0.33)[1] + 0.004 } : { lat: at(0.33)[0] + 0.004, lon: at(0.33)[1] - 0.004 });
  depEls = [
    { type: "way", id: 11, tags: { highway: "primary", bridge: "yes", name: "Friendship Bridge", maxweight: "20" }, geometry: seg(0.29, 0.31) },
    { type: "way", id: 12, tags: { highway: "primary", bridge: "yes", name: "Friendship Bridge" }, geometry: seg(0.2905, 0.3095) },
    { type: "way", id: 13, tags: { highway: "residential", bridge: "yes", name: "Overpass" }, geometry: perp },
    { type: "way", id: 14, tags: { highway: "trunk", tunnel: "yes", name: "Hill Tunnel" }, geometry: seg(0.49, 0.51) },
    { type: "way", id: 15, tags: { route: "ferry", name: "River Ferry" }, geometry: seg(0.6, 0.64) },
    { type: "node", id: 16, lat: LC[0], lon: LC[1], tags: { railway: "level_crossing" } },
    { type: "node", id: 17, lat: BX[0], lon: BX[1], tags: { barrier: "border_control", name: "Test Border Post", opening_hours: "06:00-22:00" } }];
  noWayRound = TUN;
  await p.evaluate(([b]) => {
    window.ASAP_ROADS = { items: [{ lat: b[0] + 0.001, lon: b[1], kind: "closure", title: "Friendship Bridge closed for repairs", link: "https://example.org/bridge", updated: new Date().toISOString().slice(0, 10) }] };
    window.ASAP_SOF = window.ASAP_SOF || {}; window.ASAP_SOF.kh = Object.assign(window.ASAP_SOF.kh || {}, { advisory: { level: 2, level_text: "Exercise increased caution", updated: "2026-09-01", areas: [{ area: "Border areas", level: 3, reason: "landmines" }] } });
    const real = window.OSAP_EVAC.nearest;
    window.OSAP_EVAC.nearest = (pt) => Math.abs(pt[0] - window.__bx[0]) < 1e-3 ? Promise.resolve({ crossings: [
      { x: { cc: "th", i: { name: "Test Border Post (TH side)", lat: pt[0], lon: pt[1], src: "https://www.openstreetmap.org/node/17" } }, m: 50 },
      { x: { cc: "kh", i: { name: "Far side post", lat: pt[0] + 0.005, lon: pt[1] + 0.005 } }, m: 700 },
      { x: { cc: "th", i: { name: "Other Crossing", lat: pt[0] + 0.3, lon: pt[1], src: "https://www.openstreetmap.org/node/99" } }, m: 33000 }] }) : real(pt);
  }, [BR]);
  await p.evaluate((b) => { window.__bx = b; }, BX);
  await p.click('#epe [data-ep="deps"]');
  await idle(p);
  s = await st(p);
  const dp = opt(s, optId).deps, L = dp ? dp.list : [], by = (k) => L.filter((d) => d.kind === k);
  ok(calls.deps >= 1, "OpenStreetMap asked along the road legs (" + calls.deps + " queries)");
  ok(by("bridge").length === 1 && by("bridge")[0].name === "Friendship Bridge" && by("bridge")[0].maxweight === "20", "the bridge on the line is listed once (both carriageways merged), with its weight limit");
  ok(!L.some((d) => d.name === "Overpass"), "a bridge over the line (crossing it) is not a dependency");
  ok(by("tunnel").length === 1 && by("ferry").length === 1 && by("rail").length === 1 && by("border").length === 1, "tunnel, ferry, level crossing and border post found (" + L.map((d) => d.kind).join(", ") + ")");
  ok(L.every((d, i) => !i || L[i - 1].km <= d.km) && Math.abs(by("bridge")[0].km - o.route.m * 0.3 / 1000) < 1.5, "in route order with route km (bridge at km " + (by("bridge")[0] || {}).km + " of " + Math.round(o.route.m / 100) / 10 + ")");
  const br = by("bridge")[0], tn = by("tunnel")[0];
  ok(br.detour && br.detour.m > 0 && br.detour.dm > 0 && br.detour.coords.length > 1, "a bridge on the line shows its detour if lost (+" + Math.round((br.detour || {}).dm / 100) / 10 + " km)");
  ok(tn.detour && tn.detour.none && /single point of failure/.test(tn.detour.why), "no way round the tunnel is said as such");
  ok(br.status.st === "Closure reported" && /Friendship Bridge closed/.test(br.status.why), "a closure reported at the bridge is shown, with its report");
  ok(tn.status.st === "No source" && L.every((d) => !/open/i.test(d.status.st)), "otherwise the status is no source, never open");
  const bd = dp.borders && dp.borders[0];
  ok(bd && bd.entered === "kh" && bd.hours === "06:00-22:00" && bd.adv && bd.adv.level === 2 && bd.alt && bd.alt.name === "Other Crossing", "the border crossing card: country entered, hours, advisory and the other crossing (" + JSON.stringify(bd && { e: bd.entered, h: bd.hours, a: bd.adv && bd.adv.level, alt: bd.alt && bd.alt.name }) + ")");
  const bt = await p.evaluate(() => (document.querySelector("#epe .epeborder") || {}).textContent || "");
  ok(/No source says it is open or closed: unknown/.test(bt) && !/Status\s*(Open|Available)/i.test(bt), "a crossing never shows as open without a source");
  ok(/Level 2/.test(bt) && /Border areas: level 3/.test(bt), "the advisory and its area notes are on the card");
  ok((await st(p)).dr.deps === L.length, "dependencies drawn on the map");
  await p.click('#epe [data-ep-showdet="' + br.id + '"]');
  ok(await p.evaluate(() => /Hide/.test(document.querySelector("#epe [data-ep-showdet]").textContent)), "the detour can be shown on the map");
  if (OUT) await p.screenshot({ path: OUT + "/epe-deps.png" });
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  state = await ctx.storageState();
  await ctx.close();
}
{
  const errors = [], ctx = await context(state), p = await page(ctx, errors);
  await p.evaluate(() => window.OSAP_EPE_GO({}));
  await p.waitForFunction(() => window.OSAP_EPE && !document.getElementById("epe").hidden, null, { timeout: 20000 });
  const s = await st(p), o = s.plan && opt(s, optId);
  ok(o && o.deps && o.deps.list.length >= 5 && o.deps.borders.length === 1 && s.plan.opts.some((x) => x.kind === "crossings"), "after a reload the dependencies, border card and cross-border option are kept");
  ok(!errors.length, "after reload: no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
