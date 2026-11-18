// Sensor check beside strike reports (competitor board "Only OSAP" #1, Shane 2026-11-18 "what does no one else deliver that OSAP
// can build?"). The rules, fixed and versioned so every pairing can be explained. Run by tools/refresh_sensors.mjs.
// What it is: satellite heat detections (VIIRS active fires, NASA FIRMS open 24-hour files, no key) near a conflict tab's report
// of a strike, in place and time. What it is not: a confirmation. A heat reading can be a crop fire, a flare, a forest fire or a
// different strike; a report can be placed at the wrong town. The page says "may relate" and shows distance and hours apart.
// Rules "sensor-v1":
//   - reports: violent kinds only (KINDS), never a reaction headline (NOT_EVENT: condemns, hearings, talks...), with a pin at a named site (within 10 km) or a town (within 25 km); never a province
//     or country pin;
//   - detections: VIIRS nominal or high confidence (low is dropped), from 36 hours before the report to 12 hours after it;
//   - persistent heat is left out: a 2 km cell (0.02 degrees) seen on 3 or more different UTC days in the last 10 is a standing
//     source (gas flare, industry, a long fire), not news, and is never paired;
//   - the closest three per report (score: distance over the radius, plus hours apart over 48).
export const RULES = "sensor-v1", BEFORE_H = 36, AFTER_H = 12, PERSIST_DAYS = 3, HIST_DAYS = 10, KEEP_H = 72, NEAR_KM = 30, MAX = 3;
export const KINDS = new Set(["missile", "drone", "airstrike", "attack", "ied", "ground", "maritime", "shelling", "explosion", "fire"]);
export const RADIUS = { site: 10, approx: 25 };

export function km(a, b, c, d) {
  const r = Math.PI / 180, x = Math.sin((c - a) * r / 2), y = Math.sin((d - b) * r / 2);
  return 12742 * Math.asin(Math.sqrt(x * x + Math.cos(a * r) * Math.cos(c * r) * y * y));
}
export const cell = (la, lo) => Math.round(la / 0.02) + ":" + Math.round(lo / 0.02);
const ms = (s) => Date.parse(String(s || "").replace(" ", "T").slice(0, 16) + (/Z$/.test(String(s)) ? "" : "Z"));

/** A FIRMS VIIRS CSV (header row) to [la, lo, t ISO minute, sat, frp, conf]; low confidence and bad rows dropped. sat is the
    satellite's name when given (the file is one satellite's), else the file's own code. */
export function parseFirms(text, satDefault = "") {
  const lines = String(text || "").split(/\r?\n/), head = (lines.shift() || "").split(",").map((s) => s.trim().toLowerCase()), ix = (k) => head.indexOf(k);
  const iLa = ix("latitude"), iLo = ix("longitude"), iD = ix("acq_date"), iT = ix("acq_time"), iS = ix("satellite"), iF = ix("frp"), iC = ix("confidence");
  if (iLa < 0 || iLo < 0 || iD < 0 || iT < 0) throw new Error("not a FIRMS CSV (columns " + head.slice(0, 8).join(",") + ")");
  const out = [];
  for (const l of lines) {
    if (!l) continue;
    const c = l.split(","), la = +c[iLa], lo = +c[iLo], conf = String(c[iC] || "").trim().toLowerCase();
    if (!isFinite(la) || !isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) continue;
    if (conf === "l" || conf === "low") continue;
    const hhmm = String(c[iT] || "").trim().padStart(4, "0"), d = String(c[iD] || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{4}$/.test(hhmm)) continue;
    out.push([+la.toFixed(4), +lo.toFixed(4), d + "T" + hhmm.slice(0, 2) + ":" + hhmm.slice(2), satDefault || String(c[iS] || "").trim(), +(+c[iF] || 0).toFixed(1), conf === "h" || conf === "high" ? "h" : "n"]);
  }
  return out;
}

/** a report the rules look at: a violent kind, a site or town pin, a fingerprint and a time */
// headlines about reactions, not events ("Qatar condemns...", "Senator grills...") are never paired, whatever their kind
export const NOT_EVENT = /\b(condemn\w*|denounc\w*|grill\w*|hearings?|vot(e|es|ed|ing)|sanction\w*|talks|meet(s|ing)|summit|interview|op-ed|opinion|analysis|explainer)\b/i;
export function eligible(i) {
  return !!(i && KINDS.has(i.kind) && !NOT_EVENT.test(String(i.title_en || i.title || "")) && i.geo && i.geo.la != null && RADIUS[i.geo.p] && /^[0-9a-f]{64}$/.test(i.fp || "") && isFinite(ms(i.date)));
}

/** hist: { cell: ["YYYY-MM-DD", ...] } updated with detections, trimmed to HIST_DAYS before now; returns the same object */
export function addHistory(hist, dets, now = Date.now()) {
  const from = new Date(now - HIST_DAYS * 864e5).toISOString().slice(0, 10);
  for (const d of dets) { const k = cell(d[0], d[1]), day = d[2].slice(0, 10), a = hist[k] || (hist[k] = []); if (!a.includes(day)) a.push(day); }
  for (const k of Object.keys(hist)) { hist[k] = hist[k].filter((x) => x >= from).sort(); if (!hist[k].length) delete hist[k]; }
  return hist;
}
export const persistent = (hist, la, lo) => ((hist[cell(la, lo)] || []).length >= PERSIST_DAYS);

/** keeps only detections within NEAR_KM of some eligible report and newer than KEEP_H, without duplicates */
export function keepNear(dets, reports, now = Date.now()) {
  const from = now - KEEP_H * 36e5, seen = new Set(), out = [];
  const pins = reports.filter(eligible).map((i) => [i.geo.la, i.geo.lo]);
  for (const d of dets) {
    const k = d[0] + "," + d[1] + "," + d[2] + "," + d[3]; if (seen.has(k)) continue;
    if (!(ms(d[2]) >= from)) continue;
    if (!pins.some((p) => Math.abs(p[0] - d[0]) < 0.5 && km(p[0], p[1], d[0], d[1]) <= NEAR_KM)) continue;
    seen.add(k); out.push(d);
  }
  return out;
}

/** report -> up to MAX pairings { km, h (hours, detection minus report), t, sat, frp, conf }; skipped: persistent cells left out */
export function pairReport(i, dets, hist) {
  if (!eligible(i)) return { pairs: [], skipped: 0 };
  const R = RADIUS[i.geo.p], t0 = ms(i.date), out = []; let skipped = 0;
  for (const d of dets) {
    const h = (ms(d[2]) - t0) / 36e5; if (!(h >= -BEFORE_H && h <= AFTER_H)) continue;
    const k = km(i.geo.la, i.geo.lo, d[0], d[1]); if (!(k <= R)) continue;
    if (persistent(hist, d[0], d[1])) { skipped++; continue; }
    out.push({ km: Math.round(k * 10) / 10, h: Math.round(h * 10) / 10, t: d[2], sat: d[3], frp: d[4], conf: d[5], score: k / R + Math.abs(h) / 48 });
  }
  out.sort((a, b) => a.score - b.score || (a.t < b.t ? -1 : 1));
  return { pairs: out.slice(0, MAX).map(({ score, ...p }) => p), skipped };
}
