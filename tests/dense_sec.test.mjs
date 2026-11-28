// SEC EDGAR Item 1.05 feed (tools/dense_sec.mjs): only filings EDGAR tags 1.05, one item per filing, companies only.
import { company, secItems, SEC_UA } from "../tools/dense_sec.mjs";
let bad = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) bad++; };

ok(/^Axiom Intelligence Systems support@axiom-intelligence-systems\.com$/.test(SEC_UA), "declares the company and the support@ contact, as the SEC asks");
ok(JSON.stringify(company("Park Dental Partners, Inc. (PARK) (CIK 0002069604)")) === '{"name":"Park Dental Partners, Inc.","ticker":"PARK"}', "name and ticker from an EDGAR display name");
ok(JSON.stringify(company("KAVILCO INC/WA/ (CIK 0000859765)")) === '{"name":"KAVILCO INC","ticker":""}', "state suffix and CIK dropped, no ticker");

const hit = (id, src) => ({ _id: id, _source: { root_forms: ["8-K"], form: "8-K", file_date: "2026-10-13", period_ending: "2026-10-07", biz_locations: ["Roseville, MN"], ...src } });
const I = secItems([
  hit("0001104659-26-115541:park-20261007x8k.htm", { ciks: ["0002069604"], adsh: "0001104659-26-115541", display_names: ["Park Dental Partners, Inc. (PARK) (CIK 0002069604)"], items: ["1.05"] }),
  hit("0001104659-26-115541:ex99-1.htm", { ciks: ["0002069604"], adsh: "0001104659-26-115541", display_names: ["Park Dental Partners, Inc. (PARK) (CIK 0002069604)"], items: ["1.05"] }),
  hit("0000859765-26-000011:form8k.htm", { ciks: ["0000859765"], adsh: "0000859765-26-000011", display_names: ["KAVILCO INC/WA/ (CIK 0000859765)"], items: ["5.03", "5.07"] }),
  hit("0001831631-26-000113:ex991.htm", { ciks: ["0001831631"], adsh: "0001831631-26-000113", display_names: ["loanDepot, Inc. (LDI) (CIK 0001831631)"], items: ["2.02", "7.01", "9.01"] }),
  hit("0001193125-24-147625:d774339d8ka.htm", { ciks: ["0000790816"], adsh: "0001193125-24-147625", form: "8-K/A", file_date: "2024-05-28", display_names: ["BRANDYWINE REALTY TRUST (BDN) (CIK 0000790816)"], items: ["1.05"] }),
  hit("bad:x.htm", { ciks: ["1"], adsh: "../../etc", display_names: ["X (CIK 1)"], items: ["1.05"] }),
]);
ok(I.length === 2, "only Item 1.05 filings, one per filing, a malformed accession dropped (" + I.length + ")");
ok(I[0].title === "Material cybersecurity incident reported to the SEC: Park Dental Partners, Inc. (PARK)" && I[0].sev === 2, "a new Item 1.05 report");
ok(I[0].url === "https://www.sec.gov/Archives/edgar/data/2069604/000110465926115541/park-20261007x8k.htm", "links the filing on sec.gov");
ok(/company's own account/.test(I[0].detail) && /event date 2026-10-07/.test(I[0].detail), "says the account is the company's claim");
ok(/^Update to a material cybersecurity incident report \(SEC\): BRANDYWINE REALTY TRUST \(BDN\)$/.test(I[1].title) && I[1].sev === 1, "an 8-K/A is an update");
ok(!/KAVILCO|loanDepot/.test(JSON.stringify(I)), "words-only matches (governance 8-K, earnings release) are left out");
if (bad) { console.log(bad + " failed"); process.exit(1); }
console.log("all passed");
