// Data-set searches (run by .github/workflows/refresh-flood.yml after the news step, or by hand with Node 18+).
// Each data set in tools/topics.json may list news searches; this runs them (Bing News RSS, read only where robots.txt
// allows, one a second) and keeps the results for 30 days in data/live/topics.js, filed under every country a headline names.
// Results are search hits: a headline, the outlet, a date and a link, marked nc (aggregator terms).
// A data set may also list specialist feeds (feeds: [{name, url}], e.g. cyber or aviation trade press, NHC/JTWC): read
// directly, not nc, so the sold version keeps them when the searches are switched off (OSAP_COMMERCIAL, tools/nc_strip.mjs).
// A failed search or feed keeps its earlier results. Exit code 0 unless tools/topics.json is unreadable.
import fs from "node:fs";
import { parseFeed } from "./feedparse.mjs";
import { getFeed, robotsAllow, unwrap } from "./news_fetch.mjs";
import { COUNTRIES } from "./geo_cc.mjs";
import { countriesNamed, compileTopics, topicsOf, compileRelevance, relevance } from "./topics_lib.mjs";
import { staleSearchResult } from "./conflict_lib.mjs";
import { COMMERCIAL } from "./nc_strip.mjs";

const OUT = "data/live/topics.js", KEEP_DAYS = 30, PER_TOPIC = 300, MAX_SEARCHES = 4;
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";
const iso = (d) => { const t = new Date(d); return isNaN(t) ? "" : t.toISOString().slice(0, 16); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { topics } = JSON.parse(fs.readFileSync("tools/topics.json", "utf8"));
const REL = compileRelevance(JSON.parse(fs.readFileSync("tools/relevance.json", "utf8")), topics);

let prev = { items: [] };
try { const t = fs.readFileSync(OUT, "utf8"); prev = JSON.parse(t.slice(t.indexOf("=") + 1).trim().replace(/;$/, "")); } catch (e) {}
const byLink = new Map((prev.items || []).map((i) => [i.link, i]));
const status = [];
// a search engine (or a trade feed) also returns loosely related stories: keep only those that contain one of the data
// set's own words, name one of its countries when it has any, and pass the relevance check (sport, celebrity, lifestyle)
function fits(t, own, text) {
  if (!topicsOf(own, text, countriesNamed(COUNTRIES, text)).length && !(t.countries || []).length) return false;
  if ((t.countries || []).length && !topicsOf(own, text, t.countries).length) return false;
  return ["strong", "keep"].includes(relevance(REL, text));
}
// headline and link only: a summary is read to check the fit but never stored (tools/outlet_text.mjs)
const record = (t, i, link, outlet, extra) => {
  const old = byLink.get(link), text = i.title + " " + (i.summary || "");
  return { title: i.title, date: iso(i.date), link, outlet, ...extra,
    // a non-Latin headline from an English query is left without a language rather than mislabelled
    lang: /[^\u0000-\u024F\u1E00-\u1EFF\u2000-\u206F]/.test(i.title) ? "" : "en",
    cc: countriesNamed(COUNTRIES, text).slice(0, 3), topics: [...new Set([...((old && old.topics) || []), t.id])], first_seen: (old && old.first_seen) || stamp };
};
const feedBodies = {};   // a feed listed by more than one data set is read once a run
for (const t of topics || []) {
  if (!/^[a-z0-9-]+$/.test(t.id || "")) continue;
  const own = compileTopics([t]);
  for (const f of t.feeds || []) {
    try {
      const list = parseFeed(await (feedBodies[f.url] = feedBodies[f.url] || getFeed(f.url))).slice(0, 50);
      let n = 0, off = 0;
      for (const i of list) {
        if (!/^https?:\/\//.test(i.link || "") || !i.title) continue;
        if (!fits(t, own, i.title + " " + (i.summary || ""))) { off++; continue; }
        byLink.set(i.link, record(t, i, i.link, f.name, { via: "RSS" })); n++;
      }
      status.push({ topic: t.id, feed: f.name, url: f.url, ok: true, n, off });
    } catch (e) { status.push({ topic: t.id, feed: f.name, url: f.url, ok: false, error: e.name === "AbortError" ? "timed out" : e.message }); }
  }
}
// each search starts at least a second after the one before, counted from its start (no further second after a slow answer)
let lastSearch = 0;
for (const t of topics || []) {
  if (!/^[a-z0-9-]+$/.test(t.id || "")) { console.log("skipped a data set with a bad id:", t.id); continue; }
  const own = compileTopics([t]);
  // the sold version asks no search engine (aggregator terms forbid commercial use)
  for (const q of COMMERCIAL ? [] : (t.searches || []).slice(0, MAX_SEARCHES)) {
    const url = "https://www.bing.com/news/search?q=" + encodeURIComponent(q) + "&format=rss";
    { const w = lastSearch + 1000 - Date.now(); if (w > 0) await sleep(w); lastSearch = Date.now(); }
    try {
      if (!(await robotsAllow(url))) throw new Error("robots.txt does not allow this search");
      const list = parseFeed(await getFeed(url)).slice(0, 25);
      let n = 0, off = 0;
      for (const i of list) {
        const link = unwrap(i.link); if (!/^https?:\/\//.test(link || "") || !i.title) continue;
        let outlet = "";
        try { outlet = (i.source || new URL(link).hostname.replace(/^www\./, "")) + " (via Bing News search)"; } catch (e) { continue; }
        if (!fits(t, own, i.title + " " + (i.summary || ""))) { off++; continue; }
        // a story a specialist feed already gave keeps that (commercial) source and only gains the data set
        const had = byLink.get(link);
        if (had && !had.nc) { had.topics = [...new Set([...had.topics, t.id])]; n++; continue; }
        const o = record(t, i, link, outlet, { via: "search", nc: true });
        byLink.set(link, o); n++;
      }
      status.push({ topic: t.id, q, ok: true, n, off });
    } catch (e) { status.push({ topic: t.id, q, ok: false, error: e.name === "AbortError" ? "timed out" : e.message }); }
  }
}
const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString().slice(0, 16), count = {};
// an old story the search listed with a fresh date (its link or its own text dates it earlier) is left out
const items = [...byLink.values()].filter((i) => (i.date || i.first_seen) >= cutoff && !staleSearchResult([i.title, i.summary].join(" "), i.date, 60, { link: i.link })).sort((a, b) => (b.date > a.date ? 1 : -1))
  .filter((i) => i.topics.some((id) => (count[id] = (count[id] || 0) + 1) <= PER_TOPIC));
for (const i of items) delete i.summary;   // copies kept from before 2026-10-17
fs.mkdirSync("data/live", { recursive: true });
fs.writeFileSync(OUT, "window.OSAP_TOPICS=" + JSON.stringify({ asof: stamp, sources: status, items }).replace(/<\//g, "<\\/") + ";\n");
status.forEach((s) => console.log(s.ok ? "ok  " : "FAIL", s.topic, JSON.stringify(s.q || s.feed), s.ok ? s.n + " items" + (s.off ? ", " + s.off + " off-topic or not relevant left out" : "") : s.error));
console.log("data-set search results kept:", items.length);
