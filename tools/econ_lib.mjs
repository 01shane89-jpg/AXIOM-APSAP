// Economic stress signals: the pure rules behind tools/refresh_econ.mjs (tested in tests/econ.test.mjs).
// Everything here is arithmetic on published figures. A "watch" flag is a computed signal that a figure moved fast, not an
// assessment: sharp currency falls and staple food or fuel price jumps often come before unrest, which is why they are shown.

// ---------- thresholds (shown in the app next to every flag) ----------
export const RULES = {
  fx30: -10,      // currency down more than 10% against the U.S. dollar in 30 days
  fx365: -30,     // currency down more than 30% against the U.S. dollar in a year
  food: 20,       // a staple food price up more than 20% on the month before
  fuel: 20,       // a fuel price up more than 20% on the month before
  staleDays: 150  // a price month older than this is shown but never flagged
};

// every country the app lists: iso2 -> currency (lowercase ISO 4217 as currency-api spells it). "usd" means it uses the dollar.
// Euro area as of 2026 (Bulgaria joined on 1 January 2026). Kosovo, Montenegro, Andorra, Monaco and San Marino use the euro.
export const CURRENCY = {
  th: "thb", vn: "vnd", kh: "khr", la: "lak", mm: "mmk", ph: "php", my: "myr", sg: "sgd", id: "idr", bn: "bnd", tl: "usd", cn: "cny",
  tw: "twd", kp: "kpw", kr: "krw", jp: "jpy", mn: "mnt", au: "aud", nz: "nzd", pg: "pgk", in: "inr", pk: "pkr", np: "npr", bt: "btn",
  bd: "bdt", lk: "lkr", mv: "mvr",
  af: "afn", al: "all", dz: "dzd", ad: "eur", ao: "aoa", ag: "xcd", ar: "ars", am: "amd", at: "eur", az: "azn", bs: "bsd", bh: "bhd",
  bb: "bbd", by: "byn", be: "eur", bz: "bzd", bj: "xof", bo: "bob", ba: "bam", bw: "bwp", br: "brl", bg: "eur", bf: "xof", bi: "bif",
  cv: "cve", cm: "xaf", ca: "cad", cf: "xaf", td: "xaf", cl: "clp", co: "cop", km: "kmf", cr: "crc", hr: "eur", cu: "cup", cy: "eur",
  cz: "czk", ci: "xof", cd: "cdf", dk: "dkk", dj: "djf", dm: "xcd", do: "dop", ec: "usd", eg: "egp", sv: "usd", gq: "xaf", er: "ern",
  ee: "eur", sz: "szl", et: "etb", fj: "fjd", fi: "eur", fr: "eur", ga: "xaf", gm: "gmd", ge: "gel", de: "eur", gh: "ghs", gr: "eur",
  gd: "xcd", gt: "gtq", gn: "gnf", gw: "xof", gy: "gyd", ht: "htg", hn: "hnl", hu: "huf", is: "isk", ir: "irr", iq: "iqd", ie: "eur",
  il: "ils", it: "eur", jm: "jmd", jo: "jod", kz: "kzt", ke: "kes", ki: "aud", xk: "eur", kw: "kwd", kg: "kgs", lv: "eur", lb: "lbp",
  ls: "lsl", lr: "lrd", ly: "lyd", li: "chf", lt: "eur", lu: "eur", mg: "mga", mw: "mwk", ml: "xof", mt: "eur", mh: "usd", mr: "mru",
  mu: "mur", mx: "mxn", fm: "usd", md: "mdl", mc: "eur", me: "eur", ma: "mad", mz: "mzn", na: "nad", nr: "aud", nl: "eur", ni: "nio",
  ne: "xof", ng: "ngn", mk: "mkd", no: "nok", om: "omr", pw: "usd", ps: "ils", pa: "usd", py: "pyg", pe: "pen", pl: "pln", pt: "eur",
  qa: "qar", cg: "xaf", ro: "ron", ru: "rub", rw: "rwf", kn: "xcd", lc: "xcd", vc: "xcd", ws: "wst", sm: "eur", sa: "sar", sn: "xof",
  rs: "rsd", sc: "scr", sl: "sle", sk: "eur", si: "eur", sb: "sbd", so: "sos", za: "zar", ss: "ssp", es: "eur", sd: "sdg", sr: "srd",
  se: "sek", ch: "chf", sy: "syp", st: "stn", tj: "tjs", tz: "tzs", tg: "xof", to: "top", tt: "ttd", tn: "tnd", tm: "tmt", tv: "aud",
  tr: "try", ug: "ugx", ua: "uah", ae: "aed", gb: "gbp", us: "usd", uy: "uyu", uz: "uzs", vu: "vuv", ve: "ves", eh: "mad", ye: "yer",
  zm: "zmw", zw: "zwg"
};
// the researched countries are not in data/basemap/world-countries.js, so their ISO 3166 alpha-3 codes are here
export const A3 = {
  th: "THA", vn: "VNM", kh: "KHM", la: "LAO", mm: "MMR", ph: "PHL", my: "MYS", sg: "SGP", id: "IDN", bn: "BRN", tl: "TLS", cn: "CHN",
  tw: "TWN", kp: "PRK", kr: "KOR", jp: "JPN", mn: "MNG", au: "AUS", nz: "NZL", pg: "PNG", in: "IND", pk: "PAK", np: "NPL", bt: "BTN",
  bd: "BGD", lk: "LKA", mv: "MDV"
};
// currencies shared by several countries: the move is the shared currency's, not one country's
export const SHARED = { eur: "the euro", xof: "the West African CFA franc", xaf: "the Central African CFA franc", xcd: "the East Caribbean dollar", aud: "the Australian dollar", ils: "the Israeli shekel", chf: "the Swiss franc", mad: "the Moroccan dirham" };

