// Headless check of news search on Today (assets/osap-news.js) on a stand-in index whose newest "days" are misdated feed rows,
// as on 2026-11-18 (EBC rows dated 11 Dec, El Nacional 3 Dec, an NHC note 19 Nov): the first search skips days after
// tomorrow, reads tomorrow without counting it, and covers today and the two days before, so "outage" in the United States
// finds the FAA and United stories; today holding only a few headlines (the index a few hours behind) does not shorten it;
// "Search older days" and "Search every country" widen it; World (nothing is filed under it) searches every country at once; a day file after tomorrow is never asked for.
// Run from the repo root: node tests/news_search_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves a screenshot)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const OUT = process.env.OUT || "";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const at = (n, hh) => day(n) + "T" + hh;
const row = (cc, d, title, outlet, link) => [cc, d, title, "", outlet, "https://e.x/" + link, "", "", "", ""];
const DAYS = {
  [day(23)]: Array.from({ length: 10 }, (_, i) => row("et", at(23, "00:00"), "Police return to work in Mekele " + i, "EBC", "ebc" + i)),
  [day(15)]: [row("py", at(15, "10:10"), "Outage at the photobook fair", "El Nacional", "py")],
  [day(1)]: [row("", at(1, "11:27"), "There are no tropical cyclones at this time.", "NHC Central Pacific", "nhc")],
  [day(0)]: [row("us", at(0, "00:05"), "Chase app outage leaves customers locked out", "CBS News", "chase"), row("gb", at(0, "00:01"), "Police attend crash", "BBC", "bbc")],
  [day(-1)]: [row("us", at(-1, "20:00"), "United Airlines resolves widespread system outage", "Axios", "united"), row("fr", at(-1, "10:00"), "Panne géante : outage hits Orange network", "Le Monde", "orange")],
  [day(-2)]: [row("us", at(-2, "18:00"), "FAA lifts nationwide ground stop after telecommunications outage", "UPI", "faa")],
  [day(-3)]: [row("us", at(-3, "09:00"), "Microsoft outage disrupts airline check-in", "The Independent", "msft")],
  [day(-4)]: [row("us", at(-4, "09:00"), "Power outage hits Texas after storm", "AP", "texas")],
};
const MAN = { asof: new Date().toISOString().slice(0, 16).replace("T", " ") + "Z",
  days: Object.keys(DAYS).sort().reverse().map((d) => ({ d, n: DAYS[d].length })),
  fields: ["cc", "date", "title", "orig", "outlet", "link", "summary", "flags", "topics", "views"], flags: {}, topics: [], views: [], relevance: { kept: 10, left_out: 0 } };
const asked = [];
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  if (path === "data/live/news-index.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); return res.end("window.OSAP_NEWSIX=" + JSON.stringify(MAN) + ";"); }
  const m = path.match(/^data\/live\/news-index\/(\d{4}-\d{2}-\d{2})\.js$/);
  if (m) { asked.push(m[1]); if (!DAYS[m[1]]) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": "text/javascript" });
    return res.end("window.OSAP_NEWSIX_DAY=window.OSAP_NEWSIX_DAY||{};window.OSAP_NEWSIX_DAY[" + JSON.stringify(m[1]) + "]=" + JSON.stringify(DAYS[m[1]]) + ";"); }
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await ctx.addInitScript(() => { try { if (!sessionStorage.getItem("t-init")) { sessionStorage.setItem("t-init", "1"); localStorage.setItem("osap-home", "today"); } } catch (e) {} });
const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message)); p.on("dialog", (d) => d.accept());
await p.goto(base, { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.OSAP_TODAY && window.OSAP_NEWSQ, null, { timeout: 60000 }); await p.waitForTimeout(2500);
await p.evaluate(() => { if (!window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.show(); }); await p.waitForTimeout(800);
const hasUS = await p.evaluate(() => !!document.querySelector('#td-cc option[value="us"]'));
ok(hasUS, "Today lists the United States");
await p.selectOption("#td-cc", "us"); await p.waitForTimeout(1200);
await p.waitForSelector("#nq-q", { timeout: 10000 });
await p.fill("#nq-q", "outage"); await p.press("#nq-q", "Enter");
await p.waitForFunction(() => /Searched \d+ of \d+ days/.test((document.querySelector(".nqobs") || {}).textContent || "") && !/reading the next day/.test(document.querySelector(".nqobs").textContent), null, { timeout: 20000 }).catch(() => {});
const read = async () => p.evaluate(() => ({ stat: (document.querySelector(".nqstat") || {}).textContent || "", heads: [...document.querySelectorAll(".nqrow .nqh")].map((a) => a.textContent), older: ((document.querySelector('[data-nq="older"]') || {}).textContent) || "" }));
let R = await read();
ok(/Searched 3 of 5 days/.test(R.stat), "the first search counts today and the two days before, of the 5 real days: " + R.stat);
ok(R.heads.length === 3 && /Chase/.test(R.heads[0]) && R.heads.some((h) => /United/.test(h)) && R.heads.some((h) => /FAA/.test(h)), '"outage" in the United States finds Chase, United and FAA: ' + JSON.stringify(R.heads));
ok(!asked.includes(day(23)) && !asked.includes(day(15)), "the misdated day files after tomorrow are never asked for: " + asked.join(","));
ok(asked.includes(day(1)), "tomorrow (a feed's local time read as UTC) is read");
ok(/Search older days \(2 more\)/.test(R.older), "Search older days offers the 2 left: " + R.older);
if (OUT) await p.screenshot({ path: OUT + "/news-search-us-outage.png", fullPage: false });
await p.click('[data-nq="older"]'); await p.waitForTimeout(1500); R = await read();
ok(R.heads.length === 5 && /Searched 5 of 5 days/.test(R.stat), "older days add Microsoft and Texas: " + R.heads.length + " " + R.stat);
await p.click('[data-nq="all"]'); await p.waitForTimeout(500); R = await read();
ok(R.heads.length === 6 && R.heads.some((h) => /Orange/.test(h)) && !R.heads.some((h) => /photobook/.test(h)), "every country adds the French story, never the misdated one: " + R.heads.length);
/* World (ww) has no headlines filed under it: a search there covers every country without a tap, and offers no "Only World"
   (picking a country reloads the page, so the words are typed again) */
ok(await p.evaluate(() => !!document.querySelector('#td-cc option[value="ww"]')), "Today lists World");
await p.selectOption("#td-cc", "ww");
await p.waitForFunction(() => window.OSAP_TODAY && window.OSAP_NEWSQ && document.querySelector("#nq-q"), null, { timeout: 60000 }); await p.waitForTimeout(1500);
await p.fill("#nq-q", "outage"); await p.press("#nq-q", "Enter");
await p.waitForFunction(() => /Searched \d+ of \d+ days/.test((document.querySelector(".nqobs") || {}).textContent || "") && !/reading the next day/.test(document.querySelector(".nqobs").textContent), null, { timeout: 20000 }).catch(() => {});
R = await read();
const toggles = await p.evaluate(() => document.querySelectorAll('[data-nq="here"],[data-nq="all"]').length);
ok(R.heads.length === 4 && R.heads.some((h) => /Orange/.test(h)) && /from every country/.test(R.stat), "World searches every country at once (3 days: Chase, United, Orange, FAA): " + R.heads.length + " " + R.stat);
ok(toggles === 0, "World offers no Only World / Search every country toggle: " + toggles);
if (OUT) await p.screenshot({ path: OUT + "/news-search-world-outage.png", fullPage: false });
ok(!errors.length, "no page errors " + JSON.stringify(errors));
await browser.close(); server.close();
if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("news search smoke ok");
