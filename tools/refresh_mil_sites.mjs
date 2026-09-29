// Military sites on the conflict tabs (run by .github/workflows/refresh-conflicts.yml after tools/refresh_conflicts.mjs; or by hand
// with Node 20+). For each conflict in tools/conflicts.json it writes data/live/conflicts/sites/<id>.js:
//   1. Known military sites inside the conflict's map area and countries: bases, air bases and military airfields, naval bases,
//      barracks, depots and headquarters, from two keyless public sources:
//        - Wikidata (CC0): items that are an instance of military base (or a subclass), with coordinates, not marked dissolved;
//        - OpenStreetMap (ODbL, via the Overpass API): named features tagged military=airfield, naval_base, base, barracks,
//          ammunition or office, not tagged disused or abandoned.
//      A site found in both is kept once, with both links. Sites are the sources' own records: "Reported, not verified".
//      Re-read weekly (the lists change slowly); the last good list is kept when a source fails.
//   2. Every run: which of the conflict's own reports (data/live/conflicts/<id>.js and .older.js, written just before) name a
//      site, by its name next to a word such as base, airfield or depot. That is a machine match on text, not a finding that
//      the site was struck; the page shows each matching report with its link and fingerprint.
// No keys, no accounts. PROBE=1 prints what each source returns and writes nothing. CONFLICTS=id,id limits the run.
import fs from "node:fs";
import { ccsAt } from "./geo_cc.mjs";
import { mentions } from "./mil_sites_lib.mjs";

const PROBE = process.env.PROBE === "1", ONLY = (process.env.CONFLICTS || "").split(",").filter(Boolean), FORCE = process.env.SITES_FORCE === "1";
const OUT = "data/live/conflicts/sites", CF = "data/live/conflicts", TIMEOUT = 100000, REFETCH_DAYS = 6.5, CAP = 2500, BUDGET_MS = 8 * 60000;
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z", NOW = Date.now();
const UA = "AXIOM-OSAP/1.0 (conflict map military sites; +https://01shane89-jpg.github.io/AXIOM-APSAP/) node-fetch";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errMsg = (e) => (e.name === "AbortError" ? "timed out" : String(e.cause?.code || e.message || e).slice(0, 160));
const readJs = (f) => { try { const t = fs.readFileSync(f, "utf8"), i = t.indexOf("={"); return JSON.parse(t.slice(i + 1).trim().replace(/;\s*$/, "")); } catch (e) { return null; } };
const readCf = (id) => {
  const p = readJs(CF + "/" + id + ".js"); if (!p) return null;
  const o = readJs(CF + "/" + id + ".older.js"); if (o) p.items = (p.items || []).concat(o.items || []);
  return p;
};

