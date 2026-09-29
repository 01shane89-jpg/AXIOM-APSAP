// Hourly local-news refresh (run by .github/workflows/refresh-flood.yml, or by hand with Node 18+).
// Two sources per area: GDELT (local-language news worldwide, filtered to security, disaster and unrest themes)
// and national outlets' RSS feeds (tools/news_feeds.json), with a news search where a country has no working outlet. Headlines are machine-translated to English
// (tools/translate.mjs) with the original kept. Items are unverified reports: a link, an outlet and a date.
// Writes data/live/news.js. Exit codes: 0 = at least one source worked, 1 = all failed (old file left untouched).
import fs from "node:fs";
import { translateAll, saveCache } from "./translate.mjs";
import { updateHistory } from "./history.mjs";
import { parseFeed, parseList } from "./feedparse.mjs";
import { getFeed, robotsAllow, unwrap } from "./news_fetch.mjs";
import { loadRelevance, itemRelevance, kept, preTranslation } from "./topics_lib.mjs";
import { loadGazetteer, placeIn } from "./gazetteer.mjs";
import { COUNTRIES } from "./geo_cc.mjs";
import { splitByCountry } from "./split_country.mjs";
import { US_STATES, stateQuery } from "./us_states.mjs";

const TIMEOUT = 30000, PER_AREA = 40, PER_STATE = 25, GDELT_GAP = Number(process.env.GDELT_GAP_MS || 12000);
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
const { feeds, focus = {} } = JSON.parse(fs.readFileSync("tools/news_feeds.json", "utf8"));
// Dates of the items the last run wrote, by link: an item its outlet publishes without a date (a web-page list, a feed with no
// dates) keeps the time OSAP first saw it instead of looking new on every run.
const seenAt = new Map();
try {
  const t = fs.readFileSync("data/live/news.js", "utf8"), prev = JSON.parse(t.slice(t.indexOf("=") + 1).trim().replace(/;$/, ""));
  for (const l of Object.values(prev.items || {})) for (const i of l) if (i.link && i.date) seenAt.set(i.link, i.date);
} catch (e) {}
const nowIso = new Date().toISOString().slice(0, 16);
// a date with no time zone is the outlet's local time: tz in tools/news_feeds.json, e.g. "+08:00"
const zoned = (d, tz) => (tz && /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(:\d\d)?$/.test(String(d).trim()) ? String(d).trim().replace(" ", "T") + tz : d);
// About 330 feeds: read several hosts at once but never more than one request at a time to the same host.
const LANES = 8;
async function readFeed(f) {
  try {
    if (f.search && !(await robotsAllow(f.url))) throw new Error("robots.txt does not allow this search");
    const body = await getFeed(f.url);
    // html: an agency's news list on a web page (links matching f.match), read like a feed
    const list = (f.html ? parseList(body, f.url, f.match) : parseFeed(body)).slice(0, f.max || 25).map((i) => {
      const link = f.search ? unwrap(i.link) : i.link;
      let outlet = f.outlet;
      if (f.search) { try { outlet = (i.source || new URL(link).hostname.replace(/^www\./, "")) + " (via Bing News search)"; } catch (e) {} }
      // a search returns outlets in any language: a non-Latin headline from an English query is left for the model to detect
      const lang = f.search && /^en\b/.test(f.lang) && /[^\u0000-\u024F\u1E00-\u1EFF\u2000-\u206F]/.test(i.title) ? "" : f.lang;
      let date = iso(zoned(i.date, f.tz)), seen = false;
      if (!date) { date = seenAt.get(link) || nowIso; seen = true; }
      const o = { title: i.title, summary: i.summary.slice(0, 280), date, link, outlet, lang, via: f.search ? "search" : f.html ? "web page" : "RSS", state: !!f.state };
      if (seen) o.date_seen = true;          // the outlet gives no date: this is when OSAP first saw it
      if (f.nc) o.nc = true;
      if (f.tier) o.tier = f.tier;          // official, national, regional, local-language or specialist (tools/news_feeds.json)
      if (f.region) o.region = f.region;    // the province or island group a regional outlet covers
      return o;
    });
    // a US state's own outlets are kept apart ("us:TX") and written to data/live/news/us-states/<st>.js for the state view
    push(f.st ? "us:" + f.st : f.cc, list); status.push({ cc: f.cc, st: f.st, source: f.outlet, url: f.url, ok: true, n: list.length });
  } catch (e) { status.push({ cc: f.cc, st: f.st, source: f.outlet, url: f.url, ok: false, error: e.name === "AbortError" ? "timed out" : e.message }); }
}
const byHost = {};
for (const f of feeds) { let h = f.url; try { h = new URL(f.url).hostname; } catch (e) {} (byHost[h] = byHost[h] || []).push(f); }
const hosts = Object.values(byHost);
await Promise.all(Array.from({ length: LANES }, async () => { for (let q; (q = hosts.shift()); ) for (const f of q) { await readFeed(f); if (f.search) await sleep(1000); } }));   // a second between searches on the same engine
// Every country in the picker must have news. Any country left with no working source this run (its outlets down,
// or an empty search) gets a Bing News search for its name, tried quoted and then plain; marked as a search like the others.
const working = () => new Set(status.filter((s) => s.ok && s.n > 0 && !s.st).map((s) => s.cc));
for (const c of COUNTRIES) {
  if (c.id === "oki" || working().has(c.id)) continue;
  for (const q of ['"' + c.name + '"', c.name]) {
    const url = "https://www.bing.com/news/search?q=" + encodeURIComponent(q) + "&format=rss";
    if (feeds.some((f) => f.url === url)) continue;
    await readFeed({ cc: c.id, outlet: "Bing News search (fallback)", url, lang: "en", search: true, nc: true });
    await sleep(1000);
    if (working().has(c.id)) break;
  }
}
// Every US state gets news too: a state whose outlets all failed this run gets a Bing News search for its name.
const stOk = () => new Set(status.filter((s) => s.ok && s.n > 0 && s.st).map((s) => s.st));
for (const [code, name] of US_STATES) {
  if (stOk().has(code)) continue;
  await readFeed({ cc: "us", st: code, outlet: "Bing News search (fallback)", url: "https://www.bing.com/news/search?q=" + encodeURIComponent(stateQuery(code, name)) + "&format=rss",
    lang: "en", search: true, nc: true });
  await sleep(1000);
}
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
const share = (cc) => (focus[cc] && focus[cc].per_run) || (cc === "oki" ? 2 * PER_AREA : cc.includes(":") ? PER_STATE : PER_AREA);   // Okinawa reads more searches than any other area
for (const cc of Object.keys(items)) {
  const seen = new Set();
  items[cc] = items[cc].filter((i) => !seen.has(i.link) && seen.add(i.link)).sort((a, b) => (b.date > a.date ? 1 : -1)).slice(0, share(cc));
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
  const need = Object.entries(items).filter(([k]) => !k.includes(":")).flatMap(([, l]) => l).filter((i) => !i.img && /^https:\/\//.test(i.link || "")).slice(0, OG_MAX);
  let got = 0;
  for (let k = 0; k < need.length; k += 8) {
    const res = await Promise.all(need.slice(k, k + 8).map((i) => ogImage(i.link)));
    res.forEach((u, j) => { if (u) { need[k + j].img = u; got++; } });
  }
  console.log("article-page pictures:", got, "of", need.length, "items without a feed picture");
}
const all = [...new Set(Object.values(items).flat())];
// The model translates about 400 texts a run and the cache holds 6,000, so with every country's outlets the order matters:
// headlines of the original 28 areas first, then every other headline (newest first), then only the original areas' summaries.
// Other countries' summaries stay in the original language.
const FIRST = new Set([...Object.keys(FIPS), "oki"]), areaOf = new Map();
for (const [cc, list] of Object.entries(items)) for (const i of list) if (!areaOf.has(i) || FIRST.has(cc)) areaOf.set(i, cc);
const ord = [...all].sort((a, b) => (FIRST.has(areaOf.get(b)) - FIRST.has(areaOf.get(a))) || (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
const sums = ord.filter((i) => FIRST.has(areaOf.get(i)));
const tr = await translateAll([...ord.map((i) => ({ text: i.title, lang: i.lang })), ...sums.map((i) => ({ text: i.summary, lang: i.lang }))]);
ord.forEach((i, n) => { i.title_en = tr[n].en; i._t = tr[n].tool; });
sums.forEach((i, n) => { const b = tr[ord.length + n]; i.summary_en = b.en; i._s = b.tool; });
all.forEach((i) => {
  i.mt = /^en\b/i.test(i.lang || "") ? null : (i._t || i._s || "untranslated");
  if (i.summary_en === undefined) i.summary_en = /^en\b/i.test(i.lang || "") ? i.summary : null;
  delete i._t; delete i._s;
});
saveCache();
// Only news that matters to an analyst or a special operations team in the country is kept (tools/relevance.json, checked on
// the English headline once it is translated): sport, celebrity, entertainment and lifestyle never reach Local news, Top stories
// or the history. The outlets still count as working sources.
{
  const R = await loadRelevance(); let out = 0;
  for (const cc of Object.keys(items)) { const n = items[cc].length; items[cc] = items[cc].filter((i) => kept(itemRelevance(R, i))); out += n - items[cc].length; }
  console.log("relevance: left out", out, "headlines (sport, celebrity, lifestyle or no relevant word)");
}
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
    if (!g && st) g = stateCentre(gz, st);
    i.geo = g ? { n: g.name, la: g.lat, lo: g.lon, p: g.prec } : null;
    if (g) placed++;
  }
  console.log("placed", placed, "of", all.length, "items by name");
  function stateCentre(gz, st) {
    // by admin-1 code, not name: a city can hold the name (Washington, D.C.; Georgia, the country)
    const p = gz.us && gz.us.regs.get("US." + st);
    return p ? { name: p.name, lat: +p.lat.toFixed(3), lon: +p.lon.toFixed(3), prec: "province" } : null;
  }
} catch (e) { console.error("gazetteer unavailable, items left unplaced:", e.message); }
if (!status.some((s) => s.ok)) { console.error("every news source failed"); process.exit(1); }
fs.mkdirSync("data/live", { recursive: true });
// US state news: one file per state (the page loads only the open state's), taken out of the national snapshot
{
  fs.mkdirSync("data/live/news/us-states", { recursive: true });
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
