// Headless check that tab content fits the phone sheet's width (16 Nov 2026 quality check). The page-wide "td{white-space:nowrap}"
// rule kept the UCDP event table of automatic conflict tabs (Iran, Venezuela...) on one line, 800 px wide in a 390 px sheet, so
// the deaths column was cut off; and the weather/hazards "Region" picker was 100% of its label plus the word "Region", 33 px too
// wide. The sheet hides sideways overflow (phone_sheet_sideways_smoke), so the cut-off part could not be reached at all.
// Checks, at 390 px with the sheet full: no element in the sheet ends past its right edge on those tabs, and the event table
// keeps its date and deaths columns on screen. External hosts are blocked. Run from the repo root: node tests/phone_rail_overflow_smoke.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium, webkit } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = process.env.BROWSER === "webkit" ? await webkit.launch() : await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
for (const [cc, view] of [["ir", "cf-auto-ir"], ["ph", "weather"], ["ph", "hazards"], ["ve", "cf-auto-ve"]]) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#" + cc + "/timeline", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => document.documentElement.classList.contains("phone") && document.querySelectorAll("#tl-list .tlrow").length > 0, null, { timeout: 90000 });
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.hide(); });
  const has = await p.waitForFunction((v) => document.querySelector('button[role=tab][data-view="' + v + '"]'), view, { timeout: 30000 }).then(() => true, () => false);
  ok(has, `${cc} ${view}: the tab exists`); if (!has) { await ctx.close(); continue; }
  await p.evaluate((v) => document.querySelector('button[role=tab][data-view="' + v + '"]').click(), view);
  await p.waitForTimeout(1500);
  await p.evaluate(() => document.documentElement.setAttribute("data-sheet", "full")); await p.waitForTimeout(400);
  const g = await p.evaluate(() => {
    const rail = document.querySelector(".rail"), rr = rail.getBoundingClientRect();
    const over = [...rail.querySelectorAll("*")].filter((e) => e.offsetParent && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().right > rr.right + 2)
      .map((e) => e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.split(" ")[0] : "") + " ends " + Math.round(e.getBoundingClientRect().right));
    const ev = rail.querySelector("table.cfev tr"), cells = ev ? [...ev.children].map((td) => td.getBoundingClientRect()) : null;
    return { sw: rail.scrollWidth, cw: rail.clientWidth, right: Math.round(rr.right), over: over.slice(0, 4), cells: cells && cells.map((c) => [Math.round(c.left), Math.round(c.right)]) };
  });
  ok(g.sw <= g.cw + 2 && !g.over.length, `${cc} ${view}: everything fits the ${g.cw} px sheet (content ${g.sw} px${g.over.length ? "; " + g.over.join(", ") : ""})`);
  if (/^cf-auto/.test(view)) ok(g.cells && g.cells.length === 3 && g.cells[2][1] <= g.right + 1, `${cc} ${view}: the UCDP event table's deaths column is on screen (${JSON.stringify(g.cells)})`);
  ok(!errors.length, `${cc} ${view}: no page errors` + (errors.length ? ": " + errors[0] : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
