// Seismic check beside strike reports, rules "seismic-v1", fixed and versioned so every pairing can be explained. Run by
// tools/refresh_sensors.mjs next to the satellite heat check (tools/sensor_lib.mjs, "sensor-v1"); same reports, same "may relate".
//
// What it is: a seismic event located by a public network close to a strike report in place and time, with what the network
// itself says it was. Large blasts are recorded by seismometers; networks review some events and label them (USGS type
// "explosion", "quarry blast", "nuclear explosion"; EMSC/QuakeML codes kx known explosion, sx suspected explosion, qb quarry
// blast, km/sm mining). OSAP never labels an event itself: it shows the network's label, magnitude and depth.
// What it is not: a confirmation, or a test of explosion against earthquake. Most strikes are far too small to record, network
// locations can be 10 km or more out, depths are often fixed by default (10 km) rather than measured, and quakes are common in
// many conflict areas. "Nothing recorded" never means "nothing happened".
// Rules "seismic-v1":
//   - reports: the same as sensor-v1 (eligible() in tools/sensor_lib.mjs);
//   - events: USGS (public domain) and EMSC (CC BY 4.0) catalogues, the same event in both kept once (within 20 km and 60 s);
//   - within NEAR_KM of the report's pin, from BEFORE_H hours before the report to AFTER_H after (reports come after events);
//   - left out: events deeper than MAX_DEPTH km unless the network labels them an explosion (a blast is at the surface; a
//     reliably deep event is not one), so default-depth 10 km events stay in;
//   - the closest three per report (score: distance over NEAR_KM plus hours apart over 24).
import { km, eligible } from "./sensor_lib.mjs";

export const RULES = "seismic-v1", NEAR_KM = 30, BEFORE_H = 24, AFTER_H = 3, MAX_DEPTH = 15, MAX = 3, KEEP_H = 96;
const ms = (s) => Date.parse(String(s || "").replace(" ", "T").slice(0, 16) + (/Z$/.test(String(s)) ? "" : "Z"));
export const EXPLOSIVE = /explosion|blast/i;
const QML = { ke: "earthquake", se: "suspected earthquake", kx: "explosion", sx: "suspected explosion", qb: "quarry blast", km: "mining explosion", sm: "suspected mining explosion", kr: "rockburst", sr: "suspected rockburst", ki: "induced event", si: "suspected induced event", kh: "other known event", uk: "not classified" };

/** USGS FDSN GeoJSON -> [{ id, net: "USGS", t (ISO), la, lo, dep, mag, magType, type, url, place }] */
export function parseUsgs(j) {
  const out = [];
  for (const f of (j && j.features) || []) {
    const p = f.properties || {}, c = (f.geometry && f.geometry.coordinates) || [];
    if (!isFinite(c[0]) || !isFinite(c[1]) || !isFinite(p.time)) continue;
    out.push({ id: "usgs:" + String(f.id || p.code || "").slice(0, 40), net: "USGS", t: new Date(p.time).toISOString().slice(0, 19) + "Z", la: +(+c[1]).toFixed(3), lo: +(+c[0]).toFixed(3),
      dep: isFinite(c[2]) ? +(+c[2]).toFixed(1) : null, mag: isFinite(p.mag) ? +p.mag : null, magType: String(p.magType || "").slice(0, 8), type: String(p.type || "earthquake").slice(0, 40),
      status: String(p.status || "").slice(0, 12), url: /^https:\/\/earthquake\.usgs\.gov\//.test(p.url || "") ? p.url : "", place: String(p.place || "").slice(0, 80) });
  }
  return out;
}
/** EMSC FDSN JSON -> same shape; EMSC depths are positive down in properties.depth */
export function parseEmsc(j) {
  const out = [];
  for (const f of (j && j.features) || []) {
    const p = f.properties || {}, la = +p.lat, lo = +p.lon, t = Date.parse(p.time);
    if (!isFinite(la) || !isFinite(lo) || !isFinite(t)) continue;
    const code = String(p.evtype || "").toLowerCase();
    out.push({ id: "emsc:" + String(p.unid || f.id || "").slice(0, 40), net: "EMSC", t: new Date(t).toISOString().slice(0, 19) + "Z", la: +la.toFixed(3), lo: +lo.toFixed(3),
      dep: isFinite(+p.depth) ? +(+p.depth).toFixed(1) : null, mag: isFinite(+p.mag) ? +p.mag : null, magType: String(p.magtype || "").slice(0, 8), type: QML[code] || "earthquake",
      code, status: String(p.auth || "").slice(0, 12), url: p.unid ? "https://www.seismicportal.eu/eventdetails.html?unid=" + encodeURIComponent(p.unid) : "", place: String(p.flynn_region || "").slice(0, 80) });
  }
  return out;
}
const labelledBlast = (e) => EXPLOSIVE.test(e.type) || /^(kx|sx|qb|km|sm)$/.test(e.code || "");

/** USGS first, then EMSC events not already there (within 20 km and 60 s); newer than KEEP_H before now */
export function merge(lists, now = Date.now()) {
  const out = [];
  for (const e of lists.flat()) {
    if (now - Date.parse(e.t) > KEEP_H * 36e5) continue;
    if (out.some((x) => x.net !== e.net && Math.abs(Date.parse(x.t) - Date.parse(e.t)) <= 60e3 && km(x.la, x.lo, e.la, e.lo) <= 20)) continue;
    if (out.some((x) => x.id === e.id)) continue;
    out.push(e);
  }
  return out;
}

/** report -> up to MAX pairings { km, h (hours, event minus report), t, net, mag, magType, dep, type, blast, url, place }; deep: events left out as deep */
export function pairSeismic(i, events) {
  if (!eligible(i)) return { pairs: [], deep: 0 };
  const t0 = ms(i.date), out = []; let deep = 0;
  for (const e of events) {
    const h = (Date.parse(e.t) - t0) / 36e5; if (!(h >= -BEFORE_H && h <= AFTER_H)) continue;
    const d = km(i.geo.la, i.geo.lo, e.la, e.lo); if (!(d <= NEAR_KM)) continue;
    const blast = labelledBlast(e);
    if (!blast && e.dep != null && e.dep > MAX_DEPTH) { deep++; continue; }
    out.push({ km: Math.round(d * 10) / 10, h: Math.round(h * 10) / 10, t: e.t, net: e.net, mag: e.mag, magType: e.magType, dep: e.dep, type: e.type, blast, url: e.url, place: e.place,
      score: d / NEAR_KM + Math.abs(h) / 24 });
  }
  out.sort((a, b) => a.score - b.score || (a.t < b.t ? -1 : 1));
  return { pairs: out.slice(0, MAX).map(({ score, ...p }) => p), deep };
}
