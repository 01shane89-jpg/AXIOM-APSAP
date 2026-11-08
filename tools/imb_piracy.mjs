// Backup for NGA ASAM (msi.nga.mil answers HTTP 503 to the GitHub runners since 3 Nov 2026): the incidents on the
// IMB Piracy Reporting Centre live piracy map (https://icc-ccs.org/map/), read from the WP Go Maps REST routes that the
// public map page itself loads (wp-json/wpgmza/v1/maps, .../markers?filter={"map_id":"N"}, one map per year).
//
// Licence: ICC Commercial Crime Services site terms forbid reproduction of its material, so OSAP keeps only the facts
// of each incident (number, date, position, IMB's category, vessel type, the sea area named in the report) and links to
// the map. No report text is stored. Every item is nc:true, so it is dropped once OSAP is sold (tools/nc_strip.mjs).
export const IMB_MAP = "https://icc-ccs.org/map/";
export const IMB_API = "https://icc-ccs.org/wp-json/wpgmza/v1/";
export const IMB_LIC = "ICC Commercial Crime Services site terms (reproduction not allowed; facts and a link only)";
const CAT = { 1: "Attempted", 2: "Boarded", 3: "Fired upon", 4: "Hijacked", 5: "Suspicious approach" };
const VESSEL = /\b(bulk carrier|product tanker|chemical tanker|LPG tanker|LNG tanker|crude oil tanker|tanker|container ship|general cargo ship|general cargo|offshore supply vessel|supply vessel|tug|barge|fishing vessel|dhow|yacht|passenger ship|ro-ro|car carrier|heavy lift vessel|reefer|research vessel|vessel)\b/i;

/** The yearly maps to read: those titled with this year or last year (the ICC adds one map per year). */
export function imbMapIds(maps, now = Date.now()) {
  const y = new Date(now).getUTCFullYear();
  return (Array.isArray(maps) ? maps : []).filter((m) => m && (m.map_title === String(y) || m.map_title === String(y - 1))).map((m) => String(m.id));
}

const field = (x, re) => { const f = (x.custom_field_data || []).find((c) => re.test(c.name || "")); return f ? String(f.value || "") : ""; };

/** One marker into an ASAM-shaped record of facts, or null when it has no usable date or position or is older than a year. */
export function imbIncident(x, now = Date.now()) {
  if (!x || x.approved === "0") return null;
  const lat = parseFloat(x.lat), lon = parseFloat(x.lng), date = field(x, /^Date/i).slice(0, 10);
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !/^\d{4}-\d\d-\d\d$/.test(date)) return null;
  if (now - Date.parse(date) > 365 * 864e5) return null;
  const rep = field(x, /^Sitrep/i).replace(/\r/g, "");
  const no = field(x, /Incident Number/i) || String(x.title || "");
  const cat = (x.categories || []).map((c) => CAT[c]).filter(Boolean)[0] || "Incident";
  // the sea area the report names after the position ("Posn: 01:09.55N - 103:27.47E, Singapore Straits.")
  const pm = /Posn:[^,\n]*,\s*([^\n]{3,120}?)\.(\s|$)/i.exec(rep);
  const where = pm ? pm[1].replace(/\s+/g, " ").trim() : "";
  const tm = /\b(\d{4}) (?:UTC|LT)\b/.exec(rep);
  const vm = VESSEL.exec(rep);
  return { ref: "IMB " + no, date, time: tm ? tm[0] : "", lat: +lat.toFixed(4), lon: +lon.toFixed(4), victim: vm ? vm[1].toLowerCase() : "", hostility: cat,
    navArea: "", subreg: "", text: where || "Position as reported to IMB", where, src: "imb", link: IMB_MAP, nc: true };
}

/** Drops IMB incidents that NGA ASAM already lists (same day or next, within about 30 km). */
export function notInAsam(imb, asam) {
  return imb.filter((a) => !asam.some((b) => Math.abs(Date.parse(a.date) - Date.parse(b.date)) <= 864e5 && Math.abs(a.lat - b.lat) < 0.3 && Math.abs(a.lon - b.lon) < 0.3));
}

/** Reads the incidents of this year and last year. get(url, as) is the caller's fetch helper. */
export async function imbIncidents(get, now = Date.now()) {
  const ids = imbMapIds(await get(IMB_API + "maps"), now);
  if (!ids.length) throw new Error("no map for this year or last year (titles changed?)");
  const out = [];
  for (const id of ids) {
    const list = await get(IMB_API + "markers?filter=" + encodeURIComponent(JSON.stringify({ map_id: id })));
    for (const x of Array.isArray(list) ? list : []) { const r = imbIncident(x, now); if (r && !out.some((o) => o.ref === r.ref)) out.push(r); }
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}
