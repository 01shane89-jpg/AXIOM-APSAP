// The publication time an article page gives for itself, for news search results (tools/refresh_news.mjs, tools/refresh_topics.mjs).
// Bing News search dates its results with its own time, not the outlet's, and on 2026-11-17 that time was often hours early:
// TVBS's 2026-11-17 04:47Z report of Russian aircraft near Taiwan was dated 16 Nov 14:46Z and Kuwait Times' 17 Nov 05:49Z report
// of Japan scrambling jets 16 Nov 10:48Z, so both looked like the first report of a story that began 16 Nov ~19:00Z.
// pageDate(html) reads the page head's own date: article:published_time, datePublished (meta name or itemprop) or a JSON-LD
// "datePublished", only when it carries a time zone (a bare "2026-11-17 08:49:00" could be any zone). The answer is cached by
// link (data/live/news-dates.json, { link: ["YYYY-MM-DDTHH:MM" or "", "YYYY-MM-DD" read] }), so a page is read once.
// Untrusted page text is only matched against these few patterns, never run.
import fs from "node:fs";

export const DATES = process.env.NEWS_DATES || "data/live/news-dates.json";
const KEEP_HIT = 30, KEEP_MISS = 2, MAX = 40000;
const ZONED = /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d(?::\d\d(?:\.\d+)?)?\s*(?:Z|[+-]\d\d:?\d\d)$/i;
const meta = (html, key) => {
  const k = key.replace(/[.:]/g, "\\$&");
  const m = html.match(new RegExp("<meta[^>]+(?:property|name|itemprop)=[\"']" + k + "[\"'][^>]*content=[\"']([^\"']+)[\"']", "i")) ||
    html.match(new RegExp("<meta[^>]+content=[\"']([^\"']+)[\"'][^>]*(?:property|name|itemprop)=[\"']" + k + "[\"']", "i"));
  return m ? m[1].trim() : "";
};
const toIso = (s) => {
  s = String(s || "").trim();
  if (!ZONED.test(s)) return "";
  const t = Date.parse(s.replace(" ", "T").replace(/\s+(?=[Z+-])/i, "").replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
  return isNaN(t) ? "" : new Date(t).toISOString().slice(0, 16);
};
// "YYYY-MM-DDTHH:MM" (UTC) or ""
export function pageDate(html) {
  html = String(html || "");
  for (const k of ["article:published_time", "datePublished", "og:article:published_time", "pubdate", "publish-date"]) {
    const d = toIso(meta(html, k)); if (d) return d;
  }
  for (const m of html.matchAll(/"datePublished"\s*:\s*"([^"]{10,40})"/g)) { const d = toIso(m[1]); if (d) return d; }
  return "";
}

// the cached page time for a link, or "" (no read, no answer, or a stale one)
export function cachedDate(cache, link, today = new Date()) { const e = cache.get(link); return fresh(e, today) ? e[0] || "" : ""; }
// Search rows already in the news index (data/live/news-index/<day>.js, the last `days` days): { via, link, date } for each, so
// their pages can be read with the remaining budget and the index re-dated from the cache.
export function indexSearchRows(days = 2, dir = "data/live/news-index", now = Date.now()) {
  const out = [];
  for (let k = 0; k < days; k++) {
    const d = new Date(now - k * 864e5).toISOString().slice(0, 10);
    try {
      const t = fs.readFileSync(dir + "/" + d + ".js", "utf8"), rows = JSON.parse(t.slice(t.indexOf("]=") + 2).trim().replace(/;$/, ""));
      for (const r of rows) if (Array.isArray(r) && /s/.test(r[7] || "") && /^https:\/\//.test(r[5] || "")) out.push({ via: "search", link: r[5], date: r[1] });
    } catch (e) {}
  }
  return out;
}
export function loadDates(file = DATES) {
  try { return new Map(Object.entries(JSON.parse(fs.readFileSync(file, "utf8")))); } catch (e) { return new Map(); }
}
const fresh = (e, today) => Array.isArray(e) && (today - Date.parse(e[1] + "T00:00Z")) / 864e5 <= (e[0] ? KEEP_HIT : KEEP_MISS);
export function saveDates(cache, file = DATES, today = new Date()) {
  const rows = [...cache.entries()].filter(([, e]) => fresh(e, today)).sort((a, b) => (b[1][1] > a[1][1] ? 1 : b[1][1] < a[1][1] ? -1 : 0)).slice(0, MAX);
  fs.writeFileSync(file, JSON.stringify(Object.fromEntries(rows)));
  return rows.length;
}
// The date an item is shown with when its page gives one: the page's own time replaces the search engine's when they differ by
// more than SLACK minutes, unless the page time is ahead of the run (a wrong page clock). Returns true when the date changed.
const SLACK = 30;
export function applyPageDate(i, d, now = Date.now()) {
  if (!d || !i) return false;
  if (Date.parse(d + "Z") > now + 15 * 60000) return false;
  if (i.date && Math.abs(Date.parse(d + "Z") - Date.parse(i.date + "Z")) <= SLACK * 60000) return false;
  i.date_listed = i.date || ""; i.date = d; i.date_src = "page"; delete i.date_seen;
  return true;
}
// Search results (via "search") in this list: their page dates, from the cache or read with read(link) -> { date } (tools/news_pics.mjs
// readPage; newest first, at most max pages, 16 at a time). Returns { cached, read, found, moved }.
export async function fillPageDates(list, cache, max, read, today = new Date()) {
  const day = today.toISOString().slice(0, 10), now = today.getTime();
  let cached = 0, found = 0, moved = 0;
  const todo = [];
  for (const i of new Set(list)) {
    if (!i || i.via !== "search" || !/^https:\/\//.test(i.link || "")) continue;
    const e = cache.get(i.link);
    if (fresh(e, today)) { cached++; if (applyPageDate(i, e[0], now)) moved++; } else todo.push(i);
  }
  const need = todo.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0)).slice(0, max);
  for (let k = 0; k < need.length; k += 16) {
    const res = await Promise.all(need.slice(k, k + 16).map((i) => read(i.link).then((p) => (p && p.date) || "", () => "")));
    res.forEach((d, j) => { const i = need[k + j]; cache.set(i.link, [d || "", day]); if (d) { found++; if (applyPageDate(i, d, now)) moved++; } });
  }
  return { cached, read: need.length, found, moved };
}
