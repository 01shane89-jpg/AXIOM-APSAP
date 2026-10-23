// Open military reference for every country (run once a week by .github/workflows/refresh-milref.yml).
// Keyless, free sources only; every record keeps its source and a SHA-256 fingerprint, and the app shows each as a source claim:
//  - Wikidata (CC0 1.0), query.wikidata.org: the country's armed forces, branches and units (order of battle: Q176799 military
//    unit and Q772547 armed forces with their subclasses, dissolved units left out), the equipment those forces are recorded as
//    operating (P137 operator, with the P1114 quantity, P580/P582 dates and P730 service retirement where editors gave them;
//    a type first flown or built before 1960 with no end recorded is listed apart),
//    and military installations (Q18691599 military installation, Q695850 airbase; castles and historic fortresses left out). Wikidata is edited by anyone: coverage
//    differs widely between countries, quantities are rare and retired types often carry no end date.
//  - World Bank World Development Indicators (CC BY 4.0): military expenditure (SIPRI Military Expenditure Database), armed
//    forces personnel (IISS, The Military Balance) and arms imports and exports (SIPRI trend-indicator values).
//  - SIPRI Arms Transfers Database, trade register (© SIPRI; free for non-commercial use with attribution, so marked nc and
//    kept in its own files, data/live/milref/sipri/<cc>.json, that can be dropped): the deals of major conventional arms with
//    the country as recipient and as supplier, with deliveries or still open in the last ten years. Read from the public
//    backend SIPRI's own site uses.
//  - UN Register of Conventional Arms (UNROCA, © United Nations; UN terms of use, so marked nc and kept in its own files,
//    data/live/milref/unroca/<cc>.json): what each government itself reported to the UN since 1992, its military holdings
//    by year, its imports and exports per partner country and what the partner reported, and its national production.
//    Read from the public JSON the register's own site uses.
// No commanders, no people: only forces, equipment types and hulls, and places.
// Writes data/live/milref/<cc>.json for every country and data/live/milref/index.json (counts per country). A country whose
// Wikidata queries fail keeps the previous run's lists. Exit code 0 unless nothing at all could be read.
import fs from "node:fs";
import { UNIT_ROOTS, INST_ROOTS, CAPS, WB, unitsFrom, equipFrom, instFrom, wbSeriesBy, figureRecord, qidByIso, qid, val, sipriFrom, sipriIds, SIPRI_YEARS, unrocaFrom, unrocaIds } from "./milref_lib.mjs";
import { A3 } from "./econ_lib.mjs";

const OUT = process.env.MILREF_OUT || "data/live/milref";
const ONLY = (process.env.MILREF_ONLY || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const NOW = Date.now(), STAMP = new Date(NOW).toISOString().slice(0, 16) + "Z";
const BUDGET_MS = +(process.env.MILREF_BUDGET_MIN || 45) * 60000;
const UA = "AXIOM-OSAP military reference refresh (+https://github.com/01shane89-jpg/AXIOM-APSAP)";
const WDQ = "https://query.wikidata.org/sparql";
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let retries = 0;
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
    } catch (e) { clearTimeout(t); err = e; retries++; await sleep(Math.min(60, e.retry || 5 * (i + 1)) * 1000); }
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

// ---------- 1b. SIPRI trade register: each country as recipient and as supplier ----------
const SIPRI = "https://atbackend.sipri.org/api/p";
const SIPRI_SRC = { name: "SIPRI Arms Transfers Database", url: "https://www.sipri.org/databases/armstransfers", licence: "© SIPRI; free for non-commercial use with attribution (SIPRI terms and conditions)",
  terms: "https://www.sipri.org/about/terms-and-conditions", nc: true };
