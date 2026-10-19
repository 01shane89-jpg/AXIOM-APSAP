// GPS interference (jamming) map, inferred from what aircraft report about their own navigation accuracy. Same idea as
// gpsjam.org: an aircraft whose GPS is jammed or degraded says so in its ADS-B messages (low NIC / NACp), so where many
// aircraft in one place report poor accuracy at once, something there is interfering with GPS.
//
// tools/refresh_air.mjs calls this with every aircraft record adsb.fi and adsb.lol send (readsb format), before it trims
// them for the map. Verified 2026-10-19 (temporary probe workflow on claude/gps-jamming): both sources send nic, nac_p,
// nac_v, sil, version and type for nearly every aircraft, and gpsOkBefore / gpsOkLat / gpsOkLon for aircraft whose GPS
// was good earlier and has since been lost (readsb's own marker). Neither sends anything that marks spoofing, so this
// never claims spoofing.
//
// Method: the world is cut into 1° x 1° cells. Each hour, every aircraft (ICAO address) heard in a cell counts once in that
// cell: "bad" when any of its reports that hour had NACp < 8 or NIC < 7 or carried readsb's GPS-lost marker, otherwise
// "good". Positions placed by receiver timing (MLAT) or relayed (TIS-B, ADS-R) carry no accuracy of the aircraft's own and
// are left out; so are aircraft on the ground (where poor accuracy is ordinary). Completed hours are kept for 24 hours;
// adding them gives the rolling 24-hour map (data/live/gnss/latest.json) and one file per UTC day (<yyyy-mm-dd>.json, 14 kept).
// A cell needs at least MIN aircraft-hours to be judged; above BAD (10%) bad it is interference, graded low / medium / high.
// Few aircraft means no data, not no jamming.
import fs from "fs";
import path from "path";

export const DEG = 1, MIN = 10, BAD = 0.1, KEEP_DAYS = 14, HOUR = 3600e3;
export const LEVELS = [[0.5, "high"], [0.25, "medium"], [BAD, "low"]];

/** What one readsb aircraft record says about its GPS: null (not usable), 0 good, 1 bad, 3 bad with GPS lost. */
export function navState(a) {
  if (!a || typeof a !== "object" || !a.hex || String(a.hex).startsWith("~")) return null;
  if (typeof a.lat !== "number" || typeof a.lon !== "number" || a.alt_baro === "ground") return null;
  if (typeof a.gpsOkBefore === "number") return 3; // readsb: GPS was fine until this time, lost since
  if (!/^adsb_/.test(String(a.type || ""))) return null; // MLAT, TIS-B, ADS-R, Mode S: no accuracy from the aircraft itself
  const ml = Array.isArray(a.mlat) ? a.mlat : [];
  if (ml.indexOf("nic") >= 0 || ml.indexOf("nac_p") >= 0 || ml.indexOf("lat") >= 0) return null;
  if (typeof a.nic !== "number" || typeof a.nac_p !== "number") return null;
  return a.nac_p < 8 || a.nic < 7 ? 1 : 0;
}
export const cellOf = (lat, lon) => Math.floor(lat / DEG) * DEG + "_" + Math.floor((((lon + 180) % 360 + 360) % 360 - 180) / DEG) * DEG;
export const hourOf = (ms) => Math.floor(ms / HOUR) * HOUR;

export function emptyState() { return { schema: "osap-gnss-state/1", cur: null, hours: [] }; }
export function readState(file) {
  try { const s = JSON.parse(fs.readFileSync(file, "utf8")); if (s && s.schema === "osap-gnss-state/1" && Array.isArray(s.hours)) return s; } catch (e) { /* none yet */ }
  return emptyState();
}

