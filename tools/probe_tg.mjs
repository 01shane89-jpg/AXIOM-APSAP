// Test only: prints each Telegram channel's public title and description so a channel can be checked as official.
import { readFileSync } from "node:fs";
const list = JSON.parse(readFileSync("tools/tg_candidates.json", "utf8"));
const meta = (h, p) => ((h.match(new RegExp('<meta property="og:' + p + '" content="([^"]*)"')) || [])[1] || "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").slice(0, 160);
for (const c of list) {
  try {
    const r = await fetch("https://t.me/s/" + c, { headers: { "user-agent": "Mozilla/5.0" } });
    const h = await r.text();
    const subs = (h.match(/<span class="counter_value">([^<]+)<\/span>\s*<span class="counter_type">subscribers/) || [])[1] || "";
    console.log("TG\t" + c + "\t" + meta(h, "title") + "\t" + subs + "\t" + meta(h, "description").replace(/\s+/g, " "));
  } catch (e) { console.log("TG\t" + c + "\tERR " + e.message); }
}
