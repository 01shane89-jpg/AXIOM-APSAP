// Checks candidate news feeds (tools/news_candidates.json) and a few no-key aggregators from GitHub Actions, where the
// hourly job runs. Writes probe-out/news-probe.json only; never touches data/. Run with only=probe-news.
import fs from "node:fs";
import { parseFeed } from "./feedparse.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 (AXIOM-OSAP feed check)";
async function get(url, ms = 15000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": UA, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" } });
    const body = await r.text();
    return { status: r.status, final: r.url, body };
  } finally { clearTimeout(t); }
}
async function check(f) {
  const t0 = Date.now();
  try {
    const r = await get(f.url);
    const items = r.status < 400 ? parseFeed(r.body) : [];
    const dates = items.map((i) => Date.parse(i.date)).filter((d) => !isNaN(d)).sort((a, b) => b - a);
    return { ...f, status: r.status, final: r.final !== f.url ? r.final : undefined, n: items.length, newest: dates[0] ? new Date(dates[0]).toISOString().slice(0, 16) : null, last7: dates.filter((d) => d > Date.now() - 7 * 864e5).length, oldest: dates.length ? new Date(dates[dates.length - 1]).toISOString().slice(0, 16) : null,
      undated: items.length - dates.length, sample: items.slice(0, 5).map((i) => i.title.slice(0, 90)), ms: Date.now() - t0, head: items.length ? undefined : r.body.slice(0, 160) };
  } catch (e) { return { ...f, error: e.name === "AbortError" ? "timed out" : e.message, ms: Date.now() - t0 }; }
}
async function pool(list, conc, fn) {
  const out = new Array(list.length); let i = 0;
  await Promise.all(Array.from({ length: conc }, async () => { while (i < list.length) { const k = i++; out[k] = await fn(list[k]); } }));
  return out;
}
const { feeds } = JSON.parse(fs.readFileSync("tools/news_candidates.json", "utf8"));
// different hosts in parallel; each host's candidates stay sequential
const byHost = {}; for (const f of feeds) { const h = new URL(f.url).host; (byHost[h] = byHost[h] || []).push(f); }
const groups = Object.values(byHost);
const CAP_ONLY = process.env.CAP_ONLY === "1";
const results = CAP_ONLY ? [] : (await pool(groups, 10, async (g) => { const r = []; for (const f of g) { r.push(await check(f)); if (/bing\.com/.test(f.url)) await new Promise((z) => setTimeout(z, 2000)); } return r; })).flat();
// aggregators: a handful of countries only
const agg = [];
for (const [cc, q] of CAP_ONLY ? [] : [["ml", "Mali"], ["so", "Somalia"], ["ht", "Haiti"], ["mn", "Mongolia"], ["bt", "Bhutan"]]) {
  agg.push(await check({ cc, outlet: "Google News search", url: "https://news.google.com/rss/search?q=" + encodeURIComponent(q) + "&hl=en&gl=US&ceid=US:en" }));
  agg.push(await check({ cc, outlet: "Bing News search", url: "https://www.bing.com/news/search?q=" + encodeURIComponent(q) + "&format=rss" }));
  await new Promise((r) => setTimeout(r, 1500));
}
// national met services' CAP feeds collected by the WMO/IFRC alert hub
// Every source folder in the bucket (one per agency and language, paged 1,000 at a time), then each English
// folder's rss.xml (or the only language an agency publishes in) checked for items and their age.
let cap = { url: "https://cap-sources.s3.amazonaws.com/", prefixes: [], feeds: [] };
try {
  for (let tok = "", n = 0; n < (process.env.SKIP_CAP === "0" ? 20 : 0); n++) {
    const r = await get(cap.url + "?list-type=2&delimiter=/" + (tok ? "&continuation-token=" + encodeURIComponent(tok) : ""), 20000);
    cap.prefixes.push(...[...r.body.matchAll(/<Prefix>([^<]+)\/<\/Prefix>/g)].map((m) => m[1]));
    const nt = r.body.match(/<NextContinuationToken>([^<]+)</);
    if (!nt) break; tok = nt[1];
  }
  const byAgency = {};
  for (const p of cap.prefixes) { const m = p.match(/^(.+)-([a-z]{2,3})$/); if (m) (byAgency[m[1]] = byAgency[m[1]] || []).push(m[2]); }
  const pick = Object.entries(byAgency).map(([a, langs]) => a + "-" + (langs.includes("en") ? "en" : langs[0]));
  cap.feeds = await pool(pick, 8, (k) => check({ cc: k.slice(0, 2), key: k, url: cap.url + k + "/rss.xml" }));
} catch (e) { cap.error = e.message; }
fs.mkdirSync("probe-out", { recursive: true });
fs.writeFileSync("probe-out/news-probe.json", JSON.stringify({ at: new Date().toISOString(), results, agg, cap }, null, 1));
const ok = results.filter((r) => r.n > 0);
for (const r of results) console.log("FEED", r.cc, r.kind || "", r.status || r.error, "n=" + (r.n || 0), "last7=" + (r.last7 || 0), "newest=" + r.newest, r.url, "|", (r.sample || []).slice(0, 2).join(" / "));
console.log("feeds answering with items:", ok.length, "/", results.length, "; countries:", new Set(ok.map((r) => r.cc)).size);
console.log("aggregators:", agg.map((a) => a.outlet[0] + ":" + a.cc + "=" + (a.n || a.error || a.status)).join(" "));
console.log("CAP sources:", cap.prefixes.length, "folders,", cap.feeds.filter((f) => f.n > 0).length, "feeds with items", cap.error || "");

