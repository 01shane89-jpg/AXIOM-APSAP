// Social relevance (tools/social_relevance.mjs + tools/relevance-social.json): left-out posts are marked with the deciding word,
// never deleted; shadow mode clears the marks; the report skips hidden areas.
import assert from "node:assert/strict";
import fs from "node:fs";
import { compileRelevance } from "../tools/topics_lib.mjs";
import { compileSocial, socialRelevance, socialKept, judge, policyVersion } from "../tools/social_relevance.mjs";

const relText = fs.readFileSync("tools/relevance.json", "utf8"), socText = fs.readFileSync("tools/relevance-social.json", "utf8");
const R = compileRelevance(JSON.parse(relText), JSON.parse(fs.readFileSync("tools/topics.json", "utf8")).topics);
const cfg = JSON.parse(socText), S = compileSocial(cfg);
assert.equal(cfg.mode, "on", "the social filter is switched on");
const post = (n, title, extra = {}) => ({ platform: "YouTube", account: "@x", date: "2026-10-10T00:" + String(10 + n), title, lang: "en", link: "https://e/" + n, ...extra });
const rel = (i) => socialRelevance(R, S, { lang: "en", ...i });
const shown = (i) => socialKept(rel(i));

// the basics: security kept, sport and celebrity left out, an untranslated post kept unchecked
assert.ok(shown({ title: "Bomb attack wounds two rangers in Narathiwat" }));
assert.ok(!shown({ title: "Pop star wedding highlights" }));
assert.ok(!shown({ title: "AZAM FC vs Coastal Union | live from the stadium" }), "a match on a news channel's stream");
assert.ok(!shown({ title: "Spellbound, S6 - Episode 1" }));
assert.equal(rel({ title: "ข่าวด่วน", title_en: null, mt: "untranslated", lang: "lo" }), "unchecked");
// social keep words the news lists miss
assert.ok(shown({ title: "Budget 2027: RM5 billion for rural roads" }));
assert.ok(shown({ title: "Casino shares and the money trail behind them" }));
// a drop word counts only in the title: a video description's incidental "highlights" does not drop a political story
assert.ok(shown({ title: "Kwara North monarchs endorse President, APC candidates", summary: "The endorsement highlights the party's reach" }));
// the original of a translated post is not checked against the English lists (Spanish "mayor" = "greater")
assert.ok(!shown({ title: "Perros blancos con mayor riesgo de cáncer de piel", title_en: "White dogs at greater risk of skin cancer", lang: "es", mt: "MADLAD" }));
// but it is checked against that language's own words
assert.ok(shown({ title: "Huracán Isaías se acerca a la costa", title_en: "Isaiah approaches the coast", lang: "es", mt: "MADLAD" }));
assert.ok(shown({ title: "Info Gempa Mag:5.1 Bitung", lang: "id", title_en: "Info Gempa Mag:5.1 Bitung", mt: null }));
// a whole news programme is kept
assert.equal(rel({ title: "Evening News | 9 October 2026" }), "bulletin");
// a strong word still beats a sport word ("footballer killed in bombing")
assert.ok(shown({ title: "Footballer killed in bombing" }));

const social = { asof: "2026-10-10 01:00Z", items: {
  th: [post(1, "Bomb attack wounds two rangers in Narathiwat"), post(2, "Pop star wedding highlights"),
    post(3, "ข่าวด่วน", { title_en: null, mt: "untranslated", lang: "lo" })],
  us: [post(4, "Celebrity gossip")], sg: [] } };
const rep = judge(R, S, social, { policy: policyVersion(relText) + "+" + policyVersion(socText), skip: ["us"] });
assert.match(rep.policy, /^osap-relevance\/1@[0-9a-f]{12}\+osap-social-relevance-rules\/1@[0-9a-f]{12}$/);
assert.match(rep.mode, /^on/);
// marks, in place: the left-out post carries the deciding word; the others carry nothing; nothing is removed
assert.equal(social.items.th.length, 3);
assert.equal(social.items.th[1].left_out, "pop star");
assert.equal(social.items.th[0].left_out, undefined);
assert.equal(social.items.th[2].left_out, undefined);
// a hidden area's posts are marked (their files are sealed) but left out of the shared report
assert.ok(social.items.us[0].left_out);
assert.equal(rep.counts.us, undefined);
assert.ok(rep.left_out_sample.every((x) => x.cc !== "us"));
assert.equal(rep.totals.posts, 3);
assert.equal(rep.totals.left_out, 1);
assert.equal(rep.counts.th.left_out, 1);
assert.equal(rep.counts.sg.posts, 0);
assert.ok(rep.left_out_sample[0].why, "every left-out entry carries a reason");
// shadow mode clears every mark and hides nothing
const rep2 = judge(R, S, social, { on: false });
assert.match(rep2.mode, /^shadow/);
assert.ok(Object.values(social.items).flat().every((i) => i.left_out === undefined));
assert.equal(rep2.totals.left_out, 2, "the report still says what would be left out");
console.log("social relevance: ok");
