// Unit test of the figure check on event-summary drafts (tools/evsum_lib.mjs): a draft may only give figures its reports give.
// Run: node tests/evsum_lib.test.mjs
import { unsupportedFigures } from "../tools/evsum_lib.mjs";
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
if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("all passed");
