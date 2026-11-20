// Daily country summary rules (tools/daily_lib.mjs). Run: node tests/daily.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { compileRelevance } from "../tools/topics_lib.mjs";
import { briefFresh, buildRules, buildWorld, validateAi, stripInlineCites, cluster, softSection, unent, fromRow, fingerprint, aiQueue, overclaims, dropOverclaims, misattributed } from "../tools/daily_lib.mjs";

const R = compileRelevance(JSON.parse(fs.readFileSync("tools/relevance.json", "utf8")));
const end = Date.parse("2026-09-28T01:00:00Z");
const row = (t, outlet, url, date = "2026-09-27T20:00", flags = "") => fromRow(["xx", date, t, "", outlet, url, "", flags, ""]);
let ok = 0; const t = (name, f) => { f(); ok++; console.log("ok -", name); };

t("AI queue: priority and conflict countries first, then every other country by reports; a retry skips today's drafts", () => {
  const rep = { ww: 50, th: 5, ua: 40, fr: 30, de: 60, zz: 0 }, opts = { priority: ["ww", "th"], conflict: (c) => c === "ua" || c === "th", reports: (c) => rep[c] };
  assert.deepEqual(aiQueue(["de", "fr", "ua", "th", "ww"], opts), ["th", "ww", "ua", "de", "fr"]);
  assert.deepEqual(aiQueue(["de", "fr", "ua", "th", "ww"], { ...opts, doneToday: (c) => c === "th" || c === "de", skipDone: true }), ["ww", "ua", "fr"]);
  assert.deepEqual(aiQueue(["de", "th"], { ...opts, doneToday: () => true }), ["th", "de"]);   // a forced run redrafts them
});
t("soft sections are never news", () => {
  assert.equal(softSection("https://www.bangkokpost.com/sports/3327400/greece-stun-germany"), true);
  assert.equal(softSection("https://www.bangkokpost.com/thailand/general/3327405/city-hall"), false);
});
t("HTML entities in headlines are decoded", () => assert.equal(unent("Iran says it&#039;s up to Trump &amp; co &#8217;"), "Iran says it's up to Trump & co ’"));
t("near-identical headlines from different outlets are one event", () => {
  const g = cluster([row("Bomb kills three soldiers in Pattani market", "A", "https://a/1"), row("Bomb kills three soldiers at Pattani market", "B", "https://b/1"), row("Floods hit Bangkok streets", "C", "https://c/1")]);
  assert.equal(g.length, 2); assert.equal(g[0].items.length, 2);
});
const inp = { cc: "xx", name: "Testland", end, items: [
  row("Bomb kills three soldiers in Pattani market", "Outlet A", "https://a/1"),
  row("Bomb kills three soldiers at Pattani market", "Outlet B", "https://b/1"),
  row("Ministry says 40 militants killed in operation", "State TV", "https://s/1", "2026-09-27T21:00", "g"),
  row("Celebrity wedding dazzles fans", "Outlet A", "https://a/2"),
  row("Army ambush in the north", "Outlet A", "https://a/sports/3"),
  row("Old story: election protest", "Outlet C", "https://c/9", "2026-09-20T10:00"),
], warnings: [{ title_en: "Heavy rain warning", date: "2026-09-27T22:00", link: "https://met/1", agency: "Met Office" }, { title_en: "Warning lifted", date: "2026-09-27T23:00", link: "https://met/2", agency: "Met Office" }],
  advisory: { level: 3, level_text: "Reconsider Travel", date: "2026-09-01", link: "https://travel.state.gov/x" } };
