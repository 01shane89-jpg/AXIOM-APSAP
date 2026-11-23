// Fast news for the flash loop (tools/flash_news.mjs, tools/flash_feeds.json). Run from the repo root: node tests/flash_news.test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fastFeeds, wideFeeds, burstFeeds, PER_ROUND, toItem, finish, layNews, linksIn, nextGap, FastNews, UA, HOST_GAP, BURST_EVERY } from "../tools/flash_news.mjs";
import { loadRelevance } from "../tools/topics_lib.mjs";

let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

// ---------- the list: only feeds OSAP already reads ----------
const listed = JSON.parse(fs.readFileSync("tools/news_feeds.json", "utf8"));
const fast = JSON.parse(fs.readFileSync("tools/flash_feeds.json", "utf8")).feeds;
const got = fastFeeds(listed, fast);
ok(fast.length >= 20 && got.length === fast.length, `every fast feed is one of tools/news_feeds.json's own English RSS feeds (${got.length} of ${fast.length})`);
ok(new Set(fast).size === fast.length, "no feed listed twice");
ok(got.every((f) => !f.search && !f.html && /^en/.test(f.lang)), "no search, no web page, English only");
const fake = { feeds: [{ cc: "xx", outlet: "A", url: "https://a.test/rss", lang: "en" }, { cc: "xx", outlet: "B", url: "https://b.test/rss", lang: "en", search: true },
  { cc: "xx", outlet: "C", url: "https://c.test/rss", lang: "fr" }, { cc: "xx", outlet: "D", url: "https://d.test/rss", lang: "en" }], retired: [{ url: "https://d.test/rss" }] };
ok(fastFeeds(fake, ["https://a.test/rss", "https://b.test/rss", "https://c.test/rss", "https://d.test/rss", "https://new.test/rss"]).map((f) => f.outlet).join() === "A",
  "a search, a non-English feed, a retired feed and a URL news_feeds.json does not list are all dropped (the loop adds no sources)");
ok(burstFeeds(fake, "xx", new Set(["https://a.test/rss"])).length === 0, "a burst asks only the country's other plain English feeds, never a search or a retired one");

// ---------- items ----------
const now = Date.UTC(2026, 10, 23, 12, 0), f = { cc: "pk", outlet: "Dawn (Pakistan)", lang: "en" };
const R = await loadRelevance();
const raw = (title, minsAgo, link) => ({ title, summary: "", date: new Date(now - minsAgo * 6e4).toUTCString(), link });
ok(toItem({ title: "x", summary: "", date: "", link: "https://a.test/1" }, f, now) === null, "an undated item is left to the lane (it would look new on every poll)");
const it = finish(R, null, toItem(raw("Bomb blast kills five at police checkpoint in Peshawar", 3, "https://a.test/1"), f, now), "pk", now);
ok(it && it.via === "RSS" && it.title_en === it.title && it.mt === null && it.date === "2026-11-23T11:57", "an English item is made as the lane makes it (no translation needed)");
ok(it && !("summary" in it) && !("summary_en" in it), "the outlet's summary is dropped before anything is written");
ok(finish(R, null, toItem(raw("Bomb blast kills five in Peshawar", 4 * 60, "https://a.test/2"), f, now), "pk", now) === null, "an item older than 3 hours is the lane's");
ok(finish(R, null, toItem(raw("Bomb blast kills five in Peshawar", 90, "https://a.test/2"), f, now), "pk", now, 1) === null, "a burst keeps only the last hour");
ok(finish(R, null, toItem(raw("Celebrity wedding photos: the five best dresses of the season", 3, "https://a.test/3"), f, now), "pk", now) === null, "a lifestyle headline is left out by the relevance check");

// ---------- laying ----------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flashnews-")), file = path.join(dir, "pk.js");
fs.writeFileSync(file, "window.ASAP_NEWS=" + JSON.stringify({ asof: "2026-11-23 11:30Z", sources: [{ cc: "pk", source: "x" }], coverage: null,
  items: { pk: [{ title: "Older story about the budget debate in parliament", date: "2026-11-23T11:00", link: "https://www.b.test/9?utm_source=rss", outlet: "B" }] } }) + ";\n");
const dup = { ...it, link: "https://b.test/9", title: "Another headline" }, same = { ...it, link: "https://c.test/8", outlet: "C" };
const add = layNews("pk", [it, dup, same], file);
ok(add.length === 1 && add[0] === it, "a story the file holds (same article, or the same headline) is not laid again");
const bt = fs.readFileSync(file, "utf8"), back = JSON.parse(bt.slice(bt.indexOf("=") + 1).replace(/;\n$/, ""));
ok(back.items.pk[0].link === it.link && back.items.pk.length === 2 && back.sources.length === 1 && back.asof === "2026-11-23 11:30Z", "laid newest first; sources and asof are the lane's, untouched");
ok(layNews("pk", [it], file).length === 0, "laying the same item twice changes nothing (no push check for nothing)");
ok(linksIn("pk", file).has("a.test/1"), "linksIn finds the laid item by its story link");
ok(layNews("../x", [it], file).length === 0, "a bad country code is never a path");

