// Headless check of EPE phase 5, along the route by km (assets/osap-epe.js): hazards inside the corridor grouped into km
// ranges that match where the reports are; phone coverage segments from Comms planning with their basis; fuel within 1 km,
// the longest stretch without fuel and the last fuel before it; U.S. posts near the line (not verified as evacuation
// destinations); hospitals folded with capability unknown; data freshness and confidence on the card; map layer switches
// with Sustainment and Medical off at first; "no report" shown as unknown. Mocked as in tests/epe_smoke.mjs.
// Run from the repo root: node tests/epe_along_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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
let sameOnly = false, airEls = [], depEls = [], noWayRound = null, susEls = [];
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
      if (/drinking_water/.test(q)) { calls.sus = (calls.sus || 0) + 1; return J(r, { elements: susEls }); }
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





const idle = (p) => p.waitForFunction(() => { const s = window.OSAP_EPE.state(); return !s.lbusy && !window.OSAP_EPE.abusy() && !window.OSAP_EPE.dbusy(); }, null, { timeout: 120000 });
const opt = (s, id) => s.plan.opts.find((o) => o.id === id);
let state, optId;
{
  const errors = [], ctx = await context(null), p = await page(ctx, errors);
  await p.evaluate(() => { localStorage.removeItem("osap-epe-layers"); window.ASAP_ROADS = { items: [] }; window.TSAP.records.length = 0; ["ASAP_GDACS", "ASAP_QUAKES", "ASAP_NQ", "ASAP_UCDP", "ASAP_EONET"].forEach((k) => { window[k] = null; }); });
  await p.evaluate((s) => window.OSAP_EPE_GO({ at: s, how: "test" }), START);
  await p.waitForFunction(() => window.OSAP_EPE && !document.getElementById("epe").hidden, null, { timeout: 20000 });
  await p.click('#epe [data-ep="plan"]');
  await p.waitForFunction(() => { const s = window.OSAP_EPE.state(); return !s.busy && s.plan; }, null, { timeout: 90000 });
  let s = await st(p);
  const o = s.plan.opts[0]; optId = o.id;
  const D = [o.dest.i.lat, o.dest.i.lon], at = (f, side = 0) => [START[0] + (D[0] - START[0]) * f + side, START[1] + (D[1] - START[1]) * f - side];
  const KM = o.route.m / 1000;
  ok(await p.evaluate(() => /Confidence <b>Low|Confidence Low/.test(document.querySelector("#epe .epegrade").innerHTML) || /Confidence Low/.test(document.querySelector("#epe .epegrade").textContent)), "before any check the card says confidence Low and why");
  ok(await p.evaluate(() => /data freshness unknown/.test(document.querySelector("#epe .epegrade").textContent)), "freshness unknown with no dated reports");

  /* what OSAP holds near the line: two closures close together (one km range) and one further on */
  const today = new Date().toISOString().slice(0, 10), old = new Date(Date.now() - 9 * 864e5).toISOString().slice(0, 10);
  await p.evaluate(([a, b, c, t, o2]) => { window.ASAP_ROADS = { items: [
    { lat: a[0], lon: a[1], kind: "closure", title: "Road 1 closed", link: "https://example.org/1", updated: t },
    { lat: b[0], lon: b[1], kind: "closure", title: "Road 1 lane closed", link: "https://example.org/2", updated: t },
    { lat: c[0], lon: c[1], kind: "closure", title: "Bridge works", link: "https://example.org/3", updated: o2 }] }; }, [at(0.3), at(0.33), at(0.8), today, old]);
  susEls = [
    { type: "node", id: 31, lat: at(0.1)[0], lon: at(0.1)[1], tags: { amenity: "fuel", name: "PTT 1", "fuel:diesel": "yes" } },
    { type: "node", id: 32, lat: at(0.2, 0.002)[0], lon: at(0.2, 0.002)[1], tags: { amenity: "fuel", name: "Shell 2" } },
    { type: "way", id: 33, center: { lat: at(0.85)[0], lon: at(0.85)[1] }, tags: { amenity: "fuel", brand: "Bangchak" } },
    { type: "node", id: 34, lat: at(0.5, 0.03)[0], lon: at(0.5, 0.03)[1], tags: { amenity: "fuel", name: "Far station" } },
    { type: "node", id: 35, lat: at(0.4)[0], lon: at(0.4)[1], tags: { amenity: "drinking_water" } },
    { type: "node", id: 36, lat: at(0.45)[0], lon: at(0.45)[1], tags: { shop: "convenience" } },
    { type: "node", id: 37, lat: at(0.46)[0], lon: at(0.46)[1], tags: { tourism: "hotel", name: "Hotel" } }];
  await p.evaluate(([e]) => {
    window.OSAP_COMMSPLAN = { corridor: (segs, o) => { window.__cs = { n: segs.length, cc: o && o.cc }; return Promise.resolve(segs.map((g, i) => ({ id: g.id, km_from: g.km_from, km_to: g.km_to, status: i === 0 ? "none" : i === 1 ? "unknown" : "good", reason: "test", sources: i === 0 ? [{ kind: "mapped" }] : i === 1 ? [] : [{ kind: "observed" }, { kind: "reported" }], levels: [] }))); } };
    const real = window.OSAP_EVAC.nearest;
    window.OSAP_EVAC.nearest = (pt) => real(pt).then((r) => Object.assign({}, r, { posts: [{ x: { cc: "th", i: { id: "p1", name: "U.S. Consular Agency Test", kind: "Consular agency", lat: e[0] + 0.01, lon: e[1], phone: "+66 2 000 0000", src: "https://th.usembassy.gov/" } }, m: 1000 }, { x: { cc: "th", i: { id: "p2", name: "Far Embassy", lat: e[0] + 3, lon: e[1] } }, m: 300000 }] }));
  }, [at(0.5)]);
  await p.click('#epe [data-ep="along"]');
  await idle(p);
  s = await st(p);
  const a = opt(s, optId).along;
  ok(!!a && !s.lbusy, "Check along the route finishes (" + (a ? "" : s.lmsg) + ")");
  const hz = a.haz;
  ok(hz.n === 3 && hz.ranges.length === 2, "hazards grouped into km ranges: 3 reports, 2 ranges (" + hz.ranges.map((r) => r.from + "-" + r.to + ":" + r.n).join(", ") + ")");
  ok(Math.abs(hz.ranges[0].from - KM * 0.3) < 0.6 && Math.abs(hz.ranges[0].to - KM * 0.33) < 0.6 && hz.ranges[0].n === 2 && Math.abs(hz.ranges[1].from - KM * 0.8) < 0.6, "the km ranges match where the reports are (km " + hz.ranges[0].from + "–" + hz.ranges[0].to + " and " + hz.ranges[1].from + " of " + KM.toFixed(1) + ")");
  ok(hz.dated === 3 && hz.fresh === 2, "dated reports under 24 h counted (" + hz.fresh + " of " + hz.dated + ")");
  const su = a.sus;
  ok(su.nFuel === 3 && su.diesel === 1 && su.water === 1 && su.shop === 1 && su.lodging === 1, "fuel within 1 km of the line (3, one diesel; the station 3 km off left out), water, shops, lodging");
  ok(su.gap && Math.abs(su.gap.len - KM * 0.65) < 0.6 && su.gap.last && su.gap.last.name === "Shell 2", "longest stretch without fuel " + (su.gap && su.gap.len) + " km (expected " + (KM * 0.65).toFixed(1) + ") and the last fuel before it: " + (su.gap && su.gap.last && su.gap.last.name));
  const cm = a.comms;
  ok(cm.segs.length >= 1 && cm.segs[0].status === "none" && cm.segs[0].basis[0] === "proximity (masts)", "comms segments with their basis (" + cm.segs.length + " segments, first " + (cm.segs[0] || {}).status + ", " + ((cm.segs[0] || {}).basis || []).join("/") + ")");
  ok(cm.segs.length < 2 || cm.segs[1].status === "unknown", "a segment with no basis stays unknown");
  ok(a.us.list.length === 1 && a.us.list[0].name === "U.S. Consular Agency Test" && a.us.list[0].off < 3000, "U.S. post near the line listed with its offset; the far one left out");
  const txt = await p.evaluate(() => document.querySelector("#epe .epealong").textContent);
  ok(/Not verified as an evacuation destination/.test(txt), "U.S. support says not verified as an evacuation destination");
  ok(a.med && Array.isArray(a.med.list) && a.med.list.every((m) => m.km >= 0) && !/capability verified/i.test(txt), "medical support folded, capability unknown unless tagged (" + a.med.n + " hospitals near)");
  ok(/Longest stretch without fuel/.test(txt) && /km \d/.test(txt), "the card shows the fuel gap by km");
  const g = await p.evaluate(() => document.querySelector("#epe .epecard.sel .epegrade").textContent);
  ok(/data freshness 67% of dated reports under 24 h/.test(g), "the status card shows data freshness: " + g.slice(0, 160));
  ok(/Confidence (Medium|Low)/.test(g) && /checks made/.test(g), "and OSAP's confidence with why (not all 5 checks made yet)");
  /* layers: sustainment and medical start off */
  const lays = await p.evaluate(() => [...document.querySelectorAll("#epe [data-ep-lay]")].map((x) => x.getAttribute("data-ep-lay") + ":" + (x.checked ? 1 : 0)).join(","));
  ok(lays === "deps:1,air:1,borders:1,us:1,med:0,sus:0,comms:1,haz:1", "map layers, Sustainment and Medical off at first (" + lays + ")");
  const d0 = (await st(p)).dr.along;
  await p.check('#epe [data-ep-lay="sus"]');
  const d1 = (await st(p)).dr.along;
  ok(d1 === d0 + 3, "switching Sustainment on draws the 3 fuel stations (" + d0 + " to " + d1 + ")");
  await p.uncheck('#epe [data-ep-lay="haz"]');
  ok((await st(p)).dr.along === d1 - 3, "switching Hazards off removes them");

  /* an option with nothing near it: no report shows as unknown */
  await p.evaluate(() => { window.ASAP_ROADS = { items: [] }; });
  const o2 = s.plan.opts[2];
  await p.click('#epe [data-ep-sel="' + o2.id + '"]');
  await p.click('#epe [data-ep="along"]');
  await idle(p);
  ok(/No report OSAP holds inside the corridor\. No report is not a clearance: unknown/.test(await p.evaluate(() => document.querySelector("#epe .epealong").textContent)), "no report shows as unknown, not clear");
  if (OUT) { await p.click('#epe [data-ep-sel="' + optId + '"]'); await p.screenshot({ path: OUT + "/epe-along.png", fullPage: false }); }
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  state = await ctx.storageState();
  await ctx.close();
}
{
  const errors = [], ctx = await context(state), p = await page(ctx, errors);
  await p.evaluate(() => window.OSAP_EPE_GO({}));
  await p.waitForFunction(() => window.OSAP_EPE && !document.getElementById("epe").hidden, null, { timeout: 20000 });
  const s = await st(p), o = s.plan && opt(s, optId);
  ok(o && o.along && o.along.haz.ranges.length === 2 && o.along.sus.gap, "after a reload the checks along the route are kept");
  ok(await p.evaluate(() => document.querySelector('#epe [data-ep-lay="sus"]').checked && !document.querySelector('#epe [data-ep-lay="haz"]').checked), "and the layer choices");
  ok(!errors.length, "after reload: no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
