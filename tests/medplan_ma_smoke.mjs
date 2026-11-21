// Morocco in the Medical plan, from OSAP's own data (Shane 2026-11-15: "Build out robust med plan data package for Morocco
// ... And the route from POI didn't populate"). Reads the real stored OpenStreetMap copy (data/medfac) and OSAP's sourced
// list (data/sof/ma.js); live hosts are cut off and road times are a fixed straight-line estimate. Checks: a plan in
// Marrakech draws road routes from the POI even where no hospital fills a plan role (nearest hospitals by road, labelled
// "capability not documented", never filling a role); every road route that is drawn starts at the POI.
// Run from the repo root: node tests/medplan_ma_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const root = process.cwd(), TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m, x) { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x))); if (!c) fails++; }
const hav = (a, b) => { const r = Math.PI / 180, dl = (b[0] - a[0]) * r, dn = (b[1] - a[1]) * r; const x = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) ** 2; return 12742e3 * Math.asin(Math.sqrt(x)); };
const sec = (a, b) => hav(a, b) * 1.4 / (30 / 3.6);
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(b) });
const routeFrom = [];
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
  const u = r.request().url(), pts = () => new URL(u).pathname.split("/").pop().split(";").map((x) => x.split(",").map(Number).reverse());
  if (/\/table\/v1\//.test(u)) { const P = pts(); return J(r, { code: "Ok", durations: [P.map((p) => sec(P[0], p))], distances: [P.map((p) => hav(P[0], p) * 1.4)] }); }
  if (/\/route\/v1\//.test(u)) { const P = pts(), d = sec(P[0], P[1]); routeFrom.push(P[0]); return J(r, { code: "Ok", routes: [{ duration: d, distance: d * 8, geometry: { type: "LineString", coordinates: [P[0].slice().reverse(), P[1].slice().reverse()] }, legs: [{ steps: [] }] }] }); }
  return r.abort();
});
await ctx.addInitScript(() => { try { if (localStorage.getItem("osap-medplan-open") === null) localStorage.setItem("osap-medplan-open", JSON.stringify({ conop: 1, pic: 1, val: 1, pst: 1, pstmore: 1, gh: 1, fac: 1, rt: 1, ems: 1, air: 1, oc: 1, thr: 1, wx: 1, unit: 1, src: 1 })); if (localStorage.getItem("osap-medplan-layers") === null) localStorage.setItem("osap-medplan-layers", "[]"); localStorage.setItem("osap-home", "map"); localStorage.setItem("osap.split", "0"); } catch (e) {} });
const p = await ctx.newPage(), errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#ma/map", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.OSAP_MEDPLAN && window.TSAP && window.TSAP.areaApi, null, { timeout: 90000 });
await p.waitForTimeout(2000);
async function plan(at) {
  await p.evaluate((a) => window.OSAP_MEDPLAN.open({ at: a }), at);
  await p.waitForFunction(() => window.OSAP_MEDPLAN._hosp().length > 0, null, { timeout: 120000 });
  await p.waitForFunction(() => { const el = document.getElementById("mp-rt"); return el && /min/.test(el.textContent) && !/Working out the route/.test(el.textContent); }, null, { timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(1500);
  return p.evaluate(() => {
    const M = window.OSAP_MEDPLAN, H = M._hosp(), el = document.getElementById("mp-rt");
    return { n: H.length, documented: H.filter((f) => !f.osm || f.sof).length, rt: el ? el.textContent : "", heads: el ? [...el.querySelectorAll("h4")].map((h) => h.textContent) : [],
      roles: M._roles().filter((r) => r.casualty_category === "cat.major_trauma").map((r) => [r.role, r.state, r.choice ? r.choice.f.name : ""]) };
  });
}
const POI = [31.6295, -7.9811];
const mk = await plan(POI);
ok(mk.n > 0, "Marrakech: the plan lists hospitals from the stored copy", { n: mk.n });
ok(mk.heads.length > 0, "Marrakech: road routes from the POI are drawn (section 3 is not empty)", { heads: mk.heads, rt: mk.rt.slice(0, 200) });
ok(!/No hospital with an official trauma designation to route to/.test(mk.rt), "Marrakech: section 3 no longer stops at 'no designated hospital'", mk.rt.slice(0, 160));
const filled = mk.roles.filter((r) => r[1] === "filled");
const nearest = mk.heads.filter((h) => /Nearest hospital/.test(h));
ok(filled.length > 0 || nearest.length > 0, "Marrakech: routes go to the plan's picks, or to the nearest hospitals when no role is filled", { roles: mk.roles, heads: mk.heads });
ok(nearest.every((h) => /capability not documented/.test(h)), "nearest-hospital routes say their capability is not documented", nearest);
ok(routeFrom.length > 0 && routeFrom.every((q) => hav(q, POI) < 2000), "every road route starts at the POI", routeFrom.slice(0, 3));
ok(!errors.length, "no page errors", errors.slice(0, 3));
await browser.close(); server.close();
console.log(fails ? fails + " checks failed" : "all Morocco medical plan checks passed");
process.exit(fails ? 1 : 0);
