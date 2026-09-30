// Unit test for the news job's shared pieces added for the focus-country feeds (no network):
// the relevance check before translation (tools/topics_lib.mjs), web-page news lists and printed dates (tools/feedparse.mjs),
// the larger history caps for focus countries (tools/history.mjs), and the shipped tools/news_feeds.json.
// Usage: node tests/feeds.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileRelevance, preTranslation, itemRelevance, kept } from "../tools/topics_lib.mjs";
import { parseList, pageDate, parseFeed } from "../tools/feedparse.mjs";
import { ADAPTERS } from "../tools/news_adapters.mjs";

const cfg = JSON.parse(fs.readFileSync(new URL("../tools/relevance.json", import.meta.url), "utf8"));
const R = compileRelevance(cfg, []);
const pre = (lang, title) => preTranslation(R, { lang, title, summary: "" });
// English is checked before translation: kept only with a relevant word, sport dropped
assert.equal(pre("en", "Police arrest two over Bangkok shooting"), true);
assert.equal(pre("en", "Asiad: volleyball team reaches quarterfinals"), false);
assert.equal(pre("en", "New cafe opens downtown"), false);
// languages with their own word lists
assert.equal(pre("th", "ตำรวจจับกุมผู้ต้องหาค้ายาบ้า"), true);          // police arrest meth dealer
assert.equal(pre("th", "ดาราสาวเปิดตัวละครใหม่"), false);                 // actress, new drama
assert.equal(pre("th", "ระดับน้ำในเขื่อนลดลง"), false);                   // no word at all: "ระดับ" (level) must not match
assert.equal(pre("ko", "합참 \"DMZ 폭발, 북한 지뢰로 추정\""), true);
assert.equal(pre("ko", "아이돌 그룹 컴백 무대 공개"), false);
assert.equal(pre("zh-TW", "共機擾台 國防部：偵獲12架次"), true);
assert.equal(pre("zh", "中職總冠軍賽開打"), false);
assert.equal(pre("mn", "Улаанбаатарт түймэр гарч, хоёр хүн нас барсан"), true);
assert.equal(pre("mn", "Дуучин шинэ цомгоо танилцууллаа"), false);
assert.equal(pre("tl", "Pulis, binaril sa Cotabato"), true);
assert.equal(pre("tl", "Artista, ikinasal na"), false);
// a strong word wins over a sport word, in any language
assert.equal(pre("th", "นักฟุตบอลถูกยิงเสียชีวิต"), true);
// other languages wait for the translation
assert.equal(pre("ja", "何か"), true);
assert.equal(pre("", "Какой-то заголовок"), true);
// after translation: a native-language headline with no word is left out, not kept as "unchecked"
assert.equal(kept(itemRelevance(R, { lang: "ko", title: "오늘의 날씨 맑음", title_en: "Today's weather: clear", mt: "model" })), false);
assert.equal(itemRelevance(R, { lang: "ja", title: "何か", title_en: "何か", mt: "untranslated" }), "unchecked");

// printed dates
assert.equal(pageDate("2026.09.29"), "2026-09-29");
assert.equal(pageDate("Posted 29/09/2026"), "2026-09-29");
assert.equal(pageDate("26 กันยายน 2569"), "2026-09-26");
assert.equal(pageDate("yesterday"), "");
// a web-page list: one item per link, headline from the heading, date in the link or just after it
const html = `<a href="/en/News/PLAAct/87845" class="news_list"><div class="date">2026.09.29</div><h2 class="title">PLA activities around Taiwan</h2><div>Click-Through Rate：197</div></a>
<a href="/th/detail/iid/5" title="ผู้ว่าฯ สั่งอพยพชาวบ้านเข้าศูนย์พักพิง"><img></a><a href="/th/detail/iid/5">ผู้ว่าฯ สั่งอพยพชาวบ้านเข้าศูนย์พักพิง &ldquo;ด่วน&rdquo;</a><span>26 กันยายน 2569</span>
<a href="/th/detail/iid/6">No date on this one, a long enough headline</a><a href="/about">About us</a>`;
const L = parseList(html, "https://example.go.th/", "/(PLAAct|detail/iid)/\\d+");
assert.deepEqual(L.map((i) => [i.date, i.title, i.link]), [
  ["2026-09-29", "PLA activities around Taiwan", "https://example.go.th/en/News/PLAAct/87845"],
  ["2026-09-26", "ผู้ว่าฯ สั่งอพยพชาวบ้านเข้าศูนย์พักพิง \"ด่วน\"", "https://example.go.th/th/detail/iid/5"],
  ["", "No date on this one, a long enough headline", "https://example.go.th/th/detail/iid/6"],
]);
// numeric entities in feed titles
assert.equal(parseFeed("<rss><item><title>&#xD55C;&#44397; test</title><link>https://x/1</link></item></rss>")[0].title, "한국 test");
// escaped markup in a description and double-escaped entities come out as plain text
{
  const it = parseFeed("<rss><item><title>505 sacks of &amp;#8216;illegal&amp;#8217; ores</title><link>https://x/2</link><description>&lt;p&gt;&lt;span class=\"x\"&gt;Troops&lt;/span&gt; moved &amp;amp; left&lt;/p&gt;</description></item></rss>")[0];
  assert.equal(it.title, "505 sacks of \u2018illegal\u2019 ores");
  assert.equal(it.summary, "Troops moved & left");
  assert.equal(parseFeed("<rss><item><title>a &lt; b and 3 &gt; 2</title><link>https://x/3</link></item></rss>")[0].title, "a < b and 3 > 2");
}

