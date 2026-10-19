// Economic stress signals for every country (run once a day by .github/workflows/refresh-econ.yml).
// Keyless, free sources only; every figure keeps its source link:
//  - Currency against the U.S. dollar: fawazahmed0 currency-api (CC0-1.0) on jsDelivr, one dated snapshot per week for a year
//    plus 30 days back (mirror: currency-api.pages.dev). A reference rate: where a country has a parallel (street) market it
//    can differ widely from what people pay.
//  - Staple food and fuel prices: WFP market monitoring, the "wfp-food-prices-for-<country>" data sets on HDX (CC BY-IGO 3.0
//    per dataset licence field), read through HDX's CKAN API. About 90 countries; national medians per month.
//  - Inflation: World Bank consumer price inflation, annual % (FP.CPI.TOTL.ZG, CC BY 4.0), and the IMF World Economic
//    Outlook series in the DataMapper API (PCPIPCH; IMF terms of use, attribution). Both are built from national statistics
//    offices' figures, so the app shows them as official claims.
// Watch flags (tools/econ_lib.mjs RULES) are computed signals that a figure moved fast, not assessments.
// Writes data/live/econ/<cc>.json for every country and data/live/econ/index.json (flagged countries and a summary of all).
// A source that fails keeps the previous run's block for that country. Exit code 0 unless nothing at all could be read.
import fs from "node:fs";
import { CURRENCY, A3, SHARED, RULES, fxDates, fxBlock, csvObjects, wfpItems, pickItems, wbLatest, wbSeries, flagsOf, ymd } from "./econ_lib.mjs";

const OUT = process.env.ECON_OUT || "data/live/econ";
const NOW = Date.now(), STAMP = new Date(NOW).toISOString().slice(0, 16) + "Z";
const UA = "AXIOM-OSAP econ refresh (+https://github.com/01shane89-jpg/AXIOM-APSAP)";
const log = (...a) => console.log(...a);

async function get(url, { type = "json", timeout = 60000, tries = 2 } = {}) {
  let err;
  for (let i = 0; i < tries; i++) {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), timeout);
    try {
      const r = await fetch(url, { headers: { "user-agent": UA, accept: type === "json" ? "application/json" : "*/*" }, signal: ac.signal, redirect: "follow" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const v = type === "json" ? await r.json() : await r.text();
      clearTimeout(t); return v;
    } catch (e) { clearTimeout(t); err = e; }
  }
  throw new Error(url + ": " + (err && err.message));
}
async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

