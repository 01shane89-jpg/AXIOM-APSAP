// Headless check of the Route tab's API for other modules (assets/osap-route.js, agreed with the medical plan thread):
// OSAP_ROUTETAB.alternates(a, b, { mode, n, foot }) gives up to n distinct lines, fastest first, as P, A, C (the routers'
// alternatives, then a Valhalla detour round incidents on the fastest), drops a line that repeats another, rejects when no
// router answers; OSAP_ROUTETAB.hazards(coords, { km, days }) lists what the app holds within km of the line, in order along
// it, with its layer, distance along, age in hours and source. The routers are mocked; the incidents are injected.
// Run from the repo root: node tests/route_api_smoke.mjs   (needs the playwright package and Chromium)
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
const calls = { osrm: 0, valhalla: 0, overpass: 0 };
const J = (r, body) => r.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });

let mode = "ok";
async function context() {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1200, height: 800 } });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
    const u = r.request().url();
    if (/routing\.openstreetmap\.de/.test(u)) {
      calls.osrm++;
      if (mode === "down") return r.abort();
      const cs = decodeURIComponent(u.split("/driving/")[1].split("?")[0]).split(";").map((x) => x.split(",").map(Number));
      const a = [cs[0][1], cs[0][0]], b = [cs[1][1], cs[1][0]];
      /* the second alternative repeats the first (a line within metres of it) and must be dropped */
      return J(r, { code: "Ok", routes: [osrmRoute(line(a, b, 0), 80), osrmRoute(line(a, b, 0.00001), 79), osrmRoute(line(a, b, 0.05), 70)] });
    }
    if (/valhalla1\.openstreetmap\.de/.test(u)) {
      calls.valhalla++;
      if (mode === "down") return r.abort();
      const q = JSON.parse(decodeURIComponent(u.split("json=")[1]));
      calls.exclude = (q.exclude_locations || []).length;
      const a = [q.locations[0].lat, q.locations[0].lon], b = [q.locations[1].lat, q.locations[1].lon], c = line(a, b, 0.35), m = km(c);
      return J(r, { trip: { summary: { length: m / 1000, time: m / (60 / 3.6) }, legs: [{ shape: enc6(c), summary: { length: m / 1000, time: m / (60 / 3.6) }, maneuvers: [] }] } });
    }
    return r.abort();
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  return ctx;
}
const A = [13.69, 102.5], B = [13.9, 102.9];
const ctx = await context(), errors = [], p = await ctx.newPage();
p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TSAP && window.OSAP_GEO, null, { timeout: 60000 });
await p.evaluate(() => { if (!document.querySelector('script[src="assets/osap-route.js"]')) { const s = document.createElement("script"); s.src = "assets/osap-route.js"; document.head.appendChild(s); } });
await p.waitForFunction(() => window.OSAP_ROUTETAB && window.OSAP_ROUTETAB.alternates && window.OSAP_ROUTETAB.hazards, null, { timeout: 30000 });
ok(await p.evaluate(() => document.documentElement.getAttribute("data-view") !== "route"), "the API works without opening the Route tab");

/* incidents the app holds: a road closure on the straight line a third of the way, a disaster alert 10 km off it, an old one */
const today = new Date().toISOString().slice(0, 10), old = new Date(Date.now() - 40 * 864e5).toISOString().slice(0, 10);
/* the page loads the real road-closure file (data/live/roads.js) later on its own: the test incidents are set again
   right before each call so that file arriving cannot replace them */
await p.evaluate(([A, B, today, old]) => { window.__inject = () => {
  const at = (t, off) => [A[0] + (B[0] - A[0]) * t + off, A[1] + (B[1] - A[1]) * t];
  const c1 = at(1 / 3, 0), g = at(0.5, 0.09), o = at(0.8, 0);
  window.ASAP_ROADS = { items: [{ lat: c1[0], lon: c1[1], kind: "closure", title: "Bridge closed", link: "https://example.org/closed", updated: today },
    { lat: o[0], lon: o[1], kind: "closure", title: "Old works", link: "", updated: old }] };
  window.ASAP_GDACS = { events: [{ lat: g[0], lon: g[1], name: "Flood alert", url: "https://example.org/gdacs", from: today }] };
}; }, [A, B, today, old]);

