// Headless check of the flight planner for airborne operations (assets/osap-flight.js) on a desktop and a phone.
// Saved map points stand in for the analyst's own (departure airfield, DZ, landing strip); the shared DZ store
// (window.OSAP_DZ, assets/osap-dz.js) holds one saved DZ. No network: every outside request is refused.
// Checks: no toolbar button, the Route tab's "Plan a flight" opens it; saved points and a typed MGRS grid are added in flight
// order (first = departure, second = landing, later ones before the landing); roles change to IP and DZ; legs give nm, true
// and magnetic course, the drop speed on the IP-to-DZ run-in and cruise elsewhere; times run forward from take-off and back
// from the time over the DZ; the DZ is drawn as an area on the run-in course and the other points as 2525D symbols; changing
// the aircraft changes the speeds; KML carries the SIDCs and the DZ polygon, GPX a route of every point, TAK makes a package;
// a saved DZ sets the DZ point and forDz gives the DZSO tool the aircraft, drop altitude, speed, run-in and time; the plan
// survives a reload; closing removes the marks; no page errors.
// Run from the repo root: node tests/flight_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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

/* made-up saved points round Lop Buri (test data, not real coordinates of anything) */
const PTS = [
  { id: "p1", n: "WING 2", lat: 14.876, lon: 100.663, cc: "th" },
  { id: "p2", n: "Tadia DZ", lat: 15.10, lon: 100.95, cc: "th" },
  { id: "p3", n: "SFRE AOB", lat: 15.25, lon: 100.40, cc: "th" }];
const IP = [15.0, 100.80];

