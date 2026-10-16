// Headless check of Route > Navigate (assets/osap-nav.js): a planned road route opens full-screen navigation; positions on the
// route give the next turn with its distance, road and lanes; the voice says the turn ahead and at the turn with Latin-letter
// road names only; the "you are here" arrow is a marker above the map and the route line; hazards OSAP holds near the route are
// called out; leaving the route re-routes from where you are; arriving is announced; preferences are the only thing stored
// (no coordinates); the simulated drive moves along the route; on a phone the route bar has a Go button. Every outside host is
// answered by made-up test data.
// Run from the repo root: node tests/nav_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const OUT = process.env.OUT || "";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".css": "text/css" };
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

/* A north 2.2 km to the junction T, right (east) 3.2 km to B */
const A = [14.0, 100.5], T = [14.02, 100.5], B = [14.02, 100.53];
const lerp = (p, q, f) => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
const LINE = [...Array.from({ length: 21 }, (_, i) => lerp(A, T, i / 20)), ...Array.from({ length: 30 }, (_, i) => lerp(T, B, (i + 1) / 30))];
function len(c) { let m = 0; for (let i = 1; i < c.length; i++) { const dy = (c[i][0] - c[i - 1][0]) * 111320, dx = (c[i][1] - c[i - 1][1]) * 111320 * Math.cos(c[i][0] * Math.PI / 180); m += Math.hypot(dx, dy); } return m; }
const J = (r, body, status) => r.fulfill({ status: status || 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const calls = { route: 0, reroute: [], valhalla: [] };
function enc6(pts) {
  let out = "", plat = 0, plon = 0;
  const one = (v) => { v = v < 0 ? ~(v << 1) : v << 1; let s = ""; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
  for (const [la, lo] of pts) { const a = Math.round(la * 1e6), b = Math.round(lo * 1e6); out += one(a - plat) + one(b - plon); plat = a; plon = b; }
  return out;
}
function valhallaAnswer(q) {
  calls.valhalla.push(q);
  const a = [q.locations[0].lat, q.locations[0].lon], b = [q.locations[q.locations.length - 1].lat, q.locations[q.locations.length - 1].lon];
  const c = Array.from({ length: 11 }, (_, i) => [a[0] + (b[0] - a[0]) * i / 10, a[1] + (b[1] - a[1]) * i / 10 + Math.sin(i / 10 * Math.PI) * 0.01]), m = len(c);
  return { trip: { summary: { length: m / 1000, time: m / 13.9 }, legs: [{ shape: enc6(c), summary: { length: m / 1000, time: m / 13.9 },
    maneuvers: [{ type: 1, instruction: "Drive east.", begin_shape_index: 0, length: m / 1000, time: m / 13.9, street_names: ["Bypass Road"] }, { type: 4, instruction: "You have arrived.", begin_shape_index: 10, length: 0, time: 0 }] }] } };
}

function osrmAnswer(coords) {
  const pts = coords.split(";").map((x) => x.split(",").map(Number)).map((x) => [x[1], x[0]]);
  calls.route++;
  if (Math.abs(pts[0][0] - A[0]) < 1e-4 && Math.abs(pts[0][1] - A[1]) < 1e-4) {
    const m = len(LINE), m1 = len(LINE.slice(0, 21)), s = m / 13.9;
    const steps = [
      { distance: m1, duration: m1 / 13.9, name: "Phahonyothin Road", ref: "1", maneuver: { type: "depart", location: [A[1], A[0]], bearing_after: 0 }, intersections: [{}] },
      { distance: m - m1, duration: (m - m1) / 13.9, name: "ถนนทดสอบ", ref: "3", maneuver: { type: "turn", modifier: "right", location: [T[1], T[0]], bearing_after: 90 },
        intersections: [{ lanes: [{ valid: false, indications: ["left"] }, { valid: false, indications: ["straight"] }, { valid: true, indications: ["right"] }] }] },
      { distance: 0, duration: 0, name: "", maneuver: { type: "arrive", location: [B[1], B[0]] }, intersections: [{}] }];
    return { code: "Ok", routes: [{ distance: m, duration: s, geometry: { coordinates: LINE.map((p) => [p[1], p[0]]) }, legs: [{ distance: m, duration: s, steps }] }] };
  }
  /* a re-route: straight from where the person is to the last waypoint asked for */
  calls.reroute.push(pts[0]);
  const end = pts[pts.length - 1], c = Array.from({ length: 11 }, (_, i) => lerp(pts[0], end, i / 10)), m = len(c), s = m / 13.9;
  return { code: "Ok", routes: [{ distance: m, duration: s, geometry: { coordinates: c.map((p) => [p[1], p[0]]) }, legs: [{ distance: m, duration: s, steps: [
    { distance: m, duration: s, name: "Detour Lane", maneuver: { type: "depart", location: [pts[0][1], pts[0][0]], bearing_after: 180 }, intersections: [{}] },
    { distance: 0, duration: 0, name: "", maneuver: { type: "arrive", location: [end[1], end[0]] }, intersections: [{}] }] }] }] };
}

async function open(phone) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: phone ? { width: 390, height: 844 } : { width: 1400, height: 900 }, isMobile: !!phone, hasTouch: !!phone });
  const errors = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    const m = /routing\.openstreetmap\.de\/routed-\w+\/route\/v1\/driving\/([^?]+)/.exec(u);
    if (m) { if (/bearings=/.test(u)) calls.lastUrl = u; return J(r, osrmAnswer(decodeURIComponent(m[1]))); }
    if (/valhalla1\.openstreetmap\.de\/route/.test(u)) return J(r, valhallaAnswer(JSON.parse(new URL(u).searchParams.get("json"))));
    if (/tiles\.openfreemap\.org\/styles\/liberty/.test(u)) return J(r, { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#e8e4dc" } }, { id: "lbl", type: "symbol", layout: { "text-field": ["get", "name"] }, source: "x" }].slice(0, 1) });
    if (/open-meteo\.com\/v1\/elevation/.test(u)) { const n = new URL(u).searchParams.get("latitude").split(",").length; return J(r, { elevation: Array.from({ length: n }, (_, i) => 20 + i) }); }
    if (/\.(jpg|png)|\/tile\//.test(u)) return r.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG });
    r.abort();
  });
  /* top page only: the app's watch scan loads a hidden same-origin copy of the page (index.html?watchscan=1) on a timer, and running
     this there too wiped the nav prefs mid-test (intermittent null on the preferences check) */
  await ctx.addInitScript(() => { if (window.top !== window) return; try { localStorage.setItem("osap-home", "map"); localStorage.removeItem("osap-route-cur"); localStorage.removeItem("osap-nav-prefs"); } catch (e) {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ROUTE_SEED, null, { timeout: 60000 }); await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  /* a road closure the app holds beside the second leg */
  await p.evaluate(() => { window.ASAP_ROADS = { items: [{ lat: 14.0202, lon: 100.52, kind: "closure", title: "Test road closed for repair", link: "https://example.org/closure", updated: new Date().toISOString().slice(0, 10) }] }; });
  await p.evaluate(({ a, b }) => window.OSAP_ROUTE_SEED([a, b]), { a: A, b: B });
  await p.waitForFunction(() => window.OSAP_ROUTETAB && window.OSAP_ROUTETAB.state().routes === 1 && document.querySelector('#rt-sum [data-rt="nav"]'), null, { timeout: 30000 });
  await p.waitForTimeout(600);
  return { ctx, p, errors };
}
const st = (p) => p.evaluate(() => window.OSAP_NAV.state());
let t0 = Date.now();
const fixAt = (p, q, o) => { t0 += (o && o.dt) || 2000; return p.evaluate(({ q, o, t }) => window.OSAP_NAV._fix(q[0], q[1], Object.assign({ t }, o)), { q, o: o || {}, t: t0 }); };

{
  const { ctx, p, errors } = await open(false);
  ok(await p.evaluate(() => { const b = document.querySelector('#rt-sum [data-rt="nav"]'); return !!b && b === document.querySelector("#rt-sum .rtbtns button"); }), "Navigate is the first button with the route summary");
  await p.click('#rt-sum [data-rt="nav"]');
  await p.waitForFunction(() => window.OSAP_NAV && window.OSAP_NAV.isOpen(), null, { timeout: 20000 });
  ok(await p.evaluate(() => { const e = document.getElementById("osnav"); const r = e && e.getBoundingClientRect(); return !!r && r.width >= 1390 && r.height >= 890 && document.documentElement.classList.contains("nav-on"); }), "navigation opens full screen");
  await p.waitForFunction(() => { const s = window.OSAP_NAV.state(); return s.glReady || s.lf; }, null, { timeout: 20000 }).catch(() => {});
  let s = await st(p);
  ok(s.glReady, "the turning, tilting map engine is running (gl " + s.gl + ", fallback " + s.lf + ")");
  ok(await p.evaluate(() => !!document.querySelector('#osnav .nvnote [data-nv="sim"]')), "before any GPS fix a Simulate drive button is offered");

  /* on the first leg, 1.7 km before the right turn */
  await fixAt(p, [14.005, 100.5], { hdg: 0, spd: 15 });
  s = await st(p);
  ok(s.on && s.next && s.next.k === "turn" && s.next.mod === "right", "on the route: next is the right turn (" + JSON.stringify(s.next) + ")");
  const ban = await p.evaluate(() => ({ d: document.querySelector("#osnav .nvdist").textContent, r: document.querySelector("#osnav .nvroad").textContent, w: document.querySelector("#osnav .nvwhat").textContent, eta: document.querySelector("#osnav .nveta span").textContent }));
  ok(ban.d === "1.7 km" && /ถนนทดสอบ/.test(ban.r) && /\(3\)/.test(ban.r) && /Turn right/.test(ban.w), "banner: distance, road as signed with its number, and the turn (" + JSON.stringify(ban) + ")");
  ok(/arrive \d{4}Z/.test(ban.eta) && /km/.test(ban.eta), "bottom bar: distance left and arrival in Zulu (" + ban.eta + ")");
  ok(await p.evaluate(() => !document.querySelector("#osnav .nvlanes")), "lanes are not shown while the turn is far off");
  ok(await p.evaluate(() => /\d/.test(document.querySelector("#osnav .nvspd b").textContent)), "speed is shown");
  await p.waitForTimeout(2300);
  const hud1 = await p.evaluate(() => document.querySelector("#osnav .nvwhere").textContent);
  ok(/^Heading north on Phahonyothin Road \(1\)/.test(hud1) && /00\d°/.test(hud1) && /47P/.test(hud1), "heads-up line: heading, road, exact heading and grid (" + hud1 + ")");
  ok(await p.evaluate(() => { const pk = document.querySelector("#osnav .nvpuck"); const mk = pk && pk.closest(".maplibregl-marker"); const cv = document.querySelector("#osnav .maplibregl-canvas-container"); return !!mk && !!cv && (cv.compareDocumentPosition(mk) & Node.DOCUMENT_POSITION_FOLLOWING) > 0; }),
    "the you-are-here arrow is a marker drawn after (above) the map canvas and its route line");
  /* 110 m before the turn: the voice gives the turn ahead; at 55 m: the turn now. The Thai road name is never spoken */
  await fixAt(p, [14.019, 100.5], { hdg: 0, spd: 10 });
  await fixAt(p, [14.0195, 100.5], { hdg: 0, spd: 10, dt: 1000 });
  ok(await p.evaluate(() => document.querySelectorAll("#osnav .nvlanes svg").length === 3), "near the turn the three mapped lanes are drawn");
  s = await st(p);
  ok(s.spoken.some((x) => /^In 100 metres, turn right onto route 3\.$/.test(x)), "voice: the turn ahead (" + s.spoken.join(" | ") + ")");
  ok(s.spoken.some((x) => /^Turn right onto route 3\.$/.test(x)), "voice: the turn at the junction");
  ok(!s.spoken.some((x) => /[฀-๿]/.test(x)), "the voice never reads out Thai script");
  /* after the turn, heading east: the hazard ahead is called out */
  await fixAt(p, [14.02, 100.508], { hdg: 90, spd: 14 });
  s = await st(p);
  ok(s.on && s.next && s.next.k === "arrive", "after the turn the next step is the arrival");
  await p.waitForTimeout(2300);
  const hud2 = await p.evaluate(() => document.querySelector("#osnav .nvwhere").textContent);
  ok(/^Heading east on ถนนทดสอบ \(3\)/.test(hud2), "after the turn the heads-up line changes to the new heading and road (" + hud2 + ")");
  ok(s.hz >= 1 && s.spoken.some((x) => /^Caution\. Road closure reported ahead in /.test(x)), "the road closure OSAP holds near the route is called out ahead (" + s.hz + ")");
  ok(await p.evaluate(() => /Road closure/.test(document.querySelector("#osnav .nvnotes").textContent)), "and shown under the banner");
  if (OUT) await p.screenshot({ path: OUT + "/nav-desktop.png" });
  /* leave the route: 1 km north of it, three fixes over four seconds -> re-route from there */
  for (let i = 0; i < 4; i++) await fixAt(p, [14.03 - i * 0.0002, 100.515 + i * 0.0001], { hdg: 150, spd: 8, dt: 2000 });
  await p.waitForFunction(() => window.OSAP_NAV.state().rerouted >= 1, null, { timeout: 10000 }).catch(() => {});
  s = await st(p);
  ok(calls.reroute.length >= 1 && Math.abs(calls.reroute[0][0] - 14.03) < 1e-3, "off the route: a new route is asked for from where you are (" + calls.reroute.length + ")");
  ok(/bearings=150,60;/.test(calls.lastUrl || ""), "the new route starts in the direction you are moving (" + (calls.lastUrl || "").split("?")[1] + ")");
  ok(s.rerouted >= 1 && s.spoken.includes("Rerouting.") && s.on, "re-routed and back on the new route (" + JSON.stringify({ on: s.on, rr: s.rerouted }) + ")");
  /* arrive */
  await fixAt(p, B, { hdg: 135, spd: 3 });
  s = await st(p);
  ok(s.arrived && s.spoken.some((x) => /^You have arrived/.test(x)), "arriving at B is announced");
  ok(await p.evaluate(() => /Arrived/.test(document.querySelector("#osnav .nvdist").textContent)), "the banner says Arrived");
  /* team actions: Mark drops a map point with its time; night mode; avoid the road ahead; back to start; track as GPX */
  await p.click('#osnav [data-nv="mark"]');
  const pts = await p.evaluate(() => JSON.parse(localStorage.getItem("osap-atak-pts") || "[]"));
  ok(pts.some((x) => /^Mark \d{4}Z$/.test(x.n) && Math.abs(x.lat - B[0]) < 1e-3), "Mark saves a map point named with the Zulu time (" + pts.map((x) => x.n).join(",") + ")");
  ok(await p.evaluate(() => /Mark \d{4}Z/.test(document.querySelector("#osnav .nvnotes").textContent) && /47P/.test(document.querySelector("#osnav .nvnotes").textContent)), "the mark's MGRS grid is shown");
  await p.click('#osnav [data-nv="night"]');
  ok(await p.evaluate(() => document.getElementById("osnav").classList.contains("night") && /grayscale/.test(getComputedStyle(document.getElementById("osnav")).filter)), "Night mode turns the whole screen dim red");
  await p.click('#osnav [data-nv="list"]');
  ok(await p.evaluate(() => { const t = document.querySelector("#osnav .nvsteps").textContent; return /Avoid the road ahead/.test(t) && /Back to start/.test(t) && /Save track/.test(t) && /Straight/.test(t) && /EENT/.test(t); }), "the actions panel: avoid, back to start, save track, grids, straight-line bearing and light");
  const dl = p.waitForEvent("download", { timeout: 5000 }).catch(() => null);
  await p.click('#osnav [data-nv="gpx"]');
  const d = await dl;
  let gx = ""; if (d) { const fp = await d.path(); gx = (await readFile(fp)).toString(); }
  ok(d && /\.gpx$/.test(d.suggestedFilename()) && /<trkpt lat="14\.0/.test(gx) && /<wpt [^>]*><name>Mark \d{4}Z<\/name>/.test(gx), "Save track gives a GPX of the track and marks (" + (d ? d.suggestedFilename() : "no download") + ")");
  await p.click('#osnav [data-nv="back"]');
  await p.waitForFunction(() => window.OSAP_NAV.state().rerouted >= 2, null, { timeout: 10000 }).catch(() => {});
  s = await st(p);
  const lastRe = calls.reroute[calls.reroute.length - 1];
  ok(s.rerouted >= 2 && /^A/.test(s.dest) && s.ahead.join() === "A" && !s.arrived, "Back to start routes to A from here (" + JSON.stringify({ dest: s.dest, rr: s.rerouted }) + ")");
  await fixAt(p, [14.0205, 100.5295], { hdg: 270, spd: 10 });
  await p.click('#osnav [data-nv="list"]'); await p.click('#osnav [data-nv="avoid"]');
  await p.waitForFunction(() => window.OSAP_NAV.state().rerouted >= 3, null, { timeout: 10000 }).catch(() => {});
  s = await st(p);
  const vq = calls.valhalla[calls.valhalla.length - 1];
  ok(vq && vq.exclude_locations && vq.exclude_locations.length >= 5 && s.avoid >= 5 && s.rerouted >= 3, "Avoid the road ahead asks for a route kept off the next stretch (" + (vq ? vq.exclude_locations.length : 0) + " points)");
  ok(s.spoken.includes("Finding a way round the road ahead.") && await p.evaluate(() => /Keeping off the road you avoided/.test(document.querySelector("#osnav .nvnotes").textContent)), "and says so");
  await p.click('#osnav [data-nv="night"]');
  /* preferences: the only thing kept, never a coordinate */
  await p.click('#osnav [data-nv="mute"]'); await p.click('#osnav [data-nv="up"]');
  /* a same-origin frame opening (as the watch scan does) must not touch them */
  await p.evaluate(() => new Promise((res) => { const f = document.createElement("iframe"); f.style.display = "none"; f.onload = () => { f.remove(); res(); }; f.src = "sw.js"; document.body.appendChild(f); setTimeout(res, 5000); }));
  const pref = await p.evaluate(() => localStorage.getItem("osap-nav-prefs"));
  ok(/"mute":true/.test(pref) && /"up":"north"/.test(pref) && /"night":false/.test(pref) && !/\d+\.\d+/.test(pref), "voice and north-up kept as preferences, no coordinates (" + pref + ")");
  ok(await p.evaluate(() => !Object.keys(localStorage).some((k) => /nav/.test(k) && /14\.0|100\.5/.test(localStorage.getItem(k)))), "no position kept in storage");
  await p.click('#osnav [data-nv="end"]');
  ok(await p.evaluate(() => !document.getElementById("osnav") && !document.documentElement.classList.contains("nav-on") && !window.OSAP_NAV.isOpen()), "End closes navigation");
  /* the simulated drive moves along the route */
  await p.click('#rt-sum [data-rt="nav"]'); await p.waitForFunction(() => window.OSAP_NAV.isOpen());
  await p.click('#osnav [data-nv="sim"]'); await p.waitForTimeout(2600);
  s = await st(p);
  ok(s.sim && s.on && s.along > 20, "Simulate drive moves along the route (" + s.along + " m)");
  await p.click('#osnav [data-nv="end"]');
  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await ctx.close();
}
{
  /* phone: the route bar carries Go; navigation fills the phone screen */
  const { ctx, p, errors } = await open(true);
  const go = await p.evaluate(() => { const b = document.getElementById("rt-hgo"); return !!b && b.getClientRects().length > 0 && getComputedStyle(b).display !== "none"; });
  ok(go, "phone: the folded route bar has a Go button");
  if (go) {
    await p.click("#rt-hgo");
    await p.waitForFunction(() => window.OSAP_NAV && window.OSAP_NAV.isOpen(), null, { timeout: 20000 });
    await fixAt(p, [14.005, 100.5], { hdg: 0, spd: 15 });
    await p.waitForTimeout(800);
    ok(await p.evaluate(() => { const b = document.querySelector("#osnav .nvban").getBoundingClientRect(), e = document.querySelector("#osnav .nvbar").getBoundingClientRect(); return b.top >= 0 && b.width > 340 && e.bottom <= 844 && e.top > 700; }), "phone: banner across the top, time and arrival bar at the bottom");
    if (OUT) await p.screenshot({ path: OUT + "/nav-phone.png" });
  }
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
