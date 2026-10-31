// Chinese presence, every country: the "Chinese presence" data set (index.html, window.OSAP_PR) for pages without the
// hand-researched Philippines list. Run by .github/workflows/refresh-cnpresence.yml (monthly), or by hand with Node 22+:
//   node --experimental-sqlite tools/refresh_cnpresence.mjs        (CNP_DEBUG=1 prints more; CNP_ONLY=aiddata,uslists,ports)
// Three open, keyless sources, each tagged with its licence in data/cnpresence/index.json and on every record:
//   - AidData's Global Chinese Development Finance Dataset v3.0 with its geospatial companion (GeoGCDF v3; ODC-By 1.0 for the
//     project data, geometry taken from OpenStreetMap under ODbL): projects China's state lenders and donors committed to in
//     2000-2021. Kept: infrastructure, energy, transport, communications, industry and mining, anything that names police,
//     military, security, surveillance, ports or airports, and any commitment of USD 50 million or more. Each project is placed
//     at the point of its mapped feature nearest the middle of its extent; admin-area placements say so.
//   - The U.S. Consolidated Screening List (International Trade Administration; U.S. government work, public domain): the
//     Commerce Entity List, Military End-User list, Unverified List, Treasury's SDN and Non-SDN Chinese Military-Industrial
//     Complex lists and the rest. An organisation goes on a country's page when it lists an address there and is PRC-linked:
//     it also lists an address in mainland China, Hong Kong or Macau, it is on the Chinese Military-Industrial Complex list,
//     or the Defense Department's Section 1260H list of Chinese military companies (read from OpenSanctions, CC BY-NC 4.0,
//     non-commercial and tagged nc so the sold version drops it). Organisations only: no individuals are named.
//     Placed at the listed city (GeoNames cities, CC BY 4.0) when the city can be found, otherwise listed without a pin.
//   - Ports and terminals run or owned by Chinese port groups (COSCO, China Merchants Port, SIPG and others, and Hong Kong's
//     CK Hutchison): Wikidata operator and owner records (CC0), and OpenStreetMap operator and owner tags (ODbL, through
//     Geofabrik's keyless Postpass API).
// Every record is a claim by its source ("Reported, not verified"), not an OSAP finding, and carries a SHA-256 fingerprint.
// A source that fails keeps its records from the last good run (its ok flag false), so a busy server never empties the layer.
// Output: data/cnpresence/<cc>.json { v, cc, at, items: [presence records] } and data/cnpresence/index.json
// { v, at, sources: { id: { name, org, lic, url, nc?, ok, at, n } }, countries: { cc: { aiddata, uslists, ports } } }.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { ccsAt, ccFromA2, ccFromA3, COUNTRIES } from "./geo_cc.mjs";

