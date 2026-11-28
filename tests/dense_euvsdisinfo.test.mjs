// EUvsDisinfo feed (tools/dense_euvsdisinfo.mjs): every item framed as the EU's claim, euvsdisinfo.eu links only
import { euItems } from "../tools/dense_euvsdisinfo.mjs";
let bad = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) bad++; };
const item = (title, link, date, extra = "") => `<item><title>${title}</title><link>${link}</link><pubDate>${date}</pubDate><category><![CDATA[Disinformation Review]]></category><category><![CDATA[Moldova]]></category><description><![CDATA[<p>The Kremlin says Moldova is being dragged into war.${extra}</p><p>The post <a href="${link}">x</a> appeared first on <a href="https://euvsdisinfo.eu">EUvsDisinfo</a>.</p>]]></description></item>`;
const now = Date.parse("2026-11-27T05:00:00Z");
const xml = "<rss><channel>" + item("‘Russophobia’: a narrative for every occasion", "https://euvsdisinfo.eu/russophobia-a-narrative-for-every-occasion/", "Fri, 20 Nov 2026 10:08:54 +0000")
  + item("duplicate", "https://euvsdisinfo.eu/russophobia-a-narrative-for-every-occasion/", "Fri, 20 Nov 2026 10:08:54 +0000")
  + item("Old one", "https://euvsdisinfo.eu/old/", "Mon, 01 Jun 2026 10:00:00 +0000")
  + item("Elsewhere", "https://evil.example/x", "Fri, 20 Nov 2026 10:08:54 +0000") + "</channel></rss>";
const I = euItems(xml, now);
ok(I.length === 1, "one item: no duplicate, nothing older than 60 days, euvsdisinfo.eu links only (" + I.length + ")");
ok(I[0].title === "EU (EUvsDisinfo) says: ‘Russophobia’: a narrative for every occasion", "the headline is framed as the EU's claim");
ok(/the European Union's assessment/.test(I[0].detail) && /not OSAP's ruling/.test(I[0].detail) && !/appeared first/.test(I[0].detail), "the detail says whose assessment it is and drops the WordPress footer");
ok(I[0].ccs.includes("md") && I[0].ccs.includes("ru"), "placed on the countries it is about (" + I[0].ccs + ")");
if (bad) { console.log(bad + " failed"); process.exit(1); }
console.log("all passed");