const r1 = (x) => Math.round(x * 10) / 10;
export function median(a) {
  const s = a.filter((x) => isFinite(x)).sort((p, q) => p - q);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
// rate = units of the currency per U.S. dollar. The currency's own change against the dollar between two dates, in percent:
// it buys 1/rate dollars, so (then / now - 1). Negative = the currency lost value.
export function fxChange(rateThen, rateNow) {
  if (!(rateThen > 0) || !(rateNow > 0)) return null;
  return r1((rateThen / rateNow - 1) * 100);
}
export const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
// the dates read for the currency history: today, 30 days back, and every 7 days back to a year (oldest first)
export function fxDates(nowMs) {
  const out = new Set([ymd(nowMs - 30 * 864e5), ymd(nowMs - 365 * 864e5)]);
  for (let d = 0; d <= 364; d += 7) out.add(ymd(nowMs - d * 864e5));
  return [...out].sort();
}
// one country's currency block from {date: {cur: rate}} snapshots
export function fxBlock(cur, snaps, nowMs) {
  if (!cur || cur === "usd") return { cur: "usd", usd: true };
  const dates = Object.keys(snaps).sort(), series = [];
  for (const d of dates) { const v = snaps[d] && snaps[d][cur]; if (v > 0) series.push([d, v]); }
  if (!series.length) return { cur, none: true };
  const last = series[series.length - 1];
  const near = (target) => { // the snapshot nearest the target date, within 5 days
    let best = null, bd = Infinity;
    for (const s of series) { const dd = Math.abs(Date.parse(s[0]) - Date.parse(target)); if (dd < bd) { bd = dd; best = s; } }
    return bd <= 5 * 864e5 ? best : null;
  };
  const m1 = near(ymd(Date.parse(last[0]) - 30 * 864e5)), y1 = near(ymd(Date.parse(last[0]) - 365 * 864e5));
  return {
    cur, rate: last[1], date: last[0],
    ch30: m1 ? fxChange(m1[1], last[1]) : null, from30: m1 ? m1[0] : null,
    ch365: y1 ? fxChange(y1[1], last[1]) : null, from365: y1 ? y1[0] : null,
    series: series.map((s) => [s[0], +s[1].toPrecision(6)]),
    stale: nowMs - Date.parse(last[0]) > 10 * 864e5
  };
}

// ---------- WFP market prices ----------
// a CSV line split on commas outside quotes
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
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}
// rows as objects keyed by the header; the HXL tag row (#date, #adm1 ...) is dropped
export function csvObjects(text) {
  const rows = csvRows(text); if (!rows.length) return [];
  const h = rows[0].map((x) => x.trim().toLowerCase());
  return rows.slice(1).filter((r) => !/^#/.test(r[0] || "")).map((r) => { const o = {}; h.forEach((k, i) => { o[k] = r[i]; }); return o; });
}
export const STAPLE = /\b(rice|maize|corn|wheat|flour|sorghum|millet|bread|cassava|teff|barley|beans|lentils|potatoes|plantains|yam|sugar)\b|\boil \((vegetable|palm)/i;
export const FUEL = /\b(fuel|diesel|petrol|gasoline|kerosene)\b/i;
export function kindOf(category, commodity) {
  if (FUEL.test(commodity || "")) return "fuel";
  if (/cereals and tubers/i.test(category || "") || STAPLE.test(commodity || "")) return "staple";
  return "";
}
const monthOf = (d) => String(d || "").slice(0, 7);
function prevMonth(m) { const [y, mo] = m.split("-").map(Number); return mo === 1 ? (y - 1) + "-12" : y + "-" + String(mo - 1).padStart(2, "0"); }
function monthsBack(m, n) { let x = m; for (let i = 0; i < n; i++) x = prevMonth(x); return x; }
// the WFP rows -> per item (commodity, unit, currency): monthly national medians for 13 months and the month-on-month change
// measured only on markets that reported in both months (so a market joining or leaving the survey does not make a jump)
export function wfpItems(objs, nowMs) {
  const g = new Map();
  for (const o of objs) {
    if (!/retail/i.test(o.pricetype || "")) continue;
    if (/forecast/i.test(o.priceflag || "")) continue;
    const k = kindOf(o.category, o.commodity); if (!k) continue;
    const p = parseFloat(o.price), m = monthOf(o.date); if (!(p > 0) || !/^\d{4}-\d\d$/.test(m)) continue;
    const key = o.commodity + "|" + (o.unit || "") + "|" + (o.currency || "");
    let it = g.get(key);
    if (!it) { it = { commodity: o.commodity, unit: o.unit || "", currency: o.currency || "", kind: k, months: new Map() }; g.set(key, it); }
    let mm = it.months.get(m); if (!mm) { mm = new Map(); it.months.set(m, mm); }
    const mk = o.market_id || o.market || "?";
    if (!mm.has(mk)) mm.set(mk, []);
    mm.get(mk).push(p);
  }
  const out = [];
  for (const it of g.values()) {
    const ms = [...it.months.keys()].sort(), L = ms[ms.length - 1], P = prevMonth(L), Y = monthsBack(L, 12);
    const mmed = (m) => { const mm = it.months.get(m); if (!mm) return null; const per = [...mm.values()].map(median); return { med: median(per), n: per.length, per: new Map([...mm.entries()].map(([k, v]) => [k, median(v)])) }; };
    const cur = mmed(L), prev = mmed(P), yr = mmed(Y);
    const pairs = (a, b) => { if (!a || !b) return null; const r = []; for (const [k, v] of a.per) { const w = b.per.get(k); if (w > 0) r.push(v / w); } return r.length ? { pct: r1((median(r) - 1) * 100), n: r.length } : null; };
    const mom = pairs(cur, prev), yoy = pairs(cur, yr);
    const series = ms.filter((m) => m >= monthsBack(L, 12)).map((m) => [m, +mmed(m).med.toPrecision(6)]);
    out.push({ commodity: it.commodity, unit: it.unit, currency: it.currency, kind: it.kind, month: L, price: +cur.med.toPrecision(6), markets: cur.n,
      mom: mom ? mom.pct : null, momN: mom ? mom.n : 0, yoy: yoy ? yoy.pct : null, yoyN: yoy ? yoy.n : 0, series,
      stale: nowMs - Date.parse(L + "-15") > RULES.staleDays * 864e5 });
  }
  // the most-reported staples and fuels first
  out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "staple" ? -1 : 1) || (b.month > a.month ? 1 : b.month < a.month ? -1 : 0) || b.markets - a.markets);
  return out;
}
// keep the few items worth showing: up to 6 staples and 3 fuels, newest month first
export function pickItems(items) {
  const st = items.filter((i) => i.kind === "staple").slice(0, 6), fu = items.filter((i) => i.kind === "fuel").slice(0, 3);
  return st.concat(fu);
}

