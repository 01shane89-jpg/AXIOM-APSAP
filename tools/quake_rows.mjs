// USGS earthquake rows as data/live/quakes.js keeps them (tools/refresh_feeds.mjs writes the 7-day file; tools/flash_loop.mjs
// adds the newest hour's quakes to it every 30 seconds between refreshes).
export const USGS_WEEK = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson";
export const USGS_HOUR = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_hour.geojson";
const WEEK_MS = 7 * 864e5;

/* one GeoJSON feature to one row; null for anything that is not an earthquake with a magnitude */
export function quakeRow(f) {
  const p = (f && f.properties) || {}, c = ((f && f.geometry) || {}).coordinates || [];
  const q = { id: f && f.id, mag: p.mag, place: p.place || "", time: p.time, depth: c[2], lat: c[1], lon: c[0], url: p.url || "",
    tsunami: p.tsunami, alert: p.alert || null, status: p.status || "", type: p.type || "earthquake" };
  return q.id && q.type === "earthquake" && q.mag != null ? q : null;
}

/* the 7-day rows with the newest hour's rows laid over them: a quake USGS has revised replaces its old row, a new one is added,
   anything older than 7 days drops off, newest first. Returns { rows, added: [ids], changed: [ids] }. */
export function mergeQuakes(rows, hour, now) {
  const by = new Map((rows || []).map((q) => [q.id, q])), added = [], changed = [];
  for (const q of hour || []) {
    if (!q || !q.id) continue;
    const old = by.get(q.id);
    if (!old) added.push(q.id);
    else if (old.mag !== q.mag || old.status !== q.status || old.alert !== q.alert || old.tsunami !== q.tsunami || old.lat !== q.lat || old.lon !== q.lon) changed.push(q.id);
    else continue;
    by.set(q.id, q);
  }
  const out = [...by.values()].filter((q) => !(now - q.time > WEEK_MS)).sort((a, b) => (b.time || 0) - (a.time || 0));
  return { rows: out, added, changed };
}
