// Claim ledger (tools/ledger_lib.mjs has the rules, ledger-v1): disputed stories followed past Go deeper's 72 hours, up to 30 days.
// Run after tools/news_stories.mjs (it reads the threads that step just wrote), by .github/workflows/refresh-flood.yml or by hand
// with Node 20+ from the repo root. No network.
// Reads: data/live/threads/<cc>.js (which stories to follow), data/live/news-index/<day>.js (the headlines, about 30 days),
// the conflict tabs (data/live/conflicts/<id>.js, tools/conflicts.json: strike reports a ledger carries, for the sensor picture).
// Writes: data/live/ledger/<cc>.js, window.OSAP_LEDGER { schema, rules, asof, method, cc, days, ledgers }, one file per country
// with ledgers (fetched when Story coverage or Go deeper opens for that country), and data/live/ledger-state.json, this job's own memory (the seeds:
// which stories to follow and by which words; the page never reads it). Delete the state and the next run starts again from the
// threads in the window. Logs carry counts only.
//   LEDGER_IX (default data/live/news-index), LEDGER_THREADS (data/live/threads), LEDGER_OUT (data/live/ledger), LEDGER_END (now)
import fs from "node:fs";
import { LSCHEMA, RULES, DAYS, KEEP_DAYS, SHARP, SHARP_MIN, PER_COUNTRY, MAX_SEEDS, qualifies, matchSeed, newSeed, joins, chain, build } from "./ledger_lib.mjs";
import { stems } from "./threads_lib.mjs";
import { outletBook, fromRow } from "./stories_lib.mjs";
import { ccsInText } from "./geo_cc.mjs";
import { compileRelevance, relevance } from "./topics_lib.mjs";
import { eligible } from "./sensor_lib.mjs";
import { COMMERCIAL } from "./nc_strip.mjs";

