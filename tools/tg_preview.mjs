// Telegram public channel web previews (t.me/s/<channel>): no login, account or phone number. Only channels that have turned
// the public preview on can be read. Same parsing as tools/refresh_social.mjs; returns feed-shaped items for the conflict job.
const unhtml = (h) => h.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).trim();
export function tgItems(html, channel) {
  const out = [];
  for (const block of html.split(/<div class="tgme_widget_message_wrap/).slice(1)) {
    const post = (block.match(/data-post="([^"]+)"/) || [])[1];
    const txt = (block.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [])[1];
    const when = (block.match(/<time[^>]*datetime="([^"]+)"/) || [])[1];
    if (!post || !txt || !when || post.split("/")[0].toLowerCase() !== channel.toLowerCase()) continue;
    const text = unhtml(txt).replace(/\s+/g, " ").trim();
    if (!text) continue;
    // a post has no headline: its first sentence (or first 200 characters) stands in for one, the rest is the summary
    const cut = text.slice(0, 220).search(/(?<=[.!?])\s/), title = cut > 20 ? text.slice(0, cut) : text.slice(0, 200) + (text.length > 200 ? "…" : "");
    out.push({ title, summary: text.slice(title.replace(/…$/, "").length).trim().slice(0, 600), link: "https://t.me/" + post, date: when, source: "@" + channel });
  }
  return out;
}
