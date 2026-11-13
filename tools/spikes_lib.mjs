// Reporting spikes (tools/news_spikes.mjs, assets/osap-spikes.js): is a place getting more reporting than normal?
// Pure logic, no files, so tests/spikes.test.mjs can check it on made-up counts.
//
// The method, in words an analyst can check by hand:
//  - Time is cut into 24-hour windows ending at the build time: window 0 is the last 24 hours, window 1 the 24 hours before, ...
//  - For each place (a country, or a data set such as "Korea DMZ"), count the headlines in OSAP's news pool filed under it.
//  - Normal is that place's usual SHARE of all OSAP reporting (the median over the previous 14 windows), times the last 24
//    hours' total. Using the share, not the raw count, means a weekend lull or OSAP adding new outlets does not look like a
//    spike or a drop everywhere at once.
//  - Spread is how much that share usually moves (1.4826 x the median absolute deviation, the robust stand-in for a standard
//    deviation), scaled the same way. It is never less than the square root of normal, the chance wobble of a count that size.
//  - Spike: at least MIN_N headlines, at least 2x normal, and at least 3 spreads above it. Above normal: the same with 1.5x.
//    Below normal: half of normal or less and 3 spreads under it (often a feed outage, not a quiet place).
// It counts headlines, not events: one story told by many outlets counts many times. A spike says "look here", nothing more.
//  - Too little history: fewer than 7 earlier windows with any OSAP reporting, or the place had headlines on fewer than 3 of
//    them (a data set just added, or a place OSAP has only started reading). It is shown with its count, and not judged.
export const BASE_WINDOWS = 14, MIN_BASE = 7, MIN_SEEN = 3, MIN_N = 10, Z = 3, SPIKE_X = 2, ABOVE_X = 1.5, BELOW_X = 0.5, HOUR_MS = 36e5;

export function median(a) {
  const s = a.filter((v) => Number.isFinite(v)).sort((x, y) => x - y), m = s.length >> 1;
  return !s.length ? NaN : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// windowOf(t, now) -> 0 for (now-24h, now], 1 for the 24 hours before, ...; -1 for a time after now (a future-dated headline)
export function windowOf(t, now, hours = 24) {
  if (!Number.isFinite(t) || t > now) return -1;
  return Math.floor((now - t) / (hours * HOUR_MS));
}

// score(counts, totals): counts[k] and totals[k] for windows 0..BASE_WINDOWS (index 0 = the last 24 hours).
// Returns { n, exp, lo, hi, x, z, lvl, nb } (nb: earlier windows with any headline for the place) with lvl "spike" | "above" | "below" | "normal" | "new" (too little history to judge).
export function score(counts, totals, o = {}) {
  const base = o.base || BASE_WINDOWS, minN = o.minN ?? MIN_N;
  const n = counts[0] || 0, T = totals[0] || 0, shares = [];
  let seen = 0;
  for (let k = 1; k <= base; k++) if (totals[k] > 0) { shares.push((counts[k] || 0) / totals[k]); if (counts[k] > 0) seen++; }
  if (shares.length < (o.minBase || MIN_BASE) || seen < (o.minSeen ?? MIN_SEEN) || !T) return { n, exp: null, lo: null, hi: null, x: null, z: null, lvl: "new", nb: seen };
  const ms = median(shares), mad = median(shares.map((s) => Math.abs(s - ms))) * 1.4826;
  const exp = ms * T, sd = Math.max(mad * T, Math.sqrt(Math.max(exp, 1)));
  const z = (n - exp) / sd, x = n / Math.max(exp, 1);
  let lvl = "normal";
  if (n >= minN && n >= SPIKE_X * exp && z >= Z) lvl = "spike";
  else if (n >= minN && n >= ABOVE_X * exp && z >= Z) lvl = "above";
  else if (exp >= minN && n <= BELOW_X * exp && z <= -Z) lvl = "below";
  const r1 = (v) => Math.round(v * 10) / 10;
  return { n, exp: r1(exp), lo: Math.max(0, Math.round(exp - sd)), hi: Math.round(exp + sd), x: Math.round(x * 100) / 100, z: r1(z), lvl, nb: seen };
}

// rank flagged places: spikes first, then above normal; within a level, the larger z first
export const RANK = { spike: 0, above: 1, below: 2, normal: 3, new: 4 };
export function rankFlagged(places) {
  return Object.entries(places).filter(([, p]) => p.lvl === "spike" || p.lvl === "above")
    .sort((a, b) => RANK[a[1].lvl] - RANK[b[1].lvl] || b[1].z - a[1].z || (a[0] < b[0] ? -1 : 1)).map(([id]) => id);
}
