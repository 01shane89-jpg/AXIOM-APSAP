// Place-name gazetteer for the refresh jobs: GeoNames populated places of 15,000 people or more (cities15000, CC BY 4.0)
// and first-level regions (admin1CodesASCII). A region has no point of its own in GeoNames, so it is placed at the
// population-weighted centre of its listed towns; items placed that way say so and carry precision "province".
// placeIn(text, ccs) finds the first place a text names inside one of the given countries:
//   { name, lat, lon, prec: "approx" (a city or town centre) | "province" (a region's rough centre), kind, basis }
// It never guesses across borders, and returns null rather than a weak match. Okinawa (oki) is its own area: only places in
// Okinawa Prefecture pin there, so an Okinawa story that names Tokyo is not pinned in Tokyo on the Okinawa map.
// When unsure it leaves the story unplaced: a town whose name is also a much larger city in another country or a foreign
// country's capital (Paris, Texas) counts only when the text also names the town's own region, a town outside a region the
// text names is not used (a Hawaii story that says "Hurricane" is not pinned in Hurricane, Utah), and a text that names
// two or more regions and no usable town is not pinned at all.
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
  "august", "orange", "gold", "golden", "silver", "royal", "grand", "delta", "sierra", "santa", "san", "saint", "port", "fort", "lake", "river",
  // weather and hazard words that are also town names (Hurricane, Utah; Storm Lake; Flood, Virginia)
  "hurricane", "storm", "typhoon", "cyclone", "tornado", "twister", "flood", "floods", "rain", "snow", "fire", "wildfire", "blizzard", "thunder",
  "lightning", "surge", "tsunami", "quake", "earthquake", "volcano", "drought", "heat", "frost", "winter", "summer", "spring", "autumn",
  // other everyday headline words that are also towns
  "police", "army", "navy", "liberal", "paradise", "eureka", "hazard", "security", "justice", "freedom", "harmony", "friendship", "welcome",
  "mission", "temple", "church", "castle", "market", "garden", "gardens", "bridge", "beach", "valley", "canyon", "mountain", "harbour", "harbor",
  "whites", "blacks", "nations", "america", "europe", "africa", "asia", "pacific", "atlantic", "arctic", "alliance", "senate", "congress",
  "parliament", "court", "crown", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "christmas", "easter"]);
const COUNTRY_NAMES = new Set(COUNTRIES.map((c) => c.name.toLowerCase()));

