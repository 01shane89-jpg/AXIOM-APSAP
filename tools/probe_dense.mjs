// Probe 20 (26 Nov 2026): is the Kremlin English news feed reachable and keyless?
const { UA } = await import("./dense_lib.mjs");
for (const u of ["https://en.kremlin.ru/events/president/news/feed", "http://en.kremlin.ru/events/president/news/feed", "http://kremlin.ru/events/president/news/feed"]) {
  try {
    const r = await fetch(u, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30000) });
    const t = await r.text();
    const items = t.split(/<item>|<entry>/).slice(1);
    console.log("P", u, r.status, r.headers.get("content-type"), "len", t.length, "items", items.length);
    for (const it of items.slice(0, 4)) console.log("P   ", (it.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.slice(0, 120), "|", (it.match(/<(pubDate|published|updated)>([^<]+)/) || [])[2], "|", (it.match(/<link>([^<]+)|href="([^"]+)"/) || []).slice(1).find(Boolean));
  } catch (e) { console.log("P", u, "ERR", e.message); }
}
