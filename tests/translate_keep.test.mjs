// A translation, once made, stays with its item (tools/history.mjs, tools/translate.mjs seed). Run: node tests/translate_keep.test.mjs
// 2026-10-06: the 6,000-entry translation cache held only the last 6 hours, so an older Thai post lost its English on the next
// refresh, and the history copy was overwritten with the untranslated one; YouTube descriptions were never translated at all.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "osap-keep-"));
const repo = process.cwd();
process.chdir(dir);
process.env.MT = "0"; process.env.MYMEMORY_LIMIT = "0";   // no model, no network: only cache and seed can translate
const { updateHistory, storedTranslations } = await import(path.join(repo, "tools/history.mjs"));
const { translateAll, seed, saveCache } = await import(path.join(repo, "tools/translate.mjs"));
let ok = 0; const t = async (name, f) => { await f(); ok++; console.log("ok -", name); };

const post = { title: "น้ำป่าทะลักท่วมหลายจุดใน จ.แม่ฮ่องสอน", summary: "น้ำป่าไหลหลากรุนแรงในพื้นที่ ต.เสาหิน อ.แม่สะเรียง", date: "2026-10-06T08:10",
  link: "https://www.youtube.com/watch?v=0268MJk9bJs", account: "@ThaiPBS", platform: "YouTube", lang: "th" };
const read = () => { const w = {}; new Function("window", fs.readFileSync("data/history/th.js", "utf8"))(w); return w.ASAP_HIST.th.social; };

await t("a refresh that could not translate keeps the English stored earlier", async () => {
  await updateHistory("social", { th: [{ ...post, title_en: "Flash floods hit many places in Mae Hong Son", summary_en: "Severe flash floods in Sao Hin, Mae Sariang", mt: "MADLAD-400 (Google open model, run in the refresh job)" }] }, "2026-10-06 09:01Z");
  await updateHistory("social", { th: [{ ...post, mt: "untranslated" }] }, "2026-10-06 09:16Z");
  const h = read();
  assert.equal(h.length, 1);
  assert.equal(h[0].title_en, "Flash floods hit many places in Mae Hong Son");
  assert.equal(h[0].summary_en, "Severe flash floods in Sao Hin, Mae Sariang");
  assert.match(h[0].mt, /MADLAD/);
  assert.equal(h[0].first_seen, "2026-10-06 09:01Z");
});
await t("changed words are not given the old English", async () => {
  await updateHistory("social", { th: [{ ...post, title: post.title + " (แก้ไข)", mt: "untranslated" }] }, "2026-10-06 09:31Z");
  const h = read();
  assert.ok(!h[0].title_en, "an edited headline is not shown with the old translation");
  assert.equal(h[0].summary_en, "Severe flash floods in Sao Hin, Mae Sariang", "the unchanged description keeps its English");
});
await t("stored English seeds the translator, and is never written to the cache file", async () => {
  const pairs = storedTranslations("social", ["th"]);
  assert.ok(pairs.some((p) => p.en === "Severe flash floods in Sao Hin, Mae Sariang"));
  assert.ok(seed(pairs) >= 1);
  const [s] = await translateAll([{ text: post.summary, lang: "th" }]);
  assert.equal(s.en, "Severe flash floods in Sao Hin, Mae Sariang");
  saveCache();
  assert.ok(!fs.readFileSync("data/live/translation-cache.json", "utf8").includes("Sao Hin"));
});
await t("a stored invented line is not reused", async () => {
  seed([{ text: "ฝนตกหนักที่เชียงใหม่", lang: "th", en: "10.35am: Heavy rain in Chiang Mai", tool: "MADLAD-400 (Google open model, run in the refresh job)" }]);
  const [r] = await translateAll([{ text: "ฝนตกหนักที่เชียงใหม่", lang: "th" }]);
  assert.equal(r.en, null);
});
process.chdir(repo); fs.rmSync(dir, { recursive: true, force: true });
console.log(ok + " passed");
