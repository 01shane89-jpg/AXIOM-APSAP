// Daily country summary rules (tools/daily_lib.mjs). Run: node tests/daily.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { compileRelevance } from "../tools/topics_lib.mjs";
import { buildRules, validateAi, cluster, softSection, unent, fromRow, fingerprint } from "../tools/daily_lib.mjs";

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
console.log(`${ok} passed`);
