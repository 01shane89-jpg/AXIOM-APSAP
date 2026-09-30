// Headless check of the Layout > List choice on a desktop (index.html rvSet + assets/osap-conflicts.js):
// List shows the report cards on ordinary tabs, List from the full-screen map leaves full screen and shows the cards,
// and a conflict tab (which keeps its own report list beside the map) hides the Layout button and never shows a blank grey
// column, even when List was chosen on another tab first.
// Run from the repo root: node tests/layout_list_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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

async function open(hash) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1440, height: 900 } });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("asap-rv-mode", "split"); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + hash, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && document.querySelector('#atk-tools [data-atk="layout"]') && window.OSAP_CONFLICT_TABS, null, { timeout: 60000 });
  await p.waitForTimeout(3500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
  return { ctx, p, errors };
}
const view = (p, v) => p.evaluate((v) => { document.querySelector('#view-seg [data-view="' + v + '"]').click(); }, v);
const layoutBtn = (p) => p.evaluate(() => { const b = document.querySelector('#atk-tools [data-atk="layout"]'), r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
async function pickList(p) { await p.click('#atk-tools [data-atk="layout"]'); await p.waitForTimeout(200); await p.click('#atk-pop [data-pk="list"]'); await p.waitForTimeout(1500); }
const cards = (p) => p.evaluate(() => [...document.querySelectorAll("#rv-list .rvcard")].filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.top < innerHeight; }).length);
// what fills the screen below the header: the widest visible map, report list or conflict panel, and the width left uncovered
const cover = (p) => p.evaluate(() => {
  const vis = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth ? r : null; };
  const parts = ["#map", "#rv", "aside.rail"].map((s) => vis(document.querySelector(s))).filter(Boolean);
  let covered = 0; for (let x = 5; x < innerWidth; x += 10) if (parts.some((r) => x >= r.left && x <= r.right)) covered += 10;
  const m = vis(document.querySelector("#map"));
  return { covered: Math.min(1, covered / innerWidth), mapW: m ? Math.round(m.width) : 0 };
});

// ---------- an ordinary tab: List shows the cards ----------
{
  const { ctx, p, errors } = await open("#kp/timeline");
  ok(await layoutBtn(p), "Master timeline: Layout button shown");
  await pickList(p);
  ok(await p.evaluate(() => document.querySelector(".shell").classList.contains("rv-list")), "List chosen");
  const n = await cards(p); ok(n > 0, `List shows report cards on screen (${n})`);
  if (OUT) await p.screenshot({ path: OUT + "/layout-list-timeline.png" });
  // ---------- from the full-screen map ----------
  await p.click('#rv .rvhead [data-rv-mode="map"]'); await p.waitForTimeout(600);
  await p.click('#atk-tools [data-atk="full"]'); await p.waitForTimeout(500);
  ok(await p.evaluate(() => document.documentElement.classList.contains("mapfull")), "full-screen map on");
  await pickList(p);
  ok(await p.evaluate(() => !document.documentElement.classList.contains("mapfull")), "List from full screen leaves full screen");
  const n2 = await cards(p); ok(n2 > 0, `List from full screen shows report cards (${n2})`);
  if (OUT) await p.screenshot({ path: OUT + "/layout-list-from-full.png" });
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 2).join(" | ") : ""));
  await ctx.close();
}

// ---------- nothing on screen for any other reason: the page goes back to the map by itself ----------
{
  const { ctx, p, errors } = await open("#az/timeline");
  await pickList(p);
  ok(await p.evaluate(() => document.querySelector(".shell").classList.contains("rv-list")), "Azerbaijan: List chosen");
  await p.evaluate(() => { document.getElementById("rv").style.setProperty("display", "none", "important"); });   // stands in for an unknown cause
  await p.waitForTimeout(4500);
  const hm = await p.evaluate(() => [document.querySelector(".shell").className, localStorage.getItem("asap-rv-mode")]);
  ok(/\brv-map\b/.test(hm[0]), "blank screen goes back to Map by itself (" + hm.join(", ") + ")");
  const c = await cover(p); ok(c.mapW > 300, `map on screen again (${c.mapW}px wide)`);
  ok(await p.evaluate(() => /layout list/.test(localStorage.getItem("osap-blank") || "")), "the blank screen is recorded for diagnosis");
  await p.evaluate(() => { document.getElementById("rv").style.removeProperty("display"); });
  await p.click('#atk-tools [data-atk="layout"]'); await p.waitForTimeout(200); await p.click('#atk-pop [data-pk="list"]'); await p.waitForTimeout(4500);
  ok(await p.evaluate(() => document.querySelector(".shell").classList.contains("rv-list")), "a working List layout is left alone");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 2).join(" | ") : ""));
  await ctx.close();
}

// ---------- conflict tabs: no Layout button, never a blank column ----------
// Syria with Details folded to its strip is the screen Shane saw go grey (2026-09-30)
for (const [cc, tab, folded] of [["th", "cf-thailand-deep-south"], ["th", "cf-thailand-cambodia"], ["ua", "cf-russia-ukraine"], ["sy", "cf-syria", true]]) {
  const { ctx, p, errors } = await open("#" + cc + "/timeline");
  if (folded) { await p.evaluate(() => window.OSAP_COL("rail", true)); await p.waitForTimeout(300); }
  await pickList(p);                                    // List chosen on another tab first (remembered)
  await view(p, tab); await p.waitForTimeout(2500);
  ok(await p.evaluate(() => document.documentElement.hasAttribute("data-cf")), `${tab}: conflict tab open`);
  ok(!(await layoutBtn(p)), `${tab}: Layout button hidden (the tab keeps its own report list beside the map)`);
  const c = await cover(p);
  ok(c.mapW > 300, `${tab}: map on screen after List on another tab (${c.mapW}px wide)`);
  ok(c.covered > 0.97, `${tab}: no blank column (${Math.round(c.covered * 100)}% of the width covered)`);
  if (!folded) ok(await p.evaluate(() => { const r = document.getElementById("cf-rail"); return r && !r.hidden && r.getBoundingClientRect().width > 200; }), `${tab}: conflict panel shown`);
  if (OUT) await p.screenshot({ path: OUT + "/layout-list-" + tab + ".png" });
  await view(p, "timeline"); await p.waitForTimeout(1500);
  const n = await cards(p); ok(n > 0, `${tab}: back on the Master timeline, List shows the cards again (${n})`);
  ok(!errors.length, `${tab}: no page errors` + (errors.length ? ": " + errors.slice(0, 2).join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
