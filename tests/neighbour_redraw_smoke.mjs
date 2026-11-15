// Neighbour checks and the screen: a fresh open lands on Today (assets/osap-today.js), and some seconds later the hidden
// neighbour checks (index.html wScanAll, one ?watchscan=1 copy of the page per neighbour) bring in the neighbours' reports.
// Each one used to redraw the timeline and the report list hidden behind Today on arrival (five redraws for Thailand, about
// 0.7-1.5 s each on a phone, 15 Nov 2026). Now the round's reports are drawn once, behind Today at a quiet moment, and a check
// waits while someone is using the screen. Checked: every neighbour is checked and kept; while Today is open the timeline
// behind it is redrawn at most twice in the whole round; after Today closes the timeline shows the cross-border reports and
// the grouping finds cross-border events; a person scrolling all through the round still gets neighbours checked (one at least every 20 s or so); no errors.
// Run from the repo root: node tests/neighbour_redraw_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream", "Cache-Control": "max-age=600" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const NB = ["kh", "la", "mm", "my", "vn"];
async function run(scroll) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: "block" });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  /* count the timeline redraws behind Today: render() empties #tl-list, then fills it */
  await ctx.addInitScript(() => {
    if (window.top !== window) return;
    window.__redraws = 0;
    document.addEventListener("DOMContentLoaded", () => {
      const l = document.getElementById("tl-list"); if (!l) return;
      new MutationObserver((ms) => { if (ms.some((m) => m.removedNodes.length > 20) && window.OSAP_TODAY && window.OSAP_TODAY.isOpen() && window.__scanSeen) window.__redraws++; }).observe(l, { childList: true });
      new MutationObserver(() => { if (document.querySelector('iframe[title="watch check"]')) window.__scanSeen = true; }).observe(document.body, { childList: true });
    });
  });
  const p = await ctx.newPage(), errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(base);
  await p.waitForFunction(() => window.OSAP_TODAY && window.OSAP_TODAY.isOpen(), null, { timeout: 60000 });
  const t0 = Date.now(), keys = () => p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("asap-xrecs-")).map((k) => k.slice(11)).sort());
  let got = [];
  while (Date.now() - t0 < (scroll ? 75000 : 110000)) {
    if (scroll) { await p.mouse.move(700, 450); await p.mouse.wheel(0, 40); }
    await p.waitForTimeout(scroll ? 800 : 1000);
    got = await keys();
    if (NB.every((c) => got.includes(c)) && !(await p.$('iframe[title="watch check"]'))) break;
  }
  const tag = scroll ? "while scrolling: " : "";
  /* a check waits at most 20 s for a quiet moment (W_QUIET_MAX), so someone scrolling all along still gets them checked */
  if (scroll) ok(got.length >= 2, `${tag}neighbours still checked one by one (${got.join(",")} within 75 s)`);
  else ok(NB.every((c) => got.includes(c)), `every neighbour checked and kept (${got.join(",")})`);
  if (!scroll) {
    await p.waitForTimeout(6000);
    const n = await p.evaluate(() => window.__redraws);
    ok(n <= 2, `the timeline behind Today was redrawn ${n} time(s) for the whole round (at most 2)`);
    await p.evaluate(() => window.OSAP_TODAY.hide());
    await p.waitForTimeout(1500);
    const r = await p.evaluate(() => ({ xb: document.querySelectorAll("#tl-list .chip.evxb").length, ev: window.OSAP_EVENTS.list().filter((e) => e.crossBorder).length }));
    ok(r.xb > 0, `after Today closes the timeline shows cross-border reports (${r.xb})`);
    ok(r.ev > 0, `the grouping finds cross-border events (${r.ev})`);
  }
  ok(!errs.length, tag + "no page errors " + errs.join("; "));
  await ctx.close();
}
await run(false);
await run(true);
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
