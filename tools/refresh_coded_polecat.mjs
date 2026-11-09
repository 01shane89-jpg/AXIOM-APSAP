// Coded event history, protests and riots after 2020 (machine-coded): POLECAT (Political Event Classification, Attributes and
// Types; Harvard Dataverse doi:10.7910/DVN/AJGVIT, CC0 1.0, no key). POLECAT is coded BY SOFTWARE from news stories (the PLOVER
// ontology), not by people, so every row it gives is tagged machine-coded and kept apart from the hand-coded Mass Mobilization
// protests (1990-2020, tools/refresh_coded_protests.mjs). Only the years after Mass Mobilization ends (2021 on) are read, so the
// two never count the same protest twice.
// Kept: PROTEST events (modes demo, riot, strike, boycott, or none given). Left out and counted: a protester the software read as
// police, military or a government (most often a misread sentence: "security forces dispersed protesters"), and an event with no
// country. One story can give several events: events on the same day at the same place with the same mode are merged into one
// row that says how many it merged. Kept per event: id, date, place (POLECAT's own geocoding), mode, the protesters' role
// ("resident", "student"; never a person's name), the target's sector and country. Never kept: story text, people or names.
// Rules "polecat-acled-v1" (assets/osap-cf-code.js fromPolecat): riot -> Riots · Violent demonstration; any other mode -> Protests,
// sub-event type blank (the software does not say whether the state intervened).
// Writes data/live/conflicts/history/pc/<cc>.js (window.OSAP_CF_CODED["pc/<cc>"]) and pc/_index.js. Runs only when the Dataverse
// file list or the rules change (FORCE=1 rebuilds). Env: PC_FILES=<path,path> local copies (tests), PC_YEARS=2021,2022.
import fs from "node:fs";
import readline from "node:readline";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import CODE from "../assets/osap-cf-code.js";
import { ccOf } from "./refresh_coded_protests.mjs";
import { ccFromA3 } from "./geo_cc.mjs";

