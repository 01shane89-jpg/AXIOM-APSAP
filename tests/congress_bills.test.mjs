// U.S. bill tracker (tools/congress_lib.mjs): reading a bill status file (its own titles and latest action, not a related bill's),
// the stage it has reached, its steps, the search row and the recent steps for news search (shapes read on 27 Nov 2026).
import { parseBill, stageOf, stepsOf, ixRow, recentSteps, chunkOf, topLevel, STAGES } from "../tools/congress_lib.mjs";
let bad = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) bad++; };
const act = (date, type, code, src, text) => `<item><actionDate>${date}</actionDate><sourceSystem><code>9</code><name>${src}</name></sourceSystem><text>${text}</text><type>${type}</type>${code ? `<actionCode>${code}</actionCode>` : ""}</item>`;

// H.R. 2347 as it stood on 27 Nov 2026: passed the House under its first name, then passed the Senate as BAAJA
const hr2347 = `<?xml version="1.0"?><billStatus><version>3.0.0</version><bill><number>2347</number><updateDate>2026-11-25T22:20:12Z</updateDate>
<originChamber>House</originChamber><type>HR</type><introducedDate>2025-03-25</introducedDate><congress>119</congress>
<committees><item><systemCode>hswm00</systemCode><name>Ways and Means Committee</name><chamber>House</chamber><type>Standing</type><activities><item><name>Reported By</name><date>2026-04-09T15:59:28Z</date></item></activities></item></committees>
<committeeReports><committeeReport><citation>H. Rept. 119-599</citation></committeeReport></committeeReports>
<relatedBills><item><title>Survivor Justice Tax Prevention Act</title><congress>119</congress><number>5395</number><type>S</type><latestAction><actionDate>2026-09-15</actionDate><text>Read twice and referred to the Committee on Finance.</text></latestAction></item></relatedBills>
<actions>
${act("2026-11-24", "Floor", "", "Senate", "Message on Senate action sent to the House.")}
<item><actionDate>2026-11-19</actionDate><sourceSystem><name>Senate</name></sourceSystem><text>Passed Senate with an amendment by Yea-Nay Vote. 62 - 33. Record Vote Number: 270.</text><type>Floor</type><recordedVotes><recordedVote><rollNumber>270</rollNumber><url>https://www.senate.gov/x</url><chamber>Senate</chamber></recordedVote></recordedVotes></item>
${act("2026-11-19", "Floor", "17000", "Library of Congress", "Passed/agreed to in Senate: Passed Senate with an amendment by Yea-Nay Vote. 62 - 33. Record Vote Number: 270.")}
${act("2026-07-14", "Calendars", "", "Senate", "Read the second time. Placed on Senate Legislative Calendar under General Orders. Calendar No. 453.")}
${act("2026-04-28", "IntroReferral", "", "Senate", "Received in the Senate.")}
${act("2026-04-27", "Floor", "8000", "Library of Congress", "Passed/agreed to in House: On motion to suspend the rules and pass the bill, as amended Agreed to by voice vote. (text: CR H3110)")}
${act("2026-04-09", "Committee", "5000", "Library of Congress", "Reported (Amended) by the Committee on Ways and Means. H. Rept. 119-599.")}
${act("2025-03-25", "IntroReferral", "H11100", "House floor actions", "Referred to the House Committee on Ways and Means.")}
${act("2025-03-25", "IntroReferral", "Intro-H", "Library of Congress", "Introduced in House")}
${act("2025-03-25", "IntroReferral", "1000", "Library of Congress", "Introduced in House")}
</actions>
<sponsors><item><bioguideId>S001199</bioguideId><fullName>Rep. Smucker, Lloyd [R-PA-11]</fullName><party>R</party></item></sponsors>
<cosponsors><item><fullName>Rep. Moore, Gwen [D-WI-4]</fullName></item><item><fullName>Rep. Example, A [R-OH-1]</fullName></item></cosponsors>
<policyArea><name>Environmental Protection</name></policyArea>
<summaries><summary><text><![CDATA[<p>This bill is about something else.</p>]]></text></summary></summaries>
<title>Survivor Justice Tax Prevention Act</title>
<titles><item><titleType>Popular Titles</titleType><title>BAAJA</title></item><item><titleType>Display Title</titleType><title>Bipartisan American Affordability and Jobs Act of 2026</title></item>
<item><titleType>Short Title(s) from Engrossed Amendment Senate bill text</titleType><title>Bipartisan American Affordability and Jobs Act of 2026</title></item>
<item><titleType>Short Title(s) as Passed House</titleType><title>Survivor Justice Tax Prevention Act</title></item></titles>
<amendments><amendment><number>7030</number><latestAction><actionDate>2026-11-19</actionDate><text>Amendment SA 7030 agreed to in Senate by Unanimous Consent.</text></latestAction><actions><actions><item><actionDate>2026-11-19</actionDate><text>Amendment SA 7030 agreed to.</text><type>Floor</type></item></actions></actions></amendment></amendments>
<latestAction><actionDate>2026-11-24</actionDate><text>Message on Senate action sent to the House.</text></latestAction></bill></billStatus>`;

