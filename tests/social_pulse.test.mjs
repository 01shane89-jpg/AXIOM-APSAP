// Public pulse (tools/social_pulse.mjs): which posts count for a country, that only counts are kept (never a handle, link or
// post text), the per-hour thresholds for hashtags and words, merging and pruning hours, and the summary's baseline, spike,
// indicator and narrative rules. Run from the repo root: node tests/social_pulse.test.mjs
import assert from "node:assert/strict";
import { read, countries, bucketRun, merge, summarise, tagsOf, MAX_CCS, KEEP_H, DETAIL_H } from "../tools/social_pulse.mjs";

// which countries a post names
assert.deepEqual(countries("Protests in Tehran tonight"), ["ir"], "capitals count");
assert.deepEqual(countries("Ukrainian drones hit a refinery"), ["ua"], "demonyms count");
assert.deepEqual(countries("Happy Thanksgiving, the turkey was great"), [], "turkey the bird is not Türkiye");
assert.deepEqual(countries("Jordan scored 30 points"), [], "Jordan the name is not the country");
assert.deepEqual(countries("Georgia votes in the runoff"), [], "Georgia the US state is not the country");
assert.deepEqual(countries("Erdogan spoke in Ankara about Turkey"), ["tr"]);
assert.equal(read({ platform: "Bluesky", text: "Ukraine Russia Israel Iran China Japan and more", lang: "en" }).skipped, 1, `over ${MAX_CCS} countries: left out`);
assert.equal(read({ platform: "Bluesky", text: "Nice weather today", lang: "en" }), null, "no country, no record");

// indicators, tone and tags
const r = read({ platform: "Bluesky", text: "Huge protests in Tehran, power cuts and fuel queues. Terrible. #Iran #MahsaAmini", lang: "en", tags: ["Iran"] });
assert.deepEqual(r.ccs, ["ir"]);
assert.deepEqual(r.ind.sort(), ["fuel", "power", "protest", "shortage"].sort());
assert.equal(r.tone, "negative");
assert.deepEqual(r.tags.sort(), ["iran", "mahsaamini"]);
assert.equal(read({ platform: "Mastodon", text: "Manifestation à Paris contre la vie chère", lang: "fr" }).tone, null, "non-English posts are not scored");
assert.deepEqual(read({ platform: "Mastodon", text: "Manifestation à Paris contre la vie chère", lang: "fr" }).ind.sort(), ["prices", "protest"]);
assert.deepEqual(tagsOf("#123 #ok", []), ["ok"], "number-only tags dropped");

// a run's buckets: counts only, thresholds applied
const now = Date.parse("2026-11-14T16:30:00Z");
const posts = [
  ...Array.from({ length: 4 }, (_, i) => ({ platform: "Bluesky", text: `Protests in Tehran again ${i} @someone.bsky.social https://example.com/x #Iran`, lang: "en" })),
  { platform: "Mastodon", text: "Iran: a lonely uniqueword here", lang: "en" },
];
const by = bucketRun(posts.map(read), { Bluesky: 1000, Mastodon: 200 }, 4, now);
const b = by.ir;
assert.equal(b.h, "2026-11-14T16"); assert.equal(b.n, 5); assert.deepEqual(b.np, { Bluesky: 4, Mastodon: 1 }); assert.equal(b.ind.protest, 4);
assert.equal(b.tags.iran, 4, "a hashtag used by 2+ posts in the hour is kept");
assert.ok(!("uniqueword" in b.terms), "a word fewer than 3 posts used is not kept");
assert.equal(b.terms.protests, 4);
const out = JSON.stringify(by);
assert.ok(!/someone|bsky\.social|example\.com|lonely|again 0/.test(out), "no handle, link or post text is kept");

// merge: same hour sums, other countries get a zero hour, old hours pruned, old detail dropped
let hours = merge([], by.ir, b.h, { Bluesky: 1000, Mastodon: 200 }, 4, now);
hours = merge(hours, bucketRun(posts.map(read), { Bluesky: 1000 }, 4, now).ir, b.h, { Bluesky: 1000 }, 4, now);
assert.equal(hours.length, 1); assert.equal(hours[0].n, 10); assert.equal(hours[0].s.Bluesky, 2000); assert.equal(hours[0].m, 8);
const zero = merge([], undefined, b.h, { Bluesky: 500 }, 4, now);
assert.equal(zero[0].n, 0); assert.equal(zero[0].s.Bluesky, 500, "a quiet hour is a zero, not a gap");
const hourOf = (ms) => new Date(ms).toISOString().slice(0, 13);
const old = [{ h: hourOf(now - (KEEP_H + 2) * 36e5), n: 1, s: { Bluesky: 10 }, m: 4, tone: [0, 0, 0] },
  { h: hourOf(now - (DETAIL_H + 5) * 36e5), n: 3, s: { Bluesky: 10 }, m: 4, tone: [0, 0, 0], tags: { a: 3 }, terms: { b: 3 } }];
const pr = merge(old, by.ir, b.h, {}, 4, now);
assert.equal(pr.length, 2, "hours older than KEEP_H are dropped");
assert.deepEqual(pr[0].tags, {}, "tags older than DETAIL_H are dropped");

// summary: baseline over the week, spike in the last 3 h, indicator UP, rising words
const H = [];
for (let k = 1; k <= 150; k++) H.push({ h: hourOf(now - k * 36e5), n: 2, s: { Bluesky: 10000 }, m: 4, tone: [0, 2, 0], ind: k > 24 ? { protest: 0 } : {}, lang: { en: 2 }, np: { Bluesky: 2 },
  tags: k > 24 && k <= 48 ? { oldtag: 3 } : {}, terms: {} });
H.push({ h: hourOf(now), n: 40, s: { Bluesky: 10000 }, m: 4, tone: [1, 10, 29], ind: { protest: 20, curfew: 6 }, lang: { en: 30, fa: 10 }, np: { Bluesky: 40 }, tags: { newtag: 12 }, terms: { curfew: 6 } });
H.sort((a, c) => (a.h < c.h ? -1 : 1));
const S = summarise(H, now);
assert.equal(S.base, 2, "7-day normal: 2 per 10,000");
assert.ok(S.spike, "40 in the last hour against 2 normal is a spike");
assert.ok(S.ratio > 1);
assert.equal(S.ind.protest.n, 20); assert.equal(S.ind.protest.up, true, "indicator never seen before, now 20: UP");
assert.deepEqual(S.tagMoves.up[0].slice(0, 2), ["newtag", 12]);
assert.equal(S.tagMoves.down[0][0], "oldtag");
const thin = summarise(H.slice(-5), now);
assert.equal(thin.base, null, "under 12 earlier hours: no normal"); assert.equal(thin.spike, false);
console.log("social_pulse.test: ok");
