// Wikipedia edit surges on country articles, registered into the dense open-data run. Added 27 Nov 2026 from the OSINT
// Framework comparison. For each country's English Wikipedia article, the MediaWiki API's revision timestamps over the last 31
// days give edits per UTC day; yesterday counts as a surge with at least 8 edits and four times the 30-day median, an attention
// signal that often follows (or leads) a fast-moving event. Only timestamps are requested (rvprop=timestamp): never editor
// usernames, never article text. (Wikimedia's edit-metrics API was tried first; on 27 Nov its daily data ended a month back.)
// One request per country, 150 ms apart, with dense_lib's descriptive User-Agent as Wikimedia asks.
import { feed, run, sleep } from "./dense_lib.mjs";
import { COUNTRIES } from "./geo_cc.mjs";

// English Wikipedia titles where the article is not at the country's OSAP name (redirects are followed too)
export const TITLE = { ge: "Georgia (country)", cd: "Democratic Republic of the Congo", cg: "Republic of the Congo", tr: "Turkey", gm: "The Gambia", ie: "Republic of Ireland",
  ps: "State of Palestine", fm: "Federated States of Micronesia", bs: "The Bahamas", oki: "Okinawa Prefecture", ci: "Ivory Coast", cv: "Cape Verde", cz: "Czech Republic" };
export const MIN_EDITS = 8, FACTOR = 4;
const median = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };

// revision timestamps -> [{ timestamp, edits }] per UTC day from `from` to `to` (inclusive, "YYYY-MM-DD"), oldest first. When the
// API stopped at its 500-revision limit, days before the oldest revision it returned are unknown and left out.
export function perDay(stamps, from, to, capped = false) {
  const n = {}, ts = (stamps || []).map(String).filter((t) => /^\d{4}-\d\d-\d\dT/.test(t)).sort();
  for (const t of ts) n[t.slice(0, 10)] = (n[t.slice(0, 10)] || 0) + 1;
  const first = capped && ts.length ? ts[0].slice(0, 10) : from, out = [];
  for (let d = Date.parse(from + "T00:00:00Z"); d <= Date.parse(to + "T00:00:00Z"); d += 864e5) {
    const k = new Date(d).toISOString().slice(0, 10);
    if (capped && k <= first) continue;
    out.push({ timestamp: k + "T00:00:00.000Z", edits: n[k] || 0 });
  }
  return out;
}
// results: [{ timestamp, edits }] oldest first -> a surge on the last day, or null
export function surge(results) {
  const r = (results || []).filter((x) => x && x.timestamp && Number.isFinite(+x.edits));
  if (r.length < 8) return null;
  const last = r[r.length - 1], base = r.slice(-31, -1).map((x) => +x.edits), med = median(base);
  if (+last.edits < MIN_EDITS || +last.edits < FACTOR * Math.max(med, 1)) return null;
  return { day: String(last.timestamp).slice(0, 10), edits: +last.edits, median: med };
}
export function wikiItem(cc, title, s) {
  const t = encodeURIComponent(title.replace(/ /g, "_"));
  return {
    title: "Wikipedia surge: the \"" + title + "\" article was edited " + s.edits + " times on " + s.day + " (30-day median " + s.median + ")",
    detail: "Edits per UTC day to the English Wikipedia article, counted from its revision history. A surge shows attention, often around a fast-moving event; it says nothing about which edits are right. Open the page history to see what changed.",
    date: s.day, url: "https://en.wikipedia.org/w/index.php?title=" + t + "&action=history", sev: s.edits >= 50 ? 2 : 1, kind: "Wikipedia edit surge", value: s.edits, ccs: [cc],
  };
}

feed("wiki-edit-surge", { name: "Edit surges on country articles (English Wikipedia)", org: "Wikimedia Foundation, English Wikipedia", cat: "Events",
  lic: "Revision timestamps only; articles CC BY-SA 4.0 (no text used)", url: "https://en.wikipedia.org/", everyHours: 12 });
run("wiki-edit-surge", async (g) => {
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  const today = day(Date.now()), to = day(Date.now() - 864e5), from = day(Date.now() - 31 * 864e5), items = [];
  let read = 0, failed = 0;
  for (const c of COUNTRIES) {
    const title = TITLE[c.id] || c.name;
    try {
      const j = await g("https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=revisions&rvprop=timestamp&rvlimit=500&rvstart=" + today + "T00:00:00Z&rvend=" + from + "T00:00:00Z&titles=" + encodeURIComponent(title), "json", { timeout: 20000 });
      const page = ((j.query || {}).pages || [])[0] || {};
      if (page.missing || !page.revisions) { failed++; continue; }
      read++;
      const s = surge(perDay(page.revisions.map((r) => r.timestamp), from, to, page.revisions.length >= 500 || !!j.continue));
      if (s) items.push(wikiItem(c.id, page.title || title, s));
    } catch (e) { failed++; }
    await sleep(150);
  }
  if (!read) throw new Error("no country article answered");
  items.sort((a, b) => b.value - a.value);
  return { items, note: read + " country articles read" + (failed ? ", " + failed + " failed" : "") + "; " + items.length + " surges on " + to };
});
