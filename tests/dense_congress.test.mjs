// U.S. Congress floor votes (tools/dense_congress.mjs): reading the Senate list, a House roll call and the bill status, which
// votes count as final, and the item wording (shapes of the official files read on 27 Nov 2026).
import { congressRows } from "../tools/congress_rows.mjs";
import { itemRelevance, compileRelevance } from "../tools/topics_lib.mjs";
import fs from "node:fs";
import { congressOf, dayOf, billOf, billUrl, isFinal, senateVotes, senateVoteUrl, houseVote, houseVoteUrl, houseLatest, billStatus, voteItem } from "../tools/dense_congress.mjs";
let bad = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) bad++; };

ok(JSON.stringify(congressOf(2026)) === '{"congress":119,"session":2}' && JSON.stringify(congressOf(2027)) === '{"congress":120,"session":1}', "congress and session from the year");
ok(dayOf("19-Nov", 2026) === "2026-11-19" && dayOf("19-Nov-2026") === "2026-11-19" && dayOf("5-Jan-2027") === "2027-01-05" && dayOf("x") === "", "dates of both chambers' records");
ok(billOf("H.R. 2347").label === "H.R. 2347" && billOf("H R 4464").type === "hr" && billOf("S.J.Res. 197").type === "sjres" && billOf("H J RES 210").label === "H.J.Res. 210"
  && billOf("H.Con.Res. 93").type === "hconres" && billOf("H RES 1530").type === "hres" && billOf("S. 4668").type === "s" && billOf("PN1272-10") === null, "bill numbers in both chambers' spellings; nominations are not bills");
ok(billUrl(119, billOf("H.R. 2347")) === "https://www.congress.gov/bill/119th-congress/house-bill/2347", "Congress.gov bill link");

const hr = billOf("H.R. 2347");
ok(isFinal("On Passage of the Bill", hr) && isFinal("On Motion to Suspend the Rules and Pass", billOf("H R 4464")) && isFinal("On the Concurrent Resolution", billOf("H.Con.Res. 93"))
  && isFinal("On Motion to Concur in the Senate Amendment", hr) && isFinal("On Overriding the Veto", hr) && isFinal("On Agreeing to the Conference Report", hr), "final votes kept");
ok(!isFinal("On the Cloture Motion", hr) && !isFinal("On the Motion to Proceed", hr) && !isFinal("On the Amendment", hr) && !isFinal("On the Motion", hr)
  && !isFinal("On Agreeing to the Resolution", billOf("H RES 1530")) && !isFinal("On Motion to Recommit", hr) && !isFinal("On the Cloture Motion", billOf("PN1272-10")), "procedural votes, amendments, House rules and nominations left out");

const menu = `<vote_summary><votes>
<vote><vote_number>00271</vote_number><vote_date>19-Nov</vote_date><issue>PN1272-4</issue><question>On the Cloture Motion </question><result>Agreed to</result><vote_tally><yeas>48</yeas><nays>46</nays></vote_tally><title>Motion to Invoke Cloture: a judge</title></vote>
<vote><vote_number>00270</vote_number><vote_date>19-Nov</vote_date><issue>H.R. 2347</issue><question>On Passage of the Bill </question><result>Passed</result><vote_tally><yeas>62</yeas><nays>33</nays></vote_tally><title>H.R. 2347, as Amended; A bill to amend the Internal Revenue Code of 1986 to exclude from gross income any damages, other than punitive damages, received on account of any sexual acts or sexual contact.</title></vote>
<vote><vote_number>00267</vote_number><vote_date>18-Nov</vote_date><issue>H.R. 2347</issue><question>On the Amendment <measure>S.Amdt. 6883</measure></question><result>Agreed to</result><vote_tally><yeas>69</yeas><nays>27</nays></vote_tally><title>Capito Amdt. No. 6883; In the nature of a substitute.</title></vote>
</votes></vote_summary>`;
const SV = senateVotes(menu, 2026);
ok(SV.length === 3 && SV[1].num === 270 && SV[1].date === "2026-11-19" && SV[1].yeas === 62 && SV[1].nays === 33 && SV[1].question === "On Passage of the Bill" && SV[2].question === "On the Amendment", "Senate list read: number, date, tally, question (measure tag dropped)");
ok(SV.filter((v) => isFinal(v.question, billOf(v.issue))).map((v) => v.num).join() === "270", "only the passage vote is final");
ok(senateVoteUrl(119, 2, 270) === "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1192/vote_119_2_00270.htm", "Senate vote page link");

