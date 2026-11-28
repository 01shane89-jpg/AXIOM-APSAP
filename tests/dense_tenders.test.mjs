// EU TED defence notices and the largest USAspending contract actions (tools/dense_tenders.mjs)
import { tedItems, bigItems } from "../tools/dense_tenders.mjs";
let bad = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) bad++; };

const n = (pub, cpv, buyer, extra = {}) => ({ "publication-number": pub, "classification-cpv": cpv, "buyer-name": { eng: [buyer] }, "buyer-country": ["POL"], "publication-date": "2026-11-20+01:00", "notice-type": "can-standard",
  "notice-title": { eng: "Poland – Command, control, communication and computer systems – Key management" }, "total-value": 284753241, "total-value-cur": ["PLN"], ...extra });
const T = tedItems([
  n("808853-2026", ["35710000", "48000000"], "Centrum Zasobów Cyberprzestrzeni Sił Zbrojnych"),
  n("808853-2026", ["35710000"], "duplicate"),
  n("808301-2026", ["35811000", "18100000"], "Ville de Lille", { "buyer-country": ["FRA"] }),
  n("808993-2026", ["35815100"], "MINARM/SCA/PFC-RBT", { "buyer-country": ["FRA"] }),
  n("808994-2026", ["35113400"], "Some fire brigade"),
  n("808995-2026", ["35710000"], "No country", { "buyer-country": [] }),
  n("../x", ["35710000"], "bad id"),
]);
ok(T.length === 2, "military codes only, no duplicate, no civil-only 358 buyer, fire gear (351) left out, country required, bad id dropped (" + T.length + ")");
ok(T[0].title === "Contract award for military electronic systems: Centrum Zasobów Cyberprzestrzeni Sił Zbrojnych, 284,753,241 PLN" && T[0].ccs.join() === "pl", "type, kind, buyer, value, country (" + T[0].title + ")");
ok(T[0].url === "https://ted.europa.eu/en/notice/-/detail/808853-2026" && /not a finding/.test(T[0].detail) && /Source: TED/.test(T[0].detail), "TED link, caveat and acknowledgement");
ok(T[1].ccs.join() === "fr" && /soldier and support equipment: MINARM/.test(T[1].title), "body armour for the French defence ministry is kept");

const r = (amt, extra = {}) => ({ "Award ID": "A1", "Recipient Name": "CENTRAL PLATEAU CLEANUP COMPANY, LLC", "Transaction Amount": amt, "Action Date": "2026-11-23", "Transaction Description": "HANFORD CLEANUP  TASK ORDER 7. ", Mod: "P00012",
  "Awarding Agency": "Department of Energy", "Awarding Sub Agency": "Department of Energy", generated_internal_id: "CONT_AWD_X_" + amt, pop_country_name: "UNITED STATES", pop_city_name: "RICHLAND", pop_state_code: "WA", ...extra });
const B = bigItems([r(101808889), r(101808889), r(40000000), r(-2e9), r(75e6, { pop_country_name: "POLAND", pop_city_name: "WARSAW", pop_state_code: null })]);
ok(B.length === 3, "$50M and up either way, one per action (" + B.length + ")");
ok(B[0].title === "Contract action $101,808,889: CENTRAL PLATEAU CLEANUP COMPANY, LLC, Department of Energy" && B[0].ccs.join() === "us" && /Work performed in RICHLAND, WA/.test(B[0].detail), "amount, recipient, agency, place");
ok(/\(reduction\)/.test(B[1].title) && B[1].sev === 2, "a $2 billion reduction is marked and ranked high");
ok(B[2].ccs.join() === "us,pl" && /WARSAW, POLAND/.test(B[2].detail), "work abroad is placed on that country too");
if (bad) { console.log(bad + " failed"); process.exit(1); }
console.log("all passed");
