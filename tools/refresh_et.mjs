// The ET tab's data (run by .github/workflows/refresh-flood.yml after the news pool is indexed; only=et runs it alone).
// Three parts, each a reported claim and never a verified event:
//  - news: every headline of the last 30 days in the news pool's "uap" data set (tools/topics.json, built by
//    tools/news_index.mjs), pinned at a town or region the headline names inside its own country (GeoNames gazetteer,
//    approximate) and left unpinned otherwise. Headlines only: no summaries, so no witness details are copied.
//  - official: U.S. War Department releases and news (war.gov RSS), AARO's DVIDS feed and The Black Vault's FOIA
//    document reporting, kept only when they carry a UFO/UAP word; kept a year across runs.
//  - cases: the hand-researched notable cases in tools/et_cases.json (named by place and year, not by witness).
// NUFORC's databank, aaro.mil and the French GEIPAN archive refuse GitHub's runners (403, 403 and 429 in the probe of
// 2026-09-28), so they are linked from the tab rather than read. A failed source keeps its earlier items.
// Writes data/live/et.js (window.OSAP_ET). Exit code 0 unless tools/topics.json is unreadable.
import fs from "node:fs";
import crypto from "node:crypto";
import { parseFeed } from "./feedparse.mjs";
import { getFeed } from "./news_fetch.mjs";
import { compileTopics, topicsOf } from "./topics_lib.mjs";
import { unent, areaOf } from "./et_lib.mjs";