const top = topLevel(hr2347);
ok(!/relatedBills|amendments|summaries|committeeReports/.test(top) && /<actions>/.test(top), "nested blocks (related bills, amendments, summaries, reports) cut before reading");
const B = parseBill(hr2347, 119);
ok(B.id === "hr2347" && B.n === "H.R. 2347" && B.type === "hr" && B.num === 2347, "number and type");
ok(B.t === "Bipartisan American Affordability and Jobs Act of 2026" && B.p === "BAAJA" && B.st.join() === "Survivor Justice Tax Prevention Act", "name it carries now, popular name, and its earlier short title");
ok(B.la[0] === "2026-11-24" && /sent to the House/.test(B.la[1]), "the bill's own latest action, not a related bill's or an amendment's");
ok(B.sp === "Rep. Smucker, Lloyd [R-PA-11]" && B.cs === 2 && B.pa === "Environmental Protection" && B.cm.join() === "House Ways and Means Committee", "sponsor (public record), cosponsor count, policy area, committee");
ok(B.stage === "passed-both" && STAGES[B.stage] === "Passed both chambers", "stage: passed the House, then the Senate (" + B.stage + ")");
ok(B.u === "https://www.congress.gov/bill/119th-congress/house-bill/2347", "Congress.gov link");
ok(B.steps.map((s) => s[0]).join() === "2025-03-25,2025-03-25,2026-04-09,2026-04-27,2026-11-19", "steps: introduced, referred, reported, passed House, passed Senate (" + B.steps.map((s) => s[0]).join() + ")");
ok(B.steps[0][1] === "Introduced in House" && B.steps[1][1] === "Referred to the House Committee on Ways and Means." && /^Passed the House: On motion to suspend the rules and pass the bill, as amended Agreed to by voice vote\.?$/.test(B.steps[3][1]) && /^Passed Senate with an amendment by Yea-Nay Vote\. 62 - 33/.test(B.steps[4][1]),
  "step wording: the House's own wording kept, the Senate's prefix and the Congressional Record page are dropped, one entry per date and wording");
ok(!/Moore|Example/.test(JSON.stringify(B)), "cosponsor names are not kept");

const R = ixRow(B);
ok(R[0] === "hr2347" && R[1] === "H.R. 2347" && R[3] === "BAAJA" && R[4] === "passed-both" && R[5] === "2026-11-19", "search row: id, number, name, popular name, stage, last step");
ok(chunkOf("hr", 2347) === "hr-23" && chunkOf("s", 5) === "s-0", "records are filed 100 bills to a file");

