// Backup for NGA ASAM in the Red Sea, Gulf of Aden, Arabian Sea, Gulf of Oman and Persian Gulf: the UKMTO (UK Maritime
// Trade Operations, Royal Navy) incident list that https://www.ukmto.org/recent-incidents loads from its public API.
// Licence: www.ukmto.org is published under the Open Government Licence v3.0, so commercial reuse is allowed with the
// attribution line below; items are not nc. Probe approved by the owner 8 Nov 2026 14:17Z; plain requests, OSAP's own UA.
export const UKMTO_API = "https://sccd.royalnavy.mod.uk/api/ukmto/all";
export const UKMTO_PAGE = "https://www.ukmto.org/recent-incidents";
export const UKMTO_LIC = "Contains public sector information licensed under the Open Government Licence v3.0 (UKMTO)";

/** One incident of the API into an ASAM-shaped record, or null without a date or position, or older than a year. */
export function ukmtoIncident(x, now = Date.now()) {
  if (!x || typeof x !== "object") return null;
  const lat = Number(x.locationLatitude), lon = Number(x.locationLongitude), t = Date.parse(x.utcDateOfIncident || x.utcDateCreated || "");
  if (x.locationLatitude == null || x.locationLongitude == null || !isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0) || !isFinite(t)) return null;
  if (now - t > 365 * 864e5) return null;
  const iso = new Date(t).toISOString();
  const text = String(x.otherDetails || "").replace(/\s+/g, " ").trim().slice(0, 700);
  return { ref: "UKMTO " + (x.incidentNumber != null ? String(x.incidentNumber) : iso.slice(0, 10)), date: iso.slice(0, 10), time: iso.slice(11, 16).replace(":", "") + " UTC",
    lat: +lat.toFixed(4), lon: +lon.toFixed(4), victim: String(x.vesselType || "").trim().toLowerCase(), hostility: String(x.incidentTypeName || "Incident").trim(),
    navArea: "", subreg: "", text: text || String(x.place || "").trim() || "Position as reported to UKMTO", where: String(x.place || "").trim(), src: "ukmto", link: UKMTO_PAGE };
}

/** Reads the list. get(url, as) is the caller's fetch helper. Newest first. */
export async function ukmtoIncidents(get, now = Date.now()) {
  const list = await get(UKMTO_API);
  if (!Array.isArray(list)) throw new Error("not a list (API changed?)");
  const out = [];
  for (const x of list) { const r = ukmtoIncident(x, now); if (r && !out.some((o) => o.ref === r.ref)) out.push(r); }
  return out.sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1));
}
