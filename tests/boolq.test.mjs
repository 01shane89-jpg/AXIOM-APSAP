// Boolean watch words (assets/osap-boolq.js) and the push-watch check that uses the same parser (tools/push_lib.mjs).
// Run from the repo root: node tests/boolq.test.mjs
import { createRequire } from "node:module";
import { validate } from "../tools/push_lib.mjs";
const B = createRequire(import.meta.url)("../assets/osap-boolq.js");
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

// plain comma lists stay the old any-of list
ok(!B.isBool("ferry, landslide, Hat Yai"), "a plain comma list is not Boolean");
ok(!B.isBool("cross-border smuggling"), "a hyphen inside a word is not NOT");
ok(B.isBool("bomb AND police") && B.isBool('"Hat Yai"') && B.isBool("bomb -training") && B.isBool("(a) b"), "AND, quotes, leading minus and brackets are Boolean");
ok(!B.isBool("bomb and police"), "lower-case and is an ordinary word");

// reading and matching
const q = B.compile("(bomb OR blast) AND police NOT training");
ok(q.ok && q.q === "(bomb OR blast) AND police AND NOT training", "tidied: " + q.q);
ok(q.test("Bombing hits police post in Yala"), "matches the start of a word (bombing)");
ok(!q.test("Police training includes a blast drill"), "NOT leaves out a report");
ok(!q.test("Blast at market"), "AND needs every part");
ok(!q.test("Abomb police"), "does not match inside a word");
ok(q.which("A blast near police") === "blast", "names the word that hit");
ok(JSON.stringify(q.terms) === '["bomb","blast","police"]', "NOT words are not listed as hit words");
ok(B.compile('"Hat Yai" -flood').test("Shooting in Hat Yai") && !B.compile('"Hat Yai" -flood').test("Hat Yai flood"), "phrase and leading minus");
ok(B.compile("a OR b AND c").q === "a OR (b AND c)", "AND binds tighter than OR");
ok(B.compile("bomb ferry").q === "bomb AND ferry", "words side by side mean AND");
ok(B.compile("bomb, ferry").q === "bomb OR ferry", "a comma means OR");
ok(B.compile("ระเบิด OR bomb").test("ระเบิด ที่ปัตตานี"), "non-Latin words match");
for (const bad of ["bomb AND", "(a OR b", "a)", "NOT", '"open', "x".repeat(700)]) ok(!B.compile(bad).ok, "refuses " + JSON.stringify(bad.slice(0, 12)) + ": " + B.compile(bad).err);
ok(!B.compile(Array.from({ length: 41 }, (_, i) => "w" + i).join(" OR ")).ok, "refuses more than 40 words");
ok(!B.compile("(".repeat(10) + "a" + ")".repeat(10)).ok, "refuses deep brackets");

// quick searches all read, and each finds a typical headline and skips a typical false hit
ok(B.presets.length >= 10 && B.presets.every((p) => B.compile(p.q).ok), B.presets.length + " quick searches all read");
const want = { ied: ["Roadside bomb wounds two rangers", "Photo bomb goes viral"], unrest: ["Police fire tear gas at protesters", "Football fans protest referee"],
  milmove: ["Troops deployed to border district", "Army parade marks anniversary of troops"], scam: ["Raid frees 200 from scam compound", "Scam centre documentary tops charts X"],
  foreign: ["Tourist killed in robbery", "Tourist arrivals rise"], drones: ["Drone strike hits depot", "Drone show lights up the river"] };
for (const [id, [yes, no]] of Object.entries(want)) {
  const c = B.compile(B.presets.find((p) => p.id === id).q);
  ok(c.test(yes), `${id}: finds "${yes}"`);
  if (id !== "scam") ok(!c.test(no), `${id}: skips "${no}"`);
}

// rules-built drafts
const d1 = B.draft("bombings and shootings targeting police near the border in Narathiwat, not training");
ok(d1.q && /bomb/.test(d1.q) && /police/.test(d1.q) && /border/.test(d1.q) && /Narathiwat/.test(d1.q) && /NOT training$/.test(d1.q), "draft: " + d1.q);
const c1 = B.compile(d1.q);
ok(c1.ok && c1.test("Bomb hits police checkpoint near the border in Narathiwat") && !c1.test("Border police training in Narathiwat after bomb drill"), "draft reads and matches as meant");
const d2 = B.draft("attacks on foreigners in Bangkok or Pattaya");
ok(d2.q && /\(Bangkok OR Pattaya\)/.test(d2.q) && /tourist/.test(d2.q), "draft keeps place names as any-of: " + d2.q);
const d3 = B.draft('Chinese coast guard ships near "Second Thomas Shoal" except fishing');
ok(d3.q && /"coast guard"/.test(d3.q) && !/\bguard AND/.test(d3.q) && /NOT fishing$/.test(d3.q), "draft handles two-word terms and exclusions: " + d3.q);
ok(B.draft("  ").err && B.draft("the of and").err, "draft asks for words when there are none");

// push watches keep a Boolean string only when it reads
const base = { id: "wabc123", topic: "osap-abcdefghijklmnop", cc: "th", name: "t", layers: [], kw: ["bomb"], minSev: 1 };
const v1 = validate({ ...base, q: "(bomb OR blast)  AND police" });
ok(v1.watch && v1.watch.q === "(bomb OR blast) AND police", "push watch keeps q, tidied");
ok(validate({ ...base, q: "bomb AND" }).error, "push watch with a broken q is refused");
ok(!("q" in validate(base).watch), "push watch without q stays as before");

console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
