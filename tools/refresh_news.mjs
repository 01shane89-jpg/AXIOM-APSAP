// Hourly local-news refresh (run by .github/workflows/refresh-flood.yml, or by hand with Node 18+).
// Two sources per area: GDELT (local-language news worldwide, filtered to security, disaster and unrest themes)
// and national outlets' RSS feeds (tools/news_feeds.json), with a news search where a country has no working outlet. Headlines are machine-translated to English
// (tools/translate.mjs) with the original kept. Items are unverified reports: a link, an outlet and a date.
// Writes data/live/news.js. Exit codes: 0 = at least one source worked, 1 = all failed (old file left untouched).
import fs from "node:fs";
import { translateAll, saveCache, seed } from "./translate.mjs";
import { updateHistory, storedTranslations } from "./history.mjs";
import { parseFeed, parseList } from "./feedparse.mjs";
import { ADAPTERS } from "./news_adapters.mjs";
import { getFeed, robotsAllow, unwrap } from "./news_fetch.mjs";
import { loadRelevance, itemRelevance, kept, preTranslation } from "./topics_lib.mjs";
import { loadGazetteer, placeIn } from "./gazetteer.mjs";
import { COUNTRIES, ccsInText } from "./geo_cc.mjs";
import { splitByCountry } from "./split_country.mjs";
import { stripOutletText } from "./outlet_text.mjs";
import { dedupeStories } from "./news_dedupe.mjs";
import { US_STATES, stateQuery } from "./us_states.mjs";

const TIMEOUT = 30000, PER_AREA = 40, PER_STATE = 60, GDELT_GAP = Number(process.env.GDELT_GAP_MS || 12000);
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";
// GDELT uses FIPS country codes for the outlet's country
const FIPS = { th: "TH", vn: "VM", kh: "CB", la: "LA", mm: "BM", ph: "RP", my: "MY", sg: "SN", id: "ID", bn: "BX", tl: "TT",
  cn: "CH", tw: "TW", kp: "KN", kr: "KS", jp: "JA", mn: "MG", au: "AS", nz: "NZ", pg: "PP",
  in: "IN", pk: "PK", np: "NP", bt: "BT", bd: "BG", lk: "CE", mv: "MV" };
const THEMES = "(theme:NATURAL_DISASTER OR theme:MANMADE_DISASTER OR theme:PROTEST OR theme:TERROR OR theme:ARMEDCONFLICT OR theme:KILL OR theme:ARREST OR theme:MILITARY OR theme:SECURITY_SERVICES OR theme:CRISISLEX_CRISISLEXREC)";
const LANG = { English: "en", Thai: "th", Vietnamese: "vi", Khmer: "km", Lao: "lo", Burmese: "my", Indonesian: "id", Malay: "ms", Chinese: "zh",
  Korean: "ko", Japanese: "ja", Mongolian: "mn", Hindi: "hi", Urdu: "ur", Nepali: "ne", Bengali: "bn", Sinhala: "si", Sinhalese: "si", Tamil: "ta",
  Tagalog: "tl", Filipino: "tl", Dhivehi: "dv", Tetum: "tet", Marathi: "mr", Telugu: "te", Malayalam: "ml", Gujarati: "gu", Punjabi: "pa", Kannada: "kn", Russian: "ru", French: "fr", Spanish: "es", Portuguese: "pt" };

