// Story threads ("go deeper"): the pure parts (no files, no network), shared by tools/news_stories.mjs and tests/threads.test.mjs.
// Shane 2026-11-14: "I want the news feed to be able to go multiple layers deep on a topic ... so someone can make connections ...
// I want the average person to be able to easily see beyond the headlines."
// Story coverage (tools/stories_lib.mjs) groups only near-identical headlines, so one event (the FAA ground stop of 13 Nov) became
// eight flat stories and its one-outlet angles ("Stranded passenger in Las Vegas", "What is the SMART AI tool") were dropped.
// A thread joins every headline of one event, in layers:
//   thread -> part (What happened / Why / What officials say / Who is affected / What happens next) -> story (headlines in nearly
//   the same words) -> report (one outlet's own headline and link) -> source (who owns the outlet, where it is based)
// plus how it developed (the first report of each story, in time order) and the names it mentions (people, bodies, places,
// systems), each with the other headlines that name them, so a reader can follow a connection.
// Rules only, no AI: a thread is headlines sharing an event's distinctive words within a few days; a part is chosen by words in the
// headline; a name is a word the outlets write with a capital letter. All three are machine matches and the page says so: a
// thread can miss or wrongly join a headline, and two stories naming the same person are not shown to be linked. Officials' lines
// are their claims. Nothing is added to an outlet's headline. Rebuildable at any time from the pool.
import crypto from "node:crypto";
import { words, unent } from "./daily_lib.mjs";

export const TSCHEMA = "osap-threads/1";
export const MERGE = 0.3, MERGE_W = 0.4, MAX_THREADS = 12, MAX_ROWS = 100, MAX_NAMES = 10, MAX_LINKS = 5;
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

/* crude stems so "flights"/"flight", "suspends"/"suspended" meet; never shorter than four letters */
export function stem(w) {
  if (/^(die[sd]|dying)$/.test(w)) return "die";
  if (w.length > 6 && /ing$/.test(w)) return w.slice(0, -3);
  if (w.length > 5 && /ied$/.test(w)) return w.slice(0, -3) + "y";
  if (w.length > 5 && /ed$/.test(w)) return w.slice(0, -2);
  if (w.length > 4 && /[^s]s$/.test(w)) return w.slice(0, -1);
  return w;
}
export const stems = (t) => new Set(words(t).map(stem));

/* The parts of a thread, in the order a reader asks. A headline goes to the first part whose words it has; one with none of
   them is part of "What happened". English headlines only (the pool's translation); one left untranslated stays in What happened. */
export const PARTS = [
  ["next", "What happens next", "Follow-ups: lifted, resumed, investigations, hearings, calls for change, what to do",
    /\b(lift(s|ed)?|resum(e|es|ed|ing)|reopen(s|ed)?|restor(e|es|ed)|ends?\b|ended|back to normal|investigat\w*|probe|inquiry|hearing|lawsuit|sue[sd]?|charged?|arrest(s|ed)?|calls? for|overhaul|reform|fund(ing)?|upgrade|plan(s|ned)?|next|aftermath|recover\w*|what to do|how to|refund|compensat\w*|will (be|have)|vows?|pledges?)\b/i],
  ["impact", "Who is affected", "Impacts: people, places, services and money",
    /\b(stranded|delay(s|ed)?|cancel\w*|disrupt\w*|chaos|passengers?|travell?ers?|residents?|families|victims?|killed|dead|deaths?|died|injur\w*|wounded|hurt|missing|evacuat\w*|displaced|homeless|damage[ds]?|destroy\w*|shortage|prices?|cost(s|ly)?|losses?|closed|closures?|shut\w*|standstill|queues?|lines?|run(ning)? out|outages? hit|without power|blackout|affected|hits?|airports? (in|across)|warns? of (possible )?delays)\b/i],
  ["why", "Why it happened", "The cause, as each source tells it",
    /\b(caused?|causes|because|due to|blame[ds]?|reason|root cause|outage|failure|failed|glitch|malfunction|fault|error|cyber\s?attack|hack(ed|ers?)?|attack|sabotage|not a|no indication|what (we know|happened|is known)|explain\w*|why|behind)\b/i],
  ["said", "What officials say", "Statements by officials, agencies and leaders: their claims, not established fact",
    /\b(says?|said|statement|spokes(man|woman|person)|minister|ministry|secretary|president|premier|governor|mayor|chief|director|officials?|authorit(y|ies)|government|agency|department|police|army|military|briefing|press conference|announc\w*|confirm\w*|den(y|ies|ied)|warns?|insists?|tells?|according to)\b/i],
];
export const HAPPENED = ["what", "What happened", "The first reports and the event itself"];
export function partOf(title) {
  for (const [k, , , rx] of PARTS) if (rx.test(title)) return k;
  return "what";
}