const SIPRI_MS = +(process.env.MILREF_SIPRI_MIN || 15) * 60000;
async function sipriPost(path, body, ms = 90000) {
  let err;
  for (let i = 0; i < 3; i++) {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
    try {
      const r = await fetch(SIPRI + path, { method: "POST", signal: ac.signal, body: JSON.stringify(body), headers: { "user-agent": UA, "content-type": "application/json", accept: "application/json" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json(); clearTimeout(t); return j;
    } catch (e) { clearTimeout(t); err = e; await sleep(4000 * (i + 1)); }
  }
  throw err;
}
const sipriBody = (role, id, y0, y1) => ({ filters: [{ field: role, oldField: "", condition: "contains", value1: "", value2: "", listData: [id] },
  { field: "activePrograms", oldField: "", condition: "contains", value1: y0, value2: y1, listData: [] },
  { field: "opendeals", oldField: "", condition: "", value1: "", value2: "", listData: [] }], logic: "AND" });
const sipriCount = {};
if (process.env.MILREF_SIPRI !== "0") {
  const t0 = Date.now(), y1 = Y, y0 = Y - SIPRI_YEARS;
  let ids = {}, ok = 0, bad = [];
  try {
    const list = await getJson(SIPRI + "/countries/getAllCountriesTrimmed");
    ids = sipriIds(list, ISO3, NAMES);
    log("SIPRI countries:", list.length, "matched:", Object.keys(ids).length, "not matched:", CCS.filter((c) => !ids[c === "oki" ? "jp" : c]).join(" ") || "none");
    const used = new Set(Object.values(ids).map((x) => x.id));
    log("SIPRI entries not used (states only):", list.filter((e) => !e.deleted && !used.has(e.EntityId) && !/\*/.test(e.Name || "")).map((e) => e.Name + " [" + e.CountryCode + "]").slice(0, 80).join("; "));
  } catch (e) { log("SIPRI country list:", e.message); }
  fs.mkdirSync(OUT + "/sipri", { recursive: true });
  const todo = CCS.filter((c) => c !== "oki" && ids[c]);
  async function sipriOne(cc) {
    let old = null; try { old = JSON.parse(fs.readFileSync(OUT + "/sipri/" + cc + ".json", "utf8")); } catch (e) {}
    let rec = null;
    if (Date.now() - t0 < SIPRI_MS) {
      try {
        const side = async (role) => { const j = await sipriPost("/trades/trade-register-csv/?output=csv", sipriBody(role, ids[cc].id, y0, y1)); const r = sipriFrom(Buffer.from(j.bytes || "", "base64").toString("utf8")); if (!r) throw new Error("no register in the answer"); return r; };
        const imp = await side("Recipient"), exp = await side("Supplier");
        rec = { cc, name: NAMES[cc], sipri: ids[cc].name, read: STAMP, years: [y0, y1], source: SIPRI_SRC, kind: "source-claims", imp, exp };
        ok++;
      } catch (e) { bad.push(cc); log(cc, "SIPRI:", e.message); }
    }
    if (!rec && old) rec = Object.assign(old, { stale: true });
    if (rec) { fs.writeFileSync(OUT + "/sipri/" + cc + ".json", JSON.stringify(rec) + "\n"); sipriCount[cc] = [rec.imp.total, rec.exp.total]; }
  }
  { let i = 0; await Promise.all(Array.from({ length: 2 }, async () => { while (i < todo.length) await sipriOne(todo[i++]); })); }
  log("SIPRI read:", ok, "of", todo.length, "failed:", bad.join(" ") || "none", "minutes:", Math.round((Date.now() - t0) / 60000));
}

// ---------- 1c. UN Register of Conventional Arms: each country's own reports ----------
const UNR = "https://www.unroca.org";
const UNROCA_SRC = { name: "UN Register of Conventional Arms (UNROCA)", url: "https://www.unroca.org/", licence: "© United Nations; reproduced under the UN terms of use (non-commercial, with attribution)",
  terms: "https://www.un.org/en/about-us/terms-of-use", nc: true, note: "Each number is what the reporting government told the UN: an official claim, not a verified count." };
const UNROCA_MS = +(process.env.MILREF_UNROCA_MIN || 15) * 60000;
const unCount = {};
if (process.env.MILREF_UNROCA !== "0") {
  const t0 = Date.now(); let ids = {}, ok = 0; const bad = [];
  try {
    ids = unrocaIds(await getJson(UNR + "/api/country-list/"), CCS.map((c) => (c === "oki" ? "jp" : c)));
    log("UNROCA countries matched:", Object.keys(ids).length, "not in the register:", CCS.filter((c) => c !== "oki" && !ids[c]).join(" ") || "none");
  } catch (e) { log("UNROCA country list:", e.message); }
  fs.mkdirSync(OUT + "/unroca", { recursive: true });
  // the page links each country's profile and its reports by year: say in the log when the register's addresses stop answering
  for (const c of Object.keys(ids).slice(0, 1)) for (const u of [UNR + "/" + ids[c].slug + "/", UNR + "/" + ids[c].slug + "/report/2022/"]) {
    try { const r = await fetch(u, { method: "GET", headers: { "user-agent": UA } }); log("UNROCA link", u, "HTTP", r.status); } catch (e) { log("UNROCA link", u, e.message); }
  }
  const todo = CCS.filter((c) => c !== "oki" && ids[c]);
  async function unOne(cc) {
    let old = null; try { old = JSON.parse(fs.readFileSync(OUT + "/unroca/" + cc + ".json", "utf8")); } catch (e) {}
    let rec = null;
    if (Date.now() - t0 < UNROCA_MS) {
      for (let i = 0; i < 2 && !rec; i++) {
        try {
          const r = unrocaFrom(await getJson(UNR + "/api/" + encodeURIComponent(ids[cc].slug) + "/", 60000));
          if (!r) throw new Error("no country profile in the answer");
          rec = Object.assign({ cc, name: NAMES[cc], read: STAMP, url: UNR + "/" + ids[cc].slug + "/", source: UNROCA_SRC, kind: "source-claims" }, r);
          ok++;
        } catch (e) { if (i) { bad.push(cc); log(cc, "UNROCA:", e.message); } else await sleep(3000); }
      }
    }
    if (!rec && old) rec = Object.assign(old, { stale: true });
    if (rec) { fs.writeFileSync(OUT + "/unroca/" + cc + ".json", JSON.stringify(rec) + "\n"); unCount[cc] = [rec.reports[0] || 0, rec.hold.length]; }
  }
  { let i = 0; await Promise.all(Array.from({ length: 3 }, async () => { while (i < todo.length) await unOne(todo[i++]); })); }
  log("UNROCA read:", ok, "of", todo.length, "failed:", bad.join(" ") || "none", "with holdings:", Object.values(unCount).filter((v) => v[1]).length, "minutes:", Math.round((Date.now() - t0) / 60000));
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
    eRows = eRows.concat(await sparql(`SELECT ?eq ?en ?mul ?op ?cls ?qty ?start ?end ?ret ?dis ?coord ?sl WHERE {
  VALUES ?op { ${V(ops.slice(i, i + 2500))} }
  ?eq p:P137 ?st. ?st ps:P137 ?op.
  OPTIONAL { ?st pq:P1114 ?qty } OPTIONAL { ?st pq:P580 ?start } OPTIONAL { ?st pq:P582 ?end }
  OPTIONAL { ?eq wdt:P730 ?ret } OPTIONAL { ?eq wdt:P576 ?dis } OPTIONAL { ?eq wdt:P625 ?coord }
  OPTIONAL { ?eq wdt:P31 ?cls }
  ?eq wikibase:sitelinks ?sl.
  ${LAB("?eq")}
}`));
  }
  await names(eRows.map((b) => qid(b, "cls")));
  // the earliest first-flight (P606) or inception (P571) year of each item, in a query of its own: joined into the query
  // above, items with several dates multiply its rows and slow every country down
  const eqs = [...new Set(eRows.map((b) => qid(b, "eq")).filter((x) => /^Q\d+$/.test(x)))];
  for (let i = 0; i < eqs.length; i += 1500) {
    try {
      const yr = await sparql(`SELECT ?eq (MIN(?d) AS ?ff) WHERE { VALUES ?eq { ${V(eqs.slice(i, i + 1500))} } { ?eq wdt:P606 ?d } UNION { ?eq wdt:P571 ?d } } GROUP BY ?eq`);
      eRows = eRows.concat(yr);
    } catch (e) { log(cc, "first-flight years:", e.message); }
  }
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
    note: "Military expenditure and arms transfer series come from SIPRI; armed forces personnel from IISS, The Military Balance." },
  sipri: Object.assign({ file: "sipri/<cc>.json" }, SIPRI_SRC),
  unroca: Object.assign({ file: "unroca/<cc>.json" }, UNROCA_SRC)
};
const index = { asof: STAMP, caps: CAPS, sources: SOURCES, all: {} };
let read = 0, failed = [];
// a few countries at once: Wikidata's answer times vary several-fold over a day (10 to 40 s a country), and one at a time a
// slow day ran out of budget a third of the way through. Wikidata allows 5 parallel queries per client; this stays under it.
const PAR = Math.max(1, Math.min(4, +(process.env.MILREF_PAR || 3)));
async function one(cc) {
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
  index.all[cc] = { n: NAMES[cc], u: (w.units || []).length, e: (w.equip || []).filter((x) => !x.out).length, i: (w.inst || []).length, f: Object.keys(fig).length, st: w.stale ? 1 : 0 };
  const sc = sipriCount[cc === "oki" ? "jp" : cc]; if (sc) { index.all[cc].ti = sc[0]; index.all[cc].te = sc[1]; }
  const uc = unCount[cc === "oki" ? "jp" : cc]; if (uc) { if (uc[0]) index.all[cc].ur = uc[0]; if (uc[1]) index.all[cc].uh = uc[1]; }
  if (W) log(cc, "units", W.units.length + "/" + W.raw.units, "equipment", W.equip.length + "/" + W.raw.equip, "installations", W.inst.length);
}
{ let i = 0; await Promise.all(Array.from({ length: PAR }, async () => { while (i < CCS.length) await one(CCS[i++]); })); }
index.all = Object.fromEntries(Object.entries(index.all).sort((a, b) => a[0].localeCompare(b[0]))); // stable order: small diffs
fs.writeFileSync(OUT + "/index.json", JSON.stringify(index) + "\n");
log("countries written:", CCS.length, "Wikidata read:", read, "failed:", failed.join(" ") || "none", "query retries:", retries, "minutes:", Math.round((Date.now() - NOW) / 60000));
if (!read && !Object.keys(wb).length) { console.error("no source could be read"); process.exit(1); }