async function get(url, asText) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 (AXIOM-ASAP hourly refresh)", accept: "application/rss+xml, application/xml, application/json, text/xml, */*" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return asText ? await r.text() : await r.json();
  } finally { clearTimeout(t); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gdeltDate = (s) => (/^\d{8}T\d{6}Z$/.test(s || "") ? s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6, 8) + "T" + s.slice(9, 11) + ":" + s.slice(11, 13) : "");
const iso = (d) => { const t = new Date(d); return isNaN(t) ? "" : t.toISOString().slice(0, 16); };

const status = [], items = {};
function push(cc, arr) { (items[cc] = items[cc] || []).push(...arr); }

// GDELT allows about one request every five seconds per client and rate-limits shared cloud addresses hard, so the
// areas are asked in a few batches (sourcecountry:A OR sourcecountry:B ...) and results are split by the outlet's country.
const SCN = { Thailand: "th", Vietnam: "vn", Cambodia: "kh", Laos: "la", Burma: "mm", Myanmar: "mm", Philippines: "ph", Malaysia: "my", Singapore: "sg",
  Indonesia: "id", Brunei: "bn", "Timor-Leste": "tl", "East Timor": "tl", China: "cn", Taiwan: "tw", "North Korea": "kp", "South Korea": "kr", Japan: "jp",
  Mongolia: "mn", Australia: "au", "New Zealand": "nz", "Papua New Guinea": "pg", India: "in", Pakistan: "pk", Nepal: "np", Bhutan: "bt", Bangladesh: "bd",
  "Sri Lanka": "lk", Maldives: "mv" };
// Off by default: from GitHub's runners GDELT refused or dropped every request on the first two hourly runs
// (2026-09-26). Set GDELT=1 to try it again.
const codes = Object.entries(FIPS), BATCH = 7, USE_GDELT = process.env.GDELT === "1";
for (let b = 0; USE_GDELT && b < codes.length; b += BATCH) {
  const part = codes.slice(b, b + BATCH);
  if (b) await sleep(GDELT_GAP);
  const url = "https://api.gdeltproject.org/api/v2/doc/doc?query=" + encodeURIComponent("(" + part.map((x) => "sourcecountry:" + x[1]).join(" OR ") + ") " + THEMES) +
    "&mode=artlist&maxrecords=250&format=json&timespan=24h&sort=datedesc";
  let j = null, error = "";
  for (let attempt = 0; attempt < 2 && !j; attempt++) {
    try { j = await get(url); } catch (e) { error = e.name === "AbortError" ? "timed out" : e.message; if (/429/.test(error)) await sleep(GDELT_GAP * 3); }
  }
  const n = {};
  if (j) for (const a of j.articles || []) {
    const cc = SCN[a.sourcecountry]; if (!cc || !a.url || !a.title || !part.some((x) => x[0] === cc)) continue;
    push(cc, [{ title: a.title.trim(), summary: "", date: gdeltDate(a.seendate), link: a.url, outlet: a.domain || "", ...(/^https:\/\//.test(a.socialimage || "") ? { img: a.socialimage } : {}),
      lang: LANG[a.language] || (a.language || "").slice(0, 2).toLowerCase(), via: "GDELT" }]);
    n[cc] = (n[cc] || 0) + 1;
  }
  for (const [cc] of part) status.push(j ? { cc, source: "GDELT", ok: true, n: n[cc] || 0 } : { cc, source: "GDELT", ok: false, error });
}
const { feeds: listed, focus = {} } = JSON.parse(fs.readFileSync("tools/news_feeds.json", "utf8"));
// covers: a regional outlet (Pacific, Caribbean, Africa, Middle East, Balkans, Latin America) is listed once with every country it
// reports on, and read as one source per country that keeps only the items naming that country (tools/geo_cc.mjs ccsInText, with
// French and Spanish names: whole names, longest first, so "South Sudan" is not Sudan and "Guinea-Bissau" is not Guinea).
// A home country listed as cc but not in covers keeps every item, as before. The feed is fetched once a run and shared.
const feeds = listed.flatMap((f) => (f.covers ? [...(f.covers.includes(f.cc) ? [] : [{ ...f, covers: undefined }]),
  ...f.covers.map((cc) => ({ ...f, cc, covers: undefined, names: true }))] : [f]));
// Dates of the items the last run wrote, by link: an item its outlet publishes without a date (a web-page list, a feed with no
// dates) keeps the time OSAP first saw it instead of looking new on every run.
const seenAt = new Map(), seenDetail = new Map();
try {
  const t = fs.readFileSync("data/live/news.js", "utf8"), prev = JSON.parse(t.slice(t.indexOf("=") + 1).trim().replace(/;$/, ""));
  for (const l of Object.values(prev.items || {})) for (const i of l) if (i.link && i.date) { seenAt.set(i.link, i.date); if (i.detail) seenDetail.set(i.link, i); }
} catch (e) {}
const nowIso = new Date().toISOString().slice(0, 16);
// a date with no time zone is the outlet's local time: tz in tools/news_feeds.json, e.g. "+08:00"
// clock: the feed writes local wall-clock time but labels it UTC (or gives no zone); read it as local time at that offset.
const onClock = (d, tz) => { const m = /^([+-])(\d\d):(\d\d)$/.exec(tz || ""); if (!m || !d) return d; const off = (m[1] === "-" ? -1 : 1) * (+m[2] * 60 + +m[3]); return new Date(Date.parse(d + "Z") - off * 60000).toISOString().slice(0, 16); };
const zoned = (d, tz) => (tz && /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(:\d\d)?$/.test(String(d).trim()) ? String(d).trim().replace(" ", "T") + tz : d);
// About 330 feeds: read several hosts at once but never more than one request at a time to the same host.
const LANES = 8, MAX_AGE_DAYS = 30;
const bodies = {}, failed = new Set();   // one fetch per address a run (a regional outlet serves several countries)
async function readFeed(f) {
  try {
    if (f.search && !(await robotsAllow(f.url))) throw new Error("robots.txt does not allow this search");
    const body = await (bodies[f.url] = bodies[f.url] || getFeed(f.url));
    // html: an agency's news list on a web page (links matching f.match), read like a feed
    const list = (f.html ? parseList(body, f.url, f.match) : parseFeed(body)).slice(0, f.max || 25).map((i) => {
      const link = f.search ? unwrap(i.link) : i.link;
      let outlet = f.outlet;
      if (f.search) { try { outlet = (i.source || new URL(link).hostname.replace(/^www\./, "")) + " (via Bing News search)"; } catch (e) {} }
      // a search returns outlets in any language: a non-Latin headline from an English query is left for the model to detect
      const lang = f.search && /^en\b/.test(f.lang) && /[^\u0000-\u024F\u1E00-\u1EFF\u2000-\u206F]/.test(i.title) ? "" : f.lang;
      let date = onClock(iso(zoned(i.date, f.tz)), f.clock), seen = false;
      if (!date) { date = seenAt.get(link) || nowIso; seen = true; }
      const o = { title: i.title, summary: i.summary.slice(0, 280), date, link, outlet, lang, via: f.search ? "search" : f.html ? "web page" : "RSS", state: !!f.state };
      if (seen) o.date_seen = true;          // the outlet gives no date: this is when OSAP first saw it
      if (f.nc) o.nc = true;
      if (f.relevance === "exempt") o.exempt = true;   // every item kept by the relevance check
      if (f.tier) o.tier = f.tier;          // official, national, regional, local-language or specialist (tools/news_feeds.json)
      if (f.region) o.region = f.region;    // the province or island group a regional outlet covers
      if (f.local) o._local = true;         // a feed that mixes in other places' stories (station group, world service): kept only when it names its state or country, or a place in it
      return o;
    });
    // a regional outlet counts for a country only on runs where it names it (no empty source line for each of its countries)
    if (f.names) { for (let k = list.length - 1; k >= 0; k--) if (!ccsInText(list[k].title + " " + list[k].summary, true).includes(f.cc)) list.splice(k, 1); if (!list.length) return; }
    // a US state's own outlets are kept apart ("us:TX") and written to data/live/news/us-states/<st>.js for the state view
    // detail: the list's headline is generic (the same every day); the item's own page gives the facts (tools/news_adapters.mjs).
    // A page read on an earlier run is reused; at most a few new pages a run.
    if (f.detail && ADAPTERS[f.detail]) {
      let reads = 0;
      for (const o of list) {
        const was = seenDetail.get(o.link);
        if (was) { o.title = was.title; o.summary = was.summary; o.detail = was.detail; continue; }
        if (reads++ >= 6) continue;
        try { const d = ADAPTERS[f.detail](await getFeed(o.link)); if (d) { o.title = d.title; o.summary = d.summary.slice(0, 400); o.detail = d.counts || true; } } catch (e) {}
      }
    }
    // an outlet's own date older than MAX_AGE_DAYS is an archive hit (search fallbacks, front-page feeds that stopped updating),
    // not current news: left out of the live list (data/history keeps older items it already had)
    const cut = new Date(Date.now() - MAX_AGE_DAYS * 864e5).toISOString().slice(0, 16), fresh = list.filter((o) => o.date_seen || !(o.date < cut));
    push(f.st ? "us:" + f.st : f.cc, fresh); status.push({ cc: f.cc, st: f.st, source: f.outlet, url: f.url, ok: true, n: fresh.length, ...(fresh.length < list.length ? { old: list.length - fresh.length } : {}) });
  } catch (e) {
    if (f.names && failed.has(f.url)) return;   // a regional outlet that did not answer is listed failed once, not once per country
    failed.add(f.url); status.push({ cc: f.cc, st: f.st, source: f.outlet, url: f.url, ok: false, error: e.name === "AbortError" ? "timed out" : e.message + (e.cause && e.cause.code ? " (" + e.cause.code + ")" : "") });
  }
}
const byHost = {};
for (const f of feeds) { let h = f.url; try { h = new URL(f.url).hostname; } catch (e) {} (byHost[h] = byHost[h] || []).push(f); }
// Searches on the same engine start at least SEARCH_GAP apart (counted from one request's start to the next, not after each
// answer, so a slow answer is not followed by a further second of waiting). Bing serves about 290 searches a run: waiting a full
// second after each answer had made that one queue about 12 minutes, the whole news step's length, and the step hit its
// 14-minute limit on about one run in five (2026-10-23), which left those runs with no news update at all.
const SEARCH_GAP = Number(process.env.SEARCH_GAP_MS || 1000), lastSearch = {};
async function searchSlot(f) {
  let h = ""; try { h = new URL(f.url).hostname; } catch (e) {}
  const wait = (lastSearch[h] || 0) + SEARCH_GAP - Date.now();
  if (wait > 0) await sleep(wait);
  lastSearch[h] = Date.now();
}
async function readPaced(f) { if (f.search) await searchSlot(f); return readFeed(f); }
// the longest queue (the search engine's) starts first, so it is never left waiting for a free lane behind short ones
const hosts = Object.values(byHost).sort((a, b) => b.length - a.length);
const T0 = Date.now(), took = (t) => ((Date.now() - t) / 1000).toFixed(0) + " s";
await Promise.all(Array.from({ length: LANES }, async () => { for (let q; (q = hosts.shift()); ) for (const f of q) await readPaced(f); }));
console.log("timing: feeds read in", took(T0));
// A connection-level failure ("fetch failed": reset, DNS, TLS) can hit dozens of unrelated small sites in one run and be gone by the
// next (about 35 failing sources most runs, 60 on 2026-10-28 04:12Z and 78 on 2026-10-30 08:16Z, nearly all "fetch failed"), so
// those feeds get one more try after a short pause. The failed promise is dropped from the per-address cache so it is fetched again.
const retry = new Set(status.filter((s) => !s.ok && /^fetch failed/.test(s.error)).map((s) => s.url));
if (retry.size) {
  for (let i = status.length; i--; ) if (!status[i].ok && retry.has(status[i].url)) status.splice(i, 1);
  for (const u of retry) { failed.delete(u); delete bodies[u]; }
  await sleep(5000);
  const T1 = Date.now(), again = Object.values(byHost).map((q) => q.filter((f) => retry.has(f.url))).filter((q) => q.length);
  await Promise.all(Array.from({ length: LANES }, async () => { for (let q; (q = again.shift()); ) for (const f of q) await readPaced(f); }));
  const still = new Set(status.filter((s) => !s.ok && retry.has(s.url)).map((s) => s.url)).size;
  console.log("retry: " + retry.size + " feeds after a connection failure, " + (retry.size - still) + " answered the second time, in", took(T1));
}
// Every country in the picker must have news. Any country left with no working source this run (its outlets down,
// or an empty search) gets a Bing News search for its name, tried quoted and then plain; marked as a search like the others.
const working = () => new Set(status.filter((s) => s.ok && s.n > 0 && !s.st).map((s) => s.cc));
for (const c of COUNTRIES) {
  if (c.id === "oki" || working().has(c.id)) continue;
  for (const q of ['"' + c.name + '"', c.name]) {
    const url = "https://www.bing.com/news/search?q=" + encodeURIComponent(q) + "&format=rss";
    if (feeds.some((f) => f.url === url)) continue;
    await readPaced({ cc: c.id, outlet: "Bing News search (fallback)", url, lang: "en", search: true, nc: true });
    if (working().has(c.id)) break;
  }
}
// Every US state also gets a Bing News search for its name on every run, beside its own outlets: one or two outlets a state
// left the state view with a few dozen headlines (Missouri, 2026-10-20). Marked as a search (nc) like the others.
const stOk = () => new Set(status.filter((s) => s.ok && s.n > 0 && s.st).map((s) => s.st));
for (const [code, name] of US_STATES) {
  await readPaced({ cc: "us", st: code, outlet: "Bing News search", url: "https://www.bing.com/news/search?q=" + encodeURIComponent(stateQuery(code, name)) + "&format=rss",
    lang: "en", search: true, nc: true });
}
console.log("timing: fallback and US state searches done at", took(T0));
console.log("US states with news: " + stOk().size + " of " + US_STATES.length);
// Coverage: how many countries have at least one working news source this run, and which have none.
const ok = working(), ids = COUNTRIES.map((c) => c.id);
const coverage = { countries: ids.length, with: ids.filter((i) => ok.has(i)).length, none: ids.filter((i) => !ok.has(i)) };
console.log("news coverage: " + coverage.with + " of " + coverage.countries + " countries have a working source" + (coverage.none.length ? "; none for " + coverage.none.join(" ") : ""));
if (coverage.none.length) console.log("::warning::No working news source this run for " + coverage.none.join(", "));
// Okinawa shares Japan's outlets: keep the Japanese items that name the islands
if (items.jp) push("oki", items.jp.filter((i) => /okinawa|naha|ryukyu|miyako|ishigaki|yonaguni|沖縄|那覇|宮古|石垣|与那国/i.test(i.title + " " + i.summary)));   // plus Okinawa's own outlets
// The relevance check runs before each area is cut to its share, where it can: on English headlines, and on headlines in a
// language tools/relevance.json has its own word lists for (native_langs: Thai, Filipino, Mongolian, Korean, Chinese).
// Otherwise busy outlets' sport and celebrity headlines would take the places of relevant ones, and the translation model
// would spend its hourly budget on headlines that are dropped anyway. Other languages are checked after translation.
{
  const R = await loadRelevance(); let pre = 0;
  for (const cc of Object.keys(items)) { const n = items[cc].length; items[cc] = items[cc].filter((i) => preTranslation(R, i)); pre += n - items[cc].length; }
  console.log("relevance before translation: left out", pre, "headlines");
}
// Focus countries (tools/news_feeds.json "focus") read many more outlets, so they keep more items a run.
const OFFICIAL_EXTRA = 20;
const share = (cc) => (focus[cc] && focus[cc].per_run) || (cc === "oki" ? 2 * PER_AREA : cc.includes(":") ? PER_STATE : PER_AREA);   // Okinawa reads more searches than any other area
for (const cc of Object.keys(items)) {
  // official sources (tier "official": a ministry, coast guard, disaster agency) post a few items a day, often dated by day only,
  // so busy outlets must not push them out: up to OFFICIAL_EXTRA of theirs are kept beyond the country's share.
  let extra = 0;
  // one copy per story (tools/news_dedupe.mjs): the same article under another link, or the same headline within 3 days
  items[cc] = dedupeStories(items[cc].sort((a, b) => (b.date > a.date ? 1 : -1)))
    .filter((i, k) => k < share(cc) || (i.tier === "official" && extra++ < OFFICIAL_EXTRA));
}
// Outlets whose feed carries no picture: read the article page's own og:image (first 96 KB only), a few at a time, and keep it as a link.
const OG_MAX = Number(process.env.OG_MAX || 400);
async function ogImage(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (AXIOM-ASAP hourly refresh)", accept: "text/html" } });
    if (!r.ok || !r.body) return "";
    const rd = r.body.getReader(); let html = "", n = 0;
    while (n < 98304) { const { done, value } = await rd.read(); if (done) break; n += value.length; html += new TextDecoder().decode(value); if (/<\/head>/i.test(html)) break; }
    try { await rd.cancel(); } catch (e) {}
    const m = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)(?::src)?["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i);
    const u = m ? m[1].replace(/&amp;/g, "&").trim() : "";
    return /^https:\/\/[^\s<>"]+$/i.test(u) && u.length < 600 ? u : "";
  } catch (e) { return ""; } finally { clearTimeout(t); }
}
{
  const t1 = Date.now();
  const need = Object.entries(items).filter(([k]) => !k.includes(":")).flatMap(([, l]) => l).filter((i) => !i.img && /^https:\/\//.test(i.link || "")).slice(0, OG_MAX);
  let got = 0;
  // 16 pages at a time (different outlets, first 96 KB only): with 8 at a time, a few slow sites in each batch held the rest
  for (let k = 0; k < need.length; k += 16) {
    const res = await Promise.all(need.slice(k, k + 16).map((i) => ogImage(i.link)));
    res.forEach((u, j) => { if (u) { need[k + j].img = u; got++; } });
  }
  console.log("article-page pictures:", got, "of", need.length, "items without a feed picture; timing", took(t1));
}
const all = [...new Set(Object.values(items).flat())];
// The model translates about 400 texts a run and the cache holds 6,000, so with every country's outlets the order matters:
// headlines of the original 28 areas first, then every other headline (newest first). Summaries are not translated: outlet text
// is never stored (tools/outlet_text.mjs), and an English summary is still read below for relevance and places.
const FIRST = new Set([...Object.keys(FIPS), "oki"]), areaOf = new Map();
for (const [cc, list] of Object.entries(items)) for (const i of list) if (!areaOf.has(i) || FIRST.has(cc)) areaOf.set(i, cc);
const ord = [...all].sort((a, b) => (FIRST.has(areaOf.get(b)) - FIRST.has(areaOf.get(a))) || (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
// English already stored with the history is reused (tools/history.mjs), so a story keeps its translation after the cache drops it
console.log("translations reused from the history:", seed(storedTranslations("news", Object.keys(items).filter((k) => !k.includes(":")))));
const t2 = Date.now();
const tr = await translateAll(ord.map((i) => ({ text: i.title, lang: i.lang })));
console.log("timing: translation", took(t2));
ord.forEach((i, n) => { i.title_en = tr[n].en; i._t = tr[n].tool; });
all.forEach((i) => {
  i.mt = /^en\b/i.test(i.lang || "") ? null : (i._t || "untranslated");
  i.summary_en = /^en\b/i.test(i.lang || "") ? i.summary : null;
  delete i._t;
});
saveCache();
// Only news that matters to an analyst or a security team in the country is kept (tools/relevance.json, checked on
// the English headline once it is translated): sport, celebrity, entertainment and lifestyle never reach Local news, Top stories
// or the history. The outlets still count as working sources.
{
  const R = await loadRelevance(); let out = 0;
  for (const cc of Object.keys(items)) { const n = items[cc].length; items[cc] = items[cc].filter((i) => kept(itemRelevance(R, i))); out += n - items[cc].length; }
  console.log("relevance: left out", out, "headlines (sport, celebrity, lifestyle or no relevant word)");
}
const NAME_ALIAS = { th: ["Thai"], af: ["Afghan"], so: ["Somali"], kg: ["Kyrgyz"], uz: ["Uzbek"], tr: ["Turk", "Türkiye"], mm: ["Myanmar", "Burm"],
  kr: ["Korea", "Seoul"], kp: ["Korea", "Pyongyang"], cn: ["China", "Chinese", "Beijing"], ru: ["Russia", "Kremlin", "Moscow"], ua: ["Ukrain", "Kyiv"],
  ir: ["Iran", "Tehran"], vn: ["Vietnam", "Viet Nam", "Hanoi"], la: ["Lao"], ng: ["Nigeria"], et: ["Ethiopia"], er: ["Eritrea"], rs: ["Serb"], br: ["Brazil", "Brasil"] };
// Pin each item to the first town or region its headline or summary names inside its own country (GeoNames, tools/gazetteer.mjs).
// geo.p is the honest precision: "approx" = a town or city centre, "province" = the rough centre of a named region.
// Items that name no place carry no geo and are not pinned.
try {
  const gz = await loadGazetteer();
  let placed = 0;
  for (const [cc, list] of Object.entries(items)) for (const i of list) {
    if (i.geo !== undefined) continue;
    const texts = [[i.title_en, i.summary_en].filter(Boolean).join(" \n "), i.title];
    let g = null;
    // a US state's own outlet: only a place inside that state, else the state's rough centre
    const st = cc.startsWith("us:") ? cc.slice(3) : "", ok = (r) => r && (!st || r.a1 === "US." + st);
    for (const t of texts) { const r = placeIn(gz, t, [st ? "us" : cc]); if (ok(r) && (!g || (r.prec === "approx" && g.prec !== "approx"))) g = r; if (g && g.prec === "approx") break; }
    // a local-TV feed's network-wide stories (the same health or weather piece on every station) name no place in the state:
    // left out of the state view rather than pinned to the state's centre
    if (!g && st && i._local && !new RegExp("\\b" + (US_STATES.find((s) => s[0] === st) || [, "-"])[1] + "\\b", "i").test(texts.join(" "))) { i._drop = true; continue; }
    // a world-service feed in one language (BBC, RFA) also carries other countries' news: kept under its country only when it names it
    if (!g && !st && i._local && !namesCountry(cc, texts.join(" "))) { i._drop = true; continue; }
    if (!g && st) g = stateCentre(gz, st);
    i.geo = g ? { n: g.name, la: g.lat, lo: g.lon, p: g.prec } : null;
    if (g) placed++;
  }
  let dropped = 0;
  for (const k of Object.keys(items)) { const n = items[k].length; items[k] = items[k].filter((i) => !i._drop); dropped += n - items[k].length; }
  for (const l of Object.values(items)) for (const i of l) delete i._local;
  console.log("placed", placed, "of", all.length, "items by name;", dropped, "items from mixed feeds (local TV, world services) naming no place in their state or country left out");
  function namesCountry(cc, text) {
    // the page's name, and the demonyms and short forms a name does not start (Thai, Afghan, Korea, Burma)
    const c = COUNTRIES.find((x) => x.id === cc), extra = NAME_ALIAS[cc] || [];
    const names = [c && c.name.replace(/\s*\(.*\)$/, ""), ...extra].filter(Boolean).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return names.length > 0 && new RegExp("\\b(" + names.join("|") + ")", "i").test(text);
  }
  function stateCentre(gz, st) {
    // by admin-1 code, not name: a city can hold the name (Washington, D.C.; Georgia, the country)
    const p = gz.us && gz.us.regs.get("US." + st);
    return p ? { name: p.name, lat: +p.lat.toFixed(3), lon: +p.lon.toFixed(3), prec: "province" } : null;
  }
} catch (e) { console.error("gazetteer unavailable, items left unplaced:", e.message); }
if (!status.some((s) => s.ok)) { console.error("every news source failed"); process.exit(1); }
// headline, link and what OSAP derived only: the outlet's summary is dropped before anything is written (tools/outlet_text.mjs)
{ const R = await loadRelevance(); for (const i of all) stripOutletText(i, R); }
fs.mkdirSync("data/live", { recursive: true });
// US state news: one file per state (the page loads only the open state's), taken out of the national snapshot
{
  fs.mkdirSync("data/live/news/us-states", { recursive: true });
  // each state's items also go to its own history (tools/history.mjs), so "All" in the state view shows more than this run
  const stItems = Object.fromEntries(US_STATES.map(([code]) => ["us:" + code, items["us:" + code] || []]));
  try { await updateHistory("news", stItems, stamp); } catch (e) { console.error("state history not updated:", e.message); }
  for (const [code] of US_STATES) {
    const k = "us:" + code, part = { asof: stamp, st: code, sources: status.filter((s) => s.st === code), items: items[k] || [] };
    fs.writeFileSync("data/live/news/us-states/" + code.toLowerCase() + ".js", "window.ASAP_NEWS_ST=" + JSON.stringify(part).replace(/<\//g, "<\\/") + ";\n");
    delete items[k];
  }
}
fs.writeFileSync("data/live/news.js", "window.ASAP_NEWS=" + JSON.stringify({ asof: stamp, sources: status.filter((s) => !s.st), coverage, items }).replace(/<\//g, "<\\/") + ";\n");
splitByCountry("data/live/news.js", "ASAP_NEWS"); // one small file per country for the page (tools/split_country.mjs)
try { await updateHistory("news", items, stamp, Object.fromEntries(Object.entries(focus).map(([cc, v]) => [cc, v.history]).filter((e) => e[1]))); } catch (e) { console.error("history not updated:", e.message); }
status.forEach((s) => console.log(s.ok ? "ok  " : "FAIL", s.cc, s.source, s.ok ? s.n + " items" : s.error));
console.log("items with a picture:", Object.entries(items).map(([cc, l]) => cc + " " + l.filter((i) => i.img).length + "/" + l.length).join(", "));