// ---------- inflation (World Bank, IMF) ----------
// World Bank API rows [{countryiso3code, date, value}] -> {ISO3: {year, value}} latest non-null
export function wbLatest(rows) {
  const out = {};
  for (const r of rows || []) {
    if (r.value == null || !r.countryiso3code) continue;
    const o = out[r.countryiso3code];
    if (!o || r.date > o.date) out[r.countryiso3code] = { date: r.date, value: r1(r.value) };
  }
  return out;
}
// World Bank rows -> {ISO3: [[date, value]...]} oldest first
export function wbSeries(rows) {
  const out = {};
  for (const r of rows || []) { if (r.value == null || !r.countryiso3code) continue; (out[r.countryiso3code] = out[r.countryiso3code] || []).push([r.date, r1(r.value)]); }
  for (const k in out) out[k].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return out;
}

// ---------- the watch flags ----------
export function flagsOf(fx, prices) {
  const f = [];
  if (fx && fx.ch30 != null && fx.ch30 <= RULES.fx30 && !fx.stale) f.push({ kind: "fx30", value: fx.ch30, text: "Currency down " + Math.abs(fx.ch30) + "% against the U.S. dollar in 30 days" });
  if (fx && fx.ch365 != null && fx.ch365 <= RULES.fx365 && !fx.stale) f.push({ kind: "fx365", value: fx.ch365, text: "Currency down " + Math.abs(fx.ch365) + "% against the U.S. dollar in a year" });
  for (const p of prices || []) {
    if (p.stale || p.mom == null) continue;
    const lim = p.kind === "fuel" ? RULES.fuel : RULES.food;
    if (p.mom > lim) f.push({ kind: p.kind === "fuel" ? "fuel" : "food", value: p.mom, month: p.month, text: p.commodity + " up " + p.mom + "% on the month before (" + p.month + ", " + p.momN + " market" + (p.momN === 1 ? "" : "s") + ")" });
  }
  return f;
}
