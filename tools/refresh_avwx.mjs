// Airfield weather reports (METAR observations and TAF forecasts) for the Weather view, worldwide, no key.
//
//   node tools/refresh_avwx.mjs <outdir>            fetch from the Aviation Weather Center and write the cell files
//   node tools/refresh_avwx.mjs <outdir> <dir>      same, but read metars.cache.csv(.gz), tafs.cache.xml(.gz) and
//                                                   stations.cache.json(.gz) from <dir> (tests, no network)
//
// Source: NOAA / National Weather Service Aviation Weather Center (aviationweather.gov) data cache, which holds every METAR and
// TAF it receives from weather services worldwide over the WMO network, refreshed every minute. US Government work, public
// domain. The reports are the issuing weather service's own words (official observations and forecasts); this job only files
// them by place. aviationweather.gov sends no CORS headers, so the page cannot ask it directly: .github/workflows/refresh-avwx.yml
// runs this and publishes one small JSON file per 10° x 10° map cell on the live-avwx branch, which the page reads from
// raw.githubusercontent.com (CORS open). Nothing is committed to main.
//
// What is kept per airfield: the raw METAR (newest, no older than MAX_OBS_H) with the AWC's decoded wind, visibility, cloud,
// temperature, dew point, altimeter and flight category, and the raw TAF still in force. The raw text is the report; the
// decoded fields only drive the summary line and the colour, and the page always shows the raw text beside them.
import fs from "fs";
import path from "path";
import zlib from "zlib";

const OUT = process.argv[2] || "avwx-out";
const LOCAL = process.argv[3] || "";
const AWC = "https://aviationweather.gov/data/cache/";
const UA = "AXIOM-OSAP/1.0 (+https://01shane89-jpg.github.io/AXIOM-APSAP/; airfield weather in the Weather view)";
const CELL = 10, MAX_OBS_H = 6, MAX_BYTES = 60e6;
export const SCHEMA = "osap-avwx/1";

async function get(name) {
  if (LOCAL) {
    for (const f of [name, name.replace(/\.gz$/, "")]) {
      const p = path.join(LOCAL, f);
      if (fs.existsSync(p)) { const b = fs.readFileSync(p); return f.endsWith(".gz") ? zlib.gunzipSync(b).toString("utf8") : b.toString("utf8"); }
    }
    throw new Error("no " + name + " in " + LOCAL);
  }
  let last;
  for (let i = 0; i < 3; i++) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 60000);
    try {
      const r = await fetch(AWC + name, { headers: { "User-Agent": UA }, signal: ctl.signal });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const b = Buffer.from(await r.arrayBuffer());
      if (b.length > MAX_BYTES) throw new Error("answer too large (" + b.length + " bytes)");
      // fetch may already have undone the gzip transfer encoding; the file itself is gzip, so check the magic bytes
      return (b[0] === 0x1f && b[1] === 0x8b ? zlib.gunzipSync(b, { maxOutputLength: 4 * MAX_BYTES }) : b).toString("utf8");
    } catch (e) { last = e; await new Promise((r) => setTimeout(r, 5000 * (i + 1))); }
    finally { clearTimeout(t); }
  }
  throw new Error(name + ": " + (last && last.message || last));
}

