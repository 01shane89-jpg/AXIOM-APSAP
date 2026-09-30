// Headless check of the Military sites layer on the conflict tabs (assets/osap-cf-sites.js): the panel appears on the
// Russia-Ukraine tab, sites draw as unknown-frame symbols in pane cfpane, a site named in a report in the period gets the red
// ring and lists that report, older mentions are left out, a reported strike on a military target draws, the switches work,
// and the layer is removed when the tab closes. The site file is a fixture (served in place of data/live/conflicts/sites/).
// Run from the repo root: node tests/milsites_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves a screenshot)
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
const FIX = { schema: "osap-cf-sites/1", id: "russia-ukraine", asof: "2026-09-29 15:00Z", built: "2026-09-29 15:00Z", sources: [{ id: "wikidata", ok: true, n: 3 }, { id: "osm:ua", ok: false, error: "timed out" }],
  sites: [
    { n: "Test Air Base", k: "air", la: 48.5, lo: 35.0, cc: "ua", wd: "Q1", w: "https://en.wikipedia.org/wiki/Test", m: [
      { t: "Drones hit Test Air Base", d: iso(1), u: "https://example.org/a", o: "Outlet A", k: "drone", fp: "ab".repeat(32), st: 1 },
      { t: "Old story about Test Air Base", d: iso(400), u: "https://example.org/old", o: "Outlet B", k: "attack", fp: "" }] },
    { n: "Test Naval Base", k: "naval", la: 46.6, lo: 31.0, cc: "ua", osm: "way/1" },
    { n: "Test Barracks <b>x</b>", k: "barracks", la: 49.0, lo: 33.0, cc: "ua", osm: "node/2" },
    { n: "Only Old Mention Depot", k: "depot", la: 47.9, lo: 37.5, cc: "ua", osm: "node/3", m: [{ t: "Depot story", d: iso(500), u: "https://example.org/b", o: "Outlet C", k: "attack" }] }
  ] };
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1500, height: 950 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await ctx.route(/conflicts\/sites\/russia-ukraine\.js/, (r) => r.fulfill({ contentType: "text/javascript", body: '(window.OSAP_CF_SITES=window.OSAP_CF_SITES||{})["russia-ukraine"]=' + JSON.stringify(FIX) + ";" }));
// a report placed at a town that names an airfield, added to the tab's own data: must show as a reported strike on a military target
const STRIKE = { title: "Missile strike on airfield near Testville", date: iso(2), link: "https://example.org/s", outlet: "Outlet S", kind: "missile", state: false, geo: { la: 48.0, lo: 36.0, n: "Testville" }, fp: "cd".repeat(32) };
await ctx.route(/conflicts\/russia-ukraine\.js$/, async (r) => {
  const body = await readFile(join(root, "data/live/conflicts/russia-ukraine.js"), "utf8");
  r.fulfill({ contentType: "text/javascript", body: body + '\nwindow.OSAP_CF["russia-ukraine"].items.unshift(' + JSON.stringify(STRIKE) + ");" });
});
// the period in the page header: past 30 days; one placed report that names a military target is added to the tab's data
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("asap-period", JSON.stringify({ p: "30" })); localStorage.removeItem("osap-cf-sites"); } catch (e) {} });
const p = await ctx.newPage(), errors = [];
p.on("pageerror", (e) => errors.push(e.message)); p.on("crash", () => console.log("PAGE CRASHED")); if (process.env.DBG) p.on("framenavigated", (f) => { if (f === p.mainFrame()) console.log("nav", f.url()); });
// the country's first load reloads the page once (for its files); then the conflict tab is opened
await p.goto(base + "#ua/timeline", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(6000);
await p.waitForFunction(() => window.TSAP && window.TSAP.country === "ua" && document.querySelector('#view-seg [data-view="cf-russia-ukraine"]'), null, { timeout: 60000 });
await p.waitForTimeout(1500);
if (process.env.DBG) { p.on("console", (m) => /UNLOAD/.test(m.text()) && console.log(m.text())); await p.evaluate(() => window.addEventListener("beforeunload", () => console.log("UNLOAD " + new Error().stack))); }
await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); document.querySelector('#view-seg [data-view="cf-russia-ukraine"]').click(); });
await p.waitForFunction(() => document.querySelector("#cfs .cfk"), null, { timeout: 30000 });
await p.waitForTimeout(1500);
await p.evaluate(() => { setTimeout(() => window.__asapMap.setView([48, 34], 7), 50); });
await p.waitForTimeout(2000);
await p.waitForTimeout(1200);
const st = await p.evaluate(() => ({
  panel: !!document.getElementById("cfs"),
  sites: document.querySelectorAll("#map .leaflet-cfpane-pane .msym.cfs").length,
  hit: document.querySelectorAll("#map .leaflet-cfpane-pane .msym.cfs-hit").length,
  strike: document.querySelectorAll("#map .leaflet-cfpane-pane .msym.cfs-strike").length,
  strikeT: (() => { let f = false; window.__asapMap.eachLayer((m) => { if (m.getLatLng && m.getLatLng().lat === 48 && m.getLatLng().lng === 36 && /Testville/.test(String(m.getPopup() && m.getPopup().getContent()))) f = true; }); return f; })(),
  hostile: [...document.querySelectorAll("#map .msym.cfs svg path")].some((e) => /rgb\(255, ?128, ?128\)|#ff8080/i.test(e.getAttribute("fill") || "")),
  named: (document.querySelector("#cfs details summary") || {}).textContent || "",
  bad: document.querySelector("#cfs .cfbad") ? document.querySelector("#cfs .cfbad").textContent : "",
  legend: !!document.querySelector('[data-lg="cf-sites"]'),
  injected: !!document.querySelector("#map b") && [...document.querySelectorAll("#map .leaflet-tooltip b")].length > 0
}));
ok(st.panel, "the Military sites panel is on the conflict tab");
ok(st.sites === 4, "four sites draw as symbols in pane cfpane (" + st.sites + ")");
ok(st.hit === 1, "only the site named in a report in the period has the red ring (" + st.hit + ")");
ok(st.strike >= 1 && st.strikeT, "the placed report naming an airfield draws as a reported strike (" + st.strike + " in the past 30 days)");
ok(!st.hostile, "no symbol uses the hostile frame");
ok(/\(1\)/.test(st.named), "the list of sites named in reports holds one site: " + st.named);
ok(/osm:ua/.test(st.bad), "a source that failed is named: " + st.bad);
ok(st.legend, "the map legend has a Military sites section");
// pop-up of the named site: the recent report, not the old one; the site name is escaped
await p.evaluate(() => { const L = window.__asapMap; L.eachLayer((m) => { if (m.getLatLng && m.getLatLng().lat === 48.5 && m.getPopup && m.getPopup()) m.openPopup(); }); });
await p.waitForTimeout(600);
const pop = await p.evaluate(() => { const e = document.querySelector(".leaflet-popup-content"); return e ? { t: e.textContent, links: [...e.querySelectorAll("a")].map((a) => a.href) } : null; });
ok(pop && /Drones hit Test Air Base/.test(pop.t) && !/Old story/.test(pop.t), "the site pop-up lists the recent report only");
ok(pop && /Claim/.test(pop.t) && /Reported, not verified/.test(pop.t), "the pop-up tags the claim and says reported, not verified");
ok(pop && pop.links.some((h) => /wikidata\.org\/wiki\/Q1/.test(h)) && pop.links.includes("https://example.org/a"), "the pop-up links the source record and the report");
await p.waitForTimeout(600);
ok(await p.evaluate(() => /SHA-256 [0-9a-f]{16}/.test((document.querySelector('.leaflet-popup-content [data-cfsfp]') || {}).textContent || "")), "the site record gets a SHA-256 fingerprint");
if (OUT) await p.screenshot({ path: OUT + "/milsites.png" });
const xss = await p.evaluate(() => [...document.querySelectorAll("#map .leaflet-cfpane-pane b, #cfs b")].some((b) => b.textContent === "x"));
ok(!xss, "a site name with markup is shown as text");
// switches: strikes off, then sites off
await p.click('#cfs [data-cfs="s"]'); await p.waitForTimeout(400);
ok(await p.evaluate(() => document.querySelectorAll("#map .msym.cfs-strike").length === 0), "switching strikes off removes the strike markers");
await p.click('#cfs [data-cfsg="air"]'); await p.waitForTimeout(400);
ok(await p.evaluate(() => document.querySelectorAll("#map .msym.cfs").length === 3), "switching air bases off leaves three sites");
await p.click('#cfs [data-cfs="on"]'); await p.waitForTimeout(400);
ok(await p.evaluate(() => document.querySelectorAll("#map .msym.cfs").length === 0), "switching sites off removes them");
ok(await p.evaluate(() => { const s = JSON.parse(localStorage.getItem("osap-cf-sites")); return s.on === false && s.s === false && s.g.air === false; }), "the switches are remembered");
await p.click('#cfs [data-cfs="on"]'); await p.waitForTimeout(400);
// closing the tab removes the layer
await p.evaluate(() => { const b = document.querySelector('#view-seg button:not(.cftab)[data-view]'); b.click(); });
await p.waitForTimeout(800);
ok(await p.evaluate(() => document.querySelectorAll("#map .msym.cfs").length === 0 && !document.querySelector('[data-lg="cf-sites"]')), "leaving the tab removes the sites and their legend");
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
