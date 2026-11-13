// Headless check that the phone layout fits the screen it is given. Shane's users saw the bottom of the app cut off on
// iPhones: the right-hand map toolbar ran on under the Timeline sheet with its last buttons out of reach, because the map
// was sized from 100svh while the sheet is pinned to the bottom of the page's real box (window.innerHeight), and some
// iPhone browsers (Safari opened from another app, Safari with its floating toolbar) report 100svh taller than that box.
// For small and large phones (375x667 iPhone SE, 390x664 iPhone 15 with Safari's bars showing, 320x568, 430x932), each
// run twice: as served, and with every 100svh made 80 px taller than the screen to act like those browsers. Checks: the
// page does not scroll, the sheet bar sits on the bottom edge, the map ends where the sheet begins, the toolbar ends
// inside the map and its last button can be scrolled into view above the sheet, and the half and full sheet heights fit.
// External hosts are blocked. Run from the repo root: node tests/phone_fit_smoke.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium, webkit } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try {
    let body = await readFile(join(root, path));
    // "?tallsvh": act like a browser whose 100svh is taller than the page's real box
    if (path === "index.html" && /tallsvh/.test(req.url)) body = body.toString().replace(/100svh/g, "calc(100svh + 80px)");
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
/* BROWSER=webkit runs it in WebKit, the engine of every iPhone browser (check-index.yml carry-webkit job) */
const browser = process.env.BROWSER === "webkit" ? await webkit.launch() : await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

for (const [w, h] of [[375, 667], [390, 664], [320, 568], [430, 932]]) for (const tall of [false, true]) {
  const tag = `${w}x${h}${tall ? " (tall 100svh)" : ""}`;
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + (tall ? "?tallsvh" : "") + "#timeline", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => document.documentElement.classList.contains("phone") && document.querySelectorAll("#tl-list .tlrow").length > 5, null, { timeout: 90000 });
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.hide(); });
  await p.waitForFunction(() => document.getElementById("atk-tools"), null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(800);
  const g = await p.evaluate(() => {
    const r = (e) => e && e.getBoundingClientRect(), map = r(document.getElementById("map")), rail = r(document.querySelector(".rail"));
    const tools = document.getElementById("atk-tools"), tr = r(tools);
    let last = null;
    const list = tools && tools.querySelector(".atk-list");
    if (list) { list.scrollTop = list.scrollHeight; const bs = [...list.children].filter((b) => b.tagName === "BUTTON" && b.offsetParent); last = r(bs[bs.length - 1]); }
    return { ih: innerHeight, docH: document.scrollingElement.scrollHeight, map: { t: map.top, b: map.bottom }, rail: { t: rail.top, b: rail.bottom },
      tools: tr && { t: tr.top, b: tr.bottom }, last: last && { t: last.top, b: last.bottom } };
  });
  ok(g.docH <= g.ih + 1, `${tag}: the page does not scroll (page ${g.docH} px, screen ${g.ih} px)`);
  ok(Math.abs(g.rail.b - g.ih) <= 1, `${tag}: the sheet bar sits on the bottom edge (${Math.round(g.rail.b)} of ${g.ih})`);
  ok(Math.abs(g.map.b - g.rail.t) <= 1, `${tag}: the map ends where the sheet begins (map ${Math.round(g.map.b)}, sheet ${Math.round(g.rail.t)})`);
  ok(g.tools && g.tools.b <= g.map.b + 1, `${tag}: the map toolbar ends inside the map (${g.tools && Math.round(g.tools.b)} <= ${Math.round(g.map.b)})`);
  ok(g.last && g.last.b <= g.rail.t + 1 && g.last.t >= g.map.t, `${tag}: the toolbar's last button scrolls into view above the sheet (${g.last && Math.round(g.last.b)} <= ${Math.round(g.rail.t)})`);
  for (const s of ["half", "full"]) {
    await p.evaluate((s) => document.documentElement.setAttribute("data-sheet", s), s); await p.waitForTimeout(350);
    const sh = await p.evaluate(() => { const b = document.querySelector(".rail").getBoundingClientRect(), hd = document.querySelector("header").getBoundingClientRect(); return { t: b.top, b: b.bottom, hb: hd.bottom }; });
    ok(Math.abs(sh.b - g.ih) <= 1 && sh.t >= sh.hb - 1, `${tag}: the ${s} sheet fits between the header and the bottom edge (${Math.round(sh.t)}..${Math.round(sh.b)}, header ends ${Math.round(sh.hb)})`);
  }
  if (process.env.SHOTS) { await p.evaluate(() => document.documentElement.setAttribute("data-sheet", "bar")); await p.waitForTimeout(300); await p.screenshot({ path: `${process.env.SHOTS}/fit-${w}x${h}${tall ? "-tall" : ""}.png` }); }
  ok(errors.length === 0, `${tag}: no page errors` + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? `${fails} FAILED` : "ALL PASS");
process.exit(fails ? 1 : 0);
