// Headless check of the Deep South border map on the Deep South conflict tab (assets/osap-cf-deepsouth.js): its switches appear in
// the tab's Map layers, the Thailand–Malaysia border line and the crossings draw, the 37 district outlines draw in their own pane
// (visible on the conflict tab), shading follows this tab's attack reports, a crossing pop-up carries its source and fingerprint,
// the special-law switch colours districts, the switches are remembered, and everything is removed when the tab closes.
// Run from the repo root: node tests/deepsouth_border_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves a screenshot)
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
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const now = new Date(), iso = (d) => new Date(now - d * 864e5).toISOString().slice(0, 16);
// two attack reports placed in Rueso (by district id) and one in Tak Bai (by point only), added to the tab's own data
const ADD = [
  { title: "Test bomb in Rueso", date: iso(1), link: "https://example.org/1", outlet: "Outlet A", kind: "ied", geo: { la: 6.39, lo: 101.53, n: "Rueso district, Narathiwat", p: "approx", id: "TH-9606" } },
  { title: "Test shooting in Rueso", date: iso(2), link: "https://example.org/2", outlet: "Outlet B", kind: "shooting", geo: { la: 6.39, lo: 101.53, n: "Rueso district, Narathiwat", p: "approx", id: "TH-9606" } },
  { title: "Test arson by point", date: iso(3), link: "https://example.org/3", outlet: "Outlet C", kind: "arson", geo: { la: 6.259, lo: 102.053, n: "somewhere", p: "approx" } }];
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1500, height: 950 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await ctx.route(/conflicts\/thailand-deep-south\.js$/, async (r) => {
  const body = await readFile(join(root, "data/live/conflicts/thailand-deep-south.js"), "utf8");
  r.fulfill({ contentType: "text/javascript", body: body + '\n(window.OSAP_CF["thailand-deep-south"].items||(window.OSAP_CF["thailand-deep-south"].items=[])).unshift(...' + JSON.stringify(ADD) + ");" });
});
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("asap-period", JSON.stringify({ p: "30" })); if (window.top === window) localStorage.removeItem("osap-cf-ds"); } catch (e) {} });
const p = await ctx.newPage(), errors = [];
p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#th/timeline", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(6000);
await p.waitForFunction(() => window.TSAP && window.TSAP.country === "th" && document.querySelector('#view-seg [data-view="cf-thailand-deep-south"]'), null, { timeout: 60000 });
await p.waitForTimeout(1500);
await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); document.querySelector('#view-seg [data-view="cf-thailand-deep-south"]').click(); });
await p.waitForFunction(() => document.querySelector("#cfds details"), null, { timeout: 30000 });
await p.waitForTimeout(1500);
await p.evaluate(() => window.__asapMap.setView([6.3, 101.5], 9));
await p.waitForTimeout(1500);
const s1 = await p.evaluate(() => {
  const pane = window.__asapMap.getPane("dsbpane"), cs = pane && getComputedStyle(pane);
  return { inLayers: !!document.querySelector("#cf-layers-x #cfds"), pane: !!pane, vis: cs && cs.visibility, paths: Object.values(window.__asapMap._layers).filter((l) => l.options && l.options.pane === "dsbpane" && l._latlngs).length, canvas: pane ? pane.querySelectorAll("canvas").length : 0,
    cx: document.querySelectorAll(".dsb-cx").length, dashed: Object.values(window.__asapMap._layers).some((l) => l.options && l.options.pane === "dsbpane" && l.options.dashArray === "8 5"),
    rows: [...document.querySelectorAll("#cfds details table tr")].map((t) => t.textContent), law: document.querySelector('[data-cfds="law"]').disabled,
    legend: (document.body.innerText.match(/Deep South border map/g) || []).length };
});
ok(s1.inLayers, "the switches sit in the tab's Map layers section");
ok(s1.pane && s1.vis === "visible", "the border pane exists and is visible on the conflict tab (" + s1.vis + ")");
ok(s1.paths >= 38 && s1.canvas >= 1, "the border line and 37 district outlines draw in the pane (" + s1.paths + " shapes, " + s1.canvas + " canvas)");
ok(s1.dashed, "the border line is drawn dashed");
ok(s1.cx === 9, "nine crossings draw (" + s1.cx + ")");
ok(s1.rows.some((r) => /Rueso/.test(r) && +r.replace(/\D+/g, "") >= 2), "Rueso counts its attack reports by district id");
ok(s1.rows.some((r) => /Tak Bai/.test(r)), "a report with only a point goes to the district it falls in (Tak Bai)");
const pop = await p.evaluate(() => { const m = [...document.querySelectorAll(".dsb-cx")].find((e) => /Kolok/.test(e.textContent)); m.click(); return new Promise((r) => setTimeout(() => r((document.querySelector(".leaflet-popup-content") || {}).innerText || ""), 400)); });
ok(/Rantau Panjang/.test(pop) && /SHA-256/.test(pop) && /Source/.test(pop) && /AI generated/.test(pop), "a crossing pop-up has both sides, its source, the AI tag and the fingerprint");
const law = await p.evaluate(() => (window.OSAP_DSB.measures || []).length);
if (law) {
  await p.evaluate(() => { const c = document.querySelector('[data-cfds="law"]'); c.checked = true; c.dispatchEvent(new Event("change", { bubbles: true })); });
  await p.waitForTimeout(500);
  const lc = await p.evaluate(() => Object.values(window.__asapMap._layers).filter((l) => l.options && l.options.pane === "dsbpane" && /#c62828|#ef6c00|#6a1b9a/.test(l.options.fillColor || "")).length);
  ok(lc > 0, "the special-law switch colours districts by law (" + lc + ")");
} else ok(s1.law, "with no special-law data the switch is disabled");
await p.evaluate(() => { const c = document.querySelector('[data-cfds="dist"]'); c.checked = false; c.dispatchEvent(new Event("change", { bubbles: true })); });
ok(await p.evaluate(() => JSON.parse(localStorage.getItem("osap-cf-ds")).dist === false), "the switches are remembered");
if (OUT) await p.screenshot({ path: OUT + "/deepsouth-border.png" });
await p.evaluate(() => document.querySelector('#view-seg button:not(.cftab)[data-view]').click());
await p.waitForTimeout(1200);
ok(await p.evaluate(() => !Object.values(window.__asapMap._layers).some((l) => l.options && l.options.pane === "dsbpane" && l._latlngs) && !document.querySelector(".dsb-cx")), "leaving the tab removes the border map");
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
