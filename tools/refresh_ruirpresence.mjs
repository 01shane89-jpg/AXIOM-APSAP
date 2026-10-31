// Russian and Iranian presence, every country: the "Russian presence" and "Iranian presence" data sets (index.html, the same
// pane as Chinese presence). Run by .github/workflows/refresh-ruirpresence.yml (monthly), or by hand with Node 22+:
//   node tools/refresh_ruirpresence.mjs        (RIP_DEBUG=1 prints more)
// Shane 2026-10-31: "Add a similar Russia and Iran layer too". There is no open dataset of Russian or Iranian state finance like
// AidData's for China, so two open, keyless sources, each tagged with its licence in the index and on every record:
//   - The U.S. Consolidated Screening List (public domain): organisations (never individuals) that list an address in a country
//     and are linked to Russia or Iran, by also listing an address there or by being listed under a sanctions programme aimed
//     at it. Placed at the listed city (GeoNames cities, CC BY 4.0) when the city can be found, otherwise listed without a pin.
//   - Wikidata (CC0): sites outside Russia or Iran (bases, embassies, nuclear and power plants, ports, mines, oil and gas
//     fields, company sites) whose operator or owner is a Russian or Iranian organisation, state body or armed force.
// Every record is a claim by its source, not an OSAP finding, and carries a SHA-256 fingerprint.
// Output: data/rupresence/<cc>.json and data/irpresence/<cc>.json { v, cc, actor, at, items } with an index.json each.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { ccsAt, ccFromA2, COUNTRIES } from "./geo_cc.mjs";

const OUT_ROOT = process.env.RIP_OUT || "data", DEBUG = !!process.env.RIP_DEBUG;
const TMP = process.env.RUNNER_TEMP || "/tmp";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AXIOM-OSAP Russian and Iranian presence snapshot (+https://github.com/01shane89-jpg/AXIOM-APSAP)";
const log = (...a) => console.log(...a);
const dbg = (...a) => DEBUG && console.log("  ·", ...a);
const fp = (...p) => createHash("sha256").update(p.join("|")).digest("hex");
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const clip = (s, n = 300) => { const t = String(s == null ? "" : s).replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const IDS = new Set(COUNTRIES.map((c) => c.id));
const now = new Date().toISOString().slice(0, 16) + "Z";
const CLAIM = "Reported, not verified";
const LISTED = "Listing by the U.S. government; a listing is a U.S. legal designation, not a finding of fact by OSAP";

async function get(url, opt = {}, ms = 300000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...opt, signal: ctl.signal, headers: { "user-agent": UA, accept: "*/*", ...(opt.headers || {}) } });
    if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
    return opt.buffer ? Buffer.from(await r.arrayBuffer()) : await r.text();
  } finally { clearTimeout(t); }
}
function ccOf(lat, lon, hint) {
  if (lat == null || lon == null || !isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const at = ccsAt(lat, lon, 0.3);
  if (hint && at.includes(hint)) return hint;
  return at[0] || hint || null;
}
/* ---------- GeoNames cities, to place a listed address ---------- */
let CITIES = null;
const normCity = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\b(city|district|shi|qu|xian|province|special administrative region|sar)\b/g, "").replace(/[^a-z]/g, "");
async function cities() {
  if (CITIES) return CITIES;
  const zip = join(TMP, "cities15000.zip");
  writeFileSync(zip, await get("https://download.geonames.org/export/dump/cities15000.zip", { buffer: true }));
  const txt = execFileSync("unzip", ["-p", zip, "cities15000.txt"], { maxBuffer: 512 * 1024 * 1024 }).toString("utf8");
  CITIES = new Map();
  for (const ln of txt.split("\n")) {
    const f = ln.split("\t"); if (f.length < 15) continue;
    const a2 = f[8], pop = +f[14] || 0, la = +f[4], lo = +f[5];
    const names = new Set([f[1], f[2], ...String(f[3] || "").split(",")].map(normCity).filter((n) => n.length >= 3));
    for (const n of names) { const k = a2 + ":" + n, o = CITIES.get(k); if (!o || o.pop < pop) CITIES.set(k, { la, lo, pop, nm: f[2] }); }
  }
  log("geonames:", CITIES.size, "city names");
  return CITIES;
}
function findCity(a2, parts) {
  if (!CITIES) return null;
  for (const p of parts) { const n = normCity(p); if (n.length < 3) continue; const c = CITIES.get(a2 + ":" + n); if (c) return c; }
  return null;
}

