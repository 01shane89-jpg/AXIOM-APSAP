// Risk rating "equivalents" for every country and its major cities (run every 6 hours by .github/workflows/refresh-risk.yml).
// Derived by OSAP with the fixed formula in tools/risk_lib.mjs from data OSAP already holds plus open World Bank indicators.
// Not an official travel advisory and not an analyst assessment; official advisories are never an input.
// Inputs, all keyless and free:
//  - World Bank World Development Indicators and Worldwide Governance Indicators (CC BY 4.0): political stability and absence
//    of violence/terrorism, rule of law, intentional homicides (UNODC), deaths before age 5 (UN IGME), access to electricity,
//    internet use. Slow-moving, so read once a week and kept in data/live/risk/_wb.json.
//  - OSAP's own feeds in data/live: conflict deaths (UCDP GED and candidate events, data/live/conflicts/history/cc and
//    data/live/ucdp), WHO Disease Outbreak News and CDC travel health notices, GDACS alerts, USGS earthquakes, official
//    warnings, tropical cyclone forecasts, volcanic ash advisories and IODA internet outage signals.
//  - The major cities in data/risk/cities.json (GeoNames, CC BY 4.0; tools/build_risk_cities.mjs).
// Cities: security uses the conflict deaths within 50 km, hazards the events within 150-300 km of the city; crime, health and
// infrastructure are national figures (no free city-level source covers every country), which each record says.
// Writes data/live/risk/<cc>.json for every country and data/live/risk/index.json (the overall level of each).
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import { COUNTRIES, ccsAt } from "./geo_cc.mjs";
import { RULE, LEVELS, CATS, rate, km, latest, deathsFrom, outbreakEvents, hazardEvents } from "./risk_lib.mjs";

const OUT = process.env.RISK_OUT || "data/live/risk";
const LIVE = process.env.RISK_LIVE || "data/live";
const NOW = +(process.env.RISK_NOW_MS || Date.now()), STAMP = new Date(NOW).toISOString().slice(0, 16) + "Z", Y = new Date(NOW).getUTCFullYear();
const ONLY = (process.env.RISK_ONLY || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const UA = "AXIOM-OSAP risk ratings refresh (+https://github.com/01shane89-jpg/AXIOM-APSAP)";
const DAY = 864e5, iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const log = (...a) => console.log(...a);
fs.mkdirSync(OUT, { recursive: true });

function loadJs(file) {
  try { const w = {}; vm.runInNewContext(fs.readFileSync(file, "utf8"), { window: w }, { timeout: 20000 }); return w; } catch (e) { return null; }
}
async function getJson(url, ms = 90000) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: ac.signal }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}

