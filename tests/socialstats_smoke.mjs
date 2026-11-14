// Headless check of the Social media view's "By platform", "Replies" and "Public pulse" tabs (assets/osap-socialstats.js): the tabs show, the
// platform table counts the kept posts per platform, the Replies tab reads data/live/replies/<cc>.js (a fixture here) and shows
// tone, themes and words, and never an author handle. Run from the repo root: node tests/socialstats_smoke.mjs (OUT=dir saves screenshots)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
import { summarise } from "../tools/social_pulse.mjs";
const OUT = process.env.OUT || "";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();
const FIX = { asof: "2026-10-10 02:30Z", method: "osap-replies/1", source: "Bluesky public replies",
  posts: [{ link: "https://bsky.app/profile/apnews.com/post/3abc", account: "apnews.com", date: "2026-10-10T01:00", title: "Floods hit northern Thailand", replies: 42, likes: 120, reposts: 30, quotes: 2,
    a: { read: 30, scored: 28, tone: { positive: 6, neutral: 10, negative: 12 }, themes: { concern: 9, sympathy: 7, question: 4 }, langs: { en: 28, th: 2 }, terms: [["flood", 8], ["rain", 4]] } }],
  totals: { posts: 1, replies: 42, read: 30, scored: 28, likes: 120, reposts: 30, quotes: 2, tone: { positive: 6, neutral: 10, negative: 12 }, themes: { concern: 9, sympathy: 7, question: 4 }, terms: [["flood", 8], ["rain", 4]] } };
// Public pulse fixture: a week of quiet hours, then a busy hour now (built with the tool's own summary rules)
const NOW = Date.now(), hourOf = (ms) => new Date(ms).toISOString().slice(0, 13), HOURS = [];
for (let k = 150; k >= 1; k--) HOURS.push({ h: hourOf(NOW - k * 36e5), n: 2, s: { Bluesky: 10000 }, m: 4, tone: [0, 2, 0], ind: {}, lang: { en: 2 }, np: { Bluesky: 2 }, tags: {}, terms: {}, cities: {} });
HOURS.push({ h: hourOf(NOW), n: 40, s: { Bluesky: 10000, Mastodon: 900 }, m: 4, tone: [1, 10, 29], ind: { protest: 20, curfew: 6 }, lang: { en: 30, th: 10 }, np: { Bluesky: 36, Mastodon: 4 },
  tags: { floodrelief: 12 }, terms: { curfew: 6 }, cities: { "Chiang Mai": 5 } });
const PULSE = { asof: "2026-11-14 16:30Z", method: "osap-pulse/1", summary: summarise(HOURS, NOW), hours: HOURS };
const PIDX = { asof: "2026-11-14 16:30Z", method: "osap-pulse/1", minutes: 4, sampled: { Bluesky: 10000, Mastodon: 900 }, sources: [{ name: "Bluesky Jetstream (jetstream2.us-east.bsky.network)", ok: true, posts: 10000 }, { name: "Mastodon mas.to", ok: false, posts: 0, err: "HTTP 401" }], terms: "Aggregate counts only.", areas: {} };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  if (path === "data/live/replies/th.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); return res.end('window.OSAP_REPLIES=window.OSAP_REPLIES||{};window.OSAP_REPLIES["th"]=' + JSON.stringify(FIX) + ";"); }
  if (path === "data/live/pulse/th.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); return res.end('window.OSAP_PULSE=window.OSAP_PULSE||{};window.OSAP_PULSE["th"]=' + JSON.stringify(PULSE) + ";"); }
  if (path === "data/live/pulse.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); return res.end("window.OSAP_PULSE_INDEX=" + JSON.stringify(PIDX) + ";"); }
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
  ok(tabs.join("|") === "Posts|By platform|Replies|Public pulse", `${vp.width}px: tabs ${tabs.join("|")}`);
  ok(await p.evaluate(() => !document.querySelector('[data-sspane="posts"]').hidden && !!document.querySelector('[data-sspane="posts"] .tllist')), "Posts tab shows the post list first");
  await p.evaluate(() => document.querySelector('[data-sstab="plat"]').click()); await p.waitForTimeout(300);
  const plat = await p.evaluate(() => {
    const pane = document.querySelector('[data-sspane="plat"]');
    const kept = window.OSAP_SOCSTATS._test.posts("th"), S = window.OSAP_SOCSTATS._test.stats(kept, Date.now());
    return { shown: !pane.hidden, text: pane.innerText, rows: pane.querySelectorAll(".sstable .ssrow").length, all: S.reduce((a, s) => a + s.all, 0), kept: kept.length,
      wide: pane.scrollWidth <= pane.clientWidth + 1 };
  });
  ok(plat.shown && plat.rows === 5, `By platform: table with 4 platform rows (Bluesky, Telegram, Mastodon, YouTube) (${plat.rows - 1})`);
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
  await p.evaluate(() => document.querySelector('[data-sstab="pulse"]').click()); await p.waitForTimeout(1000);
  const pu = await p.evaluate(() => { const pane = document.querySelector('[data-sspane="pulse"]'); return { shown: !pane.hidden, text: pane.innerText, bars: pane.querySelectorAll(".sspulse rect").length, wide: pane.scrollWidth <= pane.clientWidth + 1 }; });
  ok(pu.shown && /SPIKE/.test(pu.text) && /vs normal/.test(pu.text), "Public pulse: volume against the 7-day normal, with the spike flag");
  ok(pu.bars >= 150, `Public pulse: hourly volume chart (${pu.bars} bars)`);
  ok(/Protests and demonstrations/.test(pu.text) && /Curfews/.test(pu.text) && /UP/.test(pu.text) && /Chiang Mai/.test(pu.text), "Public pulse: unrest and safety indicators, UP flags and towns");
  ok(/#floodrelief/.test(pu.text) && /Rising/.test(pu.text), "Public pulse: rising hashtags");
  ok(/not AI/.test(pu.text) && /no names, handles, links or post text/.test(pu.text) && /FAILED/.test(pu.text), "Public pulse: says word lists, no names kept, and which source failed");
  ok(pu.wide, "Public pulse: no sideways scroll");
  if (OUT) await p.locator('[data-sspane="pulse"]').screenshot({ path: `${OUT}/pulse-${vp.width}.png` });
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join("; ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("socialstats smoke: ok");
