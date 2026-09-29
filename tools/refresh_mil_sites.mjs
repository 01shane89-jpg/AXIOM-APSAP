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

const PROBE = process.env.PROBE === "1", ONLY = (process.env.CONFLICTS || "").split(",").filter(Boolean), FORCE = process.env.SITES_FORCE === "1";
const OUT = "data/live/conflicts/sites", CF = "data/live/conflicts", TIMEOUT = 90000, REFETCH_DAYS = 6.5, CAP = 2500;
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

async function post(url, body, accept) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
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
// Q18691599 military base; its subclasses (air base, naval base, military airfield, fort in use ...) come with P279*.
const WD_ROOTS = ["Q18691599", "Q695850"];
async function wikidata(c) {
  const isos = c.countries.map((x) => '"' + (x === "xk" ? "XK" : x.toUpperCase()) + '"').join(" ");
  const q = `SELECT ?s ?sLabel ?c ?iso ?clsLabel ?art ?osm WHERE {
  VALUES ?iso { ${isos} } VALUES ?root { ${WD_ROOTS.map((x) => "wd:" + x).join(" ")} }
  ?ctry wdt:P297 ?iso. ?s wdt:P17 ?ctry; wdt:P31 ?cls; wdt:P625 ?c. ?cls wdt:P279* ?root.
  FILTER NOT EXISTS { ?s wdt:P576 [] } FILTER NOT EXISTS { ?s wdt:P3999 [] } FILTER NOT EXISTS { ?s wdt:P582 [] }
  OPTIONAL { ?art schema:about ?s; schema:isPartOf <https://en.wikipedia.org/>. }
  OPTIONAL { ?s wdt:P402 ?osm. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul,fr,es,ar,ru,uk,fa,my,th,id,he". }
}`;
  const j = await post("https://query.wikidata.org/sparql", "query=" + encodeURIComponent(q), "application/sparql-results+json");
  const seen = new Map();
  for (const b of j.results.bindings) {
    const qid = b.s.value.split("/").pop(), m = /Point\(([-\d.eE]+) ([-\d.eE]+)\)/.exec(b.c.value);
    if (!m) continue;
    const lo = +m[1], la = +m[2], name = b.sLabel?.value || qid;
    if (/^Q\d+$/.test(name)) continue;   // no label in any listed language
    const prev = seen.get(qid);
    if (prev) { if (b.clsLabel && !prev.cls.includes(b.clsLabel.value)) prev.cls.push(b.clsLabel.value); continue; }
    seen.set(qid, { qid, n: name, la: +la.toFixed(5), lo: +lo.toFixed(5), cc: b.iso.value.toLowerCase(), cls: b.clsLabel ? [b.clsLabel.value] : [],
      w: b.art?.value || "", osmRel: b.osm?.value || "" });
  }
  return [...seen.values()].map((s) => ({ ...s, k: kindOf(s.cls.join(" ") + " " + s.n) }));
}

