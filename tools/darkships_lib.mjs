// Ships gone quiet near chokepoints (AIS gaps) and AIS position jumps. Rules "dark-v1", fixed and versioned so every flag can
// be explained. Run by tools/refresh_darkships.mjs (.github/workflows/refresh-darkships.yml).
//
// Source: Open Waters AIS (ais.openwaters.io/v1/vessels, no key), which re-serves AISHub, Kystverket, Fintraffic, aisstream.io
// and volunteer receivers, each with its own licence. Open Waters is free for personal use only (commercial use is paid), so the
// source is tagged nc:true and the sold version does not ask it (tools/nc_strip.mjs). Terrestrial receivers only: no satellite
// AIS, so open sea and some straits (Bab al-Mandab on 18 Nov 2026) have no coverage at all, and the page says so.
//
// What a flag is: a ship that was transmitting regularly, under way, in an area where receivers are still hearing other ships
// now, and where it should still be in range if it kept its course and speed, yet has not been heard for QUIET_H hours or more.
// What it is not: proof of anything. A ship can switch AIS off lawfully (in war-risk areas such as the Gulf of Aden and Hormuz
// masters are told to consider it), its set can fail, a receiver can drop it, it can enter a port or anchorage out of range.
// A position jump is two reports from one MMSI that a ship could not sail between (over JUMP_KN); it can be spoofing, two ships
// sharing one MMSI, or a bad fix. Never an identification of wrongdoing.
//
// Method:
//   - each sweep asks every chokepoint box once (anonymous tier: one box of at most 100 square degrees, 120 requests a minute);
//   - a fix is a vessel's report with a newer `seen` time than the one already held; only kind "vessel" with a 9-digit MMSI,
//     never sailing or pleasure craft (types 36, 37), whose names are never kept;
//   - coverage: a 0.25-degree cell is covered in a sweep when COV_MIN or more vessels were heard in it within the last 30 minutes;
//     it is steadily covered when covered in at least COV_SWEEPS of the last COV_KEEP sweeps, counting the current one;
//   - a regular transmitter has REG_FIXES or more fixes spanning REG_MIN minutes or more;
//   - gone quiet: a regular transmitter whose last fix was under way (speed >= MIN_KN, status not at anchor, moored or aground),
//     silent for QUIET_H to MAX_QUIET_H hours, whose last position and dead-reckoned track (each hour, and now, at its last
//     course and speed) all stay inside the box and in or next to a steadily covered cell;
//   - reappeared: a ship flagged quiet that is heard again; the event keeps the gap and the distance between the two fixes;
//   - jump: two fixes of one MMSI at least JUMP_MIN_S seconds apart, JUMP_KM or more apart, implying over JUMP_KN knots.
//   Events are kept EVENT_KEEP_H hours; vessels not heard for STATE_KEEP_H hours are forgotten.
//
// Per-ship routes ("track-v1", TRACK below; they never change who is flagged): each held vessel keeps the positions it was heard
// at in this box over the last TRK_KEEP_H hours, at least TRK_STEP_MIN minutes apart (the newest always kept), at most TRK_MAX.
// A quiet ship carries that route up to its last report (`before`); a reappeared ship or a jump carries the route up to the
// gap or jump (`before`) and, for AFTER_H hours, the positions heard after it (`after`, filled in by later sweeps). Points are
// [lat, lon, ISO time] of real reports; the line between two of them is a straight join, not a measured route. The routes are
// a projection of the reports Open Waters served (same NC licence) and are rebuilt from scratch when state.json is deleted.
// Sanctions: a ship's IMO (or, weaker, MMSI) is compared with the vessels on the US Treasury OFAC SDN list
// (tools/vessel_sanctions.mjs); a match says the number is on the list, nothing about the voyage.
export const RULES = "dark-v1", SCHEMA = "osap-darkships/1";
export const CELL = 0.25, COV_MIN = 3, COV_KEEP = 6, COV_SWEEPS = 4, FRESH_MIN = 30;
export const REG_FIXES = 3, REG_MIN = 30, MIN_KN = 3, QUIET_H = 3, MAX_QUIET_H = 48;
export const JUMP_KN = 60, JUMP_KM = 10, JUMP_MIN_S = 60, EVENT_KEEP_H = 72, STATE_KEEP_H = 72, MAX_EVENTS = 400;
export const STOPPED_NAV = new Set([1, 5, 6]); // at anchor, moored, aground
export const PRIVATE_TYPES = new Set([36, 37]); // sailing, pleasure craft
export const TRACK = "track-v1", TRK_STEP_MIN = 10, TRK_KEEP_H = 6, TRK_MAX = 40, AFTER_H = 6, AFTER_MAX = 40;

