// Probe 16 (26 Nov 2026): html newsroom lists through feedparse.parseList (Iowa Governor, Iowa HHS, IDF).
import { UA } from "./dense_lib.mjs";
import { parseList } from "./feedparse.mjs";
for (const [u, m] of [["https://governor.iowa.gov/newsroom", "^/press-release/\\d{4}-\\d{2}-\\d{2}/[a-z0-9-]+$"], ["https://hhs.iowa.gov/about/newsroom", "^/news-release/\\d{4}-\\d{2}-\\d{2}/[a-z0-9-]+$"],
  ["https://www.idf.il/en/mini-sites/idf-press-releases-israel-at-war/", "^/en/mini-sites/idf-press-releases-israel-at-war/[a-z]+-\\d{2}-pr/[a-z0-9-]+/$"]]) {
  try {
    const r = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(40000) }); const h = await r.text();
    const L = parseList(h, r.url, m); console.log("P", u, r.status, L.length);
    for (const x of L.slice(0, 5)) console.log("P  ", JSON.stringify({ t: x.title, d: x.date, l: x.link }).slice(0, 300));
  } catch (e) { console.log("P", u, "ERR", e.message); }
}
