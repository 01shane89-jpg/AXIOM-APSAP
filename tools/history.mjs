// Rolling feed history: each refresh adds its news and social items to data/history/<cc>.js, so an area keeps
// what was reported over the past year instead of only the latest snapshot. Items are keyed by link (a repeat
// replaces the older copy), older than MAX_DAYS are dropped, and each area keeps at most CAP[kind] items.
// The page loads only the open area's file. Writes nothing when run outside the repository root.
import fs from "node:fs";
import { loadRelevance, itemRelevance, kept } from "./topics_lib.mjs";
import { dropSuspectMt } from "./mt_guard.mjs";

const DIR = "data/history", MAX_DAYS = 365, CAP = { news: 800, social: 600 };
// geo: the place the refresh job matched (GeoNames), so an older item still has its map pin once it leaves the latest snapshot
const KEEP = ["title", "title_en", "summary", "summary_en", "date", "link", "geo", "outlet", "account", "platform", "kind", "lang", "mt", "via", "state", "thumb", "date_seen", "tier", "region", "detail", "exempt"];

// Page script text that an outlet put inside an item body ("if (!window._raw... addEventListener(...") is not a summary;
// it is removed from new and already-kept items alike, so older copies are cleaned on the next refresh.
const CODE = /\bwindow\.\w+|addEventListener\s*\(|document\.getElementById|function\s*\(\s*\w*\s*\)\s*\{/;
// A machine translation the model invented (tools/mt_guard.mjs) is removed from new and kept items alike; the original stays.
const unCode = (i) => { for (const k of ["summary", "summary_en"]) if (i[k] && CODE.test(i[k])) delete i[k]; dropSuspectMt(i); return i; };
function read(cc) {
  try {
    const t = fs.readFileSync(`${DIR}/${cc}.js`, "utf8");
    return JSON.parse(t.slice(t.indexOf("=", t.indexOf("]")) + 1).trim().replace(/;$/, ""));
  } catch (e) { return {}; }
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
    if (!/^[a-z]{2,3}$/.test(cc)) continue;
    const h = read(cc), byLink = new Map();
    for (const i of h[kind] || []) if (i && i.link) byLink.set(i.link, unCode(i));
    for (const i of items[cc] || []) {
      if (!i || !i.link || !/^https?:\/\//.test(i.link)) continue;
      if (!byLink.has(i.link)) added++;
      const o = {}; for (const k of KEEP) if (i[k] != null && i[k] !== "") o[k] = i[k];
      unCode(o);
      o.first_seen = (byLink.get(i.link) || {}).first_seen || stamp;
      byLink.set(i.link, o);
    }
    h[kind] = [...byLink.values()].filter((i) => (!i.date || i.date >= cutoff) && (!R || kept(itemRelevance(R, i)))).sort((a, b) => (b.date || "") > (a.date || "") ? 1 : -1).slice(0, Math.max(CAP[kind], (kind === "news" && caps && caps[cc]) || 0));
    h.updated = stamp;
    fs.writeFileSync(`${DIR}/${cc}.js`, `window.ASAP_HIST=window.ASAP_HIST||{};window.ASAP_HIST[${JSON.stringify(cc)}]=` + JSON.stringify(h).replace(/<\//g, "<\\/") + ";\n");
  }
  console.log(`history (${kind}): ${added} new item${added === 1 ? "" : "s"} across ${Object.keys(items).length} areas`);
}
