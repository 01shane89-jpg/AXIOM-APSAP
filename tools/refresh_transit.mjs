// Live public transport layer, step 2 of 2: asks every feed found by tools/build_transit_feeds.mjs for its vehicles and writes
// one small JSON file per 5° x 5° map cell, like the live air traffic layer.
//
//   node tools/refresh_transit.mjs <meta dir> <outdir> [previous outdir]
//
// Feeds are GTFS-Realtime vehicle positions published by transit agencies with no key. Most do not let another site read them
// (no CORS, and protobuf), so .github/workflows/refresh-transit.yml runs this every few minutes and publishes the files on
// the live-transit branch, which the page reads from raw.githubusercontent.com. A feed that fails keeps its last vehicles
// until they are CARRY old, so one slow agency server does not blank a city. Each vehicle keeps its own report time.
// What this is: positions buses, trams, trains and ferries report to their agency, as published, a few minutes old on the map.
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { vehicles } from "./gtfsrt.mjs";
import { HEADERS, isNc } from "./transit_lib.mjs";

const META = process.argv[2] || "transit-meta", OUT = process.argv[3] || "transit-out", PREV = process.argv[4] || OUT;
const CELL = 5, MAX_AGE = 1800, CARRY = 1800, CONC = 16, MAX_RT = 60 << 20;
export const FIELDS = ["s", "id", "lat", "lon", "brg", "spd", "ts", "rid", "rt", "rn", "k", "col", "st"];

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } }
async function get(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(url, { headers: HEADERS, signal: ctl.signal, redirect: "follow" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const chunks = []; let n = 0;
    for await (const c of r.body) { n += c.length; if (n > MAX_RT) { ctl.abort(); throw new Error("too big"); } chunks.push(c); }
    return Buffer.concat(chunks);
  } catch (e) { throw e && e.name === "AbortError" ? new Error("no answer in 25 s") : e; } finally { clearTimeout(t); }
}
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}
export const cellOf = (lat, lon) => Math.floor(lat / CELL) * CELL + "_" + Math.floor(lon / CELL) * CELL;
const kmh = (ms) => (typeof ms === "number" && isFinite(ms) && ms >= 0 && ms < 150 ? Math.round(ms * 3.6) : null);
const deg = (b) => (typeof b === "number" && isFinite(b) && b >= 0 && b <= 360 ? Math.round(b) % 360 : null);

// one vehicle as a fixed-order row (names in the index's "f" list)
export function row(v, si, table, onlyKind, headTs) {
  const r = (v.route && table && table[v.route]) || null;
  const ts = v.ts || headTs || null;
  return [si, (v.lab || v.id || "").slice(0, 40), +v.lat.toFixed(5), +v.lon.toFixed(5), deg(v.brg), kmh(v.spd), ts,
    v.route || null, r ? r[0] || null : null, r ? r[3] || null : null, r ? r[1] : onlyKind || "o", r && r[2] ? r[2] : null,
    v.st === 0 || v.st === 1 || v.st === 2 ? v.st : null];
}

async function main() {
  const meta = readJson(path.join(META, "feeds.json"));
  if (!meta || meta.schema !== "osap-transit-feeds/1" || !Array.isArray(meta.feeds)) throw new Error("no feed list in " + META);
  const feeds = meta.feeds, now = Math.floor(Date.now() / 1000), t0 = Date.now();
  const prevIdx = readJson(path.join(PREV, "index.json"));
  const sources = feeds.map((f) => ({ id: f.id, name: f.name, feed: f.feed, cc: f.cc, place: f.place, licence: f.licence, licence_url: f.licence_url,
    nc: isNc(f.licence), catalog: f.catalog }));
  const sIdx = Object.fromEntries(sources.map((s, i) => [s.id, i]));
  const rows = [], status = {}, failed = new Set();
  await pool(feeds, CONC, async (f) => {
    const si = sIdx[f.id];
    try {
      const { ts, list } = vehicles(await get(f.url));
      const table = readJson(path.join(META, "routes", f.id + ".json"));
      const ks = Object.keys(f.kinds || {}), only = ks.length === 1 ? ks[0] : null;
      let n = 0;
      for (const v of list) {
        const r = row(v, si, table, only, ts);
        if (r[6] && (r[6] < now - MAX_AGE || r[6] > now + 600)) continue;
        rows.push(r); n++;
      }
      status[f.id] = [n, ""];
    } catch (e) {
      failed.add(f.id);
      status[f.id] = [0, String(e && e.message || e).slice(0, 80)];
    }
  });
  // carry forward vehicles of feeds that failed this time, until their own report is CARRY old
  let carried = 0;
  if (prevIdx && prevIdx.schema === "osap-transit/1" && Array.isArray(prevIdx.sources) && failed.size) {
    const map = prevIdx.sources.map((s) => (failed.has(s.id) ? sIdx[s.id] : undefined));
    for (const k of Object.keys(prevIdx.cells || {})) {
      const c = readJson(path.join(PREV, "v", k + ".json"));
      if (!c || !Array.isArray(c.v)) continue;
      for (const r of c.v) {
        const si = map[r[0]];
        if (si === undefined || !r[6] || r[6] < now - CARRY) continue;
        r[0] = si; rows.push(r); carried++;
        status[sources[si].id][0]++;
      }
    }
  }
  const cells = {};
  for (const r of rows) (cells[cellOf(r[2], r[3])] ||= []).push(r);
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, "v"), { recursive: true });
  const built = new Date().toISOString(), counts = {};
  for (const [k, v] of Object.entries(cells)) {
    fs.writeFileSync(path.join(OUT, "v", k + ".json"), JSON.stringify({ schema: "osap-transit-cell/1", built, cell: k, v }));
    counts[k] = v.length;
  }
  const ok = feeds.filter((f) => !failed.has(f.id)).length;
  fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify({ schema: "osap-transit/1", built, cell: CELL, f: FIELDS, sources,
    status, feeds_ok: ok, feeds_failed: failed.size, carried, total: rows.length, took_s: Math.round((Date.now() - t0) / 1000),
    meta_built: meta.built, cells: counts }));
  console.log(`${built} ${rows.length} vehicles (${carried} carried) from ${ok}/${feeds.length} feeds in ${Math.round((Date.now() - t0) / 1000)} s, ${Object.keys(cells).length} cells`);
  if (!ok) process.exit(1);
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] || "")).href) main().catch((e) => { console.error(e); process.exit(1); });
