// Wikipedia edit surges (tools/dense_wikiedits.mjs): counts only, no editor names
import { surge, wikiItem, TITLE, perDay } from "../tools/dense_wikiedits.mjs";
let bad = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) bad++; };
const days = (vals) => vals.map((e, i) => ({ timestamp: new Date(Date.parse("2026-10-27") + i * 864e5).toISOString().slice(0, 10) + "T00:00:00.000Z", edits: e }));
const quiet = Array(30).fill(2);
ok(JSON.stringify(surge(days([...quiet, 34]))) === '{"day":"2026-11-26","edits":34,"median":2}', "34 edits against a median of 2 is a surge");
ok(surge(days([...Array(30).fill(1), 7])) === null, "under 8 edits is never a surge");
ok(surge(days([...Array(30).fill(3), 9])) === null, "three times the median is not enough");
ok(surge(days([0, 0, 40])) === null, "too few days to judge");
const it = wikiItem("ge", TITLE.ge, { day: "2026-11-26", edits: 60, median: 3 });
ok(it.title === 'Wikipedia surge: the "Georgia (country)" article was edited 60 times on 2026-11-26 (30-day median 3)' && it.sev === 2 && it.ccs.join() === "ge", "title, high-severity at 50+, country");
ok(it.url === "https://en.wikipedia.org/w/index.php?title=Georgia_(country)&action=history" || it.url === "https://en.wikipedia.org/w/index.php?title=Georgia_%28country%29&action=history", "links the page history (" + it.url + ")");
ok(!/user|editor name/i.test(it.title) && /says nothing about which edits are right/.test(it.detail), "no editor names; says what a surge does and does not mean");
ok(wikiItem("oki", TITLE.oki, { day: "2026-11-26", edits: 20, median: 1 }).ccs.join() === "oki", "Okinawa keeps its own OSAP page");
const P = perDay(["2026-11-26T10:00:00Z", "2026-11-26T11:00:00Z", "2026-11-24T09:00:00Z"], "2026-11-24", "2026-11-26");
ok(JSON.stringify(P.map((x) => x.edits)) === "[1,0,2]", "revision timestamps become edits per day, zero days included");
ok(perDay(["2026-11-25T10:00:00Z", "2026-11-26T11:00:00Z"], "2026-11-01", "2026-11-26", true).length === 1, "a capped history leaves out the days it may not cover");
if (bad) { console.log(bad + " failed"); process.exit(1); }
console.log("all passed");
