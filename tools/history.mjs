// Rolling feed history: each refresh adds its news and social items to data/history/<cc>.js, so an area keeps
// what was reported over the past year instead of only the latest snapshot. Items are keyed by link (a repeat
// replaces the older copy), older than MAX_DAYS are dropped, and each area keeps at most CAP[kind] items.
// The page loads only the open area's file. Writes nothing when run outside the repository root.
import fs from "node:fs";
import { loadRelevance, itemRelevance, kept } from "./topics_lib.mjs";
import { dropSuspectMt } from "./mt_guard.mjs";
import { stripOutletText, postOnly } from "./outlet_text.mjs";
// Bluesky and Telegram posts kept before 2026-10-17 still hold the post's words: judged once on them (the social relevance policy,
// loaded only when such a post is met) and then reduced to who, when and the link (tools/outlet_text.mjs postOnly)
let socialJudge = null;
async function wordsOnly(i) {
  if (!i || (i.platform !== "Bluesky" && i.platform !== "Telegram")) return i;
  if (!i.notext) {
    if (!socialJudge) {
      const { compileSocial, socialRelevance } = await import("./social_relevance.mjs"), { compileRelevance } = await import("./topics_lib.mjs");
      const R = compileRelevance(JSON.parse(fs.readFileSync("tools/relevance.json", "utf8")), JSON.parse(fs.readFileSync("tools/topics.json", "utf8")).topics);
      const S = compileSocial(JSON.parse(fs.readFileSync("tools/relevance-social.json", "utf8")));
      socialJudge = (x) => socialRelevance(R, S, x);
    }
    i.rel_v = socialJudge(i);
  }
  return postOnly(i, i.platform, i.account);
}

const DIR = "data/history", MAX_DAYS = 365, CAP = { news: 800, social: 600 };
// geo: the place the refresh job matched (GeoNames), so an older item still has its map pin once it leaves the latest snapshot
// no summary: outlet text is never stored (tools/outlet_text.mjs); sum_rel is what the summary's words matched
const KEEP = ["title", "title_en", "sum_rel", "notext", "rel_v", "date", "link", "geo", "outlet", "account", "platform", "kind", "lang", "mt", "via", "state", "thumb", "date_seen", "tier", "region", "detail", "exempt"];

