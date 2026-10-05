// Headless check that Today's daily summary (assets/osap-daily.js) uses the full width of a wide screen and keeps the phone
// layout. Checks on Thailand: on a 1900 px screen the summary box is not squeezed into a centred column (Top lines spans the
// box, the heading sits at the left), Key events is open and sits beside What to watch, and folding Key events holds across
// a redraw; on a 390 px phone Key events starts folded, the columns stack and nothing scrolls sideways. The page throws
// nothing. External hosts are blocked. Run from the repo root: node tests/today_width_smoke.mjs   (needs playwright and Chromium)
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

async function open(opts) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "today"); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#timeline", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.OSAP_TODAY && window.OSAP_DAILYQ && window.TSAP, null, { timeout: 60000 });
  await p.evaluate(() => { if (!window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.show(); });
  await p.waitForFunction(() => document.querySelectorAll("#td-daily .dlwbtn").length > 0, null, { timeout: 30000 });
  return { p, ctx, errors };
}
const geom = () => {
  const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width }; };
  const k = document.querySelector("#td-daily details.dlkev");
  return { box: r("#td-daily"), bluf: r("#td-daily .dlbluf"), h2: r("#td-daily .dlhead h2"), kev: r("#td-daily .dlcols > div:first-child"),
    watch: r("#td-daily .dlcols > div:last-child"), open: k ? k.open : null, sx: document.getElementById("today").scrollWidth - document.getElementById("today").clientWidth };
};

{
  const { p, ctx, errors } = await open({ viewport: { width: 1900, height: 900 } });
  const g = await p.evaluate(geom);
  ok(g.box.w > 1700, `summary box spans the screen (${Math.round(g.box.w)} px of 1900)`);
  ok(g.bluf && g.bluf.w > g.box.w * 0.9, `Top lines spans the box (${Math.round(g.bluf && g.bluf.w)} px)`);
  ok(g.h2.l - g.box.l < 40, "the heading sits at the left, not centred");
  ok(g.open === true, "Key events is open on a wide screen");
  ok(Math.abs(g.kev.t - g.watch.t) < 2 && g.watch.l > g.kev.l + g.kev.w - 2 && g.kev.w > 700, `Key events and What to watch sit side by side (${Math.round(g.kev.w)} | ${Math.round(g.watch.w)} px)`);
  await p.click("#td-daily details.dlkev > summary");
  const fp = await p.evaluateHandle(() => [...document.querySelectorAll("#td-daily .dlwbtn")].find((b) => /^Flashpoint/.test((b.querySelector(".dlfrom") || {}).textContent || "")));
  if (await fp.evaluate((b) => !!b)) { await fp.click(); await p.waitForTimeout(300); }
  ok(await p.evaluate(() => document.querySelector("#td-daily details.dlkev").open === false), "folding Key events holds after the summary redraws");
  if (process.env.SHOTS) { await p.click("#td-daily details.dlkev > summary"); await p.screenshot({ path: process.env.SHOTS + "/wide.png" }); }
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
{
  const { p, ctx, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const g = await p.evaluate(geom);
  ok(g.open === false, "Key events starts folded on a phone");
  ok(g.watch.t > g.kev.t + 10 && Math.abs(g.watch.l - g.kev.l) < 2, "the columns stack on a phone");
  ok(g.sx <= 1, `nothing scrolls sideways on a phone (${g.sx} px)`);
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + "/phone.png" });
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? `${fails} FAILED` : "ALL PASS");
process.exit(fails ? 1 : 0);
