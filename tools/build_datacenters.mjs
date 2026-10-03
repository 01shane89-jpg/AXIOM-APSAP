// Stored data centres for Map overlays > Infrastructure > Data centres (assets/osap-dc.js). Run by
// .github/workflows/refresh-datacenters.yml, or by hand with Node 20+:   node tools/build_datacenters.mjs   (DC_DEBUG=1 prints more)
// Sources, all keyless and public:
//   - OpenStreetMap (ODbL): telecom=data_center and building=data_center, the whole world through Overpass in longitude bands.
//     An unnamed data centre building within 300 m of another mapped data centre is taken to be part of it and left out.
//   - Wikidata (CC0): items that are an instance of data center (Q671224, or a subclass) with coordinates; one within 300 m of an
//     OpenStreetMap data centre is left out as the same site.
//   - Epoch AI (CC BY 4.0): GPU Clusters (AI supercomputers, with Epoch's own latitude and longitude where given) and Frontier
//     Data Centers (the largest AI campuses; the table gives a street address, so they are placed at the town the address names,
//     using the GeoNames gazetteer in tools/gazetteer.mjs, and marked approximate). Epoch's confidence tags ("#likely") are kept
//     as words in brackets, never dropped silently. Rows Epoch marks Exclude are left out.
// Only Epoch AI records carry the AI flag: Epoch lists them as AI data centres or GPU clusters. Nothing else is called AI.
// A site that cannot be placed is kept in its country's file as unplaced (listed in the panel, not drawn). GPU clusters at the
// same coordinates with the same owner (phases of one build, such as Colossus phases 1 to 3) are one point: the largest
// existing one leads and the others are listed on it.
// Output: data/dc/<cc>.json { v, cc, at, items: [...], unplaced: [...] } and data/dc/index.json { v, at, sources, countries }.
// A source that fails keeps its items from the last good run (index.sources[s].ok false, with that run's time), so a busy server
// never empties the map, and the failure is shown in the panel rather than hidden.
// Privacy: only site names, operators and owners (companies and public bodies) are kept; no contacts, no people.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { ccsAt, ccFromName, ccFromA2, COUNTRIES } from "./geo_cc.mjs";
import { loadGazetteer, placeIn } from "./gazetteer.mjs";

const OUT = process.env.DC_OUT || "data/dc", DEBUG = !!process.env.DC_DEBUG;
const UA = "AXIOM-OSAP data centre snapshot (https://github.com/osap-app/osap-app.github.io)";
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
const EPOCH_DC = ["https://epoch.ai/data/generated/data_centers/data_centers.csv", "https://epoch.ai/data/data_centers/data_centers.csv"];
const EPOCH_GPU = ["https://epoch.ai/data/gpu_clusters.csv"];
const WDQS = "https://query.wikidata.org/sparql";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const fp = (...p) => createHash("sha256").update(p.join("|")).digest("hex");
const r5 = (x) => Math.round(x * 1e5) / 1e5;
const clip = (s, n = 120) => { const t = String(s == null ? "" : s).replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const IDS = new Set(COUNTRIES.map((c) => c.id));

async function get(url, opt = {}, ms = 120000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...opt, signal: ctl.signal, headers: { "user-agent": UA, ...(opt.headers || {}) } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}
/* the country a point is in: its outline; else the nearest within 0.3 degrees (small islands, coasts) */
function ccOf(lat, lon, hint) {
  const at = ccsAt(lat, lon, 0.3);
  if (hint && at.includes(hint)) return hint;
  return at[0] || null;
}

/* ---------- OpenStreetMap ---------- */
async function overpass(q) {
  let err;
  for (const u of OVERPASS) {
    for (let k = 0; k < 2; k++) {
      try { return JSON.parse(await get(u, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "content-type": "application/x-www-form-urlencoded" } }, 400000)); }
      catch (e) { err = e; log("  overpass", u.split("/")[2], e.message); await sleep(15000); }
    }
  }
  throw err;
}
async function osm() {
  const els = [];
  for (let w = -180; w < 180; w += 30) {
    const bb = [-60, w, 78, w + 30].join(",");
    const q = `[out:json][timeout:360][maxsize:536870912][bbox:${bb}];(nwr["telecom"="data_center"];nwr["building"="data_center"];nwr["building"="data_centre"];nwr["telecom"="data_centre"];);out center tags;`;
    const j = await overpass(q);
    log("  osm band", w, (j.elements || []).length);
    els.push(...(j.elements || []));
    await sleep(5000);
  }
  const seen = new Set(), pts = [];
  for (const e of els) {
    const id = e.type[0] + e.id; if (seen.has(id)) continue; seen.add(id);
    const c = e.center || (e.lat != null ? e : null); if (!c) continue;
    const t = e.tags || {};
    if (/^(disused|abandoned|demolished|razed)/.test(Object.keys(t).join(" ")) || t.disused === "yes" || t.abandoned === "yes") continue;
    pts.push({ e, t, id, lat: c.lat, lon: c.lon, named: !!(t.name || t["name:en"] || t.operator), dc: /data_cent/.test(t.telecom || "") });
  }
  /* an unnamed building next to a mapped data centre is one of its halls */
  const grid = new Map(), key = (la, lo) => Math.floor(la / 0.01) + ":" + Math.floor(lo / 0.01);
  for (const p of pts) if (p.named || p.dc) { const k = key(p.lat, p.lon); (grid.get(k) || grid.set(k, []).get(k)).push(p); }
  const near = (p, m) => { const a = Math.floor(p.lat / 0.01), b = Math.floor(p.lon / 0.01);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const q of grid.get(a + i + ":" + (b + j)) || []) if (q !== p && dist(p, q) < m) return true; return false; };
  const out = [];
  for (const p of pts) {
    if (!p.named && !p.dc && near(p, 300)) continue;
    const t = p.t, cc = ccOf(p.lat, p.lon); if (!cc) continue;
    const typ = { n: "node", w: "way", r: "relation" }[p.id[0]];
    out.push({ id: "osm:" + p.id, cc, la: r5(p.lat), lo: r5(p.lon), nm: clip(t["name:en"] || t.name || ""), op: clip(t.operator || t.owner || t.brand || ""),
      s: "osm", u: "https://www.openstreetmap.org/" + typ + "/" + p.id.slice(1), p: "exact",
      x: Object.fromEntries([["opened", t.start_date], ["levels", t["building:levels"]], ["ref", t.ref]].filter((r) => r[1]).map((r) => [r[0], clip(r[1], 40)])) });
  }
  return out;
}

