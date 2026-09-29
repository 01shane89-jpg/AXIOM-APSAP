// Page readers for news items whose list gives only a generic headline (tools/news_feeds.json "detail"). Each takes the
// item's own page and returns a better headline and summary, or null to keep the item as it is. No network here.
const text = (html) => String(html || "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
  .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d))
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const num = (m) => (m ? +m[1] : 0);
export const ADAPTERS = {
  // Taiwan Ministry of National Defense, daily "PLA activities in the waters and airspace around Taiwan" (English page).
  // The counts are the ministry's statement (a government claim), copied as printed.
  "mnd-pla": (html) => {
    const t = text(html), body = (t.match(/PLA activities[:：]\s*([\s\S]{20,900}?)(?:Keywords|Share|Download area)/i) || [])[1];
    if (!body) return null;
    const air = num(body.match(/(\d+)\s+sorties? of PLA aircraft/i)), ships = num(body.match(/(\d+)\s+PLAN (?:ships|vessels)/i)),
      official = num(body.match(/(\d+)\s+official (?:ships|vessels)/i)), balloons = num(body.match(/(\d+)\s+(?:PRC\s+)?balloons?/i)),
      adiz = num(body.match(/(\d+)\s+out of\s+\d+\s+sorties?[^.]*?(?:entered|crossed)/i));
    if (!/sorties? of PLA aircraft|PLAN (?:ships|vessels)|balloon/i.test(body)) return null;
    const win = (t.match(/Date[:：]\s*([^二]{8,80}?\(UTC\+8\))/) || [])[1] || "";
    const parts = [air + " PLA aircraft" + (adiz ? " (" + adiz + " into the ADIZ or across the median line)" : ""), ships + " PLAN ships", official + " official ships"];
    if (balloons) parts.push(balloons + " balloon" + (balloons > 1 ? "s" : ""));
    return { title: "Taiwan MND: " + parts.join(", ") + " detected around Taiwan", summary: (win ? win.trim() + ". " : "") + body.trim().slice(0, 380),
      counts: { aircraft: air, adiz, ships, official, balloons } };
  },
};
