// Daily country summary rules (tools/daily_lib.mjs). Run: node tests/daily.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { compileRelevance } from "../tools/topics_lib.mjs";
import { actorCountryAdded, cutOff } from "../tools/ai_lines.mjs";
import { briefFresh, buildRules, buildWorld, validateAi, stripInlineCites, cluster, softSection, unent, fromRow, fingerprint, aiQueue, shardQueue, takeShardDay, overclaims, dropOverclaims } from "../tools/daily_lib.mjs";

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
t("on a busy day the events fill their 30 sources, and the warning and advisory keep their own links", () => {
  const heads = ["Bomb kills three soldiers in Pattani market", "Floods force evacuation of Yala villages", "Police arrest drug smugglers on Mekong river",
    "Earthquake shakes Chiang Rai province", "Gunmen attack checkpoint near Narathiwat", "Navy seizes fuel tanker off Songkhla", "Wildfire spreads across Tak forest"], items = [];
  heads.forEach((h, k) => { for (let j = 0; j < 7; j++) items.push(row(h, `Outlet ${k}-${j}`, `https://n/${k}/${j}`)); });
  const b = buildRules({ ...inp, items }, R);
  assert.equal(b.refs.filter((r) => r.via !== "warning" && r.via !== "advisory").length, 30, "the events alone fill the 30 sources");
  const w = b.watch.find((x) => x.from === "warning"), a = b.watch.find((x) => x.from === "advisory");
  assert.equal(b.refs[w.refs[0] - 1].url, "https://met/1");
  assert.equal(a.refs.length, 1); assert.equal(b.refs[a.refs[0] - 1].url, "https://travel.state.gov/x");
  assert.equal(new Set(b.refs.map((r) => r.url)).size, b.refs.length);
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
t("an AI line may not give an institution another country's name, or stop mid-sentence (World and Taiwan, 20 Nov)", () => {
  const refs = [{ n: 1, title: "Senate Republicans reject war powers resolution to end Iran conflict" },
    { n: 2, title: "Iran war powers measure again falls short in Senate" },
    { n: 3, title: "US Senate Republicans reject resolution calling on Trump to end Iran war" },
    { n: 4, title: "Malaysia’s military eyes gamers for South China Sea drone surveillance" },
    { n: 5, title: "Supreme Court dismisses appeal of accused convicted for supporting Iranian terrorist attacks against the Kingdom of Bahrain" }];
  const v = validateAi({ bluf: [
    { text: "Iran's Senate rejects war powers resolution to end the conflict with Iran as reported by The Hill, CBS News, and The Jerusalem Post.", refs: [1, 2, 3] },
    { text: "The US Senate rejects a war powers resolution on the Iran conflict, The Hill reports.", refs: [1, 2, 3] },
    { text: "China's military considers using gamers for drone surveillance in the South China Sea, SCMP reports.", refs: [4] },
    { text: "The Supreme Court of Bahrain dismissed appeals of people convicted for supporting Iranian attacks.", refs: [5] }] }, 5, refs);
  assert.deepEqual(v.bluf.map((b) => b.text.slice(0, 20)), ["The US Senate reject", "The Supreme Court of"], "the wrong owner goes; a context country no headline contradicts stays");
  assert.equal(actorCountryAdded("Myanmar's junta carries out airstrikes", ["Myanmar: Junta carries out double-tap airstrikes", "Thailand offers to mediate"]), "");
  assert.equal(actorCountryAdded("The Cambodian prime minister raises the Thai invasion", ["Prime Minister raises issue of Thai invasion of Cambodia"]), "");
  const cut = "Russian Tu-95 bombers approach Taiwan's east, while balloons fly over the west (TVBS). The Central Weather Administration has issued warnings leading to road closures in Tai 14 A line section from 18K Tsui-pieng to 32.7K Matsue-lu due to";
  assert.equal(cutOff(cut), "Russian Tu-95 bombers approach Taiwan's east, while balloons fly over the west (TVBS).");
  assert.equal(cutOff("Warnings stay in force until 3:00AM EST due to flooding (US National Weather Service),"), "", "one unfinished sentence: nothing left");
  assert.equal(cutOff("Haiti police kill 34 suspected gang members, Dominican Today reports."), "Haiti police kill 34 suspected gang members, Dominican Today reports.");
  assert.equal(cutOff("Floods close 3 roads in Yala"), "Floods close 3 roads in Yala", "no full stop but whole");
  // a kept summary: the wrong-owner line goes, the cut line is trimmed
  const day = { method: "ai", refs, rules_bluf: [{ text: "Most reported: Senate rejects war powers measure", refs: [1] }],
    bluf: [{ text: "Iran's Senate rejects the war powers resolution, The Hill reports.", refs: [1, 3] }, { text: cut, refs: [4] }], ai_watch: [] };
  assert.equal(dropOverclaims(day), 2);
  assert.equal(day.bluf.length, 1); assert.match(day.bluf[0].text, /\(TVBS\)\.$/); assert.equal(day.ai_actor, 1); assert.equal(day.ai_cut, 1);
  assert.equal(dropOverclaims(day), 0, "checked again: nothing more to do");
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
t("Shards: each takes its turn from the back of the queue, all together cover it once; no shard means the whole queue", () => {
  const q = ["ww", "th", "ua", "de", "fr", "it", "es"];
  const parts = [0, 1, 2].map((k) => shardQueue(q, k + "/3"));
  assert.deepEqual(parts[0], ["es", "de", "ww"]); assert.deepEqual(parts[1], ["it", "ua"]); assert.deepEqual(parts[2], ["fr", "th"]);
  assert.deepEqual(parts.flat().sort(), [...q].sort());
  assert.deepEqual(shardQueue(q, ""), q); assert.deepEqual(shardQueue(q, "3/3"), []); assert.deepEqual(shardQueue(q, "0/0"), []);
  assert.deepEqual(q[0], "ww");   // the queue itself is not reversed in place
});

t("Shard merge: only today's AI draft is taken, and never over main's own AI draft of today", () => {
  const day = (date, method) => ({ days: [{ date, method }] });
  assert.equal(takeShardDay(day("2026-11-23", "ai"), day("2026-11-23", "rules"), "2026-11-23"), true);
  assert.equal(takeShardDay(day("2026-11-23", "ai"), null, "2026-11-23"), true);
  assert.equal(takeShardDay(day("2026-11-23", "ai"), day("2026-11-23", "ai"), "2026-11-23"), false);
  assert.equal(takeShardDay(day("2026-11-23", "rules"), day("2026-11-23", "rules"), "2026-11-23"), false);
  assert.equal(takeShardDay(day("2026-11-22", "ai"), day("2026-11-23", "rules"), "2026-11-23"), false);
  assert.equal(takeShardDay(null, day("2026-11-23", "rules"), "2026-11-23"), false);
});
console.log(`${ok} passed`);