const r3 = await p.evaluate(([A, B]) => (window.__inject(), window.OSAP_ROUTETAB.alternates(A, B, { mode: "car", n: 3 }).then((x) => x.map((y) => ({ id: y.id, n: y.coords.length, m: y.m, s: y.s, road: y.road, xc: y.xc, src: y.src, how: y.how, a: y.coords[0], b: y.coords[y.coords.length - 1] })))), [A, B]);
ok(r3.length === 3 && r3.map((x) => x.id).join("") === "PAC", "three distinct lines as P, A, C: " + r3.map((x) => x.id + " " + x.how).join(", "));
ok(r3[0].s <= r3[1].s && r3[1].s <= r3[2].s, "fastest first");
ok(r3.filter((x) => x.how === "alternative").length === 1, "the router's alternative that repeats the fastest line is dropped");
ok(r3.some((x) => x.how === "detour") && calls.exclude >= 1, "the third is Valhalla's detour round the closure on the fastest line (" + calls.exclude + " places to keep off)");
ok(r3.every((x) => x.road && !x.xc && x.n > 10 && /OSRM|Valhalla/.test(x.src) && x.m > 0 && x.s > 0), "each has its line, metres, seconds, road flag and router");
ok(Math.abs(r3[0].a[0] - A[0]) < 1e-4 && Math.abs(r3[0].b[1] - B[1]) < 1e-4, "lines run from a to b");
const r1 = await p.evaluate(([A, B]) => window.OSAP_ROUTETAB.alternates(A, B, { mode: "car", n: 1 }).then((x) => x.map((y) => y.id)), [A, B]);
ok(r1.join("") === "P", "n: 1 gives only the primary");

const hz = await p.evaluate(([A, B]) => { window.__inject(); const L = []; for (let i = 0; i <= 50; i++) { const t = i / 50; L.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]); } return { d2: window.OSAP_ROUTETAB.hazards(L), d20: window.OSAP_ROUTETAB.hazards(L, { km: 20 }), d7: window.OSAP_ROUTETAB.hazards(L, { days: 7 }), len: L }; }, [A, B]);
const cl = hz.d2.find((x) => x.text === "Bridge closed");
ok(cl && cl.layer === "roads" && cl.kind === "Road closure" && cl.off_km < 0.2 && cl.age_h != null && cl.age_h < 48 && cl.src && cl.url, "the closure on the line: " + JSON.stringify(cl));
const tot = await p.evaluate((L) => { let m = 0; for (let i = 1; i < L.length; i++) m += window.OSAP_GEO.dist(L[i - 1], L[i]); return m / 1000; }, hz.len);
ok(cl && Math.abs(cl.at_km - tot / 3) < 1, "at_km is the distance along the line (" + (cl && cl.at_km) + " of " + tot.toFixed(1) + " km)");
ok(!hz.d2.some((x) => x.layer === "gdacs") && hz.d20.some((x) => x.layer === "gdacs" && x.off_km > 5), "the alert 10 km off is outside 2 km and inside 20 km");
ok(hz.d2.every((x, i, a) => !i || a[i - 1].at_km <= x.at_km), "in order along the line");
ok(hz.d2.some((x) => x.text === "Old works") && !hz.d7.some((x) => x.text === "Old works") && hz.d7.some((x) => x.text === "Bridge closed"), "days leaves out what is older");
ok(Array.isArray(await p.evaluate(() => window.OSAP_ROUTETAB.hazards([[1, 1]]))), "a line of one point gives an empty list");

const bad = await p.evaluate(() => window.OSAP_ROUTETAB.alternates([13.7, NaN], [13.9, 102.9]).then(() => "resolved", (e) => e.message));
ok(bad === "two points are needed", "bad input rejects: " + bad);
mode = "down";
const down = await p.evaluate(([A, B]) => window.OSAP_ROUTETAB.alternates(A, B, { mode: "car" }).then(() => "resolved", (e) => e.message), [A, B]);
ok(/OSRM: .*Valhalla: /.test(down), "no router answering rejects with both reasons: " + down);
ok(!errors.length, "no page errors " + errors.join(" | "));
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
