// News-pool rows for the official U.S. Congress floor votes (tools/dense_congress.mjs items as data/live/x/us.js keeps them:
// f feed, t title, x detail, d date, u link, k kind). Used by tools/news_index.mjs; kept apart so it can be tested without
// building the index. Each vote gets its own link (the Congress.gov bill page plus a #vote mark), so a bill's Senate and House
// votes are two rows. The outlet is the chamber's own record, marked official (state).
export function congressRows(items) {
  return (items || []).filter((r) => r && r.f === "us-congress" && r.t && /^https:\/\/www\.congress\.gov\//.test(r.u || "")).map((r) => {
    const ch = /^House/.test(r.k || r.t) ? "House" : "Senate";
    return { title: r.t, link: r.u + "#vote-" + ch.toLowerCase() + "-" + String(r.d || "").slice(0, 10), date: r.d, outlet: "U.S. " + ch + " (official record)", summary: r.x || "", state: true };
  });
}