/** Close the current hour if `now` is in a later one. Returns the hours closed (0 or 1). */
export function roll(state, now) {
  const h = hourOf(now), closed = [];
  if (state.cur && state.cur.h !== h) {
    const c = {};
    for (const [k, ac] of Object.entries(state.cur.c)) {
      let n = 0, b = 0, l = 0;
      for (const f of Object.values(ac)) { n++; if (f & 1) b++; if (f & 2) l++; }
      c[k] = [n, b, l];
    }
    const done = { h: state.cur.h, c };
    state.hours.push(done); closed.push(done);
    state.cur = null;
  }
  // keep the hours that end within the last 24 hours
  state.hours = state.hours.filter((x) => x.h + HOUR > h - 24 * HOUR).sort((a, b) => a.h - b.h);
  if (!state.cur) state.cur = { h, c: {} };
  return closed;
}
/** Count one aircraft record in the current hour (call roll first). */
export function add(state, a) {
  const s = navState(a); if (s == null) return false;
  const k = cellOf(a.lat, a.lon), hex = String(a.hex).toLowerCase(), cell = (state.cur.c[k] = state.cur.c[k] || {});
  cell[hex] = (cell[hex] | 0) | s;
  return true;
}
export function sum(hours) {
  const t = {};
  for (const x of hours) for (const [k, v] of Object.entries(x.c)) { const s = (t[k] = t[k] || [0, 0, 0]); s[0] += v[0]; s[1] += v[1]; s[2] += v[2]; }
  return t;
}
export function level(n, b) {
  if (!(n >= MIN)) return null;
  const r = b / n;
  if (r <= BAD) return "ok";
  for (const [x, name] of LEVELS) if (r >= x) return name;
  return "low";
}
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
export const SOURCES = [
  { name: "adsb.fi", site: "https://adsb.fi/", licence: "adsb.fi open data terms (non-commercial)", nc: true },
  { name: "adsb.lol", site: "https://adsb.lol/", licence: "ODbL 1.0", nc: false },
];
/** One output file: every cell with at least MIN aircraft-hours, as [south lat, west lon, aircraft-hours, bad, GPS lost]. */
export function build(hours, extra) {
  const t = sum(hours), cells = [];
  const counts = { ok: 0, low: 0, medium: 0, high: 0 };
  for (const [k, v] of Object.entries(t)) {
    const lv = level(v[0], v[1]); if (!lv) continue;
    counts[lv]++;
    const [la, lo] = k.split("_").map(Number);
    cells.push([la, lo, v[0], v[1], v[2]]);
  }
  cells.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const from = hours.length ? hours[0].h : 0, to = hours.length ? hours[hours.length - 1].h + HOUR : 0;
  return Object.assign({
    schema: "osap-gnss/1", from: from ? iso(from) : null, to: to ? iso(to) : null, hours: hours.length,
    deg: DEG, min: MIN, bad_share: BAD, levels: { low: BAD, medium: 0.25, high: 0.5 },
    f: ["lat", "lon", "n", "bad", "lost"], counts, cells,
    method: "Each hour every aircraft heard in a 1° cell counts once: bad if it reported NACp < 8, NIC < 7 or readsb's GPS-lost marker, else good. MLAT, TIS-B and ADS-R positions and aircraft on the ground are left out. A cell needs at least " + MIN + " aircraft-hours; more than 10% bad is shown as interference.",
    note: "Inferred from what aircraft report about their own navigation accuracy, not measured on the ground. Few aircraft means no data, not no jamming. Poor accuracy can also come from an aircraft's own equipment.",
    spoofing: null, spoofing_note: "Neither source marks spoofing, so this map does not tell jamming from spoofing.",
    sources: SOURCES,
  }, extra || {});
}
const DAY = /^\d{4}-\d{2}-\d{2}\.json$/;
/** Write latest.json and the UTC day file(s) of the hours just closed into dir; drop day files older than KEEP_DAYS. */
export function writeOut(dir, state, closed, now) {
  if (!closed.length) return [];
  fs.mkdirSync(dir, { recursive: true });
  const built = iso(now), today = iso(now).slice(0, 10);
  const cutoff = iso(now - KEEP_DAYS * 24 * HOUR).slice(0, 10);
  const wrote = [];
  for (const d of [...new Set(closed.map((x) => iso(x.h).slice(0, 10)))]) {
    const hs = state.hours.filter((x) => iso(x.h).slice(0, 10) === d);
    // an hour closed late (a gap between runs) must not overwrite a fuller day file with the few hours still kept
    let had = 0; try { had = JSON.parse(fs.readFileSync(path.join(dir, d + ".json"), "utf8")).hours | 0; } catch (e) { had = 0; }
    if (!hs.length || hs.length < had) continue;
    fs.writeFileSync(path.join(dir, d + ".json"), JSON.stringify(build(hs, { built, day: d, complete: hs.length >= 24 || d < today })));
    wrote.push(d + ".json");
  }
  const days = [];
  for (const f of fs.readdirSync(dir)) {
    if (!DAY.test(f)) continue;
    if (f.slice(0, 10) < cutoff) { fs.unlinkSync(path.join(dir, f)); continue; }
    days.push(f.slice(0, 10));
  }
  days.sort().reverse();
  fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(build(state.hours, { built, day: null, days })));
  wrote.push("latest.json");
  return wrote;
}
