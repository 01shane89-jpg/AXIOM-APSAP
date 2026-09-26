// Hourly local-news refresh (run by .github/workflows/refresh-flood.yml, or by hand with Node 18+).
// Two sources per area: GDELT (local-language news worldwide, filtered to security, disaster and unrest themes)
// and national outlets' RSS feeds (tools/news_feeds.json). Headlines are machine-translated to English
// (tools/translate.mjs) with the original kept. Items are unverified reports: a link, an outlet and a date.
// Writes data/live/news.js. Exit codes: 0 = at least one source worked, 1 = all failed (old file left untouched).
import fs from "node:fs";
import { translateAll, saveCache } from "./translate.mjs";
import { parseFeed } from "./feedparse.mjs";

const TIMEOUT = 30000, PER_AREA = 40, GDELT_GAP = Number(process.env.GDELT_GAP_MS || 6000);
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
    const r = await fetch(url, { signal: ctl.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; AXIOM-ASAP news refresh)" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return asText ? await r.text() : await r.json();
  } finally { clearTimeout(t); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gdeltDate = (s) => (/^\d{8}T\d{6}Z$/.test(s || "") ? s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6, 8) + "T" + s.slice(9, 11) + ":" + s.slice(11, 13) : "");
const iso = (d) => { const t = new Date(d); return isNaN(t) ? "" : t.toISOString().slice(0, 16); };

const status = [], items = {};
function push(cc, arr) { (items[cc] = items[cc] || []).push(...arr); }

let first = true;
for (const [cc, f] of Object.entries(FIPS)) {
  if (!first) await sleep(GDELT_GAP); first = false;   // GDELT asks for no more than one request every five seconds
  const url = "https://api.gdeltproject.org/api/v2/doc/doc?query=" + encodeURIComponent("sourcecountry:" + f + " " + THEMES) +
    "&mode=artlist&maxrecords=50&format=json&timespan=24h&sort=datedesc";
  try {
    const j = await get(url);
    const arts = (j.articles || []).filter((a) => a.url && a.title).map((a) => ({ title: a.title.trim(), summary: "", date: gdeltDate(a.seendate),
      link: a.url, outlet: a.domain || "", lang: LANG[a.language] || (a.language || "").slice(0, 2).toLowerCase(), via: "GDELT" }));
    push(cc, arts); status.push({ cc, source: "GDELT", ok: true, n: arts.length });
  } catch (e) { status.push({ cc, source: "GDELT", ok: false, error: e.name === "AbortError" ? "timed out" : e.message }); }
}
const { feeds } = JSON.parse(fs.readFileSync("tools/news_feeds.json", "utf8"));
for (const f of feeds) {
  try {
    const list = parseFeed(await get(f.url, true)).slice(0, 25).map((i) => ({ title: i.title, summary: i.summary.slice(0, 280), date: iso(i.date),
      link: i.link, outlet: f.outlet, lang: f.lang, via: "RSS", state: !!f.state }));
    push(f.cc, list); status.push({ cc: f.cc, source: f.outlet, url: f.url, ok: true, n: list.length });
  } catch (e) { status.push({ cc: f.cc, source: f.outlet, url: f.url, ok: false, error: e.name === "AbortError" ? "timed out" : e.message }); }
}
// Okinawa shares Japan's outlets: keep the Japanese items that name the islands
if (items.jp) items.oki = items.jp.filter((i) => /okinawa|naha|ryukyu|miyako|ishigaki|yonaguni|沖縄|那覇|宮古|石垣|与那国/i.test(i.title + " " + i.summary));
for (const cc of Object.keys(items)) {
  const seen = new Set();
  items[cc] = items[cc].filter((i) => !seen.has(i.link) && seen.add(i.link)).sort((a, b) => (b.date > a.date ? 1 : -1)).slice(0, PER_AREA);
}
const all = [...new Set(Object.values(items).flat())];
const tr = await translateAll(all.flatMap((i) => [{ text: i.title, lang: i.lang }, { text: i.summary, lang: i.lang }]));
all.forEach((i, n) => {
  const a = tr[2 * n], b = tr[2 * n + 1];
  i.title_en = a.en; i.summary_en = b.en; i.mt = /^en\b/i.test(i.lang || "") ? null : (a.tool || b.tool || "untranslated");
});
saveCache();
if (!status.some((s) => s.ok)) { console.error("every news source failed"); process.exit(1); }
fs.mkdirSync("data/live", { recursive: true });
fs.writeFileSync("data/live/news.js", "window.ASAP_NEWS=" + JSON.stringify({ asof: stamp, sources: status, items }).replace(/<\//g, "<\\/") + ";\n");
status.forEach((s) => console.log(s.ok ? "ok  " : "FAIL", s.cc, s.source, s.ok ? s.n + " items" : s.error));
