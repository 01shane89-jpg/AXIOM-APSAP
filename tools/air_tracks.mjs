// The current flight of every aircraft in the live air traffic sweep (tools/refresh_air.mjs), so the map can draw where a
// selected aircraft has been since it took off (assets/osap-traffic.js, "paths"). Each sweep (about every five minutes) adds
// the position it has for an aircraft to the flight kept from the previous sweep, and writes 256 small files by the first two
// hex digits of the ICAO address, so the page reads exactly one file for the aircraft it is asked about:
//   t/<xx>.json  { schema: "osap-air-tracks/2", built, f: [...], tr: { <hex>: [[t, lat, lon, alt, gnd], ...] }, dep: { <hex>: [...] } }
// t: Unix seconds of the position (as reported); lat/lon to 3 decimals (about 100 m); alt: feet (barometric) or null; gnd: 1 on
// the ground. dep, where known: [ident, name, distance nm, Unix seconds], the airfield nearest to where the flight was first
// heard on the ground or climbing out (OurAirports, public domain). That is an inference from positions, not a filed flight plan.
// A new flight starts when an aircraft heard on the ground is next heard airborne, or after an hour not heard (it may have
// landed somewhere without receivers). Points are as reported, about five minutes apart: straight lines between them, nothing
// invented in between. Built only from what the sweep already collects (adsb.fi, adsb.lol, OpenSky's world snapshot).
// Why here and not asked per aircraft: OpenSky's flight track endpoint does not answer OSAP's Netlify server (it times out),
// and adsb.fi / adsb.lol keep their flight histories behind their own map pages (403 to other callers), which OSAP does not
// go past. Paths therefore build up from when this started; a flight already airborne then has no departure.
import fs from "fs";
import path from "path";

export const KEEP_S = 20 * 3600, NEW_AFTER_S = 3600, MAX_PTS = 300, DEP_NM = 8, DEP_ALT = 5000;
export const TF = ["t", "lat", "lon", "alt", "gnd"], DF = ["ident", "name", "nm", "t"];
export const fileOf = (hex) => String(hex).slice(0, 2).toLowerCase();

// every previous file -> { tr: Map hex -> points, dep: Map hex -> dep }
export function readTracks(dir) {
  const tr = new Map(), dep = new Map();
  let files = [];
  try { files = fs.readdirSync(path.join(dir, "t")); } catch (e) { return { tr, dep }; }
  for (const f of files) {
    let j; try { j = JSON.parse(fs.readFileSync(path.join(dir, "t", f), "utf8")); } catch (e) { continue; }
    if (!j || j.schema !== "osap-air-tracks/2" || !j.tr) continue;
    for (const [h, pts] of Object.entries(j.tr)) if (Array.isArray(pts)) tr.set(h, pts.filter((p) => Array.isArray(p) && p.length >= 3));
    for (const [h, d] of Object.entries(j.dep || {})) if (Array.isArray(d)) dep.set(h, d);
  }
  return { tr, dep };
}

/* ---------- airfields (OurAirports airports.csv) ---------- */
function csvRows(text) {
  const out = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); out.push(row); row = []; cur = ""; }
    else if (c !== "\r") cur += c;
  }
  if (cur || row.length) { row.push(cur); out.push(row); }
  return out;
}
const KEEP_TYPES = new Set(["large_airport", "medium_airport", "small_airport", "heliport", "seaplane_base"]);
// -> grid of 1° squares -> [[lat, lon, ident, name, rank]]; rank prefers real airports over heliports at the same distance
export function loadAirfields(file) {
  let text; try { text = fs.readFileSync(file, "utf8"); } catch (e) { return null; }
  const rows = csvRows(text), h = rows.shift() || [], ix = (k) => h.indexOf(k);
  const iT = ix("type"), iN = ix("name"), iLa = ix("latitude_deg"), iLo = ix("longitude_deg"), iId = ix("ident"), iIc = ix("icao_code"), iG = ix("gps_code");
  if (iT < 0 || iLa < 0 || iLo < 0) return null;
  const g = new Map();
  let n = 0;
  for (const r of rows) {
    if (!KEEP_TYPES.has(r[iT])) continue;
    const la = +r[iLa], lo = +r[iLo];
    if (!isFinite(la) || !isFinite(lo)) continue;
    const id = (iIc >= 0 && r[iIc]) || (iG >= 0 && r[iG]) || r[iId] || "";
    const rank = r[iT] === "large_airport" ? 0 : r[iT] === "medium_airport" ? 1 : r[iT] === "small_airport" ? 2 : 3;
    const k = Math.floor(la) + "_" + Math.floor(lo);
    if (!g.has(k)) g.set(k, []);
    g.get(k).push([la, lo, String(id).slice(0, 8), String(r[iN] || "").slice(0, 80), rank]); n++;
  }
  g.count = n;
  return g;
}
function nm(a, b, c, d) {
  const r = Math.PI / 180, x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2;
  return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(x)));
}
// the airfield nearest to a point, within DEP_NM; heliports only when nothing else is that close
export function nearestAirfield(g, la, lo) {
  if (!g) return null;
  let best = null;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const lon = Math.floor(lo) + j, k = Math.floor(la) + i + "_" + (((lon + 180) % 360 + 360) % 360 - 180);
    for (const a of g.get(k) || []) {
      const d = nm(la, lo, a[0], a[1]);
      if (d > DEP_NM) continue;
      const score = d + (a[4] === 3 ? DEP_NM : 0);
      if (!best || score < best.score) best = { a, d, score };
    }
  }
  return best ? [best.a[2], best.a[3], +best.d.toFixed(1)] : null;
}