const OUT = process.env.CNP_OUT || "data/cnpresence", DEBUG = !!process.env.CNP_DEBUG;
const ONLY = process.env.CNP_ONLY ? new Set(process.env.CNP_ONLY.split(",")) : null;
const TMP = process.env.RUNNER_TEMP || "/tmp";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AXIOM-OSAP Chinese presence snapshot (+https://github.com/01shane89-jpg/AXIOM-APSAP)";
const log = (...a) => console.log(...a);
const dbg = (...a) => DEBUG && console.log("  ·", ...a);
const fp = (...p) => createHash("sha256").update(p.join("|")).digest("hex");
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const clip = (s, n = 300) => { const t = String(s == null ? "" : s).replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const IDS = new Set(COUNTRIES.map((c) => c.id));
const now = new Date().toISOString().slice(0, 16) + "Z";
const CLAIM = "Reported, not verified";

async function get(url, opt = {}, ms = 300000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...opt, signal: ctl.signal, headers: { "user-agent": UA, accept: "*/*", ...(opt.headers || {}) } });
    if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
    return opt.buffer ? Buffer.from(await r.arrayBuffer()) : await r.text();
  } finally { clearTimeout(t); }
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
  const head = (rows.shift() || []).map((h) => h.replace(/^﻿/, "").trim());
  return rows.filter((r) => r.some((c) => c.trim())).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || "").trim()])));
}
function ccOf(lat, lon, hint) {
  if (lat == null || lon == null || !isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const at = ccsAt(lat, lon, 0.3);
  if (hint && at.includes(hint)) return hint;
  return at[0] || hint || null;
}
/* HK and Macau have no page of their own: their addresses count as China's */
const ccA2 = (a) => { const u = String(a || "").trim().toUpperCase(); return u === "HK" || u === "MO" || u === "CN" ? "cn" : ccFromA2(u); };

const SOURCES = {
  aiddata: { name: "Chinese development finance projects (GCDF v3.0 and GeoGCDF v3)", org: "AidData, William & Mary",
    lic: "ODC-By 1.0 (project data); locations from OpenStreetMap, ODbL", url: "https://www.aiddata.org/data/aiddatas-global-chinese-development-finance-dataset-version-3-0",
    cite: "Custer et al. 2023; Goodman et al., Sci Data 11, 529 (2024)" },
  uslists: { name: "PRC-linked organisations on U.S. restricted-party lists (Consolidated Screening List)", org: "U.S. International Trade Administration (Commerce, State, Treasury lists)",
    lic: "U.S. government work, public domain", url: "https://www.trade.gov/consolidated-screening-list" },
  dod1260h: { name: "Chinese military companies (DoD Section 1260H list, via OpenSanctions)", org: "U.S. Department of Defense; compiled by OpenSanctions",
    lic: "CC BY-NC 4.0 (non-commercial)", nc: true, url: "https://www.opensanctions.org/datasets/us_dod_chinese_milcorps/" },
  geonames: { name: "City positions for listed addresses (GeoNames cities over 15,000 people)", org: "GeoNames", lic: "CC BY 4.0", url: "https://www.geonames.org/" },
  ports: { name: "Chinese-run ports and terminals (Wikidata operator and owner records; OpenStreetMap operator and owner tags)", org: "Wikidata; OpenStreetMap contributors (Geofabrik Postpass)",
    lic: "CC0 (Wikidata); ODbL 1.0 (OpenStreetMap)", url: "https://www.wikidata.org/" },
};

/* ---------- last good run, so a failed source keeps its records ---------- */
const prevIndex = (() => { try { return JSON.parse(readFileSync(join(OUT, "index.json"), "utf8")); } catch { return { sources: {}, countries: {} }; } })();
const prevItems = (src) => {
  const out = [];
  if (!existsSync(OUT)) return out;
  for (const f of readdirSync(OUT)) if (/^[a-z]{2,3}\.json$/.test(f)) {
    try { for (const it of JSON.parse(readFileSync(join(OUT, f), "utf8")).items || []) if (it.src === src) out.push({ cc: f.slice(0, -5), it }); } catch {}
  }
  return out;
};

/* ---------- AidData ---------- */
const KEEP_SECTORS = new Set(["COMMUNICATIONS", "ENERGY", "TRANSPORT AND STORAGE", "INDUSTRY, MINING, CONSTRUCTION"]);
const SEC_RX = /\b(police|military|army|armed forces|defen[cs]e|security|surveillance|safe city|smart city|naval|navy|coast ?guard|border|satellite|radar|data cent(er|re)|5G|telecom\w*|sea ?port|port|harbou?r|airport|air ?base)\b/i;
function aidKind(sector, title) {
  if (/\b(police|military|army|armed forces|defen[cs]e|naval|navy|coast ?guard)\b/i.test(title)) return ["security_aid", "pr_commerce"];
  if (/\b(sea ?port|port|harbou?r|terminal|wharf|quay|jetty)\b/i.test(title) && !/\bairport\b/i.test(title)) return ["port_project", "pr_port"];
  if (sector === "COMMUNICATIONS" || /\b(surveillance|safe city|smart city|telecom\w*|5G|fib(er|re)|data cent(er|re)|satellite|broadband)\b/i.test(title)) return ["telecom", "pr_telecom"];
  if (sector === "ENERGY" || /\b(power|hydro\w*|dam|solar|wind farm|transmission|substation|grid|coal|oil|gas|pipeline|refiner\w*)\b/i.test(title)) return ["energy_project", "pr_power"];
  if (sector === "TRANSPORT AND STORAGE" || /\b(road|highway|expressway|railway|rail|bridge|airport|tunnel)\b/i.test(title)) return ["transport_project", "pr_transport"];
  return ["loan_project", "pr_commerce"];
}
/* GeoPackage geometry: "GP" header (with an optional envelope), then standard WKB. Returns every vertex as [x, y]. */
function gpkgPoints(buf) {
  if (!buf || buf.length < 8 || buf[0] !== 0x47 || buf[1] !== 0x50) return [];
  const flags = buf[3], env = (flags >> 1) & 7, envLen = [0, 32, 48, 48, 64][env] || 0;
  const pts = [];
  let o = 8 + envLen;
  function rd() {
    const le = buf[o] === 1; o += 1;
    const u32 = () => { const v = le ? buf.readUInt32LE(o) : buf.readUInt32BE(o); o += 4; return v; };
    const f64 = () => { const v = le ? buf.readDoubleLE(o) : buf.readDoubleBE(o); o += 8; return v; };
    let t = u32(), dims = 2;
    if (t > 3000) { t -= 3000; dims = 4; } else if (t > 2000) { t -= 2000; dims = 3; } else if (t > 1000) { t -= 1000; dims = 3; }
    if (t & 0x80000000) { dims = 3; t &= 0xffff; }
    const pt = () => { const x = f64(), y = f64(); for (let i = 2; i < dims; i++) f64(); pts.push([x, y]); };
    if (t === 1) pt();
    else if (t === 2) { const n = u32(); for (let i = 0; i < n; i++) pt(); }
    else if (t === 3) { const r = u32(); for (let j = 0; j < r; j++) { const n = u32(); for (let i = 0; i < n; i++) pt(); } }
    else if (t >= 4 && t <= 7) { const n = u32(); for (let i = 0; i < n; i++) rd(); }
    else throw new Error("wkb type " + t);
  }
  try { rd(); } catch (e) { dbg("wkb", e.message); }
  return pts;
}
/* the vertex nearest the middle of the extent: always on the feature, unlike a bounding-box centre */
function placePoint(pts) {
  const ok = pts.filter(([x, y]) => isFinite(x) && isFinite(y) && Math.abs(x) <= 180 && Math.abs(y) <= 90);
  if (!ok.length) return null;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of ok) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  let best = ok[0], bd = Infinity;
  for (const p of ok) { const d = (p[0] - cx) ** 2 + (p[1] - cy) ** 2; if (d < bd) { bd = d; best = p; } }
  return { lon: best[0], lat: best[1], span: Math.max(x1 - x0, y1 - y0) };
}
async function aiddata() {
  const REPO = "https://raw.githubusercontent.com/aiddata/gcdf-geospatial-data/main/";
  const rows = csv(await get(REPO + "input_data/gcdf_v3/final_input.csv"));
  log("aiddata: project table", rows.length, "rows");
  const keep = new Map();
  for (const r of rows) {
    const id = String(r["AidData.Record.ID"] || "").trim(); if (!id) continue;
    const title = r.Title || "", sector = r["Sector.Name"] || "", amt = parseFloat(r["Amount.(Constant.USD.2021)"]) || 0;
    if (!(r.Infrastructure === "Yes" || KEEP_SECTORS.has(sector) || SEC_RX.test(title) || amt >= 5e7)) continue;
    keep.set(id, r);
  }
  log("aiddata: kept", keep.size, "projects of interest");
  /* geometry: the GeoPackage attached to the latest release (the workflow downloads and unzips it to CNP_GPKG) */
  const gpkg = process.env.CNP_GPKG;
  if (!gpkg || !existsSync(gpkg)) throw new Error("no GeoPackage (CNP_GPKG)");
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(gpkg, { readOnly: true });
  const tables = db.prepare("SELECT table_name FROM gpkg_contents WHERE data_type = 'features'").all().map((t) => t.table_name);
  log("aiddata: GeoPackage tables", tables.join(", "));
  const geo = new Map();
  for (const t of tables) {
    const gcol = (db.prepare("SELECT column_name FROM gpkg_geometry_columns WHERE table_name = ?").get(t) || {}).column_name || "geom";
    const cols = db.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name);
    const idc = cols.find((c) => /^(id|aiddata.?record.?id|project.?id)$/i.test(c.replace(/[ _.]/g, "."))) || cols.find((c) => /record.?id|^id$/i.test(c));
    dbg("table", t, "geometry", gcol, "id column", idc, "columns", cols.slice(0, 40).join(","));
    if (!idc) continue;
    for (const row of db.prepare(`SELECT "${idc}" AS id, "${gcol}" AS g FROM "${t}"`).iterate()) {
      const id = String(row.id).replace(/\.0$/, ""); if (!keep.has(id) || geo.has(id)) continue;
      const p = placePoint(gpkgPoints(row.g ? Buffer.from(row.g) : null)); if (p) geo.set(id, p);
    }
  }
  db.close();
  log("aiddata: placed", geo.size, "of", keep.size);
  const out = [];
  for (const [id, r] of keep) {
    const g = geo.get(id); if (!g) continue;
    const hint = ccFromA3(r["Recipient.ISO-3"]), cc = ccOf(g.lat, g.lon, hint) || hint;
    if (!cc || !IDS.has(cc) || cc === "cn") continue;
    const title = clip(r.Title, 220), sector = r["Sector.Name"] || "", [kind, sym] = aidKind(sector, title);
    const lvl = String(r["Level.of.precision"] || "").toUpperCase(), precise = /PRECISE/.test(lvl) && !/ADM|APPROX/.test(lvl);
    const status = r.Status || "", amt = parseFloat(r["Amount.(Constant.USD.2021)"]) || 0;
    const year = r["Commitment.Year"] || "", done = (r["Actual.Completion.Date.(MM/DD/YYYY)"] || "").slice(0, 10);
    const state = /^Completion/i.test(status) ? "past" : /^Implementation/i.test(status) ? "current" : /^Pipeline/i.test(status) ? "proposed" : "unclear";
    const why = [sector ? sector.charAt(0) + sector.slice(1).toLowerCase() : "", amt ? "about USD " + (amt >= 1e9 ? (amt / 1e9).toFixed(1) + " billion" : (amt / 1e6).toFixed(amt >= 1e7 ? 0 : 1) + " million") + " (2021 dollars)" : "amount not recorded",
      year ? "committed " + year : "", status ? "status at last update: " + status.toLowerCase() : "", done ? "completed " + done : ""].filter(Boolean).join(" · ");
    out.push({ cc, it: {
      id: "cnp:aid:" + id, src: "aiddata", type: "presence", domain: kind === "port_project" ? "sea" : "land", name: title, kind, sym,
      lat: r4(g.lat), lon: r4(g.lon), prec: precise ? (g.span > 0.05 ? "point on a mapped feature (large extent)" : "mapped feature") : "approximate (administrative area)",
      actor: "Chinese state lenders and donors (official finance)", state, why, amt: amt ? Math.round(amt) : null, year: year ? +year : null,
      claim_status: CLAIM, last_reported: "2021", lic: SOURCES.aiddata.lic,
      evidence: [{ date: r["Commitment.Date.(MM/DD/YYYY)"] || null, t: "AidData GCDF v3.0 project " + id, src: SOURCES.aiddata.url, srcname: "AidData (record " + id + ")" }],
      fp: fp("aiddata", id, title, g.lat.toFixed(4), g.lon.toFixed(4), status) } });
  }
  return out;
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

