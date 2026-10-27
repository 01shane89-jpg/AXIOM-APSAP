// Headless check that saved points stay readable when zoomed out (assets/osap-ptdeclutter.js): close points become one symbol
// with a count, the symbols shrink and lose their labels when far out, pressing a group zooms in until the points separate,
// and up close every point shows at full size with its name. Run from the repo root: node tests/points_declutter_smoke.mjs
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

const PTS = [{ id: "p1", n: "WING 2", lat: 14.905, lon: 100.66, cc: "th", t: Date.now() }, { id: "p2", n: "SFRE AOB", lat: 14.83, lon: 100.70, cc: "th", t: Date.now() },
  { id: "p3", n: "Tadia DZ", lat: 14.84, lon: 100.80, cc: "th", t: Date.now(), sym: "" }, { id: "p4", n: "Far away", lat: 18.79, lon: 98.98, cc: "th", t: Date.now() }];
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 } });
const errors = [];
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await ctx.addInitScript((pts) => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("osap-atak-pts", JSON.stringify(pts)); } catch (e) {} }, PTS);
const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TSAP && window.FW && window.FW.map && window.OSAP_PTDECLUTTER && document.querySelectorAll(".atk-pt").length >= 4, null, { timeout: 60000 }); await p.waitForTimeout(1500);
await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
const at = async (c, z) => { await p.evaluate(([c, z]) => window.FW.map.setView(c, z, { animate: false }), [c, z]); await p.waitForTimeout(500); };
const look = () => p.evaluate(() => Array.prototype.map.call(document.querySelectorAll(".atk-pt"), (ic) => {
  const lab = ic.querySelector(":scope > span"), part = ic.firstElementChild, n = ic.querySelector(".atk-dc-n");
  return { name: ic.title, shown: getComputedStyle(ic).display !== "none", label: !!lab && getComputedStyle(lab).display !== "none", n: n ? +n.textContent : 0, sc: part ? part.style.transform : "" };
}));

/* zoomed out on the country: the three close points are one symbol with a count of 3, small and without labels */
await at([15.5, 101], 6);
let v = await look(), shown = v.filter((x) => x.shown);
ok(shown.length === 2, "zoomed out, 4 points show as 2 symbols (" + shown.length + ")");
ok(shown.some((x) => x.n === 3 && /^3 saved points here: /.test(x.name)), "the 3 close points are one symbol with a count of 3 that lists their names");
ok(shown.every((x) => !x.label), "zoomed out, labels are hidden");
ok(shown.every((x) => x.sc === "scale(0.5)"), "zoomed out, symbols are drawn at half size");
if (OUT) await p.screenshot({ path: OUT + "/declutter-z6.png" });

/* pressing the group zooms in until the points separate */
const z0 = await p.evaluate(() => window.FW.map.getZoom());
await p.evaluate(() => { const g = document.querySelector(".atk-pt.atk-dc-grp"); g.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
await p.waitForTimeout(1200);
const z1 = await p.evaluate(() => window.FW.map.getZoom());
v = await look();
ok(z1 > z0 && !(await p.evaluate(() => !!document.querySelector(".leaflet-popup"))), "pressing the group zooms in (zoom " + z0 + " -> " + z1 + ") and opens no popup");
ok(v.filter((x) => x.shown && /WING 2|SFRE AOB|Tadia DZ/.test(x.name)).length === 3 && v.every((x) => !x.n), "after zooming in, the three points are separate");

/* up close: full size with names */
await at([14.86, 100.72], 13);
v = await look(); shown = v.filter((x) => x.shown);
ok(shown.length >= 3 && shown.every((x) => x.label && x.sc === ""), "up close, every point shows at full size with its name");
/* a single point still opens its own popup */
await p.evaluate(() => { const ic = Array.prototype.find.call(document.querySelectorAll(".atk-pt"), (x) => x.title === "WING 2"); ic.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
await p.waitForTimeout(500);
ok(await p.evaluate(() => { const b = document.querySelector(".leaflet-popup .atk-ptpop b"); return !!b && b.textContent === "WING 2"; }), "a single point still opens its popup");
/* the saved points themselves are not changed */
ok(await p.evaluate((n) => JSON.parse(localStorage.getItem("osap-atak-pts")).length === n, PTS.length), "the saved points are unchanged");
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