const LIST_SHORT = { "Entity List": "Commerce Entity List", "Military End User": "Commerce Military End-User list", "Unverified List": "Commerce Unverified List",
  "Denied Persons List": "Commerce Denied Persons list", "Specially Designated Nationals": "Treasury SDN list", "Non-SDN Chinese Military-Industrial Complex": "Treasury Chinese Military-Industrial Complex list",
  "Sectoral Sanctions": "Treasury Sectoral Sanctions list", "Foreign Sanctions Evaders": "Treasury Foreign Sanctions Evaders list", "Nonproliferation Sanctions": "State nonproliferation sanctions",
  "ITAR Debarred": "State ITAR debarred list", "Menu-Based Sanctions": "Treasury menu-based sanctions list", "Capta": "Treasury CAPTA list" };
const shortList = (s) => { for (const [k, v] of Object.entries(LIST_SHORT)) if (String(s).toLowerCase().includes(k.toLowerCase())) return v; return clip(s, 80); };

/* the two actors: home country, its Wikidata item, the U.S. sanctions programmes aimed at it, and the words that place a site */
const ACTORS = {
  ru: { name: "Russian", dir: "rupresence", home: "ru", a2: ["RU"], qid: "Q159",
    progs: /\b(RUSSIA-EO14024|UKRAINE-EO1366[0-2]|UKRAINE-EO13685|CAATSA - RUSSIA|CAATSA-RUSSIA|RUSSIA-EO14039|RUSSIA-EO14068|RUSSIA-EO14071|RUSSIA-EO14114|CYBER2|ELECTION-EO13848|MAGNIT|SSIDES)\b|russia/i },
  ir: { name: "Iranian", dir: "irpresence", home: "ir", a2: ["IR"], qid: "Q794",
    progs: /\b(IRAN|IRGC|IFSR|IRAN-HR|IRAN-TRA|IRAN-CON-ARMS-EO|IRAN-EO13846|IRAN-EO13871|IRAN-EO13876|IRAN-EO13902|IRAN-EO13949|HIFPAA|NPWMD-IRAN)\b|iran/i },
};
const SOURCES = {
  uslists: { name: "Organisations on U.S. restricted-party lists (Consolidated Screening List)", org: "U.S. International Trade Administration (Commerce, State, Treasury lists)",
    lic: "U.S. government work, public domain", url: "https://www.trade.gov/consolidated-screening-list" },
  wikidata: { name: "State-run and state-owned sites abroad (Wikidata operator and owner records)", org: "Wikidata", lic: "CC0", url: "https://www.wikidata.org/" },
  geonames: { name: "City positions for listed addresses (GeoNames cities over 15,000 people)", org: "GeoNames", lic: "CC BY 4.0", url: "https://www.geonames.org/" },
};
const prevOf = (dir) => {
  const out = [], D = join(OUT_ROOT, dir);
  if (!existsSync(D)) return out;
  for (const f of readdirSync(D)) if (/^[a-z]{2,3}\.json$/.test(f)) {
    try { for (const it of JSON.parse(readFileSync(join(D, f), "utf8")).items || []) out.push({ cc: f.slice(0, -5), it }); } catch {}
  }
  return out;
};

/* ---------- U.S. lists: an organisation is in a country's file when it lists an address there and is linked to the actor
   (it also lists an address in the actor's home country, or it is listed under a programme aimed at the actor) ---------- */
