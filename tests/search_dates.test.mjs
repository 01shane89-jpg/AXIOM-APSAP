// Search result times (2026-11-17): Bing News search writes US Pacific time labelled GMT (tools/news_date.mjs bingDate), and an
// article page's own time replaces the search engine's (tools/news_pagedate.mjs). Cases are the two reports that looked like the
// first report of a story that began 16 Nov ~19:00Z: TVBS (published 17 Nov 04:47Z, listed 16 Nov 14:46Z) and Kuwait Times
// (published 17 Nov 05:49Z, listed 16 Nov 10:48Z). Run: node tests/search_dates.test.mjs
import assert from "node:assert/strict";
import { bingDate, fixBingDate, isBing } from "../tools/news_date.mjs";
import { pageDate, applyPageDate, fillPageDates } from "../tools/news_pagedate.mjs";

let ok = 0; const t = async (name, f) => { await f(); ok++; console.log("ok -", name); };

await t("Bing's GMT label is read as Pacific time, standard and daylight", () => {
  assert.equal(bingDate("Mon, 16 Nov 2026 22:49:00 GMT"), "2026-11-17T06:49:00.000Z");   // PST, UTC-8
  assert.equal(bingDate("Sun, 25 Oct 2026 10:00:00 GMT"), "2026-10-25T17:00:00.000Z");   // PDT, UTC-7
  assert.equal(bingDate("Sun, 01 Nov 2026 00:30:00 GMT"), "2026-11-01T07:30:00.000Z");   // before the 02:00 change: still PDT
  assert.equal(bingDate("Sun, 01 Nov 2026 03:00:00 GMT"), "2026-11-01T11:00:00.000Z");   // after it: PST
  assert.equal(bingDate(""), "");
  assert.equal(bingDate("not a date"), "");
  assert.ok(isBing("https://www.bing.com/news/search?q=x&format=rss") && !isBing("https://news.google.com/rss"));
});

await t("a stored Bing time is moved once, and only a Bing search result's", () => {
  const i = { via: "search", outlet: "Kuwait Times (via Bing News search)", date: "2026-11-16T22:49" };
  fixBingDate(i);
  assert.equal(i.date, "2026-11-17T06:49"); assert.equal(i.date_src, "bing");
  fixBingDate(i); assert.equal(i.date, "2026-11-17T06:49", "never moved twice");
  const rss = { via: "RSS", outlet: "Kuwait Times", date: "2026-11-16T12:20" };
  assert.equal(fixBingDate(rss).date, "2026-11-16T12:20");
  const seen = { via: "search", outlet: "x (via Bing News search)", date: "2026-11-16T12:20", date_seen: true };
  assert.equal(fixBingDate(seen).date, "2026-11-16T12:20", "a time OSAP gave itself is not Bing's");
});

await t("the page's own zoned time is read; a bare local time is not", () => {
  // Kuwait Times: a bare article:published_time first, then zoned datePublished
  const kt = '<meta property="article:published_time" content="2026-11-17 08:49:00" /><meta name="datePublished" content="2026-11-17T08:49:00+03:00" />';
  assert.equal(pageDate(kt), "2026-11-17T05:49");
  // TVBS
  assert.equal(pageDate('<meta property="article:published_time" content="2026-11-17T04:47:48.000Z">'), "2026-11-17T04:47");
  // content before property, +0800 without a colon, JSON-LD
  assert.equal(pageDate('<meta content="2026-11-17T12:47:00+0800" property="article:published_time">'), "2026-11-17T04:47");
  assert.equal(pageDate('<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-11-17T08:49:00+03:00"}</script>'), "2026-11-17T05:49");
  assert.equal(pageDate('<meta property="article:published_time" content="2026-11-17 08:49:00">'), "");
  assert.equal(pageDate(""), "");
});

await t("the page time replaces the listed time when they differ, never one in the future", () => {
  const now = Date.parse("2026-11-17T09:00:00Z");
  const a = { date: "2026-11-16T14:46", via: "search" };
  assert.equal(applyPageDate(a, "2026-11-17T04:47", now), true);
  assert.equal(a.date, "2026-11-17T04:47"); assert.equal(a.date_src, "page"); assert.equal(a.date_listed, "2026-11-16T14:46");
  const b = { date: "2026-11-17T04:30", via: "search" };
  assert.equal(applyPageDate(b, "2026-11-17T04:47", now), false, "within 30 minutes: left as it is");
  const c = { date: "2026-11-17T04:30", via: "search" };
  assert.equal(applyPageDate(c, "2026-11-17T12:00", now), false, "a page time ahead of the run is a wrong page clock");
});

await t("search results are dated from their pages, cached, and other items are not read", async () => {
  const reads = [];
  const read = async (u) => { reads.push(u); return { date: u.includes("tvbs") ? "2026-11-17T04:47" : "" }; };
  const today = new Date("2026-11-17T09:00:00Z");
  const items = [{ via: "search", link: "https://news.tvbs.com.tw/politics/4051757", date: "2026-11-16T14:46" },
    { via: "search", link: "https://example.org/a", date: "2026-11-16T10:00" }, { via: "RSS", link: "https://example.org/b", date: "2026-11-16T10:00" }];
  const cache = new Map();
  const r = await fillPageDates(items, cache, 10, read, today);
  assert.deepEqual({ read: r.read, found: r.found, moved: r.moved }, { read: 2, found: 1, moved: 1 });
  assert.equal(items[0].date, "2026-11-17T04:47"); assert.equal(items[1].date, "2026-11-16T10:00");
  assert.equal(reads.length, 2, "the RSS item's page is not read");
  const again = [{ via: "search", link: "https://news.tvbs.com.tw/politics/4051757", date: "2026-11-16T14:46" }];
  const r2 = await fillPageDates(again, cache, 10, read, today);
  assert.equal(r2.read, 0); assert.equal(r2.cached, 1); assert.equal(again[0].date, "2026-11-17T04:47");
});

console.log(ok + " passed");
