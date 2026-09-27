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
    return { ...f, status: r.status, final: r.final !== f.url ? r.final : undefined, n: items.length, newest: dates[0] ? new Date(dates[0]).toISOString().slice(0, 16) : null,
      undated: items.length - dates.length, sample: items.slice(0, 2).map((i) => i.title.slice(0, 90)), ms: Date.now() - t0, head: items.length ? undefined : r.body.slice(0, 160) };
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
const results = (await pool(groups, 10, async (g) => { const r = []; for (const f of g) r.push(await check(f)); return r; })).flat();
// aggregators: a handful of countries only
const agg = [];
for (const [cc, q] of [["ml", "Mali"], ["so", "Somalia"], ["ht", "Haiti"], ["mn", "Mongolia"], ["bt", "Bhutan"]]) {
  agg.push(await check({ cc, outlet: "Google News search", url: "https://news.google.com/rss/search?q=" + encodeURIComponent(q) + "&hl=en&gl=US&ceid=US:en" }));
  agg.push(await check({ cc, outlet: "Bing News search", url: "https://www.bing.com/news/search?q=" + encodeURIComponent(q) + "&format=rss" }));
  await new Promise((r) => setTimeout(r, 1500));
}
// national met services' CAP feeds collected by the WMO/IFRC alert hub
let cap = null;
for (const u of ["https://cap-sources.s3.amazonaws.com/", "https://alert-hub-sources.s3.amazonaws.com/"]) {
  try { const r = await get(u, 20000); cap = { url: u, status: r.status, keys: [...r.body.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]).filter((k) => /rss\.xml$/.test(k)).slice(0, 800), head: r.body.slice(0, 200) }; if (cap.keys.length) break; }
  catch (e) { cap = { url: u, error: e.message }; }
}
fs.mkdirSync("probe-out", { recursive: true });
fs.writeFileSync("probe-out/news-probe.json", JSON.stringify({ at: new Date().toISOString(), results, agg, cap }, null, 1));
const ok = results.filter((r) => r.n > 0);
console.log("feeds answering with items:", ok.length, "/", results.length, "; countries:", new Set(ok.map((r) => r.cc)).size);
console.log("aggregators:", agg.map((a) => a.outlet[0] + ":" + a.cc + "=" + (a.n || a.error || a.status)).join(" "));
console.log("CAP sources:", cap && (cap.keys ? cap.keys.length : cap.error));
process.exit(0);
