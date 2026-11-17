// Daily country summary rules (tools/daily_lib.mjs). Run: node tests/daily.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { compileRelevance } from "../tools/topics_lib.mjs";
import { buildRules, buildWorld, validateAi, stripInlineCites, cluster, softSection, unent, fromRow, fingerprint } from "../tools/daily_lib.mjs";

const R = compileRelevance(JSON.parse(fs.readFileSync("tools/relevance.json", "utf8")));
const end = Date.parse("2026-09-28T01:00:00Z");
const row = (t, outlet, url, date = "2026-09-27T20:00", flags = "") => fromRow(["xx", date, t, "", outlet, url, "", flags, ""]);
let ok = 0; const t = (name, f) => { f(); ok++; console.log("ok -", name); };

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
console.log(`${ok} passed`);
