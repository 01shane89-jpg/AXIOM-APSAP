// Shipping chokepoints against a long baseline, and world commodity prices (rules "choke-v1").
// Pure functions used by tools/refresh_choke.mjs and tests/choke.test.mjs; no network here.
//  - chokeLong(rows, meta): IMF PortWatch daily transits per chokepoint -> last 7 days, the 4 weeks before, the same 4 weeks a
//    year earlier and the previous calendar year's daily average, with weekly averages for a sparkline. The existing dense feed
//    (tools/dense_nov8.mjs) compares only with the 4 weeks before, which hides a collapse that is months old (Hormuz since
//    1 Mar 2026: 7-day vs 4-week change about 0%, against the 2025 average -97%).
//  - readXlsxSheet(buf, name): the cells of one sheet of an .xlsx file (zip + XML), enough for the World Bank Pink Sheet.
//  - pinkSeries(cells, wanted): monthly series of the named commodity columns from the Pink Sheet "Monthly Prices" sheet.
//  - priceSummary(series): latest month, the month before, 12 months before, and the highest of the last 12 months.
// Counts are AIS-based: a ship that switches its transponder off is not counted, so a low count is "tracked transits", never
// "no ships". Prices are monthly averages as the World Bank publishes them; no cause is attributed here.
import zlib from "node:zlib";

export const RULES = "choke-v1";
const r1 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 10) / 10);
// no percentage against fewer than 1 ship a day (a tiny base gives absurd swings)
const pct = (a, b) => (a == null || b == null || !isFinite(a) || !isFinite(b) || b < 1 ? null : Math.round(((a - b) / b) * 100));
const DAY = 864e5;
const dms = (s) => Date.parse(String(s).slice(0, 10) + "T00:00:00Z");
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);

// rows: [{portid, date ("YYYY-MM-DD" or epoch ms), n_total, n_tanker}], meta: {portid: {name, lat, lon}}
export function chokeLong(rows, meta) {
  const by = {};
  for (const r of rows || []) {
    if (!r || !r.portid || !meta[r.portid]) continue;
    const t = typeof r.date === "number" ? r.date : dms(r.date);
    if (!isFinite(t)) continue;
    (by[r.portid] = by[r.portid] || new Map()).set(ymd(t), { t, n: +r.n_total || 0, k: +r.n_tanker || 0 });
  }
  const out = [];
  for (const id of Object.keys(by)) {
    const m = meta[id], days = [...by[id].values()].sort((a, b) => a.t - b.t);
    if (!days.length) continue;
    const last = days[days.length - 1].t;
    const win = (from, to) => days.filter((d) => d.t > from && d.t <= to);
    const avg = (a, f = "n") => (a.length ? a.reduce((s, d) => s + d[f], 0) / a.length : null);
    const w7 = win(last - 7 * DAY, last), w28 = win(last - 35 * DAY, last - 7 * DAY);
    const wy = win(last - 365 * DAY - 28 * DAY, last - 365 * DAY);
    const baseYear = new Date(last).getUTCFullYear() - 1;
    const wb = days.filter((d) => new Date(d.t).getUTCFullYear() === baseYear);
    // a base year needs most of its days, or the comparison is left out
    const baseOk = wb.length >= 300, yOk = wy.length >= 20;
    const a7 = avg(w7), a28 = avg(w28), ay = yOk ? avg(wy) : null, ab = baseOk ? avg(wb) : null;
    // weekly averages, oldest first, ending with the latest full 7 days
    const weeks = [];
    for (let end = last; end > last - 78 * 7 * DAY; end -= 7 * DAY) {
      const w = win(end - 7 * DAY, end);
      weeks.unshift(w.length >= 4 ? r1(avg(w)) : null);
    }
    out.push({
      id, name: m.name, lat: m.lat, lon: m.lon, last: ymd(last),
      avg7: r1(a7), prev28: r1(a28), yago28: r1(ay), base: ab == null ? null : { label: baseYear + " average", year: baseYear, v: r1(ab) },
      chg28: pct(a7, a28), chgYago: pct(a7, ay), chgBase: pct(a7, ab),
      tanker7: r1(avg(w7, "k")), tankerBase: baseOk ? r1(avg(wb, "k")) : null,
      weeks, weekEnd: ymd(last),
    });
  }
  // biggest fall against the base year first; chokepoints without a base year last
  return out.sort((a, b) => (a.chgBase == null) - (b.chgBase == null) || (a.chgBase ?? 0) - (b.chgBase ?? 0) || (b.avg7 ?? 0) - (a.avg7 ?? 0));
}

// ---------------------------------------------------------------- .xlsx (zip of XML parts)
function unzip(buf) {
  // central directory: end record at the tail
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip file");
  const n = buf.readUInt16LE(eocd + 10), off = buf.readUInt32LE(eocd + 16), files = {};
  let p = off;
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad zip directory");
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42), name = buf.toString("utf8", p + 46, p + 46 + nl);
    files[name] = { method, csize, lho };
    p += 46 + nl + el + cl;
  }
  return (name) => {
    const f = files[name]; if (!f) return null;
    const q = f.lho, nl = buf.readUInt16LE(q + 26), el = buf.readUInt16LE(q + 28), start = q + 30 + nl + el;
    const raw = buf.subarray(start, start + f.csize);
    if (f.method === 0) return raw.toString("utf8");
    if (f.method === 8) return zlib.inflateRawSync(raw).toString("utf8");
    throw new Error("zip method " + f.method);
  };
}
const unxml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, "&");
const colNum = (ref) => { let c = 0; for (const ch of ref.replace(/\d+$/, "")) c = c * 26 + (ch.charCodeAt(0) - 64); return c - 1; };

