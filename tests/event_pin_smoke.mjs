// Headless check of where grouped events and news reports are pinned (index.html), on North Korea's tab with South Korea's
// reports joining its events: an event is never pinned at a neighbour's report (a Seoul-filed report grouped with a Yongbyon
// story put the event pin in Seoul), no news report is placed at a country's name (a Wonsan record filed under "North Korea"
// pinned every headline naming North Korea at Wonsan), and on South Korea's and the Philippines' tabs none is placed only by its wire dateline ("SEOUL, Sept. 30 (Yonhap) --").
// Run from the repo root: node tests/event_pin_smoke.mjs   (needs the playwright package and Chromium)
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

const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("asap-period", JSON.stringify({ p: "all" })); } catch (e) {} });
let p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
const ready = () => p.waitForFunction(() => window.TSAP && window.TSAP.areaApi && window.TSAP.areaApi.events, null, { timeout: 60000 });
await p.goto(base + "#kp/timeline", { waitUntil: "domcontentloaded" }); await ready();
// the neighbours' reports come from hidden copies of the page; wait for South Korea's, then reload so events are built with them
const got = await p.waitForFunction(() => { try { return !!localStorage.getItem("asap-xrecs-kr"); } catch (e) { return false; } }, null, { timeout: 240000 }).then(() => true, () => false);
ok(got, "South Korea's reports reached North Korea's tab");
await p.reload({ waitUntil: "domcontentloaded" }); await ready(); await p.waitForTimeout(3000);
const evCheck = () => p.evaluate(() => {
  const evs = window.TSAP.areaApi.events();
  return { events: evs.length, cross: evs.filter((v) => v.xcc.length).length, atNeighbour: evs.filter((v) => v.loc && v.loc.xcc).map((v) => v.head.title) };
});
const newsCheck = () => p.evaluate(() => {
  const A = window.TSAP.areaApi, cn = new Set(window.OSAP_COUNTRIES.map((c) => c.name.toLowerCase()));
  const dl = /^\s*\p{Lu}[\p{Lu} .'-]{2,30}(?:,[^\n\u2013\u2014-]{0,30})?\s*(?:\([^()]{2,20}\))?\s*(?:--|[\u2013\u2014-])|\([^()=\n]{2,40}=[^()=\n]{2,40}\)/u;
  const news = A.records().filter((x) => x.news && x.place);
  return {
    placed: news.length,
    atCountry: news.filter((x) => cn.has(String(x.place).toLowerCase())).map((x) => x.title),
    atDateline: news.filter((x) => { const t = (x.title + "\n" + (x.detail || "")).split("\n"), n = String(x.place).toLowerCase();
      const body = t.map((s) => s.replace(dl, "")).join(" ").toLowerCase(); return t.some((s) => (s.match(dl) || [""])[0].toLowerCase().includes(n)) && !body.includes(n); }).map((x) => x.title),
  };
});
const e = await evCheck();
console.log("North Korea: events", e.events, "with South Korean reports", e.cross);
ok(e.atNeighbour.length === 0, "no event pinned at a neighbour's report" + (e.atNeighbour.length ? ": " + e.atNeighbour.slice(0, 3).join(" | ") : ""));
for (const cc of ["kr", "ph"]) {
  await p.close(); p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#" + cc + "/timeline", { waitUntil: "domcontentloaded" }); await ready(); await p.waitForTimeout(2000);
  const n = await newsCheck();
  console.log(cc + ": news reports placed", n.placed);
  ok(n.atCountry.length === 0, cc + ": no news report placed at a country's name" + (n.atCountry.length ? ": " + n.atCountry.slice(0, 3).join(" | ") : ""));
  ok(n.atDateline.length === 0, cc + ": no news report placed only by its dateline" + (n.atDateline.length ? ": " + n.atDateline.slice(0, 3).join(" | ") : ""));
}
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 2).join(" | ") : ""));
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