// ---------- politeness ----------
ok(nextGap(60, NaN, 0) === 60e3 && nextGap(60, 30, 0) === 60e3, "at most once a minute, even when the feed allows more");
ok(nextGap(60, 1200, 0) === 300e3 && nextGap(60, 200, 0) === 200e3, "a feed's own max-age is kept, up to 5 minutes");
ok(nextGap(60, NaN, 2) === 240e3 && nextGap(60, NaN, 9) === 900e3, "failures back off, up to 15 minutes");

const calls = [];
let status = 200;
const body = (items) => "<rss><channel>" + items.map((x) => `<item><title>${x.title}</title><link>${x.link}</link><pubDate>${x.date}</pubDate></item>`).join("") + "</channel></rss>";
const feedBody = body([raw("Gunmen attack police post in Bannu, two officers killed", 2, "https://h1.test/a")]);
const fetchFn = async (u, o) => { calls.push({ u, h: o.headers }); return { status, ok: status === 200, headers: new Map([["etag", '"v1"'], ["cache-control", "max-age=30"]]), text: async () => feedBody }; };
const two = { feeds: [{ cc: "pk", outlet: "H1", url: "https://h1.test/rss", lang: "en" }, { cc: "pk", outlet: "H1b", url: "https://h1.test/rss2", lang: "en" },
  { cc: "pk", outlet: "H2", url: "https://h2.test/rss", lang: "en" }, { cc: "pk", outlet: "H3", url: "https://h3.test/rss", lang: "en" }] };
const N = new FastNews({ feeds: fastFeeds(two, ["https://h1.test/rss", "https://h1.test/rss2"]), listed: two, R, gz: null, fetchFn });
let r1 = await N.round(now);
ok(calls.length === 1 && calls[0].h["user-agent"] === UA && /^AXIOM-OSAP\//.test(UA), "one request per host at a time, under OSAP's own plain name (no browser-like client)");
ok((r1.pk || []).length === 1, "a new item comes back for its country");
await N.round(now + HOST_GAP);
ok(calls.length === 2 && calls[1].u === "https://h1.test/rss2", "the same host's second feed waits its turn");
await N.round(now + 60e3);
ok(calls.length === 3 && calls[2].h["if-none-match"] === '"v1"', "the next ask is conditional (If-None-Match)");
const again = await N.round(now + 120e3 + HOST_GAP);
ok(!(again.pk || []).length, "an item read before is not made again");
status = 304;
const before = N.notModified; await N.round(now + 240e3); await N.round(now + 240e3 + HOST_GAP);
ok(N.notModified > before, "304 Not Modified is counted, and nothing is parsed");
status = 429; await N.round(now + 400e3);
const s1 = N.st.get(calls[calls.length - 1].u);
ok(s1.fails === 1 && s1.next >= now + 400e3 + 120e3, "a 429 doubles the wait");

// ---------- bursts ----------
const nB = N.burst("pk", now);
ok(nB === 2 && N.queue.every((q) => q.burst && !q.f.url.startsWith("https://h1.test")), "a serious item asks the country's other feeds once (not the fast ones again)");
ok(N.burst("pk", now + 60e3) === 0, "a second burst for the same country waits");
ok(N.burst("pk", now + BURST_EVERY + 1) === 2, "and is allowed again after 10 minutes");

// ---------- the wide tier ----------
const wideAll = wideFeeds(listed, fast);
ok(wideAll.length > 300 && wideAll.every((f) => !fast.includes(f.url) && !f.search && !f.html && /^en/.test(f.lang)), `the wide tier is every other plain English RSS feed (${wideAll.length})`);
ok(new Set(wideAll.map((f) => f.url)).size === wideAll.length, "a feed listed for two countries is asked once");
ok(wideFeeds(fake, ["https://a.test/rss"]).length === 0, "the wide tier never holds a search, a non-English, a retired or a fast feed");
const many = { feeds: Array.from({ length: 60 }, (_, k) => ({ cc: "pk", outlet: "W" + k, url: `https://w${k}.test/rss`, lang: "en" })).concat([{ cc: "pk", outlet: "F", url: "https://f.test/rss", lang: "en" }]) };
const calls2 = [], f2 = async (u) => { calls2.push(u); return { status: 304, ok: false, headers: new Map() }; };
const W = new FastNews({ feeds: fastFeeds(many, ["https://f.test/rss"]), wide: wideFeeds(many, ["https://f.test/rss"]), listed: many, R, gz: null, fetchFn: f2, wideBase: 300, now });
ok([...W.st.values()].filter((s) => s.wide && s.next <= now).length === 1, "the wide tier's first asks are spread over its interval, not all at once");
await W.round(now + 300e3);
ok(calls2.length === PER_ROUND && calls2[0] === "https://f.test/rss", `one round asks at most ${PER_ROUND} feeds, the fast list first`);
const w0 = [...W.st.values()].find((s) => s.wide && s.next > now + 300e3);
ok(w0 && w0.next - (now + 300e3) >= 300e3, "a wide feed is asked again about 5 minutes later");

const f403 = async () => ({ status: 403, ok: false, headers: new Map() });
const X = new FastNews({ feeds: [], wide: wideFeeds(many, []).slice(0, 1), listed: many, R, gz: null, fetchFn: f403, now });
const xs = [...X.st.values()][0];
await X.round(now); await X.round(xs.next);
ok(xs.next === Infinity && X.refused === 1, "a wide feed that refuses OSAP's own name twice is left to the lane for the rest of the run");

fs.rmSync(dir, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
