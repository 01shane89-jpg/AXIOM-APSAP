// Probe 15 (26 Nov 2026): Post 78 sources (Flash Telegram, GUR War & Sanctions, LB.ua, Israel MOD).
import { UA } from "./dense_lib.mjs";
const H = { "User-Agent": UA, Accept: "*/*" };
async function p(label, url, opt = {}, show = 400) {
  try {
    const r = await fetch(url, { headers: H, redirect: "follow", signal: AbortSignal.timeout(40000) });
    const t = await r.text();
    console.log("P", label, r.status, r.headers.get("content-type"), t.length, r.url);
    if (opt.grep) console.log("P", label, "grep", JSON.stringify([...new Set(t.match(opt.grep) || [])].slice(0, 30)));
    else if (show) console.log("P", label, "body", JSON.stringify(t.slice(0, show)));
    return t;
  } catch (e) { console.log("P", label, "ERR", String(e.cause?.code || e.message)); return ""; }
}
await p("flash", "https://t.me/s/serhii_flash", { grep: /tgme_widget_message_date[^>]*><time datetime="[^"]+"|data-post="serhii_flash\/\d+"/g });
for (const u of ["https://war-sanctions.gur.gov.ua/en", "https://war-sanctions.gur.gov.ua/en/news", "https://war-sanctions.gur.gov.ua/en/rss", "https://gur.gov.ua/en/content.html", "https://gur.gov.ua/rss.xml", "https://gur.gov.ua/en/rss"]) await p("gur " + u, u, { grep: /href="[^"]*(news|content|rss|feed)[^"]*"|<item>|<entry>/gi });
for (const u of ["https://lb.ua/rss/ukr/news.xml", "https://lb.ua/rss/ukr/tech.xml", "https://lb.ua/rss/eng/news.xml", "https://lb.ua/tech", "https://lb.ua/rss"]) await p("lb " + u, u, { grep: /<item>|<title>[^<]{0,80}|href="[^"]*rss[^"]*"/g });
for (const u of ["https://www.gov.il/en/departments/ministry_of_defense/govil-landing-page", "https://www.gov.il/en/collectors/news?officeId=5a1e0c4c-2a93-4c8b-bd4c-8b0d9c6c4f0b", "https://mod.gov.il/en/press-releases", "https://english.mod.gov.il/Press_Room/Pages/default.aspx", "https://www.idf.il/en/mini-sites/press-releases/"]) await p("il " + u, u, { grep: /href="[^"]*(press|news|rss)[^"]*"/gi });
