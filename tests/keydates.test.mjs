// Key dates (assets/osap-keydates.js core and tools/keydates_lib.mjs): computed religious dates against published ones, the
// Wikipedia electoral calendar parser, Nager rows, UCDP anniversaries and the merged window. No network.
// Run from the repo root: node tests/keydates.test.mjs
import { createRequire } from "node:module";
import { parseElectionCalendar, parseDates, nagerItems, topViolenceDays, cleanWikitext, scrubWhere } from "../tools/keydates_lib.mjs";
const K = createRequire(import.meta.url)("../assets/osap-keydates.js");
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const find = (list, re) => list.filter((x) => re.test(x.title)).map((x) => x.date);

// Easter (published dates)
ok(K.easter(2026) === "2026-04-05" && K.easter(2027) === "2027-03-28" && K.easter(2025) === "2025-04-20", "Western Easter 2025-2027");
ok(K.orthodoxEaster(2026) === "2026-04-12" && K.orthodoxEaster(2027) === "2027-05-02" && K.orthodoxEaster(2025) === "2025-04-20", "Orthodox Easter 2025-2027");

// Islamic dates from the Umm al-Qura calendar (Saudi published: Ramadan 1447 began 18 Feb 2026, Eid al-Fitr 20 Mar 2026, Eid al-Adha 27 May 2026)
const sa = K.religious("sa", "2026-01-01", "2026-12-31");
ok(find(sa, /^Ramadan begins/)[0] === "2026-02-18", "Ramadan 1447 begins 18 Feb 2026 (" + find(sa, /^Ramadan begins/) + ")");
ok(find(sa, /^Eid al-Fitr/)[0] === "2026-03-20", "Eid al-Fitr 20 Mar 2026 (" + find(sa, /^Eid al-Fitr/) + ")");
ok(find(sa, /^Ramadan ends/)[0] === "2026-03-19", "Ramadan ends 19 Mar 2026");
ok(find(sa, /^Eid al-Adha/)[0] === "2026-05-27", "Eid al-Adha 27 May 2026 (" + find(sa, /^Eid al-Adha/) + ")");
ok(find(sa, /^Ashura/).length === 1 && find(sa, /^Islamic New Year/).length === 1, "Ashura and Islamic New Year once each");
ok(!find(sa, /Christmas|Easter/).length, "no Christmas or Easter for Saudi Arabia");
// Lunar New Year 17 Feb 2026, Rosh Hashanah 12 Sep 2026, Diwali 8 Nov 2026, Songkran 13-15 Apr
ok(find(K.religious("vn", "2026-01-01", "2026-12-31"), /^Lunar New Year/)[0] === "2026-02-17", "Lunar New Year (Tết) 17 Feb 2026");
const il = K.religious("il", "2026-01-01", "2026-12-31");
ok(find(il, /^Rosh Hashanah/)[0] === "2026-09-12" && find(il, /^Yom Kippur/)[0] === "2026-09-21" && find(il, /^Passover/)[0] === "2026-04-02", "Rosh Hashanah, Yom Kippur, Passover 2026");
ok(find(K.religious("np", "2026-10-01", "2026-12-31"), /^Diwali/)[0] === "2026-11-08", "Diwali 8 Nov 2026 for Nepal");
const th = K.religious("th", "2026-04-01", "2026-04-30").filter((x) => /Songkran/.test(x.title))[0];
ok(th && th.date === "2026-04-13" && th.end === "2026-04-15", "Songkran 13-15 Apr");
ok(K.religious("ru", "2027-01-01", "2027-01-31").some((x) => /Orthodox Christmas/.test(x.title) && x.date === "2027-01-07"), "Orthodox Christmas 7 Jan for Russia");
ok(K.religious("fr", "2026-01-01", "2026-12-31").every((x) => x.status === "computed" && /^https:/.test(x.src)), "computed dates carry status and a source link");

// Wikipedia electoral calendar
const WT = "{{Short description|none}}\n==January==\n* 11 January:\n** [[Elections in Benin|Benin]], [[2026 Beninese parliamentary election|Parliament]]<ref>{{Cite web |title=x |url=https://e.x/}}</ref>\n" +
  "* 15 January: [[Elections in Uganda|Uganda]], [[2026 Ugandan general election|President and Parliament]]\n==March==\n* March: [[Estonia]], [[Next Estonian parliamentary election|Parliament]]\n" +
  "* 22–23 March: [[Elections in Italy|Italy]], [[2026 Italian constitutional referendum|Constitutional referendum]]\n" +
  "* 26 March: ''[[Elections in the Faroe Islands|Faroe Islands]], [[2026 Faroese general election|Parliament]]''\n" +
  "* 8 February: [[Elections in Thailand|Thailand]], [[2026 Thai general election|House of Representatives]] and [[2026 Thai constitutional referendum|Constitutional referendum]]\n" +
  "==November==\n* 3 November: [[Elections in the United States|United States]], [[2026 United States House of Representatives elections|House of Representatives]] and [[2026 United States Senate elections|Senate]]\n" +
  "<!--==Unknown date==-->\n==Indirect elections==\n* 16 March, 18 June, and 16 October: [[Elections in India|India]], [[2026 Rajya Sabha elections|Council of States]]\n==Unknown date==\n* [[Elections in Bahrain|Bahrain]], [[Next Bahraini general election|Parliament]]\n";
