// UK written ministerial statements (tools/dense_statements.mjs): item wording, page link, countries named, bad rows left out.
import { statementItems } from "../tools/dense_statements.mjs";
let bad = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) bad++; };
const row = { value: { id: 1964599, uin: "HLWS519", dateMade: "2026-11-26T00:00:00", house: "Lords", title: "Local Government Finance", memberRole: "Minister for Housing and Local Government",
  member: { name: "Baroness Taylor of Stevenage" }, answeringBodyName: "Ministry of Housing, Communities and Local Government",
  text: "<p>My Honourable Friend the Minister has today made the following statement:</p><p>Local government is at the heart of this Government&rsquo;s ambition.</p>" } };
const I = statementItems([row, { value: { ...row.value, title: "Support for Ukraine", uin: "HCWS100", house: "Commons", text: "<p>The UK will provide further air defence to Ukraine.</p>" } },
  { value: { title: "No date", uin: "HCWS1" } }, { value: { ...row.value, uin: "../x" } }, null]);
ok(I.length === 2, "rows without a date or a proper statement number are left out");
ok(I[0].title === "UK written statement: Local Government Finance (Ministry of Housing, Communities and Local Government)", "title (" + I[0].title + ")");
ok(I[0].url === "https://questions-statements.parliament.uk/written-statements/detail/2026-11-26/HLWS519" && I[0].date === "2026-11-26", "the statement's own page and date");
ok(/Made to the House of Lords by Minister for Housing and Local Government, Baroness Taylor of Stevenage, HLWS519\./.test(I[0].detail) && /own statement to Parliament, not a finding/.test(I[0].detail) && !/<p>/.test(I[0].detail), "who made it, plain text, statement wording");
ok(I[0].ccs.join() === "gb" && I[1].ccs.join() === "gb,ua", "the UK, plus a country the statement names");
if (bad) { console.log(bad + " failed"); process.exit(1); }
console.log("all passed");
