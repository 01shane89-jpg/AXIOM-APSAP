// Public records around Army ammunition plants (tools/dense_records.mjs): plant matching, CSV streaming, no contact fields,
// court captions without private names, and record wording.
import { PLANTS, plantsIn, usaspendingItems, csvStream, samItems, SAM_KEEP, echoItems, fedregItems, courtItems, safeCaption, byDocket } from "../tools/dense_records.mjs";
let bad = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) bad++; };

ok(plantsIn("R7 START VI: IOWA ARMY AMMUNITION PLANT RESPONSE").map((p) => p.id).join() === "iaaap", "plant named in capitals is found");
ok(plantsIn("Support at IAAAP and MLAAP").map((p) => p.id).join() === "iaaap,milan", "a notice for two plants names both");
ok(plantsIn("Rock Island Arsenal").length === 0, "no plant named, none found");
ok(PLANTS.every((p) => p.lat && p.lon && p.st && p.re), "every plant has a position, state and name pattern");

// USAspending transactions (shape of spending_by_transaction, 26 Nov 2026)
const tx = { "Award ID": "68HE0726F0058", "Recipient Name": "TETRA TECH, INC.", "Transaction Amount": 1665730.83, "Action Date": "2026-11-24", Mod: "P00003",
  "Transaction Description": "R7 START VI:  IOWA ARMY AMMUNITION PLANT RESPONSE ACTIVITY TECHNICAL SUPPORT", "Awarding Agency": "Environmental Protection Agency", generated_internal_id: "CONT_AWD_68HE0726F0058_6800_68HE0725D0006_6800" };
const U = usaspendingItems([tx, tx, { ...tx, Mod: "P00002", "Action Date": "2026-11-23", "Transaction Amount": 32946.38 }]);
ok(U.length === 2, "the same action twice is one item");
ok(/^Contract action: TETRA TECH, INC\., \$1,665,731 \(modification P00003\), Iowa Army Ammunition Plant$/.test(U[0].title), "title: recipient, amount, modification, plant (" + U[0].title + ")");
ok(U[0].ccs.includes("us") && U[0].lat === 40.8 && /not a finding/.test(U[0].detail) && /usaspending\.gov\/award\/CONT_AWD_/.test(U[0].url), "placed at the plant, record wording, award link");

// SAM.gov extract: quoted fields with commas, quotes and new lines; contact columns never kept
const head = '"NoticeId","Title","Sol#","Department/Ind.Agency","Sub-Tier","Office","PostedDate","Type","ResponseDeadLine","PopCity","PopState","AwardNumber","AwardDate","Award$","Awardee","PrimaryContactFullname","PrimaryContactEmail","PrimaryContactPhone","Link","Description"\n';
const line = '"3f01e8","Telecommunications Fiber Optic Upgrades at Iowa Army Ammunition Plant","W519TC-27-R-IA03","DEPT OF DEFENSE","DEPT OF THE ARMY","W6QK ACC-RI","2026-10-22 10:08:48","Combined Synopsis/Solicitation","2026-12-10T17:00:00-06:00","Middletown","IA","","","","","A. Person","a.person@army.mil","555-0100","https://sam.gov/workspace/contract/opp/3f01e8/view","A requirement for ""fiber"", at IAAAP,\nsecond line."\n';
const other = '"zz9","Janitorial services, Fort Example","X1","DEPT OF DEFENSE","DEPT OF THE ARMY","OFF","2026-11-01 09:00:00","Solicitation","","","","","","","","B. Person","b@x.mil","555","https://sam.gov/x","Cleaning."\n';
const rows = []; let H = null;
const push = csvStream((f) => { if (!H) { H = f; return; } rows.push(Object.fromEntries(H.map((h, i) => [h, f[i]]))); });
const all = head + line + other; push(all.slice(0, 333), false); push(all.slice(333), true);
ok(rows.length === 2 && rows[0].Description === 'A requirement for "fiber", at IAAAP,\nsecond line.', "CSV: a row split across chunks, quotes, commas and a new line inside a field");
const kept = rows.map((r) => Object.fromEntries(SAM_KEEP.filter((k) => k in r).map((k) => [k, r[k]])));
const S = samItems(kept);
ok(S.length === 1 && /^Combined Synopsis\/Solicitation: Telecommunications Fiber Optic Upgrades at Iowa Army Ammunition Plant \(W519TC-27-R-IA03\)$/.test(S[0].title), "only the notice that names a plant is kept (" + (S[0] || {}).title + ")");
ok(!/Person|@|555/.test(JSON.stringify(S)) && !SAM_KEEP.some((k) => /Contact/.test(k)), "no contact name, email or phone reaches an item");
ok(S[0].date === "2026-10-22T10:08" && /Responses due 2026-12-10/.test(S[0].detail) && S[0].url.startsWith("https://sam.gov/"), "posted time, due date and SAM.gov link");

