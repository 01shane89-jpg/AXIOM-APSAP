// Reporting spikes method (tools/spikes_lib.mjs) on made-up counts, then the build (tools/news_spikes.mjs) on a made-up news
// index in a temporary folder: a real jump is flagged with its normal level and range, a weekend lull or OSAP adding outlets
// (every place up together) is not, a small place's jump from 1 to 4 is not, a future-dated headline is left out, and a place
// with too little history says so instead of guessing. Run from the repo root: node tests/spikes.test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { score, median, windowOf, rankFlagged } from "../tools/spikes_lib.mjs";

let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const flat = (v, n = 15) => new Array(n).fill(v);

ok(median([3, 1, 2]) === 2 && median([4, 1, 3, 2]) === 2.5, "median of odd and even lists");
ok(windowOf(Date.parse("2026-11-12T12:00Z"), Date.parse("2026-11-13T00:00Z")) === 0 && windowOf(Date.parse("2026-11-11T23:59Z"), Date.parse("2026-11-13T00:00Z")) === 1, "24-hour windows end at the build time");
ok(windowOf(Date.parse("2026-11-14T00:00Z"), Date.parse("2026-11-13T00:00Z")) === -1, "a future-dated headline is in no window");

// steady 50 a day out of 10,000, then 150: a spike, 3x normal
{ const c = flat(50), t = flat(10000); c[0] = 150; for (let k = 1; k < 15; k++) c[k] = 50 + (k % 3) - 1;
  const s = score(c, t);
  ok(s.lvl === "spike" && s.exp === 50 && s.x === 3 && s.lo < 50 && s.hi > 50, `a jump from about 50 to 150 is a spike, normal 50 (${JSON.stringify(s)})`); }
// 1.7x is above normal, not a spike
{ const c = flat(100), t = flat(10000); c[0] = 170; ok(score(c, t).lvl === "above", "a jump to 1.7x is above normal"); }
// NEGATIVE: a weekend lull and a doubling of all OSAP outlets move every place together: no flag
{ const c = flat(50), t = flat(10000); c[0] = 100; t[0] = 20000; const s = score(c, t);
  ok(s.lvl === "normal" && s.exp === 100, `OSAP's whole volume doubling is not a spike (normal scales to ${s.exp})`);
  const c2 = flat(50), t2 = flat(10000); c2[0] = 25; t2[0] = 5000; ok(score(c2, t2).lvl === "normal", "a weekend lull everywhere is not below normal"); }
// NEGATIVE: small counts: 1 a day to 4 is 4x but below the 10-headline floor and within chance
{ const c = flat(1), t = flat(10000); c[0] = 4; ok(score(c, t).lvl === "normal", "a small place going from 1 to 4 headlines is not flagged"); }
// NEGATIVE: a place that always swings widely is judged against its own usual spread
{ const c = [90, 20, 80, 30, 90, 20, 85, 25, 95, 30, 80, 20, 90, 25, 85], t = flat(10000); ok(score(c, t).lvl === "normal", "a place that often swings 20-95 is not flagged at 90"); }
// below normal: a feed dropping out
{ const c = flat(200), t = flat(10000); c[0] = 60; ok(score(c, t).lvl === "below", "200 a day falling to 60 is below normal"); }
// too little history: says so
{ const c = [30, 5, 5, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], t = [1000, 1000, 1000, 1000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; const s = score(c, t);
  ok(s.lvl === "new" && s.exp === null, "3 days of OSAP history is not enough to judge"); }
// NEGATIVE: a data set just added (no headlines before today) is not a spike from nothing
{ const c = flat(0), t = flat(10000); c[0] = 60; c[3] = 2; const s = score(c, t); ok(s.lvl === "new" && s.nb === 1, "a place seen on only 1 earlier day is not judged"); }
ok(rankFlagged({ a: { lvl: "above", z: 9 }, b: { lvl: "spike", z: 4 }, c: { lvl: "spike", z: 7 }, d: { lvl: "normal", z: 1 }, e: { lvl: "below", z: -5 } }).join() === "c,b,a",
  "flagged places: spikes first, larger z first; normal and below are not listed");

// the build, on a made-up index in a temporary folder
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "spikes-"));
const root = process.cwd(), now = Date.parse("2026-11-13T00:00:00Z");
fs.mkdirSync(path.join(tmp, "data/live/news-index"), { recursive: true });
fs.mkdirSync(path.join(tmp, "tools"), { recursive: true });
fs.copyFileSync(path.join(root, "tools/topics.json"), path.join(tmp, "tools/topics.json"));
const days = {};
let id = 0;
function put(t, cc, topics = "", title = "headline") {
  const d = new Date(t).toISOString(), day = d.slice(0, 10);
  (days[day] = days[day] || []).push([cc, d.slice(0, 16), title + " " + id, "", "Outlet", "https://example.org/" + id++, "", "", topics, ""]);
}
for (let k = 0; k < 15; k++) {
  const base = now - k * 864e5 - 3600e3;
  for (let i = 0; i < 400; i++) put(base - i * 60e3, "xx");                // a big steady country
  for (let i = 0; i < (k === 0 ? 60 : 12); i++) put(base - i * 61e3, "kr", k === 0 ? "korea-dmz" : "", "DMZ"); // jumps today
  for (let i = 0; i < 20; i++) put(base - i * 59e3, "ph");                 // steady
}
put(now + 5 * 864e5, "kr", "korea-dmz", "future");                          // dated in the future: left out
for (const [d, rows] of Object.entries(days))
  fs.writeFileSync(path.join(tmp, "data/live/news-index", d + ".js"), `window.OSAP_NEWSIX_DAY=window.OSAP_NEWSIX_DAY||{};window.OSAP_NEWSIX_DAY[${JSON.stringify(d)}]=` + JSON.stringify(rows) + ";\n");
const log = execFileSync("node", [path.join(root, "tools/news_spikes.mjs")], { cwd: tmp, env: { ...process.env, SPIKES_NOW: new Date(now).toISOString() }, encoding: "utf8" });
const w = {}; new Function("window", fs.readFileSync(path.join(tmp, "data/live/spikes.js"), "utf8"))(w);
const S = w.OSAP_SPIKES;
ok(S && S.asof === "2026-11-13T00:00Z" && S.totals.length === 15 && S.totals[14] === 480, `the build writes 15 windows, the last 24 h holding 480 headlines (${S && S.totals[14]})`);
ok(S.countries.kr.lvl === "spike" && S.countries.kr.n === 60 && S.countries.kr.d.length === 15 && S.countries.kr.d[0] === 12, `South Korea's jump from 12 to 60 is a spike (${JSON.stringify(S.countries.kr).slice(0, 120)})`);
ok(S.countries.xx.lvl === "normal" && S.countries.ph.lvl === "normal", "steady countries stay normal even as the total moves");
ok(S.datasets["korea-dmz"] && S.datasets["korea-dmz"].lvl === "new", "a data set with only today's headlines has too little history to judge, so it is not a spike");
ok(S.flagged.length === 1 && S.flagged[0].join() === "c,kr", `only South Korea is flagged (${JSON.stringify(S.flagged)})`);
ok(S.countries.kr.top.length === 6 && S.countries.kr.top.every((r) => /^https:\/\/example\.org\//.test(r[2]) && !/future/.test(r[0])), "a spike carries its newest headlines with links, not the future-dated one");
ok(!S.countries.xx.top && /1 dated in the future/.test(log), "a normal place carries no headlines; the future-dated row is counted as left out");
ok(S.sets["korea-dmz"] && S.sets["korea-dmz"][1].includes("kr"), "data sets carry their name and countries");
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
