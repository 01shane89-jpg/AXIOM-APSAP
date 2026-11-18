// Sensor check beside strike reports (tools/sensor_lib.mjs has the rules "sensor-v1"). Run by .github/workflows/refresh-conflicts.yml
// after the conflict tabs are refreshed, or by hand with Node 20+ from the repo root.
// Reads every listed conflict tab (data/live/conflicts/<id>.js, tools/conflicts.json) and NASA FIRMS's open VIIRS active-fire
// files for the last 24 hours (three satellites, no key; at most every 3 hours, FIRMS adds a pass about every 12 hours per
// satellite). Writes data/live/conflicts/sensors.js, window.OSAP_CF_SENSORS:
//   { schema, rules, asof (last FIRMS read), src: [{ sat, ok, rows | error }],
//     by: { conflict: { report fp: [{ km, h, t, sat, frp, conf }] } }, skipped: { conflict: n persistent detections left out } }
// and data/live/conflicts/sensors-state.json, this job's own memory between runs (the page never reads it): det, the
// detections kept near reports (72 h), and hist, { 2 km cell: [UTC days seen] } (10 days, for persistent heat). Rebuildable: delete the file and the next run
// starts again (persistent heat is then learned over 3 days). Logs carry counts only.
// Env: SENSORS_FORCE=1 (read FIRMS now), SENSORS_EVERY_H (3).
import fs from "node:fs";
import { RULES, parseFirms, eligible, addHistory, keepNear, pairReport } from "./sensor_lib.mjs";

const DIR = "data/live/conflicts", OUT = DIR + "/sensors.js", STATE = DIR + "/sensors-state.json", SCHEMA = "osap-cf-sensors/1";
const BASE = "https://firms.modaps.eosdis.nasa.gov/data/active_fire/";
export const FILES = [
  { sat: "NOAA-21", url: BASE + "noaa-21-viirs-c2/csv/J2_VIIRS_C2_Global_24h.csv" },
  { sat: "NOAA-20", url: BASE + "noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv" },
  { sat: "Suomi NPP", url: BASE + "suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv" },
];
const readJs = (f) => { try { const t = fs.readFileSync(f, "utf8"); return JSON.parse(t.slice(t.indexOf("={") + 1).replace(/;\s*$/, "")); } catch (e) { return null; } };
const readOut = () => { try { const t = fs.readFileSync(OUT, "utf8"); return JSON.parse(t.slice(t.indexOf("=") + 1).trim().replace(/;\s*$/, "")); } catch (e) { return null; } };
const readState = () => { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch (e) { return null; } };

const now = Date.now(), prev = { ...(readOut() || {}), ...(readState() || {}) };
const ids = JSON.parse(fs.readFileSync("tools/conflicts.json", "utf8")).conflicts.map((c) => c.id);
const items = {};
for (const id of ids) { const o = readJs(`${DIR}/${id}.js`); if (o && Array.isArray(o.items)) items[id] = o.items; }
const all = Object.values(items).flat(), elig = all.filter(eligible);

let det = Array.isArray(prev.det) ? prev.det : [], hist = prev.hist && typeof prev.hist === "object" ? prev.hist : {};
let asof = prev.asof || "", src = prev.src || [];
const due = process.env.SENSORS_FORCE || !asof || now - Date.parse(asof.replace(" ", "T")) >= Math.max(1, +(process.env.SENSORS_EVERY_H || 3)) * 36e5;
if (due) {
  src = []; let fresh = [];
  // a first run (no history yet) reads the 7-day files, so standing heat (flares, industry) is known from the start
  const cold = !Object.keys(hist).length;
  for (const f of FILES) {
    try {
      const r = await fetch(cold ? f.url.replace("_24h.csv", "_7d.csv") : f.url, { headers: { "user-agent": "AXIOM-OSAP/1.0 (situational awareness; sensor check)" }, signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const rows = parseFirms(await r.text(), f.sat);
      // the history learns from every detection near a report, whatever its age in the file, so standing heat is known
      fresh = fresh.concat(rows);
      src.push({ sat: f.sat, ok: true, rows: rows.length, file: cold ? "7d" : "24h" });
    } catch (e) { src.push({ sat: f.sat, ok: false, error: String(e.message || e).slice(0, 120) }); }
  }
  if (src.some((s) => s.ok)) {
    // persistent heat: every fresh detection within reach of a report counts toward its cell's days
    addHistory(hist, keepNear(fresh, elig, now - 10 * 864e5), now);
    det = keepNear(det.concat(fresh), elig, now);
    asof = new Date(now).toISOString().slice(0, 16).replace("T", " ") + "Z";
  }
}
addHistory(hist, [], now);   // trims the history to its 10 days

const by = {}, skipped = {}, prevBy = prev.by || {};
let paired = 0;
for (const [id, list] of Object.entries(items)) {
  for (const i of list) {
    if (!eligible(i)) continue;
    let { pairs, skipped: s } = pairReport(i, det, hist);
    // a report older than the kept detections keeps the pairings it had
    if (!pairs.length && prevBy[id] && prevBy[id][i.fp]) pairs = prevBy[id][i.fp];
    if (s) skipped[id] = (skipped[id] || 0) + s;
    if (pairs.length) { (by[id] = by[id] || {})[i.fp] = pairs; paired++; }
  }
}
const body = { schema: SCHEMA, rules: RULES, asof, src, by, skipped };
fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(OUT, "window.OSAP_CF_SENSORS=" + JSON.stringify(body).replace(/<\//g, "<\\/") + ";\n");
fs.writeFileSync(STATE, JSON.stringify({ asof, src, det, hist }) + "\n");
console.log(`sensors ${RULES}: ${elig.length} reports checked, ${paired} with heat nearby, ${Object.values(skipped).reduce((a, b) => a + b, 0)} persistent left out; ` +
  `FIRMS ${due ? src.map((s) => s.sat + (s.ok ? " " + s.rows : " failed: " + s.error)).join(", ") : "not due (read " + asof + ")"}; kept ${det.length} detections, ${Object.keys(hist).length} cells`);