export const SOURCE = { id: "openwaters", name: "Open Waters AIS", url: "https://openwaters.io/ais/", api: "https://ais.openwaters.io/v1/vessels",
  lic: "Free for personal use (commercial use is paid); each position keeps its source's own licence and credit", nc: true };

// [id, name, minLat, minLon, maxLat, maxLon]; each at most 100 square degrees (the anonymous tier's cap)
export const BOXES = [
  ["hormuz", "Strait of Hormuz", 24.5, 54.5, 27.5, 58.5],
  ["bab", "Bab al-Mandab", 11.5, 42.0, 14.5, 45.5],
  ["suez", "Suez Canal and Gulf of Suez", 27.5, 32.0, 31.6, 34.0],
  ["malacca", "Singapore and Malacca Straits", 0.8, 98.0, 6.5, 104.6],
  ["taiwan", "Taiwan Strait", 22.0, 117.5, 26.0, 121.0],
  ["korea", "Korea Strait", 33.5, 128.5, 35.5, 130.5],
  ["bosporus", "Bosporus and Dardanelles", 39.8, 25.8, 41.4, 29.4],
  ["kerch", "Kerch Strait", 44.8, 35.8, 45.8, 37.2],
  ["odesa", "Northwest Black Sea (Odesa approaches)", 44.5, 29.5, 46.7, 32.0],
  ["gibraltar", "Strait of Gibraltar", 35.5, -6.5, 36.5, -4.8],
  ["dover", "Dover Strait", 50.5, 0.8, 51.5, 2.2],
  ["danish", "Danish Straits", 54.8, 10.0, 56.2, 13.0],
  ["finland", "Gulf of Finland", 59.2, 22.5, 60.6, 30.3],
  ["panama", "Panama Canal approaches", 8.4, -80.2, 9.6, -79.2],
];
export const boxArea = (b) => (b[4] - b[2]) * (b[5] - b[3]);
export const inBox = (b, la, lo) => la >= b[2] && la <= b[4] && lo >= b[3] && lo <= b[5];

export function km(a, b, c, d) {
  const r = Math.PI / 180, x = Math.sin((c - a) * r / 2), y = Math.sin((d - b) * r / 2);
  return 12742 * Math.asin(Math.sqrt(x * x + Math.cos(a * r) * Math.cos(c * r) * y * y));
}
export const cellOf = (la, lo) => Math.floor(la / CELL) + ":" + Math.floor(lo / CELL);
/** where a ship at la, lo on course cog (degrees) at sog knots is after h hours (flat-earth step, fine for a few hundred km) */
export function deadReckon(la, lo, cog, sog, h) {
  const d = (sog * 1.852 * h) / 111.2, a = (cog * Math.PI) / 180;
  return [la + d * Math.cos(a), lo + (d * Math.sin(a)) / Math.max(0.05, Math.cos((la * Math.PI) / 180))];
}
const rnd = (x, n = 4) => +(+x).toFixed(n);

/** one GeoJSON feature to a fix { mmsi, la, lo, t (ms), sog, cog, nav, type, name, flag, src } or null when not usable */
export function toFix(f) {
  const p = f && f.properties, c = f && f.geometry && f.geometry.coordinates;
  if (!p || !Array.isArray(c) || typeof c[0] !== "number" || typeof c[1] !== "number") return null;
  if (p.kind && p.kind !== "vessel") return null;
  const mmsi = String(p.mmsi == null ? "" : p.mmsi);
  if (!/^[2-7]\d{8}$/.test(mmsi)) return null; // ships' MMSIs start with a country code 2 to 7; others are aids, aircraft, coast stations
  const t = Date.parse(p.seen);
  if (!isFinite(t) || Math.abs(c[1]) > 90 || Math.abs(c[0]) > 180) return null;
  const type = +p.type || 0;
  if (PRIVATE_TYPES.has(type)) return null;
  return { mmsi, la: rnd(c[1]), lo: rnd(c[0]), t, sog: typeof p.sog === "number" ? p.sog : null, cog: typeof p.cog === "number" ? p.cog : null,
    nav: typeof p.nav_status === "number" ? p.nav_status : null, type, name: String(p.name || "").slice(0, 40), flag: /^[A-Z]{2}$/.test(p.flag || "") ? p.flag : "",
    src: String(p.source || "").slice(0, 40), imo: /^\d{7}$/.test(String(p.imo == null ? "" : p.imo)) && +p.imo > 0 ? String(p.imo) : "" };
}