// ---------- the country list: the researched countries in index.html plus data/basemap/world-countries.js ----------
const world = (() => { const t = fs.readFileSync("data/basemap/world-countries.js", "utf8"); return JSON.parse(t.slice(t.indexOf("=") + 1).trim().replace(/;$/, "")); })();
const NAMES = {}, ISO3 = Object.assign({}, A3);
for (const m of fs.readFileSync("index.html", "utf8").matchAll(/\{ id: "([a-z]{2})", name: "([^"]+)", region: /g)) NAMES[m[1]] = m[2];
for (const w of world) if (/^[a-z]{2}$/.test(w.id)) { NAMES[w.id] = NAMES[w.id] || w.name; if (w.a3) ISO3[w.id] = w.a3; }
const CCS = Object.keys(CURRENCY).filter((c) => NAMES[c]);
const missing = Object.keys(NAMES).filter((c) => !CURRENCY[c]);
if (missing.length) log("no currency listed for:", missing.join(" "));
const byA3 = {}; for (const c of CCS) if (ISO3[c]) byA3[ISO3[c]] = c;

let prev = {};
for (const c of CCS) { try { prev[c] = JSON.parse(fs.readFileSync(OUT + "/" + c + ".json", "utf8")); } catch (e) {} }
const ok = { fx: false, wfp: false, wb: false, imf: false };

// ---------- 1. currencies ----------
const FX_SRC = "https://github.com/fawazahmed0/exchange-api";
const fxUrl = (d) => "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@" + d + "/v1/currencies/usd.min.json";
const fxMirror = (d) => "https://" + d + ".currency-api.pages.dev/v1/currencies/usd.min.json";
const snaps = {};
await pool(fxDates(NOW), 6, async (d) => {
  // a date with no snapshot yet (today before publication) falls back a day or two
  for (let back = 0; back < 3; back++) {
    const dd = ymd(Date.parse(d) - back * 864e5);
    for (const u of [fxUrl(dd), fxMirror(dd)]) {
      try { const j = await get(u, { timeout: 30000, tries: 1 }); if (j && j.usd) { snaps[j.date || dd] = j.usd; return; } } catch (e) {}
    }
  }
});
try { const j = await get("https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json", { timeout: 30000 }); if (j && j.usd) snaps[j.date] = j.usd; } catch (e) { log("latest fx:", e.message); }
ok.fx = Object.keys(snaps).length >= 10;
log("fx snapshots:", Object.keys(snaps).length);

// ---------- 2. WFP market prices on HDX ----------
const HDX = "https://data.humdata.org";
const wfp = {};
try {
  const j = await get(HDX + "/api/3/action/package_search?fq=organization:wfp&q=" + encodeURIComponent('name:wfp-food-prices-for*') + "&rows=1000", { timeout: 90000 });
  let pkgs = ((j.result || {}).results || []).filter((p) => /^wfp-food-prices-for-/.test(p.name));
  if (!pkgs.length) { // the wildcard query is a Solr feature HDX may not pass through: fall back to a plain text search
    const k = await get(HDX + "/api/3/action/package_search?fq=organization:wfp&q=" + encodeURIComponent('"food prices"') + "&rows=1000", { timeout: 90000 });
    pkgs = ((k.result || {}).results || []).filter((p) => /^wfp-food-prices-for-/.test(p.name));
  }
  log("WFP datasets on HDX:", pkgs.length);
  await pool(pkgs, 4, async (p) => {
    const g = (p.groups || []).map((x) => String(x.name || "").toUpperCase()).filter((x) => byA3[x]);
    // the main file is wfp_food_prices_<iso3>.csv; HDX may also split recent years into wfp_food_prices_<iso3>_<year>.csv.
    // QuickCharts copies (qc_...) are left out. Files for years before last year are not needed (13 months are shown).
    const res = (p.resources || []).filter((r) => {
      const u = String(r.url || ""), m = u.match(/(?:^|\/)wfp_food_prices_([a-z]{3})(?:_(\d{4}))?\.csv$/i);
      return m && !/quickchart/i.test(r.name || "") && (!m[2] || +m[2] >= new Date(NOW).getUTCFullYear() - 1);
    });
    const a3 = g[0] || ((res[0] && (res[0].url.match(/wfp_food_prices_([a-z]{3})/i) || [])[1]) || "").toUpperCase();
    const cc = byA3[a3]; if (!cc || !res.length) return;
    try {
      let objs = [];
      for (const r of res) objs = objs.concat(csvObjects(await get(r.url, { type: "text", timeout: 120000 })));
      const items = wfpItems(objs, NOW);
      wfp[cc] = { page: HDX + "/dataset/" + p.name, csv: res[0].url, title: p.title, licence: p.license_title || "CC BY-IGO 3.0",
        updated: res.map((r) => r.last_modified || "").concat(p.metadata_modified || "").sort().pop().slice(0, 10), items: pickItems(items) };
    } catch (e) { log("WFP", cc, e.message); }
  });
  ok.wfp = Object.keys(wfp).length > 0;
  log("WFP countries read:", Object.keys(wfp).length);
} catch (e) { log("HDX:", e.message); }

// ---------- 3. inflation ----------
let wb = {}, wbS = {}, imf = {};
try {
  const j = await get("https://api.worldbank.org/v2/country/all/indicator/FP.CPI.TOTL.ZG?format=json&per_page=20000&date=2015:" + new Date(NOW).getUTCFullYear(), { timeout: 90000 });
  wb = wbLatest(j[1]); wbS = wbSeries(j[1]); ok.wb = Object.keys(wb).length > 0;
  log("World Bank CPI countries:", Object.keys(wb).length);
} catch (e) { log("World Bank:", e.message); }
const Y = new Date(NOW).getUTCFullYear();
try {
  const j = await get("https://www.imf.org/external/datamapper/api/v1/PCPIPCH?periods=" + [Y - 2, Y - 1, Y].join(","), { timeout: 60000 });
  imf = ((j.values || {}).PCPIPCH) || {}; ok.imf = Object.keys(imf).length > 0;
  log("IMF CPI countries:", Object.keys(imf).length);
} catch (e) { log("IMF:", e.message); }

if (!ok.fx && !ok.wfp && !ok.wb && !ok.imf) { console.error("no source could be read"); process.exit(1); }

// ---------- write ----------
fs.mkdirSync(OUT, { recursive: true });
const SOURCES = {
  fx: { name: "fawazahmed0 currency-api", url: FX_SRC, licence: "CC0-1.0", nc: false },
  wfp: { name: "WFP market prices (HDX)", url: HDX + "/organization/wfp", licence: "CC BY-IGO 3.0", nc: false },
  wb: { name: "World Bank, consumer price inflation (annual %)", url: "https://data.worldbank.org/indicator/FP.CPI.TOTL.ZG", licence: "CC BY 4.0", nc: false },
  imf: { name: "IMF World Economic Outlook (DataMapper)", url: "https://www.imf.org/external/datamapper/PCPIPCH@WEO", licence: "IMF terms of use (attribution)", nc: false }
};
const index = { asof: STAMP, rules: RULES, sources: SOURCES, read: ok, flagged: [], all: {} };
for (const cc of CCS) {
  const a3 = ISO3[cc], p = prev[cc] || {}, cur = CURRENCY[cc];
  let fx = ok.fx ? fxBlock(cur, snaps, NOW) : p.fx || null;
  if (fx && ok.fx && !fx.usd && !fx.none) fx.src = fxUrl(fx.date);
  if (fx && SHARED[cur]) fx.shared = SHARED[cur];
  const prices = ok.wfp ? (wfp[cc] || null) : p.prices || null;
  const cpi = {};
  if (ok.wb) { if (a3 && wb[a3]) cpi.wb = { year: wb[a3].date, value: wb[a3].value, series: (wbS[a3] || []).slice(-8), url: "https://data.worldbank.org/indicator/FP.CPI.TOTL.ZG?locations=" + cc.toUpperCase() }; }
  else if (p.cpi && p.cpi.wb) cpi.wb = p.cpi.wb;
  if (ok.imf) {
    const v = a3 && imf[a3];
    if (v) { const yrs = Object.keys(v).sort(); cpi.imf = { values: yrs.map((y) => [y, Math.round(v[y] * 10) / 10]), url: "https://www.imf.org/external/datamapper/PCPIPCH@WEO/" + a3 }; }
  } else if (p.cpi && p.cpi.imf) cpi.imf = p.cpi.imf;
  const flags = flagsOf(fx, prices && prices.items);
  const rec = { cc, name: NAMES[cc], a3: a3 || "", asof: STAMP, fx, prices, cpi, flags };
  fs.writeFileSync(OUT + "/" + cc + ".json", JSON.stringify(rec) + "\n");
  index.all[cc] = { n: NAMES[cc], fx30: fx && fx.ch30 != null ? fx.ch30 : null, fx365: fx && fx.ch365 != null ? fx.ch365 : null,
    cpi: cpi.wb ? cpi.wb.value : null, wfp: !!prices, f: flags.length };
  if (flags.length) index.flagged.push({ cc, name: NAMES[cc], flags });
}
index.flagged.sort((a, b) => b.flags.length - a.flags.length || a.name.localeCompare(b.name));
fs.writeFileSync(OUT + "/index.json", JSON.stringify(index) + "\n");
log("countries written:", CCS.length, "flagged:", index.flagged.length, index.flagged.map((f) => f.cc + "(" + f.flags.map((x) => x.kind).join(",") + ")").join(" "));
