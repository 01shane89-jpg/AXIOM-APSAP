// Headline changes (tools/headline_edits.mjs, tools/dense_edits.mjs): which differences count, what is kept, the item wording,
// and the Internet Archive copy only when it is from before the change.
import { norm, sameHeadline, isEdit, whatChanged, carryEdits, MAX_EDITS } from "../tools/headline_edits.mjs";
import { editItems, waybackBefore } from "../tools/dense_edits.mjs";
let bad = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) bad++; };

ok(sameHeadline("Trump says “no deal”", "trump says \"no deal\""), "quotes and case are not a change");
ok(sameHeadline("Gas blast in Hanoi kills 6, injures 10 ...", "Gas blast in Hanoi kills 6, injures 10 people in hot pot shop"), "a headline cut short with ... is not a change");
ok(!sameHeadline("4 adults and 2 kids are missing after plane crashes off Mississippi coast", "6 killed when plane crashes off Mississippi"), "a different headline is a change");
ok(norm("Under-performing  City") === "under performing city", "dashes and spaces folded");

const prev = { link: "https://x.example/a", title: "4 adults and 2 kids are missing after plane crashes off Mississippi coast", outlet: "AP", via: "RSS", first_seen: "2026-11-25 01:10Z" };
const cur = { ...prev, title: "6 killed when plane crashes off Mississippi" };
ok(isEdit(prev, cur), "same link, outlet and feed, new headline: an edit");
ok(!isEdit(prev, { ...cur, via: "search" }), "a search result's headline is not the outlet's edit");
ok(!isEdit(prev, { ...cur, outlet: "Other" }), "another outlet's copy of the link is not an edit");
ok(!isEdit(null, cur), "a new story is not an edit");

const c = whatChanged(prev.title, cur.title);
ok(c.numbers && c.numbers.gone.join() === "4,2" && c.numbers.added.join() === "6" && c.words.gone.includes("missing") && c.words.added.includes("killed"), "numbers and words that changed (" + JSON.stringify(c) + ")");
ok(!Object.keys(whatChanged("Huawei found guilty of stealing trade secrets", "Huawei found guilty of stealing US trade secrets")).length, "an added place name changes no number or key word");

const o1 = carryEdits(prev, cur, "2026-11-25 07:40Z");
ok(o1.edits.length === 1 && o1.edits[0].was === prev.title && o1.edits[0].from === "2026-11-25 01:10Z" && o1.edits[0].by === "2026-11-25 07:40Z" && o1.title_since === "2026-11-25 07:40Z", "the old headline and both times are kept");
const kept = { ...cur, ...o1 };
const o2 = carryEdits(kept, { ...cur }, "2026-11-25 08:10Z");
ok(o2.edits.length === 1 && o2.title_since === "2026-11-25 07:40Z", "an unchanged headline carries the record forward");
let h = kept; for (let k = 0; k < 10; k++) { const n = { ...cur, title: "Headline version " + k }; h = { ...n, ...carryEdits(h, n, "2026-11-26 0" + k + ":00Z") }; }
ok(h.edits.length === MAX_EDITS, "at most " + MAX_EDITS + " changes kept per story");
ok(!("summary" in o1.edits[0]) && Object.keys(o1.edits[0]).every((k) => ["was", "was_en", "from", "by"].includes(k)), "only headlines and times are stored, no article text");

const now = Date.parse("2026-11-26T00:00Z");
const I = editItems({ us: [kept, { ...kept }], gb: [{ ...prev, title: "Old story", edits: [{ was: "x", from: "2026-10-01 00:00Z", by: "2026-10-02 00:00Z" }] }] }, now);
ok(I.length === 1 && I[0].ccs.join() === "us" && I[0].url === prev.link, "one item per story, changes older than the window left out");
ok(/^Headline changed: AP: 6 killed/.test(I[0].title) && /Was: “4 adults/.test(I[0].detail) && /numbers 4, 2 gone, 6 new/.test(I[0].detail) && /not a finding/.test(I[0].detail) && I[0].sev === 2, "item wording (" + I[0].detail + ")");
ok(/times OSAP read the feed, not when the outlet edited it/.test(I[0].detail), "the times are said to be OSAP's reads");

const snap = (ts) => ({ archived_snapshots: { closest: { available: true, url: "http://web.archive.org/web/" + ts + "/https://x.example/a", timestamp: ts, status: "200" } } });
const w = waybackBefore(snap("20261125031500"), "2026-11-25 07:40Z");
ok(w && w.url.startsWith("https://web.archive.org/web/20261125031500/") && w.when === "2026-11-25 03:15Z", "an archive copy from before the change is linked");
ok(waybackBefore(snap("20261125090000"), "2026-11-25 07:40Z") === null, "a copy saved after the change is not offered as the old version");
ok(waybackBefore({ archived_snapshots: {} }, "2026-11-25 07:40Z") === null && waybackBefore({ archived_snapshots: { closest: { available: true, url: "https://evil.example/x", timestamp: "20261125031500" } } }, "2026-11-25 07:40Z") === null, "no copy, or a link off the archive: nothing linked");

if (bad) { console.log(bad + " failed"); process.exit(1); }
console.log("all passed");
