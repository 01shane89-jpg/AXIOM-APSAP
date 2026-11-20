// Vessels on the US Treasury OFAC SDN list, for flagging ships in "Ships gone quiet near chokepoints" (tools/darkships_lib.mjs).
// Source: OFAC's SDN.CSV (US government work, public domain; no key). Rows whose type is "vessel" are kept with their OFAC id,
// listed name, programme and the IMO and MMSI numbers OFAC gives in the remarks ("Vessel Registration Identification IMO
// 1234567", "MMSI 123456789"). Owners and other people or companies named in the row are never kept.
// What a match is: the ship's IMO number (or, weaker, its MMSI) equals a number on the list. An IMO number stays with the hull
// for life, so an IMO match is strong; an MMSI can be reassigned or faked, so an MMSI-only match is shown as "check the IMO".
// Neither says anything about the voyage, the gap or the cargo.
// Refreshed by tools/refresh_darkships.mjs at most once a day; the last good list is kept on the live-ais branch
// (sanctions.json) and used when OFAC cannot be read, with its date shown.
import { csvRows } from "./dense_lib.mjs";

export const SANC_SCHEMA = "osap-vessel-sanctions/1", SANC_MAX_AGE_H = 24, SANC_MAX_BYTES = 30e6;
export const SANC_SOURCE = { id: "ofac-sdn", name: "US Treasury OFAC SDN list", url: "https://sanctionssearch.ofac.treas.gov/",
  api: "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV", lic: "US government work, public domain", nc: false };

const clean = (s) => String(s == null ? "" : s).replace(/^-0-\s*$/, "").replace(/\s+/g, " ").trim();
/** SDN.CSV text (no header: ent_num, name, type, program, title, call sign, vessel type, tonnage, GRT, flag, owner, remarks) */
export function parseSdnVessels(text) {
  const out = [];
  for (const r of csvRows(String(text || ""))) {
    if (r.length < 12 || clean(r[2]).toLowerCase() !== "vessel") continue;
    const rem = clean(r[11]), imo = (rem.match(/\bIMO (\d{7})\b/) || [])[1] || "", mmsi = (rem.match(/\bMMSI (\d{9})\b/) || [])[1] || "";
    if (!imo && !mmsi) continue;
    out.push({ uid: clean(r[0]), name: clean(r[1]).slice(0, 60), prog: clean(r[3]).replace(/[\[\]]/g, "").slice(0, 80), imo, mmsi });
  }
  return out;
}
/** matcher (imo, mmsi) -> null | { by: "imo" | "mmsi", uid, name, prog, list } */
export function sanctionsMatcher(list) {
  const byImo = new Map(), byMmsi = new Map();
  for (const v of list || []) { if (v.imo && !byImo.has(v.imo)) byImo.set(v.imo, v); if (v.mmsi && !byMmsi.has(v.mmsi)) byMmsi.set(v.mmsi, v); }
  return (imo, mmsi) => {
    const v = (imo && byImo.get(String(imo))) || null, w = v ? null : (mmsi && byMmsi.get(String(mmsi))) || null, m = v || w;
    if (!m) return null;
    const r = { by: v ? "imo" : "mmsi", uid: m.uid, name: m.name, prog: m.prog, list: "OFAC SDN" };
    if (w && w.imo) r.listed_imo = w.imo; // MMSI-only: the IMO OFAC lists for that MMSI, to compare with the ship's own
    return r;
  };
}