// ---------- 1. World Bank indicators, read once a week ----------
// each with the ids to try: the Worldwide Governance Indicators moved to GOV_WGI_* ids in 2024; the older ids are a fallback
const WB = [
  { k: "pv", ids: ["GOV_WGI_PV.EST", "PV.EST"], page: "GOV_WGI_PV_EST" },
  { k: "rl", ids: ["GOV_WGI_RL.EST", "RL.EST"], page: "GOV_WGI_RL_EST" },
  { k: "homicide", ids: ["VC.IHR.PSRC.P5"] },
  { k: "u5", ids: ["SH.DYN.MORT"] },
  { k: "elec", ids: ["EG.ELC.ACCS.ZS"] },
  { k: "net", ids: ["IT.NET.USER.ZS"] }
];
let wb = null;
try { wb = JSON.parse(fs.readFileSync(OUT + "/_wb.json", "utf8")); } catch (e) {}
const wbOld = !wb || !wb.read || NOW - Date.parse(wb.read) > 7 * DAY || WB.some((d) => !(wb.series || {})[d.k]) || process.env.RISK_WB === "1";
if (wbOld && process.env.RISK_WB !== "0") {
  const next = { schema: "osap-risk-wb/1", read: STAMP, series: {}, ids: {}, errors: {} };
  for (const d of WB) {
    for (const id of d.ids) {
      for (const extra of ["", "&source=3"]) {
        if (next.series[d.k]) break;
        if (extra && !/WGI|\.EST$/.test(id)) continue;
        try {
          const j = await getJson("https://api.worldbank.org/v2/country/all/indicator/" + id + "?format=json&per_page=20000&date=2005:" + Y + extra);
          const rows = (Array.isArray(j) && j[1]) || [], o = {};
          for (const r of rows) if (r && r.value != null && isFinite(r.value) && /^[A-Z]{3}$/.test(r.countryiso3code || "")) (o[r.countryiso3code] = o[r.countryiso3code] || []).push([String(r.date), +r.value]);
          for (const a in o) o[a].sort((x, y) => x[0].localeCompare(y[0]));
          if (Object.keys(o).length >= 50) { next.series[d.k] = o; next.ids[d.k] = id; log("World Bank", d.k, id + extra, Object.keys(o).length, "countries"); }
          else next.errors[d.k] = id + extra + ": " + Object.keys(o).length + " countries" + (j && j[0] && j[0].message ? " " + JSON.stringify(j[0].message).slice(0, 200) : "");
        } catch (e) { next.errors[d.k] = id + extra + ": " + e.message; }
      }
    }
    if (!next.series[d.k]) {
      log("World Bank", d.k, "not read:", next.errors[d.k]);
      if (wb && wb.series && wb.series[d.k]) { next.series[d.k] = wb.series[d.k]; next.ids[d.k] = wb.ids[d.k]; next.stale = (next.stale || []).concat(d.k); }
    }
  }
  wb = next;
  fs.writeFileSync(OUT + "/_wb.json", JSON.stringify(wb) + "\n");
}
wb = wb || { series: {}, ids: {} };
function wbInd(k, a3, a2, maxAge) {
  const v = a3 && wb.series[k] && latest(wb.series[k][a3], Y, maxAge);
  if (!v) return null;
  const d = WB.find((x) => x.k === k), id = wb.ids[k] || d.ids[0];
  return Object.assign(v, { src: "https://data.worldbank.org/indicator/" + (d.page && /^GOV_WGI/.test(id) ? d.page : id) + "?locations=" + a2 });
}

// ---------- 2. OSAP's own feeds ----------
const feed = (f, key) => { const w = loadJs(LIVE + "/" + f); return w && w[key] ? w[key] : null; };
const WHO = feed("outbreaks.js", "ASAP_WHO"), CDC = feed("cdc.js", "ASAP_CDC"), GDACS = feed("gdacs.js", "ASAP_GDACS"), QUAKES = feed("quakes.js", "ASAP_QUAKES"),
  WARN = feed("warnings.js", "ASAP_WARN"), STORMS = feed("storms.js", "ASAP_STORMS"), VOLC = feed("volcano.js", "ASAP_VOLC"), IODA = feed("outages.js", "ASAP_IODA");
const hazardsOk = !!(GDACS || QUAKES || WARN || STORMS);
const CITIES = JSON.parse(fs.readFileSync("data/risk/cities.json", "utf8"));
const since365 = iso(NOW - 365 * DAY), since90 = iso(NOW - 90 * DAY);

// conflict events of one country in the past 365 days: the history chunks that reach into the window, plus the latest candidates
function conflictRows(cc) {
  const rows = new Map();
  const H = loadJs(LIVE + "/conflicts/history/cc/" + cc + ".js"), idx = H && H.OSAP_CF_HIST && H.OSAP_CF_HIST["cc/" + cc];
  let read = false;
  if (idx) {
    read = true;
    for (const ch of idx.chunks || []) {
      if (+ch.to < +since365.slice(0, 4)) continue;
      const C = loadJs(LIVE + "/conflicts/history/" + ch.f), d = C && C.OSAP_CF_HIST && C.OSAP_CF_HIST[ch.f.replace(/\.js$/, "")];
      const cols = (d && d.cols) || idx.cols || [], ev = (d && (d.events || d.rows || d.items)) || [];
      for (const r of ev) {
        const o = Array.isArray(r) ? Object.fromEntries(cols.map((c, i) => [c, r[i]])) : r;
        if (o && o.date >= since365) rows.set(String(o.id), { date: o.date, lat: +o.lat, lon: +o.lon, best: +o.best || 0 });
      }
    }
  }
  const U = loadJs(LIVE + "/ucdp/" + cc + ".js"), u = U && U.ASAP_UCDP_CC;
  if (u) { read = true; for (const o of u.items || []) if (o.date >= since365) rows.set(String(o.id), { date: o.date, lat: +o.lat, lon: +o.lon, best: +o.best || 0 }); }
  return read ? [...rows.values()] : null;
}

