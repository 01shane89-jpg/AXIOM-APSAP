// Minimal RSS, Atom and CAP item reader shared by the warnings and news jobs (no dependencies).
// A feed that escapes its HTML (&lt;p&gt;) or double-escapes entities (&amp;#8216;) is decoded a second time, and tags that
// only appear after decoding are removed too, so no markup or entity code reaches a headline or summary.
const decode = (s) => { let t = decode1(String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
  if (/&(#x?[0-9a-f]+|[a-z]+);/i.test(t) || /<\/?[a-z][^>]*>/i.test(t)) t = decode1(t);
  return t; };
// Script and style blocks (some outlets put page code inside the item body) are dropped with their contents, not just their tags.
const CODE_BLOCK = /<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const decode1 = (s) => String(s || "").replace(CODE_BLOCK, " ").replace(/<[^>]+>/g, " ")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&nbsp;/g, " ").replace(/&[lr]dquo;/g, '"').replace(/&[lr]squo;/g, "'").replace(/&ndash;|&mdash;/g, "-")
  .replace(/&#x([0-9a-f]{1,6});/gi, (m, h) => safeChar(parseInt(h, 16), m)).replace(/&#(\d{1,7});/g, (m, d) => safeChar(+d, m))
  .replace(/&amp;/g, "&").replace(CODE_BLOCK, " ").replace(/<\/?[a-z][^>]*>/gi, " ").replace(/\s+/g, " ").trim();
function safeChar(n, m) { try { return n > 31 && n !== 60 && n !== 62 ? String.fromCodePoint(n) : " "; } catch (e) { return m; } }
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
// opt.image: also return the item's own picture link (the news job asks for it; other jobs' items stay as they were)
export function parseFeed(xml, opt) {
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  return blocks.map((b) => {
    const href = (b.match(/<link\b[^>]*href="([^"]+)"/i) || [])[1];
    return { title: tag(b, ["title", "headline"]), summary: tag(b, ["description", "summary", "content", "areaDesc"]).slice(0, 400),
      date: tag(b, ["pubDate", "updated", "published", "sent", "effective", "date"]), link: href || tag(b, ["link", "guid", "id"]),
      severity: tag(b, ["severity"]), source: tag(b, ["source"]), expires: tag(b, ["expires"]), ...(opt && opt.image && image(b) ? { image: image(b) } : {}) };
  }).filter((i) => i.title);
}

// A news list on an ordinary web page (an agency with no feed): the links whose address matches `match` (a regular
// expression), each with its headline (the link's text or title, the longest one when a page links an item several times)
// and the first date printed with it (2026-09-29, 2026.09.29, 29/09/2026, or a Thai date such as 26 กันยายน 2569).
// An item without a printed date has date "" and the news job uses the time it first saw it.
const EN_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const EN_MON = "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const EN_DMY = new RegExp("\\b(\\d{1,2})\\s+" + EN_MON + "\\.?,?\\s+(20\\d\\d)\\b", "i"), EN_MDY = new RegExp("\\b" + EN_MON + "\\.?\\s+(\\d{1,2}),?\\s+(20\\d\\d)\\b", "i");
// a date tacked on after the headline, not one the headline itself names after a comma ("Iran Update, November 22, 2026")
const EN_DATE_G = new RegExp("(?<![,:])\\s+(?:\\b\\d{1,2}\\s+" + EN_MON + "\\.?,?\\s+20\\d\\d|\\b" + EN_MON + "\\.?\\s+\\d{1,2},?\\s+20\\d\\d)\\s*$", "i");
const TH_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
export function pageDate(text) {
  const t = String(text || ""), n = numDate(t);
  if (n) return n;
  // English month names: "20 November 2026" (The Standard, Gambia) or "November 22, 2026" (Critical Threats)
  const m = t.match(EN_DMY) || t.match(EN_MDY);
  if (m) { const [d, mo] = /^\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]]; return m[3] + "-" + String(EN_MONTHS.indexOf(mo.toLowerCase().slice(0, 3)) + 1).padStart(2, "0") + "-" + d.padStart(2, "0"); }
  return "";
}
// a numeric or Thai date (a short link text holding one is a date line or teaser, not a headline)
function numDate(t) {
  let m = t.match(/\b(20\d\d)[.\-/](\d{1,2})[.\-/](\d{1,2})\b/);
  if (m) return m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
  m = t.match(/\b(\d{1,2})[.\-/](\d{1,2})[.\-/](20\d\d)\b/);
  if (m) return m[3] + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0");
  m = t.match(new RegExp("(\\d{1,2})\\s*(" + TH_MONTHS.join("|") + ")\\s*(25\\d\\d)"));
  if (m) return (+m[3] - 543) + "-" + String(TH_MONTHS.indexOf(m[2]) + 1).padStart(2, "0") + "-" + m[1].padStart(2, "0");
  return "";
}
export function parseList(html, base, match) {
  const re = new RegExp(match, "i"), byHref = new Map(), hits = [];
  for (const m of String(html).matchAll(/<a\b([^>]*)>([\s\S]{0,1500}?)<\/a>/gi)) {
    const href = (m[1].match(/\bhref=["']([^"'#]+)["']/i) || [])[1];
    if (!href || !re.test(href)) continue;
    let link; try { link = new URL(href.replace(/&amp;/g, "&"), base).href; } catch (e) { continue; }
    // a heading inside the link is the headline itself (the rest of the link may be a view count or a teaser)
    const head = decode((m[2].match(/<h\d\b[^>]*>([\s\S]*?)<\/h\d>/i) || [])[1] || "");
    const title = decode((m[1].match(/\btitle=["']([^"']+)["']/i) || [])[1] || ""), text = head || decode(m[2]);
    hits.push({ link, at: m.index, end: m.index + m[0].length, texts: [text, title], full: decode(m[2]) });
  }
  hits.forEach((h, k) => {
    // a date printed with the item: in the link, or after it before the next item's link
    const next = hits.slice(k + 1).find((x) => x.link !== h.link), tail = decode(String(html).slice(h.end, Math.min(h.end + 800, next ? next.at : h.end + 800)));
    const o = byHref.get(h.link) || { link: h.link, texts: [], date: "" };
    o.texts.push(...h.texts);
    if (!o.date) o.date = pageDate(h.full + " " + h.texts.join(" ")) || pageDate(tail);
    byHref.set(h.link, o);
  });
  return [...byHref.values()].map((o) => {
    // a date that is part of the headline ("Press Conference on November 26, 2026") stays: cutting it would leave "... on"
    const title = o.texts.map((t) => { const c = t.replace(/\b20\d\d[.\-/]\d{1,2}[.\-/]\d{1,2}\b/g, "").replace(EN_DATE_G, "").replace(/\s+\d+\s+(?:minute|hour|day)s?(?:\s+ago)?\s*$/i, "").trim(); return /\b(on|of|for|at|in|from|dated|since|until)$/i.test(c) ? t.replace(/\s+/g, " ").trim() : c; }).filter((t) => t.length >= 12 && !numDate(t) || t.length >= 40).sort((a, b) => b.length - a.length)[0] || "";
    return { title: title.slice(0, 300), summary: "", date: o.date, link: o.link, severity: "", source: "" };
  }).filter((i) => i.title);
}
