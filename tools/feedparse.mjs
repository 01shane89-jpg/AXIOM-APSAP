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
export function parseFeed(xml) {
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  return blocks.map((b) => {
    const href = (b.match(/<link\b[^>]*href="([^"]+)"/i) || [])[1];
    return { title: tag(b, ["title", "headline"]), summary: tag(b, ["description", "summary", "content", "areaDesc"]).slice(0, 400),
      date: tag(b, ["pubDate", "updated", "published", "sent", "effective", "date"]), link: href || tag(b, ["link", "guid", "id"]),
      severity: tag(b, ["severity"]), source: tag(b, ["source"]) };
  }).filter((i) => i.title);
}