// hazard events with a place: GDACS alerts in force, M6+ earthquakes of the past 7 days, cyclone forecast points (72 h)
const gdacsPts = ((GDACS && GDACS.events) || []).filter((g) => g.current !== false && isFinite(g.lat) && isFinite(g.lon));
const quakePts = ((QUAKES && QUAKES.features) || []).filter((q) => q.mag >= 6 && NOW - q.time <= 7 * DAY && q.type !== "explosion");
const stormPts = [];
for (const s of (STORMS && STORMS.storms) || []) for (const p of (s.products || []).slice(0, 1)) {
  for (const f of [p.now].concat(p.fc || [])) if (f && isFinite(f.lat) && isFinite(f.lon) && (f.h || 0) <= 72 && (f.wind_kt || 0) >= 34) stormPts.push({ name: s.name || p.name, lat: f.lat, lon: f.lon, wind_kt: f.wind_kt, t: f.t });
}
function stormsNear(points) {
  const best = {};
  for (const s of stormPts) for (const pt of points) {
    const d = km(pt.lat, pt.lon, s.lat, s.lon);
    if (d <= 300 && (!best[s.name] || s.wind_kt > best[s.name].wind_kt)) best[s.name] = { name: s.name, wind_kt: s.wind_kt, km: Math.round(d), t: s.t };
  }
  return Object.values(best);
}
const gdacsCc = {};
for (const g of gdacsPts) {
  const ccs = new Set(ccsAt(g.lat, g.lon, 0.5));
  for (const a3 of g.iso3 || []) for (const c of COUNTRIES) if (c.a3 === a3) ccs.add(c.id);
  for (const c of ccs) (gdacsCc[c] = gdacsCc[c] || []).push(g);
}
const quakeCc = {};
for (const q of quakePts) for (const c of ccsAt(q.lat, q.lon, 1)) (quakeCc[c] = quakeCc[c] || []).push(q);
const fresh = (d, days) => d && NOW - Date.parse(String(d).length <= 10 ? d + "T00:00Z" : d) <= days * DAY;

