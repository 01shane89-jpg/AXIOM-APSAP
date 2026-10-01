// Stored health facilities and landing sites for the Medical plan (assets/osap-medplan.js), so a plan never depends on a live
// Overpass answer from a phone. Run by .github/workflows/refresh-medfac.yml, or by hand with Node 20+:
//   node tools/build_medfac.mjs [cc ...]        (no codes: the countries never built first, then the stalest, until the budget)
//   MEDFAC_BUDGET_MIN=45 (minutes to spend)  MEDFAC_MAX_AGE_D=28 (rebuild a country older than this)  MEDFAC_DEBUG=1
// For each country (the 28 hand-researched first, then every other in data/basemap/world-countries.js) one Overpass query by
// the country's ISO 3166-1 boundary reads hospitals, clinics, helipads, heliports, airfields and ambulance and air rescue
// stations, keeping only the tags the plan reads. A country too big for one answer is asked in bounding-box parts (still
// clipped to its boundary). Elements are written into 2-degree tiles shared by all countries:
//   data/medfac/t/<lat>_<lon>.json   [["n123", lat, lon, "th", {tags}], ...]   (lat, lon: the tile's south-west corner)
//   data/medfac/index.json          { v, tile, countries: { th: { at, base, n: {h,c,l,e}, tiles: [...] } }, tiles: { key: count } }
// A country is listed in index.countries only once a whole answer for it has been written, so the plan knows where the
// stored copy is complete and where it must still ask Overpass live.
// Privacy: a clinic whose name reads as a doctor's keeps no name and no contacts (the same rule the plan applies), so no
// private person's name or number is stored. Disused or abandoned landing sites and non-medical "clinics" (dentists,
// pharmacies and the like) are left out.
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.MEDFAC_OUT || "data/medfac", TDIR = join(OUT, "t"), TILE = 2;
const BUDGET = (+process.env.MEDFAC_BUDGET_MIN || 45) * 60000, MAX_AGE = (+process.env.MEDFAC_MAX_AGE_D || 28) * 864e5;
const DEBUG = !!process.env.MEDFAC_DEBUG, T0 = Date.now();
const UA = "AXIOM-OSAP medical-plan facility snapshot (https://github.com/01shane89-jpg/AXIOM-APSAP)";
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

/* tags the plan reads (assets/osap-medplan.js sortOsm, contactsOf, capability) */
const KEEP = ["name", "name:en", "official_name", "amenity", "healthcare", "healthcare:speciality", "emergency", "emergency:phone", "beds",
  "operator", "operator:type", "phone", "contact:phone", "website", "contact:website", "addr:full", "addr:housenumber", "addr:street",
  "addr:subdistrict", "addr:district", "addr:city", "addr:province", "addr:postcode", "aeroway", "icao", "iata", "surface", "aerodrome:type", "military"];
