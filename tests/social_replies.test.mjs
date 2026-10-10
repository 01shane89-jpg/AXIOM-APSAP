// Social reply analysis: aggregates only, never a reply's author or text; words only when MIN_REPLIES different replies used them.
import assert from "node:assert/strict";
import { analyse, tone, totals, pick, MIN_REPLIES } from "../tools/social_replies.mjs";

assert.equal(tone("This is terrible news"), "negative");
assert.equal(tone("Not bad at all, glad they are safe"), "positive");
assert.equal(tone("The ministry released a statement"), "neutral");
assert.equal(tone("This is not good"), "negative", "a negation flips the word after it");

const replies = [
  { text: "Fake propaganda from @someone.bsky.social, not good. Source?", langs: ["en"] },
  { text: "Condolences to the families, so sad", langs: ["en"] },
  { text: "Terrible news from Gaza, ceasefire now", langs: ["en"] },
  { text: "Gaza ceasefire must hold https://example.com/x", langs: ["en"] },
  { text: "Gaza again. Terrible.", langs: ["en"] },
  { text: "ข่าวร้ายมาก", langs: ["th"] },
  { text: "", langs: ["en"] },
];
const a = analyse(replies);
assert.equal(a.read, 6, "empty replies are not counted");
assert.equal(a.scored, 5, "only English replies are scored");
assert.deepEqual(a.langs, { en: 5, th: 1 });
assert.equal(a.tone.negative, 3);
assert.equal(a.themes.doubt, 1);
assert.equal(a.themes.sympathy, 1);
assert.equal(a.themes.action, 1);
assert.equal(a.themes.question, 1);
assert.deepEqual(a.terms, [["gaza", 3]], "only words used by at least " + MIN_REPLIES + " replies");
const out = JSON.stringify(a);
assert.ok(!/someone|bsky\.social|example\.com|propaganda from|Condolences to/.test(out), "no handle, link or reply text is kept");

// totals add up per-post aggregates
const t = totals([{ replies: 10, likes: 5, reposts: 2, quotes: 1, a }, { replies: 3, likes: 1, reposts: 0, quotes: 0, a }]);
assert.equal(t.replies, 13); assert.equal(t.likes, 6); assert.equal(t.read, 12); assert.equal(t.tone.negative, 6);
assert.deepEqual(t.terms[0], ["gaza", 6]);

// pick: newest Bluesky posts per area, hidden areas left out, other platforms ignored
const social = { items: {
  th: [
    { platform: "YouTube", link: "https://www.youtube.com/watch?v=abcdefghijk", date: "2026-10-10T01:00" },
    { platform: "Bluesky", link: "https://bsky.app/profile/apnews.com/post/3abc", date: "2026-10-09T01:00" },
    { platform: "Bluesky", link: "https://bsky.app/profile/apnews.com/post/3abd", date: "2026-10-10T01:00" },
    { platform: "Bluesky", link: "javascript:alert(1)", date: "2026-10-10T02:00" },
  ],
  us: [{ platform: "Bluesky", link: "https://bsky.app/profile/apnews.com/post/3abe", date: "2026-10-10T01:00" }] } };
const p = pick(social, ["us"], 10);
assert.deepEqual(Object.keys(p), ["th"], "hidden areas are left out");
assert.deepEqual(p.th.map((i) => i.link.slice(-4)), ["3abd", "3abc"], "Bluesky only, newest first, only real post links");
assert.equal(pick(social, [], 1).th.length, 1);
console.log("social_replies.test: ok");
