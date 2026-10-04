// Stored infrastructure sites for Map overlays > Infrastructure (assets/osap-infra.js), every country. Run by
// .github/workflows/refresh-infra.yml, or by hand with Node 20+:   node tools/build_infra.mjs   (INFRA_DEBUG=1 prints more)
// Sources, all keyless and public, each tagged with its licence in data/infra/index.json and on every point's popup:
//   - OurAirports (public domain): every airport, airfield, heliport and seaplane base that is not closed, with its longest open
//     runway. Large and medium airports and anything with scheduled service keep their names. A small airstrip, heliport or
//     seaplane base is often named after the person who owns it, so it keeps its name only when the name says what it is
//     (hospital, military, police, government, a place); otherwise it is shown as "Airstrip" or "Heliport" with its code and town.
//   - NGA World Port Index, Pub. 150 (U.S. Government, public domain): seaports with harbour size and type.
//   - UN/LOCODE (UNECE, via the datasets/un-locode mirror; free reuse): locations UNECE codes as seaports (function 1), placed to
//     the arc-minute, so they only add a port no other source has within 5 km.
//   - OpenStreetMap (ODbL, read through Geofabrik's Postpass API): airfields and heliports (aeroway=aerodrome/heliport), ports (landuse/industrial=port), ferry terminals
//     and named dams.
//   - Wikidata (CC0): dams with height and reservoir, where OpenStreetMap has none within 1 km.
//   - WRI Global Power Plant Database (CC BY 4.0; frozen in 2021): power plants of every fuel with capacity and owner.
//   - Wikidata (CC0): power stations with capacity and energy source, for plants newer than the WRI list.
//   - OpenStreetMap: power plants (power=plant; a solar farm only when named or 1 MW and up), refineries, oil and gas
//     facilities, fuel depots and LNG terminals, and oil, gas and fuel pipelines of 2 km and more (lines, simplified).
//     Every plant gets one fuel class (coal, gas, oil, nuclear, hydro, pumped storage, solar, wind, offshore wind, geothermal,
//     bioenergy and waste, tidal and wave, battery storage, other) so the map can colour and filter by it.
//   - TeleGeography Submarine Cable Map (CC BY-NC-SA 3.0, non-commercial; tagged nc so it can be stripped): cables and their
//     landing points. A cable goes in the file of every country it lands in.
// Several sources are merged per layer: the first source to list a site leads, and another source's record of the same site
// (within a set distance) is folded into it as "also listed by" with its own link, so a popup shows every source that has it.
// Output: data/infra/<cc>.json { v, cc, at, items: [{ k, id, nm, la, lo, s, u, t?, x?, fp }], lines: [{ k, id, nm, c, g, s, u, fp }] }
// split by layer into data/infra/<cc>/<layer>.json (af, port, dam, cable: landing points plus cable lines, plant, fuel: sites plus
// pipelines) so a switch loads only
// its own layer, and data/infra/index.json { v, at, sources, countries: { cc: { kind: n } } }. A source that fails keeps its items from the last
// good run (its ok flag false, with that run's time), so a busy server never empties the map; the panel names it.
// Privacy: no phone numbers, emails, websites of people, or private persons' names. Only facility names, codes and public bodies.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { ccsAt, ccFromA2, ccFromA3, ccFromName, COUNTRIES } from "./geo_cc.mjs";

