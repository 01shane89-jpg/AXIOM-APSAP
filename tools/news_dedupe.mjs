// One copy of each news story: the same headline from the same or another outlet within DAYS days, or the same article
// under a link that differs only by tracking tags (utm_, fbclid...), "www." or "/amp". Near-matches are not merged:
// "Debate for the government of Rondonia" and "...of DF" are different stories. index.html sameStory() mirrors this.
const DAYS = 3;
const TRACK = /^(utm_|fbclid|gclid|ocid|cmpid|seo_visit|at_|ref$|rss$|src$)/i;
export function storyTitle(t) {
  t = String(t || "").toLowerCase().replace(/\s[-–|]\s[^-–|]{2,40}$/, "");   // " - Outlet" on the end of search headlines
  t = t.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return t.split(" ").length >= 5 ? t : "";   // short headlines ("DIGITAL 08H: the verdict") repeat daily
}
export function storyLink(u) {
  try {
    const x = new URL(u);
    const q = [...x.searchParams].filter(([k]) => !TRACK.test(k)).map(([k, v]) => k + "=" + v).sort().join("&");
    return x.hostname.replace(/^(www|amp|m)\./, "") + x.pathname.replace(/\/(amp(\.html)?)?\/?$/, "") + (q ? "?" + q : "");
  } catch (e) { return String(u || ""); }
}
// a copy found through a search engine: its date is the engine's, which for the same article can differ by hours between
// searches (Bing gave one Daily News article as 02:28 and 16:28 UTC, and Khaosod and Naewna articles 7 hours before their own feeds)
export const searchDated = (i) => i.via === "search" || /\(via [^)]*search\)$/i.test(i.outlet || "");
// items newest first; keeps the first (newest) copy of each story, except that the outlet's own copy of an article (its feed
// or page, with the outlet's date) is kept over a search engine's copy of the same link
export function dedupeStories(items) {
  const links = new Set(), titles = new Map(), own = new Set(items.filter((i) => !searchDated(i)).map((i) => storyLink(i.link)));
  return items.filter((i) => {
    const l = storyLink(i.link); if (links.has(l) || (searchDated(i) && own.has(l))) return false; links.add(l);
    const t = storyTitle(i.title), d = Date.parse(i.date) || 0;
    if (t) { const was = titles.get(t); if (was !== undefined && Math.abs(was - d) <= DAYS * 864e5) return false; titles.set(t, d); }
    return true;
  });
}
