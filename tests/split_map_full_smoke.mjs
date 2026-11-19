// Headless check of the docked window's Map / Half / Full stops on a large screen (assets/osap-split.js; Shane 19 Nov 2026:
// "full screen view isnt actually full screen"), with the evacuation planner as the window: Map folds it to a small pill at
// the bottom middle of the map, so nothing covers the side and the toolbar stays at the right edge; Full is the full-height side panel;
// Half stays the top half on the right. Routers and other hosts are blocked.
// Run from the repo root: node tests/split_map_full_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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

const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 640 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
const errors = [], p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TSAP && window.OSAP_EPE_GO, null, { timeout: 60000 }); await p.waitForTimeout(2000);
await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
/* Map only, as on Shane's screen */
await p.evaluate(() => { const b = document.querySelector('#rv-seg [data-rv-mode="map"]'); if (b) b.click(); }); await p.waitForTimeout(500);
await p.evaluate(() => window.OSAP_EPE_GO({ at: [14.810428, 100.696287], how: "test" }));
await p.waitForFunction(() => window.OSAP_EPE && !document.getElementById("epe").hidden, null, { timeout: 20000 });
await p.waitForTimeout(300);
const geo = () => p.evaluate(() => {
  const m = window.__asapMap.getContainer().getBoundingClientRect(), w = document.getElementById("epe"), r = w.getBoundingClientRect(), cs = getComputedStyle(document.documentElement);
  return { stop: w.getAttribute("data-osheet"), m: { l: m.left, r: m.right, t: m.top, w: m.width }, w: { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }, cov: cs.getPropertyValue("--osplit-r").trim(), cover: document.documentElement.classList.contains("osplit-cover") };
});
const press = async (t) => { await p.click('#epe .osheet-h .osh-b button:text-is("' + t + '")'); await p.waitForTimeout(350); };

await press("Half");
let g = await geo();
ok(g.stop === "half" && g.w.r >= g.m.r - 2 && g.w.w < g.m.w * 0.6 && g.w.b < 640 * 0.75, "Half: the right side of the map (" + Math.round(g.w.w) + " px wide)");

await press("Map");
g = await geo();
if (OUT) await p.screenshot({ path: OUT + "/split-map.png" });
ok(g.stop === "min", "Map is chosen");
ok(g.w.h < 70 && g.w.w < 520, "Map folds the panel to a small bar (" + Math.round(g.w.w) + " x " + Math.round(g.w.h) + ")");
ok(Math.abs((g.w.l + g.w.r) / 2 - (g.m.l + g.m.r) / 2) < 4 && g.w.b <= 640 && g.w.t > 640 - 90, "at the bottom middle of the map, out of the way of the labels (Shane 19 Nov: \"this is in the way\")");
ok(g.w.w <= 320 && g.w.h <= 40, "a small pill (" + Math.round(g.w.w) + " x " + Math.round(g.w.h) + ")");
ok(g.cov === "0px" && !g.cover, "covering no side of the map, so the toolbar stays at the edge (--osplit-r " + g.cov + ")");
ok(await p.evaluate(() => getComputedStyle(document.querySelector("#epe .osheet-h .osh-b")).display === "none" && !!document.querySelector("#epe .osheet-h .osh-x").offsetWidth && /Evacuation/.test(document.querySelector("#epe .osheet-h .osh-t").textContent)), "the pill holds the name and close only");
await p.click("#epe .osheet-h .osh-t"); await p.waitForTimeout(350);
g = await geo();
ok(g.stop === "half", "a tap on the name brings the panel back (" + g.stop + ")");

await press("Full");
g = await geo();
if (OUT) await p.screenshot({ path: OUT + "/split-full.png" });
ok(g.stop === "full" && g.w.r >= 1280 - 2 && g.w.w < g.m.w * 0.6, "Full is the full-height side panel (" + Math.round(g.w.l) + "-" + Math.round(g.w.r) + " vs " + Math.round(g.m.l) + "-" + Math.round(g.m.r) + ")");
ok(g.w.b >= 640 - 2, "down to the bottom of the window");

await press("Map");
g = await geo();
ok(g.stop === "min" && g.w.h < 70, "back to Map folds it again");
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "ALL PASS");
