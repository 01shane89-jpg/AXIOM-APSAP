// Headless check of the Route tab's aircraft type (Shane 2026-10-29: "For the routes I want to be able to pick the aircraft
// type. Load all types in there"): Straight line offers the whole aircraft catalogue (assets/osap-aircraft.js, through
// OSAP_DZ.aircraftReady) in groups, picking a type sets the speed to its cruise so every leg time uses it, the type's figures
// and a range note show, the choice survives a reload and a share link, and the flight planner and the DZSO sheet offer the
// same grouped catalogue. Run from the repo root: node tests/route_aircraft_smoke.mjs (needs playwright + Chromium; OUT=dir saves screenshots)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const OUT = process.env.OUT || "";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
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

const WPS = [[13.69, 100.75], [18.77, 98.96], [20.0, 99.9]];   /* Bangkok, Chiang Mai, Chiang Rai: about 395 nm */
for (const vp of [{ width: 1400, height: 900, tag: "desktop" }, { width: 390, height: 844, tag: "phone", mobile: true }]) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.mobile, hasTouch: !!vp.mobile });
  const errors = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.FW && window.FW.map && document.querySelector('[data-atk="route"]'), null, { timeout: 60000 }); await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  ok(await p.evaluate(() => !window.OSAP_AIRCRAFT && window.OSAP_DZ.aircraft.length === 1), vp.tag + ": the catalogue is not fetched at start-up");
  await p.evaluate(() => document.querySelector('[data-atk="route"]').click());
  await p.waitForFunction(() => window.OSAP_ROUTETAB && document.documentElement.getAttribute("data-view") === "route", null, { timeout: 30000 });
  await p.evaluate((w) => window.OSAP_ROUTE_SEED(w), WPS);
  await p.evaluate(() => document.querySelector('#rt-modes [data-mode="line"]').click());
  await p.waitForFunction(() => document.querySelectorAll("#rt-ac option").length > 100, null, { timeout: 15000 });
  const sel = await p.evaluate(() => { const s = document.getElementById("rt-ac"); return { n: s.querySelectorAll("option").length, g: [...s.querySelectorAll("optgroup")].map((x) => x.label), other: !![...s.options].find((o) => o.value === "custom") }; });
  ok(sel.n > 200 && sel.g.length >= 12 && !sel.other, vp.tag + ": Straight line offers " + (sel.n - 1) + " aircraft types in " + sel.g.length + " groups (" + sel.g.slice(0, 4).join(", ") + "…)");
  ok(["Military transport and airlift", "Military helicopters", "Tiltrotor", "Airliners, narrow body", "Civil helicopters", "Business jets and turboprops"].every((g) => sel.g.includes(g)), vp.tag + ": military, rotary, tiltrotor and civil groups are all there");

  /* pick the C-17: 450 kt = 833 km/h, every leg at that speed */
  await p.selectOption("#rt-ac", "c17");
  await p.waitForFunction(() => { const s = window.OSAP_ROUTETAB.state(); return s.acft === "c17" && s.routes === 1 && Math.abs(s.s - s.m / (833 / 3.6)) < 1; }, null, { timeout: 10000 }).catch(() => {});
  let st = await p.evaluate(() => window.OSAP_ROUTETAB.state());
  ok(st.speed === 833 && Math.abs(st.s - st.m / (833 / 3.6)) < 1, vp.tag + ": C-17A sets 833 km/h and the total time is distance / cruise (" + Math.round(st.s / 60) + " min for " + Math.round(st.m / 1852) + " nm)");
  ok(st.legs.length === 2 && st.legs.every((s) => s > 0), vp.tag + ": each leg has a time at the type's cruise");
  const info = await p.evaluate(() => (document.getElementById("rt-acinfo") || {}).textContent || "");
  ok(/cruise 450 kt \(833 km\/h\)/.test(info) && /2,400 nm/.test(info) && /still air/.test(info), vp.tag + ": the type's figures show: " + info.slice(0, 90) + "…");
  ok(await p.evaluate(() => /C-17A Globemaster III cruise/.test(document.querySelector("#rt-spd option:checked").textContent)), vp.tag + ": the speed list names the type");

  /* a helicopter with a short range: the range note shows */
  await p.selectOption("#rt-ac", "ah64");
  await p.waitForFunction(() => window.OSAP_ROUTETAB.state().acft === "ah64", null, { timeout: 10000 }); await p.waitForTimeout(300);
  st = await p.evaluate(() => window.OSAP_ROUTETAB.state());
  const rng = await p.evaluate(() => (document.getElementById("rt-acrange") || {}).textContent || "");
  ok(st.speed === 278 && /longer than the AH-64E Apache's typical range of 260 nm/.test(rng), vp.tag + ": AH-64E sets 278 km/h and warns the route is past its range");
  if (OUT) await p.screenshot({ path: OUT + "/route-aircraft-" + vp.tag + ".png" });

  /* a speed picked by hand drops the type */
  await p.selectOption("#rt-spd", "boat");
  await p.waitForTimeout(300);
  st = await p.evaluate(() => window.OSAP_ROUTETAB.state());
  ok(st.acft === "" && st.speed === 37 && (await p.evaluate(() => document.getElementById("rt-ac").value)) === "", vp.tag + ": choosing a speed by hand clears the aircraft");

  /* kept over a reload, and carried by a share link */
  await p.selectOption("#rt-ac", "atr72");
  await p.waitForFunction(() => window.OSAP_ROUTETAB.state().acft === "atr72", null, { timeout: 10000 });
  await p.reload({ waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.FW && window.FW.map && document.querySelector('[data-atk="route"]'), null, { timeout: 60000 }); await p.waitForTimeout(1500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  /* the page comes back on the Route view (#route); open it only when it did not */
  await p.evaluate(() => { if (document.documentElement.getAttribute("data-view") !== "route") document.querySelector('[data-atk="route"]').click(); });
  await p.waitForFunction(() => document.querySelectorAll("#rt-ac option").length > 100 && window.OSAP_ROUTETAB.state().routes === 1, null, { timeout: 30000 });
  st = await p.evaluate(() => window.OSAP_ROUTETAB.state());
  ok(st.acft === "atr72" && st.speed === 509 && (await p.evaluate(() => document.getElementById("rt-ac").value)) === "atr72", vp.tag + ": ATR 72-600 is still picked after a reload (509 km/h)");

  /* the flight planner and the DZSO sheet offer the same grouped catalogue */
  await p.evaluate(() => window.OSAP_FLIGHT_GO({}));
  await p.waitForFunction(() => document.querySelectorAll("#fl-ac optgroup").length >= 12, null, { timeout: 20000 });
  const fl = await p.evaluate(() => ({ n: document.querySelectorAll("#fl-ac option").length, cur: document.getElementById("fl-ac").value }));
  ok(fl.n === sel.n, vp.tag + ": the flight planner lists the same " + (fl.n - 1) + " types plus Other (current " + fl.cur + ")");
  await p.evaluate(() => { window.OSAP_FLIGHT.close(); window.OSAP_DZSO_GO({ at: [13.69, 100.75] }); });
  await p.waitForFunction(() => document.querySelectorAll('[data-f="acsel"] optgroup').length >= 12, null, { timeout: 20000 });
  ok(await p.evaluate(() => !![...document.querySelectorAll('[data-f="acsel"] option')].find((o) => o.value === "CH-47 Chinook")), vp.tag + ": the DZSO sheet lists the catalogue by name");

  ok(!errors.length, vp.tag + ": no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}

/* a share link with a type opens with that type (osap-start.js hands the link's "rt" part to the Route tab in sessionStorage) */
{
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 } });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const q = encodeURIComponent("line~593@b738~13.69000,100.75000,BKK|18.77000,98.96000,CNX");
  await ctx.addInitScript((q) => { try { localStorage.setItem("osap-home", "map"); if (!sessionStorage.getItem("t-once")) { sessionStorage.setItem("t-once", "1"); sessionStorage.setItem("osap-rt-link", q); } } catch (e) {} }, q);
  const p = await ctx.newPage();
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.FW && window.FW.map && document.querySelector('[data-atk="route"]'), null, { timeout: 60000 }); await p.waitForTimeout(1500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  await p.evaluate(() => { if (document.documentElement.getAttribute("data-view") !== "route") document.querySelector('[data-atk="route"]').click(); });
  await p.waitForFunction(() => window.OSAP_ROUTETAB && window.OSAP_ROUTETAB.state().routes === 1 && document.querySelectorAll("#rt-ac option").length > 100, null, { timeout: 60000 });
  const st = await p.evaluate(() => window.OSAP_ROUTETAB.state());
  ok(st.acft === "b738" && st.mode === "line" && st.speed === 593 && (await p.evaluate(() => document.getElementById("rt-ac").value)) === "b738", "share link: opens with the Boeing 737-800 picked (" + st.speed + " km/h)");
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