async function readCsl() {
  const j = JSON.parse(await get("https://data.trade.gov/downloadable_consolidated_screening_list/v1/consolidated.json"));
  const list = Array.isArray(j) ? j : j.results || j.data;
  if (!Array.isArray(list)) throw new Error("unexpected shape");
  log("uslists:", list.length, "listings");
  await cities().catch((e) => log("geonames failed:", e.message));
  return list;
}
function uslists(list, key) {
  const A = ACTORS[key], out = [];
  for (const e of list) {
    const type = String(e.type || "").toLowerCase();
    if (type === "individual" || type === "person" || type === "vessel" || type === "aircraft") continue;   // organisations only
    const name = clip(e.name, 160); if (!name) continue;
    const addrs = (Array.isArray(e.addresses) ? e.addresses : []).map((a) => ({ ...a, a2: String(a.country || "").trim().toUpperCase() }))
      .map((a) => ({ ...a, cc: ccFromA2(a.a2) })).filter((a) => a.cc);
    if (!addrs.length) continue;
    const src = String(e.source || ""), progs = [].concat(e.programs || []).join(", ");
    const atHome = addrs.some((a) => A.a2.includes(a.a2)), byProg = A.progs.test(progs);
    const ccs = new Set(addrs.map((a) => a.cc).filter((c) => c === A.home || atHome || byProg));
    if (!ccs.size) continue;
    const list1 = shortList(src), start = String(e.start_date || "").slice(0, 10) || null;
    const why = [atHome && "lists an address in " + (A.home === "ru" ? "Russia" : "Iran"), byProg && "listed under a programme aimed at " + (A.home === "ru" ? "Russia" : "Iran")].filter(Boolean);
    for (const cc of ccs) {
      if (!IDS.has(cc)) continue;
      const here = addrs.filter((a) => a.cc === cc), a2 = (COUNTRIES.find((c) => c.id === cc) || {}).a2 || "";
      let place = null;
      for (const a of here) { const c = findCity(a.a2 || a2, [a.city, a.state]); if (c) { place = c; break; } }
      const where = here.map((a) => [a.city, a.state].filter(Boolean).join(", ")).filter(Boolean)[0] || "";
      const id = String(e.id || e._id || e.entity_number || fp(src, name).slice(0, 16));
      out.push({ cc, it: {
        id: "rip:" + key + ":us:" + fp(id, cc).slice(0, 16), src: "uslists", type: "presence", domain: "land", name, kind: "listed_company", sym: "pr_listed",
        lat: place ? r4(place.la) : null, lon: place ? r4(place.lo) : null, prec: place ? "city of the listed address (" + place.nm + ")" : "no position: listed address only",
        place: where || null, actor: name, state: "current",
        why: clip("On the " + list1 + (start ? " since " + start : "") + (progs ? " (programme " + progs + ")" : "") + ". " + A.name + " link: " + (why.join("; ") || "listed at an address in " + (A.home === "ru" ? "Russia" : "Iran")) + "." +
          (e.federal_register_notice ? " Federal Register " + e.federal_register_notice + "." : ""), 400),
        list: list1, claim_status: LISTED, last_reported: start, lic: SOURCES.uslists.lic,
        evidence: [{ date: start, t: list1 + ": " + name, src: e.source_list_url || e.source_information_url || SOURCES.uslists.url, srcname: "U.S. Consolidated Screening List" }],
        fp: fp("uslists", key, id, name, cc, src) } });
    }
  }
  return out;
}

/* ---------- Wikidata: sites abroad that the actor's state, armed forces or companies operate or own ----------
   Two bound queries, as a free path search times out: the operators (organisations whose country is the actor's, that
   operate or own anything with coordinates), then the sites they operate or own outside the home country. */