const roll = `<rollcall-vote><vote-metadata><rollcall-num>327</rollcall-num><legis-num>H R 4464</legis-num><vote-question>On Motion to Suspend the Rules and Pass</vote-question>
<vote-result>Passed</vote-result><action-date>19-Nov-2026</action-date><vote-desc>Preventive Health Savings Act</vote-desc><vote-totals>
<totals-by-party><party>Republican</party><yea-total>200</yea-total><nay-total>10</nay-total></totals-by-party>
<totals-by-vote><total-stub>Totals</total-stub><yea-total>401</yea-total><nay-total>12</nay-total><present-total>0</present-total><not-voting-total>19</not-voting-total></totals-by-vote></vote-totals></vote-metadata></rollcall-vote>`;
const HV = houseVote(roll);
ok(HV.num === 327 && HV.issue === "H R 4464" && HV.date === "2026-11-19" && HV.yeas === 401 && HV.nays === 12 && HV.title === "Preventive Health Savings Act", "House roll call read, totals from the all-members row, not a party's");
ok(houseLatest('<div class="pagination_info">1 - 10 of 327 Results</div>') === 327 && houseLatest("<p>nothing</p>") === 0, "newest House roll number from the Clerk's list");
ok(houseVoteUrl(2026, 327) === "https://clerk.house.gov/Votes/2026327", "House vote page link");

const status = `<billStatus><bill><number>2347</number>
<relatedBills><item><title>Survivor Justice Tax Prevention Act</title><latestAction><actionDate>2026-09-15</actionDate><text>Read twice and referred to the Committee on Finance.</text></latestAction></item></relatedBills>
<titles><item><titleType>Popular Titles</titleType><title>BAAJA</title></item><item><titleType>Display Title</titleType><title>Bipartisan American Affordability and Jobs Act of 2026</title></item>
<item><titleType>Short Title(s) as Passed House</titleType><title>Survivor Justice Tax Prevention Act</title></item></titles>
<amendments><amendment><latestAction><actionDate>2026-11-19</actionDate><text>Amendment SA 7030 agreed to.</text></latestAction></amendment></amendments>
<latestAction><actionDate>2026-11-24</actionDate><text>Message on Senate action sent to the House.</text></latestAction></bill></billStatus>`;
const BS = billStatus(status);
ok(BS.display === "Bipartisan American Affordability and Jobs Act of 2026" && BS.popular === "BAAJA", "bill status: the name it carries now and its popular name");
ok(BS.latest.date === "2026-11-24" && /sent to the House/.test(BS.latest.text), "bill status: the bill's own latest action, not a related bill's or an amendment's");

