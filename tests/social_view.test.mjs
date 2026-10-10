// The social cap only limits what the page shows; every post inside the window is kept for the history.
import assert from "node:assert/strict";
import { splitView } from "../tools/social_lib.mjs";

const post = (n, cc = "th") => ({ link: "https://t.me/x/" + n, date: "2026-10-0" + (1 + (n % 9)) + "T" + String(n % 24).padStart(2, "0") + ":00", cc });
const items = { th: Array.from({ length: 55 }, (_, n) => post(n)), sg: [post(1, "sg"), post(1, "sg"), post(2, "sg")] };
const { kept, view, counts } = splitView(items, 40);

// nothing beyond the duplicate links is dropped from what is stored
assert.equal(kept.th.length, 55);
assert.equal(kept.sg.length, 2, "same link twice is one post");
// the page still gets at most 40, the newest ones
assert.equal(view.th.length, 40);
const newestKept = kept.th.slice(0, 40).map((p) => p.link);
assert.deepEqual(view.th.map((p) => p.link), newestKept);
for (let i = 1; i < kept.th.length; i++) assert.ok(kept.th[i - 1].date >= kept.th[i].date, "newest first");
// the view is a prefix of what is kept, so the snapshot and the history never disagree on a post
assert.ok(view.th.every((p, i) => p === kept.th[i]));
assert.deepEqual(counts.th, { kept: 55, shown: 40 });
assert.deepEqual(counts.sg, { kept: 2, shown: 2 });
// a country under the cap is unchanged
assert.equal(view.sg.length, 2);
// input is not changed in place
assert.equal(items.th.length, 55);
console.log("social view: ok");
