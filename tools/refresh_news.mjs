// Hourly local-news refresh (run by .github/workflows/refresh-flood.yml, or by hand with Node 18+).
// Two sources per area: GDELT (local-language news worldwide, filtered to security, disaster and unrest themes)
// and national outlets' RSS feeds (tools/news_feeds.json), with a news search where a country has no working outlet. Headlines are machine-translated to English
// (tools/translate.mjs) with the original kept. Items are unverified reports: a link, an outlet and a date.
// Writes data/live/news.js. Exit codes: 0 = at least one source worked, 1 = all failed (old file left untouched).
import fs from "node:fs";
import { translateAll, saveCache } from "./translate.mjs";
import { updateHistory } from "./history.mjs";
import { parseFeed } from "./feedparse.mjs";
import { loadGazetteer, placeIn } from "./gazetteer.mjs";

const TIMEOUT = 30000, PER_AREA = 40, GDELT_GAP = Number(process.env.GDELT_GAP_MS || 12000);
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
const { feeds } = JSON.parse(fs.readFileSync("tools/news_feeds.json", "utf8"));
// About 330 feeds: read several hosts at once but never more than one request at a time to the same host.
const FEED_TIMEOUT = 20000, LANES = 8;
async function getFeed(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), FEED_TIMEOUT);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 (AXIOM-ASAP hourly refresh)", accept: "application/rss+xml, application/xml, text/xml, */*" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}
// Search-engine fallbacks are read only when the site's robots.txt allows the path for every user agent.
const robotsCache = {};
async function robotsAllow(url) {
  const u = new URL(url);
  if (!(u.origin in robotsCache)) robotsCache[u.origin] = getFeed(u.origin + "/robots.txt").catch((e) => (/HTTP 4/.test(e.message) ? "" : null));
  const txt = await robotsCache[u.origin];
  if (txt === null) return false;                       // robots.txt unreachable: do not assume permission
  let on = false, best = { len: -1, allow: true };
  const path = u.pathname + u.search;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim(), m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") { on = v === "*"; continue; }
    if (!on || (k !== "allow" && k !== "disallow") || !v) continue;
    const re = new RegExp("^" + v.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    if (re.test(path) && v.length > best.len) best = { len: v.length, allow: k === "allow" };
  }
  return best.allow;
}
// Bing wraps each result in a click-through link; keep the publisher's own address and name instead.
function unwrap(link) {
  try { const u = new URL(link); if (/bing\.com$/.test(u.hostname) && u.searchParams.get("url")) return u.searchParams.get("url"); } catch (e) {}
  return link;
}
async function readFeed(f) {
  try {
    if (f.search && !(await robotsAllow(f.url))) throw new Error("robots.txt does not allow this search");
    const list = parseFeed(await getFeed(f.url)).slice(0, 25).map((i) => {
      const link = f.search ? unwrap(i.link) : i.link;
      let outlet = f.outlet;
      if (f.search) { try { outlet = (i.source || new URL(link).hostname.replace(/^www\./, "")) + " (via Bing News search)"; } catch (e) {} }
      const o = { title: i.title, summary: i.summary.slice(0, 280), date: iso(i.date), link, outlet, lang: f.lang, via: f.search ? "search" : "RSS", state: !!f.state };
      if (f.nc) o.nc = true;
      return o;
    });
    push(f.cc, list); status.push({ cc: f.cc, source: f.outlet, url: f.url, ok: true, n: list.length });
  } catch (e) { status.push({ cc: f.cc, source: f.outlet, url: f.url, ok: false, error: e.name === "AbortError" ? "timed out" : e.message }); }
}
const byHost = {};
for (const f of feeds) { let h = f.url; try { h = new URL(f.url).hostname; } catch (e) {} (byHost[h] = byHost[h] || []).push(f); }
const hosts = Object.values(byHost);
await Promise.all(Array.from({ length: LANES }, async () => { for (let q; (q = hosts.shift()); ) for (const f of q) await readFeed(f); }));
// Okinawa shares Japan's outlets: keep the Japanese items that name the islands
if (items.jp) push("oki", items.jp.filter((i) => /okinawa|naha|ryukyu|miyako|ishigaki|yonaguni|沖縄|那覇|宮古|石垣|与那国/i.test(i.title + " " + i.summary)));   // plus Okinawa's own outlets
for (const cc of Object.keys(items)) {
  const seen = new Set();
  items[cc] = items[cc].filter((i) => !seen.has(i.link) && seen.add(i.link)).sort((a, b) => (b.date > a.date ? 1 : -1)).slice(0, PER_AREA);
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
  const need = Object.values(items).flat().filter((i) => !i.img && /^https:\/\//.test(i.link || "")).slice(0, OG_MAX);
  let got = 0;
  for (let k = 0; k < need.length; k += 8) {
    const res = await Promise.all(need.slice(k, k + 8).map((i) => ogImage(i.link)));
    res.forEach((u, j) => { if (u) { need[k + j].img = u; got++; } });
  }
  console.log("article-page pictures:", got, "of", need.length, "items without a feed picture");
}
const all = [...new Set(Object.values(items).flat())];
const tr = await translateAll(all.flatMap((i) => [{ text: i.title, lang: i.lang }, { text: i.summary, lang: i.lang }]));
all.forEach((i, n) => {
  const a = tr[2 * n], b = tr[2 * n + 1];
  i.title_en = a.en; i.summary_en = b.en; i.mt = /^en\b/i.test(i.lang || "") ? null : (a.tool || b.tool || "untranslated");
});
saveCache();
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
    for (const t of texts) { const r = placeIn(gz, t, [cc]); if (r && (!g || (r.prec === "approx" && g.prec !== "approx"))) g = r; if (g && g.prec === "approx") break; }
    i.geo = g ? { n: g.name, la: g.lat, lo: g.lon, p: g.prec } : null;
    if (g) placed++;
  }
  console.log("placed", placed, "of", all.length, "items by name");
} catch (e) { console.error("gazetteer unavailable, items left unplaced:", e.message); }
if (!status.some((s) => s.ok)) { console.error("every news source failed"); process.exit(1); }
fs.mkdirSync("data/live", { recursive: true });
fs.writeFileSync("data/live/news.js", "window.ASAP_NEWS=" + JSON.stringify({ asof: stamp, sources: status, items }).replace(/<\//g, "<\\/") + ";\n");
try { updateHistory("news", items, stamp); } catch (e) { console.error("history not updated:", e.message); }
status.forEach((s) => console.log(s.ok ? "ok  " : "FAIL", s.cc, s.source, s.ok ? s.n + " items" : s.error));
console.log("items with a picture:", Object.entries(items).map(([cc, l]) => cc + " " + l.filter((i) => i.img).length + "/" + l.length).join(", "));
