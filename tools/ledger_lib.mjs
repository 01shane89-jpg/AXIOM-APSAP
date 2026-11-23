// Claim ledger, the pure parts (no files, no network), shared by tools/claim_ledger.mjs and tests/ledger.test.mjs.
// Shane 2026-11-23 "close the gaps": Go deeper (tools/threads_lib.mjs) and Share this trail / Play on the map
// (assets/osap-trail.js, assets/osap-trailmap.js) stop at the 72-hour story window, so a disputed figure or allegation drops out
// just as the denials, corrections and revised tolls arrive. The ledger follows each disputed story for up to 30 days of the
// news pool's search index (data/live/news-index/<day>.js, which holds about a month) and keeps, in time order:
//   the first report OSAP holds, who repeated it (each outlet's first headline), officials' lines (claims), headlines that deny or
//   dispute it, figures that differ between reports and how they moved, and any strike report on a conflict tab it carries, so the
//   page can open the sensor picture and Check it from space for it.
// It is a projection, never a record of truth: it is rebuilt every run from the index and this job's small seed list (which stories
// to follow, by their distinctive words). Rules only, no AI: which headlines join a ledger is word matching (the same rule as a Go
// deeper thread, over 30 days instead of 72 hours), "deny or dispute" is Share this trail's fixed word list, "official" is Go
// deeper's "What officials say" words, and figures are Check it's figure rules (tools/factcheck_lib.mjs). OSAP never rates a claim
// true or false; every line is a source's claim, and a government's figure is its claim.
import crypto from "node:crypto";
import { PARTS } from "./threads_lib.mjs";
import { figures } from "./factcheck_lib.mjs";

export const LSCHEMA = "osap-ledger/1";
export const RULES = "ledger-v1";
// how far back the ledger looks (the index holds about 30 days), when a seed is dropped, and the caps that keep files small
// a seed word is sharp when at most SHARP of all the index's headlines carry it (about 560 of 1.1 million), at least SHARP_MIN
export const SHARP = 0.0005, SHARP_MIN = 20;
export const DAYS = 30, KEEP_DAYS = 28, GAP_H = 72, MAX_ROWS = 120, PER_COUNTRY = 25, MAX_SEEDS = 2000, MIN_OUTLETS = 3;
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
// the same words as Share this trail's DISPUTE (assets/osap-trail.js); tests/ledger.test.mjs fails if the two ever differ
export const DISPUTE = /\b(den(y|ies|ied|ying|ial|ials)|reject(s|ed|ing)?|refut\w*|rebut\w*|dismiss(es|ed|ing)?|disput\w*|contradict\w*|false(ly)?|fake|hoax|debunk\w*|no evidence|baseless|untrue|misleading|fabricat\w*|not true)\b/i;
// an official's line: Go deeper's "What officials say" words, tested on their own (a headline giving a toll and saying who said it
// is both "Who is affected" and an official's line; Go deeper files it once, the ledger needs the second)
const SAID = PARTS.find((p) => p[0] === "said")[3];
const ms = (d) => Date.parse(String(d || "").slice(0, 16) + "Z");

/** A Go deeper thread worth a ledger: three or more outlets, and a figure that differs between reports or a headline that denies
 *  or disputes. rel(text) -> "drop" leaves out sport and show business (tools/relevance.json), as World does. */
export function qualifies(t, rel) {
  if (!t || (t.n || 0) < MIN_OUTLETS || !Array.isArray(t.rows) || !Array.isArray(t.w) || t.w.length < 2) return false;
  const disputed = t.rows.some((r) => DISPUTE.test(String(r[6] || ""))), figs = Array.isArray(t.fig) && t.fig.length > 0;
  if (!disputed && !figs) return false;
  return !(rel && rel(String(t.t || "") + " " + t.rows.map((r) => r[6] || "").join(" ")) === "drop");
}

/** The seed a thread continues: same country, at least three of its words shared (all of them when either has fewer than three),
 *  and seen within the story window. The biggest overlap wins. seeds: [{ id, cc, w, last }] */
export function matchSeed(seeds, cc, w, now, hours = 72) {
  const W = new Set(w || []);
  let best = null, bestN = 0;
  for (const s of seeds) {
    if (s.cc !== cc || !isFinite(ms(s.last)) || ms(s.last) < now - (hours + 24) * 36e5) continue;
    const n = (s.w || []).filter((x) => W.has(x)).length, need = Math.min(3, (s.w || []).length, W.size);
    if (n >= need && n > bestN) { best = s; bestN = n; }
  }
  return best;
}
export function newSeed(t, cc, stamp) {
  return { id: "ldg-" + sha(cc + ":" + t.id + ":" + stamp).slice(0, 12), cc, w: t.w.slice(0, 6), t: String(t.t || ""), u: String(t.u || ""),
    born: stamp, d0: t.d0, last: t.d, thread: t.id };
}

/** Does a headline (its stems) join a seed? The thread rule: two of the seed's sharp words, or one sharp word with two more of its
 *  words. sharp: Set of the seed's words that are rare in all the index's headlines over the ledger's days (SHARP). */
export function joins(st, seed, sharp) {
  let n = 0, sh = 0;
  for (const x of seed.w) if (st.has(x)) { n++; if (sharp.has(x)) sh++; }
  return sh >= 2 || (n >= 3 && sh >= 1);
}

/** Matched reports (sorted or not) -> the ones that hang together with the seed's own window: starting from the reports inside
 *  [d0 - 12 h, last + 48 h], add earlier and later reports while each is within GAP_H of the next one already in. Reports past a
 *  longer silence are left out: the same words days later are more likely another event (another strike on the same city). */
