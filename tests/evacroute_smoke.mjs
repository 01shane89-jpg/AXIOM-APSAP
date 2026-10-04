// Headless check of Route > Evacuation route (assets/osap-route.js): from a start the analyst sets (here a typed point near
// Aranyaprathet), it routes to the nearest evacuation points, weighs incidents OSAP holds near each line, asks Valhalla for a
// detour round them, recommends the safer line when it is not much slower, lists SP/CP/RP checkpoints with incidents on the line,
// labels the weighting as an estimate, keeps the plan on the device and opens it again with the routers unreachable.
// The routers are mocked: OSRM answers a straight line plus a bent alternative, Valhalla answers the bent line.
// Run from the repo root: node tests/evacroute_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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
/* a line a->b in n steps, bent sideways by `bend` degrees at the middle */
function line(a, b, bend, n = 40) {
  const out = [];
  for (let i = 0; i <= n; i++) { const t = i / n, k = Math.sin(Math.PI * t) * bend; out.push([a[0] + (b[0] - a[0]) * t + k, a[1] + (b[1] - a[1]) * t + k]); }
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
let calls = { osrm: 0, valhalla: 0, avoid: 0 };

async function open(offline) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 } });
  const errors = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    if (!offline && /routing\.openstreetmap\.de/.test(u)) {
      calls.osrm++;
      const cs = decodeURIComponent(u.split("/driving/")[1].split("?")[0]).split(";").map((x) => x.split(",").map(Number));
      const a = [cs[0][1], cs[0][0]], b = [cs[1][1], cs[1][0]];
      return r.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ code: "Ok", routes: [osrmRoute(line(a, b, 0), 80), osrmRoute(line(a, b, 0.004), 78)] }) });
    }
    if (!offline && /valhalla1\.openstreetmap\.de/.test(u)) {
      calls.valhalla++;
      const q = JSON.parse(decodeURIComponent(u.split("json=")[1]));
      if (q.exclude_locations && q.exclude_locations.length) calls.avoid++;
      const a = [q.locations[0].lat, q.locations[0].lon], b = [q.locations[1].lat, q.locations[1].lon], c = line(a, b, 0.35), m = km(c);
      return r.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ trip: { summary: { length: m / 1000, time: m / (70 / 3.6) }, legs: [{ shape: enc6(c), summary: { length: m / 1000, time: m / (70 / 3.6) }, maneuvers: [] }] } }) });
    }
    r.abort();
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  return { ctx, errors };
}
async function page(ctx, errors) {
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_EVAC, null, { timeout: 60000 }); await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  await p.evaluate((s) => window.OSAP_ROUTE_SEED([s]), START);
  await p.waitForFunction(() => window.OSAP_ROUTETAB && document.getElementById("rt-evac"), null, { timeout: 30000 }); await p.waitForTimeout(500);
  /* the one-route planner sits folded under the Evac link (EPE phase 1) */
  await p.evaluate(() => { document.getElementById("rt-evone").open = true; });
  return p;
}

