// Probe 3 (23 Nov 2026): what the news job's own parsers read from moved-feed candidates (OSAP's normal user agent only).
import { parseFeed, parseList } from "./feedparse_now.mjs";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 (AXIOM-ASAP hourly refresh)";
const C = [
  ["feed", "https://thedebrief.org/rss/THEDEBRIEF/full"], ["feed", "https://thedebrief.org/feed/THEDEBRIEF/full.xml"],
  ["html", "https://agn.gt/", "^/[a-z0-9]+(?:-[a-z0-9]+){3,}/?$"], ["html", "https://agn.gt/ultimas-noticias", "^/[a-z0-9]+(?:-[a-z0-9]+){3,}/?$"],
  ["html", "https://www.lequotidien.lu/", "^/[a-z-]+/[a-z0-9-]+/\\d+$"],
  ["html", "https://standard.gm/", "^/[a-z0-9]+(?:-[a-z0-9]+){2,}/$"],
  ["html", "https://www.mod.gov.rw/news", "/docs-media/news-detail/[a-z0-9-]+$"],
  ["html", "https://www.criticalthreats.org/analysis", "^/analysis/[a-z0-9]+(?:-[a-z0-9]+){2,}$"],
  ["feed", "https://www.smartraveller.gov.au/countries/documents/index.rss"], ["feed", "https://www.smartraveller.gov.au/countries/documents/index.rss"],
];
for (const [kind, u, match] of C) {
  const t0 = Date.now();
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(60000), headers: { "user-agent": UA, accept: "application/rss+xml, application/xml, text/xml, */*" } }); const b = await r.text();
    const it = kind === "html" ? parseList(b, u, match) : parseFeed(b, {});
    const d = it.map((x) => x.date).filter(Boolean).sort().reverse();
    console.log("P", u, r.status, (Date.now() - t0) + "ms", "n=" + it.length, "dated=" + d.length, "newest=" + (d[0] || "-"), "|", it.slice(0, 3).map((x) => x.title.slice(0, 80) + " <" + x.link.slice(0, 90) + ">").join(" || "));
  } catch (e) { console.log("P", u, "ERR", (Date.now() - t0) + "ms", e.message, e.cause && e.cause.code); }
}
