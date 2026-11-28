// FARA registrations and lobbying filings with a foreign link (tools/dense_influence.mjs): firms and governments are named,
// people never are; record wording; only foreign-linked lobbying filings.
import { isPerson, shown, faraItems, ldaItems } from "../tools/dense_influence.mjs";
let bad = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) bad++; };
ok(isPerson("Vernick, Victor") && isPerson("Shanga, Gilbert") && !isPerson("The Ragnar Group, LLC") && !isPerson("Wiss & Partners LLP"), "\"Last, First\" is a person, a firm is not");
ok(shown("THOMAS VAN DER HEYDEN", "Private individual") === "an individual (name not shown)", "a private individual client is not named");
ok(shown("JOHN DOE", "Businessman") === "a client (name not shown)" && shown("METALLIC MINERALS", "Copper, Gold, Silver Mining Company") === "METALLIC MINERALS", "a bare name is not named; an organisation name is");
ok(shown("LEAK YIM", "Owner of a holding company") === "a client (name not shown)" && shown("KIRIL DOMUSCHIEV AND GEORGI DOMUSCHIEF", "Business owners") === "a client (name not shown)", "people whose description mentions a company are still not named (lda.gov probe 27 Nov)");
ok(shown("ALI AZEMI F/B/O UNION ASSOCIATION OF IMK EX-STEEL PIPE FACTORY EMPLOYEES") === "a client (name not shown)", "a name with a person inside it (f/b/o) is not named");
ok(shown("Embassy of the Republic of Korea") === "Embassy of the Republic of Korea" && shown("Telekom Srbija a.d. Beograd") === "Telekom Srbija a.d. Beograd", "governments and companies are named");

const regs = [{ Registration_Number: 7808, Name: "The Ragnar Group, LLC", Registration_Date: "11/24/2026" }, { Registration_Number: 7790, Name: "Vernick, Victor", Registration_Date: "10/30/2026" }];
const F = faraItems(regs, { 7808: [{ FP_NAME: "Telekom Srbija a.d. Beograd", COUNTRY_NAME: "SERBIA" }], 7790: [{ FP_NAME: "Government of the Republic of Ghana", COUNTRY_NAME: "GHANA" }, { FP_NAME: "Kwame Mensah", COUNTRY_NAME: "GHANA" }] },
  { 7808: [{ DOCUMENT_TYPE: "Short-Form", URL: "https://efile.fara.gov/docs/7808-Short-Form-20261124-1.pdf", SHORT_FORM_NAME: "Wasinger, Robert" }, { DOCUMENT_TYPE: "Registration Statement", URL: "https://efile.fara.gov/docs/7808-Registration-Statement-20261124-1.pdf" }] });
ok(F[0].title === "Foreign agent registration (FARA): The Ragnar Group, LLC for Telekom Srbija a.d. Beograd (Serbia)" && F[0].date === "2026-11-24" && F[0].ccs.join() === "us,rs", "FARA title, date and countries (" + F[0].title + ")");
ok(F[0].url.endsWith("Registration-Statement-20261124-1.pdf") && /not a finding of wrongdoing/.test(F[0].detail), "the registration statement is linked; record wording");
ok(/^Foreign agent registration \(FARA\): an individual \(name not shown\) for Government of the Republic of Ghana \(Ghana\) and 1 more$/.test(F[1].title) && /one principal whose name is not shown/.test(F[1].detail), "an individual registrant and a person principal are not named");
ok(!/Vernick|Wasinger|Mensah/.test(JSON.stringify(F)), "no person's name in any FARA item");

const base = { filing_document_url: "https://lda.gov/filings/public/filing/x/print/", filing_type_display: "Registration", dt_posted: "2026-11-25T16:37:07-05:00", posted_by_name: "Robert J. Bissen",
  registrant: { name: "MONUMENT ADVOCACY", description: "Government relations firm", contact_name: "BOB BISSEN", contact_telephone: "+1 202-438-0737" }, lobbying_activities: [{ general_issue_code_display: "Fuel/Gas/Oil", description: "Issues related to the Jones Act waiver request.", lobbyists: [{ lobbyist: { first_name: "Jane", last_name: "Roe" } }] }] };
const L = ldaItems([{ ...base, client: { name: "NESTE US, INC.", country: "US", general_description: "Energy company" }, foreign_entities: [{ name: "NESTE OYJ", country: "FI", country_display: "Finland", ownership_percentage: "100.00" }] },
  { ...base, client: { name: "THOMAS VAN DER HEYDEN", country: "ID", country_display: "Indonesia", general_description: "Private individual" }, foreign_entities: [] },
  { ...base, client: { name: "HEAD START ASSOCIATION", country: "US" }, foreign_entities: [] },
  { ...base, filing_document_url: "https://evil.example/x", client: { name: "X CORP", country: "CN" }, foreign_entities: [] }]);
ok(L.length === 2, "only filings with a foreign link and an lda.gov document");
ok(L[0].title === "Lobbying filing with a foreign link: MONUMENT ADVOCACY for NESTE US, INC." && /NESTE OYJ \(Finland, 100% owner\)/.test(L[0].detail) && L[0].ccs.join() === "us,fi" && /Jones Act/.test(L[0].detail), "client, foreign owner, issue (" + L[0].title + ")");
ok(L[1].title === "Lobbying filing with a foreign link: MONUMENT ADVOCACY for an individual (name not shown)" && L[1].ccs.join() === "us,id", "a private individual client is not named");
ok(!/Jones Act/.test(L[1].detail) && /Fuel\/Gas\/Oil/.test(L[1].detail), "an unnamed client keeps the issue area but not the filer's words about the person");
ok(!/Bissen|BISSEN|Roe|Jane|202-438|HEYDEN|Heyden/i.test(JSON.stringify(L)), "no filer, contact, lobbyist or private client name, no phone number");
if (bad) { console.log(bad + " failed"); process.exit(1); }
console.log("all passed");
