// U.S. export-control rules from BIS (tools/dense_trade.mjs): paperwork left out, named countries get the item.
import { bisItems } from "../tools/dense_trade.mjs";
let bad = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) bad++; };
// shapes from the Federal Register API, 26 Nov 2026
const R = bisItems([
  { title: "Additions to the Entity List", type: "Rule", publication_date: "2026-11-25", html_url: "https://www.federalregister.gov/documents/2026/11/25/2026-23999/additions-to-the-entity-list",
    pdf_url: "https://www.govinfo.gov/content/pkg/FR-2026-11-25/pdf/2026-23999.pdf", document_number: "2026-23999",
    abstract: "In this rule, the Bureau of Industry and Security (BIS) amends the Export Administration Regulations (EAR) by adding 7 entities to the Entity List, under the destinations of Malaysia, Singapore, and Thailand." },
  { title: "Agency Information Collection Activities; Submission to the Office of Management and Budget (OMB) for Review and Approval", type: "Notice", publication_date: "2026-11-23", document_number: "2026-23758" },
  { title: "Addressing Remote Access to Advanced Semiconductors", type: "Rule", publication_date: "2026-11-19", html_url: "https://www.federalregister.gov/documents/2026/11/19/2026-23529/x", document_number: "2026-23529", effective_on: "2026-11-19", abstract: null },
]);
ok(R.length === 2, "paperwork notice left out");
ok(R[0].title === "BIS rule: Additions to the Entity List" && R[0].kind === "Export control listing (BIS)" && R[0].sev === 2, "Entity List rule: title, kind, severity");
ok(["us", "my", "sg", "th"].every((c) => R[0].ccs.includes(c)) && R[0].ccs.length === 4, "goes to the U.S. and each destination named (" + R[0].ccs + ")");
ok(/U\.S\. government's determination/.test(R[0].detail) && /2026-23999, official PDF on govinfo/.test(R[0].detail), "determination wording and the official PDF");
ok(R[1].ccs.join() === "us" && /Effective 2026-11-19/.test(R[1].detail) && R[1].kind === "Export control rule (BIS)", "a rule naming no country goes to the U.S. only, with its effective date");
if (bad) { console.log(bad + " failed"); process.exit(1); }
console.log("all passed");
