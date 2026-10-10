// Headless check of EPE phase 3, corridor and air and sea nodes (assets/osap-epe.js): the selected option's corridor (width
// picker, band on the map, wider circles at chosen nodes); air and sea nodes inside it in five air classes plus seaports and
// ferry terminals, with route km and offset, nothing outside the corridor; landing zone candidates stay Candidate until the
// analyst verifies one; "Fly out from here" and "Sail from here" make ground-to-air and ground-to-sea options whose flown or
// sailed leg is a straight line timed at the set speed. Routers and Overpass mocked as in tests/epe_smoke.mjs.
// Run from the repo root: node tests/epe_corridor_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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
let sameOnly = false, airEls = [];
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



const idle = (p) => p.waitForFunction(() => { const s = window.OSAP_EPE.state(); return !s.lbusy && !window.OSAP_EPE.abusy(); }, null, { timeout: 90000 });
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
  const o = s.plan.opts[0]; optId = o.id;
  const D = [o.dest.i.lat, o.dest.i.lon], at = (f, side = 0) => [START[0] + (D[0] - START[0]) * f + side, START[1] + (D[1] - START[1]) * f - side];
  /* what OpenStreetMap "maps" along the corridor: one of each kind on the line, one 0.3° (about 45 km) off it */
  const P = { ap: at(0.2), as: at(0.4, 0.005), hp: at(0.5), pad: at(0.6, 0.004), ft: at(0.8), far: at(0.5, 0.3) };
  airEls = [
    { type: "node", id: 1, lat: P.ap[0], lon: P.ap[1], tags: { aeroway: "aerodrome", name: "Test International", iata: "TST", "aerodrome:type": "international" } },
    { type: "way", id: 2, center: { lat: P.as[0], lon: P.as[1] }, tags: { aeroway: "airstrip", name: "Farm Strip", surface: "grass" } },
    { type: "node", id: 3, lat: P.hp[0], lon: P.hp[1], tags: { aeroway: "heliport", name: "City Heliport" } },
    { type: "node", id: 4, lat: P.pad[0], lon: P.pad[1], tags: { aeroway: "helipad" } },
    { type: "node", id: 5, lat: P.ft[0], lon: P.ft[1], tags: { amenity: "ferry_terminal", name: "River Pier" } },
    { type: "node", id: 6, lat: P.far[0], lon: P.far[1], tags: { aeroway: "aerodrome", name: "Far Field" } },
    { type: "node", id: 7, lat: P.hp[0] + 0.001, lon: P.hp[1], tags: { aeroway: "airstrip", name: "Old strip", disused: "yes" } }];

  ok(await p.evaluate(() => /Corridor/.test(document.querySelector("#epe .epecorr").textContent) && document.querySelector("#epe [data-ep-cw]").value === "2"), "the selected option has a corridor, 2 km each side by default");
  const w1 = (await st(p)).dr.band;
  await p.selectOption("#epe [data-ep-cw]", "10");
  const w2 = (await st(p)).dr.band;
  ok(w1 > 0 && Math.abs(w2 / w1 - 5) < 0.6, "the band on the map follows the width (" + w1.toFixed(1) + " px at 2 km, " + w2.toFixed(1) + " px at 10 km)");
  await p.selectOption("#epe [data-ep-cw]", "2");
  await p.click("#epe details.epecirc summary");
  await p.selectOption('#epe [data-ep-circ="dest"]', "10");
  s = await st(p);
  ok(opt(s, optId).corr.at.dest === 10 && (await st(p)).dr.circ === 1, "a wider circle at a chosen node (destination, 10 km) is kept and drawn");

  await p.click('#epe [data-ep="air"]');
  await idle(p);
  s = await st(p);
  const air = (opt(s, optId).air || { list: [] }).list, by = (n) => air.find((x) => x.name.startsWith(n));
  ok(calls.corr >= 1, "OpenStreetMap asked along the corridor (" + calls.corr + " queries)");
  ok(by("Test International") && by("Test International").cls === "Established airport", "an airport with a code: Established airport");
  ok(by("Farm Strip") && by("Farm Strip").cls === "Known airfield" && by("Farm Strip").off > 300 && by("Farm Strip").km > 0, "an airstrip: Known airfield, with route km and offset (" + (by("Farm Strip") ? by("Farm Strip").km + " km, " + by("Farm Strip").off + " m off" : "missing") + ")");
  ok(by("City Heliport") && by("City Heliport").cls === "Established heliport", "a heliport: Established heliport");
  const pad = air.find((x) => x.kind === "Mapped helipad");
  ok(pad && pad.cls === "Candidate LZ", "a mapped helipad is a Candidate LZ, not verified");
  ok(by("River Pier") && by("River Pier").cls === "Ferry terminal", "a ferry terminal is a sea node");
  ok(!by("Far Field") && !by("Old strip"), "nothing outside the corridor and nothing disused");
  ok(air.every((x) => x.km <= air[air.length - 1].km) && air.every((x, i) => !i || air[i - 1].km <= x.km), "listed in route order");
  ok((await st(p)).dr.air === air.length, "the air and sea nodes are drawn on the map");

  /* landing zone candidates round a node stay candidates until the analyst verifies one */
  await p.evaluate(() => { window.OSAP_ROUTETAB.lzNear = (pt) => Promise.resolve([{ k: "lz", i: { name: "LZ 1 (60 m clear)", lat: pt[0] + 0.01, lon: pt[1], kind: "Landing zone candidate", note: "Candidate from open data, verify on the ground." } }]); });
  await p.click('#epe [data-ep="lz"]');
  await idle(p);
  s = await st(p);
  const lz = opt(s, optId).air.list.find((x) => /^LZ 1/.test(x.name));
  ok(lz && lz.cls === "Candidate LZ" && !lz.ver && lz.basis === "modelled", "the landing zone finder's spot is a Candidate LZ (modelled)");
  await p.click('#epe [data-ep-ver="' + lz.id + '"]');
  s = await st(p);
  const lz2 = opt(s, optId).air.list.find((x) => x.id === lz.id);
  ok(lz2.cls === "User-verified LZ" && lz2.ver > 0, "Verify LZ makes it a User-verified LZ, with when");
  ok(opt(s, optId).air.list.filter((x) => x.cls === "User-verified LZ").length === 1, "only the one the analyst verified");
  ok(!await p.evaluate(() => !!document.querySelector('#epe [data-ep-air] [data-ep-ver]') && [...document.querySelectorAll("#epe [data-ep-air]")].some((li) => /Test International/.test(li.textContent) && li.querySelector("[data-ep-ver]"))), "an airport has no Verify LZ button");

  /* ground-to-air: by road to the heliport, then flown to where the analyst taps */
  const hp = by("City Heliport"), n0 = s.plan.opts.length;
  await p.click('#epe [data-ep-fly="' + hp.id + '"]');
  const end = [START[0] + 1.2, START[1] - 0.8];
  const px = await p.evaluate((ll) => { const m = window.__asapMap; m.setView(ll, 8, { animate: false }); const q = m.latLngToContainerPoint(ll), r = m.getContainer().getBoundingClientRect(); return { x: r.left + q.x, y: r.top + q.y }; }, end);
  await p.mouse.click(px.x, px.y);
  await idle(p);
  s = await st(p);
  const g2a = s.plan.opts.find((x) => x.kind === "air");
  ok(s.plan.opts.length === n0 + 1 && g2a && g2a.kindName === "Ground-to-air" && s.sel === g2a.id, "Fly out from here makes a Ground-to-air option and selects it");
  ok(g2a && g2a.legs.length === 2 && g2a.legs[0].mode !== "helo" && g2a.legs[0].s > 0 && g2a.legs[1].mode === "helo" && g2a.nodes[0].type === "airdep", "road to the air departure point, then a helicopter leg");
  const hav = (a, b) => { const r = Math.PI / 180, dl = (b[0] - a[0]) * r, dn = (b[1] - a[1]) * r, h = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) ** 2; return 12742000 * Math.asin(Math.sqrt(h)); };
  const fl = g2a && g2a.legs[1], mAir = hav([fl.a.lat, fl.a.lon], [fl.b.lat, fl.b.lon]);
  ok(fl && Math.abs(fl.s - mAir / (220 * 0.514444)) < 2 && Math.abs(fl.m - mAir) < 2, "the air leg's time matches 220 kt over its straight-line distance (" + Math.round(fl.m / 1000) + " km, " + Math.round(fl.s / 60) + " min)");
  ok(Math.abs(g2a.route.s - (g2a.legs[0].s + g2a.legs[1].s)) < 2, "the option's time is road plus air");
  await p.fill('#epe [data-ep-spd="helo"]', "110"); await p.press('#epe [data-ep-spd="helo"]', "Tab");
  s = await st(p);
  const fl2 = opt(s, g2a.id).legs[1];
  ok(Math.abs(fl2.s - fl.s * 2) < 3, "set the helicopter to 110 kt: the air leg takes twice as long");
  await p.selectOption('#epe [data-ep-lmode="L2"]', "fw");
  s = await st(p);
  const fl3 = opt(s, g2a.id).legs[1];
  ok(fl3.mode === "fw" && Math.abs(fl3.s - mAir / (400 * 0.514444)) < 2, "the analyst can make it fixed wing (400 kt)");
  ok(/Straight line timed at 400 kt/.test(await p.evaluate(() => document.querySelector('#epe [data-ep-leg="L2"]').textContent)), "the leg says it is a straight line at the set speed");

  /* ground-to-sea from the ferry terminal (from the first option's list) */
  await p.click('#epe [data-ep-sel="' + optId + '"]');
  const ft = by("River Pier");
  await p.evaluate(([id, a, ll]) => window.OSAP_EPE.flyOut(id, a, ll[0], ll[1]), [optId, ft.id, [START[0] - 0.9, START[1] - 0.6]]);
  await idle(p);
  s = await st(p);
  const g2s = s.plan.opts.find((x) => x.kind === "sea");
  ok(g2s && g2s.legs[1].mode === "sea" && g2s.nodes[0].type === "seadep" && Math.abs(g2s.legs[1].s - g2s.legs[1].m / (12 * 0.514444)) < 2, "Sail from here: a Ground-to-sea option with a vessel leg at 12 kt");
  ok(s.plan.opts.every((x) => x.prop.st !== "Available"), "OSAP still never proposes Available");
  if (OUT) { await p.click('#epe [data-ep-sel="' + optId + '"]'); await p.screenshot({ path: OUT + "/epe-corridor.png" }); }
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  state = await ctx.storageState();
  await ctx.close();
}
{
  const errors = [], ctx = await context(state), p = await page(ctx, errors);
  await p.evaluate(() => window.OSAP_EPE_GO({}));
  await p.waitForFunction(() => window.OSAP_EPE && !document.getElementById("epe").hidden, null, { timeout: 20000 });
  const s = await st(p), o = s.plan && opt(s, optId);
  ok(o && o.air.list.some((x) => x.cls === "User-verified LZ") && o.corr.at.dest === 10, "after a reload the corridor, its nodes and the verified LZ are kept");
  ok(s.plan.spd && s.plan.spd.helo === 110 && s.plan.opts.some((x) => x.kind === "air"), "and the set speeds and the ground-to-air option");
  ok(!errors.length, "after reload: no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