const it = voteItem({ ...SV[1] }, hr, BS, 119, senateVoteUrl(119, 2, 270));
ok(it.title === "Senate passed H.R. 2347, Bipartisan American Affordability and Jobs Act of 2026 (BAAJA), 62-33", "title names the bill as it is known now (" + it.title + ")");
ok(/baaja/i.test(it.title) && /Affordability and Jobs/.test(it.title), "searchable by its popular name and its full name");
ok(/still describes the number's earlier subject \("A bill to amend the Internal Revenue Code/.test(it.detail), "says the vote record names the number's earlier subject");
ok(/Latest action \(24 Nov 2026\): Message on Senate action sent to the House\./.test(it.detail) && /not a law until both chambers pass the same text/.test(it.detail), "latest official action and what a vote is not");
ok(/roll call 270 \(https:\/\/www\.senate\.gov\//.test(it.detail) && it.url === "https://www.congress.gov/bill/119th-congress/house-bill/2347" && it.ccs.join() === "us" && it.date === "2026-11-19T12:00", "official record named, Congress.gov link, United States, date");

const h = voteItem(HV, billOf(HV.issue), { display: "Preventive Health Savings Act", popular: "", latest: { date: "2026-11-20", text: "Received in the Senate." } }, 119, houseVoteUrl(2026, 327));
ok(h.title === "House passed H.R. 4464, Preventive Health Savings Act, 401-12" && !/earlier subject/.test(h.detail), "House item, no earlier-subject note when the names agree (" + h.title + ")");
const yr = voteItem({ ...HV, title: "Earth MRI Reauthorization Act" }, billOf("H R 9640"), { display: "Earth MRI Reauthorization Act of 2026", popular: "", latest: {} }, 119, "x");
ok(!/earlier subject/.test(yr.detail), "a name that only adds its year is the same name, not an earlier subject");
const dot = voteItem({ ...HV }, billOf("H R 4464"), { display: "Directing the President to remove forces from hostilities with Iran.", popular: "", latest: {} }, 119, "x");
ok(/with Iran, 401-12$/.test(dot.title), "a title's own full stop is dropped before the tally (" + dot.title + ")");
const c = voteItem({ chamber: "Senate", num: 269, date: "2026-11-19", issue: "H.Con.Res. 93", question: "On the Concurrent Resolution", result: "Rejected", yeas: 48, nays: 51, title: "H.Con.Res. 93; A concurrent resolution directing the President" }, billOf("H.Con.Res. 93"), null, 119, "x");
ok(c.title === "Senate rejected H.Con.Res. 93, 48-51" && !/Latest action/.test(c.detail), "a rejected resolution without bill status still reads plainly (" + c.title + ")");
const v = voteItem({ chamber: "House", num: 9, date: "2026-11-01", issue: "H R 1", question: "On Motion to Concur in the Senate Amendment", result: "Agreed to", yeas: 220, nays: 200, title: "x" }, billOf("H R 1"), null, 119, "x");
ok(v.title === "House agreed to the other chamber's version of H.R. 1, 220-200", "concurring reads as agreeing to the other chamber's version");
ok(!/\b(Sen\.|Rep\.)\s/.test(it.detail + it.title + h.detail), "no member names");

// in the news search pool (tools/news_index.mjs): one row per vote, the chamber as the outlet, kept by the relevance check
const slimmed = [it, h].map((x) => ({ f: "us-congress", t: x.title, x: x.detail, d: x.date, u: x.url, k: x.kind }));
const rows = congressRows([...slimmed, { f: "tt-rand", t: "Other", u: "https://www.rand.org/x" }, { f: "us-congress", t: "No link", u: "javascript:x" }]);
ok(rows.length === 2 && rows[0].link === "https://www.congress.gov/bill/119th-congress/house-bill/2347#vote-senate-2026-11-19" && rows[0].outlet === "U.S. Senate (official record)" && rows[1].outlet === "U.S. House (official record)", "news rows: one per vote, own link, chamber as outlet, other feeds and bad links left out");
const { topics } = JSON.parse(fs.readFileSync("tools/topics.json", "utf8"));
const REL = compileRelevance(JSON.parse(fs.readFileSync("tools/relevance.json", "utf8")), topics);
ok(rows.every((r) => !["drop", "none"].includes(itemRelevance(REL, r))), "news rows pass the relevance check (" + rows.map((r) => itemRelevance(REL, r)).join(",") + ")");
console.log(bad ? bad + " FAILED" : "all passed");
process.exit(bad ? 1 : 0);
