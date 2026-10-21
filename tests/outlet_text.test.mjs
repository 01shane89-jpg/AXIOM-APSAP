// Outlet text is read by the refresh jobs but never stored (tools/outlet_text.mjs, licence fix 2026-10-17): a news item keeps its
// headline, link and what OSAP derived, and a story its summary kept relevant stays kept. Run from the repo root:
// node tests/outlet_text.test.mjs
import assert from "node:assert/strict";
import { stripOutletText } from "../tools/outlet_text.mjs";
import { loadRelevance, itemRelevance, kept } from "../tools/topics_lib.mjs";

const R = await loadRelevance();
let ok = 0; const t = (name, f) => { f(); ok++; console.log("ok -", name); };

t("summary, its translation and a headline made from it are removed", () => {
  const i = stripOutletText({ title: "ข่าว", title_en: "First sentence of the summary", title_from_summary: true, summary: "สรุป", summary_en: "Summary text",
    link: "https://example.org/a", lang: "th", geo: { n: "Yala" } }, R);
  assert.deepEqual(Object.keys(i).sort(), ["geo", "lang", "link", "title"]);
});
t("what the summary's words matched is kept, so the story stays relevant without it", () => {
  const i = { title: "Village meeting held on Tuesday", summary: "Police said a bomb exploded near the market, two people were killed.", link: "https://example.org/b", lang: "en" };
  assert.ok(kept(itemRelevance(R, i)));
  stripOutletText(i, R);
  assert.equal(i.summary, undefined);
  assert.ok(i.sum_rel === "strong" || i.sum_rel === "keep");
  assert.ok(kept(itemRelevance(R, i)), "still kept on its headline plus the stored verdict");
});
t("a summary with nothing relevant leaves no verdict", () => {
  const i = stripOutletText({ title: "Weather", summary: "Sunny and mild all week.", link: "https://example.org/c", lang: "en" }, R);
  assert.equal(i.sum_rel, undefined);
});
console.log(ok + " passed");
