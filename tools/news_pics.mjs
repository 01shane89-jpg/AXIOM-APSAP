// News pictures: the outlet's own picture for a story, kept as a link to the outlet's copy (never downloaded or re-hosted).
// ogImage(url) reads the first 96 KB of the article page for its og:image / twitter:image (8 s timeout, the job's own honest
// user agent, no proxy, no retry past a refusal: a page that answers 401/403 simply has no picture here).
// The picture cache (data/live/news-pics.json, { link: [img, "YYYY-MM-DD"] }) remembers each page read, with or without a
// picture, so a page is read once rather than every hour: found pictures are kept 30 days, misses 2 days, then read again.
// Used by tools/refresh_news.mjs (country news) and tools/world_pictures.mjs (the World list).
import fs from "node:fs";
import { pageDate } from "./news_pagedate.mjs";

export const PICS = process.env.NEWS_PICS || "data/live/news-pics.json";
const KEEP_HIT = 30, KEEP_MISS = 2, MAX = 40000;
export const okPic = (u) => typeof u === "string" && /^https:\/\/[^\s<>"']{8,600}$/i.test(u);

// What an article page's head gives (its first 96 KB, up to </head>): { img, date } (date: tools/news_pagedate.mjs pageDate),
// or empty strings when it cannot be read. One read per link a run, shared by the picture and the publication date; only the
// two short answers are kept, never the page.
const pages = new Map();
export function readPage(url) {
  if (!pages.has(url)) pages.set(url, fetchHead(url).then((html) => ({ img: pageImage(html), date: pageDate(html) })));
  return pages.get(url);
}
async function fetchHead(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (AXIOM-ASAP hourly refresh)", accept: "text/html" } });
    if (!r.ok || !r.body) return "";
    const rd = r.body.getReader(), dec = new TextDecoder(); let html = "", n = 0;
    while (n < 98304) { const { done, value } = await rd.read(); if (done) break; n += value.length; html += dec.decode(value, { stream: true }); if (/<\/head>/i.test(html)) break; }
    try { await rd.cancel(); } catch (e) {}
    return html;
  } catch (e) { return ""; } finally { clearTimeout(t); }
}
export async function ogImage(url) { return (await readPage(url)).img; }
// the og:image (or twitter:image) a page's head names, in either attribute order, https only
export function pageImage(html) {
  const m = String(html).match(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url|:url)?|twitter:image(?::src)?)["'][^>]*content=["']([^"']+)["']/i) ||
    String(html).match(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image(?::secure_url|:url)?|twitter:image(?::src)?)["']/i);
  const u = m ? m[1].replace(/&amp;/g, "&").trim() : "";
  return okPic(u) ? u : "";
}

export function loadPics(file = PICS) {
  try { return new Map(Object.entries(JSON.parse(fs.readFileSync(file, "utf8")))); } catch (e) { return new Map(); }
}
// the cached answer for a link: the picture, "" for a recent miss (do not read again yet), or undefined (not known or stale)
export function cachedPic(cache, link, today = new Date()) {
  const e = cache.get(link); if (!Array.isArray(e)) return undefined;
  const age = (today - Date.parse(e[1] + "T00:00Z")) / 864e5;
  if (e[0] ? age > KEEP_HIT : age > KEEP_MISS) return undefined;
  return e[0] || "";
}
export function savePics(cache, file = PICS, today = new Date()) {
  const rows = [...cache.entries()].filter(([, e]) => Array.isArray(e) && (today - Date.parse(e[1] + "T00:00Z")) / 864e5 <= (e[0] ? KEEP_HIT : KEEP_MISS))
    .sort((a, b) => (b[1][1] > a[1][1] ? 1 : b[1][1] < a[1][1] ? -1 : 0)).slice(0, MAX);
  fs.writeFileSync(file, JSON.stringify(Object.fromEntries(rows)));
  return rows.length;
}
// read the pages of these items (each { link, img? }) that have no picture yet, newest first, at most max pages, 16 at a time;
// a picture found or a miss goes into the cache. Returns { cached, read, found }.
export async function fillPics(list, cache, max, today = new Date()) {
  const day = today.toISOString().slice(0, 10);
  let cached = 0, found = 0;
  const lack = [...new Set(list.filter((i) => i && !i.img && /^https:\/\//.test(i.link || "")))];
  const todo = [];
  for (const i of lack) { const c = cachedPic(cache, i.link, today); if (c) { i.img = c; cached++; } else if (c === undefined) todo.push(i); }
  const need = todo.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0)).slice(0, max);
  for (let k = 0; k < need.length; k += 16) {
    const res = await Promise.all(need.slice(k, k + 16).map((i) => ogImage(i.link)));
    res.forEach((u, j) => { const i = need[k + j]; cache.set(i.link, [u || "", day]); if (u) { i.img = u; found++; } });
  }
  return { cached, read: need.length, found };
}
