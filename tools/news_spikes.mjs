// Reporting spikes: which countries and data sets are getting more reporting than normal in the last 24 hours.
// Run by .github/workflows/refresh-flood.yml right after tools/news_index.mjs, from that index's day files
// (data/live/news-index/<YYYY-MM-DD>.js). Writes data/live/spikes.js (window.OSAP_SPIKES), read by Today (assets/osap-spikes.js).
// A projection only: it holds nothing of its own and is rebuilt from the index every run. The method is in tools/spikes_lib.mjs.
// SPIKES_NOW=<ISO time> builds as of that time (for checking the method against past days).
import fs from "node:fs";
import { BASE_WINDOWS, windowOf, score, rankFlagged } from "./spikes_lib.mjs";

const DIR = "data/live/news-index", OUT = process.env.SPIKES_OUT || "data/live/spikes.js", TOP = 6;
const now = process.env.SPIKES_NOW ? Date.parse(process.env.SPIKES_NOW) : Date.now();
const W = BASE_WINDOWS + 1, oldest = now - W * 864e5;
const JS_HEAD = /^window\.\w+=window\.\w+\|\|\{\};window\.\w+\["[^"]+"\]=/;
const { topics } = JSON.parse(fs.readFileSync("tools/topics.json", "utf8"));
const SETS = new Map(topics.map((t) => [t.id, t.name])), SETCC = new Map(topics.map((t) => [t.id, t.countries || []]));

const totals = new Array(W).fill(0), cc = {}, ds = {}, recent = {};   // recent: place key -> newest window-0 rows
const bump = (o, k, w) => ((o[k] = o[k] || new Array(W).fill(0))[w]++);
let files = 0, rows = 0, future = 0;
for (const f of fs.existsSync(DIR) ? fs.readdirSync(DIR).sort() : []) {
  const m = f.match(/^(\d{4}-\d{2}-\d{2})\.js$/);
  // a day file holds headlines dated that UTC day: skip the days wholly outside the 15 windows
  if (!m || Date.parse(m[1] + "T23:59:59Z") < oldest) continue;
  let day;
  try { const t = fs.readFileSync(DIR + "/" + f, "utf8"), h = t.match(JS_HEAD); day = JSON.parse(t.slice(h ? h[0].length : 0).trim().replace(/;$/, "")); }
  catch (e) { console.error("index day unreadable:", f, e.message); continue; }
  files++;
  for (const r of Array.isArray(day) ? day : []) {
    if (!Array.isArray(r) || !r[1]) continue;
    const w = windowOf(Date.parse(String(r[1]).slice(0, 16) + "Z"), now);
    if (w < 0) { if (Date.parse(String(r[1]).slice(0, 16) + "Z") > now) future++; continue; }
    if (w >= W) continue;
    totals[w]++; rows++;
    const keys = [];
    for (const c of new Set(String(r[0] || "").split(","))) if (/^[a-z]{2,3}$/.test(c)) { bump(cc, c, w); keys.push("c:" + c); }
    for (const s of new Set(String(r[8] || "").split(","))) if (SETS.has(s)) { bump(ds, s, w); keys.push("s:" + s); }
    if (w === 0) for (const k of keys) (recent[k] = recent[k] || []).push(r);
  }
}

const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
function build(counts, kind) {
  const out = {};
  for (const [id, c] of Object.entries(counts)) {
    const s = score(c, totals);
    if (!s.n && !(s.exp >= 1)) continue;   // nothing now and nothing normally: not worth a line
    out[id] = { ...s, d: c.slice().reverse() };   // d: the 15 daily counts, oldest first, the last 24 hours last
    if (s.lvl === "spike" || s.lvl === "above") {
      // the newest headlines behind it, so the analyst can see what the reporting is about (each outlet's own headline and link)
      out[id].top = (recent[kind + ":" + id] || []).sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0)).slice(0, TOP)
        .filter((r) => /^https?:\/\//.test(r[5])).map((r) => [clip(r[2], 220), clip(r[4], 60), r[5], r[1], String(r[7] || "")]);
    }
  }
  return out;
}
const countries = build(cc, "c"), sets = build(ds, "s");
const flagged = [...rankFlagged(countries).map((id) => ["c", id]), ...rankFlagged(sets).map((id) => ["s", id])]
  .sort((a, b) => { const A = (a[0] === "c" ? countries : sets)[a[1]], B = (b[0] === "c" ? countries : sets)[b[1]];
    return (A.lvl === "spike" ? 0 : 1) - (B.lvl === "spike" ? 0 : 1) || B.z - A.z; });
const out = {
  asof: new Date(now).toISOString().slice(0, 16) + "Z", hours: 24, base: BASE_WINDOWS,
  totals: totals.slice().reverse(),   // all headlines in the pool per window, oldest first
  method: "Counts headlines in OSAP's news pool filed under each country or data set, in 24-hour windows ending at the build time. " +
    "Normal is the place's median share of all OSAP reporting over the previous 14 days, times the last 24 hours' total, so a weekend lull " +
    "or new outlets do not show as spikes. Typical range is normal plus or minus the usual day-to-day spread (robust: 1.4826 x median " +
    "absolute deviation, never less than the square root of normal). Spike: 10 or more headlines, at least 2x normal and 3 spreads above it. " +
    "Above normal: the same at 1.5x. Below normal: half of normal or less and 3 spreads under it, which is often a feed outage. " +
    "A place with headlines on fewer than 3 of the last 14 days is not judged. Headlines, not events: one story many outlets carry counts many times.",
  // each data set's name and the countries it is filed under (none: every country)
  sets: Object.fromEntries([...SETS].filter(([id]) => sets[id]).map(([id, name]) => [id, [name, SETCC.get(id)]])),
  flagged, countries, datasets: sets
};
fs.writeFileSync(OUT, "window.OSAP_SPIKES=" + JSON.stringify(out).replace(/<\//g, "<\\/") + ";\n");
const lv = (o, l) => Object.values(o).filter((p) => p.lvl === l).length;
console.log(`spikes: ${rows} headlines in ${files} index days (${future} dated in the future, left out); last 24 h ${totals[0]}; ` +
  `countries ${Object.keys(countries).length} (${lv(countries, "spike")} spike, ${lv(countries, "above")} above, ${lv(countries, "below")} below), ` +
  `data sets ${Object.keys(sets).length} (${lv(sets, "spike")} spike, ${lv(sets, "above")} above); ` + (fs.statSync(OUT).size / 1e3).toFixed(0) + " kB");
flagged.slice(0, 15).forEach(([k, id]) => { const p = (k === "c" ? countries : sets)[id]; console.log(`  ${p.lvl} ${k === "c" ? id : SETS.get(id)}: ${p.n} vs normal ${p.exp} (x${p.x}, z ${p.z})`); });
