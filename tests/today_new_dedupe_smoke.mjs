// Headless check that "New since your last visit" on Today and the "What's new" list (assets/osap-work.js) show one row per
// story. A feed headline is also filed under its topic layer (Transport, Politics, Flood...) as a record with its own key, so on
// 15 Nov 2026 the Today card listed "Two Planes Collide on a Taxiway at Miami International Airport" (NYT) twice and counted
// both. Checks on Thailand, whose live news carries such topic copies: with a last visit that held none of the live news, every
// story appears once on the card, the card's count equals the deduped list and the What's new count, and the count is below
// the raw record count; a story whose news copy was there on the last visit is not new through its topic copy; tracking codes
// and a closing slash do not split a link. The page throws nothing. External hosts are blocked.
// Run from the repo root: node tests/today_new_dedupe_smoke.mjs   (needs playwright and Chromium)
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

const ctx = await browser.newContext({ serviceWorkers: "block" });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "today"); } catch (e) {} });
const p0 = await ctx.newPage(); const errors = []; p0.on("pageerror", (e) => errors.push(e.message));
await p0.goto(base + "#timeline", { waitUntil: "domcontentloaded" });
await p0.waitForFunction(() => window.OSAP_TODAY && window.OSAP_WORK && window.OSAP_WORK.fresh && window.TSAP && window.TSAP.records.some((r) => r.news), null, { timeout: 60000 });
await p0.waitForTimeout(3000);