// ECHO facility rows (get_qid, 26 Nov 2026)
const E = echoItems([{ FacName: "US ARMY IOWA ARMY AMMUNITION PLANT", RegistryID: "110041994973", FacComplianceStatus: "Violation Identified", CWAComplianceStatus: "Violation Identified", RCRAComplianceStatus: "Violation",
  FacQtrsWithNC: "12", FacInspectionCount: "12", FacDateLastInspection: "04/14/2026", FacFormalActionCount: "3", FacTotalPenalties: "$78,622", FacDateLastPenalty: "09/27/2024" },
  { FacName: "IOWA ARMY AMMUNITION PLANT SLF", FacInspectionCount: "0", FacFormalActionCount: "0", FacTotalPenalties: "$0" }], PLANTS[0]);
ok(E.length === 1 && /penalties \$78,622/.test(E[0].title) && E[0].sev === 2 && /as logged by EPA/.test(E[0].detail), "ECHO: facility with a record kept, empty one left out, violation is severity 2");

const F = fedregItems([{ title: "Air Plan Approval; Iowa", type: "Proposed Rule", publication_date: "2026-08-14", agencies: [{ name: "Environmental Protection Agency" }], html_url: "https://www.federalregister.gov/documents/x", document_number: "2026-1", abstract: "Near the Iowa Army Ammunition Plant." }]);
ok(fedregItems([{ title: "Arms Sales Notification", type: "Notice", document_number: "2026-2", agencies: [] }], PLANTS[5])[0].lat === 34.83, "Federal Register: placed at the plant it was searched for");
ok(F[0].title === "Proposed Rule: Air Plan Approval; Iowa" && F[0].lat === 40.8 && /Environmental Protection Agency/.test(F[0].detail), "Federal Register: type, agency and plant");

// CourtListener Atom feed
const atom = '<feed><entry><title>Iowa Environmental Council v. EPA</title><link href="https://www.courtlistener.com/docket/1/a/" rel="alternate"/><published>2026-11-23T00:00:00-06:00</published><author><name>Court of Appeals for the Eighth Circuit</name></author></entry>'
  + '<entry><title>Smith v. Jones</title><link href="https://www.courtlistener.com/docket/2/b/" rel="alternate"/><published>2026-11-20T00:00:00-06:00</published><author><name>District Court, S.D. Iowa</name></author></entry>'
  + '<entry><title>Bad link v. EPA</title><link href="https://evil.example/x" rel="alternate"/><published>2026-11-20T00:00:00-06:00</published></entry></feed>';
const C = courtItems(atom, PLANTS[0], "Federal court docket entry (RECAP)");
ok(C.length === 2 && C[0].title === "Iowa Environmental Council v. EPA, Court of Appeals for the Eighth Circuit", "court: caption and court (" + (C[0] || {}).title + ")");
ok(C[1].title === "Court filing, District Court, S.D. Iowa", "a caption of two private names is not shown (" + (C[1] || {}).title + ")");
ok(!/Smith|Jones/.test(JSON.stringify(C)) && C.every((x) => /allege is not a finding/.test(x.detail)), "no private names; allegation wording");
const D = byDocket([...C, { ...C[0], url: "https://www.courtlistener.com/docket/1/c/", date: "2026-11-24T00:00:00-06:00" }]);
ok(D.length === 2 && D[0].url.endsWith("/docket/1/c/") && /^2 recent entries\./.test(D[0].detail), "one item per docket: its newest entry and the entry count");
ok(!/ 0 of the last| 0 inspections/.test(JSON.stringify(echoItems([{ FacName: "X", RegistryID: "1", FacComplianceStatus: "No Violation Identified", FacQtrsWithNC: "0", FacInspectionCount: "1", FacFormalActionCount: "0", FacTotalPenalties: "$0" }], PLANTS[1]))), "ECHO: zero counts are not printed");
ok(safeCaption("United States v. Tyron Young") === "United States v. Tyron Young", "a criminal case brought by the United States keeps its caption");

if (bad) { console.log(bad + " failed"); process.exit(1); }
console.log("all passed");
