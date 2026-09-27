// Minimal RSS, Atom and CAP item reader shared by the warnings and news jobs (no dependencies).
const decode = (s) => String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
function tag(block, names) {
  for (const n of names) {
    const m = block.match(new RegExp("<(?:[a-z]+:)?" + n + "\\b[^>]*>([\\s\\S]*?)</(?:[a-z]+:)?" + n + ">", "i"));
    if (m) return decode(m[1]);
  }
  return "";
}
// The picture the feed itself offers for an item (media:thumbnail, media:content, an image enclosure, or the first <img> in the
// description): a link to the outlet's own copy, never downloaded. Only https addresses, so the page never loads a mixed-content image.
function image(b) {
  const raw = b.match(/<media:thumbnail\b[^>]*\burl="([^"]+)"/i) || b.match(/<media:content\b[^>]*\burl="([^"]+)"[^>]*(?:medium="image"|type="image\/)/i) ||
    b.match(/<media:content\b[^>]*(?:medium="image"|type="image\/)[^>]*\burl="([^"]+)"/i) || b.match(/<enclosure\b[^>]*\btype="image\/[^"]*"[^>]*\burl="([^"]+)"/i) ||
    b.match(/<enclosure\b[^>]*\burl="([^"]+)"[^>]*\btype="image\//i) || b.match(/(?:<|&lt;)img\b[^>]{0,300}?\bsrc=(?:"|'|&quot;)([^"'&]+)/i);
  const u = raw ? raw[1].replace(/&amp;/g, "&").trim() : "";
  return /^https:\/\/[^\s<>"]+$/i.test(u) && u.length < 600 && !/(pixel|spacer|1x1|blank|feedburner\.com\/~r|doubleclick)/i.test(u) ? u : "";
}
export function parseFeed(xml) {
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  return blocks.map((b) => {
    const href = (b.match(/<link\b[^>]*href="([^"]+)"/i) || [])[1];
    return { title: tag(b, ["title", "headline"]), summary: tag(b, ["description", "summary", "content", "areaDesc"]).slice(0, 400),
      date: tag(b, ["pubDate", "updated", "published", "sent", "effective", "date"]), link: href || tag(b, ["link", "guid", "id"]),
      severity: tag(b, ["severity"]), image: image(b) };
  }).filter((i) => i.title);
}
