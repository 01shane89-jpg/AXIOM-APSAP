// World view (tools/world_lib.mjs): the World area's stories and headlines are a projection of every country's Story coverage.
// No network. Run from the repo root: node tests/world.test.mjs
import fs from "node:fs";
import { WW, worldStories, worldNews } from "../tools/world_lib.mjs";
import { splitByCountry } from "../tools/split_country.mjs";
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

const END = Date.parse("2026-11-15T03:00Z");
const st = (id, t, n, d, links, extra = {}) => ({ id, t, u: links[0], s: "Outlet " + id, d0: d, d, n, k: { state: 0, public: 0, other: n }, o: { dom: n, out: 0, unk: 0 },
  src: links.map((l, i) => ["Outlet " + id + i, "other", "dom", "", d, l, t, 0, 0]), ...extra });
const built = new Map([
  ["ir", { reports: 100, outlets: 10, stories: [st("a", "Two supertankers explode in Strait of Hormuz", 80, "2026-11-15T01:00", ["https://x/1", "https://x/2"]),
    st("b", "Second Iran story", 30, "2026-11-15T00:00", ["https://x/3", "https://x/4"]), st("c", "Third Iran story", 29, "2026-11-15T00:00", ["https://x/5", "https://x/6"]),
    st("d", "Fourth Iran story", 28, "2026-11-15T00:00", ["https://x/7", "https://x/8"]), st("e", "Fifth Iran story", 27, "2026-11-15T00:00", ["https://x/9", "https://x/10"])] }],
  // the same tanker story filed under the US too (it shares a link): kept once, under Iran with more outlets
  ["us", { reports: 50, outlets: 5, stories: [st("f", "Tankers explode in Hormuz, oil jumps", 20, "2026-11-15T02:00", ["https://x/2", "https://y/1"]),
    st("g", "Ground stop ordered for all airports nationwide", 25, "2026-11-15T02:00", ["https://y/2", "https://y/3"]),
    st("h", "Messi scores twice as Argentina beat Uruguay", 90, "2026-11-15T02:00", ["https://y/4", "https://y/5"]),
    st("i", "Old story from last week", 99, "2026-11-05T02:00", ["https://y/6", "https://y/7"]),
    st("j", "Blindspot story", 50, "2026-11-15T02:00", ["https://y/8", "https://y/9"], { b: "state-only" })] }],
  ["ww", { reports: 999, outlets: 9, stories: [st("z", "never from ww itself", 500, "2026-11-15T02:00", ["https://z/1", "https://z/2"])] }]
]);
const W = worldStories(built, { end: END, hours: 72 });
const T = W.stories.map((s) => s.t);
ok(W.cc === WW && W.hours === 72, "World file is the ww area");
ok(T[0] === "Two supertankers explode in Strait of Hormuz" && W.stories[0].cc === "ir", "most-covered story leads, kept with its country");
ok(!T.some((t) => /Tankers explode in Hormuz, oil/.test(t)), "a story filed under two countries (shared link) is kept once");
ok(!T.some((t) => /Messi/.test(t)), "sport is left out of the world list");
ok(!T.some((t) => /Old story/.test(t)), "a story older than the window is left out");
ok(!T.some((t) => /Blindspot/.test(t)), "blindspots (one country's own outlets) are left out");
ok(!T.some((t) => /never from ww/.test(t)) && W.reports === 150, "the World list is never built from itself");
ok(W.stories.filter((s) => s.cc === "ir").length === 4, "at most 4 stories a country");
ok(T.includes("Ground stop ordered for all airports nationwide"), "other countries' stories fill the list");
{
  const big = new Map([["ir", { stories: [st("k", "Big story", 30, "2026-11-15T01:00", Array.from({ length: 30 }, (_, i) => "https://k/" + i))] }]]);
  const k = worldStories(big, { end: END }).stories[0];
  ok(k.src.length === 10 && k.srcMore === 20 && k.src[0][5] === k.u && k.n === 30, "Who carried it keeps the lead and the first 10 outlets, with the count of the rest");
}

{
  // a story breaking now outranks an older story with somewhat more outlets in all: outlets in the last 24 hours count twice
  // (the CIA breach, 24 Nov 2026: 26 outlets in three hours sat 20th behind three-day-old stories)
  const fresh = (id, n, d) => ({ ...st(id, "Story " + id, n, d, Array.from({ length: n }, (_, i) => "https://" + id + "/" + i)) });
  const b2 = new Map([["ua", { stories: [fresh("old", 40, "2026-11-12T06:00")] }], ["us", { stories: [fresh("new", 26, "2026-11-15T01:00")] }]]);
  const w2 = worldStories(b2, { end: END }).stories.map((s) => s.t);
  ok(w2[0] === "Story new" && w2[1] === "Story old", "a story with 26 outlets today ranks above one with 40 outlets two days ago");
}

const news = worldNews(W, (cc) => cc === "ir" ? [{ title: "دو نفتکش", title_en: "Two supertankers explode", link: "https://x/1", date: "2026-11-15T01:00", outlet: "Mehr", geo: { n: "Hormuz", la: 26.5, lo: 56.3 } }] : [], "2026-11-15 03:00Z");
const I = news.items[WW];
ok(Object.keys(news.items).length === 1 && I.length === W.stories.length, "one World headline per world story, under items.ww");
ok(I[0].title_en === "Two supertankers explode" && I[0].geo && I[0].cc === "ir" && I[0].n === 80, "a headline the country's news file holds keeps its translation and place");
const g = I.find((i) => /Ground stop/.test(i.title));
ok(g && g.link === "https://y/2" && g.cc === "us" && g.date === "2026-11-15T02:00", "a headline not in the news file comes from the story's lead");

// the per-country split never deletes the World file
const dir = fs.mkdtempSync("/tmp/osap-world-"), f = dir + "/news.js";
fs.writeFileSync(f, "window.ASAP_NEWS=" + JSON.stringify({ asof: "x", sources: [], items: { fr: [] } }) + ";\n");
fs.mkdirSync(dir + "/news"); fs.writeFileSync(dir + "/news/ww.js", "x"); fs.writeFileSync(dir + "/news/zz.js", "x");
splitByCountry(f, "ASAP_NEWS");
ok(fs.existsSync(dir + "/news/ww.js") && !fs.existsSync(dir + "/news/zz.js") && fs.existsSync(dir + "/news/fr.js"), "splitByCountry keeps news/ww.js and drops stale files");
fs.rmSync(dir, { recursive: true });

// the committed World files have the page's shape
const read = (p) => { const t = fs.readFileSync(p, "utf8"); return JSON.parse(t.slice(t.indexOf("=") + 1).trim().replace(/;$/, "")); };
const S = read("data/live/stories/ww.js"), N = read("data/live/news/ww.js");
ok(S.cc === WW && Array.isArray(S.stories) && S.stories.every((s) => s.cc && s.cc !== WW && s.u), "data/live/stories/ww.js: each story under its own country");
ok(Array.isArray(N.items[WW]) && N.items[WW].every((i) => i.link && i.title && i.cc), "data/live/news/ww.js: items.ww headlines with link and country");

if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("all passed");
