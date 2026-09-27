// Place-name gazetteer for the refresh jobs: GeoNames populated places of 15,000 people or more (cities15000, CC BY 4.0)
// and first-level regions (admin1CodesASCII). A region has no point of its own in GeoNames, so it is placed at the
// population-weighted centre of its listed towns; items placed that way say so and carry precision "province".
// placeIn(text, ccs) finds the first place a text names inside one of the given countries:
//   { name, lat, lon, prec: "approx" (a city or town centre) | "province" (a region's rough centre), kind, basis }
// It never guesses across borders, and returns null rather than a weak match. Okinawa (oki) is its own area: only places in
// Okinawa Prefecture pin there, so an Okinawa story that names Tokyo is not pinned in Tokyo on the Okinawa map.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ccFromA2, COUNTRIES } from "./geo_cc.mjs";

const UA = "Mozilla/5.0 (AXIOM-OSAP refresh; gazetteer)";
async function fetchBuf(url, ms = 60000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { signal: ctl.signal, headers: { "user-agent": UA } }); if (!r.ok) throw new Error("HTTP " + r.status); return Buffer.from(await r.arrayBuffer()); }
  finally { clearTimeout(t); }
}
// Words that are also place names but far more often ordinary words in a headline.
const STOP = new Set(["police", "mobile", "split", "nice", "reading", "bath", "hope", "union", "university", "independence", "liberty", "victory",
  "progress", "unity", "concord", "industry", "commerce", "enterprise", "opportunity", "republic", "federal", "central", "national", "capital",
  "north", "south", "east", "west", "centre", "center", "island", "islands", "city", "state", "regional", "general", "president", "media",
  "sale", "male", "best", "mango", "banana", "batman", "man", "gay", "rich", "along", "bar", "bay", "cork", "deal", "march", "may", "june", "july",
  "august", "orange", "gold", "golden", "silver", "royal", "grand", "delta", "sierra", "santa", "san", "saint", "port", "fort", "lake", "river"]);
const COUNTRY_NAMES = new Set(COUNTRIES.map((c) => c.name.toLowerCase()));

let LOADED = null;
export function loadGazetteer(get = fetchBuf) {
  if (LOADED) return LOADED;
  LOADED = (async () => {
    const zip = await get("https://download.geonames.org/export/dump/cities15000.zip");
    const tmp = path.join(os.tmpdir(), "osap-cities15000.zip"); fs.writeFileSync(tmp, zip);   // unzip cannot read an archive from stdin
    const r = spawnSync("unzip", ["-p", tmp, "cities15000.txt"], { maxBuffer: 96e6 });
    const txt = r.stdout && r.stdout.length ? r.stdout.toString("utf8") : "";
    if (!txt) throw new Error("gazetteer unzip failed");
    let adm = "";
    try { adm = (await get("https://download.geonames.org/export/dump/admin1CodesASCII.txt")).toString("utf8"); } catch (e) {}
    const byCc = {}, regions = {};   // cc -> Map(lower name -> place)
    const put = (cc, name, p) => {
      const k = name.toLowerCase();
      if (name.length < 4 || STOP.has(k) || COUNTRY_NAMES.has(k) || !/^\p{Lu}/u.test(name)) return;
      const m = (byCc[cc] = byCc[cc] || new Map()), prev = m.get(k);
      // A name that is both a region and a town (Okinawa, Kharkiv) means the town only when the town is that region's seat;
      // otherwise the region wins, with its coarser precision, because the text cannot say which is meant.
      if (!prev || (p.kind === "city" && prev.kind === "city" && p.pop > prev.pop)) m.set(k, p);
      else if (p.kind === "region" && prev.kind === "city" && !prev.seat) m.set(k, p);
      else if (p.kind === "city" && prev.kind === "region" && p.seat) m.set(k, p);
    };
    for (const line of txt.split("\n")) {
      const f = line.split("\t"); if (f.length < 15) continue;
      const cc = ccFromA2(f[8]); if (!cc) continue;
      const p = { name: f[1], lat: +f[4], lon: +f[5], pop: +f[14] || 0, kind: "city", cap: f[7] === "PPLC", seat: f[7] === "PPLA" || f[7] === "PPLC" };
      for (const n of new Set([f[1], f[2]])) { put(cc, n, p); if (f[8] === "JP" && f[10] === "47") put("oki", n, p); }   // Okinawa Prefecture is JP.47
      if (f[10]) { const k = f[8] + "." + f[10], g = (regions[k] = regions[k] || { w: 0, la: 0, lo: 0 }), w = Math.max(p.pop, 1); g.w += w; g.la += p.lat * w; g.lo += p.lon * w; }
    }
    for (const line of adm.split("\n")) {
      const f = line.split("\t"); if (f.length < 3) continue;
      const g = regions[f[0]], cc = ccFromA2(f[0].split(".")[0]); if (!g || !cc) continue;
      const p = { name: f[2] || f[1], lat: g.la / g.w, lon: g.lo / g.w, pop: 0, kind: "region" };
      // both "Kharkiv Oblast" (always the region) and the bare "Kharkiv" (the region unless a town of that name is its seat)
      const suf = /\s+(Province|Region|Governorate|State|Oblast|District|Division|Prefecture|Department)$/i;
      for (const n of new Set([f[1], f[2], f[1].replace(suf, ""), f[2].replace(suf, "")])) put(f[0] === "JP.47" ? "oki" : cc, n, p);
    }
    const idx = {};
    for (const [cc, m] of Object.entries(byCc)) {
      const names = [...m.keys()].sort((a, b) => b.length - a.length).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      idx[cc] = { m, re: new RegExp("(?<![\\p{L}\\p{N}])(" + names.join("|") + ")(?![\\p{L}\\p{N}])", "giu") };
    }
    return idx;
  })();
  return LOADED;
}
// The first city a text names (by position) wins; a region is used only when no city in those countries is named.
// Matches must start with a capital letter in the text itself, so "nice weather" is not Nice.
export function placeIn(gz, text, ccs) {
  if (!gz || !text) return null;
  let best = null;
  for (const cc of ccs) {
    const g = gz[cc]; if (!g) continue;
    g.re.lastIndex = 0;
    for (const m of text.matchAll(g.re)) {
      if (!/^\p{Lu}/u.test(m[1])) continue;
      const p = g.m.get(m[1].toLowerCase()); if (!p) continue;
      const cand = { ...p, cc, at: m.index };
      if (!best || (cand.kind === "city" && best.kind !== "city") || (cand.kind === best.kind && cand.at < best.at)) best = cand;
      if (p.kind === "city") break;
    }
  }
  if (!best) return null;
  return { name: best.name, lat: +best.lat.toFixed(3), lon: +best.lon.toFixed(3), prec: best.kind === "city" ? "approx" : "province", kind: best.kind,
    basis: best.kind === "city" ? "GeoNames town or city centre, named in the text" : "rough centre of a GeoNames region named in the text" };
}
