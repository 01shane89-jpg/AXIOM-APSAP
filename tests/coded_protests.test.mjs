// Coded event history, protests and riots (tools/refresh_coded_protests.mjs, assets/osap-cf-code.js fromMm): the Mass Mobilization
// file is read column by name, only protests are kept, Correlates-of-War country names map to the page's countries (an unknown one
// is counted, never guessed), and each protest is coded by fixed rules into the record's categories as a dataset coding with its
// licence. No death figures are invented. Usage: node tests/coded_protests.test.mjs
import assert from "node:assert/strict";
import CODE from "../assets/osap-cf-code.js";
import { readMm, ccOf } from "../tools/refresh_coded_protests.mjs";

const H = "id,country,ccode,year,region,protest,protestnumber,startday,startmonth,startyear,endday,endmonth,endyear,protesterviolence,location,participants_category,participants,protesteridentity,protesterdemand1,protesterdemand2,protesterdemand3,protesterdemand4,stateresponse1,stateresponse2,stateresponse3,stateresponse4,stateresponse5,stateresponse6,stateresponse7,sources,notes";
const row = (o) => [o.id, o.country, 1, 1991, "x", o.protest ?? 1, 1, o.d ?? 3, 9, 1991, o.ed ?? 3, 9, 1991, o.v ?? 0, '"' + (o.loc ?? "Bangkok") + '"', "1000-1999", "1000s", '"' + (o.who ?? "students") + '"',
  '"labor wage dispute"', '"price increases, tax policy"', "", "", ...(o.resp ?? ["ignore", "", "", "", "", "", ""]), '"src, with comma"', '"note\nwith line break"'].join(",");
const csv = [H, row({ id: "1" , country: "Thailand", resp: ["arrests", "crowd dispersal", "", "", "", "", ""] }), row({ id: "2", country: "Congo Kinshasa", v: 1, resp: ["killings", "", "", "", "", "", ""] }),
  row({ id: "3", country: "Narnia" }), row({ id: "4", country: "Thailand", protest: 0 }), row({ id: "5", country: "Thailand", d: 0 }), row({ id: "6", country: "Burma", resp: ["shootings", "", "", "", "", "", ""] }),
  row({ id: "7", country: "Thailand", ed: 5 })].join("\n") + "\n";
const { recs, skipped } = readMm(csv);
assert.deepEqual(recs.map((r) => r.id), ["1", "2", "6", "7"]);
assert.equal(skipped.not_protest, 1); assert.equal(skipped.no_date, 1); assert.deepEqual(skipped.no_country, { Narnia: 1 }, "an unknown country is counted, not guessed");
assert.equal(recs[0].cc, "th"); assert.equal(recs[1].cc, "cd"); assert.equal(recs[2].cc, "mm");
assert.equal(recs[0].end, "", "same-day end left blank"); assert.equal(recs[3].end, "1991-09-05");
assert.deepEqual(recs[0].responses, ["arrests", "crowd dispersal"]);
assert.ok(recs[0].demands.includes("price increases, tax policy"), "quoted cells with commas read whole");
assert.ok(!("notes" in recs[0]) && !("sources" in recs[0]), "the dataset's source and note text is not kept");
assert.throws(() => readMm("id,country\n1,x\n"), /columns missing/);
for (const [n, c] of [["Congo Brazzaville", "cg"], ["Bosnia", "ba"], ["Ivory Coast", "ci"], ["Kosovo", "xk"], ["Germany West", "de"], ["Thailand", "th"]]) assert.equal(ccOf(n), c, n);

// coding rules
assert.deepEqual(CODE.mmCode(1, "ignore"), ["Riots", "Violent demonstration"]);
assert.deepEqual(CODE.mmCode(0, "shootings"), ["Protests", "Excessive force against protesters"]);
assert.deepEqual(CODE.mmCode(0, "beatings; arrests"), ["Protests", "Excessive force against protesters"]);
assert.deepEqual(CODE.mmCode(0, "arrests"), ["Protests", "Protest with intervention"]);
assert.deepEqual(CODE.mmCode(0, "crowd dispersal"), ["Protests", "Protest with intervention"]);
assert.deepEqual(CODE.mmCode(0, "accomodation; ignore"), ["Protests", "Peaceful protest"]);
for (const t of [["Riots", "Violent demonstration"], ["Protests", "Excessive force against protesters"], ["Protests", "Protest with intervention"], ["Protests", "Peaceful protest"]]) assert.ok(CODE.isSub(t[0], t[1]), t.join(" · ") + " is in the record's list");
const r = ["1", "1991-09-03", "", 13.75, 100.5, 2, 0, "Bangkok", "Bangkok", "1000-1999", "students", "labor wage dispute", "arrests; crowd dispersal"];
const c = CODE.fromMm(r, {}, "cc/th");
assert.equal(c.record_basis, "dataset_coded"); assert.equal(c.dataset, "mm_protest"); assert.equal(c.licence, "CC0 1.0"); assert.equal(c.non_commercial, 0);
assert.equal(c.event_type, "Protests"); assert.equal(c.sub_event_type, "Protest with intervention");
assert.equal(c.inter1, "Protesters"); assert.equal(c.inter2, "State forces"); assert.equal(c.actor1, "Protesters (students)");
assert.equal(c.fatalities_best, "", "no death figure invented"); assert.equal(c.fatalities_basis, "not recorded by the dataset");
assert.equal(c.sha256_input, "mm|1|1991-09-03||Bangkok|0|arrests; crowd dispersal");
const n = CODE.fromMm(["9", "1995-01-01", "", null, null, 3, 0, "national", "", "", "", "", "ignore"], {}, "cc/th");
assert.equal(n.inter2, ""); assert.equal(n.interaction, "Protesters only"); assert.equal(n.latitude, ""); assert.equal(n.geo_precision, 3);
const ec = CODE.evCsv([c, n]).split("\r\n");
assert.equal(ec.length, 4); assert.ok(ec[0].includes("state_response"));
console.log("coded_protests: all checks passed");
