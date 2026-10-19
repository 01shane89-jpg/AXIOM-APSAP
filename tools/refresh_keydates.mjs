// Key dates for every country (run daily by .github/workflows/refresh-keydates.yml, or by hand with Node 20+ and Python 3).
// Writes data/live/keydates/<cc>.json for every country in the picker (tools/geo_cc.mjs), read by assets/osap-keydates.js:
//   holidays       public holidays from Nager.Date (https://date.nager.at, MIT licence, no key), this year and next; about 120
//                  countries are covered, the rest get none. Government lists compiled by Nager: shown as "official".
//   elections      national elections and referendums with a set day, from Wikipedia's "<year> national electoral calendar"
//                  pages (MediaWiki API, CC BY-SA 4.0, no key), this year and next. Shown as "claimed": the page is a reported
//                  schedule, to be checked against the electoral commission.
//   anniversaries  each country's deadliest days of the last ten years of the UCDP Georeferenced Event Dataset (GED, CC BY 4.0),
//                  from the release zip the conflict history job keeps in the Actions cache (.cache/ucdp); downloaded here when
//                  the cache is empty. Rebuilt only when the release changes (or FORCE=1); otherwise kept from the last file.
// Religious dates (Ramadan, Eid, Christmas, Easter, Diwali, Lunar New Year, Songkran ...) are computed in the page, not here.
// A source that fails keeps its part of the previous file, so one bad run never empties a country.
// Env: UCDP_CACHE (default .cache/ucdp), UCDP_ZIP (use this local zip), FORCE=1 (rebuild anniversaries), ONLY=nager,wiki,ucdp.
import fs from "node:fs";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { createHash } from "node:crypto";
import { COUNTRIES, ccFromName, ccsInText, ccsAt } from "./geo_cc.mjs";
import { parseElectionCalendar, nagerItems, topViolenceDays } from "./keydates_lib.mjs";

// ANN_V: the anniversary rules; a change rebuilds them even when the UCDP release is the same
const ANN_V = 2;
const OUT = "data/live/keydates", CACHE = process.env.UCDP_CACHE || ".cache/ucdp", FORCE = process.env.FORCE === "1";
const ONLY = (process.env.ONLY || "").split(",").filter(Boolean), want = (k) => !ONLY.length || ONLY.includes(k);
const UA = "Mozilla/5.0 (AXIOM-OSAP key dates refresh; +https://github.com/01shane89-jpg/AXIOM-APSAP)";
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";
const NOW = new Date(), Y = NOW.getUTCFullYear(), YEARS = NOW.getUTCMonth() === 0 ? [Y - 1, Y, Y + 1] : [Y, Y + 1];
fs.mkdirSync(OUT, { recursive: true });

