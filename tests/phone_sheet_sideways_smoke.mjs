// Headless check that the phone bottom sheet (the side panel on a 390 px phone) only scrolls up and down. Shane saw the
// Master timeline sheet slide left and right on iPhone Safari while scrolling, cutting off the start of each line: the
// timeline's SHA-256 build fingerprint is one unbroken word wider than the screen, so the sheet could scroll sideways.
// Checks on Thailand, with the sheet at full height, for every tab: nothing in the sheet is wider than it, the sheet
// clips sideways overflow and takes vertical pans only, and a sideways scroll from script is put straight back.
// The page throws nothing. External hosts are blocked. Run from the repo root: node tests/phone_sheet_sideways_smoke.mjs
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

const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#timeline", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => document.documentElement.classList.contains("phone") && document.querySelectorAll("#tl-list .tlrow").length > 5, null, { timeout: 90000 });
// the fingerprint line is written once the hash is computed; it is the line that used to overflow
await p.waitForFunction(() => /[0-9a-f]{64}/.test(document.getElementById("tl-built").textContent), null, { timeout: 30000 }).catch(() => {});
await p.evaluate(() => document.documentElement.setAttribute("data-sheet", "full"));
await p.waitForTimeout(500);

const style = await p.evaluate(() => { const cs = getComputedStyle(document.querySelector(".rail")); return { ox: cs.overflowX, oy: cs.overflowY, ta: cs.touchAction }; });
ok(style.ox === "hidden" && style.oy === "auto", `the sheet clips sideways and scrolls up and down (overflow-x ${style.ox}, overflow-y ${style.oy})`);
ok(/pan-y/.test(style.ta) && !/pan-x/.test(style.ta) && style.ta !== "auto", `the sheet takes vertical pans only (touch-action ${style.ta})`);
ok(await p.evaluate(() => /[0-9a-f]{64}/.test(document.getElementById("tl-built").textContent)), "the build fingerprint line is shown");

const views = await p.evaluate(() => [...document.querySelectorAll("#view-seg button[data-view]")].map((b) => b.getAttribute("data-view")));
const wide = [];
for (const v of views) {
  await p.evaluate((v) => document.querySelector('#view-seg button[data-view="' + v + '"]').click(), v);
  await p.waitForTimeout(400);
  const r = await p.evaluate(() => { const rail = document.querySelector(".rail"); return rail.scrollWidth - rail.clientWidth; });
  if (r > 1) wide.push(v + " +" + r + " px");
}
ok(wide.length === 0, `nothing in the sheet is wider than it, on any of ${views.length} tabs` + (wide.length ? ": " + wide.join(", ") : ""));

await p.evaluate(() => document.querySelector('#view-seg button[data-view="timeline"]').click());
await p.waitForTimeout(300);
const back = await p.evaluate(async () => {
  const rail = document.querySelector(".rail"), sp = document.createElement("div");
  sp.style.width = "900px"; sp.style.height = "1px"; rail.appendChild(sp);   // force something wide, then scroll sideways from script
  rail.scrollLeft = 120; await new Promise((r) => setTimeout(r, 100));
  const sl = rail.scrollLeft; sp.remove(); return sl;
});
ok(back === 0, `a sideways scroll is put straight back (scrollLeft ${back})`);
// a mostly vertical swipe with some sideways drift moves the list down, never across (Today, which opens over the page on
// start, is closed first so the finger lands on the sheet)
await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.hide(); document.querySelector(".rail").scrollTop = 0; });
await p.waitForTimeout(300);
const sw = await p.evaluate(() => { const b = document.querySelector(".rail").getBoundingClientRect(), x = Math.round(b.left + b.width / 2), y = Math.round(b.top + b.height * 0.8);
  return { x, y, onSheet: document.querySelector(".rail").contains(document.elementFromPoint(x, y)) }; });
ok(sw.onSheet, "the swipe starts on the sheet");
const cdp = await ctx.newCDPSession(p);
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: sw.x, y: sw.y }] });
for (let i = 1; i <= 12; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: sw.x - 80 * i / 12, y: sw.y - 300 * i / 12 }] });
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await p.waitForTimeout(500);
const after = await p.evaluate(() => { const rail = document.querySelector(".rail"); return { top: rail.scrollTop, left: rail.scrollLeft }; });
ok(after.top > 50 && after.left === 0, `a slanted swipe scrolls the list down, not sideways (down ${Math.round(after.top)} px, across ${after.left} px)`);
if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + "/phone-sheet.png" });
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close(); server.close();
console.log(fails ? `${fails} FAILED` : "ALL PASS");
process.exit(fails ? 1 : 0);
