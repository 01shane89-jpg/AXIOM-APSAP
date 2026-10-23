// Unit test for tools/stories_lib.mjs and tools/news_stories.mjs (no network): outlets counted once per story, who owns them and
// where they are based, the three blindspots, and the cases where a blindspot must not be claimed (the silent side was not
// publishing, or carried a near-matching headline). Then the tool on a small pool: only headlines and links are written, one file
// per country with news, stale files removed.
// Usage: node tests/stories.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { outletBook, outletName, fromRow, group, buildCountry } from "../tools/stories_lib.mjs";

const END = Date.parse("2026-10-23T12:00:00Z");
const at = (h) => new Date(END - h * 36e5).toISOString().slice(0, 16);
let n = 0;
const rep = (outlet, title, o = {}) => ({ ccs: [o.cc || "xx"], date: o.date || at(2), title, orig: o.orig || "", outlet, link: o.link || "https://e.x/" + (++n), flags: o.flags || "" });
const feeds = [
  { cc: "xx", outlet: "Home Daily" }, { cc: "xx", outlet: "Home Post" }, { cc: "xx", outlet: "Home Times" }, { cc: "xx", outlet: "State Agency", state: true },
  { cc: "yy", outlet: "Far Herald" }, { cc: "zz", outlet: "Far Courier" }, { cc: "ww", outlet: "Far Ledger" }, { cc: "xx", outlet: "BBC Xland" },
  { cc: "xx", outlet: "Twice" }, { cc: "yy", outlet: "Twice" },
];
const owners = { state: [["^xinhua", "cn"]], public: [["^bbc", "gb"]], based: [["^reuters", "gb"]] };
const named = (t) => (/\bXland\b/.test(t) ? ["xx"] : []);

// outlet names and the outlet book
assert.equal(outletName("Reuters on MSN (via Bing News search)"), "Reuters");
const book = outletBook(feeds, owners, new Map([["blog of x", new Map([["xx", 9]])], ["mixed", new Map([["xx", 5], ["yy", 5]])]]));
assert.deepEqual(book.of("Home Daily"), { kind: "other", cc: "xx", how: "feed" });
assert.deepEqual(book.of("State Agency"), { kind: "state", cc: "xx", how: "feed" });
assert.deepEqual(book.of("BBC Xland"), { kind: "public", cc: "gb", how: "list" }, "a broadcaster's foreign service is based where the broadcaster is");
assert.deepEqual(book.of("Xinhua (via Bing News search)"), { kind: "state", cc: "cn", how: "list" });
assert.deepEqual(book.of("Reuters on MSN"), { kind: "other", cc: "gb", how: "list" });
assert.equal(book.of("Twice").cc, null, "an outlet name filed under two countries is not placed");
assert.deepEqual(book.of("Blog of X"), { kind: "other", cc: "xx", how: "inferred" });
assert.equal(book.of("Mixed").cc, null, "a publisher split between countries is not placed");

// a pool row: entities decoded, no summary kept
const r = fromRow(["xx", "2026-10-23T10:00", "Kim&apos;s visit", "", "Home Daily (via Bing News search)", "https://a/1", "a long outlet summary", "gm", "", ""]);
assert.equal(r.title, "Kim's visit"); assert.equal(r.outlet, "Home Daily"); assert.equal(r.flags, "gm");
assert.ok(!("summary" in r), "an outlet's text is never carried");

// grouping
const g = group([{ title: "Flood kills five in northern Xland province" }, { title: "Five killed as flood hits northern Xland province" }, { title: "Central bank raises rates" }]);
assert.equal(g.length, 2);

