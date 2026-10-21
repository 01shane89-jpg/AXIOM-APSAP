// Outlet text (an RSS item's summary or description, and its translation) may be read by the refresh jobs but is never stored
// or shown: the outlets' terms allow their feeds for personal, non-commercial use, and OSAP is sold (licence check 2026-09-26,
// fixed 2026-10-17). A job reads the summary for relevance, places, topics and kinds, then calls stripOutletText before it
// writes anything, so the stored item is the headline, the link and what OSAP derived. sum_rel keeps what the summary's words
// matched in tools/relevance.json, so the history's relevance check (tools/history.mjs) does not drop a story the summary kept.
import { relevance } from "./topics_lib.mjs";

export const OUTLET_TEXT = ["summary", "summary_en", "title_from_summary"];
export function stripOutletText(i, R) {
  if (!i || typeof i !== "object") return i;
  const s = String(i.summary_en || i.summary || "").slice(0, 400);
  if (R && s && !i.sum_rel) { const r = relevance(R, s); if (r === "strong" || r === "keep") i.sum_rel = r; }
  if (i.title_from_summary) delete i.title_en;   // a Deep South headline made from the translated summary is outlet text too
  for (const k of OUTLET_TEXT) delete i[k];
  return i;
}

// A social post (Bluesky, Telegram) has no headline of its own: its words are the account's, and they are not stored either. What is
// stored is who posted, where, when and the link, under a plain stand-in title ("Telegram post by @channel"). notext marks it, so a
// job does not re-judge a kept post on the stand-in (its kind, figures and place were set while the job held the words).
export function postOnly(i, platform, account) {
  if (!i || typeof i !== "object") return i;
  for (const k of [...OUTLET_TEXT, "title_en", "mt", "mt_rejected"]) delete i[k];
  i.title = platform + " post by " + account; i.lang = "en"; i.notext = 1;
  return i;
}
