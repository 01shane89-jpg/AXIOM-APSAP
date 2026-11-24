// Fast news for the flash loop (tools/flash_loop.mjs). Before this, a news report reached a push alert only through the news lane:
// on main, 23 Nov 2026 03:00-15:30Z, 2,852 RSS items in 12 countries' files were on main a median 47 minutes after their outlet's
// own time (10% within 30 minutes, 10% after 79), because the lane reads about 1,800 feeds, translates and places them, and commits
// every 25 to 35 minutes. Quakes and tsunami bulletins were already seconds to a minute; everything else (an attack, a blast, a
// coup) waited for that cycle.
// The loop now also:
//   - asks a short list of tools/news_feeds.json's own feeds (tools/flash_feeds.json: English wire, state agency, official and
//     newspaper-of-record RSS in the countries OSAP watches most) about once a minute, politely: OSAP's own plain name as the
//     client, If-None-Match / If-Modified-Since, never more often than the feed's own Cache-Control max-age (up to 5 minutes),
//     at most one request to a host every HOST_GAP, and backing off on 429, 5xx or a failure;
//   - when a new item is serious (tools/flash_lib.mjs serious: a killing, blast, attack, coup...), asks that country's other English
//     RSS feeds once at once (a "burst", at most once per country every BURST_EVERY), so a second outlet's report of the same event
//     is in within a minute or two too (its items from the last hour only: a burst looks for the same event). Two different sources on one event is what makes a news alert a FLASH alert.
// New items are made the way tools/refresh_news.mjs makes them (date fixes, relevance check, place, outlet text dropped), English
// only (no translation in the loop), dated by the outlet within the last FRESH_H hours, and laid into that country's own file
// (data/live/news/<cc>.js, which the push check's page reads), never over a copy of a story the file already holds.
// Nothing is committed: the news lane still owns the published files; when main's data is taken, items main does not carry yet are
// laid over again. A news item is a report, never a finding; the push says who reported it and "reported, not verified".
import fs from "node:fs";
import { parseFeed } from "./feedparse.mjs";
import { itemDate } from "./news_date.mjs";
import { itemRelevance, kept } from "./topics_lib.mjs";
import { placeIn } from "./gazetteer.mjs";
import { stripOutletText } from "./outlet_text.mjs";
import { dedupeStories, storyLink } from "./news_dedupe.mjs";
import { serious } from "./flash_lib.mjs";

export const UA = "AXIOM-OSAP/1.0 (open-source situational awareness; +https://01shane89-jpg.github.io/AXIOM-APSAP/)";
export const FRESH_H = 3, BURST_FRESH_H = 1, MIN_S = 60, MAX_S = 300, HOST_GAP = 20e3, BURST_EVERY = 10 * 60e3, BURST_MAX = 12;
// the wide tier: every other plain English RSS feed news_feeds.json lists, about every WIDE_S; a round asks at most PER_ROUND feeds,
// LANES at a time (never two at once to one host), so the loop's quake and push steps never wait long behind it
export const WIDE_S = 300, PER_ROUND = 24, LANES = 8;
const en = (f) => /^en\b/i.test(f.lang || "");
const plainRss = (f) => !f.search && !f.html && !f.covers && !f.st && !f.detail && en(f);

/* every plain English RSS feed news_feeds.json lists that is not on the fast list (the wide tier) */
export function wideFeeds(listed, fastUrls) {
  const skip = new Set(fastUrls), retired = new Set((listed.retired || []).map((r) => (typeof r === "string" ? r : r.url))), seen = new Set();
  return listed.feeds.filter((f) => plainRss(f) && !skip.has(f.url) && !retired.has(f.url) && !seen.has(f.url) && seen.add(f.url));
}
/* the fast list's feeds, as tools/news_feeds.json lists them (a URL no longer listed there, or retired, is dropped) */
export function fastFeeds(listed, urls) {
  const by = new Map(listed.feeds.filter(plainRss).map((f) => [f.url, f]));
  const retired = new Set((listed.retired || []).map((r) => (typeof r === "string" ? r : r.url)));
  return urls.map((u) => by.get(u)).filter((f) => f && !retired.has(f.url));
}
/* a country's other English RSS feeds, for a burst */
export function burstFeeds(listed, cc, skip = new Set()) {
  const retired = new Set((listed.retired || []).map((r) => (typeof r === "string" ? r : r.url)));
  return listed.feeds.filter((f) => f.cc === cc && plainRss(f) && !skip.has(f.url) && !retired.has(f.url)).slice(0, BURST_MAX);
}