const OUT = "data/live/conflicts/history/pc", FORCE = process.env.FORCE === "1", FIRST = "2021-01-01";
const DOI = "doi:10.7910/DVN/AJGVIT", API = "https://dataverse.harvard.edu/api/datasets/:persistentId/?persistentId=" + DOI;
const UA = "Mozilla/5.0 (AXIOM-OSAP coded event history; +https://axiom-osap.netlify.app/)";
const sha = (s) => createHash("sha256").update(s).digest("hex");
const js = (name, o) => name + "=" + JSON.stringify(o).replace(/<\//g, "<\\/") + ";\n";
function put(f, txt) { try { if (fs.readFileSync(f, "utf8") === txt) return false; } catch (e) {} fs.writeFileSync(f, txt); return true; }
const NONE = (v) => !v || v === "None" || v === "nan";
// GeoNames feature types: a populated place is a town (precision 2); a district 2; a province 3 (kept, not drawn); a country or
// nothing: no position
export function precOf(ft) {
  if (/^PPL/.test(ft || "")) return 2;
  if (/^ADM[2-5]/.test(ft || "")) return 2;
  if (/^ADM1/.test(ft || "")) return 3;
  return 0;
}
// POLECAT names countries by ISO 3166 alpha-3 code ("THA"); Hong Kong and Macau are filed under China (the page has no separate
// area for them), POLECAT's "KOS" is Kosovo. A full name (older files) goes through the Mass Mobilization name list.
const A3_EXTRA = { HKG: "cn", MAC: "cn", KOS: "xk" };
export function ccOfPc(v) { return /^[A-Z]{3}$/.test(v) ? A3_EXTRA[v] || ccFromA3(v) : ccOf(v); }
const SKIP_SECTORS = new Set(["COP", "MIL", "GOV"]);
const ROLE_OK = /^[\p{L} '\-]{2,40}$/u;

/** One parsed PROTEST line (h: column index by name) -> a record, or a reason it was left out. */
export function readRow(r, h) {
  const g = (k) => (h[k] == null ? "" : String(r[h[k]] || "").trim());
  if (g("Event Type").toUpperCase() !== "PROTEST") return { skip: "not_protest" };
  const date = g("Event Date").slice(0, 10); if (!/^\d{4}-\d\d-\d\d$/.test(date)) return { skip: "no_date" };
  if (date < FIRST) return { skip: "before_2021" };
  if (SKIP_SECTORS.has(g("Primary Actor Sector"))) return { skip: "actor_state_forces" };
  const country = g("Country"), cc = NONE(country) ? null : ccOfPc(country);
  if (!cc) return { skip: "no_country", country: NONE(country) ? "(none)" : country };
  const mode = NONE(g("Event Mode")) ? "" : g("Event Mode").toLowerCase();
  let prec = precOf(g("Feature Type")), lat = +g("Latitude"), lon = +g("Longitude");
  if (!prec || !isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0)) { prec = 3; lat = null; lon = null; }
  const place = [g("City"), g("Province")].filter((x) => !NONE(x)).filter((x, i, a) => a.indexOf(x) === i).join(", ") || (NONE(g("Placename")) ? "" : g("Placename"));
  const role = NONE(g("Actor Title")) ? "" : g("Actor Title").toLowerCase();
  return { id: g("Event ID").slice(0, 64), date, cc, mode, riot: mode === "riot" ? 1 : 0, lat: lat == null ? null : +lat.toFixed(4), lon: lon == null ? null : +lon.toFixed(4), prec,
    place: place.slice(0, 80), role: ROLE_OK.test(role) ? role : "", target: [NONE(g("Primary Recipient Sector")) ? "" : g("Primary Recipient Sector"), NONE(g("Recipient Country")) ? "" : g("Recipient Country")].filter(Boolean).join(" · ").slice(0, 60) };
}
/** Merges records of the same day, place and mode into one row (the first id; n = how many). */
export function merge(recs) {
  const by = new Map();
  for (const e of recs) {
    const k = [e.date, e.cc, e.lat == null ? "p:" + e.place.toLowerCase() : e.lat.toFixed(2) + "," + e.lon.toFixed(2), e.mode].join("|");
    const m = by.get(k);
    if (m) { m.n++; if (!m.role && e.role) m.role = e.role; if (!m.target && e.target) m.target = e.target; }
    else by.set(k, { ...e, n: 1 });
  }
  return [...by.values()];
}
async function* lines(stream) { const rl = readline.createInterface({ input: stream, crlfDelay: Infinity }); for await (const l of rl) yield l; }

/* ---------- main (skipped when imported by a test) ---------- */
if (process.argv[1] && process.argv[1].endsWith("refresh_coded_polecat.mjs")) {
  fs.mkdirSync(OUT, { recursive: true });
  let files = [];
  if (process.env.PC_FILES) files = process.env.PC_FILES.split(",").map((p) => ({ name: p.split("/").pop(), local: p, size: fs.statSync(p).size, id: p }));
  else {
    const j = await (await fetch(API, { headers: { "user-agent": UA } })).json();
    const v = j.data.latestVersion;
    files = v.files.map((f) => ({ name: f.dataFile.filename, id: f.dataFile.id, size: f.dataFile.filesize, md5: f.dataFile.md5 || "" }))
      .filter((f) => /ngecEvents\.DV\.(\d{4})\.txt$/.test(f.name) && +f.name.match(/(\d{4})\.txt$/)[1] >= 2021);
    files.version = v.versionNumber + "." + v.versionMinorNumber;
  }
  const YEARS = (process.env.PC_YEARS || "").split(",").filter(Boolean);
  if (YEARS.length) files = files.filter((f) => YEARS.some((y) => f.name.includes(y)));
  if (!files.length) throw new Error("POLECAT: no yearly files from 2021 on in " + DOI);
  const STATE = OUT + "/_state.json"; let state = {}; try { state = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch (e) {}
  const key = sha(JSON.stringify(files.map((f) => [f.name, f.id, f.size, f.md5]))).slice(0, 16) + "|" + CODE.PC_RULES + "|" + YEARS.join(",");
  if (!FORCE && state.key === key && fs.existsSync(OUT + "/_index.js")) { console.log("POLECAT protests: unchanged (" + key + ")"); process.exit(0); }
  const recs = [], skipped = {}, noCountry = {}, perFile = {};
  for (const f of files) {
    const stream = f.local ? fs.createReadStream(f.local) : Readable.fromWeb((await (async () => {
      const r = await fetch("https://dataverse.harvard.edu/api/access/datafile/" + f.id, { redirect: "follow", headers: { "user-agent": UA } });
      if (!r.ok) throw new Error(f.name + ": HTTP " + r.status); return r; })()).body);
    let h = null, n = 0, kept = 0;
    for await (const line of lines(stream)) {
      const r = line.split("\t");
      if (!h) { h = {}; r.forEach((k, i) => { h[k.trim()] = i; }); const miss = ["Event ID", "Event Date", "Event Type", "Event Mode", "Country", "Latitude", "Longitude", "Feature Type"].filter((k) => h[k] == null);
        if (miss.length) throw new Error(f.name + ": columns missing " + miss.join(", ")); continue; }
      n++;
      if (r[h["Event Type"]] !== "PROTEST") continue;
      const e = readRow(r, h);
      if (e.skip) { skipped[e.skip] = (skipped[e.skip] || 0) + 1; if (e.country) noCountry[e.country] = (noCountry[e.country] || 0) + 1; continue; }
      recs.push(e); kept++;
    }
    perFile[f.name] = { rows: n, protests_kept: kept };
    console.log(f.name, n, "rows,", kept, "protests kept");
  }
  const rows = merge(recs);
  const by = {}; for (const e of rows) (by[e.cc] = by[e.cc] || []).push(e);
  const ds = CODE.DATASETS.polecat, lic = { id: ds.id, name: ds.name, licence: ds.licence, licence_url: ds.licence_url, nc: ds.nc, url: ds.url, cite: ds.cite, machine_coded: true };
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";
  const index = { schema: "osap-cf-coded-index/1", dataset: lic, coding_rules: CODE.PC_RULES, asof: stamp, version: files.version || "", files: perFile, n: rows.length, merged_from: recs.length,
    placed: rows.filter((e) => e.prec === 2).length, skipped, no_country: noCountry, countries: {} };
  let changed = 0; const keep = new Set(["_index.js", "_state.json"]);
  for (const cc of Object.keys(by).sort()) {
    const ev = by[cc].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
    // row: id, date, end (always ""), lat, lon, precision, riot, place, mode, merged events, protesters' role, target (sector · country)
    const out = ev.map((e) => [e.id, e.date, "", e.lat, e.lon, e.prec, e.riot, e.place, e.mode, e.n, e.role, e.target]);
    const body = { rows: out }, hh = sha(JSON.stringify(body));
    const o = Object.assign({ schema: "osap-cf-coded/1", id: "pc/" + cc, cc, dataset: lic, coding_rules: CODE.PC_RULES, asof: stamp, n: out.length, first: ev[0].date, last: ev[ev.length - 1].date, sha256: hh,
      cols: ["id", "date", "end", "lat", "lon", "prec", "riot", "place", "mode", "merged", "role", "target"], fp: "SHA-256 of each event: polecat|<id>|<date>|<place>|<mode>|<merged>" }, body);
    if (put(OUT + "/" + cc + ".js", js('(window.OSAP_CF_CODED=window.OSAP_CF_CODED||{})["pc/' + cc + '"]', o))) changed++;
    keep.add(cc + ".js");
    index.countries[cc] = { n: out.length, first: o.first, last: o.last, placed: ev.filter((e) => e.prec === 2).length, sha256: hh };
  }
  for (const f of fs.readdirSync(OUT)) if (!keep.has(f)) { fs.unlinkSync(OUT + "/" + f); changed++; }
  if (put(OUT + "/_index.js", js('(window.OSAP_CF_CODED=window.OSAP_CF_CODED||{})["pc/_index"]', index))) changed++;
  fs.writeFileSync(STATE, JSON.stringify({ key, built: stamp, n: rows.length, merged_from: recs.length, skipped, no_country: noCountry, files: perFile }, null, 1) + "\n");
  console.log("POLECAT protests:", recs.length, "kept,", rows.length, "after merging;", Object.keys(by).length, "countries; skipped", JSON.stringify(skipped), "no country", JSON.stringify(noCountry), "; files changed", changed);
}
