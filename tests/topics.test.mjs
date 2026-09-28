// Unit test for data-set matching (tools/topics_lib.mjs) and the shipped tools/topics.json (no network).
// Usage: node tests/topics.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { compileTopics, topicsOf, countriesNamed, fold } from "../tools/topics_lib.mjs";

const T = compileTopics([
  { id: "floods", words: ["flood", "landslide"], exclude: ["flood of tourists"] },
  { id: "scs", words: ["South China Sea"], countries: ["ph", "vn"] },
  { id: "thai", words: ["น้ำท่วม"] },
  { id: "Bad Id", words: ["x"] },
]);
assert.deepEqual(T.map((t) => t.id), ["floods", "scs", "thai"]);          // a bad id is skipped, not crashed on
assert.deepEqual(topicsOf(T, "Flooding hits Hat Yai", ["th"]), ["floods"]);   // word start, case-insensitive
assert.deepEqual(topicsOf(T, "Floodlights installed", ["th"]), ["floods"]);    // word start is a prefix match: documented
assert.deepEqual(topicsOf(T, "Rainfall and overflood", ["th"]), []);          // not inside a word
assert.deepEqual(topicsOf(T, "A flood of tourists in Phuket", ["th"]), []);   // exclude wins
assert.deepEqual(topicsOf(T, "Clash in the South China Sea", ["cn"]), []);    // country-limited set
assert.deepEqual(topicsOf(T, "Clash in the South China Sea", ["ph"]), ["scs"]);
assert.deepEqual(topicsOf(T, "เกิดน้ำท่วมหนักที่หาดใหญ่", ["th"]), ["thai"]);    // Thai has no spaces between words
assert.equal(fold("Côte d’Ivoire"), "cote d’ivoire");
const C = [{ id: "ph", name: "Philippines" }, { id: "cn", name: "China" }, { id: "ni", name: "Niger" }, { id: "ng", name: "Nigeria" }];
assert.deepEqual(countriesNamed(C, "China and the Philippines trade accusations"), ["cn", "ph"]);
assert.deepEqual(countriesNamed(C, "Floods in Nigeria"), ["ng"]);             // "Niger" is not found inside "Nigeria"

// the shipped config: valid ids, unique, every set has words, at most 4 searches each
const cfg = JSON.parse(fs.readFileSync(new URL("../tools/topics.json", import.meta.url), "utf8"));
const ids = cfg.topics.map((t) => t.id);
assert.equal(new Set(ids).size, ids.length, "duplicate data-set id");
for (const t of cfg.topics) {
  assert.match(t.id, /^[a-z0-9-]+$/, t.id);
  assert.ok(t.name && t.words.length, t.id + " needs a name and words");
  assert.ok(!t.searches || t.searches.length <= 4, t.id + " has more than 4 searches");
}
assert.equal(compileTopics(cfg.topics).length, cfg.topics.length);
console.log("topics tests passed:", cfg.topics.length, "data sets");