// ---------- 3. every country ----------
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
let list = COUNTRIES.map((c) => c.id).filter((v, i, a) => a.indexOf(v) === i).sort();
if (ONLY.length) list = list.filter((c) => ONLY.includes(c));
const index = { schema: "osap-risk-index/1", asof: STAMP, rule: RULE, kind: "derived-equivalent", items: {} };
let n = 0;
for (const cc of list) {
  const C = COUNTRIES.find((c) => c.id === cc), a3 = cc === "oki" ? "JPN" : C.a3, ucc = cc;
  const a2 = cc === "oki" ? "JP" : cc.toUpperCase();
  const I = { pv: wbInd("pv", a3, a2, 6), rl: wbInd("rl", a3, a2, 6), homicide: wbInd("homicide", a3, a2, 10), u5: wbInd("u5", a3, a2, 8), elec: wbInd("elec", a3, a2, 8), net: wbInd("net", a3, a2, 8) };
  const rows = conflictRows(ucc);
  if (rows) {
    const d = deathsFrom(rows, since365);
    I.deaths = { n: d.n, events: d.events, window: since365 + " to " + iso(NOW), src: "https://ucdp.uu.se/", note: "UCDP Georeferenced Event Dataset and monthly candidate events; candidate data lags one to two months." };
  }
  const who = ((WHO && WHO.items) || []).filter((x) => (x.ccs || []).includes(cc === "oki" ? "jp" : cc) && x.date >= since90);
  const cdc = ((CDC && CDC.items) || []).filter((x) => (x.ccs || []).includes(cc === "oki" ? "jp" : cc) && x.date >= since90);
  const healthEv = outbreakEvents(who, cdc);
  const cities = (CITIES.cities[cc] || []);
  const warn = ((WARN && WARN.items && WARN.items[cc]) || []).filter((x) => fresh(x.date, 3));
  const volc = ((VOLC && VOLC.items) || []).filter((v) => v.country && C.name && String(v.country).toLowerCase() === C.name.toLowerCase() && fresh(v.date, 7));
  const hz = hazardEvents({ gdacs: gdacsCc[cc] || [], quakes: quakeCc[cc] || [], warnings: warn, storms: stormsNear(cities), volcano: volc });
  const io = IODA && IODA.items && IODA.items[cc] ? Object.assign({ link: "https://ioda.inetintel.cc.gatech.edu/country/" + (cc === "oki" ? "JP" : cc.toUpperCase()) }, IODA.items[cc]) : null;
  const R = rate(I, { health: healthEv, hazards: hz, hazardsOk, outage: io });

  // the cities: local conflict deaths (50 km) and local hazard events; crime, health and infrastructure stay national
  const cityOut = cities.map((ct) => {
    const Ic = Object.assign({}, I);
    if (rows) { const d = deathsFrom(rows, since365, ct, 50); Ic.deaths = Object.assign({}, I.deaths, { n: d.n, events: d.events, note: "Within 50 km of the city. " + I.deaths.note }); }
    const hzc = hazardEvents({
      gdacs: gdacsPts.filter((g) => km(ct.lat, ct.lon, g.lat, g.lon) <= 150),
      quakes: quakePts.filter((q) => km(ct.lat, ct.lon, q.lat, q.lon) <= 200),
      storms: stormsNear([ct])
    });
    const Rc = rate(Ic, { health: healthEv, hazards: hzc, hazardsOk, outage: io });
    return { n: ct.n, lat: ct.lat, lon: ct.lon, pop: ct.pop, cap: ct.cap, overall: Rc.overall,
      cats: Object.fromEntries(Object.entries(Rc.cats).map(([k, v]) => [k, k === "security" || k === "hazards" ? v : { score: v.score, level: v.level, label: v.label, national: true }])) };
  });

  const rec = { schema: "osap-risk/1", cc, name: C.name, asof: STAMP, rule: RULE, kind: "derived-equivalent",
    note: "OSAP risk equivalent: derived by OSAP from open data with a fixed formula. Not an official travel advisory and not an analyst assessment.",
    overall: R.overall, cats: R.cats, cities: cityOut,
    inputs: { wb_read: wb.read || null, wb_stale: wb.stale || [], conflict: rows ? "read" : "none", who: WHO ? WHO.asof : null, cdc: CDC ? CDC.asof : null,
      gdacs: GDACS ? GDACS.asof : null, quakes: QUAKES ? QUAKES.asof : null, warnings: WARN ? WARN.asof : null, storms: STORMS ? STORMS.asof : null, ioda: IODA ? IODA.asof : null },
    sources: { cities: CITIES.source } };
  rec.fp = sha(JSON.stringify([rec.cc, rec.rule, rec.overall, rec.cats, rec.cities]));
  const file = OUT + "/" + cc + ".json", body = JSON.stringify(rec) + "\n";
  // the same content keeps its earlier file (and time stamp), so the job commits only real changes
  let same = false;
  try { const old = JSON.parse(fs.readFileSync(file, "utf8")); same = old.fp === rec.fp; if (same) rec.asof = old.asof; } catch (e) {}
  if (!same) fs.writeFileSync(file, body);
  index.items[cc] = { level: R.overall.level, label: R.overall.label, score: R.overall.score, cities: cityOut.length, worst_city: cityOut.reduce((m, c) => Math.max(m, c.overall.level || 0), 0) };
  n++;
}
if (!ONLY.length) fs.writeFileSync(OUT + "/index.json", JSON.stringify(index) + "\n");
const dist = [1, 2, 3, 4, 5].map((l) => LEVELS[l] + " " + Object.values(index.items).filter((x) => x.level === l).length).join(", ");
log("risk ratings:", n, "countries;", dist, "; none", Object.values(index.items).filter((x) => !x.level).length, "; categories", CATS.map((c) => c.k).join(" "));
