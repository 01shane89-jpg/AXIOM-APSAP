// Live public transport layer, step 1 of 2: finds every keyless public transport vehicle feed and the route names behind it.
//
//   node tools/build_transit_feeds.mjs <outdir>
//
// The list comes from the Mobility Database catalog (MobilityData, https://mobilitydatabase.org, CC0 catalog), which records
// GTFS-Realtime feeds for transit agencies worldwide and whether each needs a key. Only feeds marked "no authentication" with
// vehicle positions are tried; each is asked once, and kept only if it answers with vehicles that reported in the last hour.
// For each kept feed the agency's own timetable (GTFS) is read, only for the route table (routes.txt: route name, bus / tram /
// train / ferry, route colour), from the Mobility Database's hosted copy. Nothing needs an account or a key.
//
// Writes <outdir>/feeds.json (the feeds tools/refresh_transit.mjs asks) and <outdir>/routes/<feed id>.json. Run weekly by
// .github/workflows/refresh-transit.yml and published on the transit-meta branch; nothing is committed to main.
import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";
import { pathToFileURL } from "url";
import { vehicles } from "./gtfsrt.mjs";
import { kindOf, UA, HEADERS, licenceOf } from "./transit_lib.mjs";

const OUT = process.argv[2] || "transit-meta";
const CATALOG = "https://files.mobilitydatabase.org/feeds_v2.csv";
const MAX_RT = 60 << 20, MAX_ZIP = 250 << 20, FRESH = 3600, CONC = 12;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// RFC 4180 CSV (quoted fields, doubled quotes, newlines inside quotes)
export function csv(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const head = rows.shift() || [];
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] || "").trim()])));
}