/* a last visit that held every record except the live feed items, and ended an hour ago */
const setup = await p0.evaluate(() => {
  const W = window.OSAP_WORK, R = window.TSAP.records, live = (r) => (r.live || r.news || r.social) && r.url;
  const keep = R.filter((r) => !live(r)).map(W.keyOf);
  const cc = Object.keys(localStorage).find((k) => /^osap-seen-/.test(k)).slice(10);
  const seen = JSON.stringify({ seen: keep, base: keep, baseAt: Date.now() - 36e5, lastAt: Date.now() - 36e5 });
  /* topic copies: one link held by a news record and a topic-layer record */
  const by = {}; R.filter(live).forEach((r) => { (by[r.url] = by[r.url] || []).push(r); });
  const pairs = Object.keys(by).filter((u) => by[u].some((r) => r.news) && by[u].some((r) => !r.news && r.layer !== "news"));
  return { cc, seen, pairs: pairs.length, raw: R.filter(live).length };
});
ok(setup.pairs > 0, `${setup.cc}: live news has headlines also filed under a topic layer (${setup.pairs})`);
/* the open page keeps writing its own record of what was seen, so the last visit is written by a fresh page before the app starts */
await p0.close();
const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
await p.addInitScript((a) => { if (!sessionStorage.getItem("t-set")) { sessionStorage.setItem("t-set", "1"); localStorage.setItem("osap-seen-" + a.cc, a.seen); } }, { cc: setup.cc, seen: setup.seen });
await p.goto(base + "#timeline", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.OSAP_TODAY && window.OSAP_WORK && window.OSAP_WORK.fresh && window.TSAP && window.TSAP.records.some((r) => r.news), null, { timeout: 60000 });
await p.waitForTimeout(3000);
await p.evaluate(() => { if (!window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.show(); });
await p.waitForFunction(() => [...document.querySelectorAll("#today .tdcard h2")].some((h) => /New since your last visit/.test(h.textContent)), null, { timeout: 30000 });
await p.waitForTimeout(1500);
const r = await p.evaluate((cc) => {
  const W = window.OSAP_WORK, R = window.TSAP.records, s = JSON.parse(localStorage.getItem("osap-seen-" + cc));
  const base = {}; s.base.forEach((k) => { base[k] = 1; });
  const F = W.fresh(R, base), urls = F.filter((x) => x.url).map((x) => x.url);
  const card = [...document.querySelectorAll("#today .tdcard")].find((c) => c.querySelector("h2") && /New since your last visit/.test(c.querySelector("h2").textContent));
  const rows = [...card.querySelectorAll(".tdrow")].map((b) => b.firstChild.textContent.trim());
  const cnt = +((card.querySelector(".tdcount") || {}).textContent || "").replace(/\D.*$/, "");
  const wn = document.querySelector("[data-wk-btn=new] .wkn");
  /* a story whose news copy was seen: mark one news record as seen, its topic copy must not stay new */
  const by = {}; R.filter((x) => x.live && x.url).forEach((x) => { (by[x.url] = by[x.url] || []).push(x); });
  const u = Object.keys(by).find((k) => by[k].some((x) => x.news) && by[k].some((x) => !x.news));
  const b2 = Object.assign({}, base); b2[W.keyOf(by[u].find((x) => x.news))] = 1;
  const after = W.fresh(R, b2).some((x) => x.url === u);
  /* link variants: the same item reached through a tagged link */
  const one = R.find((x) => x.news && x.url && !/\?/.test(x.url));
  const twin = Object.assign({}, one, { url: one.url.replace(/\/?$/, "/") + "?utm_source=rss&utm_medium=feed", layer: "transport", news: undefined });
  const variant = W.fresh([one, twin], {}).length;
  /* the same headline at another outlet's link (24 Nov 2026, two Malaysian outlets): one row, naming the other outlet */
  const o1 = Object.assign({}, one, { id: "t-a", url: "https://a.example/x", title: "18 locations identified: route, landing site of PATI in Kelantan", src: { name: "Outlet A" } });
  const o2 = Object.assign({}, one, { id: "t-b", url: "https://b.example/y", title: "18 Locations Identified Route, Landing Site Of PATI In Kelantan ", src: { name: "Outlet B" } });
  const T = W.fresh([o1, o2], {}), also = W.alsoOf ? W.alsoOf(T[0]) : [];
  const seenTitle = W.fresh([o1, o2], { [W.keyOf(o1)]: 1 }).length;
  /* untranslated items share a stand-in title; their own original wording decides */
  const u1 = Object.assign({}, o1, { title: "Thai report from Matichon, not translated yet", untr: true, orig: "ข่าวหนึ่ง" }), u2 = Object.assign({}, o2, { title: u1.title, untr: true, orig: "ข่าวสอง" });
  const untr = W.fresh([u1, u2], {}).length;
  const short = W.fresh([Object.assign({}, o1, { title: "Live updates" }), Object.assign({}, o2, { title: "Live updates" })], {}).length;
  const dupTitles = F.filter((x) => x.url).map((x) => String(x.untr ? x.orig : x.title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()).filter((t) => t.split(" ").length >= 4);
  return { rows, cnt, n: F.length, dupUrls: urls.length - new Set(urls).size, dupTitles: dupTitles.length - new Set(dupTitles).size, wn: wn ? +wn.textContent.replace(/\D/g, "") : 0, after, variant,
    title: { n: T.length, first: T[0] && T[0].id, also, seenTitle, short, untr } };
}, setup.cc);
ok(r.rows.length > 0 && new Set(r.rows).size === r.rows.length, `the card's rows are all different stories (${r.rows.length} rows)`);
ok(r.dupUrls === 0, `the new list holds each link once (${r.dupUrls} repeats)`);
ok(r.cnt === r.n, `the card counts the deduped list (${r.cnt} = ${r.n})`);
ok(r.n < setup.raw, `the deduped list is shorter than the raw live records (${r.n} < ${setup.raw})`);
ok(r.wn === Math.min(r.n, 999) || r.wn === 0, `the What's new count matches (${r.wn})`);
ok(!r.after, "a headline seen as news on the last visit is not new through its topic copy");
ok(r.variant === 1, "a link with tracking codes and a closing slash is the same story");
ok(r.dupTitles === 0, `the new list holds each headline once (${r.dupTitles} repeats)`);
ok(r.title.n === 1 && r.title.first === "t-a" && r.title.also.join() === "Outlet B", `the same headline at two outlets' links is one story, the first kept, naming the other (${JSON.stringify(r.title)})`);
ok(r.title.seenTitle === 0, "a headline seen at one outlet on the last visit is not new at another");
ok(r.title.short === 2, "short generic headlines (under four words) are not merged");
ok(r.title.untr === 2, "untranslated items with the same stand-in title but different originals stay apart");
ok(!errors.length, "the page throws nothing" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
