// Grounding check of AI-written text against its cited sources (Shane 2026-11-24: "How do we account for AI hallucinations in
// OSAP?" ... "Yes start it"). The daily summaries' AI top lines and watch lines (tools/daily_lib.mjs validateAi) and the answers of
// "Ask about this country" (tools/ask_lib.mjs checkAnswer) each already cite numbered sources, and a line with no valid source
// number is dropped. That proved a line cites something, not that what it says is in what it cites. This check reads every
// line claim by claim against the headlines it cites (title, the original-language title, outlet, time, country and conflict tab)
// and the OSAP facts the model was given, using the machine translation guard's own fact checks (tools/mt_guard.mjs,
// tools/mt_facts.mjs) so the two never disagree on what counts as the same number:
//   - number: a number, amount or percentage no cited source gives (extraNumber), or a count word ("three reports") that is
//     neither in a source nor the number of sources or outlets it cites;
//   - count: a count of dead, injured, missing, arrested or abducted people no cited source gives (extraCount);
//   - harm: says people were killed, died or were hurt where no cited source has a word for death or injury (extraHarm);
//   - date: a year, month or weekday that is neither in a cited source nor in the source's own publication time;
//   - name: a person, organization or place (a capitalized name) that no cited source, outlet or OSAP fact names, and that is not
//     the country of the summary.
// The checker only accepts, drops or flags: it never rewrites a line or adds a word. A line with a number, count, harm or date it
// cannot trace is dropped (these are the facts the MT guard found invented most often, and a wrong one misleads most). A line
// whose only gap is a name is kept and flagged: the page shows the line with "Not in its sources: <name>" beside it, so the
// analyst sees exactly what the AI added. Every line kept carries its trace (which cited source holds each checked number and
// name), and the page shows it, so a reader can see where each claim came from without opening every link.
// Pure: no network; the only file read is the MT guard's Thai place list, at load (through tools/mt_guard.mjs).
import { extraNumber, extraMonth, extraWeekday, numberIn, asciiDigits } from "./mt_guard.mjs";
import { extraCount, extraHarm, numberWordValues, fold, EN_HARM, HARM_STEMS } from "./mt_facts.mjs";
import { countryForms } from "./ai_lines.mjs";

export const GROUND_V = "ground/1";
// kinds of gap that drop a line; a "name" gap only flags it
export const HARD = new Set(["number", "count", "harm", "date"]);
export const KINDS = ["number", "count", "harm", "date", "name", "outlet"];

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// "2026-11-24T09:25" as "24 November 2026 Tuesday", so a line may name the day, month and weekday a source was published
function spellDate(s) {
  const m = String(s || "").match(/^(\d{4})-(\d\d)-(\d\d)/); if (!m) return "";
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return `${+m[3]} ${MONTH_NAMES[+m[2] - 1]} ${m[1]} ${DAY_NAMES[new Date(t).getUTCDay()]}`;
}

/** one source as checkable text: { n, text } where text joins every field of it the model was shown */
export function sourceText(r) {
  if (!r) return "";
  return [r.title || r.headline, r.orig, r.outlet, r.conflict, r.where && String(r.where).length > 3 ? r.where : "", r.date || r.time, spellDate(r.date || r.time)]
    .filter(Boolean).map(String).join(" \n ");
}

// capitalized words that are titles, institutions, directions or kinds of place rather than names; the name next to them is checked
const GENERIC = new Set(("president prime minister ministry minister government army navy air force forces armed police court supreme constitutional " +
  "parliament senate congress house assembly national international department office agency republic kingdom state federal " +
  "north south east west northern southern eastern western central northeast northwest southeast southwest upper lower greater " +
  "city province provincial region regional district county border sea ocean gulf bay river island islands mount mountain lake airport port strait " +
  "embassy foreign defense defence interior general secretary chief commander council committee commission party union bank coast guard military royal " +
  "bluf ai osap news reports report media state-media official officials authorities authority the a an in on at of for and or but as by with from " +
  "this that these those it its their there after before during amid while also meanwhile according multiple several some many other others " +
  "continued potential possible ongoing reported reports new local public private security health weather warning advisory travel level " +
  "mr mrs ms dr sir lord king queen prince princess his her mp " +
  "road street avenue highway command academy school university hospital station base camp center centre zone identification information " +
  "commissioner commission revolutionary corps division brigade battalion unit service services directorate bureau institute " +
  "fahrenheit celsius magnitude level category alert notice watch advisory forecast bulletin " +
  "breaking update live video exclusive analysis opinion editorial " +
  "january february march april may june july august september october november december monday tuesday wednesday thursday friday saturday sunday").split(" "));