/* ---------- U.S. restricted-party lists ---------- */
const LIST_SHORT = { "Entity List": "Commerce Entity List", "Military End User": "Commerce Military End-User list", "Unverified List": "Commerce Unverified List",
  "Denied Persons List": "Commerce Denied Persons list", "Specially Designated Nationals": "Treasury SDN list", "Non-SDN Chinese Military-Industrial Complex": "Treasury Chinese Military-Industrial Complex list",
  "Sectoral Sanctions": "Treasury Sectoral Sanctions list", "Foreign Sanctions Evaders": "Treasury Foreign Sanctions Evaders list", "Nonproliferation Sanctions": "State nonproliferation sanctions",
  "ITAR Debarred": "State ITAR debarred list", "Menu-Based Sanctions": "Treasury menu-based sanctions list", "Capta": "Treasury CAPTA list" };
const shortList = (s) => { for (const [k, v] of Object.entries(LIST_SHORT)) if (String(s).toLowerCase().includes(k.toLowerCase())) return v; return clip(s, 80); };
const normName = (s) => String(s || "").toLowerCase().replace(/&/g, " and ").replace(/\b(co|company|corp|corporation|ltd|limited|inc|group|holdings?|the)\b/g, "").replace(/[^a-z0-9]/g, "");
async function dod1260h() {
  const rows = csv(await get("https://data.opensanctions.org/datasets/latest/us_dod_chinese_milcorps/targets.simple.csv"));
  const names = new Map();
  for (const r of rows) for (const n of [r.name, ...String(r.aliases || "").split(";")]) { const k = normName(n); if (k.length >= 4) names.set(k, r.name); }
  log("dod1260h:", rows.length, "companies");
  return { rows, names };
}
async function uslists(mil) {
  let list = null, via = "trade.gov";
  try {
    const j = JSON.parse(await get("https://data.trade.gov/downloadable_consolidated_screening_list/v1/consolidated.json"));
    list = Array.isArray(j) ? j : j.results || j.data || null;
    if (!Array.isArray(list)) throw new Error("unexpected shape: " + Object.keys(j).slice(0, 6).join(","));
  } catch (e) {
    log("uslists: trade.gov JSON failed:", e.message.slice(0, 160));
    const rows = csv(await get("https://data.trade.gov/downloadable_consolidated_screening_list/v1/consolidated.csv"));
    list = rows.map((r) => ({ ...r, addresses: String(r.addresses || "").split(";").map((a) => { const p = a.split(",").map((x) => x.trim()); return { address: p.slice(0, -1).join(", "), country: p[p.length - 1] }; }) }));
  }
  log("uslists:", list.length, "listings via", via);
  await cities().catch((e) => log("geonames failed:", e.message));
  const milNames = mil ? mil.names : new Map();
  const out = [];
  for (const e of list) {
    const type = String(e.type || "").toLowerCase();
    if (type === "individual" || type === "person") continue;               // organisations only: no private names
    if (type === "vessel" || type === "aircraft") continue;
    const name = clip(e.name, 160); if (!name) continue;
    const addrs = (Array.isArray(e.addresses) ? e.addresses : []).map((a) => ({ ...a, cc: ccA2(a.country) })).filter((a) => a.cc);
    if (!addrs.length) continue;
    const src = String(e.source || ""), progs = [].concat(e.programs || []).join(", ");
    const inPRC = addrs.some((a) => a.cc === "cn"), cmic = /chinese military-industrial|CMIC/i.test(src + " " + progs);
    const on1260 = milNames.get(normName(name)) || [].concat(e.alt_names || []).map((n) => milNames.get(normName(n))).find(Boolean) || null;
    const why = [inPRC && "lists an address in mainland China, Hong Kong or Macau", cmic && "on the Chinese Military-Industrial Complex list", on1260 && "named on the DoD Section 1260H list of Chinese military companies"].filter(Boolean);
    const ccs = new Set(addrs.map((a) => a.cc).filter((c) => c === "cn" || why.length));
    if (!ccs.size) continue;
    const list1 = shortList(src), start = String(e.start_date || "").slice(0, 10) || null;
    for (const cc of ccs) {
      if (!IDS.has(cc)) continue;
      const here = addrs.filter((a) => a.cc === cc);
      const a2 = (COUNTRIES.find((c) => c.id === cc) || {}).a2 || "";
      let place = null;
      for (const a of here) {
        /* only the address's own city and state fields: a street or district name can match a city elsewhere */
        const c = findCity(cc === "cn" ? String(a.country || "CN").toUpperCase() : a2, [a.city, a.state]);
        if (c) { place = c; break; }
      }
      const where = here.map((a) => [a.city, a.state].filter(Boolean).join(", ")).filter(Boolean)[0] || "";
      const id = String(e.id || e._id || e.entity_number || fp(src, name).slice(0, 16));
      out.push({ cc, it: {
        id: "cnp:us:" + fp(id, cc).slice(0, 16), src: "uslists", type: "presence", domain: "land", name, kind: "listed_company", sym: "pr_listed",
        lat: place ? r4(place.la) : null, lon: place ? r4(place.lo) : null, prec: place ? "city of the listed address (" + place.nm + ")" : "no position: listed address only",
        place: where || null, actor: name, state: "current",
        why: clip("On the " + list1 + (start ? " since " + start : "") + (progs ? " (programme " + progs + ")" : "") + ". China link: " + (why.length ? why.join("; ") : "listed at an address in China") + "." +
          (inPRC && !cmic && !on1260 && progs && !/china|cmic|prc/i.test(progs) && /dprk|nkorea|iran|russia|syria|venez|cuba|burma|sdgt|narc|tco/i.test(progs) ? " The listing is under another country's or another sanctions programme; the China address may be a front or trading office." : "") +
          (e.federal_register_notice ? " Federal Register " + e.federal_register_notice + "." : ""), 400),
        list: list1, claim_status: "Listing by the U.S. government; a listing is a U.S. legal designation, not a finding of fact by OSAP", last_reported: start, lic: SOURCES.uslists.lic,
        evidence: [{ date: start, t: list1 + ": " + name, src: e.source_list_url || e.source_information_url || SOURCES.uslists.url, srcname: "U.S. Consolidated Screening List" }],
        ...(on1260 ? { also: "DoD 1260H" } : {}),
        fp: fp("uslists", id, name, cc, src) } });
    }
  }
  /* DoD 1260H companies that no screening-list entry already covers: China's page, listed without a pin unless a city is known */
  if (mil) {
    const have = new Set(out.filter((o) => o.cc === "cn").map((o) => normName(o.it.name)));
    for (const r of mil.rows) {
      if (have.has(normName(r.name))) continue;
      const cc = ccA2(String(r.countries || "").split(";")[0]) || "cn"; if (!IDS.has(cc)) continue;
      out.push({ cc, it: { id: "cnp:1260h:" + fp(r.id || r.name).slice(0, 16), src: "dod1260h", nc: true, type: "presence", domain: "land", name: clip(r.name, 160), kind: "listed_company", sym: "pr_listed",
        lat: null, lon: null, prec: "no position: listed company", actor: clip(r.name, 160), state: "current",
        why: "Named on the U.S. Defense Department's Section 1260H list of Chinese military companies operating in the United States.", list: "DoD Section 1260H list",
        claim_status: "Listing by the U.S. government; a listing is a U.S. legal designation, not a finding of fact by OSAP", last_reported: (r.first_seen || "").slice(0, 10) || null, lic: SOURCES.dod1260h.lic,
        evidence: [{ date: null, t: "DoD 1260H list: " + r.name, src: "https://www.opensanctions.org/entities/" + r.id + "/", srcname: "OpenSanctions (DoD 1260H)" }],
        fp: fp("dod1260h", r.id || "", r.name) } });
    }
  }
  return out;
}