/* ---------- names: people, bodies, places and systems the outlets write with a capital letter ----------
   Learnt from the whole pool: a phrase counts as a name when, in headlines written in sentence case, it is capitalised
   mid-headline at least 80% of the times it appears (so "Ground Stop" in a title-case headline is not a name, "Mullin" is).
   Acronyms (FAA, DHS, SMART) count when two or more headlines carry them. */
const NOT_NAME = new Set(("Watch Live Video Videos Update Updates Breaking Special Report Opinion Analysis Explainer Exclusive Photos Photo Podcast Editorial Here What How Why When Where Who " +
  "Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December " +
  "US U.S USA UK EU AI TV CEO PM MP MPs GDP COVID OK FM AM PDF II III IV The A An In On At For From With By Of To And Or As Is It This That New Former Ex").split(" "));
const CONNECT = new Set(["of", "de", "del", "la", "le", "al", "bin", "van", "von", "da", "do", "dos", "das", "du", "and", "&", "for", "on"]);
const tokRx = /[\p{L}\p{N}][\p{L}\p{N}.'’&-]*/gu;
const isCap = (w) => /^\p{Lu}/u.test(w);
const isAcr = (w) => /^\p{Lu}[\p{Lu}\p{N}&.]{1,6}$/u.test(w) && /\p{Lu}.*\p{Lu}/u.test(w);
const clean = (w) => w.replace(/[.'’-]+$/u, "").replace(/['’]s$/u, "");
function toks(t) { return (String(t).match(tokRx) || []).map(clean).filter(Boolean); }
/* a headline written in sentence case: some of its longer words after the first are lower case (a title-case headline has
   next to none, however long the names in it) */
function sentenceCase(T) {
  const rest = T.slice(1).filter((w) => w.length > 3 && /\p{L}/u.test(w) && !isAcr(w));
  const low = rest.filter((w) => !isCap(w)).length;
  return rest.length >= 3 && low >= 2 && low / rest.length >= 0.3;
}
/* runs of capitalised words (joined by "of", "de" ...), never starting at the headline's first word unless an acronym */
function capRuns(T) {
  const out = [];
  let run = [];
  const flush = () => { while (run.length && CONNECT.has(run[run.length - 1].toLowerCase())) run.pop(); if (run.length) out.push(run.join(" ")); run = []; };
  T.forEach((w, i) => {
    if (isCap(w) && (i > 0 || isAcr(w)) && !(run.length === 0 && NOT_NAME.has(w))) run.push(w);
    else if (run.length && CONNECT.has(w.toLowerCase()) && i + 1 < T.length && isCap(T[i + 1])) run.push(w);
    else flush();
  });
  flush();
  return out;
}
/** learn the names from many English headlines (strings). Returns { has(name), find(title) -> names in it } */
export function nameBook(titles) {
  const cap = new Map(), low = new Map(), acr = new Map();
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (const raw of titles) {
    const t = unent(raw), T = toks(t);
    if (!T.length) continue;
    const allCaps = T.filter((w) => /\p{L}/u.test(w)).every((w) => !/\p{Ll}/u.test(w));
    if (!allCaps) for (const w of new Set(T.filter(isAcr))) if (!NOT_NAME.has(w)) bump(acr, w);
    if (!sentenceCase(T)) continue;
    const seen = new Set();
    for (const r of capRuns(T)) {
      // the whole run and, for long runs, each capitalised word, so "Homeland Security Secretary Mullin" also gives "Mullin"
      const parts = r.split(" ");
      const cand = [r];
      const last = parts[parts.length - 1];
      if (parts.length > 1 && parts.length <= 4 && last.length > 2 && !isAcr(last)) cand.push(last);
      for (const c of cand) if (!seen.has(c)) { seen.add(c); bump(cap, c); }
    }
    for (const w of new Set(T.slice(1).filter((x) => !isCap(x) && x.length > 1))) bump(low, w);
  }
  const names = new Set();
  for (const [n, c] of cap) {
    if (c < 2 || NOT_NAME.has(n) || n.length < 3 || /^\d/.test(n)) continue;
    const l = n.includes(" ") ? 0 : low.get(n.toLowerCase()) || 0;
    if (c / (c + l) >= 0.8) names.add(n);
  }
  // an acronym, unless it is an ordinary word some headline shouts ("THE", "WITH", "PHOTOS")
  for (const [a, c] of acr) if (c >= 2 && !NOT_NAME.has(a.replace(/\./g, "")) && (low.get(a.toLowerCase()) || 0) < c) names.add(a);
  // longest first, so "Washington Dulles International Airport" is found before "Washington"
  const list = [...names].sort((a, b) => b.length - a.length);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const byFirst = new Map();
  for (const n of list) { const k = n.split(" ")[0]; if (!byFirst.has(k)) byFirst.set(k, []); byFirst.get(k).push(n); }
  function find(title) {
    const t = unent(title), T = toks(t), out = [];
    const used = new Set();
    for (let i = 0; i < T.length; i++) {
      if (used.has(i)) continue;
      const l = byFirst.get(T[i]);
      if (!l) continue;
      for (const n of l) {
        const k = n.split(" ").length;
        if (T.slice(i, i + k).join(" ") === n) { if (!out.includes(n)) out.push(n); for (let j = i; j < i + k; j++) used.add(j); break; }
      }
    }
    return out;
  }
  return { has: (n) => names.has(n), find, size: names.size, _esc: esc };
}

/* ---------- threads ---------- */
/** Join one country's reports into threads.
 *  R: the country's reports as stories_lib.buildCountry prepares them ({title, orig, outlet, link, date, ms, kind, home, occ, how, flags}),
 *  groups: stories_lib.group(R) (stories of near-identical headlines), names: nameBook(); the country's own names are left out. */
export function buildThreads(R, groups, names, opt = {}) {
  const N = R.length;
  if (!N) return [];
  const S = R.map((r) => stems(r.title));
  const idOf = new Map(R.map((r, i) => [r, i]));
  const df = new Map();
  S.forEach((s) => s.forEach((x) => df.set(x, (df.get(x) || 0) + 1)));
  // words in more than 4% of the country's headlines (its own name, its leader, "war") say nothing about one event
  const cut = Math.max(4, N * 0.04);
  const rare = (x) => (df.get(x) || 0) <= cut && (df.get(x) || 0) >= 2 && !/^\d+$/.test(x);
  const sharpCut = Math.max(6, N * 0.015);
  const gOf = new Int32Array(N).fill(-1);
  groups.forEach((g, gi) => g.items.forEach((it) => { const i = idOf.get(it); if (i != null) gOf[i] = gi; }));
  const outletsIn = (ix) => new Set(ix.map((i) => R[i].outlet)).size;
  const seeds = groups.map((g, gi) => ({ gi, ix: g.items.map((it) => idOf.get(it)).filter((i) => i != null) }))
    .filter((s) => outletsIn(s.ix) >= 2).sort((a, b) => outletsIn(b.ix) - outletsIn(a.ix) || a.gi - b.gi);
  const owner = new Int32Array(N).fill(-1), threads = [];
  // the event's words: distinctive words carried by a good share of its headlines
  function core(ix, share, min, cap) {
    const c = new Map();
    ix.forEach((i) => S[i].forEach((x) => { if (rare(x)) c.set(x, (c.get(x) || 0) + 1); }));
    return [...c].filter(([, n]) => n >= Math.max(min, ix.length * share)).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, cap).map(([x]) => x);
  }
  function grow(t, words, anchor) {
    const W = new Set(words), A = new Set(anchor);
    // a sharp word: rare in the country's news, or one this event already holds a good share of (a big event's own words,
    // "ground stop" on the day of the ground stop, are common only because of the event)
    const inT = new Map(); t.ix.forEach((i) => S[i].forEach((x) => inT.set(x, (inT.get(x) || 0) + 1)));
    const sharp = new Set([...A].filter((x) => (df.get(x) || 0) <= sharpCut || (inT.get(x) || 0) >= (df.get(x) || 0) * 0.3));
    if (W.size < 2) return;
    const lo = Math.min(...t.ix.map((i) => R[i].ms)) - 12 * 36e5, hi = Math.max(...t.ix.map((i) => R[i].ms)) + 48 * 36e5;
    for (let i = 0; i < N; i++) {
      if (owner[i] !== -1 || R[i].ms < lo || R[i].ms > hi) continue;
      // the seed story's own sharp words, two of them, or one with two more of the event's words: stock words of the news
      // ("arrested", "drug", "court") join any crime or court story, and the thread must not drift from where it started
      let n = 0, sh = 0; for (const x of S[i]) if (W.has(x)) { n++; if (A.has(x) && sharp.has(x)) sh++; }
      if (sh >= 2 || (n >= 3 && sh >= 1)) { owner[i] = t.n; t.ix.push(i); }
    }
  }
  for (const sd of seeds) {
    const free = sd.ix.filter((i) => owner[i] === -1);
    if (free.length < sd.ix.length / 2) continue; // mostly taken by a bigger thread already
    const t = { n: threads.length, ix: [] };
    free.forEach((i) => { owner[i] = t.n; t.ix.push(i); });
    const c0 = core(t.ix, 0.4, 1, 8);
    grow(t, c0, c0);
    // once more with the words the joined headlines share, still anchored on the seed's own words
    const c1 = [...new Set([...c0, ...core(t.ix, 0.2, 3, 8)])].slice(0, 12);
    grow(t, c1, c0);
    t.words = c1;
    threads.push(t);
  }
  // one event told in other words ("ground stop" / "flights suspended", "Darchiev" / "Dartchiev") starts more than one thread:
  // threads whose times overlap and whose distinctive words mostly agree are joined, biggest first
  // two views of the words, either one agreeing is enough: the distinctive words counted plainly, and every word but the most
  // common weighted by rarity (which keeps the event's own words even when the event fills the country's news, "russian ambassador")
  const vecR = (ix) => { const v = new Map(); ix.forEach((i) => S[i].forEach((x) => { if (rare(x)) v.set(x, (v.get(x) || 0) + 1); })); return v; };
  const vecW = (ix) => { const v = new Map(); ix.forEach((i) => S[i].forEach((x) => { const d = df.get(x) || 0; if (d >= 2 && d <= N * 0.25) v.set(x, (v.get(x) || 0) + Math.log(N / d)); })); return v; };
  const cos = (a, b) => { let d = 0, na = 0, nb = 0; for (const [x, n] of a) { na += n * n; const m = b.get(x); if (m) d += n * m; } for (const [, m] of b) nb += m * m; return d / (Math.sqrt(na * nb) || 1); };
  const span = (t) => [Math.min(...t.ix.map((i) => R[i].ms)), Math.max(...t.ix.map((i) => R[i].ms))];
  // each thread is compared as it was built, never as it grows by joining; two that are close join, and so do two that are each
  // close to a third (the ground stop's foreign "aircraft grounded" reports and its US "ground stop" reports, joined by "take-offs
  // blocked"), the biggest keeping the lead
  const VR = threads.map((t) => vecR(t.ix)), VW = threads.map((t) => vecW(t.ix)), SP = threads.map(span);
  const up = threads.map((_, i) => i), root = (i) => { while (up[i] !== i) i = up[i] = up[up[i]]; return i; };
  for (let a = 0; a < threads.length; a++) for (let b = a + 1; b < threads.length; b++) {
    const [a0, a1] = SP[a], [b0, b1] = SP[b];
    if (b0 > a1 + 24 * 36e5 || a0 > b1 + 24 * 36e5) continue;
    if (cos(VR[a], VR[b]) < MERGE && cos(VW[a], VW[b]) < MERGE_W) continue;
    const ra = root(a), rb = root(b); if (ra !== rb) up[Math.max(ra, rb)] = Math.min(ra, rb);
  }
  threads.forEach((B, b) => {
    const a = root(b); if (a === b) return;
    const A = threads[a];
    B.ix.forEach((i) => { owner[i] = A.n; A.ix.push(i); });
    A.words = [...new Set([...A.words, ...B.words])].slice(0, 12);
    B.gone = true;
  });
  const out = [];
  for (const t of threads.filter((x) => !x.gone)) {
    const ix = t.ix.sort((a, b) => R[a].ms - R[b].ms);
    const nOut = outletsIn(ix);
    if (nOut < 2 || ix.length < 3) continue;
    const reps = ix.map((i) => R[i]);
    // stories inside the thread: the near-identical groups, each counted by outlet
    const sg = new Map();
    for (const i of ix) { const k = gOf[i]; if (!sg.has(k)) sg.set(k, []); sg.get(k).push(i); }
    const sub = [...sg.values()].map((l) => {
      const by = new Map(); for (const i of l) if (!by.has(R[i].outlet)) by.set(R[i].outlet, i);
      const first = l[0], lead = l.find((i) => !R[i].orig) ?? first;
      return { lead, first, ix: l, n: by.size, part: partOf(R[lead].title) };
    });
    const k = { state: 0, public: 0, other: 0 }, o = { dom: 0, out: 0, unk: 0 }, seenO = new Set();
    reps.forEach((r) => { if (seenO.has(r.outlet)) return; seenO.add(r.outlet); k[r.kind]++; o[r.home]++; });
    // the lead: the biggest story's English headline, preferring one that names the country
    // (an outlet's own English headline, not a machine translation, among the stories at least half as big as the biggest)
    const top = Math.max(...sub.map((x) => x.n));
    const own = (x) => !/m/.test(R[x.lead].flags) && !R[x.lead].orig;
    const big = sub.slice().sort((a, b) => (b.n * 2 >= top && own(b)) - (a.n * 2 >= top && own(a)) || b.n - a.n || a.first - b.first)[0];
    const lead = R[big.lead];
    // every report row, newest last, capped; counts always say the whole
    // past the cap the first reports and the newest are kept, so the start and the latest turn both show
    const rows = ix.length > MAX_ROWS ? [...ix.slice(0, 30), ...ix.slice(ix.length - (MAX_ROWS - 30))] : ix;
    const rowAt = new Map(rows.map((i, j) => [i, j]));
    const parts = {};
    for (const s of sub) { (parts[s.part] = parts[s.part] || []).push(s); }
    const P = [HAPPENED, ...PARTS.map(([key, label, sub]) => [key, label, sub])]
      .map(([key]) => [key, (parts[key] || []).sort((a, b) => b.n - a.n || R[a.first].ms - R[b.first].ms)
        .map((s) => [s.ix.filter((i) => rowAt.has(i)).map((i) => rowAt.get(i)), s.n]).filter((s) => s[0].length)])
      .filter(([, l]) => l.length);
    // how it developed: the first report of each story, in time order
    const dev = sub.slice().sort((a, b) => R[a.first].ms - R[b.first].ms).filter((s) => rowAt.has(s.first)).slice(0, 14).map((s) => rowAt.get(s.first));
    // names the thread mentions, most mentioned first, without the country's own names
    const nm = new Map();
    for (const r of reps) for (const x of names.find(r.title)) if (!(opt.skipName && opt.skipName(x))) nm.set(x, (nm.get(x) || 0) + 1);
    const nameList = [...nm].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, MAX_NAMES);
    const links = reps.map((r) => r.link).sort();
    out.push({
      id: sha(links.join("\n")).slice(0, 12), t: lead.title, u: lead.link, s: lead.outlet,
      d0: reps[0].date, d: reps[reps.length - 1].date, n: nOut, r: reps.length, k, o, w: t.words.slice(0, 6),
      fp: sha(JSON.stringify(links)),
      // [outlet, kind, home, outlet's country, date, link, headline, machine translated 1/0, country inferred 1/0, story index]
      rows: rows.map((i) => { const r = R[i]; return [r.outlet, r.kind, r.home, r.occ || "", r.date, r.link, r.title, /m/.test(r.flags) ? 1 : 0, r.how === "inferred" ? 1 : 0]; }),
      parts: P, dev, names: nameList.map(([x, c]) => [x, c]),
    });
  }
  return out.sort((a, b) => b.n - a.n || b.r - a.r || (b.d > a.d ? 1 : -1)).slice(0, opt.max || MAX_THREADS);
}

