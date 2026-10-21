// Headless check that a US state's view shows its outlets' earlier items (data/history/us-states/<st>.js, tools/history.mjs)
// beside the latest ones, one copy per link, marked with the state; and that a state with no history file still opens.
// Run from the repo root: node tests/state_history_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();
const now = new Date(Date.now() - 3600e3).toISOString().slice(0, 16), old = new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 16);
const item = (n, d) => ({ title: "Police investigate shooting in Kansas City, Missouri " + n, summary: "", date: d, link: "https://example.org/mo-" + n, outlet: "Test Outlet", lang: "en", via: "RSS",
  geo: { n: "Kansas City", la: 39.0997, lo: -94.5786, p: "approx" } });
const FAKE = {
  "data/live/news/us-states/mo.js": "window.ASAP_NEWS_ST=" + JSON.stringify({ asof: now.replace("T", " ") + "Z", st: "MO", sources: [], items: [item(1, now), item(2, now)] }) + ";",
  "data/history/us-states/mo.js": "window.ASAP_HIST_ST=" + JSON.stringify({ st: "MO", updated: now, news: [item(2, now), item(3, old), item(4, old)] }) + ";",
};
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  if (FAKE[path]) { res.writeHead(200, { "Content-Type": "text/javascript" }); return res.end(FAKE[path]); }
  if (/^data[/\\]history[/\\]us-states[/\\]/.test(path)) { res.writeHead(404); return res.end(); }
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
async function open(st) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: "block" });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const errors = []; const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "?st=" + st + "#us/"); await p.waitForTimeout(5000);
  return { ctx, p, errors };
}
{
  const { ctx, p, errors } = await open("MO");
  const r = await p.evaluate(() => (window.TSAP && window.TSAP.records || []).filter((x) => x.layer === "news" && /example\.org\/mo-/.test(x.url)).map((x) => ({ u: x.url, st: x.st })));
  const urls = r.map((x) => x.u).sort();
  ok(JSON.stringify(urls) === JSON.stringify([1, 2, 3, 4].map((n) => "https://example.org/mo-" + n)), "Missouri: latest + earlier items, one copy per link: " + urls.join(" "));
  ok(r.every((x) => x.st === "MO"), "every state item is marked MO");
  ok(!errors.length, "no page errors: " + errors.join(" | "));
  await ctx.close();
}
{
  const { ctx, p, errors } = await open("KS");
  ok(await p.evaluate(() => !!(window.TSAP && window.TSAP.country === "us")), "Kansas (no history file) opens");
  ok(!errors.length, "no page errors: " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("state history smoke passed");