/* ---------- OpenStreetMap: Chinese-run ports and terminals ---------- */
const PORT_OPS = "(cosco|china merchants|cmport|cm port|shanghai international port|sipg|qingdao port|tianjin port|ningbo|zhoushan port|guangzhou port|" +
  "beibu gulf|china harbour|\\ychec\\y|china communications construction|\\ycccc\\y|china ocean shipping|hutchison|yantian international|dalian port|" +
  "\\ychinese\\y|\\ychina\\y)";  // PostgreSQL regex: \\y is a word boundary
/* the whole world in one regex query times out (HTTP 504), so it is read in tiles of 30 degrees of longitude by three latitude
   bands, as tools/build_infra.mjs does; a tile that fails is retried once, and the source fails only if most tiles do */
async function postpass(sql) {
  let err;
  for (let k = 0; k < 2; k++) {
    try {
      const j = JSON.parse(await get("https://postpass.geofabrik.de/api/interpreter", { method: "POST", body: "data=" + encodeURIComponent(sql), headers: { "content-type": "application/x-www-form-urlencoded" } }, 150000));
      if (!j.features) throw new Error("no features");
      return j.features;
    } catch (e) { err = e; log("  postpass", e.message.slice(0, 120)); await new Promise((r) => setTimeout(r, 15000)); }
  }
  throw err;
}
async function ports() {
  const W = `(coalesce(tags->>'operator','') ~* '${PORT_OPS}' OR coalesce(tags->>'owner','') ~* '${PORT_OPS}' OR coalesce(tags->>'operator:en','') ~* '${PORT_OPS}') AND ` +
    `(tags->>'landuse' = 'port' OR tags->>'industrial' IN ('port','terminal','container_terminal','shipyard') OR tags ? 'harbour' OR tags->>'man_made' IN ('pier','quay') ` +
    `OR coalesce(tags->>'seamark:type','') IN ('harbour','harbour_basin','berth') OR tags->>'amenity' = 'ferry_terminal' OR tags ? 'port')`;
  const feats = []; let bad = 0, n = 0;
  for (let lon = -180; lon < 180; lon += 30) for (const [s0, n0] of [[-60, -10], [-10, 25], [25, 75]]) {
    n++;
    const env = `geom && ST_MakeEnvelope(${lon},${s0},${lon + 30},${n0},4326)`;
    try { const f = await postpass(`SELECT osm_type, osm_id, tags, ST_PointOnSurface(geom) AS geom FROM postpass_pointpolygon WHERE ${env} AND ${W}`); feats.push(...f); dbg("tile", lon, s0, f.length); }
    catch (e) { bad++; log("ports: tile", lon, s0, "failed:", e.message.slice(0, 100)); }
  }
  if (bad > n / 2) throw new Error(bad + " of " + n + " tiles failed");
  log("ports:", feats.length, "features,", bad, "tiles failed");
  const j = { features: feats };
  const out = [];
  for (const f of j.features) {
    const t = f.properties.tags || f.properties || {}, c = f.geometry && f.geometry.coordinates; if (!c) continue;
    const [lon, lat] = c, cc = ccOf(lat, lon);
    if (!cc || !IDS.has(cc) || cc === "cn" || cc === "tw") continue;
    const op = t["operator:en"] || t.operator || t.owner || "", name = t["name:en"] || t.name || (op + " terminal");
    const type = f.properties.osm_type === "W" ? "way" : f.properties.osm_type === "R" ? "relation" : "node", oid = f.properties.osm_id;
    out.push({ cc, it: {
      id: "cnp:osm:" + type[0] + oid, src: "ports", type: "presence", domain: "sea", name: clip(name, 140), kind: "port_terminal", sym: "pr_port",
      lat: r4(lat), lon: r4(lon), prec: "mapped feature", actor: clip(op, 140), state: "current",
      why: clip("Port, terminal or quay mapped in OpenStreetMap with operator or owner \"" + op + "\"" + (t.start_date ? ", in use since " + t.start_date : "") + ". Operator tags are added by volunteers and may be out of date.", 300),
      claim_status: CLAIM, last_reported: null, lic: SOURCES.ports.lic,
      evidence: [{ date: null, t: "OpenStreetMap " + type + " " + oid, src: "https://www.openstreetmap.org/" + type + "/" + oid, srcname: "OpenStreetMap" }],
      fp: fp("ports", type, oid, op, lat.toFixed(4), lon.toFixed(4)) } });
  }
  return out;
}