/** Connections: for each name a thread mentions, the other headlines in the pool (any country) that name it.
 *  all: [{cc, title, outlet, link, date, ms, thread: "cc:id" | ""}], index: Map name -> indices into all. Mutates threads.
 *  Each line says whether it shares the event's own words (the same event told elsewhere, 1) or not (another story, 0); other
 *  stories come first, as they are the connections a reader would not find in the thread itself. */
export function connect(threadsByCc, all, index, maxHits) {
  for (const [cc, threads] of threadsByCc) for (const t of threads) {
    const mine = new Set(t.rows.map((r) => r[5])), ev = new Set(t.w);
    // a name in more than maxHits headlines (Trump, Russia, Europe) connects everything and so nothing; one the thread names only
    // once and the pool names often (America, CNN) says little about this event
    t.names = t.names.filter(([x, c]) => { const h = (index.get(x) || []).length; return h <= maxHits && (c >= 2 || h <= 20); }).map(([x, c]) => {
      const hits = (index.get(x) || []).map((i) => all[i]).filter((a) => !mine.has(a.link));
      const seenT = new Set(), list = [];
      const rel = (a) => { let n = 0; for (const w of stems(a.title)) if (ev.has(w) && ++n >= 2) return 1; return 0; };
      const H = hits.map((a) => [a, rel(a)]).sort((p, q) => p[1] - q[1] || (q[0].cc === cc) - (p[0].cc === cc) || q[0].ms - p[0].ms);
      for (const [a, r] of H) {
        // one line per other thread: the first headline found stands for it
        if (a.thread) { if (seenT.has(a.thread) || a.thread === cc + ":" + t.id) continue; seenT.add(a.thread); }
        list.push([a.cc, a.date, a.outlet, a.link, a.title, a.thread || "", r]);
        if (list.length >= MAX_LINKS) break;
      }
      return [x, c, hits.length, list];
    });
  }
}