let LOADED = null, WORLD = null;
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
    const byCc = {}, regions = {}, regsBy = {};   // cc -> Map(lower name -> place); regsBy: cc -> Map(admin-1 code -> region)
    const world = WORLD = new Map();  // lower name -> every town of that name, in any country (to spot ambiguous names)
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
      const p = { name: f[1], lat: +f[4], lon: +f[5], pop: +f[14] || 0, kind: "city", cap: f[7] === "PPLC", seat: f[7] === "PPLA" || f[7] === "PPLC",
        a1: f[10] ? f[8] + "." + f[10] : "" };
      for (const n of new Set([f[1], f[2]])) { const k = n.toLowerCase(), o = world.get(k) || []; o.push({ cc, pop: p.pop, cap: p.cap }); world.set(k, o); }
      for (const n of new Set([f[1], f[2]])) { put(cc, n, p); if (f[8] === "JP" && f[10] === "47") put("oki", n, p); }   // Okinawa Prefecture is JP.47
      if (f[10]) { const k = f[8] + "." + f[10], g = (regions[k] = regions[k] || { w: 0, la: 0, lo: 0 }), w = Math.max(p.pop, 1); g.w += w; g.la += p.lat * w; g.lo += p.lon * w; }
    }
    for (const line of adm.split("\n")) {
      const f = line.split("\t"); if (f.length < 3) continue;
      const g = regions[f[0]], cc = ccFromA2(f[0].split(".")[0]); if (!g || !cc) continue;
      const p = { name: f[2] || f[1], lat: g.la / g.w, lon: g.lo / g.w, pop: 0, kind: "region", a1: f[0] };
      (regsBy[cc] = regsBy[cc] || new Map()).set(f[0], p);
      // both "Kharkiv Oblast" (always the region) and the bare "Kharkiv" (the region unless a town of that name is its seat)
      const suf = /\s+(Province|Region|Governorate|State|Oblast|District|Division|Prefecture|Department)$/i;
      for (const n of new Set([f[1], f[2], f[1].replace(suf, ""), f[2].replace(suf, "")])) put(f[0] === "JP.47" ? "oki" : cc, n, p);
    }
    const idx = {};
    for (const [cc, m] of Object.entries(byCc)) {
      const names = [...m.keys()].sort((a, b) => b.length - a.length).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      // a town is ambiguous when a place of the same name elsewhere is another country's capital, or a city of a million
      // or more at least three times its size (Paris, Texas; Athens, Georgia; San Antonio, Chile). A capital is ambiguous
      // only against another capital.
      for (const p of m.values()) if (p.kind === "city" && !p.amb)
        p.amb = (world.get(p.name.toLowerCase()) || []).some((o) => o.cc !== cc && (o.cap || (!p.cap && o.pop >= 1e6 && o.pop >= 3 * p.pop)));
      idx[cc] = { m, regs: regsBy[cc] || new Map(), re: new RegExp("(?<![\\p{L}\\p{N}])(" + names.join("|") + ")(?![\\p{L}\\p{N}])", "giu") };
    }
    return idx;
  })();
  return LOADED;
}
// Matches must start with a capital letter in the text itself, so "nice weather" is not Nice. Among the towns a text names
// (first by position wins), a town counts only if it lies in a region the text also names, or the text names no region and
// the town's name is not ambiguous (see loadGazetteer). With no usable town, a single named region is used; two or more
// named regions, or none, leave the text unplaced.
// A wire dateline names where the reporter filed, not where the story happened: "SEOUL, Sept. 30 (Yonhap) --", "(Seoul = Yonhap)",
// "MANILA (AP) —", "BANGKOK --", "MANILA, Philippines-The". Its words are blanked before places are read, so a Seoul dateline on a Yongbyon story is not a
// Seoul pin. The same patterns are in index.html (DATELINE), for items placed in the browser and items placed before this rule.
const AGENCY = "Reuters|AP|AFP|Yonhap|Xinhua|Bernama|Kyodo|Jiji|ANI|PTI|IANS|UNI|dpa|EFE|Antara|ANTARA|PNA|VNA|TASS|RIA|Anadolu|AA|KCNA|UPI|Lusa|ANSA|Sputnik|WAM|SPA|BSS|APP|IRNA|IPS|CNA|NNA";
export const DATELINE = [
  /\([^()=\n]{2,40}=[^()=\n]{2,40}\)/gu,
  new RegExp("(^|\\n)[ \\t]*[^\\n()]{0,60}?\\((?:" + AGENCY + ")\\)\\s*(?:--|[-\u2013\u2014:])", "gu"),
  /(^|\n)[ \t]*\p{Lu}[\p{Lu} .'-]{2,30}(?:,[^\n\u2013\u2014-]{0,30})?\s*(?:--|[\u2013\u2014]|-(?=\s)|(?<=\s)-)/gu,
  // "MANILA, Philippines-The ...": no space either side of the dash, only after a "PLACE, Country" dateline
  /(^|\n)[ \t]*\p{Lu}[\p{Lu} .'-]{2,30},[^\n\u2013\u2014-]{1,30}-(?=\p{Lu})/gu,
  // "ILOCOS SUR-A 56-year-old ...", "PAMPANGA-Isang ...": a provincial dateline in capitals, the dash straight before the first word
  /(^|\n)[ \t]*\p{Lu}{3,}(?: \p{Lu}{2,}){0,3}-(?=\p{Lu}\p{Ll}|\p{Lu} )/gu,
];
export function stripDatelines(text) {
  let t = String(text || "");
  for (const re of DATELINE) t = t.replace(re, (m, lead) => (typeof lead === "string" ? lead : "") + " ".repeat(m.length - (typeof lead === "string" ? lead.length : 0)));
  return t;
}
// Every town and region a text names in those countries (for placeIn and tools/probe_placement.mjs), datelines left out.
export function namesIn(gz, text, ccs) {
  const towns = [], regs = [], smalls = [];
  if (!gz || !text) return { towns, regs, smalls };
  text = stripDatelines(text);
  for (const cc of ccs) {
    const g = gz[cc]; if (!g) continue;
    g.re.lastIndex = 0;
    for (const m of text.matchAll(g.re)) {
      if (!/^\p{Lu}/u.test(m[1])) continue;
      const p = g.m.get(m[1].toLowerCase()); if (!p) continue;
      (p.kind === "city" ? towns : regs).push({ ...p, cc, at: m.index });
    }
    // villages and small towns (addSmallPlaces), only where a town or region of the same name does not already match
    if (g.sre) {
      g.sre.lastIndex = 0;
      for (const m of text.matchAll(g.sre)) {
        if (!/^\p{Lu}/u.test(m[1])) continue;
        const e = g.sm.get(m[1].toLowerCase()); if (!e) continue;
        smalls.push({ ...e, cc, at: m.index, end: m.index + m[1].length, ctx: SMALL_CTX_BEFORE.test(text.slice(Math.max(0, m.index - 40), m.index)) || SMALL_CTX_AFTER.test(text.slice(m.index + m[1].length, m.index + m[1].length + 25)) });
      }
    }
  }
  return { towns, regs, smalls };
}
export function placeIn(gz, text, ccs) {
  if (!gz || !text) return null;
  const { towns, regs, smalls } = namesIn(gz, text, ccs);
  const named = new Set(regs.map((r) => r.a1));
  // a village or small town counts only when the text also names its region (the one of that name in that region), or when the
  // text names no region, its name is found nowhere else, and the words round it say it is a place ("in X", "X village")
  const small = smalls.map((s) => {
    if (named.size) { const c = s.cands.filter((x) => named.has(x.a1)); return c.length === 1 ? { ...c[0], at: s.at } : null; }
    return !s.amb && s.ctx ? { ...s.cands[0], at: s.at } : null;
  }).filter(Boolean);
  const ok = towns.filter((t) => (named.size ? named.has(t.a1) : !t.amb)).concat(small).sort((a, b) => a.at - b.at);
  let best = ok[0] || null;
  if (!best && named.size === 1) best = regs.sort((a, b) => a.at - b.at)[0];
  if (!best) return null;
  return { name: best.name, lat: +best.lat.toFixed(3), lon: +best.lon.toFixed(3), prec: best.kind === "region" ? "province" : "approx", kind: best.kind, a1: best.a1,
    basis: best.kind === "city" ? "GeoNames town or city centre, named in the text" : best.kind === "small" ? "GeoNames village or small town centre (1,000 people or more), named in the text"
      : "rough centre of a GeoNames region named in the text" };
}

// Villages and small towns for the conflict tabs, where fighting is mostly reported by village: GeoNames populated places of 1,000
// people or more (cities1000, CC BY 4.0), added to an index from loadGazetteer() for the given countries only. They are held apart
// from the towns and used more strictly (placeIn): a name a town or region already has, a name shorter than five letters, a stop
// word, or a name found in another country or more than once in the same one, never counts on its own. The download (about 10 MB)
// is kept in cacheDir for up to a week when one is given. Returns the number of names added.
const SMALL_URL = "https://download.geonames.org/export/dump/cities1000.zip";
const SMALL_CTX_BEFORE = /(?:^|[^\p{L}])(?:in|at|near|outside|around|into|towards?|from|of|on|village|town|township|settlement|district|hamlet)\s+(?:the\s+)?(?:(?:village|town|township|settlement|district|hamlet|area)\s+(?:of\s+)?)?$/iu;
const SMALL_CTX_AFTER = /^\s+(?:village|town|township|settlement|district|hamlet|area)(?![\p{L}])/iu;
export async function addSmallPlaces(idx, ccs, get = fetchBuf, cacheDir = process.env.GEONAMES_CACHE || "") {
  const want = new Set(ccs), file = cacheDir ? path.join(cacheDir, "cities1000.zip") : "";
  let zip = null;
  try { if (file && Date.now() - fs.statSync(file).mtimeMs < 7 * 864e5) zip = fs.readFileSync(file); } catch (e) {}
  if (!zip) { zip = await get(SMALL_URL, 120000); if (file) try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(file, zip); } catch (e) {} }
  const tmp = path.join(os.tmpdir(), "osap-cities1000.zip"); fs.writeFileSync(tmp, zip);
  const r = spawnSync("unzip", ["-p", tmp, "cities1000.txt"], { maxBuffer: 256e6 });
  const txt = r.stdout && r.stdout.length ? r.stdout.toString("utf8") : "";
  if (!txt) throw new Error("small places unzip failed");
  const byCc = {}, seen = new Map();   // seen: lower name -> countries it is found in (any country)
  for (const line of txt.split("\n")) {
    const f = line.split("\t"); if (f.length < 15) continue;
    const cc = ccFromA2(f[8]); if (!cc) continue;
    const names = new Set([f[1], f[2]].flatMap((n) => [n, n.replace(/-/g, " "), n.replace(/ /g, "-")]));
    for (const n of names) { const k = n.toLowerCase(), o = seen.get(k) || new Set(); o.add(cc); seen.set(k, o); }
    if (!want.has(cc) || !idx[cc]) continue;
    const p = { name: f[1], lat: +f[4], lon: +f[5], pop: +f[14] || 0, kind: "small", a1: f[10] ? f[8] + "." + f[10] : "" };
    const m = (byCc[cc] = byCc[cc] || new Map());
    for (const n of names) {
      const k = n.toLowerCase();
      if (n.length < 5 || STOP.has(k) || COUNTRY_NAMES.has(k) || !/^\p{Lu}/u.test(n) || idx[cc].m.has(k)) continue;
      const e = m.get(k) || { cands: [] };
      if (!e.cands.some((x) => x.lat === p.lat && x.lon === p.lon)) e.cands.push(p);
      m.set(k, e);
    }
  }
  let added = 0;
  for (const [cc, m] of Object.entries(byCc)) {
    for (const [k, e] of m) {
      const big = (WORLD && WORLD.get(k)) || [];
      e.amb = e.cands.length > 1 || (seen.get(k) || new Set()).size > 1 || big.some((o) => o.cc !== cc);
    }
    const names = [...m.keys()].sort((a, b) => b.length - a.length).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!names.length) continue;
    idx[cc].sm = m; idx[cc].sre = new RegExp("(?<![\\p{L}\\p{N}])(" + names.join("|") + ")(?![\\p{L}\\p{N}])", "giu");
    added += m.size;
  }
  return added;
}