async function post(url, body, accept, ms) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms || TIMEOUT);
  try {
    const r = await fetch(url, { method: "POST", signal: ctl.signal, body, headers: { "user-agent": UA, accept, "content-type": "application/x-www-form-urlencoded" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

/* ---------- kinds ---------- */
// k: air (air base, military airfield), naval, base, barracks, depot (ammunition, arsenal, storage), hq (headquarters, ministry)
function kindOf(text) {
  const t = String(text || "").toLowerCase();
  if (/air ?base|airfield|air field|aerodrome|air station|airport|heliport|helipad|air force station|аеродром|аэродром|авиабаза/.test(t)) return "air";
  if (/naval|navy|marine base|port|fleet|submarine|военно-морск|військово-морськ/.test(t)) return "naval";
  if (/ammunition|arsenal|depot|storage|magazine|warehouse|арсенал|склад/.test(t)) return "depot";
  if (/headquarter|\bhq\b|ministry|command|staff|штаб/.test(t)) return "hq";
  if (/barrack|garrison|cantonment|казарм/.test(t)) return "barracks";
  return "base";
}
const OSM_KIND = { airfield: "air", naval_base: "naval", base: "base", barracks: "barracks", ammunition: "depot", office: "hq" };

/* ---------- Wikidata ---------- */
// Q18691599 military base and Q695850 air base, with all their subclasses (naval base, military airfield ...). The subclass list
// is read once per run in a query of its own: walking the class tree inside the site query makes Wikidata time out (HTTP 504).
const WD_ROOTS = ["Q18691599", "Q695850"];
const WDQ = "https://query.wikidata.org/sparql";
let wdClasses = null;
async function wdClassList() {
  if (wdClasses) return wdClasses;
  const q = `SELECT DISTINCT ?c WHERE { VALUES ?r { ${WD_ROOTS.map((x) => "wd:" + x).join(" ")} } ?c wdt:P279* ?r. }`;
  const j = await post(WDQ, "query=" + encodeURIComponent(q), "application/sparql-results+json");
  wdClasses = j.results.bindings.map((b) => b.c.value.split("/").pop()).filter((x) => /^Q\d+$/.test(x));
  return wdClasses;
}
// One query for the countries of every conflict at once (clipped to each conflict's area afterwards). The query planner is
// switched off so Wikidata walks the listed classes first and never scans every item of a large country (that timed out).
let wdAll = null;
async function wikidataAll(ccs) {
  if (wdAll) return wdAll;
  const cls = await wdClassList();
  const q = `SELECT ?s ?c ?iso ?cls ?en ?lab ?art WHERE {
  hint:Query hint:optimizer "None".
  VALUES ?cls { ${cls.map((x) => "wd:" + x).join(" ")} }
  ?s wdt:P31 ?cls. ?s wdt:P625 ?c. ?s wdt:P17 ?ctry. ?ctry wdt:P297 ?iso.
  FILTER(?iso IN (${ccs.map((x) => '"' + x.toUpperCase() + '"').join(",")}))
  FILTER NOT EXISTS { ?s wdt:P576 [] } FILTER NOT EXISTS { ?s wdt:P3999 [] } FILTER NOT EXISTS { ?s wdt:P582 [] }
  OPTIONAL { ?s rdfs:label ?en. FILTER(LANG(?en) = "en") }
  OPTIONAL { ?s rdfs:label ?lab. FILTER(LANG(?lab) IN ("mul", "fr", "es", "ar", "ru", "uk", "fa", "my", "th", "id", "he", "tr", "ur", "hi")) }
  OPTIONAL { ?art schema:about ?s; schema:isPartOf <https://en.wikipedia.org/>. }
}`;
  const j = await post(WDQ, "query=" + encodeURIComponent(q), "application/sparql-results+json");
  const clsName = await wdClassNames(j.results.bindings.map((b) => b.cls.value.split("/").pop()));
  const seen = new Map();
  for (const b of j.results.bindings) {
    const qid = b.s.value.split("/").pop(), m = /Point\(([-\d.eE]+) ([-\d.eE]+)\)/.exec(b.c.value), cn = clsName[b.cls.value.split("/").pop()];
    if (!m) continue;
    const name = b.en?.value || b.lab?.value || "", local = b.lab?.value || "";
    const prev = seen.get(qid);
    if (prev) { if (cn && !prev.cls.includes(cn)) prev.cls.push(cn); if (!prev.n && name) prev.n = name; if (!prev.n2 && local && local !== prev.n) prev.n2 = local; continue; }
    seen.set(qid, { qid, n: name, n2: local && local !== name ? local : "", la: +(+m[2]).toFixed(5), lo: +(+m[1]).toFixed(5), cc: b.iso.value.toLowerCase(), cls: cn ? [cn] : [], w: b.art?.value || "" });
  }
  wdAll = [...seen.values()].filter((s) => s.n).map((s) => ({ ...s, k: kindOf(s.cls.join(" ") + " " + s.n) }));
  return wdAll;
}
async function wikidata(c, ccs) { return (await wikidataAll(ccs)).filter((s) => c.countries.includes(s.cc)); }
const clsNames = {};
async function wdClassNames(ids) {
  const need = [...new Set(ids)].filter((x) => !(x in clsNames));
  if (need.length) {
    const q = `SELECT ?c ?l WHERE { VALUES ?c { ${need.map((x) => "wd:" + x).join(" ")} } ?c rdfs:label ?l. FILTER(LANG(?l) = "en") }`;
    try { const j = await post(WDQ, "query=" + encodeURIComponent(q), "application/sparql-results+json"); j.results.bindings.forEach((b) => (clsNames[b.c.value.split("/").pop()] = b.l.value)); } catch (e) {}
    need.forEach((x) => { if (!(x in clsNames)) clsNames[x] = ""; });
  }
  return clsNames;
}

/* ---------- OpenStreetMap (Overpass) ---------- */
// One query per conflict over its map area (a bounding box; a query by country outline times out for large countries).
// A feature is kept when it lies in one of the conflict's countries, or where the country outlines here do not cover it.
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
const OP_TRY = 3;
async function overpass(q) {
  let last;
  for (const u of OVERPASS.slice(0, OP_TRY)) {
    if (Date.now() - NOW > BUDGET_MS) throw new Error("out of time");
    const t0 = Date.now();
    try {
      const j = await post(u, "data=" + encodeURIComponent(q), "application/json", 75000);
      if (process.env.SITES_DEBUG) console.log("  overpass", new URL(u).host, Date.now() - t0, "ms", (j.elements || []).length, j.remark || "");
      // Overpass answers 200 with a "remark" when the query ran out of time or memory: that is a failure, not "none found"
      if (j.remark && /error|timed out|out of memory/i.test(j.remark)) throw new Error(String(j.remark).slice(0, 120));
      return j;
    } catch (e) { last = e; if (process.env.SITES_DEBUG) console.log("  overpass", new URL(u).host, Date.now() - t0, "ms", errMsg(e)); await sleep(3000); }
  }
  throw last;
}
// a large map area is asked for in tiles of at most 6 by 6 degrees
function tiles(bounds) {
  const [[s, w], [n, e]] = bounds, out = [], st = 6;
  for (let a = s; a < n; a += st) for (let b = w; b < e; b += st) out.push([a, b, Math.min(a + st, n), Math.min(b + st, e)]);
  return out;
}
async function osm(c) {
  const els = [];
  for (const [s, w, n, e] of tiles(c.bounds)) {
    const q = `[out:json][timeout:60];nwr["military"~"^(airfield|naval_base|base|barracks|ammunition|office)$"]["name"](${s},${w},${n},${e});out center tags;`;
    els.push(...((await overpass(q)).elements || []));
    await sleep(1500);
  }
  const out = [], seenEl = new Set();
  for (const el of els) {
    if (seenEl.has(el.type + el.id)) continue; seenEl.add(el.type + el.id);
    const t = el.tags || {}, la = el.lat ?? el.center?.lat, lo = el.lon ?? el.center?.lon;
    if (la == null || lo == null) continue;
    if (t.disused || t.abandoned || /^(yes|abandoned|disused)$/.test(t["disused:military"] || "") || t.historic || t["abandoned:military"]) continue;
    // military=office is kept only for headquarters, ministries and commands, not recruiting offices
    if (t.military === "office" && !/headquarter|ministry|command|staff|штаб|міністерств|министерств/i.test((t.name || "") + " " + (t["name:en"] || ""))) continue;
    const here = ccsAt(+la, +lo, 0);
    if (here.length && !here.some((x) => c.countries.includes(x))) continue;
    out.push({ osm: el.type + "/" + el.id, n: t["name:en"] || t["int_name"] || t.name, n2: t["name:en"] && t.name !== t["name:en"] ? t.name : "",
      la: +(+la).toFixed(5), lo: +(+lo).toFixed(5), cc: here.find((x) => c.countries.includes(x)) || (c.countries.length === 1 ? c.countries[0] : ""), k: OSM_KIND[t.military] || "base", op: t.operator || "", wd: t.wikidata || "" });
  }
  return out;
}

/* ---------- merge ---------- */
function km(a, b) {
  const R = 6371, dLa = (b.la - a.la) * Math.PI / 180, dLo = (b.lo - a.lo) * Math.PI / 180;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a.la * Math.PI / 180) * Math.cos(b.la * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const inBox = (c, s) => s.la >= c.bounds[0][0] && s.la <= c.bounds[1][0] && s.lo >= c.bounds[0][1] && s.lo <= c.bounds[1][1];
const RANK = { air: 0, naval: 1, hq: 2, depot: 3, base: 4, barracks: 5 };
function merge(c, wd, om) {
  const out = wd.filter((s) => inBox(c, s)).map((s) => ({ n: s.n, k: s.k, la: s.la, lo: s.lo, cc: s.cc, wd: s.qid, w: s.w, cls: s.cls.slice(0, 2).join(", ") }));
  const byQ = new Map(out.map((s) => [s.wd, s]));
  for (const o of om) {
    let hit = o.wd && byQ.get(o.wd);
    if (!hit) hit = out.find((s) => s.wd && !s.osm && km(s, o) < 2.5 && (s.k === o.k || s.k === "base" || o.k === "base"));
    if (hit) { if (!hit.osm) { hit.osm = o.osm; if (o.op) hit.op = o.op; if (o.n2 && !hit.n2) hit.n2 = o.n2; } continue; }
    out.push({ n: o.n, n2: o.n2 || undefined, k: o.k, la: o.la, lo: o.lo, cc: o.cc, osm: o.osm, op: o.op || undefined });
  }
  // Wikidata items and named OSM features first, then by kind; the cap keeps a very large country's barracks from crowding the file
  out.sort((a, b) => (!!b.wd - !!a.wd) || RANK[a.k] - RANK[b.k] || a.n.localeCompare(b.n));
  return out.slice(0, CAP);
}

/* ---------- run ---------- */
const CFG = JSON.parse(fs.readFileSync("tools/conflicts.json", "utf8"));
if (!PROBE) fs.mkdirSync(OUT, { recursive: true });
const STATE_F = OUT + "/_state.json";
let state = {}; try { state = JSON.parse(fs.readFileSync(STATE_F, "utf8")); } catch (e) {}
const probe = {};
const ALLCC = [...new Set(CFG.conflicts.flatMap((c) => c.countries))];
const age = (t) => (t ? (NOW - Date.parse(String(t).replace(" ", "T"))) / 864e5 : Infinity);
const saveState = () => { if (!PROBE) fs.writeFileSync(STATE_F, JSON.stringify(state, null, 1) + "\n"); };
// Wikidata answers every conflict in one query, so its part is re-read for all due conflicts at once. OpenStreetMap is asked
// one conflict at a time, oldest first, within the time budget; once Overpass fails in a run it is not asked again until the
// next run, and each conflict keeps its last OpenStreetMap list meanwhile.
const order = CFG.conflicts.filter((c) => c.bounds && (!ONLY.length || ONLY.includes(c.id)))
  .sort((a, b) => String((state[a.id] || {}).osm || "").localeCompare(String((state[b.id] || {}).osm || "")));
let osmDown = "";
for (const c of order) {
  const file = OUT + "/" + c.id + ".js", prev = readJs(file), st = state[c.id] || (state[c.id] = {});
  // the last list without its report matches (worked out again below)
  const old = (prev?.sites || []).map(({ m, ...s }) => s);
  const src = Object.fromEntries((prev?.sources || []).filter((x) => x.id === "wikidata" || x.id === "osm").map((x) => [x.id, x]));
  let wd = null, om = null;
  if (FORCE || PROBE || age(st.wd) >= REFETCH_DAYS) {
    try { wd = await wikidata(c, ALLCC); src.wikidata = { id: "wikidata", ok: true, n: wd.length, at: stamp }; st.wd = stamp; }
    catch (e) { src.wikidata = { id: "wikidata", ok: false, error: errMsg(e), at: stamp }; }
  }
  if ((FORCE || PROBE || age(st.osm) >= REFETCH_DAYS) && !osmDown && Date.now() - NOW < BUDGET_MS) {
    try { om = await osm(c); src.osm = { id: "osm", ok: true, n: om.length, at: stamp }; st.osm = stamp; }
    catch (e) { osmDown = errMsg(e); src.osm = { id: "osm", ok: false, error: osmDown, at: stamp }; }
  }
  if (PROBE) {
    const cls = {}; (wd || []).forEach((x) => x.cls.forEach((k) => (cls[k] = (cls[k] || 0) + 1)));
    probe[c.id] = { src, wdClasses: cls, wdSample: (wd || []).slice(0, 5), osmSample: (om || []).slice(0, 5), merged: merge(c, wd || [], om || []).length };
    console.log(c.id, JSON.stringify(src));
    continue;
  }
  // a part not re-read (or that failed) is taken from the last list
  if (!wd) wd = old.filter((x) => x.wd).map((x) => ({ qid: x.wd, n: x.n, n2: x.n2, la: x.la, lo: x.lo, cc: x.cc, cls: x.cls ? x.cls.split(", ") : [], w: x.w || "", k: x.k }));
  if (!om) om = old.filter((x) => x.osm).map((x) => ({ osm: x.osm, n: x.n, n2: x.n2, la: x.la, lo: x.lo, cc: x.cc, k: x.k, op: x.op || "", wd: x.wd || "" }));
  const sites = merge(c, wd, om);
  if (!sites.length && !prev && !src.wikidata?.ok && !src.osm?.ok) { saveState(); continue; }   // nothing yet: next run
  st.n = sites.length; st.built = [st.wd, st.osm].filter(Boolean).sort().pop() || "";
  const d = readCf(c.id), hits = mentions(c, sites, (d && d.items) || []);
  const data = {
    schema: "osap-cf-sites/1", id: c.id, asof: stamp, built: st.built,
    note: "Military sites as the named public sources record them (Wikidata, OpenStreetMap): reported, not verified. Positions are the sources' own. A site on this list is not a target or a finding; 'named in reports' is a machine match of the site's name in this conflict's reports.",
    licences: { wikidata: "CC0", osm: "ODbL 1.0, © OpenStreetMap contributors" },
    sources: Object.values(src), sites: sites.map((x, i) => (hits[i] ? { ...x, m: hits[i] } : x))
  };
  fs.writeFileSync(file, "(window.OSAP_CF_SITES=window.OSAP_CF_SITES||{})[" + JSON.stringify(c.id) + "]=" + JSON.stringify(data).replace(/<\//g, "<\\/") + ";\n");
  saveState();
  console.log("sites", c.id.padEnd(22), String(sites.length).padStart(5), "named in reports:", String(Object.keys(hits).length).padStart(3), " ", Object.values(src).map((x) => x.id + ":" + (x.ok ? x.n : x.error) + (x.at === stamp ? "" : " (kept)")).join(" "));
}
if (PROBE) { fs.mkdirSync("probe-out", { recursive: true }); fs.writeFileSync("probe-out/mil_sites.json", JSON.stringify(probe, null, 1)); }
if (osmDown) console.log("Overpass failed this run (" + osmDown + "); the conflicts not reached keep their last OpenStreetMap list and are tried next run.");
