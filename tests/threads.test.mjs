// Unit test for tools/threads_lib.mjs (no network): one event told in different words becomes one thread with its follow-ups and
// one-outlet angles; an unrelated story stays out; parts are chosen by the headline's words; names are learnt from how outlets
// capitalize them (a title-case headline does not make "Ground Stop" a name, a shouted "THE" is not an acronym); a country's own
// name is left out; connections list other stories before the same event elsewhere and never the thread's own reports; nothing
// but the outlets' own headlines and links is carried. Then the tool on a small pool writes one threads file per country.
// Usage: node tests/threads.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buildCountry, outletBook } from "../tools/stories_lib.mjs";
import { nameBook, partOf, stem, connect, MAX_LINKS } from "../tools/threads_lib.mjs";

const END = Date.parse("2026-11-14T05:00:00Z");
const at = (h) => new Date(END - h * 36e5).toISOString().slice(0, 16);
let n = 0;
const rep = (outlet, title, h, o = {}) => ({ ccs: [o.cc || "xx"], date: at(h), title, orig: o.orig || "", outlet, link: o.link || "https://e.x/" + (++n), flags: o.flags || "" });

// stems and parts
assert.equal(stem("flights"), "flight"); assert.equal(stem("suspended"), "suspend"); assert.equal(stem("died"), "die"); assert.equal(stem("dies"), "die");
assert.equal(partOf("FAA lifts nationwide ground stop"), "next");
assert.equal(partOf("Stranded passengers sleep in terminal"), "impact");
assert.equal(partOf("Ground stop caused by telecom outage, minister says"), "why");
assert.equal(partOf("Secretary Mullin says there is no threat"), "said");
assert.equal(partOf("Ground stop ordered for all airports"), "what");

// names
const titles = [
  "Secretary Mullin says the ground stop was not an attack", "Homeland chief Mullin briefs reporters on the outage", "Officials led by Mullin and Duffy hold a briefing at noon",
  "FAA orders a nationwide ground stop", "The FAA lifts the order after hours", "FAA Orders Nationwide Ground Stop For All Airports",
  "THE BIG STORY: what we know", "Read THE report on the ground stop here", "the report is out now on the stop",
  "Delays reported at Washington Dulles International Airport today", "Long lines at Washington Dulles International Airport overnight",
  "Xland says flights resume in Xland today", "Xland prices rise in the capital", "Another day of rain in the city of Xland",
];
const book = nameBook(titles);
assert.ok(book.has("Mullin") && book.has("FAA") && book.has("Washington Dulles International Airport"));
assert.ok(!book.has("Ground Stop") && !book.has("Nationwide Ground Stop"), "a title-case headline does not make a name");
assert.ok(!book.has("THE"), "a shouted ordinary word is not an acronym");
assert.deepEqual(book.find("Long lines at Washington Dulles International Airport, FAA says"), ["Washington Dulles International Airport", "FAA"], "longest name first");