// route points: held as [lat, lon, minutes since 1970] (small state), published as [lat, lon, ISO time]
const tmin = (t) => Math.round(t / 60e3);
/** adds fix x to route trk (in place): the newest point always kept, earlier ones at least TRK_STEP_MIN apart, at most max */
export function addPoint(trk, x, max = TRK_MAX) {
  const p = [rnd(x.la, 3), rnd(x.lo, 3), tmin(x.t)], n = trk.length;
  if (n && p[2] <= trk[n - 1][2]) return trk; // not newer
  if (n >= 2 && trk[n - 1][2] - trk[n - 2][2] < TRK_STEP_MIN) trk[n - 1] = p; else trk.push(p); // the newest is provisional until TRK_STEP_MIN after the one before
  if (trk.length > max) trk.splice(0, trk.length - max);
  return trk;
}
/** route held for a vessel, cut to the TRK_KEEP_H hours before its newest point */
export function trimTrack(trk) {
  if (!Array.isArray(trk) || !trk.length) return [];
  const end = trk[trk.length - 1][2];
  return trk.filter((p) => end - p[2] <= TRK_KEEP_H * 60);
}
export const routeOut = (trk) => (trk || []).map((p) => [p[0], p[1], new Date(p[2] * 60e3).toISOString().slice(0, 16) + "Z"]);
const evKey = (e) => e.k + "|" + e.mmsi + "|" + e.to[2];

export function emptyState() { return { schema: "osap-darkships-state/1", rules: RULES, boxes: {}, events: [] }; }
function boxState(state, id) { return (state.boxes[id] = state.boxes[id] || { v: {}, cov: [] }); }

/** cells (keys) with COV_MIN or more vessels heard within FRESH_MIN minutes of now */
export function coverage(fixes, now) {
  const n = {};
  for (const x of fixes) if (now - x.t <= FRESH_MIN * 60e3) { const k = cellOf(x.la, x.lo); n[k] = (n[k] || 0) + 1; }
  return Object.keys(n).filter((k) => n[k] >= COV_MIN).sort();
}
/** steadily covered cells: in at least COV_SWEEPS of the kept sweeps */
export function steady(cov) {
  const c = {};
  for (const s of cov) for (const k of s.cells) c[k] = (c[k] || 0) + 1;
  return new Set(Object.keys(c).filter((k) => c[k] >= Math.min(COV_SWEEPS, Math.max(1, cov.length))));
}
export function nearCovered(set, la, lo) {
  const i = Math.floor(la / CELL), j = Math.floor(lo / CELL);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (set.has(i + a + ":" + (j + b))) return true;
  return false;
}
const underWay = (f) => f.sog != null && f.sog >= MIN_KN && !(f.nav != null && STOPPED_NAV.has(f.nav));

/** quiet check for one held vessel: null, or { gap_h, dr: [[la, lo], ...] } */
export function quietCheck(v, box, cover, now) {
  const f = v.last, gap = (now - f.t) / 36e5;
  if (!(gap >= QUIET_H && gap <= MAX_QUIET_H)) return null;
  if (!(v.n >= REG_FIXES && (f.t - v.first) >= REG_MIN * 60e3)) return null;
  if (!underWay(f) || f.cog == null || f.cog >= 360) return null;
  if (!nearCovered(cover, f.la, f.lo)) return null;
  const dr = [];
  for (let h = 1; h <= Math.ceil(gap); h++) {
    const p = deadReckon(f.la, f.lo, f.cog, f.sog, Math.min(h, gap));
    if (!inBox(box, p[0], p[1]) || !nearCovered(cover, p[0], p[1])) return null;
    dr.push([rnd(p[0], 3), rnd(p[1], 3)]);
  }
  return { gap_h: Math.round(gap * 10) / 10, dr };
}

/**
 * One sweep of one box. features: the API's GeoJSON features. Updates state in place; returns { fixes, cells, quiet, events }.
 * box: an entry of BOXES. now: ms.
 */
