// UK Sanctions List (FCDO) parsing: tools/uk_sanctions.mjs. Sample rows follow the published layout of 12 Nov 2026 (no real person).
import { ukSanctionsItems } from "../tools/uk_sanctions.mjs";
let bad = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) bad++; };
const H = "Last Updated,Unique ID,OFSI Group ID,UN Reference Number,Name 6,Name 1,Name 2,Name 3,Name 4,Name 5,Name type,Alias strength,Title,Name non-latin script,Non-latin script type,Non-latin script language,Regime Name,Designation Type,Designation source,Sanctions Imposed,Other Information,UK Statement of Reasons,Address Line 1,Address Line 2,Address Line 3,Address Line 4,Address Line 5,Address Line 6,Address Postal Code,Address Country,Phone number,Website,Email address,Date Designated,D.O.B,Nationality(/ies)";
const row = (id, name, type, country) => ["04/08/2026", id, "1", "", name, "", "", "", "", "", type, "", "", "", "", "", "The Test (Sanctions) (EU Exit) Regulations 2020", "Entity", "UK", "Asset freeze", "", "", "", "", "", "", "", "", "", country, "", "", "", "29/06/2012", "", ""].join(",");
const csv = ["Report Date: 12-Nov-2026", H, row("TST0001", "EXAMPLE TRADING LLC", "Primary Name", "Iran"), row("TST0001", "EXAMPLE TRADING", "Alias", "United Arab Emirates"), row("TST0002", "SECOND EXAMPLE CO", "Primary Name", "Russia")].join("\n");
const it = ukSanctionsItems(csv);
ok(it.length === 2, "one item per Unique ID (" + it.length + ")");
ok(it[0].title === "UK-sanctioned entity: EXAMPLE TRADING LLC", "primary name in the title: " + it[0].title);
ok(it[0].ccs.includes("ir") && it[0].ccs.includes("ae") && it[0].date === "2012-06-29", "countries from every address row, date designated");
let threw = false; try { ukSanctionsItems("Report Date: x\nfoo,bar\n1,2"); } catch (e) { threw = /layout changed/.test(e.message); }
ok(threw, "a changed layout fails loudly instead of returning nothing");
console.log(bad ? bad + " FAILED" : "all passed");
process.exit(bad ? 1 : 0);