/* ---------- OpenStreetMap (Overpass) ---------- */
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
async function overpass(q) {
  let last;
  for (const u of OVERPASS) {
    try { return await post(u, "data=" + encodeURIComponent(q), "application/json"); } catch (e) { last = e; await sleep(4000); }
  }
  throw last;
}
async function osm(c, cc) {
  const [[s, w], [n, e]] = c.bounds, a2 = cc === "xk" ? "XK" : cc.toUpperCase();
  const q = `[out:json][timeout:180];area["ISO3166-1"="${a2}"]["admin_level"="2"]->.a;
nwr["military"~"^(airfield|naval_base|base|barracks|ammunition|office)$"]["name"](area.a)(${s},${w},${n},${e});out center tags;`;
  const j = await overpass(q), out = [];
  for (const el of j.elements || []) {
    const t = el.tags || {}, la = el.lat ?? el.center?.lat, lo = el.lon ?? el.center?.lon;
    if (la == null || lo == null) continue;
    if (t.disused || t.abandoned || /^(yes|abandoned|disused)$/.test(t["disused:military"] || "") || t.historic || t["abandoned:military"]) continue;
    // military=office is kept only for headquarters, ministries and commands, not recruiting offices
    if (t.military === "office" && !/headquarter|ministry|command|staff|штаб|міністерств|министерств/i.test((t.name || "") + " " + (t["name:en"] || ""))) continue;
    out.push({ osm: el.type + "/" + el.id, n: t["name:en"] || t["int_name"] || t.name, n2: t["name:en"] && t.name !== t["name:en"] ? t.name : "",
      la: +(+la).toFixed(5), lo: +(+lo).toFixed(5), cc, k: OSM_KIND[t.military] || "base", op: t.operator || "", wd: t.wikidata || "" });
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

/* ---------- reports that name a site ---------- */
const GENERIC = /\b(air ?base|air force base|air station|airbase|airfield|air field|aerodrome|airport|international|military|naval|navy|base|station|barracks|garrison|cantonment|camp|depot|arsenal|headquarters|hq|command|the|of|and|de|du|la|el|al|army|force|forces|air|field|fort|port|nas|afb|raf|range|training|centre|center|school|academy|complex|facility|installation|site|area|brigade|division|regiment|battalion|unit|no\.?|\d+(st|nd|rd|th)?)\b/gi;
const SITE_WORD = /\b(?:air ?base|airbase|airfield|air field|aerodrome|air station|airport|naval base|base|barracks|garrison|depot|arsenal|headquarters|hq|command post|ammunition|munitions?)\b|аеродром|аэродром|авиабаз|арсенал|склад|база|казарм/i;
function coreName(n) {
  const c = String(n || "").replace(/\(.*?\)/g, " ").replace(GENERIC, " ").replace(/[^\p{L}\p{N}' -]/gu, " ").replace(/\s+/g, " ").trim();
  return c.length >= 4 ? c : "";
}
function reText(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
const VAGUE = /^(?:(?:north|south|east|west|northern|southern|eastern|western|central|new|old|upper|lower|great|little|main|joint|national|royal|federal|state|city)\s*)+$/i;
function mentions(c, sites, items) {
  const hits = {}, terms = (c.terms || []).map((t) => { try { return new RegExp("^(?:" + t + ")$", "iu"); } catch (e) { return null; } }).filter(Boolean);
  // a name that is vague, that two sites share, or that is one of the conflict's own place terms (Kyiv, Donetsk ...) says
  // nothing about which site a report means, so it is not matched
  const count = {};
  const coresOf = (s) => {
    const out = new Set();
    for (const n of [s.n, s.n2]) { const c = coreName(n); if (!c) continue; out.add(c); const d = c.replace(/[- ]\d+$/, ""); if (d !== c && d.length >= 4) out.add(d); }
    return [...out].filter((x) => !VAGUE.test(x) && !terms.some((r) => r.test(x)));
  };
  const all = sites.map(coresOf);
  all.forEach((cs) => cs.forEach((x) => (count[x.toLowerCase()] = (count[x.toLowerCase()] || 0) + 1)));
  const cores = all.map((cs, i) => [i, cs.filter((x) => count[x.toLowerCase()] === 1)]).filter((x) => x[1].length);
  const res = cores.map(([i, cs]) => [i, cs.map((c) => new RegExp("(?<![\\p{L}\\p{N}])" + reText(c) + "(?![\\p{L}\\p{N}])", "iu"))]);
  for (const it of items) {
    const text = [it.title_en, it.title, it.summary_en, it.summary].filter(Boolean).join(" • ");
    if (!SITE_WORD.test(text)) continue;
    for (const [i, rs] of res) {
      for (const r of rs) {
        const m = r.exec(text); if (!m) continue;
        // the site word must stand within 60 characters of the name ("strike on Engels airfield", "Hmeimim air base")
        const win = text.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60);
        if (!SITE_WORD.test(win)) continue;
        (hits[i] = hits[i] || []).push({ t: it.title_en || it.title, d: it.date, u: it.link || "", o: it.outlet || "", k: it.kind || "", fp: it.fp || "", st: it.state ? 1 : 0 });
        break;
      }
    }
  }
  for (const i of Object.keys(hits)) hits[i] = hits[i].sort((a, b) => (a.d < b.d ? 1 : -1)).slice(0, 12);
  return hits;
}

/* ---------- run ---------- */
const CFG = JSON.parse(fs.readFileSync("tools/conflicts.json", "utf8"));
if (!PROBE) fs.mkdirSync(OUT, { recursive: true });
const STATE_F = OUT + "/_state.json";
let state = {}; try { state = JSON.parse(fs.readFileSync(STATE_F, "utf8")); } catch (e) {}
const probe = {};
for (const c of CFG.conflicts.filter((c) => c.bounds && (!ONLY.length || ONLY.includes(c.id)))) {
  const file = OUT + "/" + c.id + ".js", prev = readJs(file), st = state[c.id] || {};
  const due = FORCE || PROBE || !prev || !st.built || (NOW - Date.parse(st.built.replace(" ", "T"))) / 864e5 >= REFETCH_DAYS;
  let sites = prev?.sites || [], sources = prev?.sources || [];
  if (due) {
    const src = [], wd = [], om = [];
    try { const r = await wikidata(c); wd.push(...r); src.push({ id: "wikidata", ok: true, n: r.length }); }
    catch (e) { src.push({ id: "wikidata", ok: false, error: errMsg(e) }); }
    await sleep(1500);
    for (const cc of c.countries) {
      try { const r = await osm(c, cc); om.push(...r); src.push({ id: "osm:" + cc, ok: true, n: r.length }); }
      catch (e) { src.push({ id: "osm:" + cc, ok: false, error: errMsg(e) }); }
      await sleep(2500);
    }
    const allFailed = src.every((s) => !s.ok);
    if (PROBE) {
      const cls = {}; wd.forEach((s) => s.cls.forEach((x) => (cls[x] = (cls[x] || 0) + 1)));
      probe[c.id] = { src, wdClasses: cls, wdSample: wd.slice(0, 5), osmSample: om.slice(0, 5), merged: merge(c, wd, om).length };
      console.log(c.id, JSON.stringify(src));
      continue;
    }
    // a source that failed keeps its part of the last good list
    if (!allFailed) {
      const wdOk = src.find((s) => s.id === "wikidata").ok, osmFailed = src.filter((s) => s.id.startsWith("osm:") && !s.ok).map((s) => s.id.slice(4));
      if (!wdOk) wd.push(...sites.filter((s) => s.wd).map((s) => ({ qid: s.wd, n: s.n, la: s.la, lo: s.lo, cc: s.cc, cls: s.cls ? s.cls.split(", ") : [], w: s.w || "", k: s.k })));
      om.push(...sites.filter((s) => s.osm && !s.wd && osmFailed.includes(s.cc)).map((s) => ({ osm: s.osm, n: s.n, n2: s.n2, la: s.la, lo: s.lo, cc: s.cc, k: s.k, op: s.op || "" })));
      sites = merge(c, wd, om); sources = src; state[c.id] = { built: stamp, n: sites.length };
    } else sources = src.concat([{ id: "kept", ok: true, note: "all sources failed; last good list kept" }]);
  }
  if (PROBE) continue;
  const d = readCf(c.id), hits = mentions(c, sites, (d && d.items) || []);
  const data = {
    schema: "osap-cf-sites/1", id: c.id, asof: stamp, built: state[c.id]?.built || "",
    note: "Military sites as the named public sources record them (Wikidata, OpenStreetMap): reported, not verified. Positions are the sources' own. A site on this list is not a target or a finding; 'named in reports' is a machine match of the site's name in this conflict's reports.",
    licences: { wikidata: "CC0", osm: "ODbL 1.0, © OpenStreetMap contributors" },
    sources, sites: sites.map((s, i) => (hits[i] ? { ...s, m: hits[i] } : s))
  };
  fs.writeFileSync(file, "(window.OSAP_CF_SITES=window.OSAP_CF_SITES||{})[" + JSON.stringify(c.id) + "]=" + JSON.stringify(data).replace(/<\//g, "<\\/") + ";\n");
  console.log("sites", c.id.padEnd(22), String(sites.length).padStart(5), "named in reports:", Object.keys(hits).length, due ? "(lists re-read: " + sources.map((s) => s.id + ":" + (s.ok ? s.n : s.error)).join(" ") + ")" : "");
}
if (PROBE) { fs.mkdirSync("probe-out", { recursive: true }); fs.writeFileSync("probe-out/mil_sites.json", JSON.stringify(probe, null, 1)); }
else fs.writeFileSync(STATE_F, JSON.stringify(state, null, 1) + "\n");
