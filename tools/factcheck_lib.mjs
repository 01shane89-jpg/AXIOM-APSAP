// Go deeper > Check it: the pure parts (no files, no network), shared by tools/refresh_factchecks.mjs, tools/news_stories.mjs and
// tests/factcheck.test.mjs. Shane 2026-11-14: "Can we add a fact check to news reports?" Agreed plan: show what a reader needs to
// check a story for themselves, never OSAP's own true or false:
//   1. published fact-checks by fact-checking outlets whose words overlap the story (factMatch), each marked "may relate";
//   2. where reports give different figures (killed, injured, missing, displaced, arrested), the figures side by side (figures);
// (who carried it, and whether only state media did, is worked out on the page from the thread's own counts).
// Rules only, no AI. A fact-check is the fact-checker's finding about a claim, shown as theirs with its link.
import { stems } from "./threads_lib.mjs";

export const FSCHEMA = "osap-factchecks/1";
export const MAX_CHECKS = 4;

/** one feed item as [feed id, ISO date, headline, link, summary] or null (no headline, no web link, no date) */
export function checkItem(feed, i) {
  const title = String(i.title || "").replace(/\s+/g, " ").trim(), link = String(i.link || "").trim();
  const ms = Date.parse(i.date || "");
  if (!title || !/^https?:\/\/[^\s<>"]+$/i.test(link) || !isFinite(ms)) return null;
  const sum = String(i.summary || "").replace(/\s+/g, " ").replace(/\s*(The post .{0,200} appeared first on .*|Continue reading.*|Read more.*)$/i, "").trim();
  return [feed, new Date(ms).toISOString().slice(0, 16) + "Z", title.slice(0, 300), link, sum.length > 240 ? sum.slice(0, 237).replace(/\s+\S*$/, "") + "…" : sum];
}

/** the checks made ready for matching: their words and the names (nameBook.find) they mention */
export function prepChecks(items, find) {
  return items.map((c) => ({ c, ms: Date.parse(c[1]), w: stems(c[2] + " " + c[4]), nm: new Set([...find(c[2]), ...find(c[4])]) }));
}

/** Fact-checks that may relate to a thread: one that names one of the thread's names and has two of the event's own words, or
 *  names two of its names and one of its words, or has three of its words. Words alone are weak (an old flood check shares
 *  "flood" and "dead" with every flood), so a check must also be from 45 days before the thread to 14 days after it.
 *  t: a thread after connect() (t.names are the names worth following, t.w the event's distinctive words, stemmed).
 *  Returns up to MAX_CHECKS [feed id, date, headline, link, summary, [shared names]], best first. */
export function factMatch(t, prepped, max = MAX_CHECKS) {
  const N = new Set((t.names || []).map((x) => x[0])), W = new Set(t.w || []);
  const lo = Date.parse(t.d0) - 45 * 864e5, hi = Date.parse(t.d) + 14 * 864e5;
  const hits = [];
  for (const p of prepped) {
    if (!(p.ms >= lo && p.ms <= hi)) continue;
    const sn = [...p.nm].filter((x) => N.has(x)), sw = [...W].filter((x) => p.w.has(x)).length;
    if (!((sn.length >= 1 && sw >= 2) || (sn.length >= 2 && sw >= 1) || sw >= 3)) continue;
    hits.push([sn.length * 2 + sw, p.ms, [...p.c, sn]]);
  }
  return hits.sort((a, b) => b[0] - a[0] || b[1] - a[1]).slice(0, max).map((h) => h[2]);
}

/* ---------- figures: the numbers reports give ---------- */
const NUM = { sixty: 60, seventy: 70, eighty: 80, ninety: 90, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50 };
const TENS = "twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety", ONES = "one|two|three|four|five|six|seven|eight|nine";
const N_ = "(\\d{1,3}(?:,\\d{3})+|\\d+|(?:" + TENS + ")[- ](?:" + ONES + ")|" + Object.keys(NUM).join("|") + ")";
const WHO = "(?:(?:more than|over|at least|nearly|almost|about|around|some|up to)\\s+)?";
const NOUN = "(?:\\s+(?:people|persons|civilians|soldiers|troops|migrants|children|students|workers|passengers|miners|villagers|tourists|residents|fishermen|police(?:men)?|officers|militants|rebels|others))?";
const BE = "(?:\\s+(?:are|were|have been|has been|feared|reported|confirmed|now))*";
export const FIG = [
  ["killed", "killed or dead", new RegExp("(?<![\\w-])" + WHO + N_ + NOUN + BE + "\\s+(?:killed|dead|die[ds]?|deaths|perish(?:ed)?|bodies)\\b", "i"), new RegExp("\\bdeath toll\\b(?:\\s+(?:in|from|of|the|has|have|now|rises|rose|climbs|climbed|jumps|reaches|reached|hits|stands|at|to|tops|passes|exceeds|over|more than))*\\s+" + N_ + "\\b", "i")],
  ["injured", "injured", new RegExp("(?<![\\w-])" + WHO + N_ + NOUN + BE + "\\s+(?:injured|wounded|hurt|hospitali[sz]ed)\\b", "i")],
  ["missing", "missing", new RegExp("(?<![\\w-])" + WHO + N_ + NOUN + BE + "\\s+(?:missing|unaccounted for)\\b", "i")],
  ["displaced", "displaced or evacuated", new RegExp("(?<![\\w-])" + WHO + N_ + NOUN + BE + "\\s+(?:displaced|evacuated|homeless|fled|flee)\\b", "i")],
  ["arrested", "arrested or detained", new RegExp("(?<![\\w-])" + WHO + N_ + NOUN + BE + "\\s+(?:arrested|detained|held|in custody)\\b", "i")],
];
const val = (s) => { const k = String(s).toLowerCase(), c = k.split(/[- ]/); return c.length === 2 && NUM[c[0]] && NUM[c[1]] ? NUM[c[0]] + NUM[c[1]] : NUM[k] || Number(k.replace(/,/g, "")); };
/** the number of a kind a headline gives, or 0 */
export function figureIn(title, kind) {
  const f = FIG.find((x) => x[0] === kind); if (!f) return 0;
  for (const rx of f.slice(2)) {
    const m = String(title).match(rx); if (!m) continue;
    const v = val(m[1]);
    // a year ("2025 deaths") or a phone-sized number is not a count
    if (!isFinite(v) || v <= 0 || v > 5e6 || (/^(19|20)\d\d$/.test(m[1]) && !/,/.test(m[1]))) continue;
    return v;
  }
  return 0;
}
/** For thread rows ([outlet, kind, home, occ, date, link, headline, ...]): each kind of figure that reports give differently,
 *  as [kind, label, [[number, row index]...]] in time order. A kind every report gives the same number for is left out.
 *  A report wrongly joined to the thread (another crash or collapse the same day) must not set its numbers against the event's,
 *  so a headline counts only when it has two of the event's own words that are not casualty words (words: thread.w, stemmed)
 *  and, where most of the thread's reports name one place or body (names: thread.names, [name, count]), names it too. */
const CASUALTY = new Set(stems("dead deadly death deaths die died kill killed killing injured injury wounded hurt missing leave leaves left people least several one two three four five six seven eight nine ten dozen dozens hundred hundreds toll rise rises evacuated displaced arrested detained").values());
export function figures(rows, words, names) {
  const out = [], W = [...new Set(words || [])].filter((x) => !CASUALTY.has(x));
  const lead = (names || []).filter(([, c]) => c >= rows.length * 0.4).map(([x]) => x);
  const own = rows.map((r) => {
    let n = 0; const st = stems(r[6]); for (const x of W) if (st.has(x)) n++;
    return W.length > 0 && n >= Math.min(2, W.length) && (!lead.length || lead.some((x) => r[6].includes(x)));
  });
  for (const [kind, label] of FIG) {
    const l = [];
    rows.forEach((r, i) => { const v = own[i] && figureIn(r[6], kind); if (v) l.push([v, i]); });
    if (new Set(l.map((x) => x[0])).size < 2) continue;
    l.sort((a, b) => (rows[a[1]][4] < rows[b[1]][4] ? -1 : rows[a[1]][4] > rows[b[1]][4] ? 1 : a[1] - b[1]));
    out.push([kind, label, l.slice(0, 12)]);
  }
  return out;
}
