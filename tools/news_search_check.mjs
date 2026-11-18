// Checks the real news search index (data/live/news-index.js and its day files, built by tools/news_index.mjs) the way the
// app's news search reads it (assets/osap-news.js): the newest days first, a day after tomorrow (UTC) skipped, tomorrow read
// but not counted, FIRST_DAYS counted days. It runs real searches on those days and fails when search would come back empty.
// Why: on 2026-11-18 three misdated feed rows made the three newest "days" (12 headlines in all), so every search in the app
// found nothing, and no check looked at the real index (the tests use small stand-in data).
// Run by .github/workflows/refresh-flood.yml right after the index is built, and by hand: node tools/news_search_check.mjs
// Exit 1 and a GitHub error annotation on a failure. Read-only.
import fs from "node:fs";

const DIR = process.env.NEWSIX_DIR || "data/live", FIRST_DAYS = 3;
const MIN_ROWS = Number(process.env.NEWSQ_MIN_ROWS || 20000);   // a normal day holds 25,000 to 48,000 headlines
// words that are in every busy country's security news every day; "outage" is reported but does not fail (some weeks have none)
const PROBES = [
  { cc: "us", q: "police", min: 5 }, { cc: "us", q: "outage", min: 0 }, { cc: "gb", q: "police", min: 5 },
  { cc: "in", q: "police", min: 5 }, { cc: "au", q: "police", min: 3 }, { cc: "ph", q: "police", min: 3 },
  { cc: "", q: "attack", min: 20 },
];
const readJs = (f) => { const t = fs.readFileSync(f, "utf8"); const i = t.lastIndexOf("]=") > 0 && /^window\.OSAP_NEWSIX_DAY/.test(t) ? t.indexOf("]=") + 2 : t.indexOf("=") + 1; return JSON.parse(t.slice(i).trim().replace(/;$/, "")); };
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const fails = [], notes = [];
const fail = (m) => { fails.push(m); console.log("FAIL " + m); };

let man;
try { man = readJs(DIR + "/news-index.js"); } catch (e) { fail("the index manifest could not be read: " + e.message); }
if (man) {
  const ymd = (ms) => new Date(ms).toISOString().slice(0, 10), today = ymd(Date.now()), tom = ymd(Date.now() + 864e5);
  const late = man.days.filter((d) => d.d > tom);
  if (late.length) fail("days after tomorrow in the manifest (a feed's bad dates; the app skips them): " + late.map((d) => d.d + " (" + d.n + ")").join(", "));
  const days = man.days.filter((d) => d.d <= tom).sort((a, b) => (a.d < b.d ? 1 : -1));
  const read = []; let c = 0;
  for (const d of days) { if (c >= FIRST_DAYS) break; read.push(d); if (d.d <= today) c++; }
  const rows = [];
  for (const d of read) { try { rows.push(...readJs(DIR + "/news-index/" + d.d + ".js")); } catch (e) { fail("day " + d.d + " could not be read: " + e.message); } }
  console.log(`index as of ${man.asof}; a first search reads ${read.map((d) => d.d + " (" + d.n + ")").join(", ")}: ${rows.length} headlines`);
  if (rows.length < MIN_ROWS) fail(`a first search reads only ${rows.length} headlines (under ${MIN_ROWS})`);
  const asof = Date.parse(String(man.asof).replace(" ", "T"));
  if (isFinite(asof) && Date.now() - asof > 6 * 36e5) fail("the index is " + Math.round((Date.now() - asof) / 36e5) + " hours old");
  const re = (q) => new RegExp("(?<![\\p{L}\\p{N}])" + fold(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u");
  for (const p of PROBES) {
    const r = re(p.q);
    const n = rows.filter((x) => (!p.cc || String(x[0] || "").split(",").includes(p.cc)) && r.test(fold(x[2] + " \n " + x[3] + " \n " + x[4]))).length;
    const line = `"${p.q}" in ${p.cc ? p.cc.toUpperCase() : "every country"}: ${n} headlines`;
    if (n < p.min) fail(line + " (expected at least " + p.min + ")"); else console.log("ok   " + line);
  }
}
if (fails.length) { console.log(`::error title=News search check::${fails.length} failed: ${fails.join("; ").replace(/[\r\n%]/g, " ")}`); process.exit(1); }
console.log("news search check ok");
