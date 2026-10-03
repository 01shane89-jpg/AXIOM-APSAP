// Headless check of deleting a route waypoint from its map popup (assets/osap-route.js): three waypoints are planned,
// B's popup offers Delete waypoint, pressing it removes B only, closes the popup and plans the route again from A to C.
// The router is mocked (a straight line). Run from the repo root: node tests/route_wpdel_smoke.mjs   (needs playwright + Chromium; OUT=dir saves screenshots)
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

const WPS = [[13.75, 100.50], [13.86, 100.51], [14.0, 100.6]];
const asked = [];
for (const vp of [{ width: 1400, height: 900, tag: "desktop" }, { width: 390, height: 844, tag: "phone", mobile: true }]) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.mobile, hasTouch: !!vp.mobile });
  const errors = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    if (/routing\.openstreetmap\.de/.test(u)) {
      const cs = decodeURIComponent(u.split("/driving/")[1].split("?")[0]).split(";").map((x) => x.split(",").map(Number));
      asked.push(cs.length);
      const coords = cs.map((c) => [c[0], c[1]]), m = 20000 * (cs.length - 1);
      return r.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ code: "Ok", routes: [{ distance: m, duration: m / 20, geometry: { coordinates: coords }, legs: cs.slice(1).map(() => ({ distance: 20000, duration: 1000, steps: [] })) }] }) });
    }
    r.abort();
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ROUTE_SEED, null, { timeout: 60000 }); await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  await p.evaluate((w) => window.OSAP_ROUTE_SEED(w), WPS);
  await p.waitForFunction(() => window.OSAP_ROUTETAB && window.OSAP_ROUTETAB.state().routes === 1, null, { timeout: 30000 }); await p.waitForTimeout(500);
  ok((await p.evaluate(() => window.OSAP_ROUTETAB.state().wps.length)) === 3, vp.tag + ": three waypoints planned");
  const n0 = asked.length;
  /* open B's popup (the middle marker) the way a tap does */
  await p.evaluate(() => { const b = [...document.querySelectorAll(".rtv")].find((x) => x.textContent === "B"); b.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await p.waitForSelector(".leaflet-popup [data-wpdel]", { timeout: 5000 });
  const pop = await p.evaluate(() => ({ h: document.querySelector(".leaflet-popup h3").textContent, b: document.querySelector(".leaflet-popup [data-wpdel]").textContent }));
  ok(/Delete waypoint/.test(pop.b), vp.tag + ": waypoint popup (" + pop.h + ") offers " + pop.b);
  if (OUT) await p.screenshot({ path: OUT + "/wpdel-" + vp.tag + ".png" });
  await p.click(".leaflet-popup [data-wpdel]");
  await p.waitForFunction((n) => window.OSAP_ROUTETAB.state().routes === 1 && window.OSAP_ROUTETAB.state().wps.length === 2, n0, { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(800);
  const st = await p.evaluate(() => ({ wps: window.OSAP_ROUTETAB.state().wps, routes: window.OSAP_ROUTETAB.state().routes, pop: !!document.querySelector(".leaflet-popup"),
    marks: [...document.querySelectorAll(".rtv")].map((x) => x.textContent).join("") }));
  ok(st.wps.length === 2 && Math.abs(st.wps[0].lat - WPS[0][0]) < 1e-4 && Math.abs(st.wps[1].lat - WPS[2][0]) < 1e-4, vp.tag + ": only B removed, A and C kept");
  ok(!st.pop, vp.tag + ": popup closed after delete");
  ok(st.marks === "AB", vp.tag + ": markers relettered (" + st.marks + ")");
  ok(asked.length > n0 && asked[asked.length - 1] === 2 && st.routes === 1, vp.tag + ": route planned again through the two remaining waypoints");
  ok(!errors.length, vp.tag + ": no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