/* ---------- Wikidata ---------- */
async function wikidata() {
  const q = `SELECT ?item ?itemLabel ?coord ?opLabel ?a2 ?inc WHERE {
  ?item wdt:P31/wdt:P279* wd:Q671224; wdt:P625 ?coord.
  OPTIONAL { ?item wdt:P137 ?op. } OPTIONAL { ?item wdt:P17 ?c. ?c wdt:P297 ?a2. } OPTIONAL { ?item wdt:P571 ?inc. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". } }`;
  const j = JSON.parse(await get(WDQS + "?format=json&query=" + encodeURIComponent(q), { headers: { accept: "application/sparql-results+json" } }, 180000));
  const by = new Map();
  for (const b of j.results.bindings) {
    const m = /Point\(([-\d.eE]+) ([-\d.eE]+)\)/.exec(b.coord.value); if (!m) continue;
    const qid = b.item.value.split("/").pop(), lon = +m[1], lat = +m[2];
    const prev = by.get(qid);
    if (prev) { if (b.opLabel && !prev.op.includes(b.opLabel.value)) prev.op = clip(prev.op ? prev.op + ", " + b.opLabel.value : b.opLabel.value); continue; }
    const nm = b.itemLabel && b.itemLabel.value !== qid ? b.itemLabel.value : "";
    const cc = ccOf(lat, lon, ccFromA2(b.a2 && b.a2.value)); if (!cc) continue;
    by.set(qid, { id: "wd:" + qid, cc, la: r5(lat), lo: r5(lon), nm: clip(nm), op: clip(b.opLabel ? b.opLabel.value : ""), s: "wd", u: "https://www.wikidata.org/wiki/" + qid, p: "exact",
      x: b.inc ? { opened: String(b.inc.value).slice(0, 4) } : {} });
  }
  return [...by.values()];
}

