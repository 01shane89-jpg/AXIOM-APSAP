// Headless check of several routes on the map at once (assets/osap-route.js): plan route 1, press New route (it is saved and
// stays on the map in its own colour with its name), plan route 2, press New route again, then hide one from "Also on the map";
// the choice survives a reload. The router is mocked (a straight line). Run from the repo root: node tests/route_multi_smoke.mjs   (needs playwright + Chromium; OUT=dir saves screenshots)
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

const R1 = [[13.75, 100.50], [13.86, 100.51]], R2 = [[13.70, 100.60], [13.80, 100.70], [13.90, 100.75]];
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
  await p.waitForFunction(() => window.TSAP && window.OSAP_ROUTE_SEED, null, { timeout: 60000 }); await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  const st = () => p.evaluate(() => window.OSAP_ROUTETAB.state());
  const names = () => p.evaluate(() => [...document.querySelectorAll(".rtkname")].map((x) => x.textContent));
  const press = (sel) => p.evaluate((sel) => document.querySelector(sel).click(), sel);
  const planned = (n) => p.waitForFunction((n) => window.OSAP_ROUTETAB && window.OSAP_ROUTETAB.state().wps.length === n && window.OSAP_ROUTETAB.state().routes === 1 && !window.OSAP_ROUTETAB.state().busy, n, { timeout: 30000 }).catch(() => {});

  await p.evaluate((w) => window.OSAP_ROUTE_SEED(w), R1); await planned(2); await p.waitForTimeout(500);
  ok(await p.evaluate(() => !!document.querySelector('[data-rt="new"]')), vp.tag + ": Waypoints has a New route button");
  await press('[data-rt="new"]'); await p.waitForTimeout(400);
  let saved = await p.evaluate(() => JSON.parse(localStorage.getItem("osap-routes") || "[]"));
  ok(saved.length === 1 && saved[0].show === true && Array.isArray(saved[0].line) && saved[0].line.length >= 2 && /^#/.test(saved[0].color), vp.tag + ": New route saves route 1 with its line and a colour, shown on the map");
  ok((await st()).wps.length === 0, vp.tag + ": waypoints cleared for the next route");
  let nm = await names();
  ok(nm.length === 1 && nm[0] === saved[0].name, vp.tag + ": route 1 stays on the map with its name (" + nm.join(", ") + ")");

  await p.evaluate((w) => window.OSAP_ROUTE_SEED(w), R2); await planned(3); await p.waitForTimeout(500);
  nm = await names();
  ok(nm.length === 1 && (await st()).routes === 1, vp.tag + ": route 2 planned while route 1 is still drawn");
  if (OUT) await p.screenshot({ path: OUT + "/multi-two-" + vp.tag + ".png" });
  await press('[data-rt="new"]'); await p.waitForTimeout(400);
  saved = await p.evaluate(() => JSON.parse(localStorage.getItem("osap-routes") || "[]"));
  nm = await names();
  ok(saved.length === 2 && nm.length === 2 && saved[0].color !== saved[1].color, vp.tag + ": two routes on the map, each its own colour (" + saved.map((x) => x.name + " " + x.color).join(", ") + ")");
  const strokes = await p.evaluate(() => [...document.querySelectorAll(".leaflet-routepane-pane path")].map((x) => x.getAttribute("stroke")));
  ok(saved.every((x) => strokes.includes(x.color)), vp.tag + ": both lines drawn in their colours");
  const onmap = await p.evaluate(() => [...document.querySelectorAll("#rt-onmap [data-show]")].map((x) => x.textContent));
  ok(onmap.length === 2, vp.tag + ": Also on the map lists both (" + onmap.join(" | ") + ")");
  await press("#rt-onmap [data-show]"); await p.waitForTimeout(300);
  ok((await names()).length === 1, vp.tag + ": hiding one leaves the other on the map");
  await p.reload({ waitUntil: "domcontentloaded" }); await p.waitForFunction(() => window.TSAP && window.OSAP_ROUTE_SEED, null, { timeout: 60000 }); await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  await p.evaluate(() => { window.TSAP.setView("route"); document.dispatchEvent(new Event("osap:view")); });
  await p.waitForFunction(() => document.querySelectorAll(".rtkname").length === 1, null, { timeout: 30000 }).catch(() => {});
  ok((await names()).length === 1, vp.tag + ": after a reload the shown route is still on the map");
  const sv = await p.evaluate(() => [...document.querySelectorAll("#rt-saved [data-show]")].map((x) => x.textContent + ":" + x.getAttribute("aria-pressed")));
  ok(sv.length === 2 && sv.filter((x) => /true$/.test(x)).length === 1, vp.tag + ": Saved routes show which are on the map (" + sv.join(", ") + ")");
  await press("#rt-saved [data-show][aria-pressed=false]"); await p.waitForTimeout(300);
  ok((await names()).length === 2, vp.tag + ": Show in Saved routes puts it back");
  ok(!errors.length, vp.tag + ": no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
