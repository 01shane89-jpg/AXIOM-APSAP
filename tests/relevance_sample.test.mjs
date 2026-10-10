// Relevance check sample: deterministic stratified pick, hidden areas never sampled, short groups topped up, scores and intervals.
import assert from "node:assert/strict";
import fs from "node:fs";
import { compileRelevance } from "../tools/topics_lib.mjs";
import { pick, score, wilson, SAMPLE, LABELS } from "../tools/relevance_sample.mjs";

const R = compileRelevance(JSON.parse(fs.readFileSync("tools/relevance.json", "utf8")), JSON.parse(fs.readFileSync("tools/topics.json", "utf8")).topics);
const post = (cc, n, title) => ({ platform: "YouTube", account: "@a", date: "2026-10-10T00:00", title, lang: "en", link: `https://e/${cc}/${n}` });
const items = {};
for (const cc of ["th", "fr", "us"]) items[cc] = Array.from({ length: 20 }, (_, n) => post(cc, n, n % 2 ? "Bomb attack wounds two soldiers" : "Pop star wedding highlights"));
const social = { asof: "x", items };
const alloc = { pilot_hide: 4, pilot_keep: 4, other_hide: 6, other_keep: 6 };

const a = pick(R, social, { seed: "s", alloc, skip: ["us"] });
assert.equal(a.items.length, 20);
assert.deepEqual(JSON.stringify(pick(R, social, { seed: "s", alloc, skip: ["us"] })), JSON.stringify(a), "same snapshot and seed, same sample");
assert.notDeepEqual(pick(R, social, { seed: "t", alloc, skip: ["us"] }).items.map((i) => i.link), a.items.map((i) => i.link), "another seed, another sample");
assert.ok(a.items.every((i) => i.cc !== "us"), "a hidden area is never sampled");
assert.ok(a.items.every((i) => i.label === null), "labels start empty");
assert.equal(new Set(a.items.map((i) => i.link)).size, 20, "no post twice");
const g = (x) => a.items.filter((i) => i.group === x).length;
assert.deepEqual([g("pilot_hide"), g("pilot_keep"), g("other_hide"), g("other_keep")], [4, 4, 6, 6]);
assert.deepEqual(a.population, { pilot_hide: 10, pilot_keep: 10, other_hide: 10, other_keep: 10 });

// too few pilot posts: the rest comes from elsewhere with the same verdict, so the total holds
const b = pick(R, { items: { th: items.th.slice(0, 4), fr: items.fr } }, { seed: "s", alloc });
assert.equal(b.items.length, 20);
assert.equal(b.items.filter((i) => i.verdict_at_sampling === "hide").length, 10);
assert.equal(b.population.pilot_hide + b.population.other_hide, 12, "population counts every post once");

// Wilson interval: 0 of 0 is uninformative, 5 of 10 is symmetric around a half
assert.deepEqual(wilson(0, 0), [0, 1]);
const [lo, hi] = wilson(5, 10);
assert.ok(Math.abs(lo + hi - 1) < 1e-9 && lo > 0.2 && lo < 0.25);

// score: each post re-checked with the current policy; unclear posts counted but not in the rates
a.items.forEach((i, n) => { i.label = i.verdict_at_sampling === "keep" ? (n % 5 ? "relevant" : "unclear") : (n % 3 ? "not_relevant" : "relevant"); });
const s = score(R, a);
assert.equal(s.counts.hide.relevant + s.counts.hide.not_relevant + s.counts.hide.unclear, 10);
assert.equal(s.false_keep.k, 0);
assert.ok(s.false_hide.k > 0 && s.false_hide.rate === +(s.false_hide.k / s.false_hide.n).toFixed(3));
assert.ok(s.estimate.recall > 0 && s.estimate.recall < 1);

// the committed sample: 400 posts, every one labelled, the labeller named
const S = JSON.parse(fs.readFileSync(SAMPLE, "utf8"));
assert.equal(S.items.length, 400);
assert.ok(S.items.every((i) => LABELS.includes(i.label)), "every sample post is labelled");
assert.ok(S.labelled_by, "who labelled the sample is recorded");
const hidden = JSON.parse(fs.readFileSync("tools/hidden-areas.json", "utf8")).hidden || [];
assert.ok(S.items.every((i) => !hidden.includes(i.cc)), "the committed sample holds no hidden-area post");
console.log("relevance sample ok");