async function get(url, kind = "json", ms = 30000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": UA, accept: kind === "json" ? "application/json" : "*/*" } });
    if (r.status === 204 || r.status === 404) return null;
    if (!r.ok) throw new Error("HTTP " + r.status);
    if (kind === "buf") return Buffer.from(await r.arrayBuffer());
    const txt = await r.text();
    return kind === "json" ? (txt.trim() ? JSON.parse(txt) : null) : txt;
  } finally { clearTimeout(t); }
}
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return null; } };
function out(k, v) { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, k + "=" + v + "\n"); }
const LIST = COUNTRIES.filter((c, i, a) => a.findIndex((x) => x.id === c.id) === i);
const prev = Object.fromEntries(LIST.map((c) => [c.id, readJson(OUT + "/" + c.id + ".json") || {}]));
const STATE_F = OUT + "/_state.json", state = readJson(STATE_F) || {};
const status = {};

/* ---------- holidays: Nager.Date ---------- */
const hol = {};
if (want("nager")) {
  try {
    const avail = await get("https://date.nager.at/api/v3/AvailableCountries");
    const have = new Set((avail || []).map((x) => String(x.countryCode || "").toUpperCase()));
    if (!have.size) throw new Error("no country list");
    const jobs = LIST.filter((c) => have.has(c.a2));
    let ok = 0, fail = 0, i = 0;
    async function worker() {
      while (i < jobs.length) {
        const c = jobs[i++], rows = [];
        try {
          for (const y of YEARS) rows.push(...nagerItems(await get("https://date.nager.at/api/v3/PublicHolidays/" + y + "/" + c.a2), y, c.a2));
          hol[c.id] = rows; ok++;
        } catch (e) { fail++; console.log("nager", c.a2, e.message); }
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
    status.nager = { ok: ok > 0, countries: ok, failed: fail };
    console.log("nager:", ok, "countries,", fail, "failed");
  } catch (e) { status.nager = { ok: false, error: e.message }; console.log("nager failed:", e.message); }
}

/* ---------- elections: Wikipedia national electoral calendars ---------- */
const ele = {};
if (want("wiki")) {
  let ok = 0;
  const unmatched = new Set();
  for (const y of YEARS) {
    try {
      const j = await get("https://en.wikipedia.org/w/api.php?action=parse&page=" + y + "_national_electoral_calendar&prop=wikitext&format=json&formatversion=2&redirects=1");
      const t = j && j.parse && j.parse.wikitext;
      if (!t) { console.log("wikipedia", y, "no page"); continue; }
      ok++;
      for (const e of parseElectionCalendar(t, y)) {
        const cc = ccFromName(e.country) || ccsInText(e.country)[0];
        if (!cc) { unmatched.add(e.country); continue; }
        const list = (ele[cc] = ele[cc] || []), o = { date: e.date, title: e.title, kind: e.kind, src: e.url, page: e.page };
        if (e.end) o.end = e.end;
        if (e.indirect) o.indirect = true;
        if (!list.some((x) => x.date === o.date && x.title === o.title)) list.push(o);
        if (cc === "jp") (ele.oki = ele.oki || []).push(o);
      }
    } catch (e) { console.log("wikipedia", y, e.message); }
  }
  status.wikipedia = { ok: ok > 0, pages: ok, unmatched: [...unmatched].slice(0, 40) };
  console.log("wikipedia:", ok, "pages; not a country in the picker:", [...unmatched].join(", "));
}

/* ---------- anniversaries: UCDP GED deadliest days ---------- */
let ann = null, ucdpInfo = state.ucdp || null;
async function findRelease() {
  let names = [];
  try { const h = await get("https://ucdp.uu.se/downloads/", "text"); names = [...new Set([...h.matchAll(/ged\/(ged(\d{2})(\d)-csv\.zip)/gi)].map((m) => m[1].toLowerCase()))]; } catch (e) {}
  const yy = Y % 100; for (const y of [yy, yy - 1, yy - 2]) names.push("ged" + y + "1-csv.zip");
  for (const f of fs.existsSync(CACHE) ? fs.readdirSync(CACHE) : []) if (/^ged\d+-csv\.zip$/.test(f)) names.push(f);
  return [...new Set(names)].sort((a, b) => b.localeCompare(a));
}
if (want("ucdp")) {
  try {
    fs.mkdirSync(CACHE, { recursive: true });
    let zip = process.env.UCDP_ZIP || "";
    if (!zip) {
      const names = await findRelease();
      // the newest release the cache already holds, else the newest one UCDP serves
      const cached = names.find((n) => fs.existsSync(CACHE + "/" + n));
      const newest = names[0];
      if (cached && cached >= newest) zip = CACHE + "/" + cached;
      else {
        for (const n of names) {
          try { const b = await get("https://ucdp.uu.se/downloads/ged/" + n, "buf", 300000); if (b && b.length > 1e6) { fs.writeFileSync(CACHE + "/" + n, b); zip = CACHE + "/" + n; break; } } catch (e) { console.log("ucdp", n, e.message); }
        }
        if (!zip && cached) zip = CACHE + "/" + cached;
      }
    }
    if (!zip) throw new Error("no GED release available");
    const sha = createHash("sha256").update(fs.readFileSync(zip)).digest("hex");
    const name = zip.split("/").pop();
    if (!FORCE && state.ucdp && state.ucdp.sha256 === sha && state.ucdp.v === ANN_V && LIST.every((c) => prev[c.id].anniversaries)) {
      console.log("ucdp: " + name + " unchanged, anniversaries kept");
    } else {
      const rows = [];
      let head = null, ix = {}, last = "";
      const py = spawn("python3", ["tools/ged_extract.py", zip], { stdio: ["ignore", "pipe", "inherit"] });
      const done = new Promise((ok) => py.on("close", ok));
      const rl = readline.createInterface({ input: py.stdout, crlfDelay: Infinity });
      const memo = {};
      for await (const line of rl) {
        if (!line) continue;
        const r = JSON.parse(line);
        if (!head) { head = r; head.forEach((k, i) => { ix[k] = i; }); continue; }
        const date = (r[ix.date_start] || "").slice(0, 10); if (date > last) last = date;
        rows.push({ country: r[ix.country] || "", lat: +r[ix.latitude], lon: +r[ix.longitude], date, end: (r[ix.date_end] || "").slice(0, 10), best: +r[ix.best] || 0, id: r[ix.id],
          where: r[ix.where_description] || "", adm1: r[ix.adm_1] || "", a: r[ix.side_a] || "", b: r[ix.side_b] || "", type: +r[ix.type_of_violence] || 0 });
      }
      const code = await done;
      if (code || !rows.length) throw new Error("reading " + name + " failed (exit " + code + ")");
      const from = (+last.slice(0, 4) - 9) + "-01-01";
      // UCDP's own country name decides ("DR Congo (Zaire)", "Myanmar (Burma)"); the point settles names the list does not know
      const recent = rows.filter((r) => r.date >= from);
      for (const r of recent) {
        if (!(r.country in memo)) memo[r.country] = ccFromName(r.country.replace(/\s*\(.*\)\s*$/, "")) || ccsInText(r.country)[0] || null;
        r.cc = memo[r.country] || ccsAt(r.lat, r.lon, 0)[0] || null;
        // UCDP files Gaza and the West Bank under Israel; the point puts them under Palestine, as the page's country picker does
        // (the outlines hold the West Bank only, so the Gaza Strip is its box)
        if (r.cc === "il" && (ccsAt(r.lat, r.lon, 0)[0] === "ps" || (r.lat >= 31.21 && r.lat <= 31.6 && r.lon >= 34.2 && r.lon <= 34.57))) r.cc = "ps";
      }
      ann = topViolenceDays(recent, from);
      ucdpInfo = { release: name, sha256: sha, v: ANN_V, last, from, url: "https://ucdp.uu.se/downloads/" };
      console.log("ucdp:", name, rows.length, "events, last", last, "; countries with anniversaries:", Object.keys(ann).length);
    }
    status.ucdp = { ok: true, release: (ucdpInfo || {}).release || name };
  } catch (e) { status.ucdp = { ok: false, error: e.message }; console.log("ucdp failed:", e.message); }
}

/* ---------- write ---------- */
const SOURCES = {
  holidays: { name: "Nager.Date public holidays", url: "https://date.nager.at", licence: "MIT", status: "official" },
  elections: { name: "Wikipedia national electoral calendar", url: "https://en.wikipedia.org/wiki/" + Y + "_national_electoral_calendar", licence: "CC BY-SA 4.0", status: "claimed" },
  anniversaries: { name: "UCDP Georeferenced Event Dataset", url: "https://ucdp.uu.se/downloads/", licence: "CC BY 4.0", status: "computed" },
};
let changed = 0;
const strip = (o) => JSON.stringify(Object.assign({}, o, { asof: "" }));
for (const c of LIST) {
  const p = prev[c.id];
  const holCc = c.id === "oki" ? hol.jp : hol[c.id];
  const o = {
    schema: "osap-keydates/1", cc: c.id, name: c.name, asof: stamp,
    holidays: status.nager && status.nager.ok ? holCc || [] : p.holidays || [],
    elections: (status.wikipedia && status.wikipedia.ok ? ele[c.id] || [] : p.elections || []).sort((a, b) => (a.date < b.date ? -1 : 1)),
    anniversaries: ann ? ann[c.id] || [] : p.anniversaries || [],
    ucdp: ann ? ucdpInfo : p.ucdp || ucdpInfo || null,
    sources: SOURCES,
  };
  const f = OUT + "/" + c.id + ".json";
  if (p.schema && strip(p) === strip(o)) continue;
  fs.writeFileSync(f, JSON.stringify(o) + "\n"); changed++;
}
fs.writeFileSync(STATE_F, JSON.stringify({ schema: "osap-keydates-state/1", checked: stamp, years: YEARS, status, ucdp: ucdpInfo }, null, 1) + "\n");
console.log("keydates:", LIST.length, "countries,", changed, "files changed");
out("changed", String(changed));
if (!Object.values(status).some((s) => s.ok)) process.exit(1);
