// Data-set matching shared by the refresh jobs and the tests (tools/topics.json). No network.
// A word matches at the start of a word, case- and accent-insensitively, so "flood" matches "floods" and "Flooding";
// a word is also matched inside scripts that do not separate words with spaces (Thai, Chinese, Japanese, Lao, Khmer, Burmese).
export const fold = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NOSPACE = /[\u0E00-\u0EFF\u1000-\u109F\u1780-\u17FF\u3040-\u30FF\u3400-\u9FFF]/;
// a word ending in "$" must also end there, plural s or es allowed ("war$" matches "war" and "wars", not "warning")
function wordRe(words) {
  const parts = (words || []).map((w) => fold(w).trim()).filter((w) => w && w !== "$").map((w) => {
    const whole = w.endsWith("$"), b = whole ? w.slice(0, -1) : w, tail = whole ? "(?:e?s)?(?![\\p{L}\\p{N}])" : "";
    return (NOSPACE.test(b) ? esc(b) : "(?<![\\p{L}\\p{N}])" + esc(b)) + tail;
  });
  return parts.length ? new RegExp(parts.join("|"), "u") : null;
}
export function compileTopics(topics) {
  return (topics || []).filter((t) => t && /^[a-z0-9-]+$/.test(t.id || "") && (t.words || []).length).map((t) => ({
    id: t.id, name: t.name || t.id, re: wordRe(t.words), ex: wordRe(t.exclude), cc: new Set(t.countries || []),
  }));
}
// ids of the data sets a headline belongs to; cc = the countries the item is filed under (an outlet's country, or named)
export function topicsOf(compiled, text, ccs) {
  const f = fold(text), out = [];
  for (const t of compiled) {
    if (t.cc.size && !(ccs || []).some((c) => t.cc.has(c))) continue;
    if (t.re.test(f) && !(t.ex && t.ex.test(f))) out.push(t.id);
  }
  return out;
}
// the countries a search result names (country names from tools/geo_cc.mjs); first mention first
export function countriesNamed(countries, text) {
  const f = fold(text), hits = [];
  for (const c of countries) {
    if (!c.name || c.id === "oki") continue;
    const m = f.search(new RegExp("(?<![\\p{L}])" + esc(fold(c.name)) + "(?![\\p{L}])", "u"));
    if (m >= 0) hits.push([m, c.id]);
  }
  return hits.sort((a, b) => a[0] - b[0]).map((h) => h[1]);
}

// The relevance check (tools/relevance.json): what an analyst or a special operations team in the country would want.
// 1. a strong word keeps it; 2. a drop word leaves it out; 3. a keep word keeps it; 4. anything else is left out.
// topics: the data sets (tools/topics.json); one marked "relevance": "exempt" is kept whatever the lists say, because its
// subject is not a security word (the ET tab's UFO and UAP reports), still minus its own exclude words.
export function compileRelevance(cfg, topics) {
  const flat = (o) => Object.values(o || {}).flat();
  const exempt = compileTopics((topics || []).filter((t) => t && t.relevance === "exempt").map((t) => ({ ...t, countries: [] })));
  return { strong: wordRe(flat(cfg.strong)), drop: wordRe(flat(cfg.drop)), keep: wordRe(flat(cfg.keep)), exempt };
}
// returns "strong" | "keep" (kept) or "drop" | "none" (left out)
export function relevance(R, text) {
  const f = fold(text);
  if (R.exempt && R.exempt.length && topicsOf(R.exempt, f, []).length) return "strong";
  if (R.strong && R.strong.test(f)) return "strong";
  if (R.drop && R.drop.test(f)) return "drop";
  if (R.keep && R.keep.test(f)) return "keep";
  return "none";
}
// One news item checked the way every news surface uses it (news pool and search, Local news, Top stories, history):
// its English headline, original headline and summary. A headline the translation step left in its own script cannot be
// checked against English words, so it is kept ("unchecked") unless a drop word matched.
export function itemRelevance(R, i) {
  const en = String(i.title_en || i.title || ""), orig = i.title && i.title !== en ? i.title : "";
  const rel = relevance(R, en + " \n " + orig + " \n " + String(i.summary_en || i.summary || "").slice(0, 400));
  if (rel !== "none") return rel;
  const latin = (en.match(/[A-Za-z]/g) || []).length, other = (en.match(/\p{L}/gu) || []).length - latin;
  return i.mt === "untranslated" || other > latin ? "unchecked" : "none";
}
export const kept = (rel) => rel === "strong" || rel === "keep" || rel === "unchecked";
let _rel = null;
// tools/relevance.json, read once (the jobs run from the repository root)
export async function loadRelevance() {
  if (!_rel) {
    const fs = await import("node:fs");
    _rel = compileRelevance(JSON.parse(fs.readFileSync("tools/relevance.json", "utf8")), JSON.parse(fs.readFileSync("tools/topics.json", "utf8")).topics);
  }
  return _rel;
}
