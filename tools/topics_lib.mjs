// Data-set matching shared by the refresh jobs and the tests (tools/topics.json). No network.
// A word matches at the start of a word, case- and accent-insensitively, so "flood" matches "floods" and "Flooding";
// a word is also matched inside scripts that do not separate words with spaces (Thai, Chinese, Japanese, Lao, Khmer, Burmese).
export const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NOSPACE = /[฀-໿က-႟ក-៿぀-ヿ㐀-鿿]/;
function wordRe(words) {
  const parts = (words || []).map((w) => fold(w).trim()).filter(Boolean).map((w) => (NOSPACE.test(w) ? esc(w) : "(?<![\\p{L}\\p{N}])" + esc(w)));
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
