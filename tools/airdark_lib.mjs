// Aircraft gone quiet mid-flight near hot spots. Rules "airdark-v1", fixed and versioned so every flag can be explained. Run
// inside the live air traffic sweep (tools/refresh_air.mjs) from what it already collects: no extra requests to anyone.
//
// What a flag is: an aircraft that was broadcasting its own ADS-B position regularly, airborne, well clear of the ground or of
// any airfield, inside one of the hot-spot boxes below, that the next sweeps no longer hear although they asked the receivers
// around both its last position and where it would be now at its last course and speed, and those receivers were hearing
// other aircraft there at the same time.
// What it is not: proof of anything. A transponder can be switched off or set to stop broadcasting position lawfully (many
// military and state aircraft fly that way all the time), it can fail, an aircraft can drop below the receivers' line of
// sight or land at a strip not in the airfield list, and a volunteer receiver can drop out between sweeps.
//
// Method, per sweep (about every five minutes):
//   - coverage: a 1-degree cell is covered when COV_MIN or more other aircraft with ADS-B positions under FRESH_S old are heard
//     in it in this sweep;
//   - a candidate is an aircraft in the previous sweep, not in this one, whose last report was: from adsb.fi or adsb.lol (not
//     OpenSky's snapshot, not placed by receiver timing (MLAT) or relayed (TIS-B)), airborne at ALT_MIN feet or more and at
//     GS_MIN knots or more, inside a hot-spot box, at least FIELD_NM from the nearest airfield (OurAirports), with a kept flight
//     of REG_PTS positions or more over REG_MIN minutes or more (tools/air_tracks.mjs);
//   - a sweep "should have heard it" when it asked a receiver circle covering both its last position and its dead-reckoned
//     position (last position moved on at its last ground speed and track), and both cells (or a neighbour) are covered;
//   - gone quiet: QUIET_MIN minutes or more since its last report with MISS_MIN or more such sweeps; it stays a candidate for
//     MAX_QUIET_H hours;
//   - heard again: a flagged aircraft that turns up again gets a "reappeared" event with the gap and the distance.
// Events are kept EVENT_KEEP_H hours. Registrations are not kept; call sign, type and the aggregator's own track link are.
export const RULES = "airdark-v1", SCHEMA = "osap-airdark/1";
export const COV_MIN = 3, FRESH_S = 120, ALT_MIN = 8000, GS_MIN = 150, FIELD_NM = 25, REG_PTS = 3, REG_MIN = 10;
export const QUIET_MIN = 10, MISS_MIN = 2, MAX_QUIET_H = 3, EVENT_KEEP_H = 24, MAX_EVENTS = 300, R_NM = 240;

// hot spots: [id, name, minLat, minLon, maxLat, maxLon]. Fixed list, named in every event; changing it changes RULES.
export const BOXES = [
  ["ukraine", "Ukraine, Black Sea and western Russia", 43.0, 22.0, 53.0, 42.0],
  ["baltic", "Baltic Sea and Kaliningrad", 53.5, 12.0, 60.5, 30.0],
  ["levant", "Eastern Mediterranean and the Levant", 29.0, 31.0, 37.5, 40.5],
  ["gulf", "Persian Gulf, Iraq and Iran", 23.0, 43.0, 38.0, 63.0],
  ["redsea", "Red Sea, Yemen and the Horn of Africa", 10.0, 36.0, 22.0, 51.0],
  ["kashmir", "India-Pakistan border and Kashmir", 29.0, 69.0, 37.0, 80.0],
  ["taiwan", "Taiwan Strait and around Taiwan", 20.0, 116.0, 27.0, 124.5],
  ["scs", "South China Sea", 5.0, 108.0, 20.0, 120.0],
  ["korea", "Korean Peninsula and the Sea of Japan approaches", 33.0, 124.0, 43.0, 132.5],
  ["caribbean", "Southern Caribbean and Venezuela", 8.0, -75.0, 16.0, -59.0],
];
export const REASONS = ["transponder switched off or set to stop broadcasting position (lawful in some cases; routine for many military and state flights)",
  "transponder failure", "flew below the receivers' line of sight or landed at a strip not in the airfield list", "a volunteer receiver dropped out between sweeps"];

export function nm(a, b, c, d) {
  const r = Math.PI / 180, x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2;
  return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(x)));
}
export function dest(la, lo, brgDeg, dNm) {
  const r = Math.PI / 180, d = dNm / 3440.065, b = brgDeg * r, p1 = la * r, l1 = lo * r;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [+(p2 / r).toFixed(4), +((((l2 / r) + 540) % 360) - 180).toFixed(4)];
}
export function boxOf(la, lo) { const b = BOXES.find((x) => la >= x[2] && la <= x[4] && lo >= x[3] && lo <= x[5]); return b ? b[0] : null; }
const cellKey = (la, lo) => Math.floor(la) + "_" + Math.floor(lo);
export function coverage(rows, nowS, isSweepSrc) {
  const c = new Map();
  for (const x of rows) {
    if (!Array.isArray(x) || !isSweepSrc(x[11]) || (x[14] & 10) || nowS - x[10] > FRESH_S) continue;
    const k = cellKey(x[5], x[6]); c.set(k, (c.get(k) || 0) + 1);
  }
  return c;
}
function covered(cov, la, lo) {
  // the cell or one of its 8 neighbours: an aircraft near a cell edge is heard by the same receivers
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if ((cov.get(cellKey(la + i, lo + j)) || 0) >= COV_MIN) return true;
  return false;
}
export function emptyState() { return { schema: "osap-airdark-state/1", rules: RULES, cand: {}, events: [] }; }

