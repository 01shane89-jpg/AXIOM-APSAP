// Coded event history, machine-coded protests after 2020 (tools/refresh_coded_polecat.mjs, assets/osap-cf-code.js fromPolecat):
// POLECAT lines are read column by name, only PROTEST events from 2021 on are kept, a protester the software read as police,
// military or government is left out and counted, an unknown country is counted (never guessed), events of the same day, place
// and mode merge into one row, and every row is a dataset coding tagged machine-coded with its licence. No names, no story text.
// Usage: node tests/coded_polecat.test.mjs
import assert from "node:assert/strict";
import CODE from "../assets/osap-cf-code.js";
import { readRow, merge, precOf, ccOfPc } from "../tools/refresh_coded_polecat.mjs";

const COLS = ["Event ID", "Event Date", "Event Type", "Event Mode", "Country", "Latitude", "Longitude", "Feature Type", "City", "Province", "Placename",
  "Primary Actor Sector", "Actor Title", "Actor Name", "Primary Recipient Sector", "Recipient Country", "Story Text"];
const h = {}; COLS.forEach((k, i) => { h[k] = i; });
const line = (o) => COLS.map((k) => (k in o ? o[k] : { "Event ID": "e1", "Event Date": "2021-03-01", "Event Type": "PROTEST", "Event Mode": "demo", Country: "Thailand",
  Latitude: "13.7563", Longitude: "100.5018", "Feature Type": "PPLC", City: "Bangkok", Province: "Bangkok", Placename: "Bangkok", "Primary Actor Sector": "CVL",
  "Actor Title": "Student", "Actor Name": "Somchai Example", "Primary Recipient Sector": "GOV", "Recipient Country": "Thailand", "Story Text": "Students marched..." }[k]));

// kept and left out
const a = readRow(line({}), h);
assert.equal(a.cc, "th"); assert.equal(a.date, "2021-03-01"); assert.equal(a.mode, "demo"); assert.equal(a.riot, 0); assert.equal(a.prec, 2);
assert.equal(a.place, "Bangkok", "city and province are not repeated"); assert.equal(a.role, "student"); assert.equal(a.target, "GOV · Thailand");
assert.ok(!JSON.stringify(a).includes("Somchai") && !JSON.stringify(a).includes("marched"), "no person's name, no story text");
assert.equal(readRow(line({ "Event Type": "ASSAULT" }), h).skip, "not_protest");
assert.equal(readRow(line({ "Event Date": "2020-12-31" }), h).skip, "before_2021", "Mass Mobilization covers up to 2020");
assert.equal(readRow(line({ "Event Date": "soon" }), h).skip, "no_date");
for (const s of ["COP", "MIL", "GOV"]) assert.equal(readRow(line({ "Primary Actor Sector": s }), h).skip, "actor_state_forces", s);
assert.deepEqual(readRow(line({ Country: "Narnia" }), h), { skip: "no_country", country: "Narnia" }, "an unknown country is counted, not guessed");
assert.deepEqual(readRow(line({ Country: "None" }), h), { skip: "no_country", country: "(none)" });
const riot = readRow(line({ "Event Mode": "riot" }), h); assert.equal(riot.riot, 1);
assert.equal(readRow(line({ "Event Mode": "None" }), h).mode, "");
// position: a town is drawn, a province or a whole country is not
assert.equal(precOf("PPLA"), 2); assert.equal(precOf("ADM2"), 2); assert.equal(precOf("ADM1"), 3); assert.equal(precOf("PCLI"), 0); assert.equal(precOf(""), 0);
const prov = readRow(line({ "Feature Type": "ADM1", City: "None" }), h); assert.equal(prov.prec, 3); assert.equal(prov.lat, 13.7563, "a province keeps its point but is not drawn");
const ctry = readRow(line({ "Feature Type": "PCLI", City: "None", Province: "None" }), h); assert.equal(ctry.lat, null); assert.equal(ctry.prec, 3); assert.equal(ctry.place, "Bangkok");
assert.equal(readRow(line({ Latitude: "0", Longitude: "0" }), h).lat, null, "0,0 is no position");
assert.equal(readRow(line({ "Actor Title": "<script>" }), h).role, "", "a role must be plain words");

// POLECAT gives ISO alpha-3 codes
for (const [a, c] of [["THA", "th"], ["AFG", "af"], ["PSE", "ps"], ["HKG", "cn"], ["KOS", "xk"], ["XKX", "xk"], ["Thailand", "th"]]) assert.equal(ccOfPc(a), c, a);
assert.equal(ccOfPc("ZZZ"), null, "an unknown code is counted, not guessed");
assert.equal(readRow(line({ Country: "MMR" }), h).cc, "mm");
// merging: same day, place and mode is one row
const m = merge([a, { ...a, id: "e2", role: "" }, { ...a, id: "e3", mode: "strike" }, { ...a, id: "e4", date: "2021-03-02" }, { ...ctry, id: "e5" }, { ...ctry, id: "e6" }]);
assert.equal(m.length, 4); assert.equal(m[0].id, "e1"); assert.equal(m[0].n, 2); assert.equal(m.find((x) => x.id === "e5").n, 2, "unplaced rows merge by place name");

// coding rules
const row = ["e1", "2021-03-01", "", 13.7563, 100.5018, 2, 0, "Bangkok", "demo", 2, "student", "GOV · Thailand"];
const c = CODE.fromPolecat(row, {}, "pc/th");
assert.equal(c.record_basis, "dataset_coded"); assert.equal(c.coding_method, "machine"); assert.equal(c.dataset, "polecat"); assert.equal(c.licence, "CC0 1.0"); assert.equal(c.non_commercial, 0);
assert.equal(CODE.DATASETS.polecat.machine_coded, true);
assert.equal(c.event_type, "Protests"); assert.equal(c.sub_event_type, "", "the software does not say whether the state intervened");
assert.equal(c.actor1, "Protesters (student)"); assert.equal(c.inter2, ""); assert.equal(c.target, "GOV · Thailand");
assert.equal(c.fatalities_best, "", "no death figure invented");
assert.ok(c.source_violence_type.includes("2 machine-coded events merged"));
assert.equal(c.sha256_input, "polecat|e1|2021-03-01|Bangkok|demo|2");
const r = CODE.fromPolecat(["e9", "2022-05-01", "", null, null, 3, 1, "", "riot", 1, "", ""], {}, "pc/th");
assert.equal(r.event_type, "Riots"); assert.equal(r.sub_event_type, "Violent demonstration"); assert.ok(CODE.isSub("Riots", "Violent demonstration")); assert.equal(r.latitude, "");
assert.equal(CODE.fromUcdp.length >= 1 && CODE.fromMm(["1", "1991-09-03", "", null, null, 3, 0, "x", "", "", "", "", "ignore"], {}, "cc/th").coding_method, "human", "hand-coded sets say so");
const ec = CODE.evCsv([c, r]).split("\r\n");
assert.equal(ec.length, 4); assert.ok(ec[0].startsWith("record_basis,coding_method,")); assert.ok(ec[1].startsWith("dataset_coded,machine,polecat"));
console.log("coded_polecat: all checks passed");