let ctx, errors, p;
{
  ({ ctx, errors } = await open(false));
  p = await page(ctx, errors);
  ok(await p.evaluate(() => { const e = document.getElementById("rt-evac"); return !!e && e.getClientRects().length > 0; }), "Evacuation route sits in the Route panel");
  /* no start: says how to set one */
  await p.evaluate(() => { localStorage.removeItem("osap-route-cur"); window.OSAP_ROUTETAB.seed([]); });
  await p.click('[data-rt="evac"]'); await p.waitForTimeout(300);
  ok(/Set the start first/.test(await p.textContent("#rt-evres")), "without a start it says how to set one");

  /* the start, and incidents on the straight line to the Bangkok embassy (today, UCDP + a reported checkpoint) */
  await p.evaluate((s) => window.OSAP_ROUTETAB.seed([s]), START); await p.waitForTimeout(500);
  const bkk = await p.evaluate(() => { const x = window.ASAP_SOF.th.posts.find((x) => x.id === "sof:th:post:u-s-embassy-bangkok"); return [x.lat, x.lon]; });
  await p.evaluate(({ a, b }) => {
    const d = new Date().toISOString().slice(0, 10), at = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    window.ASAP_UCDP = { items: [0.3, 0.5, 0.7].map((t) => ({ lat: at(t)[0], lon: at(t)[1], where: "Test district", best: 2, date: d })) };
    window.TSAP.records.push({ lat: at(0.4)[0], lon: at(0.4)[1], title: "Army checkpoint set up on the highway", url: "https://example.org/chk", ts: d + "T00:00:00Z", src: { name: "Test" } });
  }, { a: START, b: bkk });
  await p.selectOption("#rt-evto", "posts");
  await p.click('[data-rt="evac"]');
  await p.waitForFunction(() => document.querySelector("#rt-evres .rtalts"), null, { timeout: 30000 }); await p.waitForTimeout(800);
  const res = await p.evaluate(() => {
    const b = [...document.querySelectorAll("#rt-evres .rtalts button")].map((x) => x.textContent);
    return { b, txt: document.getElementById("rt-evres").textContent, rows: [...document.querySelectorAll("#rt-evres .rtcps tbody tr")].map((r) => r.cells[0].textContent),
      st: window.OSAP_ROUTETAB.state(), cps: document.querySelectorAll(".rtcp").length };
  });
  ok(calls.osrm >= 2, "routed to more than one nearest post (" + calls.osrm + " OSRM calls)");
  ok(calls.avoid >= 1, "asked Valhalla for a detour keeping off reported incidents (" + calls.avoid + ")");
  ok(res.b.length >= 1 && /^Recommended/.test(res.b[0]), "first option is the recommendation: " + (res.b[0] || "").slice(0, 80));
  ok(/no incidents OSAP holds/.test(res.b[0]), "the recommended line passes no reported incidents");
  ok(res.st.routes === res.b.length && res.st.wps.length === 2 && Math.abs(res.st.wps[0].lat - START[0]) < 1e-4, "route shown from the chosen start to the chosen point");
  ok(res.rows[0] === "SP" && res.rows[res.rows.length - 1] === "RP" && res.rows.some((r) => /^CP\d/.test(r)), "checkpoints SP, CP.., RP listed (" + res.rows.join(" ") + ")");
  ok(res.cps >= 3, "checkpoints drawn on the map (" + res.cps + ")");
  ok(/Safety weighting is an estimate from open reporting/.test(res.txt) && /not a threat assessment/.test(res.txt), "weighting labelled as an estimate, not a threat assessment");
  ok(/Phone|After hours|source/.test(res.txt), "destination shows its published contact or source");

  /* force the quickest (with incidents) to see incidents and the reported checkpoint on the line */
  const q = res.b.findIndex((t) => /Quickest/.test(t));
  if (q > 0) {
    await p.click('#rt-evres .rtalts button[data-alt="' + q + '"]'); await p.waitForTimeout(800);
    const rows = await p.evaluate(() => [...document.querySelectorAll("#rt-evres .rtcps tbody tr")].map((r) => r.cells[0].textContent + ":" + r.cells[4].textContent));
    ok(rows.some((r) => /^CHK:Reported checkpoint/.test(r)) && rows.some((r) => /^INC:Conflict event/.test(r)), "the quickest line lists the reported checkpoint and incidents on it");
    await p.click('#rt-evres .rtalts button[data-alt="0"]'); await p.waitForTimeout(600);
  } else ok(false, "a quickest option with incidents is offered next to the recommendation");
  if (OUT) await p.screenshot({ path: OUT + "/evacroute.png" });

  await p.click('[data-rt="evsave"]'); await p.waitForTimeout(400);
  const kept = await p.evaluate(() => JSON.parse(localStorage.getItem("osap-evac-plans") || "[]"));
  ok(kept.length === 1 && kept[0].route.coords.length > 10 && kept[0].dest.i.name, "Keep for offline use stores the plan on the device");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  var state = await ctx.storageState();
  await ctx.close();
}
{
  /* offline: routers unreachable, the kept plan opens with its checkpoints */
  const c2 = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 }, storageState: state });
  const errs = [];
  await c2.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const before = { ...calls };
  const p2 = await page(c2, errs);
  ok(await p2.evaluate(() => !!document.querySelector("#rt-evsaved [data-evopen]")), "kept plan listed under Evacuation route");
  await p2.click("#rt-evsaved [data-evopen]"); await p2.waitForTimeout(1200);
  const o = await p2.evaluate(() => ({ st: window.OSAP_ROUTETAB.state(), txt: document.getElementById("rt-evres").textContent, rows: document.querySelectorAll("#rt-evres .rtcps tbody tr").length }));
  ok(o.st.routes === 1 && o.st.wps.length === 2 && /Kept plan from/.test(o.txt), "kept plan opens with no connection");
  ok(o.rows >= 4, "kept plan shows its checkpoints offline (" + o.rows + ")");
  ok(calls.osrm === before.osrm && calls.valhalla === before.valhalla, "nothing asked of the routers while opening it");
  if (OUT) await p2.screenshot({ path: OUT + "/evacroute-offline.png" });
  ok(!errs.length, "offline: no page errors" + (errs.length ? ": " + errs.slice(0, 3).join(" | ") : ""));
  await c2.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