// Page script text that an outlet put inside an item body ("if (!window._raw... addEventListener(...") is not a summary;
// it is removed from new and already-kept items alike, so older copies are cleaned on the next refresh.
const CODE = /\bwindow\.\w+|addEventListener\s*\(|document\.getElementById|function\s*\(\s*\w*\s*\)\s*\{/;
// A machine translation the model invented (tools/mt_guard.mjs) is removed from new and kept items alike; the original stays.
const unCode = (i) => { for (const k of ["summary", "summary_en"]) if (i[k] && CODE.test(i[k])) delete i[k]; dropSuspectMt(i); return i; };
// A US state's own outlets ("us:MO") are kept apart in data/history/us-states/<st>.js (window.ASAP_HIST_ST), loaded only by
// that state's view, so the state keeps its past reporting as countries do.
const isState = (cc) => /^us:[A-Z]{2}$/.test(cc);
const file = (cc) => isState(cc) ? `${DIR}/us-states/${cc.slice(3).toLowerCase()}.js` : `${DIR}/${cc}.js`;
function read(cc) {
  try {
    const t = fs.readFileSync(file(cc), "utf8");
    return JSON.parse(t.slice(isState(cc) ? t.indexOf("=") + 1 : t.indexOf("=", t.indexOf("]")) + 1).trim().replace(/;$/, ""));
  } catch (e) { return {}; }
}
// The English already stored for each kept item, as [{ text, lang, en, tool }] for tools/translate.mjs seed(): a refresh
// reuses these instead of asking the model again, so an item does not fall back to its original language when the
// translation cache has dropped it. ccs: the areas to read (default every stored area).
export function storedTranslations(kind, ccs) {
  const out = [];
  let list = ccs;
  if (!list) { try { list = fs.readdirSync(DIR).filter((f) => /^[a-z]{2,3}\.js$/.test(f)).map((f) => f.slice(0, -3)); } catch (e) { list = []; } }
  for (const cc of list) {
    if (!/^[a-z]{2,3}$/.test(cc)) continue;
    for (const i of read(cc)[kind] || []) {
      if (!i || !i.mt || i.mt === "untranslated" || /^en\b/i.test(i.lang || "")) continue;
      if (i.title && i.title_en) out.push({ text: i.title, lang: i.lang || "", en: i.title_en, tool: i.mt });
    }
  }
  return out;
}
// caps: an optional { cc: n } of larger news caps for the focus countries (tools/news_feeds.json "focus")
export async function updateHistory(kind, items, stamp, caps) {
  if (!CAP[kind]) throw new Error("unknown history kind " + kind);
  const cutoff = new Date(Date.now() - MAX_DAYS * 864e5).toISOString().slice(0, 16);
  fs.mkdirSync(DIR, { recursive: true });
  let added = 0;
  // news keeps only what tools/relevance.json keeps, old items included, so the history follows the word lists when they change
  const R = kind === "news" ? await loadRelevance() : null;
  for (const cc of Object.keys(items)) {
    if (!/^[a-z]{2,3}$/.test(cc) && !isState(cc)) continue;
    const h = read(cc), byLink = new Map();
    // items kept before 2026-10-17 still carry the outlet's summary: it is dropped here (its relevance verdict kept)
    for (const i of h[kind] || []) if (i && i.link) byLink.set(i.link, await wordsOnly(stripOutletText(unCode(i), R)));
    for (const i of items[cc] || []) {
      if (!i || !i.link || !/^https?:\/\//.test(i.link)) continue;
      if (!byLink.has(i.link)) added++;
      const o = {}; for (const k of KEEP) if (i[k] != null && i[k] !== "") o[k] = i[k];
      // a run that could not translate the item this time keeps the English an earlier run stored for the same words
      const prev = byLink.get(i.link);
      if (prev && prev.mt && prev.mt !== "untranslated") {
        let kept = false;
        if (!o.title_en && o.title && prev.title_en && prev.title === o.title) { o.title_en = prev.title_en; kept = true; }
        if (kept && (!o.mt || o.mt === "untranslated")) o.mt = prev.mt;
      }
      if (!o.sum_rel) { const r = stripOutletText({ summary: i.summary, summary_en: i.summary_en }, R).sum_rel; if (r) o.sum_rel = r; }
      unCode(o);
      o.first_seen = (byLink.get(i.link) || {}).first_seen || stamp;
      byLink.set(i.link, o);
    }
    h[kind] = [...byLink.values()].filter((i) => (!i.date || i.date >= cutoff) && (!R || kept(itemRelevance(R, i)))).sort((a, b) => (b.date || "") > (a.date || "") ? 1 : -1).slice(0, Math.max(CAP[kind], (kind === "news" && caps && caps[cc]) || 0));
    h.updated = stamp;
    if (isState(cc)) { fs.mkdirSync(`${DIR}/us-states`, { recursive: true }); fs.writeFileSync(file(cc), "window.ASAP_HIST_ST=" + JSON.stringify({ st: cc.slice(3), ...h }).replace(/<\//g, "<\\/") + ";\n"); continue; }
    fs.writeFileSync(`${DIR}/${cc}.js`, `window.ASAP_HIST=window.ASAP_HIST||{};window.ASAP_HIST[${JSON.stringify(cc)}]=` + JSON.stringify(h).replace(/<\//g, "<\\/") + ";\n");
  }
  console.log(`history (${kind}): ${added} new item${added === 1 ? "" : "s"} across ${Object.keys(items).length} areas`);
}