async function sparql(q) {
  const opt = { method: "POST", body: "query=" + encodeURIComponent(q), headers: { accept: "application/sparql-results+json", "content-type": "application/x-www-form-urlencoded" } };
  for (let k = 0; ; k++) {
    try { return JSON.parse(await get("https://query.wikidata.org/sparql", opt, 120000)).results.bindings; }
    catch (e) { if (k >= 1) throw e; log("  wikidata retry after", e.message.slice(0, 80)); await new Promise((r) => setTimeout(r, 20000)); }
  }
}
function siteKind(words) {
  if (/\b(military|air ?base|naval|navy|army|garrison|airfield|barracks|base)\b/i.test(words)) return ["military_site", "pr_site"];
  if (/\b(embassy|consulate|diplomatic|mission|cultural cent(er|re)|russian house)\b/i.test(words)) return ["diplomatic", "pr_site"];
  if (/\b(port|terminal|harbou?r|quay|wharf|pier|dock)\b/i.test(words)) return ["port_terminal", "pr_port"];
  if (/\b(nuclear|power|plant|station|dam|hydro|refiner\w*|oil|gas|pipeline|field|mine|mining)\b/i.test(words)) return ["energy_project", "pr_power"];
  if (/\b(telecom\w*|satellite|radar|ground station|antenna)\b/i.test(words)) return ["telecom", "pr_telecom"];
  if (/\b(railway|road|bridge|airport)\b/i.test(words)) return ["transport_project", "pr_transport"];
  return ["state_company_site", "pr_commerce"];
}
/* state bodies, forces and state-owned companies, looked up by name; their direct subsidiaries and parts are added */
const STATE_ORGS = {
  ru: ["Rosatom", "Gazprom", "Gazprom Neft", "Rosneft", "Transneft", "Zarubezhneft", "Russian Railways", "Roscosmos", "Rostec", "Rosoboronexport",
    "Inter RAO", "RusHydro", "VTB Bank", "Sberbank", "Ministry of Defence of the Russian Federation", "Ministry of Foreign Affairs of Russia",
    "Russian Armed Forces", "Russian Navy", "Russian Aerospace Forces", "Russian Ground Forces", "Wagner Group", "Africa Corps", "Rossotrudnichestvo",
    "Federal Security Service", "Foreign Intelligence Service (Russia)", "GRU", "United Shipbuilding Corporation", "Novatek", "Lukoil"],
  ir: ["Islamic Revolutionary Guard Corps", "Quds Force", "National Iranian Oil Company", "National Iranian Gas Company", "Ministry of Foreign Affairs of Iran",
    "Islamic Republic of Iran Army", "Islamic Republic of Iran Navy", "Islamic Republic of Iran Shipping Lines", "MAPNA Group", "Khatam al-Anbiya Construction Headquarters",
    "Iran Khodro", "Bank Melli Iran", "Mahan Air", "Iran Air", "Atomic Energy Organization of Iran", "Ministry of Defence and Armed Forces Logistics", "Hezbollah"],
};
/* not places: events, crashes, lists, people; Soviet-era bodies are history, not present presence */
const NOT_SITE = /\b(accident|incident|crash|collision|flight|hijacking|disaster|shootdown|bombing|attack|list|Wikimedia|event|battle|operation|human|ship|vessel|aircraft|airliner|film|album|book)\b/i;
async function wikidata(key) {
  const A = ACTORS[key], roots = new Set([A.qid]);
  for (const n of STATE_ORGS[key]) {
    try {
      const j = JSON.parse(await get("https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=3&search=" + encodeURIComponent(n), {}, 60000));
      const r = (j.search || []).find((x) => !/\b(person|human|footballer|album|film|song|village|river)\b/i.test(x.description || ""));
      if (r) { roots.add(r.id); dbg("root", n, r.id, r.label, r.description); }
    } catch (e) { log("wikidata: search", n, e.message.slice(0, 80)); }
  }
  const vals = (ids) => [...ids].map((x) => "wd:" + x).join(" ");
  const ops = new Set(roots);
  for (const b of await sparql(`SELECT DISTINCT ?sub WHERE { VALUES ?root { ${vals([...roots].filter((x) => x !== A.qid))} } ?sub wdt:P749|wdt:P127|wdt:P361 ?root . }`)) ops.add(b.sub.value.split("/").pop());
  /* the country's military units (bases abroad are usually operated by a unit) */
  for (const b of await sparql(`SELECT DISTINCT ?u WHERE { ?u wdt:P31/wdt:P279? wd:Q176799 ; wdt:P17 wd:${A.qid} . FILTER NOT EXISTS { ?u wdt:P576 ?e } }`)) ops.add(b.u.value.split("/").pop());
  log("wikidata", key + ":", roots.size, "state bodies,", ops.size, "with subsidiaries, parts and units");
  const rows = [], all = [...ops];
  for (let i = 0; i < all.length; i += 200) rows.push(...(await sparql(`SELECT ?site ?siteLabel ?coord ?opLabel ?clsLabel ?start ?end WHERE { VALUES ?op { ${vals(all.slice(i, i + 200))} }
      ?site wdt:P137|wdt:P127 ?op . ?site wdt:P625 ?coord . OPTIONAL { ?site wdt:P31 ?cls } OPTIONAL { ?site wdt:P571 ?start } OPTIONAL { ?site wdt:P576 ?end }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`)));
  const seen = new Map(), drop = new Set();
  for (const b of rows) {
    if (!b.siteLabel || /^Q\d+$/.test(b.siteLabel.value)) continue;
    const id = b.site.value.split("/").pop(), m = /Point\(([-\d.eE]+) ([-\d.eE]+)\)/.exec(b.coord.value); if (!m) continue;
    const cls = b.clsLabel ? b.clsLabel.value : "", opl = b.opLabel ? b.opLabel.value : "";
    if (NOT_SITE.test(cls) || /^list of\b|\bflight \d/i.test(b.siteLabel.value) || /soviet|ussr/i.test(opl)) { drop.add(id); continue; }
    const o = seen.get(id) || { id, name: b.siteLabel.value, lon: +m[1], lat: +m[2], ops: new Set(), cls: new Set(), start: b.start ? b.start.value.slice(0, 4) : null, end: b.end ? b.end.value.slice(0, 4) : null };
    if (opl && !/^Q\d+$/.test(opl)) o.ops.add(opl); if (cls) o.cls.add(cls); seen.set(id, o);
  }
  for (const id of drop) seen.delete(id);
  log("wikidata", key + ":", rows.length, "rows,", seen.size, "sites,", drop.size, "dropped as events, lists or Soviet-era");
  const out = [];
  for (const o of seen.values()) {
    const cc = ccOf(o.lat, o.lon); if (!cc || !IDS.has(cc) || cc === A.home) continue;
    const op = [...o.ops].slice(0, 3).join(", ") || A.name + " state body", cls = [...o.cls].slice(0, 3).join(", ");
    const [kind, sym] = siteKind(o.name + " " + cls + " " + op);
    out.push({ cc, it: {
      id: "rip:" + key + ":wd:" + o.id, src: "wikidata", type: "presence", domain: kind === "port_terminal" ? "sea" : "land", name: clip(o.name, 140), kind, sym,
      lat: r4(o.lat), lon: r4(o.lon), prec: "Wikidata coordinates", actor: clip(op, 140), state: o.end ? "past" : "current",
      why: clip((cls ? cls.charAt(0).toUpperCase() + cls.slice(1) + ". " : "") + "Recorded in Wikidata as operated or owned by " + op + (o.start ? ", from " + o.start : "") + (o.end ? ", closed or ended " + o.end : "") +
        ". Ownership and operation change; check the source.", 320),
      claim_status: CLAIM, last_reported: null, lic: SOURCES.wikidata.lic,
      evidence: [{ date: null, t: "Wikidata " + o.id, src: "https://www.wikidata.org/wiki/" + o.id, srcname: "Wikidata" }],
      fp: fp("wikidata", key, o.id, op, o.lat.toFixed(4), o.lon.toFixed(4)) } });
  }
  return out;
}

