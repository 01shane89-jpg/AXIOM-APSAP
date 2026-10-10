// Social relevance in shadow mode: reports what the news policy would hide, with a reason, and hides nothing.
import assert from "node:assert/strict";
import fs from "node:fs";
import { compileRelevance } from "../tools/topics_lib.mjs";
import { shadow, policyVersion } from "../tools/social_relevance.mjs";

const relText = fs.readFileSync("tools/relevance.json", "utf8");
const R = compileRelevance(JSON.parse(relText), JSON.parse(fs.readFileSync("tools/topics.json", "utf8")).topics);
const social = { asof: "2026-10-10 01:00Z", items: {
  th: [
    { platform: "YouTube", account: "@x", date: "2026-10-10T00:10", title: "Bomb attack wounds two rangers in Narathiwat", lang: "en", link: "https://e/1" },
    { platform: "YouTube", account: "@x", date: "2026-10-10T00:20", title: "Pop star wedding highlights", lang: "en", link: "https://e/2" },
    { platform: "Telegram", account: "@y", date: "2026-10-10T00:30", title: "ข่าวด่วน", title_en: null, mt: "untranslated", lang: "lo", link: "https://e/3" },
  ],
  sg: [] } };
const before = JSON.stringify(social);
const rep = shadow(R, social, policyVersion(relText));
assert.equal(JSON.stringify(social), before, "the snapshot is not changed");
assert.equal(rep.mode, "shadow (nothing is hidden)");
assert.match(rep.policy, /^osap-relevance\/1@[0-9a-f]{12}$/);
assert.equal(rep.totals.posts, 3);
assert.equal(rep.counts.th.posts, 3);
assert.equal(rep.counts.sg.posts, 0);
// the security story is kept, the cookery segment would be hidden, an untranslated post is kept as unchecked
assert.equal(rep.counts.th.would_hide, 1);
assert.equal(rep.would_hide_sample[0].link, "https://e/2");
assert.ok(rep.would_hide_sample[0].why, "every would-hide entry carries a reason");
assert.equal(rep.totals.unchecked, 1);
// a hidden area is left out of the report altogether (it is a shared, unsealed file)
const withHidden = { ...social, items: { ...social.items, us: [{ platform: "YouTube", account: "@z", date: "2026-10-10T00:40", title: "Celebrity gossip", lang: "en", link: "https://e/4" }] } };
const rep2 = shadow(R, withHidden, "p", 300, ["us"]);
assert.equal(rep2.counts.us, undefined);
assert.ok(rep2.would_hide_sample.every((x) => x.cc !== "us"));
assert.equal(rep2.totals.posts, 3);
console.log("social relevance shadow: ok");