// enough background headlines that each side counts as publishing (20 state, 10 home)
const bg = [];
for (let i = 0; i < 22; i++) bg.push(rep("State Agency", "Minister opens ceremony number " + i + " in town" + i, { flags: "g" }));
for (let i = 0; i < 12; i++) bg.push(rep(i % 2 ? "Home Daily" : "Home Post", "Local market report " + i + " for district" + i));
const story = (t, outlets, o = {}) => outlets.map((x) => rep(x, t, { flags: x === "State Agency" ? "g" : "", ...o }));
const reps = [
  ...bg,
  // carried by 5 outlets, twice by one of them: counted once
  ...story("Bridge collapse in Xland capital kills twelve", ["Home Daily", "Home Post", "Home Daily", "State Agency", "Far Herald", "BBC Xland"]),
  // only state media
  ...story("President praises record harvest across eastern farms", ["State Agency", "Xinhua"]),
  // state media silent: three other outlets
  ...story("Opposition leader arrested after rally in port city", ["Home Daily", "Home Times", "Far Herald"]),
  // not covered at home: three outlets elsewhere, the story names the country
  ...story("Xland army moves troops toward disputed border pass", ["Far Herald", "Far Courier", "Far Ledger"]),
  // three outlets elsewhere, but a home outlet carried a near-matching headline: no blindspot
  ...story("Xland signs gas pipeline deal with neighbour", ["Far Herald", "Far Courier", "Far Ledger"]),
  rep("Home Times", "Gas pipeline deal signed with neighbour, ministry says"),
  // out of the 72-hour window: left out
  ...story("Old story about Xland drought relief effort", ["Home Daily", "Home Post"], { date: at(80) }),
];
const c = buildCountry("xx", reps, outletBook(feeds, owners), named, { end: END });
const find = (w) => c.stories.find((s) => s.t.includes(w));
const bridge = find("Bridge collapse");
assert.equal(bridge.n, 5, "an outlet that carried a story twice counts once");
assert.deepEqual(bridge.k, { state: 1, public: 1, other: 3 });
assert.deepEqual(bridge.o, { dom: 3, out: 2, unk: 0 });
assert.equal(bridge.b, undefined);
assert.match(bridge.fp, /^[0-9a-f]{64}$/);
assert.equal(bridge.src.length, 5);
assert.ok(bridge.src.every((x) => x.length === 9 && /^https:/.test(x[5])), "each outlet line: outlet, kind, home, country, date, link, headline, mt, inferred");
assert.equal(find("record harvest").b, "state-only");
assert.equal(find("Opposition leader").b, "state-silent");
assert.equal(find("army moves troops").b, "outside-only");
assert.notEqual(find("gas pipeline").b, "outside-only", "a near-matching home headline stops the not-covered-at-home blindspot");
assert.equal(find("gas pipeline").b, "state-silent", "the state agency still carried nothing like it");
assert.equal(find("drought relief"), undefined, "a story older than 72 hours is left out");
assert.deepEqual(c.sides.stateRead, ["State Agency"]);
assert.equal(c.sides.active.state, true); assert.equal(c.sides.active.home, true);

// the silent side was not publishing: no blindspot is claimed
const quiet = buildCountry("xx", reps.filter((x) => !bg.includes(x)), outletBook(feeds, owners), named, { end: END });
assert.equal(quiet.sides.active.state, false); assert.equal(quiet.sides.active.home, false);
assert.equal(quiet.stories.find((s) => s.t.includes("Opposition leader")).b, undefined);
assert.equal(quiet.stories.find((s) => s.t.includes("army moves troops")).b, undefined);
assert.equal(quiet.stories.find((s) => s.t.includes("record harvest")).b, "state-only", "only-state-media needs no activity test");
// state media found only through searches (no g flag) never make the state side "publishing"
const searched = buildCountry("xx", reps.map((x) => ({ ...x, flags: "" })), outletBook(feeds, owners), named, { end: END });
assert.equal(searched.sides.active.state, false);
assert.equal(searched.stories.find((s) => s.t.includes("Opposition leader")).b, undefined);

// the tool on a small pool (geo_cc reads the page's country list, so it runs from the repository with the pool elsewhere)
const repo = path.resolve(new URL("..", import.meta.url).pathname);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "st-")), ix = path.join(dir, "ix"), out = path.join(dir, "stories");
fs.mkdirSync(ix); fs.mkdirSync(out);
fs.writeFileSync(path.join(out, "zz.js"), "stale");
const day = "2026-10-23", row = (cc, t, o, l) => [cc, "2026-10-23T09:00", t, "", o, l, "outlet summary text that must not be written", "", "", ""];
fs.writeFileSync(path.join(ix, day + ".js"), "window.OSAP_NEWSIX_DAY=window.OSAP_NEWSIX_DAY||{};window.OSAP_NEWSIX_DAY[" + JSON.stringify(day) + "]=" + JSON.stringify([
  row("th", "Flood kills five in northern Thailand province", "Bangkok Post", "https://a/1"),
  row("th", "Five killed as flood hits northern Thailand province", "Khaosod English", "https://a/2"),
  row("my", "Flood kills five in northern Thailand province, officials say", "Malay Mail", "https://a/3"),
]) + ";\n");
const env = { ...process.env, STORIES_IX: ix, STORIES_OUT: out, STORIES_END: "2026-10-23T12:00:00Z" };
execFileSync("node", ["tools/news_stories.mjs"], { cwd: repo, env, encoding: "utf8" });
const read = (f) => { const w = {}; new Function("window", fs.readFileSync(f, "utf8"))(w); return w; };
const th = read(path.join(out, "th.js")).OSAP_STORIES;
assert.equal(th.cc, "th"); assert.equal(th.stories.length, 1); assert.equal(th.stories[0].n, 3);
assert.deepEqual(th.stories[0].o, { dom: 2, out: 1, unk: 0 }, "Malay Mail (Malaysia) covering Thailand counts as elsewhere");
assert.ok(!fs.readFileSync(path.join(out, "th.js"), "utf8").includes("outlet summary"), "no outlet text is written");
assert.ok(!fs.existsSync(path.join(out, "zz.js")), "a stale country file is removed");
assert.ok(fs.existsSync(path.join(out, "my.js")));
const sum = read(out + ".js").OSAP_STORIESIX;
assert.deepEqual(sum.countries.th, [1, 0]);
fs.rmSync(dir, { recursive: true, force: true });
console.log("stories: all checks passed");