const WORD_RE = /[\p{Lu}][\p{L}\p{M}'’.-]*[\p{L}\p{M}]|[\p{Lu}]{2,}/gu;
// The names of a line, as runs of capitalized words ("Trat Fisheries", "Kenya Police Academy" -> ["Kenya"]), sentence by sentence,
// titles and kinds of place left out (GENERIC). A sentence's first word counts only when the next word is capitalized too ("Trat
// Fisheries sent ...") or it is all capitals ("ASEAN"), since "Continued conflict ..." starts with a common word.
export function nameRuns(text) {
  const runs = [];
  for (const sent of String(text || "").split(/(?<=[.!?;:])\s+|\s+[–—]\s+|\(|\)|,/)) {
    let run = [], last = -1;
    const flush = () => { if (run.length) runs.push(run); run = []; };
    for (const m of sent.matchAll(WORD_RE)) {
      const between = last < 0 ? "" : sent.slice(last, m.index);
      if (last >= 0 && !/^\s*(?:(?:of|the|de|del|da|do|al|el|la|le|van|von|bin|and|&)\s+)*$/i.test(between)) flush();
      last = m.index + m[0].length;
      const w = m[0].replace(/['’]s$/, "").replace(/[.'’-]+$/, "");
      if (w.length < 2) continue;
      if (!sent.slice(0, m.index).replace(/["“'‘\s]/g, "")) {
        const next = sent.slice(last).match(/^\s+([\p{L}]+)/u);
        if (!(next && /^\p{Lu}/u.test(next[1]) && !GENERIC.has(next[1].toLowerCase())) && !/^[\p{Lu}]{2,}$/u.test(w)) continue;
      }
      for (const p of w.split(/-(?=\p{Lu})/u)) if (p.length > 1 && !GENERIC.has(p.toLowerCase())) run.push(p);
    }
    flush();
  }
  return runs;
}
export const namesIn = (text) => [...new Set(nameRuns(text).flat())];

// names are compared without apostrophes and the spaces around them ("Sa'dah", "Sa`dah", "Sa ' dah")
const nf = (s) => fold(s).replace(/\s*['’`ʼ‘]\s*/g, "");
const stems = (w) => { const f = nf(w).replace(/[’']/g, "'").replace(/'s$/, ""); return [f, f.replace(/(?:es|s)$/, ""), f.replace(/(?:ese|ian|ish|i|n|an)$/, "")].filter((x) => x.length > 2 || x === f); };
// whether a source text names w: the whole word, or (for a word of 5 letters or more) a word starting with its stem
function named(w, folded, words) {
  const fw = nf(w.replace(/['’]s$/, ""));
  if (words.has(fw)) return true;
  if (fw.length >= 3 && new RegExp(`(?<![\\p{L}])${fw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u").test(folded)) return true;
  if (fw.length >= 5) for (const st of stems(w)) if (st.length >= 4 && [...words].some((x) => x.startsWith(st))) return true;
  return false;
}
// a country or its people's name: traced when a source names the same country in any of its forms ("Burmese" for "Myanmar")
function countryOf(w) {
  for (const c of countryForms()) if (new RegExp(`^(?:${c.re})s?$`, "iu").test(w)) return c;
  return null;
}

// A line's own pointers to its sources are not claims: source numbers in brackets ("NZ Herald (5)", "(CBS News, 1; UPI, 3)") and
// the publication times of the day's sources ("Tehran Times (2026-11-23T17:25)", "at 02:18") are masked before the number check.
// A time no source of the day was published at is left in, and checked like any number.
function maskCites(t, nRefs, refs) {
  const times = new Set((refs || []).flatMap((r) => { const m = String((r && (r.date || r.time)) || "").match(/^(\d{4}-\d\d-(\d\d))T(\d\d:\d\d)/); return m ? [m[1] + "T" + m[3], m[2] + "T" + m[3], m[3]] : []; }));
  t = t.replace(/\d{4}-\d\d-\d\dT\d\d:\d\dZ?|\b\d\dT\d\d:\d\dZ?|\b\d\d:\d\d\b/g, (x) => times.has(x.replace(/Z$/, "")) ? " ".repeat(x.length) : x);
  // inside brackets, a source number or a list of them ("(5)", "(Ref: 2,4)", "(CBS News, 1; UPI, 3)") when every one is a source's
  return t.replace(/\(([^()]*)\)/g, (all, inner) => "(" + inner.replace(/(?<![\d.])\d{1,3}(?:\s*[,;]\s*\d{1,3})*(?![\d.]|,\d{3})/g,
    (x) => (x.split(/\s*[,;]\s*/).every((n) => +n >= 1 && +n <= nRefs) ? " ".repeat(x.length) : x)) + ")");
}
const COUNT_WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, twenty: 20, thirty: 30, hundred: 100 };
const YEAR_RE = /(?<![\d,.:/])(1[5-9]\d\d|20\d\d)(?!\d|,\d)/g;

/**
 * Checks one AI line against the sources it cites.
 * line: { text, refs: [n] }; refs: the day's numbered sources ([{ n, title|headline, orig, outlet, date|time, conflict, where }]),
 * ctx: { place: the country's name, facts: [OSAP fact lines given to the model], window: { from, to } }
 * Returns { ok, drop, gaps: [{ kind, what }], trace: [[term, [n...]]] }: drop when a number, count, harm or date gap is found.
 */
export function groundLine(line, refs, ctx = {}) {
  const text = String((line && line.text) || "");
  const cited = ((line && line.refs) || []).map((n) => (refs || []).find((r) => r && +r.n === +n)).filter(Boolean);
  const srcs = cited.map((r) => ({ n: r.n, text: sourceText(r) }));
  const extra = [ctx.place, ...(ctx.facts || []), ctx.window && ctx.window.from, ctx.window && ctx.window.to, ctx.window && spellDate(ctx.window.to)].filter(Boolean).join(" \n ");
  const all = srcs.map((s) => s.text).join(" \n ") + " \n " + extra;
  const gaps = [], trace = [];
  const gap = (kind, what) => { if (!gaps.some((g) => g.kind === kind && g.what === what)) gaps.push({ kind, what: String(what).slice(0, 60) }); };
  if (!srcs.length) return { ok: false, drop: true, gaps: [{ kind: "number", what: "no cited source" }], trace };
  const where = (pred) => srcs.filter((s) => pred(s.text)).map((s) => s.n);

  // numbers (each one the MT guard's extraNumber finds, removed in turn so every one is read)
  let rest = maskCites(asciiDigits(text), (refs || []).length, refs);
  for (let k = 0; k < 8; k++) {
    const x = extraNumber(all, rest);
    if (!x) break;
    gap("number", x);
    rest = rest.replace(x.split(" ")[0], " ");
  }
  // count words: "three reports", "two outlets"; the number of sources or outlets cited is the line's own count of them
  const outlets = new Set(cited.map((r) => fold(String(r.outlet || "").replace(/\s*\((?:via|on) .*\)$/i, "").replace(/ on msn$/i, "")))).size;
  const enWords = new Set(Object.entries(COUNT_WORDS).filter(([w]) => new RegExp(`\\b${w}s?\\b`, "i").test(all)).map(([, v]) => v));
  // number words in other languages are read only in the original-language headlines: read in English text they misfire ("fire" is
  // a Scandinavian four)
  const origs = cited.map((r) => r.orig).filter(Boolean).join(" \n ");
  const inAll0 = numberIn(all), inAll = (v) => inAll0(v) || enWords.has(v), wordVals = numberWordValues(origs);
  for (const m of text.matchAll(/\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen|thirteen|fourteen|fifteen|twenty|thirty|hundred)s?\b/gi)) {
    const v = COUNT_WORDS[m[1].toLowerCase()];
    const self = /^\s*(?:\w+\s+)?(?:reports?|sources?|outlets?|headlines?|articles?|stories|mentions?|warnings?|alerts?|advisories)\b/i.test(text.slice(m.index + m[0].length));
    if (inAll(v) || wordVals.has(v) || (self && (v === cited.length || v === outlets))) continue;
    gap("number", m[0]);
  }
  // casualty counts and casualty words
  const c = extraCount(origs, text, inAll);
  if (c) gap("count", c);
  const h = text.match(EN_HARM);
  if (h) {
    const LANGS = Object.keys(HARM_STEMS);
    const hasHarm = (s) => EN_HARM.test(s) || LANGS.some((l) => extraHarm(s, h[0], l) === "");
    if (!cited.some((r) => hasHarm(String(r.title || r.headline || "")) || (r.orig && hasHarm(String(r.orig)))) && !EN_HARM.test(extra)) gap("harm", h[0]);
  }
  // years, months and weekdays
  const years = new Set((asciiDigits(all).match(/\d{4}/g) || []));
  for (const m of maskCites(asciiDigits(text), (refs || []).length, refs).matchAll(YEAR_RE)) if (!years.has(m[1])) gap("date", m[1]);
  const mo = extraMonth(all, text); if (mo) gap("date", mo);
  const wd = extraWeekday(all, text); if (wd) gap("date", wd);

  // names. A country named in any of its forms is traced to the sources that name it in any form ("Burma", "Myanmar", "Burmese").
  const fx = nf(extra), fxWords = new Set(fx.split(/[^\p{L}\p{N}']+/u).filter(Boolean));
  const inSrc = (w) => srcs.filter((s) => { const f = nf(s.text); return named(w, f, new Set(f.split(/[^\p{L}\p{N}']+/u).filter(Boolean))); }).map((s) => s.n);
  let rest2 = text;
  for (const c of countryForms()) {
    const re = new RegExp(`(?<![\\p{L}])(?:${c.re})s?(?![\\p{L}])`, "gu");
    const hit = rest2.match(re); if (!hit) continue;
    const any = new RegExp(`(?<![\\p{L}])(?:${c.re})s?(?![\\p{L}])`, "u" + (/^American|^U\\\./.test(c.re) ? "" : "i"));
    const ns = where((t) => any.test(t));
    const own = ctx.place && new RegExp(`^(?:${c.re})`, "iu").test(String(ctx.place));
    if (ns.length) trace.push([hit[0], ns]); else if (!own && !any.test(extra)) gap("name", hit[0]);
    rest2 = rest2.replace(re, (x) => " ".repeat(x.length));
  }
  // the outlets of the whole day: a name that is one of them, but not of a cited source, is an outlet the line does not cite
  const dayOutlets = nf((refs || []).map((r) => r && r.outlet).filter(Boolean).join(" \n "));
  for (const run of nameRuns(rest2)) {
    const found = run.map((w) => [w, inSrc(w)]);
    const hits = found.filter(([, ns]) => ns.length);
    for (const [w, ns] of hits) trace.push([w, ns]);
    const miss = found.filter(([w, ns]) => !ns.length && !named(w, fx, fxWords)).map(([w]) => w);
    if (!miss.length || (run.length >= 2 && hits.length * 2 >= run.length)) continue;   // part of a name the sources give
    const phrase = miss.join(" ");
    if (miss.every((w) => named(w, dayOutlets, new Set(dayOutlets.split(/[^\p{L}\p{N}']+/u))))) gap("outlet", phrase);
    else gap("name", phrase);
  }
  // the numbers that are there, and where
  for (const m of maskCites(asciiDigits(text), (refs || []).length, refs).matchAll(/(?<![\w.])\d+(?:[.,]\d+)*/g)) {
    const v = +m[0].replace(/,/g, ""); if (!Number.isFinite(v) || v <= 1 || gaps.some((g) => g.what.startsWith(m[0]))) continue;
    const ns = srcs.filter((s) => numberIn(s.text)(v)).map((s) => s.n);
    if (ns.length) trace.push([m[0], ns]);
  }
  const drop = gaps.some((g) => HARD.has(g.kind));
  return { ok: !gaps.length, drop, gaps, trace: trace.slice(0, 12) };
}

/**
 * Checks a list of AI lines; keeps the traced and the flagged ones and drops the rest. Each kept line gets `g`, its grounding record:
 * { v: GROUND_V, s: "traced" | "flagged", t: [[term, [source numbers]]], m: [[kind, what]] (flagged only) }.
 * Returns { kept, dropped: [{ text, gaps }] }; the dropped lines never reach the page, only their count and kinds are kept.
 */
export function groundLines(lines, refs, ctx) {
  const kept = [], dropped = [];
  for (const p of lines || []) {
    const r = groundLine(p, refs, ctx);
    if (r.drop) { dropped.push({ text: p.text, gaps: r.gaps }); continue; }
    kept.push({ ...p, g: { v: GROUND_V, s: r.ok ? "traced" : "flagged", t: r.trace, ...(r.gaps.length ? { m: r.gaps.map((x) => [x.kind, x.what]) } : {}) } });
  }
  return { kept, dropped };
}

/** day-level counts for the index and the page: { checked, traced, flagged, dropped, kinds: { number: n, ... } } */
export function groundStats(kept, dropped) {
  const kinds = {};
  for (const d of dropped) for (const g of d.gaps) kinds[g.kind] = (kinds[g.kind] || 0) + 1;
  for (const p of kept) for (const [k] of (p.g && p.g.m) || []) kinds[k] = (kinds[k] || 0) + 1;
  return { checked: kept.length + dropped.length, traced: kept.filter((p) => p.g && p.g.s === "traced").length,
    flagged: kept.filter((p) => p.g && p.g.s === "flagged").length, dropped: dropped.length, kinds };
}
