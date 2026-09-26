// Hourly official-warning refresh (run by .github/workflows/refresh-flood.yml, or by hand with Node 18+).
// Reads the RSS, Atom or CAP feeds (or JSON, with a "type" adapter) listed in tools/warning_feeds.json, keeps the newest items per area,
// translates non-English titles and summaries to English (tools/translate.mjs), and writes data/live/warnings.js.
// Every feed's result (ok, item count, or the error) is recorded so the page can show which feeds are live.
// Exit codes: 0 = at least one feed worked, 1 = every feed failed (the old file is left untouched).
import fs from "node:fs";
import { translateAll, saveCache } from "./translate.mjs";
import { parseFeed } from "./feedparse.mjs";

const TIMEOUT = 30000, PER_AREA = 30;
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";
const { feeds } = JSON.parse(fs.readFileSync("tools/warning_feeds.json", "utf8"));

async function getText(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 (AXIOM-ASAP hourly refresh)", accept: "application/rss+xml, application/xml, application/json, text/xml, */*" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}
// Agencies that publish JSON instead of RSS/Atom/CAP. Each adapter returns the same shape as parseFeed.
const strip = (h) => String(h || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const ADAPT = {
  // Hong Kong Observatory warning summary: { WTCSGNL: { name, code, actionCode, issueTime, updateTime, type? }, ... }
  hko: (j) => Object.values(j || {}).filter((w) => w && w.name && w.actionCode !== "CANCEL").map((w) => ({
    title: w.name + (w.type ? " (" + w.type + ")" : ""), summary: w.actionCode ? "Status: " + w.actionCode.toLowerCase() : "",
    date: w.updateTime || w.issueTime, link: "https://www.hko.gov.hk/en/wxinfo/dailywx/wxwarntoday.htm", severity: w.code || "" })),
  // China NMC: { data: { page: { list: [ { title, issuetime, url, alertid } ] } } }
  nmc: (j) => (((j || {}).data || {}).page || {}).list?.map((w) => ({ title: w.title || "", summary: "", date: (w.issuetime || "").replace(/\//g, "-").replace(" ", "T") + "+08:00",
    link: w.url ? (w.url.startsWith("http") ? w.url : "https://www.nmc.cn" + w.url) : "https://www.nmc.cn/publish/alarm.html", severity: /红色/.test(w.title) ? "red" : /橙色/.test(w.title) ? "orange" : "" })) || [],
  // MET Malaysia via data.gov.my: [ { warning_issue: { issued, title_en }, valid_from, valid_to, heading_en, text_en } ]
  metmy: (j) => (Array.isArray(j) ? j : (j && j.data) || []).map((w) => ({ title: w.heading_en || (w.warning_issue || {}).title_en || "", summary: strip(w.text_en).slice(0, 400),
    date: (w.warning_issue || {}).issued || w.valid_from, link: "https://www.met.gov.my/en/forecast/weather/warning/", severity: "",
    valid_to: w.valid_to })).filter((w) => w.title && (!w.valid_to || Date.parse(w.valid_to) > Date.now() - 864e5))
};
function iso(d) { const t = new Date(d); return isNaN(t) ? "" : t.toISOString().slice(0, 16); }

const status = [], items = {};
for (const f of feeds) {
  try {
    const body = await getText(f.url);
    let list = f.type ? ADAPT[f.type](JSON.parse(body)) : parseFeed(body);
    if (f.match) { const re = new RegExp(f.match); list = list.filter((i) => re.test(i.title + " " + i.summary)); }
    list = list.map((i) => ({ ...i, date: iso(i.date) })).sort((a, b) => (b.date > a.date ? 1 : -1)).slice(0, PER_AREA);
    (items[f.cc] = items[f.cc] || []).push(...list.map((i) => ({ ...i, agency: f.agency, lang: f.lang, feed: f.url })));
    status.push({ cc: f.cc, agency: f.agency, url: f.url, ok: true, n: list.length });
  } catch (e) {
    status.push({ cc: f.cc, agency: f.agency, url: f.url, ok: false, error: e.name === "AbortError" ? "timed out" : e.message });
  }
}
for (const cc of Object.keys(items)) items[cc] = items[cc].sort((a, b) => (b.date > a.date ? 1 : -1)).slice(0, PER_AREA);
const all = Object.values(items).flat();
const tr = await translateAll(all.flatMap((i) => [{ text: i.title, lang: i.lang }, { text: i.summary, lang: i.lang }]));
all.forEach((i, n) => {
  const a = tr[2 * n], b = tr[2 * n + 1];
  i.title_en = a.en; i.summary_en = b.en; i.mt = /^en\b/i.test(i.lang) ? null : (a.tool || b.tool || "untranslated");
});
saveCache();
if (!status.some((s) => s.ok)) { console.error("every warning feed failed"); status.forEach((s) => console.error(" ", s.agency, s.error)); process.exit(1); }
fs.mkdirSync("data/live", { recursive: true });
fs.writeFileSync("data/live/warnings.js", "window.ASAP_WARN=" + JSON.stringify({ asof: stamp, feeds: status, items }).replace(/<\//g, "<\\/") + ";\n");
status.forEach((s) => console.log(s.ok ? "ok  " : "FAIL", s.cc, s.agency, s.ok ? s.n + " items" : s.error));
