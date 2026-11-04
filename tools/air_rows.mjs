// One aircraft as a fixed-order array (field names in FIELDS), shared by the GitHub sweep (tools/refresh_air.mjs) and the
// live area-on-screen relay (netlify/edge-functions/osap-air.js), so the page reads one format whichever path it came by.
// No imports: the edge function loads this file as it is.
export const num = (v, d) => (typeof v === "number" && isFinite(v) ? +v.toFixed(d) : null);
export const str = (v) => { const s = typeof v === "string" ? v.trim() : ""; return s ? s.slice(0, 40) : null; };
// one aircraft as a fixed-order array (field names are in the file's "f" list) to keep the files small
export const FIELDS = ["hex", "cs", "reg", "t", "desc", "lat", "lon", "alt", "gs", "trk", "pos", "src", "sqk", "cat", "fl"];
export function row(a, srcIdx, now) {
  const age = typeof a.seen_pos === "number" ? a.seen_pos : typeof a.seen === "number" ? a.seen : 0;
  const ground = a.alt_baro === "ground";
  // flags: 1 military (aggregator database), 2 placed by receiver timing (MLAT), 4 on the ground, 8 TIS-B relay
  const fl = ((a.dbFlags | 0) & 1 ? 1 : 0) | (Array.isArray(a.mlat) && a.mlat.length ? 2 : 0) | (ground ? 4 : 0) | (Array.isArray(a.tisb) && a.tisb.length ? 8 : 0);
  return [String(a.hex).toLowerCase(), str(a.flight), str(a.r), str(a.t), str(a.desc), num(a.lat, 4), num(a.lon, 4), ground ? null : num(a.alt_baro, 0),
    num(a.gs, 0), num(a.track ?? a.true_heading, 0), Math.round((now - age * 1000) / 1000), srcIdx, str(a.squawk), str(a.category), fl];
}

