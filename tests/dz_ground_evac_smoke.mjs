// Headless check of Ground evacuation on the DZSO sheet (assets/osap-dzso.js; Shane 2026-10-27: "see ground evac for the med
// plan from the dz"): road distance and drive time from the PI to each listed hospital and the road route drawn on the map, with
// the medical plan's own routing (OSAP_MEDPLAN.road in assets/osap-medplan.js). Hospitals come from OSAP's stored copy in
// data/medfac; the OSRM table and route answers are made up (hospital k is (k + 1) x 5 km and (k + 1) x 6 min by road, except
// that the second hospital is quickest, 4 min); Open-Meteo and Overpass get empty test answers.
// Checks: the button adds a By road column with every hospital's figures; the route goes to the hospital quickest by road and is
// drawn in green; Route on another row re-routes; the PDF lists the road figures and draws the route on the diagram; Ground
// evacuation off clears the line; with no router answering the figures are labelled estimates with Try again; no page errors.
// Run from the repo root: node tests/dz_ground_evac_smoke.mjs   (needs playwright and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
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
const PI = [15.10, 100.60];
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(b) });

async function open(flags = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1440, height: 900 } });
  const errors = [], hits = { table: 0, route: [] };
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    if (/api\.open-meteo\.com/.test(u)) return J(r, { error: true, reason: "test" });
    if (/\/api\/interpreter/.test(u)) return J(r, { elements: [] });
    if (!flags.noRouter && /\/table\/v1\/driving\//.test(u)) {
      hits.table++;
      const n = decodeURIComponent(u.split("/table/v1/driving/")[1].split("?")[0]).split(";").length;
      const dur = [...Array(n)].map((_, k) => (k === 0 ? 0 : k === 2 ? 240 : k * 360)), dist = [...Array(n)].map((_, k) => k * 5000);
      return J(r, { code: "Ok", durations: [dur], distances: [dist] });
    }
    if (!flags.noRouter && /\/route\/v1\/driving\//.test(u)) {
      const c = decodeURIComponent(u.split("/route/v1/driving/")[1].split("?")[0]).split(";").map((x) => x.split(",").map(Number));
      hits.route.push(c[1]);
      return J(r, { code: "Ok", routes: [{ duration: 777, distance: 9100, geometry: { type: "LineString", coordinates: [c[0], [(c[0][0] + c[1][0]) / 2, c[0][1]], c[1]] }, legs: [{ steps: [{ name: "Test Road", ref: "3196", distance: 6000 }, { name: "Hospital Lane", distance: 3100 }] }] }] });
    }
    return r.abort();
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_DZSO_GO && window.OSAP_MEDPLAN && window.__asapMap, null, { timeout: 60000 }); await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  await p.evaluate((c) => window.OSAP_DZSO_GO({ at: c }), PI);
  await p.waitForFunction(() => { const s = window.OSAP_DZSO && window.OSAP_DZSO.state && window.OSAP_DZSO.state(); return s && (s.hosp || s.hospErr) && (s.hz || s.hzErr); }, null, { timeout: 30000 });
  return { ctx, p, errors, hits };
}

{
  const { ctx, p, errors, hits } = await open();
  const H = await p.evaluate(() => window.OSAP_DZSO.state().hosp.list.map((x) => ({ name: x.name, p: x.p })));
  ok(H.length >= 3, "hospitals listed from the stored copy: " + H.length);
  ok(await p.evaluate(() => typeof window.OSAP_MEDPLAN.road.times === "function" && typeof window.OSAP_MEDPLAN.road.route === "function"), "the medical plan lends its road routing (OSAP_MEDPLAN.road)");
  await p.click('#dzso [data-dz="gnd"]');
  await p.waitForFunction(() => /Road route to/.test(document.getElementById("dzso").innerText), null, { timeout: 15000 });
  const t = await p.textContent("#dzso");
  ok(/By road/.test(t) && /5\.0 km, 6 min/.test(t) && /10 km, 4 min/.test(t), "Ground evacuation adds a By road column: 5.0 km, 6 min and 10 km, 4 min");
  ok(hits.table === 1, "one drive-time table request: " + hits.table);
  const r0 = hits.route[0];
  ok(r0 && Math.abs(r0[1] - H[1].p[0]) < 1e-4 && Math.abs(r0[0] - H[1].p[1]) < 1e-4 && new RegExp("Road route to " + H[1].name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(t), "the route goes to the hospital quickest by road (" + H[1].name + "), not the nearest");
  ok(/9\.1 km, 13 min via 3196 Test Road, Hospital Lane/.test(t), "the route's distance, time and roads are shown");
  ok(await p.evaluate(() => [...document.querySelectorAll(".leaflet-dzpane-pane path")].some((x) => x.getAttribute("stroke") === "#2e7d32")), "the road route is drawn on the map in green");
  await p.click('#dzso [data-dz="groute"][data-i="0"]');
  await p.waitForFunction(() => window.OSAP_DZSO.state && !/Working out/.test(document.getElementById("dzso").innerText), null, { timeout: 15000 }); await p.waitForTimeout(200);
  const r1 = hits.route[hits.route.length - 1];
  ok(Math.abs(r1[1] - H[0].p[0]) < 1e-4 && (await p.textContent("#dzso")).includes("Road route to " + H[0].name), "Route on the first row re-routes to " + H[0].name);
  /* the PDF */
  await p.evaluate(() => { window.__pdf = null; window.__pdfHold = (info) => { const r = info.root; window.__pdf = { text: r.innerText, green: [...r.querySelectorAll("svg polyline")].some((x) => x.getAttribute("stroke") === "#2e7d32") }; }; });
  await p.click('#dzso [data-dz="pdf"]'); await p.waitForFunction(() => window.__pdf, null, { timeout: 20000 });
  const pdf = await p.evaluate(() => window.__pdf);
  ok(/By road/.test(pdf.text) && /5\.0 km, 6 min/.test(pdf.text) && /Road route to/.test(pdf.text) && pdf.green, "the PDF lists the road figures and draws the route on the diagram");
  await p.click('#dzso [data-dz="gnd"]');
  ok(await p.evaluate(() => ![...document.querySelectorAll(".leaflet-dzpane-pane path")].some((x) => x.getAttribute("stroke") === "#2e7d32") && !/By road/.test(document.getElementById("dzso").innerText)), "Ground evacuation off clears the column and the line");
  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await ctx.close();
}
{
  const { ctx, p, errors } = await open({ noRouter: true });
  await p.click('#dzso [data-dz="gnd"]');
  await p.waitForFunction(() => /No road router answered/.test(document.getElementById("dzso").innerText), null, { timeout: 60000 });
  const t = await p.textContent("#dzso");
  ok(/straight-line estimates/.test(t) && /\(estimate\)/.test(t) && /~/.test(t) && /Try again/.test(t), "no router: the road figures are labelled estimates, with Try again");
  ok(errors.length === 0, "no router: no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