export function sweepBox(state, box, features, now, sanc = null) {
  const id = box[0], B = boxState(state, id), events = [];
  const held = new Map((state.events || []).map((e) => [evKey(e), e]));
  const hit = (x, p) => (sanc ? sanc(x.imo || (p && p.imo) || "", x.mmsi) : null);
  const fixes = [];
  for (const f of features || []) { const x = toFix(f); if (x && inBox(box, x.la, x.lo)) fixes.push(x); }
  const cells = coverage(fixes, now);
  B.cov.push({ t: now, cells }); B.cov = B.cov.slice(-COV_KEEP);
  for (const x of fixes) {
    const v = B.v[x.mmsi];
    if (!v) { B.v[x.mmsi] = { first: x.t, n: 1, last: x, trk: addPoint([], x) }; continue; }
    if (!(x.t > v.last.t)) continue; // nothing new heard
    const p = v.last, dt = (x.t - p.t) / 1000, d = km(p.la, p.lo, x.la, x.lo), kn = dt > 0 ? (d / 1.852) / (dt / 3600) : Infinity;
    const before = () => routeOut(trimTrack(v.trk || [[rnd(p.la, 3), rnd(p.lo, 3), tmin(p.t)]]));
    let ev = null;
    if (v.quiet) {
      ev = { k: "reappeared", box: id, mmsi: x.mmsi, name: x.name || p.name, type: x.type || p.type, flag: x.flag || p.flag,
        from: [p.la, p.lo, new Date(p.t).toISOString()], to: [x.la, x.lo, new Date(x.t).toISOString()], gap_h: Math.round((dt / 3600) * 10) / 10,
        km: Math.round(d * 10) / 10, kn: Math.round(kn * 10) / 10 };
      delete v.quiet;
    } else if (dt >= JUMP_MIN_S && d >= JUMP_KM && kn > JUMP_KN) {
      ev = { k: "jump", box: id, mmsi: x.mmsi, name: x.name || p.name, type: x.type || p.type, flag: x.flag || p.flag,
        from: [p.la, p.lo, new Date(p.t).toISOString()], to: [x.la, x.lo, new Date(x.t).toISOString()], gap_h: Math.round((dt / 3600) * 100) / 100,
        km: Math.round(d * 10) / 10, kn: Math.round(kn) };
    }
    if (ev) {
      const imo = x.imo || p.imo || "", sm = hit(x, p);
      if (imo) ev.imo = imo;
      if (sm) ev.sanc = sm;
      ev.before = before(); ev.after = routeOut([[rnd(x.la, 3), rnd(x.lo, 3), tmin(x.t)]]);
      events.push(ev);
      // the route after a gap starts afresh at the new fix; later sweeps add to ev.after for AFTER_H hours
      v.trk = []; v.ev = { key: evKey(ev), until: x.t + AFTER_H * 36e5 };
    } else if (v.ev) {
      const e = held.get(v.ev.key);
      if (!e || x.t > v.ev.until) delete v.ev;
      else {
        const a = (e.after || []).map((q) => [q[0], q[1], tmin(Date.parse(q[2]))]);
        e.after = routeOut(addPoint(a, x, AFTER_MAX));
      }
    }
    v.trk = trimTrack(addPoint(v.trk || [], x));
    v.n++; v.last = x;
  }
  const cover = steady(B.cov), quiet = [];
  for (const [mmsi, v] of Object.entries(B.v)) {
    if (now - v.last.t > STATE_KEEP_H * 36e5) { delete B.v[mmsi]; continue; }
    const q = quietCheck(v, box, cover, now);
    if (q) {
      v.quiet = 1;
      const f = v.last;
      const row = { box: id, mmsi, name: f.name, type: f.type, flag: f.flag, la: f.la, lo: f.lo, sog: f.sog, cog: f.cog, nav: f.nav, src: f.src,
        last: new Date(f.t).toISOString(), gap_h: q.gap_h, dr: q.dr, fixes: v.n,
        before: routeOut(trimTrack(v.trk && v.trk.length ? v.trk : [[rnd(f.la, 3), rnd(f.lo, 3), tmin(f.t)]])) };
      if (f.imo) row.imo = f.imo;
      const sm = hit(f, null); if (sm) row.sanc = sm;
      quiet.push(row);
    } else if (v.quiet && (now - v.last.t) / 36e5 > MAX_QUIET_H) delete v.quiet;
  }
  quiet.sort((a, b) => b.gap_h - a.gap_h || (a.mmsi < b.mmsi ? -1 : 1));
  return { fixes: fixes.length, cells: cells.length, steady: cover.size, quiet, events };
}

/** adds new events (dropping exact repeats), keeps EVENT_KEEP_H hours and at most MAX_EVENTS, newest first */
export function keepEvents(old, add, now) {
  const seen = new Set(), out = [];
  for (const e of add.concat(old || [])) {
    const k = e.k + "|" + e.mmsi + "|" + e.to[2];
    if (seen.has(k)) continue; seen.add(k);
    if (now - Date.parse(e.to[2]) > EVENT_KEEP_H * 36e5) continue;
    out.push(e);
  }
  out.sort((a, b) => (a.to[2] < b.to[2] ? 1 : a.to[2] > b.to[2] ? -1 : 0));
  return out.slice(0, MAX_EVENTS);
}