// -> array of rows, each an array of cell values (string or number); empty cells undefined
export function readXlsxSheet(buf, sheetName) {
  const get = unzip(buf);
  const wb = get("xl/workbook.xml"), rels = get("xl/_rels/workbook.xml.rels");
  if (!wb || !rels) throw new Error("not an xlsx workbook");
  const sh = [...wb.matchAll(/<sheet\b[^>]*\bname="([^"]*)"[^>]*\br:id="([^"]*)"/g)].find((m) => unxml(m[1]).trim() === sheetName);
  if (!sh) throw new Error("no sheet named " + sheetName);
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((t) => t.includes('Id="' + sh[2] + '"'));
  const target = rel && (rel.match(/Target="([^"]*)"/) || [])[1];
  if (!target) throw new Error("sheet target not found");
  const path = target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\.\//, "");
  const ssx = get("xl/sharedStrings.xml") || "";
  const ss = [...ssx.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unxml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
  const xml = get(path); if (!xml) throw new Error("sheet part missing");
  const rows = [];
  for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const ri = +((rm[1].match(/\br="(\d+)"/) || [])[1]) - 1; if (!(ri >= 0)) continue;
    const row = [];
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = (cm[1].match(/\br="([A-Z]+\d+)"/) || [])[1]; if (!ref) continue;
      const t = (cm[1].match(/\bt="(\w+)"/) || [])[1], body = cm[2] || "";
      const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let val;
      if (t === "s") val = v != null ? ss[+v] : undefined;
      else if (t === "inlineStr") val = unxml([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""));
      else if (t === "str") val = v != null ? unxml(v) : undefined;
      else if (v != null) val = isFinite(+v) ? +v : unxml(v);
      row[colNum(ref)] = val;
    }
    rows[ri] = row;
  }
  return rows;
}

// the commodities the app shows (Pink Sheet column titles, matched after trimming and case-folding)
export const PINK = [
  { id: "brent", col: "Crude oil, Brent", name: "Crude oil, Brent", unit: "$/barrel" },
  { id: "gas_eu", col: "Natural gas, Europe", name: "Natural gas, Europe", unit: "$/mmbtu" },
  { id: "lng_jp", col: "Liquefied natural gas, Japan", name: "LNG, Japan", unit: "$/mmbtu" },
  { id: "urea", col: "Urea", name: "Urea (fertilizer)", unit: "$/tonne" },
  { id: "dap", col: "DAP", name: "DAP (fertilizer)", unit: "$/tonne" },
  { id: "wheat", col: "Wheat, US HRW", name: "Wheat, US HRW", unit: "$/tonne" },
  { id: "rice", col: "Rice, Thai 5%", name: "Rice, Thai 5%", unit: "$/tonne" },
];
const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().toLowerCase();

// cells from readXlsxSheet(buf, "Monthly Prices"): a header row holding the commodity titles, then rows "2026M10", value, ...
export function pinkSeries(cells, wanted = PINK) {
  const hi = cells.findIndex((r) => r && r.some((c) => norm(c) === norm("Crude oil, Brent")));
  if (hi < 0) throw new Error("Pink Sheet header row not found");
  const hdr = cells[hi].map(norm), out = {};
  for (const w of wanted) {
    const ci = hdr.indexOf(norm(w.col)); if (ci < 0) continue;
    const s = [];
    for (let i = hi + 1; i < cells.length; i++) {
      const r = cells[i]; if (!r) continue;
      const m = String(r[0] == null ? "" : r[0]).trim().match(/^(\d{4})M(\d{2})$/); if (!m) continue;
      const v = r[ci];
      if (typeof v === "number" && isFinite(v)) s.push([m[1] + "-" + m[2], Math.round(v * 100) / 100]);
    }
    if (s.length) out[w.id] = s;
  }
  return out;
}

// series: [["YYYY-MM", value], ...] oldest first
export function priceSummary(series) {
  if (!Array.isArray(series) || !series.length) return null;
  const last = series[series.length - 1], at = (k) => series[series.length - 1 - k] || null;
  const prev = at(1), yago = series.find((x) => x[0] === (+last[0].slice(0, 4) - 1) + last[0].slice(4)) || null;
  const last12 = series.slice(-12), hi = last12.reduce((a, b) => (b[1] > a[1] ? b : a), last12[0]);
  const P = (x) => (x ? { m: x[0], v: x[1] } : null);
  return { latest: P(last), prev: P(prev), yago: P(yago), hi12: P(hi), chgPrev: prev ? pct(last[1], prev[1]) : null, chgYago: yago ? pct(last[1], yago[1]) : null, series: series.slice(-24) };
}
