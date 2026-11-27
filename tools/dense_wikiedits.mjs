// Wikipedia edit surges on country articles, registered into the dense open-data run. Added 27 Nov 2026 from the OSINT
// Framework comparison. Wikimedia's public edit metrics (CC0 metrics of CC BY-SA articles) give the edits per day to each
// country's English Wikipedia article; a day with at least 15 edits and four times the 30-day median is a surge, an attention
// signal that often follows (or leads) a fast-moving event. Only counts are read: never editor usernames, never article text.
// One request per country, 120 ms apart (Wikimedia allows far more and asks for a descriptive User-Agent, which dense_lib sends).
import { feed, run, sleep } from "./dense_lib.mjs";
import { COUNTRIES } from "./geo_cc.mjs";

// English Wikipedia titles where the article is not at the country's OSAP name (the metrics API does not follow redirects)
export const TITLE = { ge: "Georgia (country)", cd: "Democratic Republic of the Congo", cg: "Republic of the Congo", tr: "Turkey", gm: "The Gambia", ie: "Republic of Ireland",
  ps: "State of Palestine", fm: "Federated States of Micronesia", bs: "The Bahamas", oki: "Okinawa Prefecture", ci: "Ivory Coast", cv: "Cape Verde", cz: "Czech Republic" };
export const MIN_EDITS = 15, FACTOR = 4;
const median = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };

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
    detail: "Edits per day to the English Wikipedia article, from Wikimedia's public edit metrics. A surge shows attention, often around a fast-moving event; it says nothing about which edits are right. Open the page history to see what changed.",
    date: s.day, url: "https://en.wikipedia.org/w/index.php?title=" + t + "&action=history", sev: s.edits >= 50 ? 2 : 1, kind: "Wikipedia edit surge", value: s.edits, ccs: [cc],
  };
}

feed("wiki-edit-surge", { name: "Edit surges on country articles (English Wikipedia)", org: "Wikimedia Foundation, edit metrics", cat: "Events",
  lic: "Wikimedia metrics CC0; articles CC BY-SA 4.0 (counts only, no text)", url: "https://wikimedia.org/api/rest_v1/", everyHours: 12 });
run("wiki-edit-surge", async (g) => {
  const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const end = new Date(Date.now() - 864e5), start = new Date(Date.now() - 32 * 864e5), items = [];
  let read = 0, failed = 0;
  for (const c of COUNTRIES) {
    const title = TITLE[c.id] || c.name;
    try {
      const j = await g("https://wikimedia.org/api/rest_v1/metrics/edits/per-page/en.wikipedia.org/" + encodeURIComponent(title.replace(/ /g, "_")) + "/all-editor-types/daily/" + ymd(start) + "/" + ymd(end), "json", { timeout: 20000 });
      read++;
      const s = surge(((j.items || [])[0] || {}).results);
      if (s) items.push(wikiItem(c.id, title, s));
    } catch (e) { failed++; }
    await sleep(120);
  }
  if (!read) throw new Error("no country article answered");
  items.sort((a, b) => b.value - a.value);
  return { items, note: read + " country articles read" + (failed ? ", " + failed + " failed" : "") + "; " + items.length + " surges" };
});
