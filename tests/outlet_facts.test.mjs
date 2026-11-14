// Unit test for tools/outlet_facts_lib.mjs (no network): web addresses to hosts and to the forms Wikidata stores them in; how an
// outlet is paid for, from its record's labels, with OSAP's own state and public list winning; a state owner makes state media;
// ended or deprecated claims are left out; a political ideology is carried only as the record states it, with its item.
// Usage: node tests/outlet_facts.test.mjs
import assert from "node:assert/strict";
import { hostOf, siteForms, fundingOf, factsOf } from "../tools/outlet_facts_lib.mjs";

assert.equal(hostOf("https://www.nytimes.com/2026/11/13/x.html"), "nytimes.com");
assert.equal(hostOf("https://m.example.co.uk/a"), "example.co.uk");
assert.equal(hostOf("not a link"), "");
assert.equal(siteForms("a.com").length, 8);
assert.ok(siteForms("a.com").includes("https://www.a.com/") && siteForms("a.com").includes("http://a.com"));

const L = (...x) => x.map((l, i) => ({ q: "Q" + (i + 1), l }));
assert.equal(fundingOf({ isa: L("newspaper"), owner: L("Ministry of Information") }, "").kind, "state", "a government owner makes state media");
assert.equal(fundingOf({ isa: L("public broadcaster") }, "").kind, "public");
assert.equal(fundingOf({ isa: L("nonprofit organization", "news website") }, "").kind, "nonprofit");
assert.equal(fundingOf({ isa: L("newspaper"), owner: L("Nikkei Inc.") }, "").kind, "business", "a company owner makes a business");
assert.equal(fundingOf({ isa: L("newspaper") }, "").kind, "unknown", "nothing said, nothing claimed");
assert.equal(fundingOf({ isa: L("newspaper"), owner: L("Nikkei Inc.") }, "state").kind, "state", "OSAP's own list wins");
assert.equal(fundingOf({ isa: L("public broadcaster") }, "").why, "Wikidata: public broadcaster", "says where it came from");
assert.equal(fundingOf({ isa: L("radio station"), owner: L("Radio Free Europe/Radio Liberty"), ownerIsa: ["nonprofit organization", "international broadcaster"] }, "").kind, "nonprofit",
  "an outlet owned by a non-profit is not a business");
assert.equal(fundingOf({ isa: L("television channel"), owner: L("Agency X"), ownerIsa: ["government agency"] }, "").kind, "state", "an outlet owned by a government agency is state media");
assert.equal(fundingOf({ isa: L("television channel"), owner: L("Media Co"), ownerIsa: ["business"] }, "").kind, "business");

const snak = (id, extra = {}) => ({ mainsnak: { datavalue: { value: { id } } }, rank: "normal", ...extra });
const ent = { id: "Q9684", labels: { en: { value: "The Example Times" } }, claims: {
  P31: [snak("Q11032")], P127: [snak("Q100"), snak("Q101", { qualifiers: { P582: [{}] } }), snak("Q102", { rank: "deprecated" })], P749: [snak("Q200")],
  P17: [snak("Q30")], P1142: [snak("Q7272")], P571: [{ mainsnak: { datavalue: { value: { time: "+1851-09-18T00:00:00Z" } } } }] } };
const labels = new Map([["Q11032", "newspaper"], ["Q100", "Example Company"], ["Q101", "Old Owner"], ["Q102", "Wrong Owner"], ["Q200", "Example Holdings"], ["Q30", "United States"], ["Q7272", "liberalism"]]);
const f = factsOf(ent, labels, (q) => (q === "Q30" ? "us" : ""), "");
assert.equal(f.q, "Q9684"); assert.equal(f.n, "The Example Times"); assert.equal(f.cc, "us"); assert.equal(f.yr, 1851);
assert.deepEqual(f.own, [["Example Company", "Q100"]], "an ended or deprecated owner is left out");
assert.deepEqual(f.par, [["Example Holdings", "Q200"]]);
assert.deepEqual(f.lean, [["liberalism", "Q7272"]], "ideology only as stated, with its item");
assert.equal(f.fund.kind, "business");
const g = factsOf({ id: "Q1", labels: {}, claims: {} }, new Map(), () => "", "");
assert.deepEqual([g.own, g.lean, g.fund.kind], [[], [], "unknown"]);
console.log("outlet facts test: all passed");
