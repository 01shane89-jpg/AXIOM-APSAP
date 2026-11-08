// Unit test of the figure, name and death checks on event-summary drafts (tools/evsum_lib.mjs): a draft may only give figures its reports give.
// Run: node tests/evsum_lib.test.mjs
import { unsupportedFigures, unsupportedNames, unsupportedDeaths, normCites, figureContext } from "../tools/evsum_lib.mjs";
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const input = [
  { n: 1, time: "2026-10-16T17:00", headline: "Si Sakhon, police attack on gang of Narathiwat 1 dead and 2 injured", place: "Si Sakhon district" },
  { n: 2, time: "2026-10-17T04:53", headline: "Four killed, two injured in exchange of gunfire in Narathiwat", text: "Police said 1,200 rounds were fired." },
];
const draft = (summary, points = [], differ = [], unclear = "") => ({ summary, points, differ, unclear });
ok(!unsupportedFigures(draft("Police said 1 died and 2 were injured at 17:00 [1]. Another outlet said four were killed [2]."), input).length, "figures given by the reports pass, spelled-out numbers too");
ok(!unsupportedFigures(draft("Police said 4 were killed [2]."), input).length, "a spelled-out figure written in digits passes");
ok(!unsupportedFigures(draft("About 1,200 rounds were fired, police said [2]."), input).length, "thousands separators are read alike");
const bad = unsupportedFigures(draft("Police said 5 people died [1][2].", [{ text: "In total 6 casualties [1][2]", refs: [1, 2] }]), input);
ok(bad.includes("5") && bad.includes("6"), "a total or figure no report gives is caught: " + bad.join(", "));
ok(!unsupportedFigures(draft("Reported in [1] and [2]."), input).length, "citation numbers are not figures");
const names = unsupportedNames(draft("On 16 October police in Si Sakhon said a gang fired on officers [1]. Prime Minister Ismail Sabri Yaakob was briefed, according to Lieutenant General Wang [2]."), input);
ok(names.includes("Ismail") && names.includes("Wang") && !names.includes("Si") && !names.includes("October") && !names.includes("On"), "names no report gives are caught, sentence starts and months are not: " + names.join(", "));
ok(!unsupportedNames(draft("Police said a Narathiwati gang fired [2]. Reports said Malaysian police were told [1]."), [{ headline: "Malaysia police told of Narathiwat gang" }]).length, "a demonym of a reported place passes");
ok(!unsupportedNames(draft("Talks between the two Koreas were raised [1]. Reports quoted Badr' and Badr's aides [1]."), [{ headline: "Korea talks; Badr aides speak" }]).length, "plurals and stray quote marks on a reported name pass");
ok(!unsupportedNames(draft("Police said a gang in Narathiwat fired 1,200 rounds [2]. Four were killed, police said [2]."), input).length, "names from the reports pass");
const calm = [{ n: 1, source: "The Star", headline: "Student attacks teacher with axe in Kuching", text: "The teacher was injured." }];
ok(unsupportedDeaths(draft("A student attacked a teacher in Kuching; at least one person died [1]."), calm), "a death no report mentions is caught");
ok(!unsupportedDeaths(draft("The Star reported a teacher was injured in Kuching [1]."), calm), "no death, no flag");
ok(!unsupportedDeaths(draft("Police said four were killed [2]."), input), "a death the reports give passes");
// citation forms a small model writes instead of [6][7] are not figures (8 Nov 2026: every draft of a run was rejected for them)
ok(normCites("Police said [1, 2] that", 2) === "Police said [1][2] that", "[1, 2] becomes [1][2]");
ok(normCites("as [1-2] said", 2) === "as [1][2] said", "a range [1-2] becomes [1][2]");
ok(normCites("[Report 2] and (1) said", 2) === "[2] and [1] said", "[Report 2] and (1) become citations");
ok(normCites("reports 1 and 2 said", 2) === "the reports [1][2] said", "running-text 'reports 1 and 2' becomes a citation");
ok(normCites("Report 2 said 4 were killed", 2) === "a report [2] said 4 were killed", "'Report 2 said' keeps its figure");
ok(normCites("aged (24) in (2026) per [9]", 2) === "aged (24) in (2026) per [9]", "numbers above the report count are left alone");
ok(!unsupportedFigures(draft(normCites("Police said four were killed [1, 2]. Reports 1 and 2 agree.", 2)), input).length, "a draft citing as [1, 2] passes once normalised");
ok(unsupportedFigures(draft(normCites("Police said 7 were killed [1, 2].", 2)), input).join() === "7", "an invented figure is still caught after normalising");
ok(/7 were killed/.test(figureContext(draft("Police said 7 were killed [1]."), "7")), "the log shows where a rejected figure sits");
if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("all passed");
