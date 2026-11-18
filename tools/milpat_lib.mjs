// Military flight patterns and emergency squawks, rules "milpat-v1", fixed and versioned so every flag can be explained.
// Used by tools/refresh_drones.mjs (military aircraft trails, up to 60 minutes) and tools/refresh_air.mjs (world sweep).
//
// Orbit: an aircraft circling or flying a racetrack over one area, read from its own broadcast positions. Common for
// surveillance and reconnaissance, air-to-air refuelling tracks, airborne early warning, training areas, search and rescue and
// plain holding before landing. The flag names the shape only, never a mission. Rules:
//   - at least MIN_PTS positions spanning MIN_MIN minutes or more, airborne, the last at MIN_KT knots or more (not a helicopter
//     hovering or a slow taxi);
//   - the heading turns the same way overall by TURN_DEG degrees or more (the sum of the signed turns between legs, so a
//     zig-zag cancels out), counting only legs of LEG_KM km or more (position noise is not a turn);
//   - every position within MAX_KM of the trail's middle: an orbit stays over one area; a long transit with one turn does not.
// Emergency squawk: transponder code 7500 (unlawful interference), 7600 (radio failure) or 7700 (general emergency), as
// broadcast. Not confirmed: codes are also set by mistake and in exercises.
export const RULES = "milpat-v1";
export const MIN_PTS = 6, MIN_MIN = 15, MIN_KT = 120, TURN_DEG = 330, LEG_KM = 1, MAX_KM = 90;
export const EMERG = { "7500": "unlawful interference", "7600": "radio failure", "7700": "general emergency" };

export function km(a, b, c, d) {
  const r = Math.PI / 180, x = Math.sin((c - a) * r / 2), y = Math.sin((d - b) * r / 2);
  return 12742 * Math.asin(Math.sqrt(x * x + Math.cos(a * r) * Math.cos(c * r) * y * y));
}
function bearing(a, b, c, d) {
  const r = Math.PI / 180, y = Math.sin((d - b) * r) * Math.cos(c * r), x = Math.cos(a * r) * Math.sin(c * r) - Math.sin(a * r) * Math.cos(c * r) * Math.cos((d - b) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

/** trail: [[lat, lon, ms], ...] oldest first. a: the aircraft (gs knots, alt feet or "ground"). Returns null or
    { k: "orbit", rules, turn (degrees, signed: + clockwise), min (minutes spanned), km (furthest from the middle), c: [lat, lon] } */
export function orbitOf(trail, a = {}) {
  if (!Array.isArray(trail) || trail.length < MIN_PTS) return null;
  if (a.alt === "ground" || !(typeof a.gs === "number" && a.gs >= MIN_KT)) return null;
  const pts = trail.filter((p) => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]) && isFinite(p[2])).sort((x, y) => x[2] - y[2]);
  if (pts.length < MIN_PTS) return null;
  const min = (pts[pts.length - 1][2] - pts[0][2]) / 60e3;
  if (min < MIN_MIN) return null;
  // legs of at least LEG_KM, so jitter between near-identical positions is not read as turning
  const legs = []; let from = pts[0];
  for (let i = 1; i < pts.length; i++) {
    if (km(from[0], from[1], pts[i][0], pts[i][1]) < LEG_KM) continue;
    legs.push(bearing(from[0], from[1], pts[i][0], pts[i][1])); from = pts[i];
  }
  if (legs.length < MIN_PTS - 1) return null;
  let turn = 0;
  for (let i = 1; i < legs.length; i++) { let d = legs[i] - legs[i - 1]; if (d > 180) d -= 360; if (d < -180) d += 360; turn += d; }
  if (Math.abs(turn) < TURN_DEG) return null;
  const c = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  const far = Math.max(...pts.map((p) => km(c[0], c[1], p[0], p[1])));
  if (far > MAX_KM) return null;
  return { k: "orbit", rules: RULES, turn: Math.round(turn), min: Math.round(min), km: Math.round(far), c: [+c[0].toFixed(3), +c[1].toFixed(3)] };
}

// what an aircraft type is built for, from its public ICAO type designator: a fact about the type, not about this flight
export const ROLES = [
  [/^(R135|E8|E6|EP3|RC12|U2)$/, "reconnaissance or surveillance type"],
  [/^(Q1|Q4|Q9|HRON|TB2|AKNC|Q25)$/, "unmanned aircraft type"],
  [/^(E3TF|E3CF|E737|E7|E2|E2C|E2D|A50)$/, "airborne early warning type"],
  [/^(P8|P3|P1|ATL2|C295M|CN35M|P72)$/, "maritime patrol type"],
  [/^(K35R|KC35|K35E|KC10|KC46|B762|A332|A339|MRTT|IL78|KC2|KC30|K390)$/, "air-to-air refuelling (tanker) type, or an airliner type also used as one"],
  [/^(PC21|PC9|PC7|T6|TEX2|HAWK|T38|M346|L39|T45|K8|G120|SR22|DA42|TUCA|T7)$/, "trainer type"],
];
export function roleOf(t) { const s = String(t || "").toUpperCase(); for (const [re, r] of ROLES) if (re.test(s)) return r; return ""; }

/** the emergency squawks in a list of rows (any object with sqk, lat, lon) -> the same rows with what the code means */
export function emergencies(rows) {
  const out = [];
  for (const r of rows || []) if (r && EMERG[r.sqk] && isFinite(r.lat) && isFinite(r.lon) && r.alt !== "ground") out.push({ ...r, emerg: EMERG[r.sqk] });
  return out;
}
