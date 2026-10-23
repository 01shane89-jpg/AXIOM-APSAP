// Open military reference for every country (run once a week by .github/workflows/refresh-milref.yml).
// Keyless, free sources only; every record keeps its source and a SHA-256 fingerprint, and the app shows each as a source claim:
//  - Wikidata (CC0 1.0), query.wikidata.org: the country's armed forces, branches and units (order of battle: Q176799 military
//    unit and Q772547 armed forces with their subclasses, dissolved units left out), the equipment those forces are recorded as
//    operating (P137 operator, with the P1114 quantity, P580/P582 dates and P730 service retirement where editors gave them;
//    a type first flown or built before 1960 with no end recorded is listed apart as probably retired),
//    and military installations (Q18691599 military installation, Q695850 airbase; castles and historic fortresses left out). Wikidata is edited by anyone: coverage
//    differs widely between countries, quantities are rare and retired types often carry no end date.
//  - World Bank World Development Indicators (CC BY 4.0): military expenditure (SIPRI Military Expenditure Database), armed
//    forces personnel (IISS, The Military Balance) and arms imports and exports (SIPRI trend-indicator values).
// No commanders, no people: only forces, equipment types and hulls, and places.
// Writes data/live/milref/<cc>.json for every country and data/live/milref/index.json (counts per country). A country whose
// Wikidata queries fail keeps the previous run's lists. Exit code 0 unless nothing at all could be read.
import fs from "node:fs";
import { UNIT_ROOTS, INST_ROOTS, CAPS, WB, unitsFrom, equipFrom, instFrom, wbSeriesBy, figureRecord, qidByIso, qid, val } from "./milref_lib.mjs";
import { A3 } from "./econ_lib.mjs";

