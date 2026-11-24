// Speed scorecard (tools/speed_scorecard.mjs): what it reads from the flash loop's log. Run from the repo root: node tests/speed_scorecard.test.mjs
import { parseLog, merge, markdown, stats, TARGET } from "../tools/speed_scorecard.mjs";

let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

const log = [
  "2026-11-23T16:00:00.1Z flash 16:00:00Z new fast item tr Anadolu Agency: 93 s after its outlet's time",
  "2026-11-23T16:00:01.1Z flash 16:00:01Z new fast item ua Kyiv Post: 400 s after its outlet's time, serious",
  "2026-11-23T16:00:02.1Z flash 16:00:02Z new fast item ua Euromaidan Press (burst): 9000 s after its outlet's time",
  "2026-11-23T16:00:03.1Z   push: alert lag 150 s flash news",
  "2026-11-23T16:00:03.2Z   push: alert lag 40 s alert quakes",
  "2026-11-23T16:00:04.1Z flash 16:00:04Z new quake us7000abcd M4.6: 300 s after it happened, 18 s after USGS published it",
  "2026-11-23T17:00:00.1Z flash 17:00:00Z fast news: 2315 request(s), 909 not modified, 10 failed; 107 item(s) laid before main had them",
  "2026-11-23T16:00:05.1Z flash 16:00:05Z new fast item gh Graphic Online (wide): 8000 s after its outlet's time, late post",
  "2026-11-23T10:00:00.1Z flash 10:00:00Z new fast item tr Anadolu Agency: 5 s after its outlet's time",
].join("\n");
const p = parseLog(log, Date.parse("2026-11-23T12:00:00Z"));
ok(p.late.join() === "8000" && p.onTime.join() === "93,400", "an item the outlet posted after its stated time is counted apart from OSAP's own delay");
ok(p.news.join() === "93,400,8000", "news lags read; a burst item is not a measure of the loop; lines before the window are left out");
ok(p.alerts.flash.join() === "150" && p.alerts.news.join() === "150" && p.alerts.other.join() === "40", "push lags split into flash, news and other alerts");
ok(p.quakes.join() === "18" && p.requests === 2315 && p.failed === 10, "quakes and request counts read");
const m = merge([p, p]);
ok(m.news.length === 6 && m.newsBy["ua Kyiv Post"].length === 2, "runs merge item by item, not median of medians");
ok(stats([1, 2, 3, 4, 100]).med === 3, "median");
const md = markdown(merge([p, parseLog("x new fast item jp The Japan Times: 60 s after its outlet's time")]), 24, 2);
ok(/\| News: outlet's time to in OSAP \| 4 \|.*MISSED \/ MISSED/.test(md) && /OSAP's own delay\) \| 3 \|.*MET \/ MISSED/.test(md), "all items graded, and OSAP's own delay graded apart (median met, 90% missed)");
ok(/posted on time by the outlet \(OSAP's own delay\) \| 3 \|/.test(md) && /after its stated time \(outlet's delay\) \| 1 \|/.test(md), "both rows shown: OSAP's own delay, and the outlet's");
ok(TARGET.newsMed === 120 && TARGET.newsP90 === 300 && TARGET.flashMed === 180, "targets: news median 2 min, 90% 5 min; flash median 3 min");
ok(!/Anadolu Agency: 93/.test(md), "the scorecard names outlets and seconds only");

const bad = markdown({ ...merge([]), logs: 5, unread: 5 }, 24, 5);
ok(/WARNING: 5 of 5 loop log\(s\) could not be read/.test(bad), "logs that could not be read are said, never shown as a quiet day of 0 items");
ok(!/WARNING/.test(md), "no warning when every log was read");

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
