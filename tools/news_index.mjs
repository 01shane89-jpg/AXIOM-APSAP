// The news pool's search index (run by .github/workflows/refresh-flood.yml after the news and data-set steps).
// One pool: every national outlet's headlines (the rolling history in data/history/<cc>.js, which the news step keeps, and
// the latest data/live/news.js) plus the data-set searches (data/live/topics.js). Each headline of the last DAYS days is
// written once, tagged with the countries it is filed under and every data set in tools/topics.json whose words it contains.
// Writes one file per day, data/live/news-index/<YYYY-MM-DD>.js (OSAP_NEWSIX_DAY), and a small manifest,
// data/live/news-index.js (window.OSAP_NEWSIX: the days, their counts and the data sets). The app loads the manifest when
// news search is used, then the days newest first, showing matches as each day arrives. Rebuildable at any time from those
// files: it holds nothing of its own. Unchanged days are rewritten byte-identical, so a refresh only changes the recent ones.
import fs from "node:fs";
import { compileTopics, topicsOf, compileRelevance, itemRelevance } from "./topics_lib.mjs";
import { dropSuspectMt, mtSuspect } from "./mt_guard.mjs";
import { fixBingDate, bingDate } from "./news_date.mjs";
import { loadDates, cachedDate, applyPageDate } from "./news_pagedate.mjs";
// a search result's publication time from its own page (tools/news_pagedate.mjs; read by the news step), by link
const PAGE_DATES = loadDates(), NOW = Date.now();
import { compileViews, viewsOf } from "./view_reports_lib.mjs";
import { congressRows } from "./congress_rows.mjs";