const E = parseElectionCalendar(WT, 2026), by = (c) => E.filter((e) => e.country === c);
ok(by("Benin").length === 1 && by("Benin")[0].date === "2026-01-11" && by("Benin")[0].title === "Parliament", "nested bullet takes the date above it");
ok(by("Uganda")[0].url === "https://en.wikipedia.org/wiki/2026_Ugandan_general_election", "source is the election's own article");
ok(!by("Estonia").length && !by("Bahrain").length, "month-only and undated entries are left out");
ok(by("Italy")[0].date === "2026-03-22" && by("Italy")[0].end === "2026-03-23" && by("Italy")[0].kind === "referendum", "day range and referendum kind");
ok(by("Thailand")[0].kind === "election" && /Constitutional referendum/.test(by("Thailand")[0].title), "an election held with a referendum stays an election");
ok(by("United States")[0].title === "House of Representatives and Senate", "two election links joined");
ok(by("India").length === 3 && by("India").every((e) => e.indirect), "indirect elections on three dates");
ok(by("Faroe Islands").length === 1, "territories are parsed (the refresh drops names not in the picker)");
ok(!/ref|Cite/.test(cleanWikitext("a<ref name=x>{{Cite web|url={{x}}}}</ref>b")), "references and nested templates stripped");
ok(parseDates("18–20 September", 2026)[0].end === "2026-09-20", "en dash range");

// Nager rows
const N = nagerItems([{ date: "2026-12-25", localName: "Noël", name: "Christmas Day", global: true, types: ["Public"] }, { date: "2026-08-15", localName: "x", name: "Assumption", global: false, counties: ["DE-BY"], types: ["Public"] }, { date: "bad" }], 2026, "DE");
ok(N.length === 2 && N[0].src === "https://date.nager.at/api/v3/PublicHolidays/2026/DE" && N[1].regional[0] === "DE-BY" && N[0].local === "Noël", "Nager rows keep source, regions and local name");

// UCDP deadliest days
const R = [{ cc: "ml", date: "2019-03-23", best: 157, id: "1", where: "Ogossagou", a: "Dan Na Ambassagou", b: "Civilians", type: 3 }, { cc: "ml", date: "2019-03-23", best: 3, id: "2" },
  { cc: "ml", date: "2018-05-01", best: 4, id: "3" }, { cc: "ml", date: "2010-05-01", best: 400, id: "4" }, { cc: "ml", date: "2020-01-01", end: "2020-01-05", best: 90, id: "5" }];
const T = topViolenceDays(R, "2016-01-01");
ok(T.ml.length === 1 && T.ml[0].best === 160 && T.ml[0].n === 2 && T.ml[0].id === "1" && T.ml[0].src === "https://ucdp.uu.se/event/1", "deadliest day summed, its biggest event linked; old, small and multi-day left out");

ok(topViolenceDays([1, 2, 3].map((i) => ({ cc: "x", date: "2020-05-0" + i, best: 50 + i, id: String(i) })), "2016-01-01").x.length === 2, "at most two days from one month");
ok(!/Shamiya|Ahmed/.test(scrubWhere("Shamiya family home, al-Shati Camp") + scrubWhere("the house of Ahmed Saleh in Rafah")) && /al-Shati Camp/.test(scrubWhere("Shamiya family home, al-Shati Camp")), "family names are taken out of place descriptions");
ok(K.holidayItems([{ date: "2026-10-12", name: "Columbus Day", types: ["Public"], regional: ["US-AL"] }, { date: "2026-10-12", name: "Columbus Day", types: ["Public"], regional: ["US-CO"] }], "2026-10-01", "2026-10-31").length === 1, "a holiday listed for several regions shows once");

// the merged window: anniversaries, election, official holiday beats the computed one
const data = { holidays: [{ date: "2026-12-25", name: "Christmas Day", types: ["Public"], src: "https://date.nager.at/api/v3/PublicHolidays/2026/ML" }],
  elections: [{ date: "2026-11-15", title: "President", kind: "election", src: "https://en.wikipedia.org/wiki/X" }], anniversaries: T.ml };
const L = K.build("ml", data, "2026-11-01");
ok(L.from === "2026-10-25" && L.to === "2026-12-31", "window is the past 7 and next 60 days");
ok(L.items.filter((x) => /Christmas/.test(x.title)).length === 1 && L.items.find((x) => /Christmas/.test(x.title)).status === "official", "official Christmas kept, computed one dropped");
ok(L.items.some((x) => x.kind === "election" && x.status === "claimed" && /President/.test(x.title)), "election shown as claimed");
const L2 = K.build("ml", data, "2027-03-20");
const an = L2.items.find((x) => x.kind === "anniversary");
ok(an && an.date === "2027-03-23" && /^8 years since about 160 deaths \(2019-03-23\): Ogossagou/.test(an.title) && an.status === "computed", "anniversary in the window: " + (an && an.title));
ok(L2.items.every((a, i, arr) => !i || arr[i - 1].date <= a.date), "sorted by date");
ok(K.anniversaryItems([{ date: "2020-02-29", best: 20, n: 1 }], "2027-02-20", "2027-03-05")[0].date === "2027-02-28", "29 February falls on 28 February");
ok(K.build("xx", null, "2026-10-19").items.length >= 0, "no data file still gives a list");

console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
