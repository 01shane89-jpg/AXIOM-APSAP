// Claim records: single statements tied to their words, never facts; written once per capture revision; no attribution.
import assert from "node:assert/strict";
import { extract, plan, RULES } from "../tools/claim_lib.mjs";
import { figure, KILLED, INJURED } from "../tools/deepsouth_lib.mjs";

const cap = { capture_id: "cap-1", rev: 1, source_id: "isranews-south", outlet: "Isranews", lang: "th", published: "2026-10-09T22:10", observed: "2026-10-09T22:30",
  title: "คนร้ายลอบวางระเบิดทหารพรานที่อำเภอรือเสาะ จังหวัดนราธิวาส", summary: "" };
const tr = { sha: "trsha", engine: "MADLAD-400", title_en: "Two rangers killed, three injured by bomb in Rueso, Narathiwat", summary_en: null };
const cs = extract(cap, tr, "2026-10-09T22:30");
const by = (p) => cs.filter((c) => c.predicate === p);
assert.ok(RULES.startsWith("deepsouth-rules@"));
for (const c of cs) {
  assert.equal(c.epistemic, "source_claim");
  assert.equal(c.assessment, "unassessed", "rules never assess");
  assert.equal(c.extracted_by.method, "rules");
  assert.equal(c.claimant.source_id, "isranews-south");
  assert.ok(c.evidence.length && c.evidence.every((e) => e.capture_id === "cap-1" && e.rev === 1 && e.words));
}
assert.ok(!cs.some((c) => /attrib|responsib|perpetrat/.test(c.predicate)), "responsibility is never extracted");
// the kind comes from the original Thai headline, not the translation
assert.deepEqual(by("event_type").map((c) => [c.value.kind, c.evidence[0].field, c.evidence[0].lang]), [["ied", "title", "th"]]);
// one district claim (Rueso), backed by both the Thai words and the translation; Narathiwat province is not claimed again
assert.deepEqual(by("location").map((c) => c.value), [{ place_id: "TH-9606", level: "district", name: "Rueso" }]);
assert.deepEqual(by("location")[0].evidence.map((e) => [e.field, e.words, !!e.translation_sha]), [["title", "รือเสาะ", false], ["title_en", "Rueso", true]]);
// figures from the translation, marked as such
assert.deepEqual(by("killed").map((c) => [c.value.n, c.evidence[0].field, c.evidence[0].engine]), [[2, "title_en", "MADLAD-400"]]);
assert.deepEqual(by("injured").map((c) => c.value.n), [3]);

// a province-only report claims the province; an ambiguous name is flagged; a search lead stays marked
const en = { capture_id: "cap-2", rev: 1, source_id: "bing-x", lang: "en", discovery: true, title: "Shooting in Yala; police seal off Mayo market", summary: "" };
const c2 = extract(en, null, "x");
assert.deepEqual(c2.filter((c) => c.predicate === "location").map((c) => [c.value.place_id, c.value.level]), [["TH-9405", "district"], ["TH-95", "province"]]);
assert.match(c2.find((c) => c.value.place_id === "TH-9405").ambiguity, /English word/);
assert.ok(c2.every((c) => c.discovery));
assert.equal(c2.find((c) => c.predicate === "event_type").value.kind, "shooting");

// nothing to say: no claims
assert.deepEqual(extract({ capture_id: "cap-3", rev: 1, lang: "en", title: "Weather fine", summary: "" }, null, "x"), []);

// plan: written once; a later run adds nothing; a new revision gives new claims and keeps the old
let r = plan([{ cap, tr }], {}, "t1");
assert.equal(r.records.length, cs.length);
assert.equal(plan([{ cap, tr }], r.index, "t2").records.length, 0, "replay writes nothing");
// the translation arriving later adds only the claims it alone supports
const early = plan([{ cap, tr: null }], {}, "t1");
const late = plan([{ cap, tr }], early.index, "t2");
assert.deepEqual(late.records.map((c) => c.predicate).sort(), ["injured", "killed"]);
const r2 = plan([{ cap: { ...cap, rev: 2, title: cap.title + " (แก้ไข)" }, tr }], r.index, "t3");
assert.equal(r2.records.length, cs.length);
assert.ok(r2.records.every((c) => !r.index[c.claim_id] && c.evidence[0].rev === 2));
// casualty figures: the number must belong to the casualty word, and a denial is not a toll (headlines seen in the layer, 2026-10-10)
for (const [t, k, i] of [
  ["Luckily, no one was injured or killed.", null, null],
  ["two killed and 16 wounded on his way home from a boat race", 2, 16],
  ["Sukhirin police station, Narathiwat - 16 wounded, two killed", 2, 16],
  ["Sukhirin, two men shot and killed a policeman at Tak Bai Police Station.", null, null],
  ["Krong Pinang, 15 shots killed.", null, null],
  ["32 year old Ranger killed in one shot incident in Narathiwat", null, null],
  ["Encirclement orders, two policemen shot dead in a fight at Tak Bai.", 2, null],
  ["Yala, one riot leader killed.", 1, null],
  ["10 dead, 25 injured in convoy collision", 10, 25],
]) assert.deepEqual([figure(t, KILLED), figure(t, INJURED)], [k, i], t);
// no toll claims from a statistics or court headline
assert.ok(!extract({ capture_id: "cap-4", rev: 1, lang: "en", title: "Statistics: 75 incidents this month in Yala, 11 injured", summary: "" }, null, "x").some((c) => c.predicate === "injured"));
console.log("claims ok:", cs.length, "claims from the test report");
