// Stored masts and towers for the Comms tab (assets/osap-comms.js), so a whole country shows at once, by provider, without
// waiting on a live Overpass answer. Run by .github/workflows/refresh-comms-masts.yml, or by hand with Node 20+:
//   node tools/build_comms_masts.mjs [cc ...]   (no codes: countries never built first, then the stalest, until the budget)
//   MASTS_BUDGET_MIN=45 (minutes to spend)  MASTS_MAX_AGE_D=28 (rebuild a country older than this)  MASTS_DEBUG=1
// For each country (the 28 hand-researched first, then every other in data/basemap/world-countries.js) one Overpass query
// by the country's ISO 3166-1 boundary reads every man_made mast, tower and communications_tower; the tab's own rules
// (OSAP_COMMS_LIB.kind) keep the communication ones. A country too big for one answer is asked in bounding-box parts.
//   data/comms/masts/<cc>.json   { cc, at, base, m: [["n123", lat, lon, {tags}], ...] }
//   data/comms/masts/index.json  { v, countries: { th: { at, base, n: {cell, bcast, comm} } } }
// Only the tags the tab reads are kept (names, operator, owner, brand, ref, height, tower type and construction, the
// services carried and radio tags). No phone numbers, e-mails, websites or addresses are stored.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import "../assets/osap-comms.js";

const LIB = globalThis.OSAP_COMMS_LIB;
const OUT = process.env.MASTS_OUT || "data/comms/masts";
const BUDGET = (+process.env.MASTS_BUDGET_MIN || 45) * 60000, MAX_AGE = (+process.env.MASTS_MAX_AGE_D || 28) * 864e5;
const DEBUG = !!process.env.MASTS_DEBUG, T0 = Date.now();
const UA = "AXIOM-OSAP comms mast snapshot (https://github.com/osap-app/osap-app.github.io)";
/* probed 2026-10-01: maps.mail.ru answered mast queries when overpass-api.de did not */
const OVERPASS = ["https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

const KEEP = /^(name|name:en|operator|operator:en|owner|brand|ref|height|man_made|tower:type|tower:construction|construction|structure|material|start_date|ele|communication:.*|.*(frequency|band|channel|technology|generation|antenna|polarisation|erp).*)$/;
const DROP = /^(phone|contact:.*|email|website|url|addr:.*|fax)$/;

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
function query(cc, bbox) {
  const f = bbox ? `(${bbox.flat().map((x) => (+x).toFixed(4)).join(",")})` : "";
  return `[out:json][timeout:${bbox ? 120 : 180}][maxsize:536870912];area["ISO3166-1"="${cc.toUpperCase()}"][admin_level=2]->.a;.a out ids;` +
    `nwr(area.a)${f}["man_made"~"^(mast|tower|communications_tower)$"];out center tags;`;
}
async function fetchCountry(c) {
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
  return part(null, 0);
}
function slim(e) {
  const t = e.tags || {}, lat = e.lat != null ? e.lat : e.center && e.center.lat, lon = e.lon != null ? e.lon : e.center && e.center.lon;
  if (lat == null || lon == null || !LIB.kind(t)) return null;
  const g = {};
  for (const k of Object.keys(t)) if (KEEP.test(k) && !DROP.test(k) && t[k] !== "") g[k] = String(t[k]).slice(0, 120);
  return [e.type.charAt(0) + e.id, +(+lat).toFixed(5), +(+lon).toFixed(5), g];
}
function readJSON(p, d) { try { return JSON.parse(readFileSync(p, "utf8")); } catch (e) { return d; } }

async function main() {
  mkdirSync(OUT, { recursive: true });
  const all = countries(), byId = Object.fromEntries(all.map((c) => [c.id, c]));
  const idx = readJSON(join(OUT, "index.json"), null) || { v: 1, countries: {} };
  const asked = process.argv.slice(2).map((x) => x.toLowerCase()).filter((x) => byId[x]);
  const todo = asked.length ? asked.map((x) => byId[x]) : [
    ...all.filter((c) => !idx.countries[c.id]),
    ...all.filter((c) => idx.countries[c.id] && Date.now() - Date.parse(idx.countries[c.id].at) > MAX_AGE).sort((a, b) => Date.parse(idx.countries[a.id].at) - Date.parse(idx.countries[b.id].at))
  ];
  log(`masts: ${todo.length} countries to build, budget ${Math.round(BUDGET / 60000)} min`);
  let done = 0; const failed = [];
  for (const c of todo) {
    if (Date.now() - T0 > BUDGET) { log("budget spent"); break; }
    const t0 = Date.now();
    try {
      const r = await fetchCountry(c), seen = new Set(), rows = [], n = { cell: 0, bcast: 0, comm: 0 };
      for (const e of r.els) {
        const k0 = e.type + e.id; if (seen.has(k0)) continue; seen.add(k0);
        const row = slim(e); if (!row) continue;
        rows.push(row); n[LIB.kind(row[3])]++;
      }
      rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      const at = new Date().toISOString().slice(0, 19) + "Z";
      writeFileSync(join(OUT, c.id + ".json"), '{"cc":"' + c.id + '","at":"' + at + '","base":' + JSON.stringify(r.base || null) + ',"m":[\n' + rows.map((x) => JSON.stringify(x)).join(",\n") + "\n]}\n");
      idx.countries[c.id] = { at, base: r.base || null, n };
      writeFileSync(join(OUT, "index.json"), JSON.stringify(idx) + "\n");
      done++;
      log(`${c.id} ${c.name}: ${n.cell} phone masts, ${n.bcast} radio/TV, ${n.comm} other, ${Math.round((Date.now() - t0) / 1000)} s`);
    } catch (e) { failed.push(c.id); log(`${c.id} ${c.name}: FAILED ${e.message.slice(0, 200)}`); }
    await sleep(10000);
  }
  log(`masts: built ${done}, failed ${failed.length}${failed.length ? " (" + failed.join(" ") + ")" : ""}; ${Object.keys(idx.countries).length} of ${all.length} countries stored`);
}
main().catch((e) => { console.error(e); process.exit(1); });