/* ---------- Wikidata: ports and terminals operated or owned by Chinese port groups (CC0) ----------
   OpenStreetMap tags few terminals with an operator, so Wikidata adds the ones it records: the companies are looked up by
   name, then every site with coordinates that one of them (or a subsidiary of one) operates or owns, kept when it reads as a
   port, terminal, harbour, quay or dock. */
const PORT_GROUPS = ["COSCO Shipping Ports", "COSCO Shipping", "China COSCO Shipping", "China Merchants Port Holdings", "China Merchants Group",
  "Shanghai International Port Group", "Qingdao Port International", "Ningbo Zhoushan Port", "China Harbour Engineering Company", "China Communications Construction Company",
  "Hutchison Ports", "CK Hutchison Holdings", "Beibu Gulf Port", "Tianjin Port Group", "Dalian Port"];
async function wdports() {
  const roots = new Set();
  for (const n of PORT_GROUPS) {
    try {
      const j = JSON.parse(await get("https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=4&search=" + encodeURIComponent(n), {}, 60000));
      for (const r of j.search || []) if (/compan|port|operator|terminal|shipping|holding|group|conglomerate|enterprise/i.test(r.description || "")) { roots.add(r.id); dbg("wd root", n, r.id, r.label, r.description); }
    } catch (e) { log("wdports: search", n, e.message.slice(0, 80)); }
  }
  if (!roots.size) throw new Error("no companies found");
  const q = `SELECT ?site ?siteLabel ?coord ?opLabel ?clsLabel ?start WHERE { VALUES ?root { ${[...roots].map((x) => "wd:" + x).join(" ")} }
    ?op (wdt:P749|wdt:P127)* ?root . ?site (wdt:P137|wdt:P127|wdt:P749) ?op ; wdt:P625 ?coord . OPTIONAL { ?site wdt:P31 ?cls } OPTIONAL { ?site wdt:P571 ?start }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 5000`;
  const j = JSON.parse(await get("https://query.wikidata.org/sparql", { method: "POST", body: "query=" + encodeURIComponent(q),
    headers: { accept: "application/sparql-results+json", "content-type": "application/x-www-form-urlencoded" } }, 240000));
  const seen = new Map();
  for (const b of j.results.bindings) {
    const id = b.site.value.split("/").pop(), m = /Point\(([-\d.eE]+) ([-\d.eE]+)\)/.exec(b.coord.value); if (!m) continue;
    const words = [b.siteLabel && b.siteLabel.value, b.clsLabel && b.clsLabel.value].join(" ");
    if (!/\b(port|terminal|harbou?r|quay|wharf|pier|dock|berth|seaport)\b/i.test(words)) continue;
    const o = seen.get(id) || { id, name: b.siteLabel ? b.siteLabel.value : id, lon: +m[1], lat: +m[2], ops: new Set(), start: b.start ? b.start.value.slice(0, 4) : null };
    if (b.opLabel) o.ops.add(b.opLabel.value); seen.set(id, o);
  }
  log("wdports:", roots.size, "companies,", seen.size, "port sites");
  const out = [];
  for (const o of seen.values()) {
    const cc = ccOf(o.lat, o.lon); if (!cc || !IDS.has(cc) || cc === "cn" || cc === "tw") continue;
    const op = [...o.ops].slice(0, 3).join(", ");
    out.push({ cc, it: {
      id: "cnp:wd:" + o.id, src: "ports", type: "presence", domain: "sea", name: clip(o.name, 140), kind: "port_terminal", sym: "pr_port",
      lat: r4(o.lat), lon: r4(o.lon), prec: "Wikidata coordinates", actor: clip(op, 140), state: "current",
      why: clip("Recorded in Wikidata as operated or owned by " + op + (o.start ? ", opened " + o.start : "") + ". Ownership and operating stakes change; check the source.", 300),
      claim_status: CLAIM, last_reported: null, lic: "CC0 (Wikidata)",
      evidence: [{ date: null, t: "Wikidata " + o.id, src: "https://www.wikidata.org/wiki/" + o.id, srcname: "Wikidata" }],
      fp: fp("wdports", o.id, op, o.lat.toFixed(4), o.lon.toFixed(4)) } });
  }
  return out;
}