// threads: one event in other words + angles, an unrelated story, background headlines
const feeds = [{ cc: "xx", outlet: "Home Daily" }, { cc: "xx", outlet: "Home Post" }, { cc: "xx", outlet: "Home Times" }, { cc: "yy", outlet: "Far Herald" }, { cc: "zz", outlet: "Far Courier" }];
const ob = outletBook(feeds, {}, new Map());
const bg = [];
// enough other headlines that the event's words are not among the country's most common (4% of its headlines)
for (let i = 0; i < 300; i++) bg.push(rep(i % 2 ? "Home Daily" : "Home Post", "Market report number " + i + " for district" + i + " traders" + i, 2 + (i % 40)));
const ev = [
  rep("Home Daily", "FAA orders nationwide ground stop at all airports", 8),
  rep("Home Post", "FAA orders nationwide ground stop at all airports", 8),
  rep("Far Herald", "FAA orders nationwide ground stop at all airports", 7.9),
  rep("Far Courier", "Airports halt all departures in nationwide ground stop", 7.8),
  rep("Home Times", "Mullin says ground stop caused by telecom outage at FAA", 7),
  rep("Home Post", "Mullin says ground stop caused by telecom outage at FAA", 6.9),
  rep("Home Daily", "Stranded passengers sleep at airports during nationwide ground stop", 6),
  rep("Far Herald", "FAA lifts nationwide ground stop after five hours", 4),
  rep("Home Times", "FAA lifts nationwide ground stop after five hours", 3.9),
];
const other = [rep("Home Daily", "Bridge collapse kills twelve in the capital", 5), rep("Home Post", "Bridge collapse kills twelve in the capital", 5), rep("Home Times", "Twelve killed as bridge collapse hits the capital", 4.5)];
const names2 = nameBook([...titles, ...ev.map((r) => r.title), ...other.map((r) => r.title)]);
const c = buildCountry("xx", [...bg, ...ev, ...other], ob, (t) => (/\bXland\b/.test(t) ? ["xx"] : []), { end: END, names: names2, skipName: (x) => x === "Xland" });
assert.ok(Array.isArray(c.threads) && c.threads.length >= 2, "threads built");
const T = c.threads.find((t) => /ground stop/i.test(t.t));
assert.ok(T, "the event has a thread");
assert.equal(T.r, ev.length, "every headline of the event joins, however it was worded: " + T.rows.map((r) => r[6]).join(" | "));
assert.equal(T.n, 5, "outlets counted once");
assert.ok(!T.rows.some((r) => /bridge/i.test(r[6])), "an unrelated story stays out");
const P = Object.fromEntries(T.parts.map(([k, l]) => [k, l.map(([ix]) => ix.map((i) => T.rows[i][6]))]));
assert.ok(P.next && P.next.flat().every((x) => /lifts/.test(x)), "What happens next holds the follow-up");
assert.ok(P.impact && P.impact.flat().some((x) => /Stranded/.test(x)), "a one-outlet angle is kept, under Who is affected");
assert.ok(P.why && P.why.flat().some((x) => /caused/.test(x)), "the cause is under Why");
assert.equal(T.dev.length, T.parts.reduce((a, [, l]) => a + l.length, 0), "the timeline has each story's first report");
const devMs = T.dev.map((i) => Date.parse(T.rows[i][4] + "Z"));
assert.ok(devMs.every((v, i) => !i || v >= devMs[i - 1]), "the timeline runs oldest first");
assert.ok(T.names.some(([x]) => x === "Mullin") && T.names.some(([x]) => x === "FAA"), "names in the thread: " + JSON.stringify(T.names));
assert.match(T.fp, /^[0-9a-f]{64}$/);
assert.ok(T.rows.every((r) => r.length === 9 && /^https:\/\//.test(r[5])), "rows carry only the outlet's own headline, link and where it is from");
assert.ok(!JSON.stringify(c.threads).includes("summary"), "no outlet text");

// connections: other stories first, then this event elsewhere, never the thread's own reports, one line per other thread
const all = [
  ...T.rows.map((r) => ({ cc: "xx", title: r[6], outlet: r[0], link: r[5], date: r[4], ms: Date.parse(r[4] + "Z"), thread: "xx:" + T.id })),
  { cc: "yy", title: "Mullin defends immigration plan in Senate", outlet: "Far Herald", link: "https://o/1", date: at(30), ms: END - 30 * 36e5, thread: "" },
  { cc: "zz", title: "Mullin says nationwide ground stop is over", outlet: "Far Courier", link: "https://o/2", date: at(2), ms: END - 2 * 36e5, thread: "" },
  { cc: "yy", title: "Mullin trip one", outlet: "A", link: "https://o/3", date: at(10), ms: END - 10 * 36e5, thread: "yy:abc" },
  { cc: "yy", title: "Mullin trip two", outlet: "B", link: "https://o/4", date: at(9), ms: END - 9 * 36e5, thread: "yy:abc" },
];
const ix = new Map([["Mullin", all.map((a, i) => [a, i]).filter(([a]) => /Mullin/.test(a.title)).map(([, i]) => i)]]);
const T2 = JSON.parse(JSON.stringify(T)); T2.names = [["Mullin", 2]];
connect(new Map([["xx", [T2]]]), all, ix, 100);
const L = T2.names[0][3];
assert.ok(!L.some((l) => T.rows.some((r) => r[5] === l[3])), "never the thread's own reports");
assert.equal(L.filter((l) => l[5] === "yy:abc").length, 1, "one line per other thread");
assert.equal(L[L.length - 1][3], "https://o/2", "the same event elsewhere comes after the other stories");
assert.equal(L[L.length - 1][6], 1); assert.equal(L[0][6], 0);
assert.ok(L.length <= MAX_LINKS);
const T3 = JSON.parse(JSON.stringify(T)); T3.names = [["Mullin", 2]];
connect(new Map([["xx", [T3]]]), all, ix, 3);
assert.equal(T3.names.length, 0, "a name in too many headlines connects nothing and is left out");

// the tool on a small pool: a threads file per country, stories files as before
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "threads-"));
fs.mkdirSync(path.join(dir, "ix"));
const row = (r) => [r.ccs.join(","), r.date, r.title, r.orig, r.outlet, r.link, "", r.flags, "", ""];
const day = at(0).slice(0, 10);
fs.writeFileSync(path.join(dir, "ix", day + ".js"), "window.OSAP_NEWSIX_DAY=window.OSAP_NEWSIX_DAY||{};window.OSAP_NEWSIX_DAY[\"" + day + "\"]=" + JSON.stringify([...bg, ...ev, ...other].map(row)) + ";");
execFileSync("node", ["tools/news_stories.mjs"], { env: { ...process.env, STORIES_IX: path.join(dir, "ix"), STORIES_OUT: path.join(dir, "stories"), STORIES_END: new Date(END).toISOString() }, stdio: "pipe" });
const read = (f) => { const w = {}; new Function("window", fs.readFileSync(f, "utf8"))(w); return w; };
const tf = read(path.join(dir, "threads", "xx.js")).OSAP_THREADS, sf = read(path.join(dir, "stories", "xx.js")).OSAP_STORIES;
assert.equal(tf.cc, "xx"); assert.equal(tf.schema, "osap-threads/1"); assert.ok(tf.threads.some((t) => /ground stop/i.test(t.t)));
assert.ok(/not AI/.test(tf.method), "the file says how threads are made");
assert.ok(!("threads" in sf), "the story file stays as it was");
fs.rmSync(dir, { recursive: true, force: true });
console.log("threads test: all passed");
