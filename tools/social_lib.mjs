// Social posts: what is stored versus what the page shows (Conflict Coverage plan, Phase 1, step 1).
// Until 2026-10-10 each country's posts were cut to the newest 40 before anything was saved, so on a busy run every post
// below the 40th was lost for good (95 of 191 countries were at the cap on 2026-10-03). Now every post inside the fetch
// window is kept for the history (tools/history.mjs, its own per-country cap and 365 days), and only the live snapshot the
// page reads is cut to the newest perArea, so the page shows the same list as before.
// items: { cc: [post] } -> { kept: { cc: [post] } (deduplicated by link, newest first), view: { cc: [post] } (first perArea),
//   counts: { cc: { kept, shown } } }
export function splitView(items, perArea) {
  const kept = {}, view = {}, counts = {};
  for (const cc of Object.keys(items)) {
    const seen = new Set();
    kept[cc] = (items[cc] || []).filter((i) => i && !seen.has(i.link) && seen.add(i.link)).sort((a, b) => (b.date > a.date ? 1 : a.date > b.date ? -1 : 0));
    view[cc] = kept[cc].slice(0, perArea);
    counts[cc] = { kept: kept[cc].length, shown: view[cc].length };
  }
  return { kept, view, counts };
}

// Mastodon statuses (GET /api/v1/accounts/:id/statuses) -> { text, date, link, lang } for public, original posts inside the window.
// The post's words are HTML; they are turned into plain text here, read for relevance and then dropped (tools/outlet_text.mjs).
const unhtml = (h) => String(h || "").replace(/<br\s*\/?>|<\/p>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).trim();
export function mastodonPosts(list, since = 0) {
  const out = [];
  for (const s of Array.isArray(list) ? list : []) {
    if (!s || s.reblog || s.in_reply_to_id || (s.visibility && s.visibility !== "public")) continue;
    const date = new Date(s.created_at), link = s.url || s.uri;
    const text = [s.spoiler_text, unhtml(s.content)].filter(Boolean).join("\n").trim();
    if (!text || isNaN(date) || date.getTime() < since || !/^https:\/\//.test(link || "")) continue;
    out.push({ text, date, link, lang: (s.language || "").slice(0, 3) });
  }
  return out;
}
