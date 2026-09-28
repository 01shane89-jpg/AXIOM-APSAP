// Which tabs a pooled headline belongs to (tools/view_reports.json), for the Reports section of every tab. No network.
// A headline matches a tab when it is in one of the tab's data sets (tools/topics.json) or holds one of its words (or, for the
// country it is filed under, one of that country's extra words) and none of its exclude words. Same word rules as the data sets.
import { fold, wordRe } from "./topics_lib.mjs";

export function compileViews(cfg) {
  return ((cfg && cfg.views) || []).filter((v) => v && /^[a-z0-9-]+$/.test(v.id || "")).map((v) => {
    const byCc = {};
    for (const [cc, w] of Object.entries(v.by_country || {})) if (/^[a-z]{2,3}$/.test(cc) && (w || []).length) byCc[cc] = wordRe(w);
    return { id: v.id, tp: new Set(v.topics || []), re: wordRe(v.words), ex: wordRe(v.exclude), byCc };
  });
}
// ids of the tabs a headline belongs to; tp = its data-set ids, ccs = the countries it is filed under
export function viewsOf(compiled, text, ccs, tp) {
  const f = fold(text), out = [], t = new Set(tp || []);
  for (const v of compiled) {
    if (v.ex && v.ex.test(f)) continue;
    if ([...v.tp].some((x) => t.has(x)) || (v.re && v.re.test(f)) || (ccs || []).some((c) => v.byCc[c] && v.byCc[c].test(f))) out.push(v.id);
  }
  return out;
}