async function get(url, max, ms) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms || 30000);
  try {
    const r = await fetch(url, { headers: HEADERS, signal: ctl.signal, redirect: "follow" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const len = +r.headers.get("content-length") || 0;
    if (len > max) throw new Error("too big (" + len + " bytes)");
    const chunks = []; let n = 0;
    for await (const c of r.body) { n += c.length; if (n > max) { ctl.abort(); throw new Error("too big"); } chunks.push(c); }
    return { buf: Buffer.concat(chunks), type: r.headers.get("content-type") || "" };
  } catch (e) { throw e && e.name === "AbortError" ? new Error("timed out") : e; } finally { clearTimeout(t); }
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

// routes.txt -> { route_id: [short name, kind, colour, long name] }
export function routesTable(text) {
  const out = {};
  for (const r of csv(text.replace(/^﻿/, ""))) {
    if (!r.route_id) continue;
    const col = /^[0-9a-f]{6}$/i.test(r.route_color || "") ? r.route_color.toUpperCase() : "";
    out[r.route_id.slice(0, 80)] = [(r.route_short_name || "").slice(0, 24), kindOf(+r.route_type), col, (r.route_long_name || "").slice(0, 60)];
  }
  return out;
}

async function main() {
  fs.mkdirSync(path.join(OUT, "routes"), { recursive: true });
  const cat = csv((await get(CATALOG, 80 << 20, 120000)).buf.toString("utf8"));
  console.log("catalog rows", cat.length, "columns", Object.keys(cat[0] || {}).join(" | "));
  const byId = Object.fromEntries(cat.map((r) => [r.id, r]));
  const rt = cat.filter((r) => r.data_type === "gtfs_rt" && /(^|\|)vp(\||$)/.test(r.entity_type || "") && r["urls.direct_download"] &&
    (r["urls.authentication_type"] || "0") === "0" && !/deprecated|inactive/i.test(r.status || ""));
  // the catalog sometimes lists one URL twice (official and community entries): ask each URL once
  const seen = new Set(), cand = rt.filter((r) => { const u = r["urls.direct_download"]; if (seen.has(u)) return false; seen.add(u); return /^https?:\/\//.test(u); });
  console.log("keyless vehicle-position feeds in the catalog", cand.length);
  const kept = [], now = Date.now() / 1000, tally = {};
  await pool(cand, CONC, async (r) => {
    const u = r["urls.direct_download"];
    let why = "";
    try {
      const { buf, type } = await get(u, MAX_RT, 30000);
      if (buf[0] === 0x7b || buf[0] === 0x3c) throw new Error("not protobuf (" + type + ")");
      const { ts, list } = vehicles(buf);
      const fresh = list.filter((v) => (v.ts || ts || 0) > now - FRESH);
      if (!fresh.length) throw new Error(list.length ? list.length + " vehicles, none recent" : "no vehicles");
      const routed = fresh.filter((v) => v.route).length;
      kept.push({ row: r, n: fresh.length, routed });
      why = "ok " + fresh.length;
    } catch (e) { why = String(e && e.message || e).slice(0, 80); }
    const k = why.startsWith("ok") ? "ok" : why.replace(/\d+/g, "N");
    tally[k] = (tally[k] || 0) + 1;
    console.log((r["location.country_code"] || "--").padEnd(3), r.id.padEnd(10), why, "·", u.slice(0, 100));
  });
  console.log("results", JSON.stringify(tally));
  const feeds = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gtfs-"));
  kept.sort((a, b) => a.row.id.localeCompare(b.row.id, "en", { numeric: true }));
  await pool(kept, 4, async ({ row: r, n, routed }) => {
    const id = r.id.replace(/[^A-Za-z0-9_-]/g, "");
    const f = { id, name: (r.provider || r.name || id).slice(0, 120), feed: (r.name || "").slice(0, 80), cc: (r["location.country_code"] || "").toUpperCase().slice(0, 2),
      place: [r["location.municipality"], r["location.subdivision_name"]].filter(Boolean).join(", ").slice(0, 80),
      url: r["urls.direct_download"], licence: licenceOf(r["urls.license"]), licence_url: /^https:\/\//.test(r["urls.license"] || "") ? r["urls.license"] : "",
      catalog: "https://mobilitydatabase.org/feeds/gtfs_rt/" + encodeURIComponent(r.id), n, routes: 0, kinds: {} };
    // static_reference can list several timetables; take the first that has a hosted copy
    for (const sid of (r.static_reference || "").split(/[|;, ]+/).filter(Boolean)) {
      const s = byId[sid], zipUrl = s && (s["urls.latest"] || s["urls.direct_download"]);
      if (!zipUrl || !/^https?:\/\//.test(zipUrl)) continue;
      const zp = path.join(tmp, id + ".zip");
      try {
        fs.writeFileSync(zp, (await get(zipUrl, MAX_ZIP, 180000)).buf);
        const listing = execFileSync("unzip", ["-Z1", zp], { maxBuffer: 16 << 20 }).toString().split("\n");
        const name = listing.find((x) => /(^|\/)routes\.txt$/i.test(x.trim()));
        if (!name) throw new Error("no routes.txt");
        const table = routesTable(execFileSync("unzip", ["-p", zp, name.trim()], { maxBuffer: 64 << 20 }).toString("utf8"));
        const keys = Object.keys(table);
        if (!keys.length) throw new Error("empty routes.txt");
        for (const k of keys) f.kinds[table[k][1]] = (f.kinds[table[k][1]] || 0) + 1;
        f.routes = keys.length; f.static = zipUrl;
        fs.writeFileSync(path.join(OUT, "routes", id + ".json"), JSON.stringify(table));
        break;
      } catch (e) { console.log("  timetable", id, sid, String(e && e.message || e).slice(0, 80)); }
      finally { try { fs.unlinkSync(zp); } catch {} }
    }
    console.log("feed", f.cc, id, f.n, "vehicles,", routed, "with route,", f.routes, "routes", JSON.stringify(f.kinds));
    feeds.push(f);
  });
  feeds.sort((a, b) => a.cc.localeCompare(b.cc) || a.id.localeCompare(b.id, "en", { numeric: true }));
  const total = feeds.reduce((s, f) => s + f.n, 0);
  fs.writeFileSync(path.join(OUT, "feeds.json"), JSON.stringify({ schema: "osap-transit-feeds/1", built: new Date().toISOString(),
    catalog: CATALOG, tried: cand.length, feeds }, null, 1));
  console.log("kept", feeds.length, "feeds,", total, "vehicles at probe time,", new Set(feeds.map((f) => f.cc)).size, "countries");
  if (!feeds.length) process.exit(1);
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] || "")).href) main().catch((e) => { console.error(e); process.exit(1); });