/* CSV with quoted fields; the AWC cache file has a few lines of notes before the header row */
export function csvRows(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const num = (v) => { if (v == null || v === "") return null; const n = parseFloat(String(v).replace(/[+]/g, "")); return isFinite(n) ? n : null; };
const ms = (v) => { const t = Date.parse(v); return isFinite(t) ? t : null; };

export function parseMetars(text) {
  const rows = csvRows(text), h = rows.findIndex((r) => r.includes("raw_text") && r.includes("station_id"));
  if (h < 0) throw new Error("METAR file has no header row");
  const H = rows[h], col = (n) => H.indexOf(n), all = (n) => H.map((x, i) => (x === n ? i : -1)).filter((i) => i >= 0);
  const cRaw = col("raw_text"), cId = col("station_id"), cT = col("observation_time"), cLa = col("latitude"), cLo = col("longitude");
  const sky = all("sky_cover"), base = all("cloud_base_ft_agl");
  const out = [];
  for (const r of rows.slice(h + 1)) {
    if (r.length < H.length - 2 || !r[cId]) continue;
    const la = num(r[cLa]), lo = num(r[cLo]), t = ms(r[cT]);
    if (la == null || lo == null || t == null || Math.abs(la) > 90 || Math.abs(lo) > 180) continue;
    let cig = null; const layers = [];
    sky.forEach((ci, k) => {
      const cv = (r[ci] || "").trim(), b = num(r[base[k]]);
      if (!cv) return;
      layers.push(cv + (b != null ? String(Math.round(b / 100)).padStart(3, "0") : ""));
      if ((cv === "BKN" || cv === "OVC" || cv === "OVX") && b != null && (cig == null || b < cig)) cig = b;
    });
    const v = String(r[col("visibility_statute_mi")] || "");
    out.push({ id: r[cId].trim().toUpperCase(), la, lo, el: num(r[col("elevation_m")]),
      m: { raw: r[cRaw].trim(), t, cat: (r[col("flight_category")] || "").trim() || null, wd: /VRB/i.test(r[col("wind_dir_degrees")] || "") ? "VRB" : num(r[col("wind_dir_degrees")]),
        ws: num(r[col("wind_speed_kt")]), wg: num(r[col("wind_gust_kt")]), vis: num(v), visp: /\+/.test(v) || null, cig, sky: layers.join(" ") || null,
        tc: num(r[col("temp_c")]), dc: num(r[col("dewpoint_c")]), alt: num(r[col("altim_in_hg")]), wx: (r[col("wx_string")] || "").trim() || null } });
  }
  return out;
}

/* TAF XML: only the elements needed, read with patterns (the file is machine-written and flat per <TAF>) */
export function parseTafs(text) {
  const out = [], tag = (s, n) => { const m = new RegExp("<" + n + ">([\\s\\S]*?)</" + n + ">").exec(s); return m ? m[1].trim() : null; };
  const unx = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const re = /<TAF>([\s\S]*?)<\/TAF>/g; let m;
  while ((m = re.exec(text))) {
    const s = m[1], id = tag(s, "station_id"), raw = tag(s, "raw_text");
    if (!id || !raw) continue;
    out.push({ id: id.toUpperCase(), la: num(tag(s, "latitude")), lo: num(tag(s, "longitude")), el: num(tag(s, "elevation_m")),
      f: { raw: unx(raw).replace(/\s+/g, " "), it: ms(tag(s, "issue_time")), vf: ms(tag(s, "valid_time_from")), vt: ms(tag(s, "valid_time_to")) } });
  }
  return out;
}

/* station names and countries (stations.cache.json); optional, the reports stand without them */
export function parseStations(text) {
  const j = JSON.parse(text), list = Array.isArray(j) ? j : Array.isArray(j.features) ? j.features.map((f) => f.properties || {}) : [], out = new Map();
  for (const s of list) {
    const id = String(s.icaoId || s.station_id || s.id || "").toUpperCase();
    if (!id) continue;
    out.set(id, { n: String(s.site || s.name || "").trim().slice(0, 80) || null, c: String(s.country || "").trim().slice(0, 2).toUpperCase() || null, la: num(s.lat), lo: num(s.lon), el: num(s.elev) });
  }
  return out;
}

export function cellKey(la, lo) { return Math.floor(la / CELL) * CELL + "_" + Math.floor(Math.min(lo, 179.999) / CELL) * CELL; }

export function build(metars, tafs, stations, now) {
  const by = new Map();
  for (const x of metars) {
    if (now - x.m.t > MAX_OBS_H * 36e5 || x.m.t - now > 15 * 6e4) continue;
    const o = by.get(x.id);
    if (!o || !o.m || o.m.t < x.m.t) by.set(x.id, Object.assign(o || {}, { id: x.id, la: x.la, lo: x.lo, el: x.el, m: x.m }));
  }
  for (const x of tafs) {
    if (x.f.vt != null && x.f.vt < now) continue;
    const o = by.get(x.id) || { id: x.id, la: x.la, lo: x.lo, el: x.el };
    if (!o.f || (o.f.it || 0) < (x.f.it || 0)) o.f = x.f;
    if (o.la == null) { o.la = x.la; o.lo = x.lo; }
    by.set(x.id, o);
  }
  const cells = {};
  for (const o of by.values()) {
    const s = stations.get(o.id);
    if (s) { o.n = s.n; o.c = s.c; if (o.la == null) { o.la = s.la; o.lo = s.lo; } if (o.el == null) o.el = s.el; }
    if (o.la == null || o.lo == null) continue;
    const k = cellKey(o.la, o.lo);
    (cells[k] = cells[k] || []).push({ id: o.id, n: o.n || null, c: o.c || null, la: +o.la.toFixed(4), lo: +o.lo.toFixed(4), el: o.el, m: o.m || null, f: o.f || null });
  }
  for (const k in cells) cells[k].sort((a, b) => (a.id < b.id ? -1 : 1));
  return cells;
}

async function main() {
  const now = Date.now(), built = new Date(now).toISOString();
  const [mt, tt, st] = await Promise.all([get("metars.cache.csv.gz"), get("tafs.cache.xml.gz"), get("stations.cache.json.gz").catch((e) => { console.log("stations: " + e.message); return null; })]);
  const metars = parseMetars(mt), tafs = parseTafs(tt);
  let stations = new Map();
  try { if (st) stations = parseStations(st); } catch (e) { console.log("stations: " + e.message); }
  console.log(`read ${metars.length} METARs, ${tafs.length} TAFs, ${stations.size} station names`);
  // a broken or empty download must not replace good files with nothing: the workflow publishes only when this exits 0
  if (metars.length < 1000) throw new Error("only " + metars.length + " METARs read; not publishing");
  const cells = build(metars, tafs, stations, now);
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, "c"), { recursive: true });
  const idx = {}; let nm = 0, nf = 0;
  for (const k of Object.keys(cells).sort()) {
    const l = cells[k];
    fs.writeFileSync(path.join(OUT, "c", k + ".json"), JSON.stringify({ schema: SCHEMA, built, cell: k, st: l }));
    idx[k] = l.length; nm += l.filter((s) => s.m).length; nf += l.filter((s) => s.f).length;
  }
  fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify({ schema: SCHEMA, built, cell: CELL, metars: nm, tafs: nf, cells: idx,
    source: { name: "NOAA/NWS Aviation Weather Center", url: "https://aviationweather.gov/", licence: "US Government work (public domain)",
      note: "Official METAR observations and TAF forecasts as issued by each weather service, relayed by the AWC data cache." } }));
  console.log(`wrote ${Object.keys(idx).length} cells: ${nm} airfields with a METAR, ${nf} with a TAF`);
}

if (import.meta.url === "file://" + path.resolve(process.argv[1] || "")) main().catch((e) => { console.error(e.message || e); process.exit(1); });