/* ---------- Epoch AI ---------- */
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
  return { head, rows: rows.filter((r) => r.some((c) => c.trim())).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || "").trim()]))) };
}
/* the first column whose header matches */
const col = (head, ...res) => { for (const re of res) { const h = head.find((x) => re.test(x)); if (h) return h; } return null; };
async function firstOk(urls) { let err; for (const u of urls) { try { return { u, t: await get(u) }; } catch (e) { err = e; log("  ", u, e.message); } } throw err; }
/* "SpaceXAI #confident, Cursor #likely" -> "SpaceXAI (confident), Cursor (likely)" */
const tags = (s) => String(s || "").replace(/\s*#(\w+)/g, " ($1)").trim();
const num = (s) => { const n = parseFloat(String(s || "").replace(/[, ]/g, "")); return isFinite(n) ? n : null; };
const page = (u) => u.replace(/\/[^/]*\.csv$/, "").replace("/generated/data_centers", "/data-centers").replace("/data/data_centers", "/data/data-centers").replace("/data/gpu_clusters", "/data/gpu-clusters");

async function epochDc(gz) {
  const { u, t } = await firstOk(EPOCH_DC);
  const { head, rows } = csv(t);
  log("  epoch dc columns:", head.join(" | "));
  if (DEBUG) log("  sample:", JSON.stringify(rows.slice(0, 2)));
  const H = { name: col(head, /^name$/i, /name/i), owner: col(head, /^owner/i, /operator/i, /company/i), users: col(head, /^users?$/i, /tenant/i),
    lat: col(head, /^lat/i, /latitude/i), lon: col(head, /^lon/i, /^lng/i, /longitude/i), coords: col(head, /coordinates/i),
    country: col(head, /^country/i), loc: col(head, /^location/i, /address/i, /city/i), status: col(head, /status/i),
    mw: col(head, /current.*(power|mw)/i, /power.*mw/i, /capacity.*mw/i, /mw/i), h100: col(head, /current.*h100/i, /h100/i) };
  log("  epoch dc mapped:", JSON.stringify(H));
  const out = [];
  for (const r of rows) {
    let lat = num(r[H.lat]), lon = num(r[H.lon]);
    if ((lat == null || lon == null) && H.coords) { const m = /(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/.exec(r[H.coords] || ""); if (m) { lat = +m[1]; lon = +m[2]; } }
    const nm = r[H.name]; if (!nm) continue;
    const hint = ccFromName(r[H.country]) || ccFromA2(r[H.country]);
    const x = Object.fromEntries([["users", clip(tags(r[H.users]), 100)], ["power_mw", num(r[H.mw])], ["h100e", num(r[H.h100])], ["where", clip(r[H.loc], 80)]].filter((p) => p[1] != null && p[1] !== ""));
    const base = { id: "epdc:" + fp(nm).slice(0, 12), nm: clip(nm), op: clip(tags(r[H.owner])), s: "epochdc", ai: 1, u: page(u), st: clip(r[H.status], 40), x };
    let p = "exact", pb = "";
    if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      const at = gz && hint ? placeIn(gz, (r[H.loc] || "") + ". " + nm, [hint]) : null;
      if (!at) { out.push({ ...base, unplaced: true, cc: hint, why: "Epoch AI Frontier Data Centers (no town found in the address)" }); continue; }
      lat = at.lat; lon = at.lon; p = at.prec; pb = at.basis + ": " + at.name;
    }
    const cc = ccOf(lat, lon, hint) || hint; if (!cc) continue;
    out.push({ ...base, cc, la: r5(lat), lo: r5(lon), p, ...(pb ? { pb } : {}) });
  }
  return out;
}
async function epochGpu(gz) {
  const { u, t } = await firstOk(EPOCH_GPU);
  const { head, rows } = csv(t);
  log("  epoch gpu columns:", head.join(" | "));
  if (DEBUG) log("  sample:", JSON.stringify(rows.slice(0, 2)));
  const H = { name: col(head, /^name$/i, /name/i), owner: col(head, /^owner/i, /operator/i), users: col(head, /^users?$/i),
    country: col(head, /^country/i), loc: col(head, /^location/i, /city/i), status: col(head, /^status/i), cert: col(head, /certainty/i),
    h100: col(head, /h100/i), mw: col(head, /power.*(mw|capacity)/i, /mw/i), chip: col(head, /chip type/i, /hardware/i), date: col(head, /^first operational date$/i, /first operational/i),
    lat: col(head, /^latitude$/i, /^lat$/i), lon: col(head, /^longitude$/i, /^lon$/i, /^lng$/i), excl: col(head, /^exclude$/i), gone: col(head, /decommissioned/i),
    sup: col(head, /^superseded by$/i) };
  log("  epoch gpu mapped:", JSON.stringify(H));
  const out = [];
  let placed = 0, exact = 0;
  for (const r of rows) {
    const nm = r[H.name]; if (!nm) continue;
    if (H.excl && /^(true|yes|1|x)$/i.test(r[H.excl] || "")) continue;
    const country = r[H.country] || "", loc = r[H.loc] || "";
    /* a cluster spread over several countries or places is listed, not drawn */
    const ccs = country.split(/[;,/]| and /).map((s) => ccFromName(s.trim()) || ccFromA2(s.trim())).filter(Boolean);
    const x = Object.fromEntries([["users", clip(r[H.users], 80)], ["h100e", num(r[H.h100])], ["power_mw", num(r[H.mw])], ["chips", clip(r[H.chip], 60)],
      ["operational", clip(r[H.date], 20)], ["certainty", clip(r[H.cert], 30)], ["where", clip(loc, 80)], ["decommissioned", clip(r[H.gone], 20)], ["superseded_by", clip(r[H.sup], 80)]].filter((p) => p[1] != null && p[1] !== ""));
    const base = { nm: clip(nm), op: clip(tags(r[H.owner])), s: "epochgpu", ai: 1, u: page(u), st: clip(r[H.gone] ? "Decommissioned" : r[H.status], 40), x };
    if (ccs.length !== 1) { for (const cc of ccs) out.push({ ...base, unplaced: true, cc, why: "Epoch AI GPU Clusters (more than one country)" }); continue; }
    const cc = ccs[0], la = num(r[H.lat]), lo = num(r[H.lon]);
    if (la != null && lo != null && Math.abs(la) <= 90 && Math.abs(lo) <= 180 && (la || lo)) {
      placed++; exact++;
      out.push({ ...base, id: "epgpu:" + fp(nm, country).slice(0, 12), cc: ccOf(la, lo, cc) || cc, la: r5(la), lo: r5(lo), p: "exact" });
      continue;
    }
    const at = gz && loc ? placeIn(gz, loc, [cc]) : null;
    if (!at) { out.push({ ...base, unplaced: true, cc, why: "Epoch AI GPU Clusters (no location given)" }); continue; }
    placed++;
    out.push({ ...base, id: "epgpu:" + fp(nm, country).slice(0, 12), cc, la: at.lat, lo: at.lon, p: at.prec, pb: at.basis + ": " + at.name });
  }
  log("  epoch gpu rows", rows.length, "placed", placed, "with Epoch's own coordinates", exact);
  /* phases of one build at one place are one point: the largest existing cluster leads, the rest are listed on it */
  const groups = new Map(), rest = [];
  for (const i of out) {
    if (i.unplaced) { rest.push(i); continue; }
    const k = i.cc + "|" + i.la.toFixed(3) + "," + i.lo.toFixed(3) + "|" + String(i.op).toLowerCase().split(/[^a-z0-9]+/)[0];
    (groups.get(k) || groups.set(k, []).get(k)).push(i);
  }
  const live = (i) => (/^existing$/i.test(i.st || "") && !i.x.superseded_by ? 2 : /^existing$/i.test(i.st || "") ? 1 : 0);
  for (const g of groups.values()) {
    g.sort((a, b) => live(b) - live(a) || (b.x.h100e || 0) - (a.x.h100e || 0));
    const lead = g[0];
    if (g.length > 1) lead.cl = g.slice(1).map((i) => clip(i.nm + (i.st ? " (" + i.st + ")" : ""), 90));
    rest.push(lead);
  }
  log("  epoch gpu points after grouping phases", rest.filter((i) => !i.unplaced).length);
  return rest;
}

function dist(a, b) {
  const R = 6371000, la1 = (a.lat * Math.PI) / 180, la2 = (b.lat * Math.PI) / 180, dl = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* ---------- run ---------- */
const now = new Date().toISOString().slice(0, 16) + "Z";
mkdirSync(OUT, { recursive: true });
const prevIx = existsSync(join(OUT, "index.json")) ? JSON.parse(readFileSync(join(OUT, "index.json"), "utf8")) : { sources: {} };
const prev = {};   // source -> items from the last run, for a source that fails this time
for (const f of existsSync(OUT) ? readdirSync(OUT) : []) {
  if (!/^[a-z]{2,3}\.json$/.test(f)) continue;
  const j = JSON.parse(readFileSync(join(OUT, f), "utf8"));
  for (const i of [...(j.items || []), ...(j.unplaced || []).map((u) => ({ ...u, unplaced: true }))]) (prev[i.s] = prev[i.s] || []).push({ ...i, cc: j.cc });
}
const SRC = {
  osm: { name: "OpenStreetMap", lic: "ODbL", link: "https://www.openstreetmap.org/copyright" },
  wd: { name: "Wikidata", lic: "CC0", link: "https://www.wikidata.org/wiki/Q671224" },
  epochdc: { name: "Epoch AI, Frontier Data Centers", lic: "CC BY 4.0", link: "https://epoch.ai/data/data-centers" },
  epochgpu: { name: "Epoch AI, GPU Clusters", lic: "CC BY 4.0", link: "https://epoch.ai/data/gpu-clusters" },
};
const got = {}, status = {};
async function run(s, f) {
  try { got[s] = await f(); status[s] = { ok: true, at: now, n: got[s].length }; log(s, "ok", got[s].length); }
  catch (e) {
    got[s] = (prev[s] || []).map((i) => ({ ...i }));
    status[s] = { ok: false, at: (prevIx.sources[s] || {}).at || null, n: got[s].length, err: String(e.message || e).slice(0, 120), tried: now };
    log(s, "FAILED", e.message, "- kept", got[s].length, "from the last run");
  }
}
await run("osm", osm);
await run("wd", wikidata);
let gz = null; try { gz = await loadGazetteer(); } catch (e) { log("gazetteer failed", e.message); }
await run("epochdc", () => epochDc(gz));
await run("epochgpu", () => epochGpu(gz));

/* Wikidata sites already mapped in OpenStreetMap */
const osmGrid = new Map();
for (const i of got.osm) { const k = Math.floor(i.la / 0.01) + ":" + Math.floor(i.lo / 0.01); (osmGrid.get(k) || osmGrid.set(k, []).get(k)).push(i); }
const nearOsm = (i) => { const a = Math.floor(i.la / 0.01), b = Math.floor(i.lo / 0.01);
  for (let p = -1; p <= 1; p++) for (let q = -1; q <= 1; q++) for (const o of osmGrid.get(a + p + ":" + (b + q)) || []) if (dist({ lat: i.la, lon: i.lo }, { lat: o.la, lon: o.lo }) < 300) return true; return false; };
const wdKept = got.wd.filter((i) => i.unplaced || !nearOsm(i));
log("wikidata kept", wdKept.length, "of", got.wd.length, "(others already in OpenStreetMap)");

const by = {};
for (const i of [...got.osm, ...wdKept, ...got.epochdc, ...got.epochgpu]) {
  if (!i.cc || !IDS.has(i.cc)) continue;
  const c = (by[i.cc] = by[i.cc] || { items: [], unplaced: [] });
  const { cc, unplaced, ...rest } = i;
  if (unplaced) c.unplaced.push(rest);
  else c.items.push({ ...rest, fp: fp(rest.s, rest.id, rest.la, rest.lo, rest.nm, rest.op) });
}
/* Okinawa is its own area: it shares Japan's points that fall inside it */
const oki = COUNTRIES.find((c) => c.id === "oki");
if (oki && by.jp) by.oki = { items: by.jp.items.filter((i) => i.la >= oki.bounds[0][0] && i.la <= oki.bounds[1][0] && i.lo >= oki.bounds[0][1] && i.lo <= oki.bounds[1][1]), unplaced: [] };

const countries = {};
for (const f of readdirSync(OUT)) if (/^[a-z]{2,3}\.json$/.test(f) && !by[f.slice(0, -5)]) unlinkSync(join(OUT, f));
for (const [cc, c] of Object.entries(by).sort()) {
  const ord = (i) => (i.ai ? 0 : 1);
  c.items.sort((a, b) => ord(a) - ord(b) || String(a.id).localeCompare(String(b.id)));
  writeFileSync(join(OUT, cc + ".json"), JSON.stringify({ v: 1, cc, at: now, items: c.items, unplaced: c.unplaced }));
  countries[cc] = [c.items.length, c.items.filter((i) => i.ai).length, c.unplaced.length];
}
writeFileSync(join(OUT, "index.json"), JSON.stringify({ v: 1, at: now, sources: Object.fromEntries(Object.entries(SRC).map(([k, v]) => [k, { ...v, ...status[k] }])), countries }, null, 1));
const tot = Object.values(countries).reduce((a, c) => [a[0] + c[0], a[1] + c[1], a[2] + c[2]], [0, 0, 0]);
log("countries", Object.keys(countries).length, "points", tot[0], "AI points", tot[1], "unplaced AI", tot[2]);
log("top:", Object.entries(countries).sort((a, b) => b[1][0] - a[1][0]).slice(0, 12).map(([k, v]) => k + " " + v.join("/")).join(", "));
if (!Object.values(status).some((s) => s.ok)) process.exit(1);