// Taiwan MND daily activity page: counts copied as printed
{
  const page = `<div class="content"><p>一、 Date： 6 a.m. Sep. 27 (Sun.) to 6 a.m. Sep. 28 (Mon.) (UTC+8)</p><p>二、 PLA activities： 3 sorties of PLA aircraft, 5 PLAN ships and 4 official ships operating around Taiwan were detected as of 6 a.m. (UTC+8) today. 1 out of 3 sorties crossed the median line of the Taiwan Strait and entered Taiwan&#x2019;s northern ADIZ.</p><p>Keywords： Taiwan Strait</p></div>`;
  const d = ADAPTERS["mnd-pla"](page);
  assert.equal(d.title, "Taiwan MND: 3 PLA aircraft (1 into the ADIZ or across the median line), 5 PLAN ships, 4 official ships detected around Taiwan");
  assert.deepEqual(d.counts, { aircraft: 3, adiz: 1, ships: 5, official: 4, balloons: 0 });
  assert.ok(d.summary.startsWith("6 a.m. Sep. 27 (Sun.) to 6 a.m. Sep. 28 (Mon.) (UTC+8). 3 sorties"));
  assert.equal(ADAPTERS["mnd-pla"]("<p>Page not found</p>"), null);
}

// focus countries keep more history (run in a scratch directory; updateHistory writes data/history relative to cwd)
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "osap-hist-")), cwd = process.cwd();
  fs.mkdirSync(path.join(dir, "tools"));
  fs.writeFileSync(path.join(dir, "tools/relevance.json"), JSON.stringify({ strong: { x: ["killed"] }, drop: {}, keep: {} }));
  fs.writeFileSync(path.join(dir, "tools/topics.json"), JSON.stringify({ topics: [] }));
  process.chdir(dir);
  const { updateHistory } = await import("../tools/history.mjs");
  const mk = (n) => Array.from({ length: n }, (_, k) => ({ title: "Two killed " + k, link: "https://x.example/" + k, date: new Date(Date.now() - k * 60000).toISOString().slice(0, 16) }));
  await updateHistory("news", { th: mk(900), vn: mk(900) }, "2026-09-29 10:00Z", { th: 3000 });
  const n = (cc) => { const t = fs.readFileSync(`data/history/${cc}.js`, "utf8"); return JSON.parse(t.slice(t.indexOf("=", t.indexOf("]")) + 1).trim().replace(/;$/, "")).news.length; };
  assert.equal(n("th"), 900);   // focus country: cap 3000
  assert.equal(n("vn"), 800);   // default cap
  process.chdir(cwd);
}

// the shipped registry: every feed has a country, a name and an https or http address; html feeds carry a match; focus caps are numbers
const reg = JSON.parse(fs.readFileSync(new URL("../tools/news_feeds.json", import.meta.url), "utf8"));
for (const f of reg.feeds) {
  assert.ok(/^[a-z]{2,3}$/.test(f.cc) && f.outlet && /^https?:\/\//.test(f.url), "bad feed " + JSON.stringify(f));
  if (f.html) assert.ok(f.match && new RegExp(f.match), "html feed without match: " + f.outlet);
  if (f.tier) assert.ok(["official", "national", "regional", "local-language", "specialist"].includes(f.tier), "bad tier " + f.outlet);
  if (f.relevance) assert.equal(f.relevance, "exempt", "bad relevance " + f.outlet);
  if (f.clock || f.tz) assert.match(f.clock || f.tz, /^[+-]\d\d:\d\d$/, "bad clock or tz " + f.outlet);
}
assert.equal(new Set(reg.feeds.map((f) => f.url)).size, reg.feeds.length, "duplicate feed address");
for (const [cc, v] of Object.entries(reg.focus || {})) assert.ok(v.per_run > 0 && v.history > 0, "bad focus entry " + cc);
console.log("feeds tests passed");

// an outlet marked relevance "exempt" keeps every item, before and after translation, even with no relevant word
{
  const R = compileRelevance(JSON.parse(fs.readFileSync("tools/relevance.json", "utf8")));
  const i = { title: "Changes in the KPA High Command", summary: "", lang: "en", exempt: true };
  assert.equal(preTranslation(R, i), true);
  assert.equal(itemRelevance(R, i), "strong");
  assert.equal(itemRelevance(R, { ...i, title: "A quiet week", exempt: undefined }), "none");
}
