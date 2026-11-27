// Probe 24 (27 Nov 2026): official transcript sources (Kremlin, UK Parliament, White House, State Department, China MFA).
const { UA } = await import("./dense_lib.mjs");
const U = [
  "https://kremlin.ru/events/president/news/feed", "https://en.kremlin.ru/events/president/transcripts/feed", "http://en.kremlin.ru/events/president/transcripts/feed",
  "http://en.kremlin.ru/events/president/news/81350", "http://en.kremlin.ru/about/copyrights", "http://kremlin.ru/about/copyrights",
  "https://questions-statements-api.parliament.uk/api/writtenstatements/statements?take=3",
  "https://hansard-api.parliament.uk/overview/lastsittingdate.json?house=Commons",
  "https://hansard.parliament.uk/rss/Commons.rss",
  "https://www.whitehouse.gov/briefings-statements/feed/", "https://www.whitehouse.gov/remarks/feed/", "https://www.whitehouse.gov/feed/",
  "https://www.state.gov/rss-feed/department-press-briefings/feed/", "https://www.state.gov/briefings/feed/",
  "https://www.fmprc.gov.cn/eng/xw/fyrbt/", "https://www.mfa.gov.cn/eng/xw/fyrbt/", "https://www.fmprc.gov.cn/eng/rss/", 
];
for (const u of U) {
  try {
    const r = await fetch(u, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30000), redirect: "follow" });
    const t = await r.text();
    const items = t.split(/<item>|<entry>/).length - 1;
    const tt = (t.match(/<title>([\s\S]*?)<\/title>/g) || []).slice(0, 4).map((x) => x.replace(/<\/?title>|<!\[CDATA\[|\]\]>/g, "").trim().slice(0, 90));
    console.log("P ==", u, r.status, r.url !== u ? "-> " + r.url : "", r.headers.get("content-type"), t.length, "items", items, "|", tt.join(" || "));
    if (/copyright/.test(u)) { const x = t.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " "); const i = x.search(/Creative Commons|CC BY|Attribution|лицензи/i); console.log("P   ", x.slice(Math.max(0, i - 300), i + 500)); }
    if (/json/.test(r.headers.get("content-type") || "")) console.log("P   ", t.slice(0, 500));
    if (/fyrbt/.test(u)) console.log("P   links", [...t.matchAll(/href="([^"]+)"[^>]*>([^<]{10,120})</g)].slice(0, 8).map((m) => m[1] + " " + m[2].trim()).join(" | "));
    if (/81350/.test(u)) { const x = t.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " "); console.log("P   ", x.slice(x.indexOf("Tokayev"), x.indexOf("Tokayev") + 400)); }
  } catch (e) { console.log("P ==", u, "ERR", e.message, e.cause?.code || ""); }
}