/* one feed item made as tools/refresh_news.mjs makes it; null when it has no real date of its own */
export function toItem(raw, f, now = Date.now()) {
  if (!raw || !raw.title || !/^https?:\/\//.test(raw.link || "")) return null;
  const { date, seen } = itemDate(raw.date, f, undefined, now);
  if (seen || !date) return null;            // undated: the lane dates it by when it first saw it; the loop leaves it
  const o = { title: raw.title, summary: String(raw.summary || "").slice(0, 280), date, link: raw.link, outlet: f.outlet, lang: f.lang, via: "RSS", state: !!f.state };
  if (raw.image) o.img = raw.image;
  if (f.nc) o.nc = true;
  if (f.relevance === "exempt") o.exempt = true;
  if (f.tier) o.tier = f.tier;
  if (f.region) o.region = f.region;
  o.title_en = o.title; o.mt = null; o.summary_en = o.summary;
  return o;
}
/* fresh, relevant, placed, outlet text dropped; null when it is left out */
export function finish(R, gz, o, cc, now = Date.now(), freshH = FRESH_H) {
  if (!o) return null;
  const t = Date.parse(o.date + "Z");
  if (!(t > now - freshH * 36e5)) return null;
  if (R && !kept(itemRelevance(R, o))) return null;
  let g = null;
  try { g = gz ? placeIn(gz, [o.title_en, o.summary_en].filter(Boolean).join(" \n "), [cc]) : null; } catch (e) {}
  o.geo = g ? { n: g.name, la: g.lat, lo: g.lon, p: g.prec } : null;
  stripOutletText(o, R);
  return o;
}

function readPart(file) {
  try { const t = fs.readFileSync(file, "utf8"); return JSON.parse(t.slice(t.indexOf("=") + 1).trim().replace(/;$/, "")); } catch (e) { return null; }
}
export const partFile = (cc) => "data/live/news/" + cc + ".js";
/* links (as storyLink) a country's file holds now */
export function linksIn(cc, file = partFile(cc)) {
  const p = readPart(file);
  return new Set((((p && p.items) || {})[cc] || []).map((i) => storyLink(i.link)));
}
/* lays items into a country's file, newest first, skipping any story the file already holds (same article, or the same headline
   within 3 days: tools/news_dedupe.mjs); returns the items added */
export function layNews(cc, fresh, file = partFile(cc)) {
  if (!fresh.length || !/^[a-z]{2,3}$/.test(cc)) return [];
  const p = readPart(file) || { asof: "", sources: [], coverage: null, items: {} };
  const was = (p.items || {})[cc] || [];
  const keep = new Set(dedupeStories([...was, ...fresh]));
  const add = fresh.filter((i) => keep.has(i));
  if (!add.length) return [];
  p.items = { ...(p.items || {}), [cc]: [...add, ...was].sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0)) };
  fs.writeFileSync(file, "window.ASAP_NEWS=" + JSON.stringify(p).replace(/<\//g, "<\\/") + ";\n");
  return add;
}

/* when to ask a feed next: its Cache-Control max-age (between MIN_S and MAX_S), doubled per failure up to 15 minutes */
export function nextGap(base, maxAge, fails) {
  const s = Math.min(MAX_S, Math.max(base, isFinite(maxAge) && maxAge > 0 ? maxAge : 0));
  return Math.min(15 * 60, s * 2 ** Math.min(4, fails)) * 1000;
}
const maxAgeOf = (cc) => { const m = /(?:^|,)\s*max-age\s*[=:]\s*(\d+)/i.exec(cc || ""); return m ? +m[1] : NaN; };

/* the poller: due feeds, one request per host every HOST_GAP; returns new finished items per country */
export class FastNews {
  constructor({ feeds, wide = [], listed, R, gz, base = MIN_S, wideBase = WIDE_S, fetchFn = fetch, log = () => {}, now = Date.now() }) {
    this.listed = listed; this.R = R; this.gz = gz; this.base = base; this.fetch = fetchFn; this.log = log;
    this.seen = new Set(); this.st = new Map(); this.host = new Map(); this.burstAt = new Map(); this.queue = [];
    this.fast = new Set(feeds.map((f) => f.url));
    for (const f of feeds) this.st.set(f.url, { f, next: 0, fails: 0, etag: "", lm: "", polls: 0, base });
    // the wide tier's first asks are spread over its interval, not all at once
    wide.forEach((f, k) => { if (!this.st.has(f.url)) this.st.set(f.url, { f, next: now + Math.round((k * wideBase * 1000) / Math.max(1, wide.length)), fails: 0, etag: "", lm: "", polls: 0, base: wideBase, wide: true }); });
    this.requests = 0; this.notModified = 0; this.failures = 0;
  }
  hostOf(u) { try { return new URL(u).hostname; } catch (e) { return u; } }
  /* one round: due fast feeds first, then queued burst feeds, then due wide feeds, at most PER_ROUND, LANES at a time, one per host;
     returns { cc: [items] } of new finished items */
  async round(now = Date.now()) {
    const out = {}, due = [...this.st.values()].filter((s) => s.next <= now);
    const cand = [...due.filter((s) => !s.wide), ...this.queue.splice(0), ...due.filter((s) => s.wide).sort((a, b) => a.next - b.next)];
    const take = [], later = [];
    for (const s of cand) {
      const h = this.hostOf(s.f.url);
      if (take.length >= PER_ROUND || (this.host.get(h) || 0) + HOST_GAP > now) { if (s.burst) later.push(s); continue; }
      this.host.set(h, now); take.push(s);
    }
    this.queue.push(...later);
    let k = 0;
    await Promise.all(Array.from({ length: Math.min(LANES, take.length) }, async () => {
      for (let s; (s = take[k++]); ) for (const i of await this.poll(s, now)) (out[s.f.cc] = out[s.f.cc] || []).push(i);
    }));
    return out;
  }
  async poll(s, now) {
    const h = { "user-agent": UA, accept: "application/rss+xml, application/xml, text/xml, */*" };
    if (s.etag) h["if-none-match"] = s.etag;
    if (s.lm) h["if-modified-since"] = s.lm;
    this.requests++;
    let body = "", maxAge = NaN;
    try {
      const r = await this.fetch(s.f.url, { headers: h, signal: AbortSignal.timeout(15000) });
      maxAge = maxAgeOf(r.headers.get("cache-control"));
      if (r.status === 304) { this.notModified++; s.fails = 0; s.lastOk = now; if (!s.burst) s.next = now + nextGap(s.base || this.base, maxAge, 0); return []; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      body = await r.text();
      s.etag = r.headers.get("etag") || ""; s.lm = r.headers.get("last-modified") || "";
      s.fails = 0;
    } catch (e) {
      this.failures++; s.fails++;
      // a site that refuses OSAP's own name is left to the news lane for the rest of the run (no other client is tried)
      if (s.wide && /HTTP (401|403|410)\b/.test(String(e.message)) && s.fails >= 2) { s.next = Infinity; this.refused = (this.refused || 0) + 1; return []; }
      if (!s.burst) { s.next = now + nextGap(s.base || this.base, maxAge, s.fails); if (!s.wide && (s.fails === 1 || s.fails % 10 === 0)) this.log(`fast news ${s.f.cc} ${this.hostOf(s.f.url)} failed (${String(e.message || e).slice(0, 60)}), ${s.fails} in a row`); }
      return [];
    }
    if (!s.burst) s.next = now + nextGap(s.base || this.base, maxAge, 0);
    const first = !s.burst && s.polls++ === 0;
    // late: the outlet's own time is before this feed's previous answer (a minute's slack for minute-precision dates), so the item
    // was not in the feed when OSAP last asked: the outlet posted it after the time it gives. Its delay is the outlet's, not OSAP's.
    const prev = s.lastOk || 0; s.lastOk = now;
    const items = [];
    for (const raw of parseFeed(body, { image: true }).slice(0, s.f.max || 25)) {
      // an item read before is not made again (the loop keeps what it laid; main's copy is the lane's)
      const k = storyLink(raw.link);
      if (this.seen.has(k)) continue;
      this.seen.add(k);
      const o = finish(this.R, this.gz, toItem(raw, s.f, now), s.f.cc, now, s.burst ? BURST_FRESH_H : FRESH_H);
      if (o) { o._first = first; o._burst = !!s.burst; o._wide = !!s.wide; o._late = !first && prev > 0 && Date.parse(o.date + "Z") < prev - 60e3; items.push(o); }
    }
    return items;
  }
  /* a serious new item in cc: ask the country's other English feeds once, at most once per BURST_EVERY; returns how many queued */
  burst(cc, now = Date.now()) {
    if ((this.burstAt.get(cc) || 0) + BURST_EVERY > now) return 0;
    this.burstAt.set(cc, now);
    const fs_ = burstFeeds(this.listed, cc, this.fast);
    for (const f of fs_) this.queue.push({ f, burst: true, fails: 0, etag: "", lm: "" });
    return fs_.length;
  }
}
export { serious };