// distance in nm to the nearest airfield of any kept type (for tools/airdark_lib.mjs); Infinity when none within about 60 nm
export function airfieldNm(g, la, lo) {
  if (!g) return null;
  let best = Infinity;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const lon = Math.floor(lo) + j, k = Math.floor(la) + i + "_" + (((lon + 180) % 360 + 360) % 360 - 180);
    for (const a of g.get(k) || []) { const d = nm(la, lo, a[0], a[1]); if (d < best) best = d; }
  }
  return best;
}
// add this sweep's rows (air_rows.mjs format: [0] hex, [5] lat, [6] lon, [7] alt, [10] position time, [14] flags, 4 = ground)
// to the kept flights. Only aircraft in this sweep are kept (one not heard again stops being written). -> { tr, dep }
export function step(prev, rows, nowS, fields) {
  const tr = new Map(), dep = new Map();
  for (const x of rows) {
    if (!Array.isArray(x) || !x[0] || typeof x[5] !== "number" || typeof x[6] !== "number" || typeof x[10] !== "number") continue;
    const h = x[0], gnd = x[14] & 4 ? 1 : 0;
    const pt = [Math.round(x[10]), +x[5].toFixed(3), +x[6].toFixed(3), gnd ? null : typeof x[7] === "number" ? x[7] : null, gnd];
    let pts = (prev.tr.get(h) || []).filter((p) => nowS - p[0] <= KEEP_S && p[0] < pt[0]);
    let d = prev.dep.get(h) || null;
    const last = pts[pts.length - 1];
    if (last && (pt[0] - last[0] > NEW_AFTER_S || (last[4] && !gnd))) {
      // a new flight: after an hour unheard nothing is kept; after the ground, the last ground point is where it left from
      pts = pt[0] - last[0] > NEW_AFTER_S ? [] : [last];
      d = null;
    }
    if (gnd && last && last[4]) { pts = []; d = null; } // still on the ground: only the newest ground point is kept, and its airfield
    if (!(last && last[1] === pt[1] && last[2] === pt[2] && pts.length)) pts = pts.concat([pt]);
    if (pts.length > MAX_PTS) pts = pts.slice(-MAX_PTS);
    // where it left from: the first point of this flight, if heard on the ground, or low near an airfield and climbing (the
    // next point higher); a first point low and descending is an arrival, not a departure
    if (!d && fields) {
      const f = pts[0], n = pts[1];
      const climb = f && n && f[3] != null && f[3] < DEP_ALT && !n[4] && n[3] != null && n[3] > f[3] + 300;
      if (f && (f[4] || climb)) { const a = nearestAirfield(fields, f[1], f[2]); if (a) d = a.concat([f[0]]); }
    }
    tr.set(h, pts);
    if (d) dep.set(h, d);
  }
  return { tr, dep };
}

export function writeTracks(dir, T, built) {
  fs.mkdirSync(path.join(dir, "t"), { recursive: true });
  for (const f of fs.readdirSync(path.join(dir, "t"))) fs.unlinkSync(path.join(dir, "t", f));
  const files = {};
  for (const [h, pts] of T.tr) {
    const k = fileOf(h), o = files[k] || (files[k] = { tr: {}, dep: {} });
    o.tr[h] = pts; if (T.dep.has(h)) o.dep[h] = T.dep.get(h);
  }
  let pts = 0;
  for (const [k, o] of Object.entries(files)) {
    for (const p of Object.values(o.tr)) pts += p.length;
    fs.writeFileSync(path.join(dir, "t", k + ".json"), JSON.stringify({ schema: "osap-air-tracks/2", built, keep_s: KEEP_S, f: TF, df: DF, tr: o.tr, dep: o.dep }));
  }
  return { aircraft: T.tr.size, points: pts, dep: T.dep.size, files: Object.keys(files).length };
}
