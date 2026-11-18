// Sensor picture beside a strike or outage report (rules "picture-v1"). Fixed and versioned so every line on the page can be
// traced to the rule that put it there. It adds four open readings to the satellite heat (sensor-v1) and seismic (seismic-v1)
// checks already paired with each report:
//   - GPS interference: the report's 1-degree cell in the GPS interference map (tools/gnss.mjs) for the report's UTC day, shown
//     only when that cell was judged (at least `min` aircraft-hours) and graded low, medium or high.
//   - Ships (AIS): ships gone quiet, reappearing or jumping position (tools/darkships_lib.mjs, dark-v1) within AIS_KM of the
//     report's pin, from AIS_BEFORE_H before to AIS_AFTER_H after it. Only the 14 chokepoint boxes are watched.
//   - Radiation: a watched nuclear site (tools/rad_lib.mjs, rad-v1) within RAD_KM of the pin, with what its nearby open sensors
//     read when the check ran. Only for reports newer than RAD_FRESH_H, since readings are current, not historical.
//   - Internet: an IODA outage signal for the report's country (data/live/outages.js) that overlaps the report's time by NET_H.
// Each is a reading that may relate, never a confirmation: interference, AIS gaps and outages have many causes, and a report
// can be pinned at the wrong town. The rules never rank, merge, judge or change a report.
import { eligible, km } from "./sensor_lib.mjs";

export const RULES = "picture-v1";
export const AIS_KM = 50, AIS_BEFORE_H = 24, AIS_AFTER_H = 12, AIS_MAX = 3;
export const RAD_KM = 100, RAD_FRESH_H = 24;
export const NET_H = 6, NET_MAX = 2;
// a report about an outage (power, internet, phone) gets a picture too, even when its kind is not a strike kind
export const OUTAGE = /\b(blackouts?|power (cuts?|outages?)|outages?|internet (shutdown|cut|blackout)s?|(phone|mobile|telecom\w*) (network )?(down|cut|outages?)|without (power|electricity|internet))\b/i;

const ms = (s) => { const t = Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(String(s || "")) ? s : String(s || "") + "Z"); return t; };
const day = (t) => new Date(t).toISOString().slice(0, 10);

/** a report that gets a sensor picture: a strike report (sensor-v1 eligible) or an outage report with a pin */
export function wanted(i) {
  if (eligible(i)) return true;
  return !!(i && OUTAGE.test(String(i.title_en || i.title || "")) && i.geo && i.geo.la != null && /^[0-9a-f]{64}$/.test(i.fp || "") && isFinite(ms(i.date)));
}

/** GPS interference: gday is one parsed data/live/gnss/<day>.json (schema osap-gnss/1); null or { day, level, pct, n } */
export function gnssFor(i, gday) {
  if (!gday || !Array.isArray(gday.cells) || !i.geo) return null;
  const t = ms(i.date); if (!isFinite(t) || String(gday.from || "").slice(0, 10) !== day(t)) return null;
  const deg = gday.deg || 1, la = Math.floor(i.geo.la / deg) * deg, lo = Math.floor(i.geo.lo / deg) * deg;
  const c = gday.cells.find((x) => x[0] === la && x[1] === lo); if (!c) return null;
  const n = c[2], bad = c[3]; if (!(n >= (gday.min || 10))) return null;
  const share = bad / n, L = gday.levels || { low: 0.1, medium: 0.25, high: 0.5 };
  const level = share >= L.high ? "high" : share >= L.medium ? "medium" : share >= L.low ? "low" : "";
  return level ? { day: day(t), level, pct: Math.round(share * 100), n, cell: la + "," + lo } : null;
}

