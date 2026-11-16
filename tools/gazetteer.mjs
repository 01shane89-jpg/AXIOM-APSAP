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
import { ccFromA2, ccFromName, ccsInText, COUNTRIES } from "./geo_cc.mjs";

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
  "parliament", "court", "crown",
  // oil-market words that are also towns: "Brent crude" is not Brent, Florida (Iran war audit 2026-11-16)
  "brent",
  // headline words that are also US towns, read wrongly in Iran war reports (audit 2026-11-16): "Airport", "Surprise strike", "Supreme Leader"
  "airport", "surprise", "supreme", "english", "oracle", "hercules", "summit", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "christmas", "easter"]);
// Accents folded, so a region spelled like its own country in the local language ("México" state, "Panamá" province) is not
// read when a text names the country: Spanish headlines saying "México" were pinned on the State of Mexico (audit 2026-11-14).
const fold = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const COUNTRY_NAMES = new Set(COUNTRIES.map((c) => fold(c.name)));
const isCountryName = (k) => COUNTRY_NAMES.has(fold(k));

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
      if (name.length < 4 || STOP.has(k) || isCountryName(k) || !/^\p{Lu}/u.test(name)) return;
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
      let capital = null; for (const p of m.values()) if (p.kind === "city" && p.cap && (!capital || p.pop > capital.pop)) capital = p;
      idx[cc] = { m, capital, regs: regsBy[cc] || new Map(), re: new RegExp("(?<![\\p{L}\\p{N}])(" + names.join("|") + ")(?![\\p{L}\\p{N}])", "giu") };
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
// A capital followed by a speech or stance verb names a government, not a place ("Tehran warns", "Washington says it shot down").
// Iran war audit 2026-11-16: 27 Bahrain reports were pinned in Tehran and 11 in Washington this way.
export const METONYM_AFTER = /^\s+(?:says?|said|claims?|claimed|warns?|warned|denies|denied|accuses|accused|rejects?|rejected|urges?|urged|condemns?|condemned|vows?|vowed|threatens?|threatened|responds?|responded|insists?|insisted|confirms?|confirmed|announces?|announced|demands?|demanded|blames?|blamed|signals?|signalled|signaled|reaffirms?|reaffirmed|repeats?|repeated|retaliates?|retaliated|calls|called|tells|told|hits back|pushes|pushed|offers?|offered|agrees?|agreed|refuses?|refused|seeks?|sought)(?![\p{L}])/iu;
// true when every mention of name in the text is such a stand-in for a government (a pin from an older rule can then be dropped)
export function metonymOnly(text, name) {
  const t = stripDatelines(text), n = String(name || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!n) return false;
  const hits = [...t.matchAll(new RegExp("(?<![\\p{L}\\p{N}])" + n + "(?![\\p{L}\\p{N}])", "giu"))];
  return hits.length > 0 && hits.every((m) => METONYM_AFTER.test(t.slice(m.index + m[0].length, m.index + m[0].length + 30)));
}
// Named sites of one conflict (tools/conflict_extras/<id>-places.json entries that list aliases): a text that names one is placed
// on that site, before any town. sites: [{ name, lat, lon, aliases: [..] }]. Returns { name, lat, lon, prec: "site", kind, basis } or null.
// A site marked weak (a strait, a sea area) is used only when the text names no town or region ("tanker hit off Fujairah in the
// Strait of Hormuz" stays at Fujairah): the matcher's .weak(text) gives those.
export function siteMatcher(sites) {
  const all = (sites || []).filter((x) => x && isFinite(x.lat) && isFinite(x.lon) && (x.aliases || []).length).map((x) => ({ ...x,
    re: new RegExp("(?<![\\p{L}\\p{N}])(?:" + x.aliases.map((a) => String(a).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[\s-]+/g, "[\\s-]+")).join("|") + ")(?![\\p{L}\\p{N}])", "iu") }));
  const find = (list) => (text) => {
    const t = stripDatelines(text || ""); let best = null, at = Infinity;
    for (const x of list) { const m = x.re.exec(t); if (m && m.index < at) { at = m.index; best = x; } }
    return best ? { name: best.name, lat: +(+best.lat).toFixed(5), lon: +(+best.lon).toFixed(5), prec: "site", kind: "site", basis: "A named site of this conflict (curated list), named in the text" } : null;
  };
  const strong = find(all.filter((x) => !x.weak)), weak = find(all.filter((x) => x.weak));
  strong.weak = weak;
  return strong;
}
// Last resort for a conflict tab: a text that names exactly one of the given countries (and no town or region placed it) is shown
// at that country's capital with precision "country", drawn as a rough ring, so a report that only says "Bahrain" is still on the
// map. Countries in skip (the warring parties, named in nearly every report) never count. Returns null otherwise.
export function placeCountry(gz, text, ccs, skip = []) {
  if (!gz || !text) return null;
  const named = ccsInText(stripDatelines(text)).filter((c) => ccs.includes(c) && !skip.includes(c));
  if (named.length !== 1) return null;
  const cc = named[0], cap = gz[cc] && gz[cc].capital, c = COUNTRIES.find((x) => x.id === cc);
  if (!cap || !c) return null;
  return { name: c.name, lat: +cap.lat.toFixed(3), lon: +cap.lon.toFixed(3), prec: "country", kind: "country", cc,
    basis: "Only the country is named; shown at its capital as a rough position" };
}
export const partyCcs = (parties) => (parties || []).map((p) => ccFromName(p)).filter(Boolean);
// Placement of one conflict report (tools/refresh_conflicts.mjs). PLACE_V is the rule version kept on each report as geo_c:
// 1 towns and regions, 2 with villages, 3 (2026-11-16) with named sites first, government stand-ins skipped and the
// one-country fallback, 4 (2026-11-16) with place_countries and more stop words. A report placed under an older version is placed once more under the new one; a pin the new rules no
// longer give is kept unless its name was only a government stand-in ("Tehran says").
export const PLACE_V = 4;
export function placeConflictReport(gz, item, conf, site) {
  const small = !!(gz && gz.__small), v = small ? PLACE_V : 1, i = item;
  if (!gz || (i.geo_c || 0) >= v) return { changed: false };
  const text = [i.title_en, i.title, i.summary_en, i.summary].filter(Boolean).join(" \u2022 ");
  const before = i.geo ? i.geo.n + "@" + i.geo.la + "," + i.geo.lo : "";
  // place_countries (optional): the countries whose towns may place a report. The Iran war leaves out the US: its towns in these
  // reports are ships, people and stand-ins ("USS Abraham Lincoln", "Tucker Carlson", "Washington says"), not where things happened.
  const pc = conf.place_countries || conf.countries;
  let p = (site && site(text)) || placeIn(gz, text, pc) || (site && site.weak && site.weak(text));
  if (!p) p = placeCountry(gz, text, pc, partyCcs(conf.parties));
  if (p) i.geo = { n: p.name, la: p.lat, lo: p.lon, p: p.prec, b: p.kind === "small" ? "gazetteer-small" : p.kind === "site" ? "site" : p.kind === "country" ? "country" : "gazetteer" };
  else if (i.geo && metonymOnly(text, i.geo.n)) delete i.geo;
  i.geo_c = v;
  const after = i.geo ? i.geo.n + "@" + i.geo.la + "," + i.geo.lo : "";
  return { changed: before !== after, from: before, to: after };
}
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
      // "Tehran says", "Washington denies": a capital standing for its government is not where the story happened
      if (p.kind === "city" && p.cap && METONYM_AFTER.test(text.slice(m.index + m[1].length, m.index + m[1].length + 30))) continue;
      (p.kind === "city" ? towns : regs).push({ ...p, cc, at: m.index });
    }
    // villages and small towns (addSmallPlaces), only where a town or region of the same name does not already match
    // (looked up word by word, longest name first: tens of thousands of names in one pattern took seconds per text)
    if (g.sm) {
      const words = [...text.matchAll(/[\p{L}\p{N}]+/gu)];
      for (let a = 0; a < words.length; a++) {
        const at = words[a].index; if (!/^\p{Lu}/u.test(words[a][0])) continue;
        for (let k = Math.min(g.smW, words.length - a); k >= 1; k--) {
          const last = words[a + k - 1], end = last.index + last[0].length, e = g.sm.get(text.slice(at, end).toLowerCase());
          if (!e) continue;
          const after = text.slice(end, end + 25);
          // part of a longer name ("Lanao del Norte", "Agusan del Sur"): not this village
          if (!SMALL_PART_OF.test(after)) smalls.push({ ...e, cc, at, end, ctx: SMALL_CTX_BEFORE.test(text.slice(Math.max(0, at - 40), at)) || SMALL_CTX_AFTER.test(after) });
          a += k - 1; break;
        }
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
const SMALL_PART_OF = /^[\s-]+(?:del|de|de la|do|da|dos|das|della|di|du|des|el|al|la)\s+\p{Lu}/u;
// words that make up a name only together with others: a village called "Middle East" or "New Market" is never read on its own
const SMALL_WORDS = new Set(["middle", "east", "west", "north", "south", "new", "old", "upper", "lower", "central", "great", "little", "big", "small", "the", "and",
  "of", "camp", "market", "junction", "station", "bridge", "hill", "hills", "valley", "river", "point", "road", "street", "border", "front", "line", "base", "field",
  "farm", "mill", "mine", "mines", "well", "wells", "spring", "springs", "creek", "lake", "bay", "beach", "island", "port", "town", "city", "village", "center", "centre",
  "court", "house", "school", "church", "airport", "gate", "park", "garden", "square", "cross", "corner", "end", "side", "view", "green", "red", "white", "black", "blue"]);
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
  // the first word of a region's name ("Agusan" of Agusan del Sur, "Lanao" of Lanao del Norte) means the region, not a village
  const regHead = {};
  for (const cc of want) if (idx[cc]) regHead[cc] = new Set([...idx[cc].regs.values()].flatMap((r) => { const w = String(r.name).toLowerCase().split(/\s+/); return w.length > 1 ? [w[0]] : []; }));
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
      if (n.length < 5 || STOP.has(k) || isCountryName(k) || !/^\p{Lu}/u.test(n) || idx[cc].m.has(k)) continue;
      if (k.split(/[^\p{L}\p{N}]+/u).every((w) => SMALL_WORDS.has(w) || STOP.has(w))) continue;
      if (regHead[cc] && regHead[cc].has(k)) continue;
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
    if (!m.size) continue;
    idx[cc].sm = m; idx[cc].smW = Math.max(...[...m.keys()].map((x) => x.split(/[^\p{L}\p{N}]+/u).filter(Boolean).length));
    added += m.size;
  }
  return added;
}