const d = buildRules(inp, R);
t("24-hour window, soft sections and old stories left out", () => {
  assert.equal(d.window.hours, 24);
  assert.ok(!d.refs.some((r) => /sports|c\/9/.test(r.url)));
});
t("the story carried by two outlets leads, with both links", () => {
  assert.equal(d.events[0].n, 2); assert.deepEqual([...d.events[0].outlets].sort(), ["Outlet A", "Outlet B"]);
  assert.deepEqual(d.events[0].refs.map((n) => d.refs[n - 1].url).sort(), ["https://a/1", "https://b/1"]);
});
t("a state-media line is marked as a claim", () => {
  const e = d.events.find((x) => /militants/.test(x.text)); assert.ok(e && e.claim);
});
t("every top line and event cites a source that exists", () => {
  [...d.bluf, ...d.events].forEach((x) => { assert.ok(x.refs.length); x.refs.forEach((n) => assert.ok(d.refs[n - 1])); });
  assert.equal(new Set(d.refs.map((r) => r.url)).size, d.refs.length);
});
t("lifted warnings are not counted; the advisory is a government statement with its link", () => {
  const w = d.watch.find((x) => x.from === "warning"); assert.match(w.text, /^1 official warning/);
  const a = d.watch.find((x) => x.from === "advisory"); assert.match(a.text, /Level 3/); assert.match(a.text, /government statement/);
  assert.equal(d.refs[a.refs[0] - 1].url, "https://travel.state.gov/x");
});
t("a quiet country widens to 72 hours and says so", () => {
  const q = buildRules({ cc: "yy", name: "Quietland", end, items: [row("Protest in capital", "X", "https://x/1", "2026-09-26T08:00")] }, R);
  assert.equal(q.window.hours, 72); assert.ok(q.gaps.some((g) => /72 hours/.test(g)));
  const none = buildRules({ cc: "zz", name: "Emptyland", end, items: [] }, R);
  assert.equal(none.events.length, 0); assert.equal(none.bluf.length, 0); assert.ok(none.gaps[0].startsWith("No analyst-relevant reports"));
});
t("AI output: uncited or out-of-range sentences are dropped", () => {
  const v = validateAi({ bluf: [{ text: "Outlet A reports a bomb killed three soldiers in Pattani.", refs: [1, 2] }, { text: "This proves the insurgency is winning.", refs: [] }, { text: "Something from nowhere entirely.", refs: [99] }],
    watch: [{ text: "Watch for claims of responsibility.", refs: ["[1]"] }] }, d.refs.length);
  assert.equal(v.bluf.length, 1); assert.equal(v.watch.length, 1); assert.deepEqual(v.watch[0].refs, [1]);
  assert.equal(validateAi({ bluf: [{ text: "No citations at all in this one.", refs: [] }] }, 5), null);
  assert.equal(validateAi("not an object", 5), null);
});
t("AI output: citations repeated inside the sentence are dropped (the page shows them as source links)", () => {
  assert.equal(stripInlineCites("China confirms the summit on the sidelines of APEC (1,2,3,4)."), "China confirms the summit on the sidelines of APEC.");
  assert.equal(stripInlineCites("A fire left 11 dead and 36 injured (The Nation Thailand, 2026-11-16T11:28; The Nation Thailand, 2026-11-16T10:26)."), "A fire left 11 dead and 36 injured.");
  assert.equal(stripInlineCites("Drones were shot down (9, 10), Moscow says (11)."), "Drones were shot down, Moscow says.");
  // negative: a year, words in brackets and a bracket in mid-clause stay
  assert.equal(stripInlineCites("The 1991 treaty (1991) still holds."), "The 1991 treaty (1991) still holds.");
  assert.equal(stripInlineCites("Strikes hit 3 ports (Reuters said) on Monday."), "Strikes hit 3 ports (Reuters said) on Monday.");
  assert.equal(stripInlineCites("Talks (Trump talks mentioned in La Nouvelle Tribune, 2026-11-17T00:18) went on."), "Talks (Trump talks mentioned in La Nouvelle Tribune, 2026-11-17T00:18) went on.");
  const v = validateAi({ bluf: [{ text: "Outlet A reports a bomb killed three soldiers in Pattani (1, 2).", refs: [1, 2] }] }, d.refs.length);
  assert.equal(v.bluf[0].text, "Outlet A reports a bomb killed three soldiers in Pattani.");
});
t("AI output: a line may not call a report confirmed on its own authority (18 Nov World BLUF: 'outlets confirming this threat')", () => {
  const refs = [{ n: 1, title: "Iran plots dirty bomb attack on US capital, report says" }, { n: 2, title: "China confirms trilateral summit at APEC" },
    { n: 3, title: "Ministère : le gouvernement confirme l'attaque", orig: "Ministère : le gouvernement confirme l'attaque" }];
  const v = validateAi({ bluf: [
    { text: "Iran is reportedly planning a dirty bomb attack, with multiple news outlets confirming this threat.", refs: [1] },
    { text: "China confirms a trilateral summit with the US and Russia at APEC.", refs: [2] },
    { text: "Outlet A reports Iran is planning a dirty bomb attack on the US capital.", refs: [1] }],
    watch: [{ text: "Watch whether officials verify the reported plot.", refs: [1] }] }, 3, refs);
  assert.deepEqual(v.bluf.map((b) => b.refs[0]), [2, 1], "the self-confirming line is dropped; the headline's own 'confirms' and the attributed line stay");
  assert.equal(v.watch.length, 0, "'verify' with no cited headline saying so is dropped from What to watch too");
  assert.equal(overclaims("Reports from Dawn confirm these incidents.", ["Three terrorists killed in Mastung"]), true);
  assert.equal(overclaims("The ministry confirms the attack.", ["Le gouvernement confirme l'attaque"]), true, "a French 'confirme' is not the English word; stay strict");
  assert.equal(overclaims("Unconfirmed reports say a plane crashed.", []), false, "'unconfirmed' is a hedge, not a claim of confirmation");
  assert.equal(overclaims("Outlet A reports a fire.", []), false);
  // a kept summary is checked again; one left with no top line falls back to its rules top lines
  const day = { method: "ai", refs, rules_bluf: [{ text: "Most reported: Iran plots dirty bomb attack (1 outlet)", refs: [1] }],
    bluf: [{ text: "Several outlets confirm the dirty bomb plot.", refs: [1] }], ai_watch: [{ text: "Watch for proven links to the plot.", refs: [1] }, { text: "Watch for US statements.", refs: [1] }] };
  assert.equal(dropOverclaims(day), 2);
  assert.equal(day.method, "rules"); assert.equal(day.bluf[0].text, "Most reported: Iran plots dirty bomb attack (1 outlet)");
  assert.deepEqual(day.ai_watch.map((w) => w.text), ["Watch for US statements."]);
  assert.equal(dropOverclaims(day), 0, "a rules summary is left alone");
  const kept = { method: "ai", refs, bluf: [{ text: "China confirms a trilateral summit.", refs: [2] }], ai_watch: [] };
  assert.equal(dropOverclaims(kept), 0); assert.equal(kept.method, "ai");
});
t("fingerprint is stable and ignores the build time", () => {
  assert.equal(fingerprint({ ...d, made: "a" }), fingerprint({ ...d, made: "b" }));
  assert.match(fingerprint(d), /^[0-9a-f]{64}$/);
});
t("a flashpoint line carries the reports that mention it, newest first, as numbered sources", () => {
  const fp = buildRules({ ...inp, flashpoints: [{ title: "Budo Mountains", where: "Deep South", why: "2 reports mention it.", _reports: [
    { source: "Old Paper (News outlet)", title: "Older story", url: "https://o/1", ts: "2026-09-10T08:00" },
    { source: "New Paper (News outlet)", title: "Newer story", url: "https://n/1", ts: "2026-09-26T08:00" },
    { source: "Bad", title: "No link", url: "javascript:alert(1)", ts: "2026-09-27T08:00" }] }] }, R);
  const w = fp.watch.find((x) => x.from === "flashpoint");
  assert.equal(w.fp, "Budo Mountains");
  assert.deepEqual(w.refs.map((n) => fp.refs[n - 1].url), ["https://n/1", "https://o/1"]);
  assert.equal(fp.refs[w.refs[0] - 1].outlet, "New Paper");
});
// World ("ww"): the most reported stories of every country's Story coverage, counted on the outlets of the last 24 hours
const src = (o, date, url, title, kind = "other") => [o, kind, "dom", "", date, url, title, 0, 0];
const story = (t, u, src, b) => ({ t, u, s: src[0][0], n: src.length, src, b });
const many = (n, base, title, date = "2027-01-01T20:00", kind) => Array.from({ length: n }, (_, i) => src("Outlet " + base + i, date, `https://${base}/${i}`, title, kind));
const wend = Date.parse("2027-01-02T00:00:00Z");
const W = buildWorld({ end: wend, names: { aa: "Alphaland", bb: "Betaland", cc: "Gammaland" }, conflicts: [
  { id: "c1", name: "Quiet war", stats: { reports: { d1: 0, d7: 4 } }, cc: "aa" }, { id: "c2", name: "Busy war", stats: { reports: { d1: 40, d7: 300 } }, cc: "bb" }],
  stories: [
    ["aa", { stories: [story("Missile strike kills 12 in border town", "https://a/0", many(9, "a", "Missile strike kills 12 in border town")),
      story("Old summit story", "https://o/0", many(30, "o", "Old summit story", "2026-12-29T10:00")),
      story("Only state media", "https://s/0", many(5, "s", "Only state media", "2027-01-01T20:00", "state"), "state-only")] }],
    ["bb", { stories: [story("Cabinet resigns amid protests", "https://b/0", many(6, "b", "Cabinet resigns amid protests", "2027-01-01T20:00", "state").concat(many(2, "bx", "Cabinet resigns amid protests"))),
      // the same story filed under a second country (shares a link) is kept once
      story("Missile strike kills 12 in border town", "https://a/0", many(9, "a", "Missile strike kills 12 in border town"))] }],
    ["cc", { stories: [story("Football final ends in draw", "https://f/0", many(20, "f", "Football final ends in draw"))] }],
    ["ww", { stories: [story("never from World itself", "https://w/0", many(50, "w", "never from World itself"))] }]] }, R);