const OUT = process.env.MILREF_OUT || "data/live/milref";
const ONLY = (process.env.MILREF_ONLY || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const NOW = Date.now(), STAMP = new Date(NOW).toISOString().slice(0, 16) + "Z";
const BUDGET_MS = +(process.env.MILREF_BUDGET_MIN || 45) * 60000;
const UA = "AXIOM-OSAP military reference refresh (+https://github.com/01shane89-jpg/AXIOM-APSAP)";
const WDQ = "https://query.wikidata.org/sparql";
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sparql(q, ms = 150000) {
  let err;
  for (let i = 0; i < 3; i++) {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
    try {
      const r = await fetch(WDQ, { method: "POST", signal: ac.signal, body: "query=" + encodeURIComponent(q),
        headers: { "user-agent": UA, accept: "application/sparql-results+json", "content-type": "application/x-www-form-urlencoded" } });
      if (r.status === 429 || r.status >= 500) throw Object.assign(new Error("HTTP " + r.status), { retry: +(r.headers.get("retry-after") || 0) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json(); clearTimeout(t); return j.results.bindings;
    } catch (e) { clearTimeout(t); err = e; await sleep(Math.min(60, e.retry || 5 * (i + 1)) * 1000); }
  }
  throw err;
}
async function getJson(url, ms = 90000) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: ac.signal }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}
const V = (ids) => ids.map((x) => "wd:" + x).join(" ");
const LAB = (v) => `OPTIONAL { ${v} rdfs:label ?en. FILTER(LANG(?en) = "en") } OPTIONAL { ${v} rdfs:label ?mul. FILTER(LANG(?mul) = "mul") }`;

// ---------- the country list: as the economic job (index.html researched countries + data/basemap/world-countries.js) ----------
const world = (() => { const t = fs.readFileSync("data/basemap/world-countries.js", "utf8"); return JSON.parse(t.slice(t.indexOf("=") + 1).trim().replace(/;$/, "")); })();
const NAMES = {}, ISO3 = Object.assign({}, A3);
for (const m of fs.readFileSync("index.html", "utf8").matchAll(/\{ id: "([a-z]{2})", name: "([^"]+)", region: /g)) NAMES[m[1]] = m[2];
for (const w of world) if (/^[a-z]{2}$/.test(w.id)) { NAMES[w.id] = NAMES[w.id] || w.name; if (w.a3) ISO3[w.id] = w.a3; }
let CCS = Object.keys(NAMES).sort();
if (ONLY.length) CCS = CCS.filter((c) => ONLY.includes(c));
const prev = {};
for (const c of CCS) { try { prev[c] = JSON.parse(fs.readFileSync(OUT + "/" + c + ".json", "utf8")); } catch (e) {} }
// the countries read longest ago go first, so a run that runs out of time leaves the freshest ones for next week
const readAt = (c) => (prev[c] && prev[c].wd && !prev[c].wd.stale && prev[c].wd.read) || "";
CCS.sort((a, b) => readAt(a).localeCompare(readAt(b)) || a.localeCompare(b));

// ---------- 1. World Bank figures, all countries at once ----------
const Y = new Date(NOW).getUTCFullYear(), wb = {};
for (const d of WB) {
  try { const j = await getJson("https://api.worldbank.org/v2/country/all/indicator/" + d.id + "?format=json&per_page=20000&date=2000:" + Y); wb[d.k] = wbSeriesBy(j[1]); log("World Bank", d.id, Object.keys(wb[d.k]).length, "countries"); }
  catch (e) { log("World Bank", d.id, e.message); }
}

// ---------- 2. Wikidata: country items and the class lists ----------
let QIDS = {}, unitCls = [], instCls = [], wdOk = true;
try {
  QIDS = qidByIso(await sparql(`SELECT ?c ?iso ?sl WHERE { ?c wdt:P297 ?iso; wikibase:sitelinks ?sl. FILTER NOT EXISTS { ?c wdt:P576 [] } }`));
  unitCls = (await sparql(`SELECT DISTINCT ?c WHERE { VALUES ?r { ${V(UNIT_ROOTS)} } ?c wdt:P279* ?r. }`)).map((b) => qid(b, "c")).filter((x) => /^Q\d+$/.test(x));
  instCls = (await sparql(`SELECT DISTINCT ?c WHERE { VALUES ?r { ${V(INST_ROOTS)} } ?c wdt:P279* ?r. }`)).map((b) => qid(b, "c")).filter((x) => /^Q\d+$/.test(x));
  log("country items:", Object.keys(QIDS).length, "unit classes:", unitCls.length, "installation classes:", instCls.length);
} catch (e) { wdOk = false; log("Wikidata setup:", e.message); }
const clsName = {};
async function names(ids) {
  const need = [...new Set(ids)].filter((x) => /^Q\d+$/.test(x) && !(x in clsName));
  for (let i = 0; i < need.length; i += 400) {
    const part = need.slice(i, i + 400);
    try { (await sparql(`SELECT ?c ?l WHERE { VALUES ?c { ${V(part)} } ?c rdfs:label ?l. FILTER(LANG(?l) = "en") }`)).forEach((b) => (clsName[qid(b, "c")] = val(b, "l"))); } catch (e) {}
    part.forEach((x) => { if (!(x in clsName)) clsName[x] = ""; });
  }
}

async function country(cc) {
  const Q = QIDS[cc === "oki" ? "jp" : cc]; if (!Q) throw new Error("no Wikidata item");
  // units: the class tree is listed, and the query planner is switched off so Wikidata walks the classes first (as the
  // military sites job: walking the tree inside the query, or starting from the country, times out)
  const uRows = await sparql(`SELECT ?u ?en ?mul ?cls ?parent ?hq ?hqen ?coord ?sl WHERE {
  hint:Query hint:optimizer "None".
  VALUES ?cls { ${V(unitCls)} }
  ?u wdt:P31 ?cls. ?u wdt:P17 wd:${Q}.
  FILTER NOT EXISTS { ?u wdt:P576 [] } FILTER NOT EXISTS { ?u wdt:P582 [] }
  ?u wikibase:sitelinks ?sl.
  ${LAB("?u")}
  OPTIONAL { ?u wdt:P749|wdt:P361 ?parent }
  OPTIONAL { ?u wdt:P159 ?hq. OPTIONAL { ?hq rdfs:label ?hqen. FILTER(LANG(?hqen) = "en") } OPTIONAL { ?hq wdt:P625 ?coord } }
}`);
  await names(uRows.map((b) => qid(b, "cls")));
  const units = unitsFrom(uRows, clsName);
  const opName = {}; units.forEach((u) => (opName[u.q] = u.n));
  // operators: every live unit found (not only the capped list) and the country item itself (small states such as Tuvalu
  // record their patrol boats against the country)
  const ops = [...new Set(uRows.map((b) => qid(b, "u")).filter((x) => /^Q\d+$/.test(x)))].concat(Q);
  for (const b of uRows) { const q = qid(b, "u"); if (!opName[q] && val(b, "en")) opName[q] = val(b, "en"); }
  let eRows = [];
  for (let i = 0; i < ops.length; i += 2500) {
    eRows = eRows.concat(await sparql(`SELECT ?eq ?en ?mul ?op ?cls ?qty ?start ?end ?ret ?dis ?ff ?inc ?coord ?sl WHERE {
  VALUES ?op { ${V(ops.slice(i, i + 2500))} }
  ?eq p:P137 ?st. ?st ps:P137 ?op.
  OPTIONAL { ?st pq:P1114 ?qty } OPTIONAL { ?st pq:P580 ?start } OPTIONAL { ?st pq:P582 ?end }
  OPTIONAL { ?eq wdt:P730 ?ret } OPTIONAL { ?eq wdt:P576 ?dis } OPTIONAL { ?eq wdt:P625 ?coord }
  OPTIONAL { ?eq wdt:P606 ?ff } OPTIONAL { ?eq wdt:P571 ?inc }
  OPTIONAL { ?eq wdt:P31 ?cls }
  ?eq wikibase:sitelinks ?sl.
  ${LAB("?eq")}
}`));
  }
  await names(eRows.map((b) => qid(b, "cls")));
  const { equip, inst: viaOp } = equipFrom(eRows, clsName, opName);
  const sRows = await sparql(`SELECT ?s ?en ?mul ?cls ?coord ?sl WHERE {
  hint:Query hint:optimizer "None".
  VALUES ?cls { ${V(instCls)} }
  ?s wdt:P31 ?cls. ?s wdt:P17 wd:${Q}.
  FILTER NOT EXISTS { ?s wdt:P576 [] } FILTER NOT EXISTS { ?s wdt:P3999 [] } FILTER NOT EXISTS { ?s wdt:P582 [] }
  ?s wikibase:sitelinks ?sl.
  ${LAB("?s")}
  OPTIONAL { ?s wdt:P625 ?coord }
}`);
  await names(sRows.map((b) => qid(b, "cls")));
  const inst = instFrom(sRows, clsName, viaOp);
  return { q: Q, units, equip, inst, raw: { units: new Set(uRows.map((b) => qid(b, "u"))).size, equip: new Set(eRows.map((b) => qid(b, "eq"))).size } };
}

// ---------- 3. per country ----------
fs.mkdirSync(OUT, { recursive: true });
const SOURCES = {
  wd: { name: "Wikidata", url: "https://www.wikidata.org/", licence: "CC0 1.0", nc: false },
  wb: { name: "World Bank, World Development Indicators", url: "https://datacatalog.worldbank.org/search/dataset/0037712", licence: "CC BY 4.0", nc: false,
    note: "Military expenditure and arms transfer series come from SIPRI; armed forces personnel from IISS, The Military Balance." }
};
const index = { asof: STAMP, caps: CAPS, sources: SOURCES, all: {} };
let read = 0, failed = [];
for (const cc of CCS) {
  const p = prev[cc] || {};
  const fig = {};
  for (const d of WB) {
    const a3 = ISO3[cc === "oki" ? "jp" : cc], s = wb[d.k] ? wb[d.k][a3] : null;
    const r = wb[d.k] ? figureRecord(d, s, cc === "oki" ? "jp" : cc) : (p.fig || {})[d.k];
    if (r) fig[d.k] = r;
  }
  let W = null;
  if (wdOk && Date.now() - NOW < BUDGET_MS) {
    try { W = await country(cc); read++; } catch (e) { failed.push(cc); log(cc, "Wikidata:", e.message); }
  }
  const rec = { cc, name: NAMES[cc], asof: STAMP, kind: "source-claims", sources: SOURCES, fig,
    wd: W ? { q: W.q, read: STAMP, units: W.units, equip: W.equip, inst: W.inst, found: W.raw } : (p.wd || null) };
  if (!W && p.wd) rec.wd.stale = true;
  fs.writeFileSync(OUT + "/" + cc + ".json", JSON.stringify(rec) + "\n");
  const w = rec.wd || {};
  index.all[cc] = { n: NAMES[cc], u: (w.units || []).length, e: (w.equip || []).filter((x) => !x.out && !x.old).length, i: (w.inst || []).length, f: Object.keys(fig).length, st: w.stale ? 1 : 0 };
  if (W) log(cc, "units", W.units.length + "/" + W.raw.units, "equipment", W.equip.length + "/" + W.raw.equip, "installations", W.inst.length);
}
fs.writeFileSync(OUT + "/index.json", JSON.stringify(index) + "\n");
log("countries written:", CCS.length, "Wikidata read:", read, "failed:", failed.join(" ") || "none");
if (!read && !Object.keys(wb).length) { console.error("no source could be read"); process.exit(1); }