const OUT = "data/live/et.js", DIR = "data/live/news-index", NEWS_DAYS = 30, OFFICIAL_DAYS = 366, MAX_NEWS = 600, MAX_OFFICIAL = 200;
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";
const iso = (d) => { const t = new Date(d); return isNaN(t) ? "" : t.toISOString().slice(0, 16); };
const fp = (s) => crypto.createHash("sha256").update(s).digest("hex");
const clip = (s, n) => { s = unent(String(s || "").replace(/<[^>]+>/g, " ")).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const readJs = (f) => { const t = fs.readFileSync(f, "utf8"); return JSON.parse(t.slice(t.indexOf("=", t.lastIndexOf("window.")) + 1).trim().replace(/;$/, "")); };
const { topics } = JSON.parse(fs.readFileSync("tools/topics.json", "utf8"));
const UAP = compileTopics(topics.filter((t) => t.id === "uap"));
const isUap = (text) => UAP.length && topicsOf(UAP, text, []).length > 0;

let prev = {};
try { prev = readJs(OUT); } catch (e) {}
const sources = [];

// 1. news pool headlines in the uap data set
const cutoff = new Date(Date.now() - NEWS_DAYS * 864e5).toISOString().slice(0, 10);
const rows = [];
try {
  for (const f of fs.readdirSync(DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.js$/.test(f) && f.slice(0, 10) >= cutoff).sort().reverse()) {
    const t = fs.readFileSync(DIR + "/" + f, "utf8"), day = JSON.parse(t.slice(t.indexOf("]=") + 2).trim().replace(/;$/, ""));
    for (const r of day) if (String(r[8] || "").split(",").includes("uap")) rows.push(r);
  }
  sources.push({ id: "news", name: "News pool, UFO and UAP data set", ok: true, n: rows.length });
} catch (e) { sources.push({ id: "news", name: "News pool, UFO and UAP data set", ok: false, error: e.message }); }
let gz = null, placeIn = null;
if (rows.length) {
  try { const g = await import("./gazetteer.mjs"); placeIn = g.placeIn; gz = await g.loadGazetteer(); }
  catch (e) { console.error("gazetteer unavailable, news left unpinned:", e.message); }
}
const seen = new Set();
const newsOk = sources[0].ok;
const news = newsOk ? rows.slice(0, MAX_NEWS).map((r) => {
  const [cc, date, t0, o0, outlet, link, , flags] = r, title = unent(t0), orig = unent(o0);
  if (seen.has(link)) return null; seen.add(link);
  const ccs = String(cc || "").split(",").filter(Boolean);
  const o = { cc: ccs, date, title, orig: orig || undefined, outlet, link, flags: flags || undefined, fp: fp(link + "\n" + title).slice(0, 16) };
  const p = gz && placeIn ? placeIn(gz, title + " \n " + (orig || ""), ccs) : null;
  if (p) o.geo = { name: p.name, lat: p.lat, lon: p.lon, prec: p.prec, basis: p.basis };
  return o;
}).filter(Boolean) : (prev.news || []).filter((i) => i.date >= cutoff);

// 2. official releases and FOIA reporting, filtered to UFO/UAP words
const FEEDS = [
  { id: "war-releases", name: "U.S. War Department releases", url: "https://www.war.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=9&Site=945&max=40", kind: "official", agency: "U.S. War Department" },
  { id: "war-news", name: "U.S. War Department news", url: "https://www.war.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=945&max=40", kind: "official", agency: "U.S. War Department" },
  { id: "dvids-aaro", name: "AARO on DVIDS", url: "https://www.dvidshub.net/rss/unit/8597", kind: "official", agency: "AARO", all: true },
  { id: "blackvault", name: "The Black Vault (FOIA document reporting)", url: "https://www.theblackvault.com/documentarchive/feed/", kind: "foia", agency: "The Black Vault" },
];
if ((!gz || !placeIn)) { try { const g = await import("./gazetteer.mjs"); placeIn = g.placeIn; gz = await g.loadGazetteer(); } catch (e) { console.error("gazetteer unavailable:", e.message); } }
const offBy = new Map((prev.official || []).map((i) => [i.link, i]));
for (const F of FEEDS) {
  try {
    const list = parseFeed(await getFeed(F.url));
    let n = 0;
    for (const i of list) {
      const text = i.title + " " + (i.summary || "");
      if (!/^https?:\/\//.test(i.link || "") || !(F.all || isUap(text))) continue;
      const old = offBy.get(i.link), geo = F.id === "dvids-aaro" ? areaOf(i.title, gz, placeIn) : null;
      offBy.set(i.link, { src: F.id, cc: geo ? geo.cc : undefined, geo: geo ? { name: geo.name, lat: geo.lat, lon: geo.lon, prec: geo.prec, basis: geo.basis } : undefined, kind: F.kind, agency: F.agency, date: iso(i.date) || (old && old.date) || stamp.replace(" ", "T").slice(0, 16),
        title: clip(i.title, 220), summary: clip(i.summary, 300), link: i.link, fp: fp(i.link + "\n" + i.title).slice(0, 16) });
      n++;
    }
    sources.push({ id: F.id, name: F.name, ok: true, n });
  } catch (e) { sources.push({ id: F.id, name: F.name, ok: false, error: e.name === "AbortError" ? "timed out" : e.message }); }
}
const offCut = new Date(Date.now() - OFFICIAL_DAYS * 864e5).toISOString().slice(0, 16);
const official = [...offBy.values()].filter((i) => i.date >= offCut).sort((a, b) => (b.date > a.date ? 1 : -1)).slice(0, MAX_OFFICIAL);

// 3. notable cases (hand-researched, no network)
let cases = [];
try { cases = JSON.parse(fs.readFileSync("tools/et_cases.json", "utf8")).cases.filter((c) => /^[a-z0-9-]+$/.test(c.id) && isFinite(c.lat) && isFinite(c.lon)); sources.push({ id: "cases", name: "Notable cases (hand-researched)", ok: true, n: cases.length }); }
catch (e) { sources.push({ id: "cases", name: "Notable cases (hand-researched)", ok: false, error: e.message }); }

fs.mkdirSync("data/live", { recursive: true });
const out = { asof: stamp, sources, news, official, cases,
  links: [
    { name: "NUFORC sighting databank", url: "https://nuforc.org/databank/", note: "U.S.-based public reporting centre; witness reports, unverified" },
    { name: "AARO (U.S. All-domain Anomaly Resolution Office)", url: "https://www.aaro.mil/", note: "official U.S. case records, imagery and reports" },
    { name: "WAR.GOV/UFO file releases", url: "https://www.war.gov/UFO/", note: "declassified U.S. UAP files, released on a rolling basis" },
    { name: "GEIPAN case archive (France, CNES)", url: "https://www.cnes-geipan.fr/fr/recherche/cas", note: "official French case files with classifications A to D" },
  ] };
fs.writeFileSync(OUT, "window.OSAP_ET=" + JSON.stringify(out).replace(/<\//g, "<\\/") + ";\n");
sources.forEach((s) => console.log(s.ok ? "ok  " : "FAIL", s.id, s.ok ? s.n + " items" : s.error));
console.log(`et: ${news.length} news (${news.filter((n) => n.geo).length} pinned), ${official.length} official, ${cases.length} cases, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
