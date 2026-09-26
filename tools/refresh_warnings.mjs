// Hourly official-warning refresh (run by .github/workflows/refresh-flood.yml, or by hand with Node 18+).
// Reads the RSS, Atom or CAP feeds listed in tools/warning_feeds.json, keeps the newest items per area,
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
    const r = await fetch(url, { signal: ctl.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; AXIOM-ASAP warnings refresh)" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}
function iso(d) { const t = new Date(d); return isNaN(t) ? "" : t.toISOString().slice(0, 16); }

const status = [], items = {};
for (const f of feeds) {
  try {
    let list = parseFeed(await getText(f.url));
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