for (const vp of [{ width: 1400, height: 900, tag: "desktop" }, { width: 390, height: 844, tag: "phone", mobile: true }]) {
  const ctx = await browser.newContext({ serviceWorkers: "block", acceptDownloads: true, viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.mobile, hasTouch: !!vp.mobile });
  const errors = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript((pts) => {
    try { if (!sessionStorage.getItem("fl-init")) { sessionStorage.setItem("fl-init", "1"); localStorage.setItem("osap-home", "map"); localStorage.setItem("osap-atak-pts", JSON.stringify(pts)); localStorage.removeItem("osap-flight-cur");
      localStorage.setItem("osap-dz", JSON.stringify([{ id: "dztadia1", name: "Tadia", cc: "th", pi: [15.101, 100.951], axis: 60, len_m: 1200, wid_m: 500, shape: "rect", alt_ft: 1250 }])); } } catch (e) {}
  }, PTS);
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ROUTE_SEED && window.OSAP_FLIGHT_GO, null, { timeout: 60000 }); await p.waitForTimeout(2000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  ok(!(await p.evaluate(() => [...document.querySelectorAll("#atk-tools button, .atk-tb button")].some((b) => /flight/i.test(b.textContent)))), vp.tag + ": no new toolbar button");
  await p.evaluate(() => window.OSAP_ROUTE_SEED([]));
  await p.waitForSelector('[data-rt="flight"]', { timeout: 30000 });
  await p.evaluate(() => document.querySelector('[data-rt="flight"]').click());
  await p.waitForFunction(() => window.OSAP_FLIGHT && window.OSAP_FLIGHT.isOpen(), null, { timeout: 15000 });
  ok(await p.evaluate(() => { const c = document.getElementById("fl-card"); return !!c && !c.hidden && c.getBoundingClientRect().height > 100; }), vp.tag + ": Route tab > Plan a flight opens the flight plan");

  /* points: WING 2 (departure), SFRE AOB (landing), a typed IP, then Tadia DZ */
  const pick = async (id) => { await p.selectOption("#fl-saved", id); await p.waitForTimeout(150); };
  await pick("p1"); await pick("p3");
  const ipGrid = await p.evaluate((ip) => window.OSAP_GEO.mgrs(ip[0], ip[1], 5), IP);
  await p.fill("#fl-q", ipGrid); await p.click('[data-fl="add"]'); await p.waitForTimeout(150);
  await pick("p2");
  let st = await p.evaluate(() => window.OSAP_FLIGHT.state().plan);
  ok(st.pts.map((x) => x.role).join(",") === "dep,cp,cp,land" && st.pts[0].name === "WING 2" && st.pts[3].name === "SFRE AOB" && st.pts[2].name === "Tadia DZ", vp.tag + ": points in flight order, " + st.pts.map((x) => x.role + ":" + (x.name || "grid")).join(" "));
  await p.selectOption('[data-flrole="1"]', "ip"); await p.waitForTimeout(100);
  await p.selectOption('[data-flrole="2"]', "dz"); await p.waitForTimeout(200);
  /* timing: take off at 0200Z */
  await p.selectOption("#fl-tm", "dep"); await p.fill("#fl-t", "2026-11-01T02:00"); await p.dispatchEvent("#fl-t", "change"); await p.waitForTimeout(150);
  const R = await p.evaluate(() => { const s = window.OSAP_FLIGHT.state().plan, r = window.OSAP_FLIGHT.legs(s), G = window.OSAP_GEO;
    return { kt: s.kt, drop: s.drop, legs: r.legs.map((l) => ({ nm: l.nm, kt: l.kt, s: l.s, tc: l.tc, mc: l.mc, runin: l.runin, chk: G.dist([l.a.lat, l.a.lon], [l.b.lat, l.b.lon]) / 1852 })), t: r.t, warn: r.warn }; });
  ok(R.legs.length === 3, vp.tag + ": three legs");
  ok(R.legs.every((l) => Math.abs(l.nm - l.chk) < 1e-6 && Math.abs(l.s - l.nm / l.kt * 3600) < 1e-6), vp.tag + ": leg nm from WGS 84 distance, time = nm / kt");
  ok(R.legs[1].runin && R.legs[1].kt === R.drop && !R.legs[0].runin && R.legs[0].kt === R.kt && R.legs[2].kt === R.kt, vp.tag + ": IP-to-DZ run-in at the drop speed (" + R.drop + " kt), other legs at cruise (" + R.kt + " kt)");
  ok(R.legs.every((l) => l.tc >= 0 && l.tc < 360 && Math.abs(((l.tc - l.mc + 540) % 360) - 180) < 5), vp.tag + ": true and magnetic course (" + R.legs.map((l) => Math.round(l.tc) + "T/" + Math.round(l.mc) + "M").join(" ") + ")");
  ok(R.t[0] === Date.UTC(2026, 10, 1, 2, 0) && R.t[1] > R.t[0] && R.t[3] > R.t[2], vp.tag + ": times run forward from take-off at 0200Z");
  ok(!R.warn.length, vp.tag + ": no warnings for a complete plan" + (R.warn.length ? ": " + R.warn.join(" | ") : ""));
  const legTxt = await p.evaluate(() => document.querySelector("#fl-card table") && document.querySelector("#fl-card table").textContent);
  ok(/run-in/.test(legTxt || "") && /0200Z|02\d\dZ/.test(legTxt || "") && /ICT/.test(legTxt || ""), vp.tag + ": leg table shows the run-in and Zulu and local times");
  /* time over the DZ */
  await p.selectOption("#fl-tm", "tot"); await p.fill("#fl-t", "2026-11-01T03:00"); await p.dispatchEvent("#fl-t", "change"); await p.waitForTimeout(150);
  const tot = await p.evaluate(() => { const r = window.OSAP_FLIGHT.legs(window.OSAP_FLIGHT.state().plan); return { dz: r.t[2], dep: r.t[0], s: r.legs[0].s + r.legs[1].s }; });
  ok(tot.dz === Date.UTC(2026, 10, 1, 3, 0) && Math.abs(tot.dz - tot.dep - tot.s * 1000) < 2, vp.tag + ": over the DZ at 0300Z works the take-off time back");
  /* the map */
  await p.waitForFunction(() => document.querySelectorAll(".leaflet-flpane-pane .flsym svg").length >= 3, null, { timeout: 15000 }).catch(() => {});
  const mp = await p.evaluate(() => ({ sym: document.querySelectorAll(".leaflet-flpane-pane .flsym svg").length, dz: [...document.querySelectorAll(".leaflet-flpane-pane .fldz")].map((x) => x.textContent), legs: document.querySelectorAll(".leaflet-flpane-pane .flleg").length,
    poly: document.querySelectorAll(".leaflet-flpane-pane path").length }));
  ok(mp.sym === 3, vp.tag + ": departure, IP and landing drawn as 2525D symbols (" + mp.sym + ")");
  ok(mp.dz.length === 1 && mp.dz[0] === "Tadia DZ" && mp.legs === 3, vp.tag + ": DZ area labelled (" + mp.dz.join() + ") and 3 leg labels");
  if (OUT) await p.screenshot({ path: OUT + "/flight-" + vp.tag + ".png" });
  /* aircraft */
  await p.selectOption("#fl-ac", "c17"); await p.waitForTimeout(150);
  st = await p.evaluate(() => window.OSAP_FLIGHT.state().plan);
  ok(st.acft === "c17" && st.kt === 450 && st.drop === 135, vp.tag + ": C-17 sets cruise " + st.kt + " kt and drop " + st.drop + " kt");
  /* exports */
  const ex = await p.evaluate(() => { const s = window.OSAP_FLIGHT.state().plan; return { kml: window.OSAP_FLIGHT.kml(s), gpx: window.OSAP_FLIGHT.gpx(s), txt: window.OSAP_FLIGHT.text(s) }; });
  ok(/10032500001319000000/.test(ex.kml) && /10032500001801000000/.test(ex.kml) && /<Polygon>/.test(ex.kml) && (ex.kml.match(/<LineString>/g) || []).length === 3 && /Not a flight plan/.test(ex.kml), vp.tag + ": KML has 2525D SIDCs, the DZ polygon, 3 legs and the caveat");
  ok((ex.gpx.match(/<rtept /g) || []).length === 4 && (ex.gpx.match(/<wpt /g) || []).length === 4, vp.tag + ": GPX route of 4 points");
  ok(/C-17A/.test(ex.txt) && /run-in/.test(ex.txt), vp.tag + ": copy as text has the aircraft and run-in");
  const dl = p.waitForEvent("download", { timeout: 10000 }).catch(() => null);
  await p.click('[data-fl="tak"]');
  const d = await dl;
  ok(!!d && /\.zip$/.test(d.suggestedFilename()), vp.tag + ": TAK package downloaded (" + (d ? d.suggestedFilename() : "none") + ")");
  /* the shared DZ store */
  await p.selectOption('[data-fldz="2"]', "dztadia1"); await p.waitForTimeout(200);
  st = await p.evaluate(() => window.OSAP_FLIGHT.state().plan);
  const fd = await p.evaluate(() => window.OSAP_FLIGHT.forDz("dztadia1"));
  ok(st.pts[2].dzId === "dztadia1" && Math.abs(st.pts[2].lat - 15.101) < 1e-9 && st.dzLen === 1200 && st.altFt === 1250, vp.tag + ": saved DZ sets the DZ point, size and drop altitude");
  ok(fd && fd.acft === "C-17A Globemaster III" && fd.alt_ft === 1250 && fd.ias_kt === 135 && fd.axis >= 0 && fd.axis < 360 && /^2026-11-01T03:00/.test(fd.tot), vp.tag + ": forDz for the DZSO tool " + JSON.stringify(fd));
  ok((await p.evaluate(() => window.OSAP_FLIGHT.forDz("nope"))) === null, vp.tag + ": forDz of an unknown DZ is null");
  /* Save DZ writes the run-in and drop time back to the shared store, keeping the id */
  await p.click('[data-fldzsave="2"]'); await p.waitForTimeout(150);
  const sz = await p.evaluate(() => window.OSAP_DZ.get("dztadia1"));
  ok(sz && sz.acft === "C-17A Globemaster III" && sz.alt_ft === 1250 && sz.axis === fd.axis && /^2026-11-01T03:00/.test(sz.tot) && (await p.evaluate(() => window.OSAP_DZ.list().length)) === 1, vp.tag + ": Save DZ updates the shared drop zone in place");
  /* a bad grid is refused, nothing added */
  await p.fill("#fl-q", "not a grid"); await p.click('[data-fl="add"]'); await p.waitForTimeout(100);
  ok((await p.evaluate(() => window.OSAP_FLIGHT.state().plan.pts.length)) === 4 && /not understood/.test(await p.textContent("#fl-card .flmsg.err")), vp.tag + ": a bad grid is refused");
  /* reload keeps the plan */
  await p.reload({ waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.OSAP_FLIGHT_GO, null, { timeout: 60000 });
  await p.evaluate(() => window.OSAP_FLIGHT_GO({}));
  await p.waitForFunction(() => window.OSAP_FLIGHT && window.OSAP_FLIGHT.isOpen(), null, { timeout: 15000 });
  st = await p.evaluate(() => window.OSAP_FLIGHT.state().plan);
  ok(st.pts.length === 4 && st.acft === "c17", vp.tag + ": the plan is kept after a reload");
  await p.click('[data-fl="close"]'); await p.waitForTimeout(100);
  ok((await p.evaluate(() => window.OSAP_FLIGHT.state().drawn)) === 0 && !(await p.evaluate(() => window.OSAP_FLIGHT.isOpen())), vp.tag + ": close removes the marks");
  ok(!errors.length, vp.tag + ": no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