const OUT = process.env.INFRA_OUT || "data/infra", DEBUG = !!process.env.INFRA_DEBUG;
const ONLY = process.env.INFRA_ONLY ? new Set(process.env.INFRA_ONLY.split(",")) : null;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AXIOM-OSAP infrastructure snapshot (+https://github.com/01shane89-jpg/AXIOM-APSAP)";
const WDQS = "https://query.wikidata.org/sparql";
const OA = "https://davidmegginson.github.io/ourairports-data/";
const WRI = "https://raw.githubusercontent.com/wri/global-power-plant-database/master/output_database/global_power_plant_database.csv";
const LOCODE = "https://raw.githubusercontent.com/datasets/un-locode/main/data/code-list.csv";
const WPI = ["https://msi.nga.mil/api/publications/world-port-index?output=json"];
const TG = "https://www.submarinecablemap.com/api/v3/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const fp = (...p) => createHash("sha256").update(p.join("|")).digest("hex");
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const r3 = (x) => Math.round(x * 1e3) / 1e3;
const clip = (s, n = 100) => { const t = String(s == null ? "" : s).replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const num = (s) => { const n = parseFloat(String(s == null ? "" : s).replace(/[, ]/g, "")); return isFinite(n) ? n : null; };
const IDS = new Set(COUNTRIES.map((c) => c.id));
const OKI = COUNTRIES.find((c) => c.id === "oki");
const inOki = (la, lo) => OKI && la >= OKI.bounds[0][0] && la <= OKI.bounds[1][0] && lo >= OKI.bounds[0][1] && lo <= OKI.bounds[1][1];

async function get(url, opt = {}, ms = 180000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...opt, signal: ctl.signal, headers: { "user-agent": UA, accept: "*/*", ...(opt.headers || {}) } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}
function ccOf(lat, lon, hint) {
  if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const at = ccsAt(lat, lon, 0.3);
  if (hint && at.includes(hint)) return hint;
  return at[0] || hint || null;
}
function csv(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(f); f = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const head = rows.shift() || [];
  return rows.filter((r) => r.some((c) => c.trim())).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || "").trim()])));
}
function dist(la1, lo1, la2, lo2) {
  const R = 6371000, a = (la1 * Math.PI) / 180, b = (la2 * Math.PI) / 180, dl = ((lo2 - lo1) * Math.PI) / 180;
  const h = Math.sin((b - a) / 2) ** 2 + Math.cos(a) * Math.cos(b) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
/* points near a point: a 0.05-degree grid */
function grid(items) {
  const g = new Map();
  for (const i of items) { const k = Math.floor(i.la / 0.05) + ":" + Math.floor(i.lo / 0.05); (g.get(k) || g.set(k, []).get(k)).push(i); }
  return (la, lo, m) => { const a = Math.floor(la / 0.05), b = Math.floor(lo / 0.05);
    for (let p = -1; p <= 1; p++) for (let q = -1; q <= 1; q++) for (const o of g.get(a + p + ":" + (b + q)) || []) if (dist(la, lo, o.la, o.lo) < m) return o; return null; };
}

/* ---------- OurAirports ---------- */
/* a small field keeps its name only when the name says what the place is, not whose it is */
const SAYS = /\b(hospital|medical|clinic|health|ambulance|rescue|emergency|police|military|army|navy|naval|air force|air base|airbase|afb|marine|coast ?guard|national guard|base|government|ministry|state|provincial|municipal|county|city|regional|international|domestic|airport|aerodrome|aeroporto|aeropuerto|aéroport|flughafen|bandar udara|lapangan terbang|sân bay|ท่าอากาศยาน|station|island|lake|river|bay|mine|oil|gas|platform|rig)\b/i;
const PERSON = /('s\b|\branch\b|\bfarms?\b|\bresidence\b|\bprivate\b|\bpvt\b|\bhomestead\b|\bestate\b)/i;
async function ourairports() {
  const ap = csv(await get(OA + "airports.csv")), rw = csv(await get(OA + "runways.csv"));
  log("  ourairports rows", ap.length, "runways", rw.length);
  const best = new Map();
  for (const r of rw) {
    if (r.closed === "1") continue;
    const L = num(r.length_ft); if (!L) continue;
    const b = best.get(r.airport_ident); if (!b || L > b.L) best.set(r.airport_ident, { L, s: r.surface });
  }
  const TYPE = { large_airport: "L", medium_airport: "M", small_airport: "S", heliport: "H", seaplane_base: "W" };
  const WORD = { S: "Airstrip", H: "Heliport", W: "Seaplane base" };
  const out = [];
  for (const r of ap) {
    const t = TYPE[r.type]; if (!t) continue;
    const la = num(r.latitude_deg), lo = num(r.longitude_deg); if (la == null || lo == null) continue;
    const cc = ccFromA2(r.iso_country) || ccOf(la, lo); if (!cc) continue;
    const code = r.icao_code || r.gps_code || r.ident;
    const keep = t === "L" || t === "M" || r.scheduled_service === "yes" || (SAYS.test(r.name) && !PERSON.test(r.name));
    const nm = keep ? clip(r.name) : WORD[t] + (code ? " " + code : "") + (r.municipality ? ", " + clip(r.municipality, 40) : "");
    const b = best.get(r.ident);
    const x = Object.fromEntries([["icao", r.icao_code || r.gps_code], ["iata", r.iata_code], ["elev_ft", num(r.elevation_ft)], ["rw_m", b ? Math.round(b.L * 0.3048) : null],
      ["surface", b && b.s ? clip(b.s, 30) : null], ["sched", r.scheduled_service === "yes" ? 1 : null], ["town", keep ? clip(r.municipality, 40) : null]].filter((p) => p[1] != null && p[1] !== ""));
    out.push({ k: "af", t, cc, id: "oa:" + r.ident, nm, la: r4(la), lo: r4(lo), s: "oa", u: "https://ourairports.com/airports/" + encodeURIComponent(r.ident) + "/", x });
  }
  return out;
}

/* "30°20'00\"N" or 30.33 -> decimal degrees */
function deg(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const m = /^\s*(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)?\D*?(\d+(?:\.\d+)?)?\D*([NSEW])\s*$/i.exec(String(v));
  if (!m) return num(v);
  const d = +m[1] + (m[2] ? +m[2] / 60 : 0) + (m[3] ? +m[3] / 3600 : 0);
  return /[SW]/i.test(m[4]) ? -d : d;
}

/* ---------- World Port Index ---------- */
async function wpi() {
  let rows = null, err;
  for (const u of WPI) {
    try {
      const j = JSON.parse(await get(u, { headers: { accept: "application/json" } }, 240000));
      rows = j.ports || j.data || (Array.isArray(j) ? j : null);
      if (rows) break;
      err = new Error("no ports in " + Object.keys(j).join(","));
    } catch (e) { err = e; log("  wpi", u, e.message); }
  }
  if (!rows) throw err || new Error("no World Port Index");
  log("  wpi rows", rows.length, "fields:", Object.keys(rows[0] || {}).slice(0, 60).join(" "));
  if (DEBUG) log("  wpi sample:", JSON.stringify(rows[0]).slice(0, 1500));
  const pick = (r, ...ks) => { for (const k of ks) if (r[k] != null && r[k] !== "") return r[k]; return null; };
  const SIZE = { L: "Large", M: "Medium", S: "Small", V: "Very small" };
  const out = [];
  for (const r of rows) {
    const la = deg(pick(r, "ycoord", "latitude", "lat", "Latitude")), lo = deg(pick(r, "xcoord", "longitude", "lon", "Longitude"));
    const nm = pick(r, "portName", "mainPortName", "Main Port Name", "name");
    if (la == null || lo == null || !nm) continue;
    const hint = ccFromA2(r.countryCode) || ccFromName(pick(r, "countryName", "country")) || null;
    const cc = ccOf(la, lo, hint); if (!cc) continue;
    const size = String(pick(r, "harborSize", "harbourSize", "Harbor Size") || "").trim();
    const sz = SIZE[size] || (/^(large|medium|small|very small)$/i.test(size) ? size[0].toUpperCase() + size.slice(1).toLowerCase() : "");
    const x = Object.fromEntries([["size", sz], ["type", clip(pick(r, "harborType", "Harbor Type"), 40)], ["shelter", clip(pick(r, "shelter", "Shelter Afforded"), 30)],
      ["max_len_m", num(pick(r, "maxVesselLength", "Maximum Vessel Length (m)"))], ["chan_m", num(pick(r, "chDepth", "channelDepth", "Channel Depth (m)"))],
      ["anch_m", num(pick(r, "anDepth", "anchorageDepth", "Anchorage Depth (m)"))], ["unlocode", clip(pick(r, "unloCode", "UN/LOCODE"), 12)],
      ["wpi", pick(r, "portNumber", "World Port Index Number")]].filter((p) => p[1] != null && p[1] !== ""));
    const id = "wpi:" + (x.wpi || fp(nm, la, lo).slice(0, 10));
    out.push({ k: "port", t: /^(L|M|Large|Medium)$/i.test(size) ? "M" : "P", cc, id, nm: clip(String(nm).replace(/\b([A-Z])([A-Z]+)\b/g, (m, a, b) => a + b.toLowerCase())),
      la: r4(la), lo: r4(lo), s: "wpi", u: "https://msi.nga.mil/Publications/WPI", x });
  }
  return out;
}

/* ---------- UN/LOCODE seaports ---------- */
async function locode() {
  const rows = csv(await get(LOCODE));
  log("  un/locode rows", rows.length);
  const out = [];
  for (const r of rows) {
    if (!/^1/.test(r.Function || "") || /^X/.test(r.Change || "")) continue;
    const m = /^(\d{2})(\d{2})([NS])\s+(\d{3})(\d{2})([EW])$/.exec(r.Coordinates || ""); if (!m) continue;
    const la = (+m[1] + +m[2] / 60) * (m[3] === "S" ? -1 : 1), lo = (+m[4] + +m[5] / 60) * (m[6] === "W" ? -1 : 1);
    const hint = ccFromA2(r.Country), cc = ccOf(la, lo, hint) || hint; if (!cc) continue;
    out.push({ k: "port", t: "P", cc, id: "locode:" + r.Country + r.Location, nm: clip(r.NameWoDiacritics || r.Name), la: r4(la), lo: r4(lo), s: "locode",
      u: "https://service.unece.org/trade/locode/" + r.Country.toLowerCase() + ".htm", x: { unlocode: r.Country + " " + r.Location, approx: 1 } });
  }
  return out;
}

/* ---------- OpenStreetMap: airfields, ports, ferry terminals, dams ---------- */
let osmCover = null;
/* an operator or owner is kept only when it reads as an organisation, never a person */
const ORG = /\b(authority|port|ministry|department|government|navy|army|corporation|corp|company|co\.|ltd|limited|inc|plc|s\.a\.|sa|gmbh|ag|bv|nv|llc|lp|state|national|public|group|holdings?|energy|power|electric\w*|petro\w*|oil|gas|utilit\w*|board|agency|council|municipal\w*|city|county|province|provincial|cooperative|co-op|enterprise|pte|sdn|bhd|tbk|pt|jsc|pjsc|ojsc|ooo|kk|k\.k\.)\b/i;
/* "1,200 MW", "1.2 GW", "800 kW" -> MW */
function mwOf(v) {
  const m = /([\d.]+)\s*(gw|mw|kw)/i.exec(String(v || "").replace(/,/g, "")); if (!m) return null;
  const n = parseFloat(m[1]), u = m[2].toLowerCase(); return u === "gw" ? n * 1000 : u === "kw" ? n / 1000 : n;
}
/* one fuel class per plant, from the source's own fuel words (OpenStreetMap plant:source, WRI primary_fuel, Wikidata energy
   source); the first fuel named leads ("coal;gas" is coal) */
function fuelClass(src, name, t = {}) {
  const f = String(src || "").toLowerCase().split(/[;,/]/)[0].trim(), n = String(name || "");
  if (/pump/.test(f) || /pumped/i.test(t["plant:method"] || "") || /pump/i.test(t["plant:storage"] || "") || (/hydro|water|storage/.test(f) && /pumped/i.test(n))) return "pumped";
  if (/^(battery|storage|batteries|electricity storage)/.test(f)) return "battery";
  if (/nuclear|uranium/.test(f)) return "nuclear";
  if (/coal|lignite|anthracite/.test(f)) return "coal";
  if (/gas|lng|methane/.test(f) && !/bio/.test(f)) return "gas";
  if (/oil|diesel|petcoke|petroleum|fuel oil|kerosene|heavy fuel/.test(f)) return "oil";
  if (/hydro|water/.test(f)) return "hydro";
  if (/solar|photovoltaic/.test(f)) return "solar";
  if (/wind/.test(f)) return t.offshore === "yes" || /offshore/i.test(n) || /offshore/i.test(t.location || "") ? "windoff" : "wind";
  if (/geotherm/.test(f)) return "geo";
  if (/tid|wave|marine/.test(f)) return "tidal";
  if (/bio|waste|wood|straw|landfill|refuse|cogeneration/.test(f)) return "bio";
  return "other";
}
const DEAD = /^(disused|abandoned|demolished|razed|removed|destroyed|was|proposed|construction)[:_]/;
/* OpenStreetMap is read through Postpass (Geofabrik's keyless SQL API over a live OpenStreetMap database; public Overpass servers
   time out or refuse GitHub's runners on whole-world tag searches). The world is read in tiles (30 degrees of longitude by three
   latitude bands, one query per kind of site), each cached in data/infra/_osm/ with the time it was read. A run reads the tiles
   never read first, then the oldest, until its time budget (INFRA_OSM_MIN minutes, default 60) is spent; a tile that fails keeps
   its last copy. So a busy server never empties the map. Lines (dams are usually mapped as lines) are placed at their midpoint. */
const POSTPASS = "https://postpass.geofabrik.de/api/interpreter";
const OSM_DIR = join(OUT, "_osm"), KEEP = /^(name|name:en|int_name|aeroway|aerodrome|aerodrome:type|iata|icao|ref|ele|surface|military|landuse|access|industrial|amenity|waterway|height|purpose|dam:purpose|waterway:name|start_date|operator|power|plant:source|plant:method|plant:output:electricity|plant:storage|offshore|substance|product|location|diameter|usage)$/;
async function postpass(sql) {
  let err;
  for (let k = 0; k < 2; k++) {
    try {
      const j = JSON.parse(await get(POSTPASS, { method: "POST", body: "data=" + encodeURIComponent(sql), headers: { "content-type": "application/x-www-form-urlencoded" } }, 600000));
      if (!j.features) throw new Error("no features");
      return j.features;
    } catch (e) { err = e; log("  postpass", e.message.slice(0, 120)); await sleep(20000); }
  }
  throw err;
}
async function osm() {
  const W = { af: `tags->>'aeroway' IN ('aerodrome','heliport')`, port: `(tags->>'landuse' = 'port' OR tags->>'industrial' = 'port' OR (tags->>'amenity' = 'ferry_terminal' AND tags ? 'name'))`,
    dam: `tags->>'waterway' = 'dam' AND tags ? 'name'`, plant: `tags->>'power' = 'plant'`,
    fuel: `tags->>'industrial' IN ('refinery','oil','gas','fuel','fuel_depot','oil_storage','lng','petroleum_terminal','oil_terminal','gas_terminal')`,
    pipe: `tags->>'man_made' = 'pipeline' AND tags->>'substance' IN ('gas','oil','fuel','natural_gas','petroleum','crude_oil','lng','lpg','hydrocarbons','diesel','kerosene','gasoline')` };
  const LAT = [[-60, 0], [0, 30], [30, 84]];
  mkdirSync(OSM_DIR, { recursive: true });
  for (const f of readdirSync(OSM_DIR)) if (!/^(af|port|dam|plant|fuel|pipe)_-?\d+_-?\d+_30\.json$/.test(f)) unlinkSync(join(OSM_DIR, f));   // tiles of an older layout
  const tiles = [];
  for (const part of Object.keys(W)) for (let w = -180; w < 180; w += 30) for (const [s0, n0] of LAT) {
    const f = join(OSM_DIR, part + "_" + w + "_" + s0 + "_30.json"), old = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
    tiles.push({ part, w, s0, n0, f, old, at: old ? Date.parse(old.at) : 0 });
  }
  const budget = Date.now() + (+process.env.INFRA_OSM_MIN || 60) * 60000;
  let fresh = 0, failed = 0;
  for (const t of tiles.slice().sort((a, b) => a.at - b.at)) {
    if (Date.now() > budget) break;
    if (t.at && Date.now() - t.at < 3 * 864e5) continue;   // read in the last three days
    const env = `geom && ST_MakeEnvelope(${t.w}, ${t.s0}, ${t.w + 30}, ${t.n0}, 4326)`;
    /* pipelines keep their line (simplified to about 500 m, and 2 km long or more); everything else is one point */
    const sql = t.part === "pipe"
      ? `SELECT osm_type, osm_id, tags, ST_Simplify(geom, 0.005) AS geom FROM postpass_line WHERE ${W.pipe} AND ${env} AND ST_Length(geom::geography) > 2000`
      : `SELECT osm_type, osm_id, tags, ST_PointOnSurface(geom) AS geom FROM postpass_pointpolygon WHERE ${W[t.part]} AND ${env}` +
        ` UNION ALL SELECT osm_type, osm_id, tags, ST_LineInterpolatePoint(geom, 0.5) AS geom FROM postpass_line WHERE ${W[t.part]} AND ${env}`;
    try {
      const t0 = Date.now(), fs = await postpass(sql), els = [];
      for (const f of fs) {
        const p = f.properties || {}, gm = f.geometry || {}, c = gm.coordinates; if (!c) continue;
        let tg = p.tags || {}; if (typeof tg === "string") try { tg = JSON.parse(tg); } catch (e) { tg = {}; }
        if (Object.keys(tg).some((k) => DEAD.test(k)) || tg.disused === "yes" || tg.abandoned === "yes") continue;
        const keep = Object.fromEntries(Object.entries(tg).filter(([k]) => KEEP.test(k)).map(([k, v]) => [k, clip(v, 80)]));
        const oid = String(p.osm_type || "n")[0].toLowerCase() + p.osm_id;
        if (t.part === "pipe") {
          const parts = gm.type === "MultiLineString" ? c : gm.type === "LineString" ? [c] : [];
          const g = parts.map((ln) => ln.map(([lo, la]) => [r3(la), r3(lo)])).filter((ln) => ln.length > 1);
          if (g.length) els.push([oid, null, null, keep, g]);
        } else els.push([oid, r4(c[1]), r4(c[0]), keep]);
      }
      t.old = { at: new Date().toISOString(), els }; writeFileSync(t.f, JSON.stringify(t.old)); fresh++;
      log("  osm tile", t.part, t.w, t.s0, els.length, Math.round((Date.now() - t0) / 1000) + " s");
    } catch (e) { failed++; log("  osm tile FAILED", t.part, t.w, t.s0, e.message); }
  }
  const have = tiles.filter((t) => t.old).length;
  log("  osm tiles read this run", fresh, "failed", failed, "; tiles held", have, "of", tiles.length);
  if (!have) throw new Error("no OpenStreetMap tile could be read");
  osmCover = { tiles: have, of: tiles.length, fresh };
  const els = [];
  const pipes = [];
  for (const t of tiles) if (t.old) for (const [id, lat, lon, tags, g] of t.old.els) (g ? pipes : els).push({ type: { n: "node", w: "way", r: "relation" }[id[0]], id: +id.slice(1), lat, lon, tags, g });
  const seen = new Set(), out = [], lines = [];
  /* a pipeline goes in the file of every country its line passes through */
  for (const e of pipes) {
    const id = e.type[0] + e.id; if (seen.has(id)) continue; seen.add(id);
    const t = e.tags || {}, sub = /gas|lng|lpg/i.test(t.substance) ? "gas" : /oil|petroleum|crude/i.test(t.substance) ? "oil" : "fuel";
    const ccs = new Set();
    for (const ln of e.g) for (let i = 0; i < ln.length; i += Math.max(1, Math.floor(ln.length / 12))) { const c = ccOf(ln[i][0], ln[i][1]); if (c) ccs.add(c); }
    for (const ln of e.g) { const v = ln[ln.length - 1], c = ccOf(v[0], v[1]); if (c) ccs.add(c); }
    const x = Object.fromEntries([["substance", clip(t.substance, 30)], ["location", clip(t.location, 20)], ["diameter", clip(t.diameter, 20)], ["usage", clip(t.usage, 20)],
      ...(t.operator && ORG.test(t.operator) ? [["op", clip(t.operator, 60)]] : [])].filter((p) => p[1]));
    for (const cc of ccs) lines.push({ k: "pipe", t: sub, cc, id: "osm:" + id, nm: clip(t["name:en"] || t.name || ""), g: e.g, s: "osm",
      u: "https://www.openstreetmap.org/" + e.type + "/" + e.id, x });
  }
  seen.clear();
  for (const e of els) {
    const id = e.type[0] + e.id; if (seen.has(id)) continue; seen.add(id);
    const c = e.center || (e.lat != null ? e : null); if (!c) continue;
    const t = e.tags || {};
    if (Object.keys(t).some((k) => DEAD.test(k)) || t.disused === "yes" || t.abandoned === "yes") continue;
    const cc = ccOf(c.lat, c.lon); if (!cc) continue;
    const nm = clip(t["name:en"] || t.name || t["int_name"] || "");
    const u = "https://www.openstreetmap.org/" + { n: "node", w: "way", r: "relation" }[id[0]] + "/" + id.slice(1);
    let k, ty, x = {};
    if (t.aeroway === "aerodrome" || t.aeroway === "heliport") {
      const heli = t.aeroway === "heliport", major = /^(international|public|regional)$/.test(t.aerodrome || t["aerodrome:type"] || "") || !!t.iata;
      const code = t.icao || t.iata || t.ref || "";
      const nmA = major || (SAYS.test(nm) && !PERSON.test(nm)) ? nm : (heli ? "Heliport" : "Airstrip") + (code ? " " + clip(code, 8) : "");
      const xa = Object.fromEntries([["icao", t.icao], ["iata", t.iata], ["elev_ft", num(t.ele) != null ? Math.round(num(t.ele) / 0.3048) : null],
        ["surface", clip(t.surface, 30) || null], ["military", t.military || /military/.test(t.aerodrome || "") || t.landuse === "military" ? 1 : null]].filter((p) => p[1] != null && p[1] !== ""));
      if (/^(private|no)$/.test(t.access || "") && !major && !xa.military) xa.private = 1;
      out.push({ k: "af", t: heli ? "H" : major ? "M" : "S", cc, id: "osm:" + id, nm: nmA, la: r4(c.lat), lo: r4(c.lon), s: "osm", u, x: xa });
      continue;
    }
    if (t.power === "plant") {
      const cl = fuelClass(t["plant:source"] || "", nm, t), out_mw = mwOf(t["plant:output:electricity"]);
      if (cl === "solar" && !(out_mw >= 1) && !t.name) continue;   // rooftop and small solar
      const xp = Object.fromEntries([["fuel", clip(t["plant:source"], 40)], ["method", clip(t["plant:method"], 30)], ["mw", out_mw != null ? Math.round(out_mw * 10) / 10 : null],
        ["built", clip(t.start_date, 12)], ...(t.operator && ORG.test(t.operator) ? [["op", clip(t.operator, 60)]] : [])].filter((p) => p[1] != null && p[1] !== ""));
      out.push({ k: "plant", t: cl, cc, id: "osm:" + id, nm, la: r4(c.lat), lo: r4(c.lon), s: "osm", u, x: xp });
      continue;
    }
    if (t.industrial && t.industrial !== "port") {
      const kind = /refinery/.test(t.industrial) ? "R" : /lng/.test(t.industrial) ? "L" : /depot|storage|terminal|fuel/.test(t.industrial) ? "T" : "G";
      const xf = Object.fromEntries([["facility", clip(t.industrial.replace(/_/g, " "), 30)], ["product", clip(t.product, 40)],
        ...(t.operator && ORG.test(t.operator) ? [["op", clip(t.operator, 60)]] : [])].filter((p) => p[1]));
      out.push({ k: "fuel", t: kind, cc, id: "osm:" + id, nm, la: r4(c.lat), lo: r4(c.lon), s: "osm", u, x: xf });
      continue;
    }
    if (t.waterway === "dam") { k = "dam"; ty = "D"; x = { height_m: num(t.height), purpose: clip(t.purpose || t["dam:purpose"], 40), river: clip(t["waterway:name"] || "", 40), built: clip(t.start_date, 12) }; }
    else if (t.amenity === "ferry_terminal") { k = "port"; ty = "F"; x = { ferry: 1 }; }
    else { k = "port"; ty = "O"; }
    x = Object.fromEntries(Object.entries(x).filter((p) => p[1] != null && p[1] !== ""));
    if (t.operator && ORG.test(t.operator)) x.op = clip(t.operator, 60);
    out.push({ k, t: ty, cc, id: "osm:" + id, nm, la: r4(c.lat), lo: r4(c.lon), s: "osm", u, x });
  }
  return { items: out, lines };
}

/* ---------- Wikidata dams ---------- */
async function wikidams() {
  const q = `SELECT ?item ?itemLabel ?coord ?h ?a2 ?resLabel ?inc WHERE {
  ?item wdt:P31 wd:Q12323; wdt:P625 ?coord.
  OPTIONAL { ?item wdt:P2048 ?h. } OPTIONAL { ?item wdt:P17 ?c. ?c wdt:P297 ?a2. } OPTIONAL { ?item wdt:P4661 ?res. } OPTIONAL { ?item wdt:P571 ?inc. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". } }`;
  const j = JSON.parse(await get(WDQS + "?format=json&query=" + encodeURIComponent(q), { headers: { accept: "application/sparql-results+json" } }, 280000));
  const by = new Map();
  for (const b of j.results.bindings) {
    const m = /Point\(([-\d.eE]+) ([-\d.eE]+)\)/.exec(b.coord.value); if (!m) continue;
    const qid = b.item.value.split("/").pop(); if (by.has(qid)) continue;
    const lon = +m[1], lat = +m[2], cc = ccOf(lat, lon, ccFromA2(b.a2 && b.a2.value)); if (!cc) continue;
    const nm = b.itemLabel && b.itemLabel.value !== qid ? b.itemLabel.value : "";
    if (!nm) continue;
    const x = Object.fromEntries([["height_m", b.h ? num(b.h.value) : null], ["reservoir", b.resLabel && !/^Q\d+$/.test(b.resLabel.value) ? clip(b.resLabel.value, 50) : null],
      ["built", b.inc ? String(b.inc.value).slice(0, 4) : null]].filter((p) => p[1] != null && p[1] !== ""));
    by.set(qid, { k: "dam", t: "D", cc, id: "wd:" + qid, nm: clip(nm), la: r4(lat), lo: r4(lon), s: "wd", u: "https://www.wikidata.org/wiki/" + qid, x });
  }
  return [...by.values()];
}

/* ---------- WRI Global Power Plant Database ---------- */
async function wriPlants() {
  const rows = csv(await get(WRI, {}, 240000));
  log("  wri rows", rows.length);
  const out = [];
  for (const r of rows) {
    const la = num(r.latitude), lo = num(r.longitude); if (la == null || lo == null) continue;
    const hint = ccFromA3(r.country), cc = ccOf(la, lo, hint) || hint; if (!cc) continue;
    const x = Object.fromEntries([["fuel", clip([r.primary_fuel, r.other_fuel1, r.other_fuel2].filter(Boolean).join(", "), 60)], ["mw", num(r.capacity_mw)],
      ["built", r.commissioning_year ? String(Math.round(num(r.commissioning_year))) : null], ["op", r.owner && ORG.test(r.owner) ? clip(r.owner, 60) : null],
      ["data_year", r.year_of_capacity_data || null]].filter((p) => p[1] != null && p[1] !== ""));
    out.push({ k: "plant", t: fuelClass(r.primary_fuel, r.name), cc, id: "wri:" + r.gppd_idnr, nm: clip(r.name), la: r4(la), lo: r4(lo), s: "wri",
      u: "https://datasets.wri.org/dataset/globalpowerplantdatabase", x });
  }
  return out;
}

/* ---------- Wikidata power stations ---------- */
async function wikiplants() {
  const q = `SELECT ?item ?itemLabel ?coord ?cap ?srcLabel ?a2 ?inc WHERE {
  ?item wdt:P31/wdt:P279* wd:Q159719; wdt:P625 ?coord.
  OPTIONAL { ?item wdt:P2109 ?cap. } OPTIONAL { ?item wdt:P618 ?src. } OPTIONAL { ?item wdt:P17 ?c. ?c wdt:P297 ?a2. } OPTIONAL { ?item wdt:P571 ?inc. }
  FILTER NOT EXISTS { ?item wdt:P576 ?gone. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". } }`;
  const j = JSON.parse(await get(WDQS, { method: "POST", body: "query=" + encodeURIComponent(q),
    headers: { accept: "application/sparql-results+json", "content-type": "application/x-www-form-urlencoded" } }, 290000));
  const by = new Map();
  for (const b of j.results.bindings) {
    const m = /Point\(([-\d.eE]+) ([-\d.eE]+)\)/.exec(b.coord.value); if (!m) continue;
    const qid = b.item.value.split("/").pop(), prev = by.get(qid);
    if (prev) { if (b.srcLabel && !prev.x.fuel) { prev.x.fuel = clip(b.srcLabel.value, 40); prev.t = fuelClass(b.srcLabel.value, prev.nm); } continue; }
    const lon = +m[1], lat = +m[2], cc = ccOf(lat, lon, ccFromA2(b.a2 && b.a2.value)); if (!cc) continue;
    const nm = b.itemLabel && b.itemLabel.value !== qid ? b.itemLabel.value : ""; if (!nm) continue;
    /* capacity is in watts or megawatts depending on the editor; read big numbers as watts */
    let cap = b.cap ? num(b.cap.value) : null; if (cap != null && cap > 1e5) cap = cap / 1e6;
    const fuel = b.srcLabel && !/^Q\d+$/.test(b.srcLabel.value) ? b.srcLabel.value : "";
    const x = Object.fromEntries([["fuel", clip(fuel, 40)], ["mw", cap != null ? Math.round(cap * 10) / 10 : null], ["built", b.inc ? String(b.inc.value).slice(0, 4) : null]].filter((p) => p[1] != null && p[1] !== ""));
    by.set(qid, { k: "plant", t: fuelClass(fuel, nm), cc, id: "wd:" + qid, nm: clip(nm), la: r4(lat), lo: r4(lon), s: "wdp", u: "https://www.wikidata.org/wiki/" + qid, x });
  }
  return [...by.values()];
}

/* ---------- TeleGeography submarine cables ---------- */
async function cables() {
  const lp = JSON.parse(await get(TG + "landing-point/landing-point-geo.json"));
  const cg = JSON.parse(await get(TG + "cable/cable-geo.json"));
  log("  landing points", (lp.features || []).length, "cables", (cg.features || []).length);
  const pts = [];
  for (const f of lp.features || []) {
    const [lo, la] = (f.geometry || {}).coordinates || []; if (la == null) continue;
    const p = f.properties || {}, nm = String(p.name || "");
    const hint = ccFromName(nm.split(",").pop());
    const cc = ccOf(la, lo, hint); if (!cc) continue;
    pts.push({ k: "lp", t: "C", cc, id: "tg:lp:" + p.id, nm: clip(nm), la: r4(la), lo: r4(lo), s: "tg", u: "https://www.submarinecablemap.com/landing-point/" + encodeURIComponent(p.id), x: {} });
  }
  const near = grid(pts);
  const lines = [];
  for (const f of cg.features || []) {
    const p = f.properties || {}, g = f.geometry || {};
    const parts = g.type === "MultiLineString" ? g.coordinates : g.type === "LineString" ? [g.coordinates] : [];
    if (!parts.length) continue;
    const ccs = new Set();
    const gg = parts.map((ln) => {
      const o = [];
      ln.forEach(([lo, la], i) => {
        if (i === 0 || i === ln.length - 1) { const q = near(la, lo, 5000); if (q) ccs.add(q.cc); }
        const v = [r3(la), r3(lo)], last = o[o.length - 1];
        if (!last || Math.abs(last[0] - v[0]) + Math.abs(last[1] - v[1]) > 0.02 || i === ln.length - 1) o.push(v);
      });
      return o;
    }).filter((l) => l.length > 1);
    if (!ccs.size || !gg.length) continue;
    const col = /^#[0-9a-f]{6}$/i.test(p.color || "") ? p.color : "#0b7285";
    for (const cc of ccs) lines.push({ k: "cable", cc, id: "tg:" + p.id, nm: clip(p.name), c: col, g: gg, s: "tg", u: "https://www.submarinecablemap.com/submarine-cable/" + encodeURIComponent(p.id) });
  }
  /* a landing point lists the cables that reach it */
  const at = new Map();
  for (const l of lines) for (const ln of l.g) for (const v of [ln[0], ln[ln.length - 1]]) { const q = near(v[0], v[1], 5000); if (q) (at.get(q.id) || at.set(q.id, new Set()).get(q.id)).add(l.nm); }
  for (const q of pts) { const s = at.get(q.id); if (s) q.x.cables = [...s].slice(0, 30).join("; "); }
  return { items: pts, lines };
}

/* ---------- run ---------- */
const now = new Date().toISOString().slice(0, 16) + "Z";
mkdirSync(OUT, { recursive: true });
const prevIx = existsSync(join(OUT, "index.json")) ? JSON.parse(readFileSync(join(OUT, "index.json"), "utf8")) : { sources: {} };
const prev = {};
const readPrev = (path, cc) => {
  const j = JSON.parse(readFileSync(path, "utf8"));
  for (const i of j.items || []) {
    (prev[i.s] = prev[i.s] || { items: [], lines: [] }).items.push({ ...i, cc: j.cc || cc });
    for (const a of i.also || []) (prev[a.s] = prev[a.s] || { items: [], lines: [] }).items.push({ ...i, s: a.s, u: a.u, nm: a.nm || i.nm, also: undefined, cc: j.cc || cc });
  }
  for (const l of j.lines || []) (prev[l.s] = prev[l.s] || { items: [], lines: [] }).lines.push({ ...l, cc: j.cc || cc });
};
for (const f of existsSync(OUT) ? readdirSync(OUT) : []) {
  if (/^[a-z]{2,3}\.json$/.test(f) && f !== "oki.json") readPrev(join(OUT, f), f.slice(0, -5));
  else if (/^[a-z]{2,3}$/.test(f) && f !== "oki") for (const g of readdirSync(join(OUT, f))) readPrev(join(OUT, f, g), f);
}
const SRC = {
  oa: { name: "OurAirports", lic: "Public domain", link: "https://ourairports.com/data/" },
  wpi: { name: "NGA World Port Index (Pub. 150)", lic: "Public domain (U.S. Government)", link: "https://msi.nga.mil/Publications/WPI" },
  locode: { name: "UN/LOCODE (UNECE)", lic: "Free reuse (UNECE)", link: "https://unece.org/trade/uncefact/unlocode" },
  osm: { name: "OpenStreetMap", lic: "ODbL", link: "https://www.openstreetmap.org/copyright" },
  wd: { name: "Wikidata", lic: "CC0", link: "https://www.wikidata.org/wiki/Q12323" },
  wri: { name: "WRI Global Power Plant Database", lic: "CC BY 4.0", link: "https://datasets.wri.org/dataset/globalpowerplantdatabase" },
  wdp: { name: "Wikidata (power stations)", lic: "CC0", link: "https://www.wikidata.org/wiki/Q159719" },
  tg: { name: "TeleGeography Submarine Cable Map", lic: "CC BY-NC-SA 3.0", nc: true, link: "https://www.submarinecablemap.com/" },
};
const got = {}, status = {};
async function run(s, f) {
  if (ONLY && !ONLY.has(s)) { got[s] = prev[s] || { items: [], lines: [] }; status[s] = { ...(prevIx.sources[s] || {}), kept: true }; return; }
  try {
    const r = await f(); got[s] = Array.isArray(r) ? { items: r, lines: [] } : r;
    status[s] = { ok: true, at: now, n: got[s].items.length + got[s].lines.length, ...(s === "osm" && osmCover ? { cover: osmCover } : {}) }; log(s, "ok", got[s].items.length, "points", got[s].lines.length, "lines");
  } catch (e) {
    got[s] = prev[s] || { items: [], lines: [] };
    status[s] = { ok: false, at: (prevIx.sources[s] || {}).at || null, n: got[s].items.length + got[s].lines.length, err: String(e.message || e).slice(0, 120), tried: now };
    log(s, "FAILED", e.message, "- kept", status[s].n, "from the last run");
  }
}
await run("oa", ourairports);
await run("wpi", wpi);
await run("locode", locode);
await run("osm", osm);
await run("wd", wikidams);
await run("wri", wriPlants);
await run("wdp", wikiplants);
await run("tg", cables);

/* one site, several sources: the first list to have it leads; a later source's record within reach is folded in as "also listed
   by" (its link kept, its extra details added where the lead has none); anything new is added */
const REACH = { af: 1500, port: 3000, dam: 1000, plant: 2000, fuel: 0 };
function merge(lists, k, reach) {
  const lead = [], g = new Map(), key = (la, lo) => Math.floor(la / 0.05) + ":" + Math.floor(lo / 0.05);
  const find = (i, m) => { const a = Math.floor(i.la / 0.05), b = Math.floor(i.lo / 0.05); let best = null, bd = m;
    for (let p = -1; p <= 1; p++) for (let q = -1; q <= 1; q++) for (const o of g.get(a + p + ":" + (b + q)) || []) {
      if (k === "plant" ? !(o.t === i.t || o.t === "other" || i.t === "other") : k === "fuel" ? false : o.t === "F" || i.t === "F" ? o.t !== i.t : (o.t === "H") !== (i.t === "H")) continue;
      const d = dist(i.la, i.lo, o.la, o.lo); if (d < bd) { bd = d; best = o; } }
    return best; };
  let folded = 0;
  for (const list of lists) for (const i of list) {
    if (i.k !== k) continue;
    const m = i.s === "locode" ? 5000 : i.t === "H" ? 300 : reach, o = find(i, m);
    if (o && o.s !== i.s) {
      (o.also = o.also || []).push({ s: i.s, u: i.u, ...(i.nm && i.nm !== o.nm ? { nm: i.nm } : {}) });
      for (const [kk, v] of Object.entries(i.x || {})) if (o.x[kk] == null && kk !== "approx") o.x[kk] = v;
      if (!o.nm && i.nm) o.nm = i.nm;
      if (k === "plant" && o.t === "other" && i.t !== "other") o.t = i.t;
      folded++; continue;
    }
    const c = { ...i, x: { ...(i.x || {}) } }; lead.push(c);
    const kk = key(c.la, c.lo); (g.get(kk) || g.set(kk, []).get(kk)).push(c);
  }
  log("merge", k, "sites", lead.length, "folded duplicates", folded);
  return lead;
}
const merged = [
  ...merge([got.oa.items, got.osm.items], "af", REACH.af),
  ...merge([got.wpi.items, got.osm.items, got.locode.items], "port", REACH.port),
  ...merge([got.osm.items, got.wd.items], "dam", REACH.dam).filter((i) => i.s !== "wd" || (i.x.height_m || 0) >= 15 || i.x.reservoir),
  /* WRI leads (capacity and fuel for every plant); OpenStreetMap and Wikidata add plants built since and smaller ones */
  ...merge([got.wri.items, got.osm.items, got.wdp.items], "plant", REACH.plant),
  ...got.osm.items.filter((i) => i.k === "fuel"),
];
/* a private OpenStreetMap-only strip is left out */
const kept = merged.filter((i) => !(i.x && i.x.private && !(i.also || []).length));
for (const i of kept) if (i.x) delete i.x.private;

const by = {};
const slot = (cc) => (by[cc] = by[cc] || { items: [], lines: [] });
for (const i of [...kept, ...got.tg.items]) {
  if (!i.cc || !IDS.has(i.cc)) continue;
  const { cc, ...rest } = i;
  const it = { ...rest, fp: fp(rest.s, rest.id, rest.la, rest.lo, rest.nm, JSON.stringify(rest.x || {}), JSON.stringify(rest.also || [])) };
  slot(cc).items.push(it);
  if (cc === "jp" && inOki(rest.la, rest.lo)) slot("oki").items.push(it);
}
for (const l of [...got.tg.lines, ...got.osm.lines]) {
  if (!l.cc || !IDS.has(l.cc)) continue;
  const { cc, ...rest } = l;
  const it = { ...rest, fp: rest.fp || fp(rest.s, rest.id, rest.nm, JSON.stringify(rest.g), JSON.stringify(rest.x || {})) };
  slot(cc).lines.push(it);
  if (cc === "jp" && rest.g.some((ln) => ln.some((v) => inOki(v[0], v[1])))) slot("oki").lines.push(it);
}

const countries = {};
const FILE = { af: "af", port: "port", dam: "dam", lp: "cable", cable: "cable", plant: "plant", fuel: "fuel", pipe: "fuel" };
for (const f of readdirSync(OUT)) if (/^[a-z]{2,3}\.json$/.test(f)) unlinkSync(join(OUT, f));   // the old one-file layout
for (const d of readdirSync(OUT)) if (/^[a-z]{2,3}$/.test(d) && !by[d]) for (const f of readdirSync(join(OUT, d))) unlinkSync(join(OUT, d, f));
const KORD = { af: 0, port: 1, dam: 2, lp: 3, plant: 4, fuel: 5 }, TORD = { L: 0, M: 1, P: 2, F: 3, O: 4, D: 5, S: 6, H: 7, W: 8, C: 9 };
for (const [cc, c] of Object.entries(by).sort()) {
  c.items.sort((a, b) => (KORD[a.k] - KORD[b.k]) || ((TORD[a.t] || 0) - (TORD[b.t] || 0)) || String(a.id).localeCompare(String(b.id)));
  c.lines.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  mkdirSync(join(OUT, cc), { recursive: true });
  const files = {};
  for (const i of c.items) (files[FILE[i.k]] = files[FILE[i.k]] || { items: [], lines: [] }).items.push(i);
  for (const l of c.lines) (files[FILE[l.k]] = files[FILE[l.k]] || { items: [], lines: [] }).lines.push(l);
  for (const f of readdirSync(join(OUT, cc))) if (!files[f.replace(/\.json$/, "")]) unlinkSync(join(OUT, cc, f));
  for (const [f, v] of Object.entries(files)) writeFileSync(join(OUT, cc, f + ".json"), JSON.stringify({ v: 1, cc, at: now, layer: f, items: v.items, lines: v.lines }));
  const n = {};
  for (const i of c.items) n[i.k] = (n[i.k] || 0) + 1;
  for (const l of c.lines) n[l.k] = (n[l.k] || 0) + 1;
  countries[cc] = n;
}
writeFileSync(join(OUT, "index.json"), JSON.stringify({ v: 1, at: now, sources: Object.fromEntries(Object.entries(SRC).map(([k, v]) => [k, { ...v, ...status[k] }])), countries }, null, 1));
const tot = {};
for (const n of Object.values(countries)) for (const [k, v] of Object.entries(n)) tot[k] = (tot[k] || 0) + v;
log("countries", Object.keys(countries).length, "totals", JSON.stringify(tot));
log("th", JSON.stringify(countries.th || {}), "| sb", JSON.stringify(countries.sb || {}), "| us", JSON.stringify(countries.us || {}));
if (!Object.values(status).some((s) => s.ok)) process.exit(1);