const DAYS = Number(process.env.NEWSIX_DAYS || 30), SUM = Number(process.env.NEWSIX_SUM || 0), OUT = "data/live/news-index.js", DIR = "data/live/news-index";
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";
const cutoff = new Date(Date.now() - DAYS * 864e5).toISOString().slice(0, 16);
// A headline dated ahead of this run cannot be real: an outlet's feed with a bad date (on 2026-11-18 EBC Ethiopia rows dated
// 11 Dec, an El Nacional row dated 3 Dec and an NHC "no cyclones" note dated 19 Nov). The app searches the newest days first,
// so three such rows made three near-empty "days" that were all a default search read, and every search found nothing.
// A row more than FUTURE_H hours ahead is dated when OSAP first saw it, if it has that time; a carried row without it is left
// out (its real date is unknown). The tolerance allows a feed's local time read as UTC (up to UTC+14).
const FUTURE_H = Number(process.env.NEWSIX_FUTURE_H || 14), horizon = new Date(NOW + FUTURE_H * 36e5).toISOString().slice(0, 16);
let future = 0, futureSeen = 0;
// The data files open with "window.X=" (or "window.X=window.X||{};window.X[\"cc\"]="); only that opening is skipped, because a
// headline or summary can itself contain "window." and "=" (one Pakistan item carried page script text and broke the whole pool).
const JS_HEAD = /^(?:window\.\w+=window\.\w+\|\|\{\};)?window\.\w+(?:\["[^"]+"\])?=/;
const readJs = (f) => { const t = fs.readFileSync(f, "utf8"); return JSON.parse(t.slice(t.match(JS_HEAD)[0].length).trim().replace(/;$/, "")); };
const { topics } = JSON.parse(fs.readFileSync("tools/topics.json", "utf8"));
const T = compileTopics(topics);
// the tabs each headline is listed under in the app's Reports section (tools/view_reports.json)
const V = compileViews(JSON.parse(fs.readFileSync("tools/view_reports.json", "utf8"))), vcount = {};
// Only news that matters to an analyst or a security team in the country goes into the pool (tools/relevance.json);
// sport, celebrity, entertainment and lifestyle stay in each country's Local news tab and are not searched.
const REL = compileRelevance(JSON.parse(fs.readFileSync("tools/relevance.json", "utf8")), topics), relN = {}, dropped = [];

const pool = new Map();   // link -> { item, ccs:Set }
// a stored translation the model invented (tools/mt_guard.mjs) is not used: the row shows the original headline
function add(i, ccs) {
  if (i && i.mt) { i = { ...i }; dropSuspectMt(i); }
  if (i && i.via === "search" && !i.date_src) i = fixBingDate({ ...i });   // a Bing time stored before 2026-11-17 (tools/news_date.mjs)
  if (i && i.via === "search" && i.date_src !== "page") { const pd = cachedDate(PAGE_DATES, i.link); if (pd) { i = { ...i }; applyPageDate(i, pd, NOW); } }
  if (!i || !i.link || !/^https?:\/\//.test(i.link) || !(i.title || i.title_en)) return;
  let d = i.date || (i.first_seen || "").replace(" ", "T").replace(/Z$/, "");
  if (d && d > horizon) {
    const fs0 = (i.first_seen || "").replace(" ", "T").replace(/Z$/, "").slice(0, 16);
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(fs0) && fs0 <= horizon) { d = fs0; futureSeen++; } else { future++; return; }
  }
  if (!d || d < cutoff) return;
  const p = pool.get(i.link);
  if (p) { ccs.forEach((c) => p.ccs.add(c)); if (i.topics) i.topics.forEach((t) => p.tp.add(t)); if (!p.i.title_en && i.title_en) p.i = { ...i, date: d }; return; }
  pool.set(i.link, { i: { ...i, date: d }, ccs: new Set(ccs), tp: new Set(i.topics || []) });
}
let files = 0;
// one unreadable file is reported and skipped; it never stops the rest of the countries from being read
try { for (const f of fs.readdirSync("data/history")) if (/^[a-z]{2,3}\.js$/.test(f)) {
  try { const cc = f.slice(0, -3), h = readJs("data/history/" + f); (h.news || []).forEach((i) => add(i, [cc])); files++; }
  catch (e) { console.error("history unreadable:", f, e.message); }
} }
catch (e) { console.error("history folder unreadable:", e.message); }
try { const n = readJs("data/live/news.js"); for (const [cc, l] of Object.entries(n.items || {})) if (/^[a-z]{2,3}$/.test(cc)) l.forEach((i) => add(i, [cc])); }
catch (e) { console.error("news.js unreadable:", e.message); }
let tn = 0;
try { const t = readJs("data/live/topics.js"); (t.items || []).forEach((i) => { add(i, i.cc || []); tn++; }); }
catch (e) { console.error("topics.js unreadable (no data-set searches yet):", e.message); }
// official U.S. Congress floor votes (tools/dense_congress.mjs, kept in data/live/x/us.js by the dense step) are searched with the
// news, so a bill is found by the name it carries now: BAAJA (permitting reform) passed the Senate under H.R. 2347's old number
// and few headlines used its name. Outlet: the chamber's own record. Each vote is its own row (the bill page plus a #vote mark).
let cn = 0;
try {
  const t = fs.readFileSync("data/live/x/us.js", "utf8"), k = 'OSAP_XC["us"]=', x = JSON.parse(t.slice(t.indexOf(k) + k.length).trim().replace(/;\s*$/, ""));
  for (const r of congressRows(x.items)) { add(r, ["us"]); cn++; }
} catch (e) { console.error("Congress votes unreadable:", e.message); }
// and the major steps of every bill in recent days (tools/refresh_congress.mjs, data/live/congress/<congress>/recent.json):
// reported, passed a chamber by voice or consent, sent to the President, became law, vetoed. Outlet: the Library of Congress.
try {
  const cd = fs.readdirSync("data/live/congress").filter((d) => /^\d+$/.test(d)).sort((a, b) => b - a)[0];
  const r = cd ? JSON.parse(fs.readFileSync("data/live/congress/" + cd + "/recent.json", "utf8")) : { rows: [] };
  for (const x of r.rows || []) { add(x, ["us"]); cn++; }
} catch (e) { console.error("bill steps unreadable:", e.message); }

const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const count = {}, left = new Set();   // left: links this run's relevance check left out
const rows = [...pool.values()].sort((a, b) => (b.i.date > a.i.date ? 1 : b.i.date < a.i.date ? -1 : 0)).map(({ i, ccs, tp }) => {
  const en = i.title_en || i.title, orig = i.title && i.title !== en ? i.title : "", full = clip(i.summary_en || i.summary, 400), sum = SUM ? clip(full, SUM) : "";
  const rel = itemRelevance(REL, i);
  relN[rel] = (relN[rel] || 0) + 1;
  if (rel === "drop" || rel === "none") { left.add(i.link); dropped.push({ cc: [...ccs].join(","), why: rel === "drop" ? "sport, celebrity or lifestyle" : "no security, politics or public-safety word", title: en, outlet: i.outlet, date: i.date }); return null; }
  const ids = [...new Set([...tp, ...topicsOf(T, en + " \n " + orig + " \n " + full, [...ccs])])].filter((id) => T.some((t) => t.id === id));
  ids.forEach((id) => (count[id] = (count[id] || 0) + 1));
  // headline only (English and original): a summary often names side topics, which would list the story under the wrong tab
  const vw = viewsOf(V, en + " \n " + orig, [...ccs], ids);
  vw.forEach((id) => (vcount[id] = (vcount[id] || 0) + 1));
  // t: the time is the outlet's (a search result read as Pacific time or dated from its page), so a carried row is not moved again
  const flags = (i.via === "search" ? "s" : "") + (i.nc ? "n" : "") + (i.state ? "g" : "") + (i.mt && i.mt !== "untranslated" ? "m" : "") + (i.date_src ? "t" : "");
  return [[...ccs].join(","), i.date, clip(en, 300), clip(orig, 300), clip(i.outlet, 80), i.link, sum, flags, ids.join(","), vw.join(",")];
}).filter(Boolean);
console.log(`relevance: kept ${(relN.strong || 0) + (relN.keep || 0) + (relN.unchecked || 0)} (${relN.strong || 0} on a security or disaster word, ${relN.unchecked || 0} untranslated and unchecked), left out ${(relN.drop || 0) + (relN.none || 0)} ` +
  `(${relN.drop || 0} sport, celebrity or lifestyle; ${relN.none || 0} with no relevant word)`);
dropped.slice(0, 20).forEach((d) => console.log("  left out:", d.cc, "|", d.why, "|", String(d.title).slice(0, 100)));
// NEWSIX_DROPPED=<file>: write every left-out headline there for review (a diagnostic; not part of the app's data)
if (process.env.NEWSIX_DROPPED) fs.writeFileSync(process.env.NEWSIX_DROPPED, JSON.stringify(dropped, null, 0));
// Busy countries keep only their newest headlines in data/history (tools/history.mjs caps each file), which can be a few days'
// worth. Headlines this index already listed inside the window stay listed when their history copy has rolled off, so a
// search still covers the full DAYS days. Rows carried over keep the data sets and tabs they were given when first written.
// A headline this run checked and left out (tools/relevance.json) is not carried back from an earlier day, so a fixed word list
// also clears the days Story coverage and news search already read. Rows that rolled off are not rechecked: their summary,
// which may be what kept them, is gone.
const seen = new Set(rows.map((r) => r[5]));
let carried = 0, recheck = 0, mtDropped = 0, redated = 0;
try {
  for (const f of fs.readdirSync(DIR)) {
    if (!/^\d{4}-\d{2}-\d{2}\.js$/.test(f) || f.slice(0, 10) < cutoff.slice(0, 10)) continue;
    let old; try { old = readJs(DIR + "/" + f); } catch (e) { console.error("index day unreadable:", f, e.message); continue; }
    for (let r of Array.isArray(old) ? old : []) {
      if (!Array.isArray(r) || r.length < 10 || !r[5] || seen.has(r[5]) || r[1] < cutoff) continue;
      if (r[1] > horizon) { future++; continue; }   // dated ahead of now (see FUTURE_H): its real date is unknown
      if (left.has(r[5])) { seen.add(r[5]); recheck++; continue; }
      // a carried row's machine translation passes today's guard too: one it fails shows the original headline (on 2026-11-16,
      // 1,600 stored rows carried a casualty count or a death the original does not give, "Kill 10" for a German report of a
      // drone attack among them, kept from before the guard caught them)
      if (/m/.test(r[7] || "") && r[3] && mtSuspect(r[3], r[2])) { r = [...r]; r[2] = r[3]; r[3] = ""; r[7] = String(r[7]).replace(/m/g, ""); mtDropped++; }
      // a carried Bing search row written before 2026-11-17 still has Bing's Pacific time labelled GMT: moved once, then marked t
      if (/s/.test(r[7] || "") && !/t/.test(r[7] || "") && /Bing/.test(r[4] || "")) { const d = bingDate(r[1] + ":00Z"); if (d) { r = [...r]; r[1] = d.slice(0, 16); r[7] = String(r[7] || "") + "t"; redated++; } }
      // and its page's own time, once the news step has read it
      if (/s/.test(r[7] || "")) { const pd = cachedDate(PAGE_DATES, r[5]), o = { date: r[1] }; if (pd && applyPageDate(o, pd, NOW)) { r = [...r]; r[1] = o.date; if (!/t/.test(r[7])) r[7] += "t"; redated++; } }
      seen.add(r[5]); rows.push(r); carried++;
      String(r[8] || "").split(",").filter(Boolean).forEach((id) => (count[id] = (count[id] || 0) + 1));
      String(r[9] || "").split(",").filter(Boolean).forEach((id) => (vcount[id] = (vcount[id] || 0) + 1));
    }
  }
} catch (e) {}
if (future || futureSeen) console.log(`future dates: ${futureSeen} headlines dated ahead of now were dated when first seen, ${future} with no usable date were left out`);
if (carried) console.log(`carried over ${carried} headlines already in the index whose history copy has rolled off`);
if (redated) console.log(`search results: ${redated} carried Bing rows moved from Pacific time to UTC`);
if (mtDropped) console.log(`machine translation: ${mtDropped} carried headlines failed the guard and show their original words`);
if (recheck) console.log(`relevance: ${recheck} headlines already in the index left out by this run's check`);
const byDay = {};
rows.forEach((r) => (byDay[r[1].slice(0, 10)] = byDay[r[1].slice(0, 10)] || []).push(r));
fs.mkdirSync(DIR, { recursive: true });
const days = Object.keys(byDay).sort().reverse();
for (const d of days) {
  byDay[d].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : a[5] < b[5] ? -1 : 1));
  const f = DIR + "/" + d + ".js", txt = "window.OSAP_NEWSIX_DAY=window.OSAP_NEWSIX_DAY||{};window.OSAP_NEWSIX_DAY[" + JSON.stringify(d) + "]=" + JSON.stringify(byDay[d]).replace(/<\//g, "<\\/") + ";\n";
  if (!fs.existsSync(f) || fs.readFileSync(f, "utf8") !== txt) fs.writeFileSync(f, txt);
}
for (const f of fs.readdirSync(DIR)) if (/\.js$/.test(f) && !byDay[f.slice(0, -3)]) fs.rmSync(DIR + "/" + f);
const out = { asof: stamp, days: days.map((d) => ({ d, n: byDay[d].length })), fields: ["cc", "date", "title", "orig", "outlet", "link", "summary", "flags", "topics", "views"],
  flags: { s: "news search result", n: "non-commercial terms", g: "state media", m: "machine translated" },
  topics: T.map((t) => ({ id: t.id, name: t.name, words: (topics.find((x) => x.id === t.id) || {}).words || [], n: count[t.id] || 0, ...(t.cc.size ? { countries: [...t.cc] } : {}) })),
  views: V.map((v) => ({ id: v.id, n: vcount[v.id] || 0 })),
  relevance: { kept: (relN.strong || 0) + (relN.keep || 0) + (relN.unchecked || 0), left_out: (relN.drop || 0) + (relN.none || 0) } };
fs.writeFileSync(OUT, "window.OSAP_NEWSIX=" + JSON.stringify(out).replace(/<\//g, "<\\/") + ";\n");
const total = days.reduce((s, d) => s + fs.statSync(DIR + "/" + d + ".js").size, 0);
console.log(`news index: ${rows.length} headlines from ${files} country histories, ${tn} data-set search results and ${cn} Congress floor votes and bill steps, ${days.length} days, ` + (total / 1e6).toFixed(1) + " MB");
console.log("per data set:", out.topics.map((t) => t.id + " " + t.n).join(", "));
console.log("per tab:", out.views.map((v) => v.id + " " + v.n).join(", "));
