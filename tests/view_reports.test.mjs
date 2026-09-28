// Unit test for the tab Reports tagging (tools/view_reports_lib.mjs) and the shipped tools/view_reports.json (no network).
// Usage: node tests/view_reports.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { compileViews, viewsOf } from "../tools/view_reports_lib.mjs";

const V = compileViews({ views: [
  { id: "flood", topics: ["floods"], words: ["dam$", "inundat"], exclude: ["flood of tourists"] },
  { id: "border", words: ["border$"], by_country: { tw: ["PLA$"] } },
  { id: "Bad Id", words: ["x"] },
] });
assert.deepEqual(V.map((v) => v.id), ["flood", "border"]);                        // a bad id is skipped, not crashed on
assert.deepEqual(viewsOf(V, "Dam releases water", ["th"], []), ["flood"]);         // whole word
assert.deepEqual(viewsOf(V, "Dams overflow", ["th"], []), ["flood"]);              // plural allowed
assert.deepEqual(viewsOf(V, "Storm damage assessed", ["th"], []), []);             // "dam$" is not "damage"
assert.deepEqual(viewsOf(V, "Anything", ["th"], ["floods"]), ["flood"]);           // a data set of the tab
assert.deepEqual(viewsOf(V, "A flood of tourists inundates Phuket", ["th"], ["floods"]), []);   // exclude wins
assert.deepEqual(viewsOf(V, "PLA aircraft near Taiwan", ["tw"], []), ["border"]);  // a country's own extra words
assert.deepEqual(viewsOf(V, "PLA aircraft near Taiwan", ["th"], []), []);          // only for that country
assert.deepEqual(viewsOf(V, "Border reopens", ["th"], []), ["border"]);

// the shipped config: valid unique ids, known data sets, every tab has words, no tab the page never shows
const cfg = JSON.parse(fs.readFileSync(new URL("../tools/view_reports.json", import.meta.url), "utf8"));
const topics = new Set(JSON.parse(fs.readFileSync(new URL("../tools/topics.json", import.meta.url), "utf8")).topics.map((t) => t.id));
const TABS = new Set(["flood", "border", "insurgency", "crime", "scam", "aml", "weather", "infra", "transport", "safety", "health", "hazards", "crisis", "partners", "presence", "security"]);
const ids = cfg.views.map((v) => v.id);
assert.equal(new Set(ids).size, ids.length, "duplicate tab id");
for (const v of cfg.views) {
  assert.ok(TABS.has(v.id), "unknown tab id " + v.id);
  assert.ok((v.words || []).length, v.id + " has no words");
  for (const t of v.topics || []) assert.ok(topics.has(t), v.id + ": unknown data set " + t);
  for (const cc of Object.keys(v.by_country || {})) assert.match(cc, /^[a-z]{2,3}$/);
}
assert.equal(compileViews(cfg).length, ids.length);
// spot checks on the shipped words
const C = compileViews(cfg);
assert.ok(viewsOf(C, "Hospitality chain opens hotel", ["vn"], []).indexOf("health") < 0);
assert.ok(viewsOf(C, "Flash floods hit Hat Yai", ["th"], []).indexOf("flood") >= 0);
assert.ok(viewsOf(C, "Police bust meth lab", ["th"], []).indexOf("crime") >= 0);
assert.ok(viewsOf(C, "Ceasefire talks resume", ["th"], []).indexOf("safety") < 0);
console.log("view_reports: ok");
