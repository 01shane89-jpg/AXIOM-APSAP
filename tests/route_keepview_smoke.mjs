// Headless check that opening Route keeps the map where the analyst left it (index.html setView, assets/osap-route.js show):
// the Route toolbar button no longer fits the whole country, going back from Route keeps the view too, a route kept from
// before does not move the map when Route opens again, and "Zoom to route" (or points handed over from Measure) still fits
// the route. The router is mocked (a straight line). Run from the repo root: node tests/route_keepview_smoke.mjs
// (needs playwright + Chromium; OUT=dir saves screenshots)
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

const HERE = [18.79, 98.98], Z = 12;              /* zoomed in on Chiang Mai, far from the whole-country view */
const WPS = [[13.75, 100.50], [13.86, 100.51]];  /* a route in Bangkok, out of that view */
for (const vp of [{ width: 1400, height: 900, tag: "desktop" }, { width: 390, height: 844, tag: "phone", mobile: true }]) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.mobile, hasTouch: !!vp.mobile });
  const errors = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    if (/routing\.openstreetmap\.de/.test(u)) {
      const cs = decodeURIComponent(u.split("/driving/")[1].split("?")[0]).split(";").map((x) => x.split(",").map(Number));
      const m = 20000 * (cs.length - 1);
      return r.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ code: "Ok", routes: [{ distance: m, duration: m / 20, geometry: { coordinates: cs }, legs: cs.slice(1).map(() => ({ distance: 20000, duration: 1000, steps: [] })) }] }) });
    }
    r.abort();
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.FW && window.FW.map && document.querySelector('[data-atk="route"]'), null, { timeout: 60000 }); await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  const view = () => p.evaluate(() => { const m = window.FW.map, c = m.getCenter(); return { lat: c.lat, lng: c.lng, z: m.getZoom(), v: document.documentElement.getAttribute("data-view") }; });
  const same = (a, b) => a.z === b.z && Math.abs(a.lat - b.lat) < 1e-3 && Math.abs(a.lng - b.lng) < 1e-3;
  const goHere = async () => { await p.evaluate(([h, z]) => window.FW.map.setView(h, z, { animate: false }), [HERE, Z]); await p.waitForTimeout(300); return view(); };
  const pressRoute = async () => { await p.evaluate(() => document.querySelector('[data-atk="route"]').click()); await p.waitForTimeout(1500); };

  /* 1. opening Route from the toolbar keeps the view */
  let v0 = await goHere();
  await pressRoute();
  await p.waitForFunction(() => window.OSAP_ROUTETAB && document.documentElement.getAttribute("data-view") === "route", null, { timeout: 30000 }); await p.waitForTimeout(800);
  let v1 = await view();
  ok(v1.v === "route" && same(v0, v1), vp.tag + ": Route opens and the map stays put (zoom " + v0.z + " -> " + v1.z + ")");
  if (OUT) await p.screenshot({ path: OUT + "/keepview-open-" + vp.tag + ".png" });

  /* 2. points handed over (Measure > Plan route) still fit the route */
  await p.evaluate((w) => window.OSAP_ROUTE_SEED(w), WPS);
  await p.waitForFunction(() => window.OSAP_ROUTETAB.state().routes === 1, null, { timeout: 30000 }); await p.waitForTimeout(500);
  const inView = () => p.evaluate((w) => w.every((x) => window.FW.map.getBounds().contains(x)), WPS);
  ok(await inView(), vp.tag + ": points handed over from Measure are fitted");

  /* 3. pressing Route again goes back to the previous view and keeps the map */
  v0 = await goHere();
  await pressRoute();
  v1 = await view();
  ok(v1.v !== "route" && same(v0, v1), vp.tag + ": going back from Route (to " + v1.v + ") keeps the map");

  /* 4. opening Route again with the kept route does not move the map; Zoom to route brings it into view */
  v0 = await goHere();
  await pressRoute();
  await p.waitForFunction(() => window.OSAP_ROUTETAB.state().routes === 1, null, { timeout: 30000 }); await p.waitForTimeout(800);
  v1 = await view();
  ok(v1.v === "route" && same(v0, v1), vp.tag + ": reopening Route with a kept route keeps the map");
  const fb = await p.evaluate(() => { const b = document.querySelector('[data-rt="fit"]'); if (b) b.click(); return !!b; });
  await p.waitForTimeout(300);
  ok(fb && await inView(), vp.tag + ": Zoom to route fits the kept route");

  /* 5. leaving Route for a data set keeps the map; switching between data sets still fits the country as before */
  v0 = await goHere();
  await p.evaluate(() => { window.TSAP.setView("hazards"); document.dispatchEvent(new Event("osap:view")); }); await p.waitForTimeout(800);
  v1 = await view();
  ok(v1.v === "hazards" && same(v0, v1), vp.tag + ": leaving Route for a data set keeps the map");
  await goHere();
  await p.evaluate(() => { window.TSAP.setView("news"); document.dispatchEvent(new Event("osap:view")); }); await p.waitForTimeout(800);
  v1 = await view();
  ok(v1.v === "news" && v1.z < Z, vp.tag + ": switching between data sets still fits the country (zoom " + v1.z + ")");
  ok(!errors.length, vp.tag + ": no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