/* ---------- run every source, keep the last good copy of any that fails ---------- */
const byCc = new Map(), status = {};
const add = (list) => { for (const { cc, it } of list) (byCc.get(cc) || byCc.set(cc, []).get(cc)).push(it); };
async function run(id, fn, alsoIds = []) {
  if (ONLY && !ONLY.has(id)) { const old = prevItems(id); for (const a of alsoIds) old.push(...prevItems(a)); add(old); status[id] = { ...(prevIndex.sources[id] || {}), skipped: true }; return; }
  const t0 = Date.now();
  try {
    const list = await fn(); add(list);
    const n = {}; for (const { it } of list) n[it.src] = (n[it.src] || 0) + 1;
    status[id] = { ok: true, at: now, n: list.length };
    for (const a of alsoIds) status[a] = { ok: true, at: now, n: n[a] || 0 };
    log(id + ":", list.length, "records in", Math.round((Date.now() - t0) / 1000), "s");
  } catch (e) {
    const old = prevItems(id); for (const a of alsoIds) old.push(...prevItems(a)); add(old);
    status[id] = { ok: false, at: (prevIndex.sources[id] || {}).at || null, n: old.length, err: clip(e.message, 200) };
    log(id + ": FAILED, kept", old.length, "from last run:", e.message);
  }
}
await run("aiddata", aiddata);
let mil = null;
if (!ONLY || ONLY.has("uslists")) { try { mil = await dod1260h(); } catch (e) { log("dod1260h failed:", e.message); } }
await run("uslists", () => uslists(mil), ["dod1260h"]);
if (!mil && status.dod1260h && status.dod1260h.ok) status.dod1260h = { ok: false, at: (prevIndex.sources.dod1260h || {}).at || null, n: 0, err: "list not read" };
await run("ports", async () => {
  const errs = [], all = [];
  for (const f of [wdports, ports]) { try { all.push(...(await f())); } catch (e) { errs.push(f.name + ": " + e.message); log("ports:", f.name, "failed:", e.message); } }
  if (!all.length && errs.length) throw new Error(errs.join("; "));
  const seen = new Set(); return all.filter(({ cc, it }) => { const k = cc + ":" + it.lat.toFixed(2) + "," + it.lon.toFixed(2) + ":" + it.name.toLowerCase(); return !seen.has(k) && seen.add(k); });
});
if (status.uslists && status.uslists.ok) status.geonames = { ok: !!CITIES, at: now };

