// Page readers for news items whose list gives only a generic headline (tools/news_feeds.json "detail"). Each takes the
// item's own page and returns a better headline and summary, or null to keep the item as it is. No network here.
const text = (html) => String(html || "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
  .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d))
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const num = (m) => (m ? +m[1] : 0);
// Each reader's version: a page read with an older version is read again (tools/refresh_news.mjs), so a fixed reader also
// corrects the items it read before. 2: singular counts ("1 official ship"), 21 Nov 2026.
export const ADAPTER_V = { "mnd-pla": 2 };
export const ADAPTERS = {
  // Taiwan Ministry of National Defense, daily "PLA activities in the waters and airspace around Taiwan" (English page).
  // The counts are the ministry's statement (a government claim), copied as printed.
  "mnd-pla": (html) => {
    const t = text(html), body = (t.match(/PLA activities[:：]\s*([\s\S]{20,900}?)(?:Keywords|Share|Download area)/i) || [])[1];
    if (!body) return null;
    const air = num(body.match(/(\d+)\s+sorties? of PLA aircraft/i)), ships = num(body.match(/(\d+)\s+PLAN (?:ships?|vessels?)\b/i)),
      // singular as well: "1 official ship" was read as 0 (MND report 88313, 21 Nov)
      official = num(body.match(/(\d+)\s+official (?:ships?|vessels?)\b/i)), balloons = num(body.match(/(\d+)\s+(?:PRC\s+)?balloons?/i)),
      adiz = num(body.match(/(\d+)\s+out of\s+\d+\s+sorties?[^.]*?(?:entered|crossed)/i));
    if (!/sorties? of PLA aircraft|PLAN (?:ships?|vessels?)\b|balloon/i.test(body)) return null;
    const win = (t.match(/Date[:：]\s*([^二]{8,80}?\(UTC\+8\))/) || [])[1] || "";
    const pl = (n, w) => n + " " + w + (n === 1 ? "" : "s");
    const parts = [air + " PLA aircraft" + (adiz ? " (" + adiz + " into the ADIZ or across the median line)" : ""), pl(ships, "PLAN ship"), pl(official, "official ship")];
    if (balloons) parts.push(balloons + " balloon" + (balloons > 1 ? "s" : ""));
    return { title: "Taiwan MND: " + parts.join(", ") + " detected around Taiwan", summary: (win ? win.trim() + ". " : "") + body.trim().slice(0, 380),
      counts: { aircraft: air, adiz, ships, official, balloons } };
  },
};
