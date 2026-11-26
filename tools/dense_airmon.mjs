// Official air monitor readings published by an agency during an incident response, registered into the dense open-data run
// (tools/refresh_dense.mjs). Added 26 Nov 2026: OSAP's posts on the Iowa Army Ammunition Plant detonation (25 Nov) checked the
// Army's "zero airborne lead" statement against EPA Region 7's own monitors, which OSAP did not carry. These are measurements
// by the agency, shown beside what officials and outlets say about them; a zero reading is what the monitor reported, not a
// finding that no lead was released.
// Each response in RESPONSES is one agency's public ArcGIS feature service (no key, no account). Add a new response here when an
// agency publishes one; nothing else needs to change.
// Licence: U.S. EPA (U.S. Government work, public domain).
import { feed, run } from "./dense_lib.mjs";
import { ccsAt, withOki } from "./geo_cc.mjs";

export const RESPONSES = [
  { id: "epa-r7-iaaap", agency: "U.S. EPA Region 7", event: "Iowa Army Ammunition Plant detonation response", pollutant: "lead",
    viewer: "https://experience.arcgis.com/experience/1ddcf8b9d8314971b00dac8893ae9cd6",
    readings: "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/IAAAP_Xact_Data_Public_Viewer/FeatureServer/0",
    stations: "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/Air_Sampling_and_Monitoring_Location/FeatureServer/0",
    // field names in the readings layer
    f: { time: "Mon_Date_Time", value: "Mon_Results", units: "Mon_Units", station: "Air_Station_ID", lat: "Latitude", lon: "Longitude" },
    // the reference level printed beside the readings, and why it is not a pass/fail line for one reading
    ref: { value: 0.15, units: "µg/m³", text: "U.S. lead air standard (NAAQS) 0.15 µg/m³, a rolling 3-month average, so a single reading is not compared against it directly" } },
];

const zt = (ms) => new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z";
const num = (v) => (v == null || v === "" || isNaN(+v) ? null : +v);
/** Readings rows -> one summary per monitor: { station, lat, lon, n, nonzero, latest {t, v}, max {t, v}, from, to, units } */
export function monitorSummary(rows, f) {
  const by = new Map();
  for (const a of rows) {
    const t = num(a[f.time]), v = num(a[f.value]), st = String(a[f.station] || "").trim();
    if (t == null || v == null || !st) continue;
    const o = by.get(st) || { station: st, lat: num(a[f.lat]), lon: num(a[f.lon]), n: 0, nonzero: 0, latest: null, max: null, from: t, to: t, units: String(a[f.units] || "").replace(/m3$/, "m³") };
    o.n++; if (v > 0) o.nonzero++;
    if (!o.latest || t > o.latest.t) o.latest = { t, v };
    if (!o.max || v > o.max.v || (v === o.max.v && t < o.max.t)) o.max = { t, v };
    o.from = Math.min(o.from, t); o.to = Math.max(o.to, t);
    by.set(st, o);
  }
  return [...by.values()].sort((a, b) => a.station.localeCompare(b.station));
}

feed("air-monitors", { name: "Official air monitor readings (incident responses)", org: "U.S. EPA", cat: "Environment",
  lic: "U.S. EPA, U.S. Government work (public domain)", url: RESPONSES[0].viewer, everyHours: 1 });
run("air-monitors", async (g) => {
  const items = [], globals = [], notes = [];
  for (const R of RESPONSES) {
    try {
      const rows = [];
      for (let off = 0; off < 50000; off += 1000) {
        const j = await g(R.readings + "/query?where=1%3D1&outFields=" + Object.values(R.f).join(",") + "&orderByFields=objectid&resultOffset=" + off + "&resultRecordCount=1000&f=json", "json", { timeout: 60000 });
        if (j.error) throw new Error("readings query: " + (j.error.message || "error"));
        for (const x of j.features || []) rows.push(x.attributes);
        if (!j.exceededTransferLimit && (j.features || []).length < 1000) break;
      }
      const mons = monitorSummary(rows, R.f);
      if (!mons.length) throw new Error("no readings");
      for (const m of mons) {
        const u = m.units || R.ref.units;
        items.push({ title: R.agency + " " + R.pollutant + " monitor " + m.station + ": latest " + m.latest.v + " " + u + " (" + zt(m.latest.t) + "), highest " + m.max.v + " " + u + " (" + zt(m.max.t) + ")",
          detail: m.n + " readings from " + zt(m.from) + " to " + zt(m.to) + ", " + m.nonzero + " above zero. " + R.event + ". " + R.ref.text + ". Measured and published by " + R.agency + ".",
          date: new Date(m.latest.t).toISOString(), lat: m.lat, lon: m.lon, url: R.viewer, sev: m.max.v >= R.ref.value ? 3 : 1, kind: "Air monitor reading (official)", value: m.max.v,
          ccs: withOki(ccsAt(m.lat, m.lon, 0.5)) });
      }
      const all = mons.reduce((s, m) => ({ n: s.n + m.n, nz: s.nz + m.nonzero, max: !s.max || m.max.v > s.max.v ? { ...m.max, st: m.station } : s.max }), { n: 0, nz: 0, max: null });
      const first = items[items.length - mons.length];
      globals.push({ ...first, title: R.agency + ": " + R.event + ", " + mons.length + " " + R.pollutant + " monitors, " + all.n + " readings, " + all.nz + " above zero, highest " + all.max.v + " " + (mons[0].units || R.ref.units) + " (" + all.max.st + ")", ccs: undefined });
      // where the agency samples (instruments named by the agency)
      if (R.stations) {
        try {
          const s = await g(R.stations + "/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&resultRecordCount=2000&f=json", "json", { timeout: 60000 });
          for (const x of s.features || []) {
            const a = x.attributes || {}, p = x.geometry || {}; if (!isFinite(p.y) || !isFinite(p.x)) continue;
            items.push({ title: R.agency + " air sampling station " + (a.Station_ID || a.OBJECTID), detail: (a.Instrument_Type ? "Instruments: " + a.Instrument_Type + ". " : "") + R.event + ".",
              lat: p.y, lon: p.x, url: R.viewer, sev: 1, kind: "Air sampling station (official)", ccs: withOki(ccsAt(p.y, p.x, 0.5)) });
          }
        } catch (e) { notes.push(R.id + " stations: " + e.message); }
      }
      notes.push(R.id + ": " + mons.length + " monitors, " + rows.length + " readings");
    } catch (e) { notes.push(R.id + ": " + e.message); }
  }
  if (!globals.length) throw new Error(notes.join("; ") || "no responses read");
  return { items, globals, note: notes.join("; ") };
});