t("World summary: most reported stories of every country in 24 hours, each naming its country", () => {
  assert.equal(W.cc, "ww"); assert.equal(W.name, "World"); assert.equal(W.window.hours, 24); assert.equal(W.method, "rules");
  const T = W.events.map((e) => e.text);
  assert.deepEqual(T, ["Missile strike kills 12 in border town", "Cabinet resigns amid protests"], "old, blindspot, sport and World's own stories are left out; a story under two countries once");
  assert.equal(W.events[0].where, "Alphaland"); assert.equal(W.events[0].n, 9);
  assert.equal(W.events[1].some_state, true, "state outlets on a story are marked");
  assert.ok(W.events.every((e) => e.refs.length && e.refs.every((n) => /^https:\/\//.test(W.refs[n - 1].url))), "every event links its sources");
  assert.ok(W.refs.filter((r) => /g/.test(r.flags || "")).length, "state outlets' links are flagged as claims");
  assert.match(W.bluf[0].text, /Most reported worldwide: .Missile strike kills 12 in border town. \(9 outlets, filed under Alphaland\)/);
  assert.deepEqual(W.watch.map((w) => [w.tab, w.cc]), [["c2", "bb"]], "only conflict tabs with reports in the last day, each with the country to open it in");
  assert.equal(W.basis.countries, 3, "countries with a story carried by two or more outlets in the window");
});
t("World summary with nothing reported says so", () => {
  const E = buildWorld({ end: wend, stories: [], conflicts: [] }, R);
  assert.equal(E.events.length, 0); assert.equal(E.bluf.length, 0); assert.match(E.gaps[0], /^No story was carried/);
});
t("a country brief's watch points are carried only while the brief is 30 days old or less", () => {
  const brief = (as_of) => ({ as_of, threat: { watch_points: ["Watch the border", "Watch the vote"] } });
  const fresh = buildRules({ ...inp, brief: brief("2026-09-20") }, R).watch.filter((w) => w.from === "brief");
  assert.equal(fresh.length, 2); assert.equal(fresh[0].asof, "2026-09-20");
  assert.equal(buildRules({ ...inp, brief: brief("2026-08-01") }, R).watch.filter((w) => w.from === "brief").length, 0);
  assert.equal(buildRules({ ...inp, brief: brief("") }, R).watch.filter((w) => w.from === "brief").length, 0);
  assert.equal(briefFresh("2026-09-26", Date.parse("2026-11-19T03:00:00Z")), false);
  assert.equal(briefFresh("2026-11-01", Date.parse("2026-11-19T03:00:00Z")), true);
  assert.equal(briefFresh("2027-01-01", Date.parse("2026-11-19T03:00:00Z")), false);
});
t("a refreshed brief's watch points are dated by watch_asof, not by its as_of", () => {
  const b = (as_of, watch_asof) => ({ as_of, researched: "2026-08-01", threat: { watch_points: ["Watch the border"], watch_asof } });
  const w = buildRules({ ...inp, brief: b("2026-09-20", "2026-09-19") }, R).watch.filter((x) => x.from === "brief");
  assert.equal(w.length, 1); assert.equal(w[0].asof, "2026-09-19");
  // as_of moved by a section update while the watch points stayed from an old research date: not carried
  assert.equal(buildRules({ ...inp, brief: b("2026-09-20", null) }, R).watch.filter((x) => x.from === "brief").length, 0);
});
t("an AI line may not give one country's institution to another (20 Nov 2026: \"Iran's Senate\" from US Senate headlines)", () => {
  const senate = ["Senate Republicans reject war powers resolution to end Iran conflict", "Iran war powers measure again falls short in Senate",
    "US Senate Republicans reject resolution calling on Trump to end Iran war"];
  assert.deepEqual(misattributed("Iran's Senate rejects war powers resolution to end the conflict with Iran.", senate), ["Iran's Senate"]);
  assert.deepEqual(misattributed("China's military considers using gamers for drone surveillance.", ["Malaysia’s military eyes gamers for South China Sea drone surveillance"]), ["China's military"]);
  // negatives: the headline's own pairing, a demonym, a loose pairing nearby, no other country named, and a non-country owner all stay
  assert.deepEqual(misattributed("The US Senate rejects the resolution.", senate), []);
  assert.deepEqual(misattributed("America's Senate rejects the resolution.", senate), [], "America = US");
  assert.deepEqual(misattributed("Iran's military downs a drone.", ["Iranian military downs 17th US drone, US military says"]), [], "Iranian military supports Iran's military");
  assert.deepEqual(misattributed("Iran's military attacks a radar in Bahrain.", ["Iran attacks US military radar system in Bahrain"]), [], "Iran within three words of military");
  assert.deepEqual(misattributed("Thailand's army reports a clash.", ["Army says clash on border"]), [], "no other country named: not judged");
  assert.deepEqual(misattributed("Trump's government faces a vote.", senate), [], "a person, not a country");
  // the build drops it; a kept summary drops it too and counts it apart from overclaims
  const refs = senate.map((title, i) => ({ n: i + 1, title, outlet: "O" + i, url: "https://x/" + i }));
  const v = validateAi({ bluf: [{ text: "Iran's Senate rejects war powers resolution to end the Iran conflict.", refs: [1, 2, 3] },
    { text: "The US Senate rejects a resolution to end the Iran war, as reported by The Hill.", refs: [1, 3] }] }, 3, refs);
  assert.deepEqual(v.bluf.map((b) => b.refs.length), [2]);
  const day = { method: "ai", refs, rules_bluf: [{ text: "Most reported: Senate Republicans reject war powers resolution", refs: [1] }],
    bluf: [{ text: "Iran's Senate rejects war powers resolution to end the Iran conflict.", refs: [1, 2, 3] }], ai_watch: [] };
  assert.equal(dropOverclaims(day), 1);
  assert.equal(day.ai_misattributed, 1); assert.equal(day.ai_overclaim, undefined); assert.equal(day.method, "rules");
});
console.log(`${ok} passed`);
