// Unit test for tools/factcheck_lib.mjs (no network): a feed item becomes a check only with a headline, a web link and a date;
// fact-checks match a story thread only on the words of their own headline, through a name of the thread that is not a country,
// a people or an office, plus more of the event's words, or on four of the event's words; old checks are left out; figures that
// reports give differently are listed in time order, and a report wrongly joined to the thread does not add its numbers.
// Usage: node tests/factcheck.test.mjs
import assert from "node:assert/strict";
import { checkItem, prepChecks, factMatch, figureIn, figures } from "../tools/factcheck_lib.mjs";

assert.equal(checkItem("x", { title: "No date", link: "https://a.org/1" }), null);
assert.equal(checkItem("x", { title: "Bad link", link: "javascript:alert(1)", date: "Thu, 13 Nov 2026 10:00:00 GMT" }), null);
const it = checkItem("x", { title: " A  claim ", link: "https://a.org/1", date: "Thu, 13 Nov 2026 10:00:00 GMT", summary: "Text. The post A claim appeared first on A." });
assert.deepEqual(it, ["x", "2026-11-13T10:00Z", "A claim", "https://a.org/1", "Text."]);

const find = (t) => ["Abu Dhabi", "Unknown Soldier", "Hegseth", "Washington", "Prime Minister", "Chinese", "FAA"].filter((n) => t.includes(n));
const mk = (id, d, title, summary = "") => [id, d, title, "https://fc.example/" + encodeURIComponent(title), summary];
const checks = prepChecks([
  mk("a", "2026-11-13T09:00Z", "Peace on Moscow's Terms: Disinformation Ahead of the Abu Dhabi Talks"),
  mk("b", "2026-11-13T09:00Z", "Washington Examiner did not report this", "Abu Dhabi talks peace Ukraine"),
  mk("c", "2026-11-12T09:00Z", "Does video show Hegseth's group being reprimanded at the Tomb of the Unknown Soldier?"),
  mk("d", "2026-11-12T09:00Z", "Prime Minister did not say that about Chinese talks"),
  mk("e", "2026-08-01T09:00Z", "Old: Abu Dhabi talks were cancelled"),
  mk("f", "2026-11-13T09:00Z", "Rescue effort underway after tanker collides with river cruise ship"),
], find);
const thread = (names, w) => ({ d0: "2026-11-12T00:00", d: "2026-11-14T00:00", names: names.map((n) => [n, 3, 10, []]), w });
const ids = (t) => factMatch(t, checks).map((c) => c[0]);
assert.deepEqual(ids(thread(["Abu Dhabi", "Washington", "Prime Minister", "Chinese"], ["abu", "dhabi", "talk", "ukraine", "peace"])), ["a"],
  "a name and one more event word in the check's own headline; never from its summary; an office or a people is no name; old checks left out");
assert.deepEqual(ids(thread(["Hegseth"], ["hegseth", "reprimand", "soldier"])), ["c"], "a one-word name needs two more of the event's words");
assert.deepEqual(ids(thread(["Hegseth"], ["hegseth", "medal"])), [], "a one-word name and nothing else is no match");
assert.deepEqual(ids(thread([], ["tanker", "collide", "cruise", "ship", "orlean"])), ["f"], "four of the event's words match without a name");
assert.deepEqual(factMatch(thread(["Abu Dhabi"], ["abu", "dhabi", "talk"]), checks)[0].slice(5), ["", ["Abu Dhabi"]], "says which names it shares");
// a check in another language matches by its English headline (item[5]) and says so
const es = prepChecks([["m", "2026-11-13T09:00Z", "Las conversaciones de Abu Dhabi", "https://fc.example/es", "", "The Abu Dhabi talks"]], find);
assert.deepEqual(factMatch(thread(["Abu Dhabi"], ["abu", "dhabi", "talk"]), es).map((c) => [c[0], c[5]]), [["m", "The Abu Dhabi talks"]]);
// words that always go with a name (Jensen Huang: nvidia, ceo) are not the one more word
const hu = prepChecks([["l", "2026-11-13T09:00Z", "Nvidia CEO Jensen Huang did not say that", "https://fc.example/hu", ""]], (t) => ["Jensen Huang"].filter((n) => t.includes(n)));
const tH = thread(["Jensen Huang"], ["nvidia", "ceo", "huang", "jensen", "resign"]);
assert.equal(factMatch(tH, hu).length, 1, "without the name's usual words it matches");
assert.equal(factMatch(tH, hu, { ctxOf: () => ["nvidia", "ceo"] }).length, 0, "with them, a check about another claim by the same person is left out");
assert.deepEqual(ids({ ...thread(["Abu Dhabi"], ["abu", "dhabi", "talk"]), d0: "2026-08-10T00:00" }), ["a", "e"], "a check from up to 45 days before counts");

assert.equal(figureIn("At least 12 people killed in strike", "killed"), 12);
assert.equal(figureIn("Twenty-two civilians killed and 10 abducted", "killed"), 22);
assert.equal(figureIn("Clash death toll rises to six, 15 injured", "killed"), 6);
assert.equal(figureIn("Clash death toll rises to six, 15 injured", "injured"), 15);
assert.equal(figureIn("Over 1,200 people evacuated as typhoon nears", "displaced"), 1200);
assert.equal(figureIn("2025 deaths recorded on roads", "killed"), 0, "a year is not a count");
assert.equal(figureIn("Police arrest 15 in raid", "arrested"), 0);
const row = (d, t) => ["Outlet", "other", "dom", "us", d, "https://x/" + d, t, 0, 0];
const rows = [row("2026-11-12T01:00", "Brooklyn building collapse leaves one dead"), row("2026-11-12T02:00", "Kenya building collapse: six dead near Nairobi"),
  row("2026-11-12T09:00", "Eight dead after Brooklyn building collapse"), row("2026-11-12T05:00", "Two dead in Brooklyn building collapse")];
const fg = figures(rows, ["brooklyn", "build", "collapse", "dead"], [["Brooklyn", 3]]);
assert.equal(fg.length, 1);
assert.deepEqual(fg[0][2].map((x) => x[0]), [1, 2, 8], "in time order, without the wrongly joined Kenya report");
assert.deepEqual(figures(rows.slice(2, 3), ["brooklyn", "build", "collapse"], []), [], "one figure is nothing to compare");
console.log("fact check test: all passed");