export function chain(reps, seed, gapH = GAP_H) {
  const R = reps.slice().sort((a, b) => a.ms - b.ms);
  const a0 = ms(seed.d0) - 12 * 36e5, a1 = ms(seed.last) + 48 * 36e5, gap = gapH * 36e5;
  let lo = R.findIndex((r) => r.ms >= a0 && r.ms <= a1);
  if (lo < 0) return [];
  let hi = lo; for (let i = lo; i < R.length; i++) if (R[i].ms <= a1) hi = i;
  while (lo > 0 && R[lo].ms - R[lo - 1].ms <= gap) lo--;
  while (hi < R.length - 1 && R[hi + 1].ms - R[hi].ms <= gap) hi++;
  return R.slice(lo, hi + 1);
}

/** The ledger itself from the reports that joined it. reps: [{ outlet, kind, occ, date, ms, link, title, mt }]
 *  sensorOf(link) -> [conflict, fp, la, lo, date, pin, kind] | null (a strike report on a conflict tab, tools/sensor_lib.mjs). */
export function build(seed, reps, opt = {}) {
  const seen = new Set(), R = [];
  // one report per link, and one per outlet and headline (an outlet posting the same headline at two addresses counts once)
  for (const r of reps.slice().sort((a, b) => a.ms - b.ms || (a.link < b.link ? -1 : a.link > b.link ? 1 : String(a.title) < String(b.title) ? -1 : 1))) {
    const same = r.outlet + "\n" + String(r.title || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (!r.link || seen.has(r.link) || seen.has(same)) continue; seen.add(r.link); seen.add(same); R.push(r);
  }
  if (!R.length) return null;
  const outlets = new Map(), role = R.map(() => "");
  R.forEach((r, i) => {
    if (!outlets.has(r.outlet)) { outlets.set(r.outlet, i); role[i] += i === 0 ? "f" : "r"; }
    if (DISPUTE.test(r.title)) role[i] += "d";
    else if (SAID.test(r.title)) role[i] += "o";
  });
  // figures, over every report (the thread rule: a report counts only when it has two of the event's own words)
  const asRows = R.map((r) => [r.outlet, r.kind, "", r.occ || "", r.date, r.link, r.title]);
  const figs = figures(asRows, seed.w, []);
  figs.forEach(([, , l]) => l.forEach(([, i]) => { if (role[i].indexOf("n") < 0) role[i] += "n"; }));
  const sensor = [];
  if (opt.sensorOf) R.forEach((r, i) => { const s = opt.sensorOf(r.link); if (s && !sensor.some((x) => x[1] === s[1])) { sensor.push([...s, i]); role[i] += "s"; } });
  // the rows kept: every one with a role, then the first and newest reports, at most MAX_ROWS, in time order; counts say the whole
  const keep = new Set();
  role.forEach((x, i) => { if (x) keep.add(i); });
  for (let i = 0; i < Math.min(10, R.length); i++) keep.add(i);
  for (let i = Math.max(0, R.length - 10); i < R.length; i++) keep.add(i);
  let kept = [...keep].sort((a, b) => a - b);
  if (kept.length > MAX_ROWS) {
    // too many: keep the first report, every denial, figure and sensor row, then first appearances and officials, earliest first
    const rank = (i) => (i === 0 || /[dns]/.test(role[i]) ? 0 : /r/.test(role[i]) ? 1 : /o/.test(role[i]) ? 2 : 3);
    kept = kept.slice().sort((a, b) => rank(a) - rank(b) || a - b).slice(0, MAX_ROWS).sort((a, b) => a - b);
  }
  const at = new Map(kept.map((i, j) => [i, j]));
  // day by day, over every report: [UTC day, reports, outlets new that day, deny or dispute, officials' lines]
  const days = new Map();
  R.forEach((r, i) => {
    const d = new Date(r.ms).toISOString().slice(0, 10);
    if (!days.has(d)) days.set(d, [d, 0, 0, 0, 0]);
    const x = days.get(d); x[1]++; if (/[fr]/.test(role[i])) x[2]++; if (/d/.test(role[i])) x[3]++; if (/o/.test(role[i])) x[4]++;
  });
  const k = { state: 0, public: 0, other: 0 }, ctry = new Set();
  for (const i of outlets.values()) { const r = R[i]; k[r.kind] = (k[r.kind] || 0) + 1; if (r.occ) ctry.add(r.occ); }
  const links = R.map((r) => r.link).sort();
  const count = (c) => role.filter((x) => x.indexOf(c) >= 0).length;
  return {
    id: seed.id, t: seed.t, u: seed.u, w: seed.w, born: seed.born, thread: opt.thread || "",
    d0: R[0].date, d: R[R.length - 1].date, n: outlets.size, r: R.length, k, countries: ctry.size,
    nd: count("d"), no: count("o"), dn: days.size,
    // [outlet, kind, outlet's country, date, link, headline, machine translated 1/0, roles]  roles: f first report OSAP holds,
    // r an outlet's first headline, d denies or disputes (word match), o an official's line (a claim), n gives a figure, s a strike report
    rows: kept.map((i) => { const r = R[i]; return [r.outlet, r.kind, r.occ || "", r.date, r.link, r.title, r.mt ? 1 : 0, role[i]]; }),
    days: [...days.values()],
    // [kind, label, [[number, kept row index]...]] in time order; a figure row past the cap is left out of the list
    figs: figs.map(([kind, label, l]) => [kind, label, l.filter(([, i]) => at.has(i)).map(([v, i]) => [v, at.get(i)])]).filter((f) => new Set(f[2].map((x) => x[0])).size > 1),
    // [conflict, report fp, la, lo, date, pin kind, kind, kept row index or -1]
    sensor: sensor.map((s) => [...s.slice(0, 7), at.has(s[7]) ? at.get(s[7]) : -1]),
    fp: sha(JSON.stringify(links)),
  };
}