/* ---------- write ---------- */
mkdirSync(OUT, { recursive: true });
const countries = {};
const order = { aiddata: 0, ports: 1, uslists: 2, dod1260h: 3 };
for (const [cc, list] of byCc) {
  const seen = new Set(), items = list.filter((i) => !seen.has(i.id) && seen.add(i.id))
    .sort((a, b) => order[a.src] - order[b.src] || (b.amt || 0) - (a.amt || 0) || String(a.name).localeCompare(b.name));
  const n = {}; for (const i of items) n[i.src] = (n[i.src] || 0) + 1;
  countries[cc] = n;
  writeFileSync(join(OUT, cc + ".json"), JSON.stringify({ v: 1, cc, at: now, items }) + "\n");
}
for (const f of readdirSync(OUT)) if (/^[a-z]{2,3}\.json$/.test(f) && !countries[f.slice(0, -5)]) unlinkSync(join(OUT, f));
const sources = {};
for (const [id, s] of Object.entries(SOURCES)) sources[id] = { ...s, ...(status[id] || prevIndex.sources[id] || { ok: false }) };
writeFileSync(join(OUT, "index.json"), JSON.stringify({ v: 1, at: now, sources, countries }, null, 1) + "\n");
const tot = Object.values(countries).reduce((a, n) => a + Object.values(n).reduce((x, y) => x + y, 0), 0);
log("wrote", Object.keys(countries).length, "countries,", tot, "records");
for (const [id, s] of Object.entries(status)) log(" ", id, s.ok ? "ok" : "FAILED", s.n != null ? s.n : "", s.err || "");
if (!Object.values(status).some((s) => s.ok)) process.exit(1);
