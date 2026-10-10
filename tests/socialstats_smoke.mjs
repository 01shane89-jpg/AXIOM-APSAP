// Headless check of the Social media view's "By platform" and "Replies" tabs (assets/osap-socialstats.js): the tabs show, the
// platform table counts the kept posts per platform, the Replies tab reads data/live/replies/<cc>.js (a fixture here) and shows
// tone, themes and words, and never an author handle. Run from the repo root: node tests/socialstats_smoke.mjs (OUT=dir saves screenshots)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const OUT = process.env.OUT || "";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();
const FIX = { asof: "2026-10-10 02:30Z", method: "osap-replies/1", source: "Bluesky public replies",
  posts: [{ link: "https://bsky.app/profile/apnews.com/post/3abc", account: "apnews.com", date: "2026-10-10T01:00", title: "Floods hit northern Thailand", replies: 42, likes: 120, reposts: 30, quotes: 2,
    a: { read: 30, scored: 28, tone: { positive: 6, neutral: 10, negative: 12 }, themes: { concern: 9, sympathy: 7, question: 4 }, langs: { en: 28, th: 2 }, terms: [["flood", 8], ["rain", 4]] } }],
  totals: { posts: 1, replies: 42, read: 30, scored: 28, likes: 120, reposts: 30, quotes: 2, tone: { positive: 6, neutral: 10, negative: 12 }, themes: { concern: 9, sympathy: 7, question: 4 }, terms: [["flood", 8], ["rain", 4]] } };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  if (path === "data/live/replies/th.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); return res.end('window.OSAP_REPLIES=window.OSAP_REPLIES||{};window.OSAP_REPLIES["th"]=' + JSON.stringify(FIX) + ";"); }
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
for (const vp of [{ width: 1400, height: 900 }, { width: 390, height: 844 }]) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: vp });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.TSAP.setView && window.OSAP_SOCSTATS, null, { timeout: 60000 });
  await p.waitForTimeout(3000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  await p.evaluate(() => window.TSAP.setView("social")); await p.waitForTimeout(1500);
  const tabs = await p.evaluate(() => Array.from(document.querySelectorAll("#sstabs [data-sstab]")).map((b) => b.textContent));
  ok(tabs.join("|") === "Posts|By platform|Replies", `${vp.width}px: tabs ${tabs.join("|")}`);
  ok(await p.evaluate(() => !document.querySelector('[data-sspane="posts"]').hidden && !!document.querySelector('[data-sspane="posts"] .tllist')), "Posts tab shows the post list first");
  await p.evaluate(() => document.querySelector('[data-sstab="plat"]').click()); await p.waitForTimeout(300);
  const plat = await p.evaluate(() => {
    const pane = document.querySelector('[data-sspane="plat"]');
    const kept = window.OSAP_SOCSTATS._test.posts("th"), S = window.OSAP_SOCSTATS._test.stats(kept, Date.now());
    return { shown: !pane.hidden, text: pane.innerText, rows: pane.querySelectorAll(".sstable .ssrow").length, all: S.reduce((a, s) => a + s.all, 0), kept: kept.length,
      wide: pane.scrollWidth <= pane.clientWidth + 1 };
  });
  ok(plat.shown && plat.rows === 4, `By platform: table with 3 platform rows (${plat.rows - 1})`);
  ok(plat.all > 0 && plat.all <= plat.kept, `By platform: counts ${plat.all} of ${plat.kept} kept posts`);
  ok(/YouTube Data API key/.test(plat.text) && /X \(Twitter\)/.test(plat.text), "By platform: says which platforms and comments are not read");
  ok(plat.wide, "By platform: no sideways scroll");
  if (OUT) await p.screenshot({ path: `${OUT}/plat-${vp.width}.png` });
  await p.evaluate(() => document.querySelector('[data-sstab="rep"]').click()); await p.waitForTimeout(800);
  const rep = await p.evaluate(() => { const pane = document.querySelector('[data-sspane="rep"]'); return { text: pane.innerText, terms: pane.querySelectorAll(".ssterm").length, rows: pane.querySelectorAll(".ssrep").length, wide: pane.scrollWidth <= pane.clientWidth + 1 }; });
  ok(/Tone/.test(rep.text) && /Fear or concern/.test(rep.text) && rep.terms === 2 && rep.rows === 1, "Replies: tone, themes, words and the post");
  ok(/not AI/.test(rep.text) && /No names, handles or reply text/.test(rep.text), "Replies: says word lists, not AI, and no names kept");
  ok(rep.wide, "Replies: no sideways scroll");
  if (OUT) await p.locator('[data-sspane="rep"]').screenshot({ path: `${OUT}/rep-${vp.width}.png` });
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join("; ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("socialstats smoke: ok");
