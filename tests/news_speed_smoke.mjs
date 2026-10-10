// News tab speed: Thailand's News tab with the whole period (the default) must draw its Top stories within BUDGET ms of
// being opened once the 12-month history has arrived. Top stories used to compare every headline with every other one,
// twice per draw: about 50 s on a desktop for Thailand, many times that on a phone.
// Run from the repo root: node tests/news_speed_smoke.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const BUDGET = +(process.env.BUDGET || 8000);
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
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: "block" });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", '"map"'); localStorage.setItem("asap-period", JSON.stringify({ p: "all" })); } catch (e) {} });
const p = await ctx.newPage(), errs = [];
p.on("pageerror", (e) => errs.push(e.message));
await p.goto(base + "#timeline");
await p.waitForFunction(() => window.ASAP_HIST && window.ASAP_HIST.th && window.TSAP && window.TSAP.records.length, null, { timeout: 90000 });
await p.waitForTimeout(3000);
const r = await p.evaluate(() => {
  const n = window.TSAP.records.filter((x) => x.news).length, t0 = performance.now();
  window.TSAP.setView("news");
  return { n, ms: Math.round(performance.now() - t0), top: !!document.getElementById("news-top"), stories: document.querySelectorAll("#news-top li, #news-top .ntop, #news-top article").length };
});
ok(r.n > 1000, `Thailand has ${r.n} news records with the history loaded`);
ok(r.top, "Top stories drawn");
ok(r.ms <= BUDGET, `News tab drawn in ${r.ms} ms (budget ${BUDGET} ms)`);
ok(!errs.length, "no page errors " + errs.join("; "));
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