// stages
const A = (code, text, type = "Floor") => ({ code, text, type, date: "2026-01-01", src: "Library of Congress" });
ok(stageOf("hr", [A("1000", "Introduced in House")], []) === "intro", "introduced only");
ok(stageOf("hr", [A("1000", "Introduced in House"), { code: "H11100", text: "Referred to the House Committee on the Judiciary.", type: "IntroReferral", src: "House floor actions" }], []) === "committee", "referred to committee");
ok(stageOf("s", [A("10000", "Introduced in Senate"), A("14000", "Committee on Commerce. Reported by Senator X with an amendment.")], []) === "reported", "reported (Senate code)");
ok(stageOf("s", [A("17000", "Passed/agreed to in Senate: Passed Senate without amendment by Unanimous Consent.")], []) === "passed-s", "passed the Senate");
ok(stageOf("hr", [A("8000", "Passed/agreed to in House: On passage Passed")], []) === "passed-h", "passed the House");
ok(stageOf("hr", [A("8000", "x"), A("17000", "y"), A("28000", "Presented to President.")], []) === "president", "sent to the President");
ok(stageOf("hr", [A("36000", "Became Public Law No: 119-21.")], ["P.L. 119-21"]) === "law", "became law");
ok(stageOf("hjres", [A("8000", "x"), A("17000", "y"), A("28000", "Presented to President."), A("31000", "Vetoed by President.")], []) === "vetoed", "vetoed");
ok(stageOf("hres", [A("8000", "Passed/agreed to in House: On agreeing to the resolution Agreed to")], []) === "agreed", "a House resolution agreed to is done");
ok(stageOf("hconres", [A("8000", "x"), A("17000", "y")], []) === "agreed", "a concurrent resolution agreed to by both chambers is done (no President)");
ok(stageOf("hconres", [A("18000", "Failed of passage in Senate by Yea-Nay Vote. 48 - 51.")], []) === "failed", "failed on the floor");

// news rows: major steps of recent days, minus passages on a recorded vote (the floor-votes feed has those, with the tally)
const rows = recentSteps(B, "2026-04-01");
ok(rows.length === 2 && rows.every((r) => !/62 - 33/.test(r.title)), "recent major steps: reported and the House voice vote; the Senate roll-call passage is left to the votes feed (" + rows.map((r) => r.title).join(" | ") + ")");
ok(/^Congress: H\.R\. 2347, Bipartisan American Affordability and Jobs Act of 2026 \(BAAJA\): Reported \(Amended\) by the Committee on Ways and Means/.test(rows[0].title) && rows[0].link === B.u + "#step-2026-04-09" && rows[0].outlet === "Library of Congress (bill status)", "news row: number, name, popular name, step; own link; outlet");
ok(/^Stage: Passed both chambers\. Latest action \(2026-11-24\)/.test(rows[0].summary), "news row summary: stage and latest action");
ok(recentSteps(B, "2026-12-01").length === 0, "nothing older than the window");

// a law: the President's steps, the law number
function L0() { return parseBill(law.replace(/Bipartisan American Affordability and Jobs Act of 2026/g, "National Taxpayer Advocate Enhancement Act of 2025").replace(/BAAJA/g, ""), 119); }
var law = hr2347.replace("<type>HR</type>", "<type>HR</type>").replace("</actions>", act("2026-11-30", "President", "28000", "Library of Congress", "Presented to President.") + act("2026-12-02", "BecameLaw", "36000", "Library of Congress", "Became Public Law No: 119-99.") + "</actions>")
  .replace("<policyArea>", "<laws><item><type>Public Law</type><number>119-99</number></item></laws><policyArea>");
const L = parseBill(law, 119);
ok(L.stage === "law" && L.law === "P.L. 119-99" && L.steps.slice(-1)[0][1] === "Became Public Law No: 119-99.", "became law: stage, law number, last step");
// news search keeps only rows with a security, politics or public-safety word (tools/relevance.json): "Congress" is one
const fs = await import("node:fs"), { compileRelevance, itemRelevance } = await import("../tools/topics_lib.mjs");
const REL = compileRelevance(JSON.parse(fs.readFileSync("tools/relevance.json", "utf8")), JSON.parse(fs.readFileSync("tools/topics.json", "utf8")).topics);
ok([...rows, ...recentSteps(L0(), "2026-01-01")].every((r) => !["drop", "none"].includes(itemRelevance(REL, r))), "news rows pass the relevance check, a plain-named law included");
ok(parseBill("<billStatus><bill><number>0</number><type>XX</type></bill></billStatus>", 119) === null, "a file that is not a bill is skipped");

console.log(bad ? bad + " FAILED" : "all passed");
process.exit(bad ? 1 : 0);