const CONTACT = ["phone", "contact:phone", "emergency:phone", "website", "contact:website", "addr:full", "addr:housenumber", "addr:street"];
const NOT_MED = /^(dentist|optometrist|physiotherapist|psychotherapist|alternative|laboratory|pharmacy|blood_donation|sample_collection|audiologist|speech_therapist|podiatrist|veterinary|counselling|birthing_centre)$/;
const PERSON = /(^|[\s.(])(dr|dra|drs|doctor|doktor|dokter|docteur|dottor|médico|medico)(\b|\.)|клиника доктора/i;

/* ---------- countries ---------- */
function countries() {
  const html = readFileSync("index.html", "utf8"), list = [];
  const block = html.slice(html.indexOf("var COUNTRIES = ["), html.indexOf("window.OSAP_COUNTRIES = COUNTRIES"));
  for (const m of block.matchAll(/\{ id: "([a-z]{2})", name: "([^"]+)"[^\n]*bounds: \[\[([-\d.]+), ([-\d.]+)\], \[([-\d.]+), ([-\d.]+)\]\]/g))
    list.push({ id: m[1], name: m[2], b: [[+m[3], +m[4]], [+m[5], +m[6]]] });
  const w = readFileSync("data/basemap/world-countries.js", "utf8");
  const world = JSON.parse(w.slice(w.indexOf("["), w.lastIndexOf("]") + 1));
  const seen = new Set(list.map((c) => c.id));
  for (const c of world) if (/^[a-z]{2}$/.test(c.id) && !seen.has(c.id) && c.bounds) { seen.add(c.id); list.push({ id: c.id, name: c.name, b: c.bounds }); }
  return list;
}

/* ---------- Overpass ---------- */
async function post(url, q, ms) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { method: "POST", signal: ctl.signal, body: "data=" + encodeURIComponent(q),
      headers: { "user-agent": UA, accept: "application/json", "content-type": "application/x-www-form-urlencoded" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    if (j.remark && /runtime error|out of memory|timed out/i.test(j.remark)) throw new Error("Overpass: " + j.remark.slice(0, 120));
    return j;
  } catch (e) { throw new Error(e.name === "AbortError" ? "no answer in " + Math.round(ms / 1000) + " s" : e.message); }
  finally { clearTimeout(t); }
}
async function overpass(q) {
  const errs = [];
  for (const u of OVERPASS) {
    for (let k = 0; k < 2; k++) {
      const t0 = Date.now();
      try { const j = await post(u, q, 200000); if (DEBUG) log("   ", new URL(u).host, Date.now() - t0, "ms", (j.elements || []).length); return j; }
      catch (e) {
        errs.push(new URL(u).host + ": " + e.message); if (DEBUG) log("   ", new URL(u).host, e.message);
        if (/429/.test(e.message)) { await sleep(30000); continue; }
        break;
      }
    }
    await sleep(5000);
  }
  throw new Error(errs.join("; "));
}
/* a smaller declared timeout and memory size: a busy Overpass server turns away big declared queries (HTTP 504 or 429) */
function query(cc, bbox) {
  const f = bbox ? `(${bbox.flat().map((x) => (+x).toFixed(4)).join(",")})` : "";
  return `[out:json][timeout:${bbox ? 120 : 180}][maxsize:536870912];area["ISO3166-1"="${cc.toUpperCase()}"][admin_level=2]->.a;.a out ids;(` +
    `nwr(area.a)${f}["amenity"~"^(hospital|clinic)$"];nwr(area.a)${f}["healthcare"~"^(hospital|clinic)$"];` +
    `nwr(area.a)${f}["aeroway"~"^(helipad|heliport|aerodrome)$"];nwr(area.a)${f}["emergency"~"^(ambulance_station|air_rescue_service)$"];);out center tags;`;
}
/* the whole country in one answer; a failure is asked again in four parts, down to three levels */
async function fetchCountry(c) {
  /* a country that keeps failing gives up after 8 minutes, so one bad country cannot spend the run's budget */
  const until = Date.now() + 8 * 60000;
  async function part(bbox, depth) {
    try {
      const j = await overpass(query(c.id, bbox));
      if (!(j.elements || []).some((e) => e.type === "area")) throw new Error("no boundary for " + c.id.toUpperCase() + " in OpenStreetMap");
      return { els: j.elements.filter((e) => e.type !== "area"), base: j.osm3s && j.osm3s.timestamp_osm_base };
    } catch (e) {
      if (/no boundary/.test(e.message) || depth >= 3 || Date.now() > until) throw e;
      const [[s, w], [n, ea]] = bbox || [[c.b[0][0], c.b[0][1]], [c.b[1][0], c.b[1][1]]];
      const mla = (s + n) / 2, mlo = (w + ea) / 2, out = { els: [], base: null };
      log("  split", c.id, depth + 1, "(" + e.message.slice(0, 80) + ")");
      for (const q of [[[s, w], [mla, mlo]], [[s, mlo], [mla, ea]], [[mla, w], [n, mlo]], [[mla, mlo], [n, ea]]]) {
        await sleep(8000);
        const r = await part(q.map((p) => p.slice()), depth + 1); out.els.push(...r.els); out.base = out.base || r.base;
      }
      return out;
    }
  }
  /* Overpass bbox filters are (south,west,north,east) */
  return part(null, 0);
}

/* ---------- slimming ---------- */
function slim(e, cc) {
  const t = e.tags || {}, lat = e.lat != null ? e.lat : e.center && e.center.lat, lon = e.lon != null ? e.lon : e.center && e.center.lon;
  if (lat == null || lon == null) return null;
  const hosp = t.amenity === "hospital" || t.healthcare === "hospital", clinic = !hosp && (t.amenity === "clinic" || t.healthcare === "clinic");
  if (t.aeroway && (t.disused || t.abandoned || /^(disused|abandoned|closed)$/.test(t["aeroway:status"] || ""))) return null;
  if (clinic && NOT_MED.test(t.healthcare || "")) return null;
  if (!hosp && !clinic && !t.aeroway && !/^(ambulance_station|air_rescue_service)$/.test(t.emergency || "")) return null;
  const g = {};
  for (const k of KEEP) if (t[k] != null && t[k] !== "") g[k] = String(t[k]).slice(0, 200);
  if (clinic && PERSON.test(t["name:en"] || t.name || t.official_name || "")) {
    delete g.name; delete g["name:en"]; delete g.official_name; for (const k of CONTACT) delete g[k]; g["osap:withheld"] = "1";
  }
  return [e.type.charAt(0) + e.id, +lat.toFixed(5), +lon.toFixed(5), cc, g];
}
const tileKey = (lat, lon) => Math.floor(lat / TILE) * TILE + "_" + Math.floor(lon / TILE) * TILE;

/* ---------- files ---------- */
function readJSON(p, d) { try { return JSON.parse(readFileSync(p, "utf8")); } catch (e) { return d; } }
function writeTile(k, rows) {
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  writeFileSync(join(TDIR, k + ".json"), "[" + rows.map((r) => JSON.stringify(r)).join(",\n") + "]\n");
}

async function main() {
  mkdirSync(TDIR, { recursive: true });
  const all = countries(), byId = Object.fromEntries(all.map((c) => [c.id, c]));
  const idx = readJSON(join(OUT, "index.json"), null) || { v: 1, tile: TILE, countries: {}, tiles: {} };
  const asked = process.argv.slice(2).map((x) => x.toLowerCase()).filter((x) => byId[x]);
  const todo = asked.length ? asked.map((x) => byId[x]) : [
    ...all.filter((c) => !idx.countries[c.id]),
    ...all.filter((c) => idx.countries[c.id] && Date.now() - Date.parse(idx.countries[c.id].at) > MAX_AGE).sort((a, b) => Date.parse(idx.countries[a.id].at) - Date.parse(idx.countries[b.id].at))
  ];
  log(`medfac: ${todo.length} countries to build, budget ${Math.round(BUDGET / 60000)} min`);
  let done = 0, failed = [];
  for (const c of todo) {
    if (Date.now() - T0 > BUDGET) { log("budget spent"); break; }
    const t0 = Date.now();
    try {
      const r = await fetchCountry(c);
      const seen = new Set(), byTile = {};
      const n = { h: 0, c: 0, l: 0, e: 0 };
      for (const e of r.els) {
        const k0 = e.type + e.id; if (seen.has(k0)) continue; seen.add(k0);
        const row = slim(e, c.id); if (!row) continue;
        const g = row[4];
        if (g.amenity === "hospital" || g.healthcare === "hospital") n.h++; else if (g.aeroway) n.l++; else if (g.emergency && !g.amenity && !g.healthcare) n.e++; else n.c++;
        (byTile[tileKey(row[1], row[2])] = byTile[tileKey(row[1], row[2])] || []).push(row);
      }
      /* replace this country's rows in every tile it had before or has now */
      const old = (idx.countries[c.id] && idx.countries[c.id].tiles) || [];
      for (const k of new Set([...old, ...Object.keys(byTile)])) {
        const p = join(TDIR, k + ".json"), rows = (existsSync(p) ? readJSON(p, []) : []).filter((x) => x[3] !== c.id).concat(byTile[k] || []);
        if (rows.length) { writeTile(k, rows); idx.tiles[k] = rows.length; }
        else { if (existsSync(p)) unlinkSync(p); delete idx.tiles[k]; }
      }
      idx.countries[c.id] = { at: new Date().toISOString().slice(0, 19) + "Z", base: r.base || null, n, tiles: Object.keys(byTile).sort() };
      writeFileSync(join(OUT, "index.json"), JSON.stringify(idx, null, 0) + "\n");
      done++;
      log(`${c.id} ${c.name}: ${n.h} hospitals, ${n.c} clinics, ${n.l} landing sites, ${n.e} ambulance/air rescue, ${Object.keys(byTile).length} tiles, ${Math.round((Date.now() - t0) / 1000)} s`);
    } catch (e) { failed.push(c.id); log(`${c.id} ${c.name}: FAILED ${e.message.slice(0, 200)}`); }
    await sleep(10000);
  }
  const built = Object.keys(idx.countries).length;
  log(`medfac: built ${done}, failed ${failed.length}${failed.length ? " (" + failed.join(" ") + ")" : ""}; ${built} of ${all.length} countries stored`);
}
main().catch((e) => { console.error(e); process.exit(1); });
