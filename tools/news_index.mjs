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
import { compileViews, viewsOf } from "./view_reports_lib.mjs";

const DAYS = Number(process.env.NEWSIX_DAYS || 30), SUM = Number(process.env.NEWSIX_SUM || 0), OUT = "data/live/news-index.js", DIR = "data/live/news-index";
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";
const cutoff = new Date(Date.now() - DAYS * 864e5).toISOString().slice(0, 16);
// The data files open with "window.X=" (or "window.X=window.X||{};window.X[\"cc\"]="); only that opening is skipped, because a
// headline or summary can itself contain "window." and "=" (one Pakistan item carried page script text and broke the whole pool).
const JS_HEAD = /^(?:window\.\w+=window\.\w+\|\|\{\};)?window\.\w+(?:\["[^"]+"\])?=/;
const readJs = (f) => { const t = fs.readFileSync(f, "utf8"); return JSON.parse(t.slice(t.match(JS_HEAD)[0].length).trim().replace(/;$/, "")); };
const { topics } = JSON.parse(fs.readFileSync("tools/topics.json", "utf8"));
const T = compileTopics(topics);
// the tabs each headline is listed under in the app's Reports section (tools/view_reports.json)
const V = compileViews(JSON.parse(fs.readFileSync("tools/view_reports.json", "utf8"))), vcount = {};
// Only news that matters to an analyst or a special operations team in the country goes into the pool (tools/relevance.json);
// sport, celebrity, entertainment and lifestyle stay in each country's Local news tab and are not searched.
const REL = compileRelevance(JSON.parse(fs.readFileSync("tools/relevance.json", "utf8")), topics), relN = {}, dropped = [];

const pool = new Map();   // link -> { item, ccs:Set }
function add(i, ccs) {
  if (!i || !i.link || !/^https?:\/\//.test(i.link) || !(i.title || i.title_en)) return;
  const d = i.date || (i.first_seen || "").replace(" ", "T").replace(/Z$/, "");
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

const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const count = {};
const rows = [...pool.values()].sort((a, b) => (b.i.date > a.i.date ? 1 : b.i.date < a.i.date ? -1 : 0)).map(({ i, ccs, tp }) => {
  const en = i.title_en || i.title, orig = i.title && i.title !== en ? i.title : "", full = clip(i.summary_en || i.summary, 400), sum = SUM ? clip(full, SUM) : "";
  const rel = itemRelevance(REL, i);
  relN[rel] = (relN[rel] || 0) + 1;
  if (rel === "drop" || rel === "none") { dropped.push({ cc: [...ccs].join(","), why: rel === "drop" ? "sport, celebrity or lifestyle" : "no security, politics or public-safety word", title: en, outlet: i.outlet, date: i.date }); return null; }
  const ids = [...new Set([...tp, ...topicsOf(T, en + " \n " + orig + " \n " + full, [...ccs])])].filter((id) => T.some((t) => t.id === id));
  ids.forEach((id) => (count[id] = (count[id] || 0) + 1));
  // headline only (English and original): a summary often names side topics, which would list the story under the wrong tab
  const vw = viewsOf(V, en + " \n " + orig, [...ccs], ids);
  vw.forEach((id) => (vcount[id] = (vcount[id] || 0) + 1));
  const flags = (i.via === "search" ? "s" : "") + (i.nc ? "n" : "") + (i.state ? "g" : "") + (i.mt && i.mt !== "untranslated" ? "m" : "");
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
const seen = new Set(rows.map((r) => r[5]));
let carried = 0;
try {
  for (const f of fs.readdirSync(DIR)) {
    if (!/^\d{4}-\d{2}-\d{2}\.js$/.test(f) || f.slice(0, 10) < cutoff.slice(0, 10)) continue;
    let old; try { old = readJs(DIR + "/" + f); } catch (e) { console.error("index day unreadable:", f, e.message); continue; }
    for (const r of Array.isArray(old) ? old : []) {
      if (!Array.isArray(r) || r.length < 10 || !r[5] || seen.has(r[5]) || r[1] < cutoff) continue;
      seen.add(r[5]); rows.push(r); carried++;
      String(r[8] || "").split(",").filter(Boolean).forEach((id) => (count[id] = (count[id] || 0) + 1));
      String(r[9] || "").split(",").filter(Boolean).forEach((id) => (vcount[id] = (vcount[id] || 0) + 1));
    }
  }
} catch (e) {}
if (carried) console.log(`carried over ${carried} headlines already in the index whose history copy has rolled off`);
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
console.log(`news index: ${rows.length} headlines from ${files} country histories and ${tn} data-set search results, ${days.length} days, ` + (total / 1e6).toFixed(1) + " MB");
console.log("per data set:", out.topics.map((t) => t.id + " " + t.n).join(", "));
console.log("per tab:", out.views.map((v) => v.id + " " + v.n).join(", "));
