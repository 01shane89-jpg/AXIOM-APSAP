// Item dates for news (tools/news_date.mjs): time-zone fixes and no item dated in the future (16 Nov 2026 quality check:
// Thai PBS, Tuoi Tre, Al Ghad, Jordan News, The Jerusalem Post, LANA, Yemen Online wrote local time as UTC or with no zone,
// so items showed up to 5 h ahead, e.g. "1730Z" at 15:00Z). Run: node tests/news_date.test.mjs
import { itemDate } from "../tools/news_date.mjs";
import fs from "node:fs";
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const NOW = Date.parse("2026-11-16T15:07:00Z");
let r = itemDate("Mon, 16 Nov 2026 22:06:27", { clock: "+07:00" }, undefined, NOW);
ok(r.date === "2026-11-16T15:06" && !r.seen, "Thai PBS local time with no zone, clock +07:00: 22:06 local is 15:06Z (" + r.date + ")");
r = itemDate("11/16/2026 8:36:00 PM", { clock: "+07:00" }, undefined, NOW);
ok(r.date === "2026-11-16T13:36", "Tuoi Tre US-style local time: 8:36 PM local is 13:36Z (" + r.date + ")");
r = itemDate("Mon, 16 Nov 2026 17:58:20 GMT", { clock: "+03:00" }, undefined, NOW);
ok(r.date === "2026-11-16T14:58", "Al Ghad labels local time GMT: read at +03:00 (" + r.date + ")");
r = itemDate("2026-11-16 16:43:20", { tz: "+02:00" }, undefined, NOW);
ok(r.date === "2026-11-16T14:43", "a zone-less ISO date with tz +02:00 (" + r.date + ")");
r = itemDate("Mon, 16 Nov 2026 13:02:06 GMT", {}, undefined, NOW);
ok(r.date === "2026-11-16T13:02" && !r.seen, "a correct UTC date is kept (" + r.date + ")");
r = itemDate("Mon, 16 Nov 2026 15:20:00 GMT", {}, undefined, NOW);
ok(r.date === "2026-11-16T15:20" && !r.seen, "13 minutes ahead (clock skew) is kept");
r = itemDate("Mon, 30 Nov 2026 11:00:00 GMT", {}, undefined, NOW);
ok(r.date === "2026-11-16T15:07" && r.seen, "a date two weeks ahead (scheduled post) gets the run time, marked as seen (" + r.date + ")");
r = itemDate("Mon, 16 Nov 2026 22:06:27", {}, "2026-11-16T14:52", NOW);
ok(r.date === "2026-11-16T14:52" && r.seen, "a future date falls back to when OSAP first saw the item (" + r.date + ")");
r = itemDate("Mon, 16 Nov 2026 22:06:27", {}, "2026-11-16T22:06", NOW);
ok(r.date === "2026-11-16T15:07" && r.seen, "a future time saved by an older run is not reused (" + r.date + ")");
r = itemDate("", {}, undefined, NOW);
ok(r.date === "2026-11-16T15:07" && r.seen, "an undated item gets the run time");
// the seven outlets found on 16 Nov carry their offsets
const F = JSON.parse(fs.readFileSync(new URL("../tools/news_feeds.json", import.meta.url), "utf8"));
const all = JSON.stringify(F);
for (const [u, c] of [["news.thaipbs.or.th/rss/news", "+07:00"], ["tuoitre.vn/rss", "+07:00"], ["alghad.com/rss", "+03:00"], ["jordannews.jo/rss", "+03:00"],
  ["jpost.com/rss/rssfeedsfrontpage", "+02:00"], ["lana.gov.ly/rss/ar/", "+02:00"], ["yemenonline.info/feed", "+03:00"]])
  ok(new RegExp('"url":"https://(www\\.)?' + u.replace(/[.?/]/g, "\\$&") + '[^"]*"[^}]*"clock":"' + c.replace("+", "\\+") + '"').test(all), u + " reads its dates at " + c);
console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
