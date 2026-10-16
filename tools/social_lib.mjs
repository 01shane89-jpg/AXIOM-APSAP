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