// PROBE BRANCH ONLY: feed discovery for outlets whose guessed feed failed. Reads the home page, collects
// <link rel="alternate"> feed links and a few common feed paths, checks each, and notes the page's size and link count.
{
  const { discover = [] } = JSON.parse(fs.readFileSync("tools/news_candidates.json", "utf8"));
  const COMMON = ["/feed", "/feed/", "/rss", "/rss.xml", "/rss/", "/index.xml", "/feed.xml", "/atom.xml", "/rss/all.xml", "/rss/news.xml"];
  const out = await pool(discover, 8, async (d) => {
    const r = { ...d, tried: [] };
    try {
      const h = await get(d.home, 20000);
      r.status = h.status; r.final = h.final; r.bytes = h.body.length; r.links = (h.body.match(/<a\s/gi) || []).length;
      r.title = (h.body.match(/<title[^>]*>([^<]{0,120})/i) || [])[1];
      const alts = [...h.body.matchAll(/<link[^>]+>/gi)].map((m) => m[0]).filter((t) => /application\/(rss|atom)\+xml/i.test(t))
        .map((t) => (t.match(/href=["']([^"']+)/i) || [])[1]).filter(Boolean);
      const anchors = [...h.body.matchAll(/href=["']([^"']*(?:rss|feed)[^"']*)["']/gi)].map((m) => m[1]).slice(0, 12);
      const base = h.final || d.home, urls = new Set();
      for (const u of [...alts, ...anchors, ...COMMON]) { try { urls.add(new URL(u.replace(/&amp;/g, "&"), base).href); } catch (e) {} }
      for (const u of [...urls].slice(0, 16)) {
        const c = await check({ url: u });
        r.tried.push({ url: u, status: c.status || c.error, n: c.n, last7: c.last7, newest: c.newest, sample: (c.sample || []).slice(0, 2) });
      }
    } catch (e) { r.error = e.name === "AbortError" ? "timed out" : e.message; }
    return r;
  });
  fs.writeFileSync("probe-out/discover.json", JSON.stringify(out, null, 1));
  for (const d of out) { console.log("HOME", d.cc, d.home, d.status || d.error); for (const t of d.tried) if (t.n) console.log("  DISC", d.cc, t.url, "n=" + t.n, "last7=" + t.last7, "newest=" + t.newest, "|", (t.sample || []).join(" / ")); }
}
process.exit(0);