/** One sweep. st: state from the previous sweep (or emptyState()). prev, now: Map hex -> row (tools/air_rows.mjs FIELDS) of the
    previous and this sweep. circles: [[lat, lon], ...] receiver circles asked successfully this sweep. tracks: Map hex -> kept
    flight points [[t, lat, lon, alt, gnd], ...] from the previous sweep. fieldNm(la, lo): distance to the nearest airfield in nm,
    or Infinity / null when the list is missing (then no aircraft is a candidate: the airfield test cannot be done).
    isSweepSrc(i): true for adsb.fi / adsb.lol rows. Returns the new state (events included). */
export function step(st, prev, now, circles, tracks, nowS, fieldNm, isSweepSrc) {
  if (!st || st.rules !== RULES) st = emptyState();
  const cov = coverage(now.values(), nowS, isSweepSrc), cand = st.cand || {}, events = (st.events || []).filter((e) => nowS - e.t <= EVENT_KEEP_H * 3600);
  const asked = (la, lo) => circles.some((c) => nm(c[0], c[1], la, lo) <= R_NM);
  // new candidates: last sweep's aircraft not heard now
  for (const [h, x] of prev) {
    if (now.has(h) || cand[h]) continue;
    if (!isSweepSrc(x[11]) || (x[14] & 14) || typeof x[7] !== "number" || x[7] < ALT_MIN || !(x[8] >= GS_MIN) || typeof x[9] !== "number") continue;
    const box = boxOf(x[5], x[6]); if (!box) continue;
    const pts = (tracks && tracks.get(h)) || [];
    if (pts.length < REG_PTS || (pts[pts.length - 1][0] - pts[0][0]) / 60 < REG_MIN) continue;
    const f = fieldNm ? fieldNm(x[5], x[6]) : null;
    if (f == null || f < FIELD_NM) continue;
    cand[h] = { x: x.slice(), box, miss: 0, field_nm: Math.round(f), trail: pts.slice(-12).map((p) => [p[0], p[1], p[2], p[3]]) };
  }
  for (const [h, c] of Object.entries(cand)) {
    const x = c.x, quietS = nowS - x[10];
    if (now.has(h)) {
      const ev = events.find((e) => e.hex === h && e.k === "quiet" && !e.back);
      if (ev) {
        const y = now.get(h);
        ev.back = { t: y[10], lat: y[5], lon: y[6], alt: y[7], gap_min: Math.round((y[10] - x[10]) / 60), nm: Math.round(nm(x[5], x[6], y[5], y[6])) };
      }
      delete cand[h]; continue;
    }
    if (quietS > MAX_QUIET_H * 3600) { delete cand[h]; continue; }
    const dr = dest(x[5], x[6], x[9], x[8] * quietS / 3600);
    if (asked(x[5], x[6]) && asked(dr[0], dr[1]) && covered(cov, x[5], x[6]) && covered(cov, dr[0], dr[1])) c.miss++;
    if (!c.flagged && quietS >= QUIET_MIN * 60 && c.miss >= MISS_MIN) {
      c.flagged = true;
      events.push({ k: "quiet", hex: h, cs: x[1], type: x[3], desc: x[4], mil: !!(x[14] & 1), lat: x[5], lon: x[6], alt: x[7], gs: x[8], trk: x[9], sqk: x[12],
        last_t: x[10], t: nowS, box: c.box, field_nm: c.field_nm, misses: c.miss, dr, trail: c.trail, src: x[11] });
    } else if (c.flagged) {
      const ev = events.find((e) => e.hex === h && e.k === "quiet" && !e.back); if (ev) { ev.misses = c.miss; ev.dr = dr; }
    }
  }
  events.sort((a, b) => b.t - a.t);
  return { schema: "osap-airdark-state/1", rules: RULES, cand, events: events.slice(0, MAX_EVENTS) };
}
// the published file: the events, the boxes and the rules, nothing about candidates not yet flagged
export function publish(st, built, sources) {
  return { schema: SCHEMA, rules: RULES, built, boxes: BOXES.map((b) => ({ id: b[0], name: b[1], bbox: [b[3], b[2], b[5], b[4]] })),
    thresholds: { COV_MIN, FRESH_S, ALT_MIN, GS_MIN, FIELD_NM, REG_PTS, REG_MIN, QUIET_MIN, MISS_MIN, MAX_QUIET_H, EVENT_KEEP_H },
    reasons: REASONS, sources, watching: Object.keys(st.cand || {}).length, events: st.events || [] };
}