const IX = process.env.LEDGER_IX || "data/live/news-index", TH = process.env.LEDGER_THREADS || "data/live/threads";
const OUT = process.env.LEDGER_OUT || "data/live/ledger", STATE = OUT.replace(/\/?$/, "") + "-state.json";
const END = process.env.LEDGER_END ? Date.parse(process.env.LEDGER_END) : Date.now();
const stamp = new Date(END).toISOString().slice(0, 16).replace("T", " ") + "Z";
const HEAD = /^(?:window\.\w+=window\.\w+\|\|\{\};)?window\.\w+(?:\["[^"]+"\])?=/;
const readJs = (f) => { const t = fs.readFileSync(f, "utf8"); return JSON.parse(t.slice(t.match(HEAD)[0].length).trim().replace(/;$/, "")); };
const ms = (d) => Date.parse(String(d || "").slice(0, 16) + "Z");
const t0 = Date.now();
const METHOD = "A ledger follows one disputed story (reports that give different figures, or headlines that deny or dispute it) for up to " + DAYS +
  " days of the headlines OSAP reads, past the 72 hours of Go deeper. A headline joins when it shares the story's distinctive words, the same rule as Go deeper, and reports after more than 3 days of silence are left out as likely another event. " +
  "Officials' lines are matched by their words (says, ministry, spokesperson ...) and are their claims. \"Deny or dispute\" is a fixed word match, figures are read from headlines by fixed rules, and strike reports come from the conflict tabs. " +
  "All of it is machine word matching, not AI and not an analyst: a report can be missed or wrongly joined, and an event that repeats (daily strikes on one city) can join reports of separate days. OSAP does not rate claims true or false.";

// 1. the stories to follow: the seeds kept from earlier runs, and every qualifying thread now in the window
let state = { seeds: [] };
try { const s = JSON.parse(fs.readFileSync(STATE, "utf8")); if (s && Array.isArray(s.seeds)) state = s; } catch (e) {}
let R = null; try { R = compileRelevance(JSON.parse(fs.readFileSync("tools/relevance.json", "utf8"))); } catch (e) { console.error("ledger: no relevance rules:", e.message); }
const rel = R ? (x) => relevance(R, x) : null;
const seeds = state.seeds.filter((s) => s && s.id && s.cc && Array.isArray(s.w) && isFinite(ms(s.last)) && ms(s.last) >= END - KEEP_DAYS * 864e5);
const live = new Map(); // seed id -> the thread now in the window (its rows always count)
let nNew = 0, nThreads = 0;
for (const f of fs.existsSync(TH) ? fs.readdirSync(TH).filter((f) => /^[a-z]{2,3}\.js$/.test(f)).sort() : []) {
  let file; try { file = readJs(TH + "/" + f); } catch (e) { console.error("ledger: unreadable threads", f); continue; }
  const cc = f.slice(0, -3);
  for (const t of file.threads || []) {
    nThreads++;
    if (!qualifies(t, rel)) continue;
    let s = matchSeed(seeds, cc, t.w, END);
    if (s && live.has(s.id)) continue; // two threads continue one seed: the bigger (listed first) keeps it
    if (!s) { s = newSeed(t, cc, stamp); seeds.push(s); nNew++; }
    s.thread = t.id; s.t = String(t.t || s.t); s.u = String(t.u || s.u); if (String(t.d) > String(s.last)) s.last = t.d;
    live.set(s.id, { cc, t });
  }
}
// 2. one pass over the index: every headline that shares two or more of a seed's words, and how often each seed word appears in
//    all of the index's headlines (a word is sharp when it is rare everywhere: "earthquake", "killed" or "Friday" are not, so the
//    next quake or the next strike does not join an old one; tools/ledger_lib.mjs SHARP)
const byWord = new Map();
seeds.forEach((s, si) => s.w.forEach((x) => { if (!byWord.has(x)) byWord.set(x, []); byWord.get(x).push(si); }));
const df = new Map(), cand = new Map(); // word -> headlines carrying it; seed index -> [report]
const fromDay = new Date(END - DAYS * 864e5).toISOString().slice(0, 10);
const days = fs.existsSync(IX) ? fs.readdirSync(IX).filter((f) => /^\d{4}-\d{2}-\d{2}\.js$/.test(f) && f.slice(0, 10) >= fromDay).sort() : [];
let nRows = 0;
for (const f of days) {
  let day; try { day = readJs(IX + "/" + f); } catch (e) { console.error("ledger: unreadable", f); continue; }
  for (const r of Array.isArray(day) ? day : []) {
    if (!Array.isArray(r) || !r[0] || !r[2] || !r[5]) continue;
    if (COMMERCIAL && /n/.test(String(r[7] || ""))) continue;
    nRows++;
    const st = stems(String(r[2]));
    for (const x of st) if (byWord.has(x)) df.set(x, (df.get(x) || 0) + 1);
    const hits = new Map();
    for (const x of st) for (const si of byWord.get(x) || []) hits.set(si, (hits.get(si) || 0) + 1);
    let rep = null;
    for (const [si, n] of hits) {
      if (n < 2) continue;
      const s = seeds[si];
      if (!rep) { rep = fromRow(r); rep.ms = ms(rep.date); rep.st = st; rep.named = null; }
      if (!isFinite(rep.ms) || rep.ms > END + 14 * 36e5) continue;
      // a headline about the country: filed under it, or naming it (as Story coverage files an outlet elsewhere)
      if (!rep.ccs.includes(s.cc)) { if (!rep.named) rep.named = ccsInText(rep.title); if (!rep.named.includes(s.cc) && !(s.cc === "oki" && rep.named.includes("jp"))) continue; }
      if (!cand.has(si)) cand.set(si, []);
      cand.get(si).push(rep);
    }
  }
}
// 3. strike reports on the conflict tabs, by headline link (tools/sensor_lib.mjs eligible: a violent kind, a pin, a fingerprint)
const strike = new Map();
try {
  for (const c of JSON.parse(fs.readFileSync("tools/conflicts.json", "utf8")).conflicts || []) for (const sfx of [".js", ".older.js"]) {
    const p = "data/live/conflicts/" + c.id + sfx; if (!fs.existsSync(p)) continue;
    let o; try { const t = fs.readFileSync(p, "utf8"); o = JSON.parse(t.slice(t.indexOf("={") + 1).replace(/;\s*$/, "")); } catch (e) { continue; }
    for (const i of o.items || []) if (i && i.link && !strike.has(i.link) && eligible(i)) strike.set(i.link, [c.id, i.fp, +i.geo.la.toFixed(4), +i.geo.lo.toFixed(4), String(i.date).slice(0, 16), i.geo.p, i.kind]);
  }
} catch (e) { console.error("ledger: no conflict tabs:", e.message); }
// 4. each seed's ledger
const feeds = JSON.parse(fs.readFileSync("tools/news_feeds.json", "utf8")).feeds;
const owners = JSON.parse(fs.readFileSync("tools/outlet_owners.json", "utf8"));
const book = outletBook(feeds, owners, null);
const byCc = new Map(), sharpCut = Math.max(SHARP_MIN, nRows * SHARP);
let nEmpty = 0;
seeds.forEach((s, si) => {
  const sharp = new Set(s.w.filter((x) => (df.get(x) || 0) <= sharpCut));
  const L = live.get(s.id), reps = (cand.get(si) || []).filter((r) => joins(r.st, s, sharp));
  // the thread's own reports always count (they were joined by the sharper 72-hour rule)
  if (L) for (const row of L.t.rows || []) reps.push({ outlet: row[0], link: row[5], title: row[6], date: row[4], ms: ms(row[4]), flags: row[7] ? "m" : "", fromThread: [row[1], row[3]] });
  const R2 = chain(reps.filter((r) => isFinite(r.ms)), s).map((r) => {
    if (r.fromThread) return { outlet: r.outlet, kind: r.fromThread[0] || "other", occ: r.fromThread[1] || "", date: r.date, ms: r.ms, link: r.link, title: r.title, mt: /m/.test(r.flags) };
    const o = book.of(r.outlet);
    return { outlet: r.outlet, kind: /g/.test(r.flags) ? "state" : o.kind, occ: o.cc || "", date: r.date, ms: r.ms, link: r.link, title: r.title, mt: /m/.test(r.flags) };
  });
  const lg = R2.length ? build(s, R2, { thread: L ? L.t.id : "", sensorOf: (u) => strike.get(u) || null }) : null;
  if (!lg || lg.n < 2) { nEmpty++; s.empty = (s.empty || 0) + 1; return; }
  s.empty = 0; if (String(lg.d) > String(s.last)) s.last = lg.d;
  if (!byCc.has(s.cc)) byCc.set(s.cc, []);
  byCc.get(s.cc).push(lg);
});
// 5. write: per country, still-live ledgers first, then the most recently active, at most PER_COUNTRY
fs.mkdirSync(OUT, { recursive: true });
const written = new Set();
let nL = 0;
for (const [cc, l] of [...byCc].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  l.sort((a, b) => (!!b.thread - !!a.thread) || (b.d > a.d ? 1 : b.d < a.d ? -1 : 0) || b.n - a.n);
  const ledgers = l.slice(0, PER_COUNTRY);
  fs.writeFileSync(OUT + "/" + cc + ".js", "window.OSAP_LEDGER=" + JSON.stringify({ schema: LSCHEMA, rules: RULES, asof: stamp, method: METHOD, cc, days: DAYS, ledgers }).replace(/<\//g, "<\\/") + ";\n");
  written.add(cc + ".js"); nL += ledgers.length;
}
for (const f of fs.readdirSync(OUT)) if (/\.js$/.test(f) && !written.has(f)) fs.rmSync(OUT + "/" + f);
// the seeds kept: seen in the last KEEP_DAYS and not empty three runs in a row, most recent first, at most MAX_SEEDS
const keep = seeds.filter((s) => (s.empty || 0) < 3 && ms(s.last) >= END - KEEP_DAYS * 864e5).sort((a, b) => (b.last > a.last ? 1 : -1)).slice(0, MAX_SEEDS);
fs.writeFileSync(STATE, JSON.stringify({ schema: "osap-ledger-state/1", rules: RULES, asof: stamp, seeds: keep.map(({ id, cc, w, t, u, born, d0, last, thread, empty }) => ({ id, cc, w, t, u, born, d0, last, thread, empty: empty || 0 })) }) + "\n");
console.log(`ledger: ${nL} ledgers in ${written.size} countries (${seeds.length} seeds, ${nNew} new from ${live.size} qualifying of ${nThreads} threads, ${nEmpty} empty, ${keep.length} kept) from ${nRows} headlines over ${days.length} days, ${strike.size} strike reports, ${Date.now() - t0} ms`);