/* ---------- run: each source for each actor; a source that fails keeps the actor's records from the last good run ---------- */
let csl = null, cslErr = null;
try { csl = await readCsl(); } catch (e) { cslErr = e; log("uslists: FAILED:", e.message); }
let bad = 0;
for (const key of Object.keys(ACTORS)) {
  const A = ACTORS[key], D = join(OUT_ROOT, A.dir), prev = prevOf(A.dir);
  const prevIx = (() => { try { return JSON.parse(readFileSync(join(D, "index.json"), "utf8")); } catch { return { sources: {} }; } })();
  const byCc = new Map(), status = {};
  const add = (list) => { for (const { cc, it } of list) (byCc.get(cc) || byCc.set(cc, []).get(cc)).push(it); };
  const keep = (src, err) => { const old = prev.filter((x) => x.it.src === src); add(old); status[src] = { ok: false, at: (prevIx.sources[src] || {}).at || null, n: old.length, err: clip(err.message, 200) }; bad++; };
  if (csl) { const l = uslists(csl, key); add(l); status.uslists = { ok: true, at: now, n: l.length }; } else keep("uslists", cslErr);
  try { const l = await wikidata(key); add(l); status.wikidata = { ok: true, at: now, n: l.length }; } catch (e) { log("wikidata", key, "FAILED:", e.message); keep("wikidata", e); }
  if (csl) status.geonames = { ok: !!CITIES, at: now };
  mkdirSync(D, { recursive: true });
  const countries = {}, order = { wikidata: 0, uslists: 1 };
  for (const [cc, list] of byCc) {
    const seen = new Set(), items = list.filter((i) => !seen.has(i.id) && seen.add(i.id)).sort((a, b) => order[a.src] - order[b.src] || String(a.name).localeCompare(b.name));
    const n = {}; for (const i of items) n[i.src] = (n[i.src] || 0) + 1;
    countries[cc] = n;
    writeFileSync(join(D, cc + ".json"), JSON.stringify({ v: 1, cc, actor: key, at: now, items }) + "\n");
  }
  for (const f of readdirSync(D)) if (/^[a-z]{2,3}\.json$/.test(f) && !countries[f.slice(0, -5)]) unlinkSync(join(D, f));
  const sources = {}; for (const [id, s] of Object.entries(SOURCES)) sources[id] = { ...s, ...(status[id] || prevIx.sources[id] || { ok: false }) };
  writeFileSync(join(D, "index.json"), JSON.stringify({ v: 1, actor: key, at: now, sources, countries }, null, 1) + "\n");
  log(A.name + ":", Object.keys(countries).length, "countries;", Object.entries(status).map(([k, s]) => k + " " + (s.ok ? "ok" : "FAILED") + " " + (s.n != null ? s.n : "")).join(", "));
}
if (bad >= 4) process.exit(1);