/** Ships: ds is darkships.json (osap-darkships/1); events near the pin and time, closest first */
export function aisFor(i, ds) {
  if (!ds || !i.geo) return [];
  const t0 = ms(i.date), out = [];
  const add = (k, name, flag, la, lo, t, extra) => {
    const h = (ms(t) - t0) / 36e5; if (!(h >= -AIS_BEFORE_H && h <= AIS_AFTER_H)) return;
    const d = km(i.geo.la, i.geo.lo, la, lo); if (!(d <= AIS_KM)) return;
    out.push({ k, name: String(name || "").slice(0, 40), flag: String(flag || "").slice(0, 3), km: Math.round(d), h: Math.round(h * 10) / 10, t: String(t).slice(0, 16), ...extra });
  };
  for (const e of ds.events || []) {
    if ((e.k !== "jump" && e.k !== "reappeared") || !Array.isArray(e.to)) continue;
    add(e.k, e.name, e.flag, e.to[0], e.to[1], e.to[2], { gap_h: e.gap_h, jkm: e.km });
  }
  for (const q of Array.isArray(ds.quiet) ? ds.quiet : []) if (q && q.last) add("quiet", q.name, q.flag, q.la, q.lo, q.last, { gap_h: q.gap_h });
  out.sort((a, b) => a.km - b.km || Math.abs(a.h) - Math.abs(b.h));
  const seen = new Set();
  return out.filter((x) => { const key = x.k + x.name + x.t; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, AIS_MAX);
}

/** Radiation: rad is rad.json (osap-rad/1); the closest covered site within RAD_KM, for a report newer than RAD_FRESH_H */
export function radFor(i, rad, now = Date.now()) {
  if (!rad || !Array.isArray(rad.sites) || !i.geo) return null;
  const t0 = ms(i.date); if (!(now - t0 <= RAD_FRESH_H * 36e5)) return null;
  let best = null;
  for (const s of rad.sites) {
    if (!s.n) continue;
    const d = km(i.geo.la, i.geo.lo, s.la, s.lo); if (!(d <= RAD_KM)) continue;
    if (!best || d < best.km) best = { id: s.id, name: s.name, st: s.st, n: s.n, above: s.above || 0, km: Math.round(d), read: String(rad.built || "").slice(0, 16) };
  }
  return best;
}

/** Internet: ioda is window.ASAP_IODA (data/live/outages.js); outage signals for the report's country overlapping its time */
export function netFor(i, ioda) {
  const cc = String(i.cc || "").toLowerCase(), it = ioda && ioda.items && ioda.items[cc]; if (!it || !Array.isArray(it.list)) return [];
  const t0 = ms(i.date), out = [];
  for (const e of it.list) {
    const s = ms(e.start), end = s + (+e.minutes || 0) * 6e4; if (!isFinite(s)) continue;
    if (end < t0 - NET_H * 36e5 || s > t0 + NET_H * 36e5) continue;
    out.push({ start: String(e.start).slice(0, 16), minutes: Math.round(+e.minutes || 0), source: String(e.source || "").slice(0, 20), region: String(e.region || "").slice(0, 60), cc,
      gap: Math.max(0, s - t0, t0 - end) });
  }
  // a signal that covers the report time first, then the closest in time
  out.sort((a, b) => a.gap - b.gap);
  return out.slice(0, NET_MAX).map(({ gap, ...e }) => e);
}

/** the whole picture for one report; null when no reading applies. src: { gnss: { day: parsed }, ais, rad, ioda } */
export function pictureFor(i, src, now = Date.now()) {
  if (!wanted(i)) return null;
  const t = ms(i.date), p = {};
  const g = gnssFor(i, src.gnss && src.gnss[day(t)]); if (g) p.g = g;
  const a = aisFor(i, src.ais); if (a.length) p.a = a;
  const r = radFor(i, src.rad, now); if (r) p.r = r;
  const n = netFor(i, src.ioda); if (n.length) p.n = n;
  return Object.keys(p).length ? p : null;
}

/** keeps what an older run found for a part this run cannot see any more (aged-out AIS events, radiation read earlier) */
export function mergePrev(cur, prev) {
  if (!prev) return cur;
  const out = { ...(cur || {}) };
  for (const k of ["g", "a", "r", "n"]) if (out[k] == null && prev[k] != null) out[k] = prev[k];
  return Object.keys(out).length ? out : null;
}
