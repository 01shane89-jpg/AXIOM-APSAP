// Fills a conflict's history (tools/conflict_extras/<id>-history.json) from two sources, so every day since the war began has its
// reports, not only the days the live feeds still hold:
//   1. the reports a Wikipedia timeline of the war cites (rows from tools/conflict_extras/wp_timeline.py): each is the outlet's own
//      headline and link, dated by the timeline's day heading; the timeline's sentence is used only to place and sort it;
//   2. OSAP's own daily news index (data/live/news-index/<day>.js), filtered with the conflict's own terms exactly as the refresh job
//      filters its feeds (tools/conflict_lib.mjs), one record per story per day (near-identical headlines grouped, outlets counted).
// Every record is a report, "Reported, not verified" (tools/conflict_extras/build.mjs); nothing is ruled true or false. Places come
// from the same rules as live reports (tools/gazetteer.mjs placeConflictReport: named sites, towns, villages, one named country).
// Usage: node tools/conflict_extras/import_history.mjs <id> [--wp rows.json::"Page title"]... [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--per-day 40]
import fs from "node:fs";
import vm from "node:vm";
import { termRe, isSecurity, classify, sha256 } from "../conflict_lib.mjs";
import { loadGazetteer, addSmallPlaces, siteMatcher, placeConflictReport } from "../gazetteer.mjs";
import { ccsAt } from "../geo_cc.mjs";

const args = process.argv.slice(2), id = args[0] || "iran-war";
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const conf = JSON.parse(fs.readFileSync("tools/conflicts.json", "utf8")).conflicts.find((c) => c.id === id);
if (!conf) throw new Error("no conflict " + id);
const FROM = opt("--from", conf.since), TO = opt("--to", new Date().toISOString().slice(0, 10));
// --wp rows.json::Page title (repeatable): rows from tools/conflict_extras/wp_timeline.py, timeline pages first
const WPS = args.flatMap((a, i) => (a === "--wp" ? [args[i + 1]] : [])).map((x) => { const [path, page] = x.split("::"); return { path, page: page || "timeline" }; });
const OUT = "tools/conflict_extras/" + id + "-history.json";

const places = JSON.parse(fs.readFileSync("tools/conflict_extras/" + id + "-places.json", "utf8")).places.map(([name, , , , lat, lon, , , o]) => ({ name, lat, lon, aliases: (o && o.aliases) || [], weak: !!(o && o.weak) }));
const site = siteMatcher(places);
const gz = await loadGazetteer();
const nSmall = await addSmallPlaces(gz, conf.countries, undefined, process.env.GEONAMES_CACHE || "");
if (nSmall) Object.defineProperty(gz, "__small", { value: true });

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
// the same link with tracking, fragments and mobile hosts taken off, so one report is not counted twice
const normUrl = (u) => { try { const x = new URL(u); x.hash = ""; for (const k of [...x.searchParams.keys()]) if (/^(utm_|smid|fbclid|gclid|ocid|IR$|output|amp$|post-id)/i.test(k)) x.searchParams.delete(k); x.hostname = x.hostname.replace(/^(m|amp|mobile)\./, ""); return x.toString().replace(/\/amp\/?$/, "/").replace(/\/$/, ""); } catch { return u; } };
const SIDE = (sub) => /\b(?:US|U\.S\.|American|Israeli|Israel|Coalition)\b[^,]*\b(?:strike|attack|raid|operation|campaign)/i.test(sub) && !/^Iranian/i.test(sub) ? ["US/Israel", "us"]
  : /\b(?:Iranian|Iran|IRGC|Hezbollah|Houthi|Axis)\b[^,]*\b(?:strike|attack|retaliat|offensive|missile|drone)/i.test(sub) ? ["Iran or aligned", "ir"] : ["", "neutral"];
const recs = [], seen = new Set();
function add(r, text) {
  const k = normUrl(r.url); if (seen.has(k)) return; seen.add(k);
  if (!(r.t >= FROM && r.t <= TO)) return;
  const item = { title: r.title, title_en: r.title, summary: text || "" };
  placeConflictReport(gz, item, conf, site);
  const g = item.geo;
  recs.push({ t: r.t + "T00:00:00Z", ...(g ? { place: g.n, lat: g.la, lon: g.lo, prec: g.p || "approx" } : {}), cc: g ? (ccsAt(g.la, g.lo, 0.3).find((x) => conf.countries.includes(x)) || ccsAt(g.la, g.lo, 0.3)[0] || null) : null,
    kind: r.kind, actor: r.actor || "", side: r.side || "neutral", title: r.title, source: r.source, url: r.url, via: r.via, ...(r.n > 1 ? { outlets: r.n } : {}), ...(r.lang ? { lang: r.lang } : {}) });
}

// 1. reports the Wikipedia timeline cites
const terms = termRe(conf.terms), excl = termRe(conf.exclude), strong = termRe(conf.strong);
// a report another page cites (not under a day heading of the timeline) is kept only when its own headline is about the war:
// it names the war's places or people, or reports an act of war (a midterm-election column cited for context is left out)
const onTopic = (t) => !!t && ((terms && terms.test(t)) || isSecurity(t)) && !(excl && excl.test(t));
let nWp = 0, nOff = 0;
for (const { path: WP, page: WP_PAGE } of WPS) {
  // a source the timeline cites on several days goes on the day nearest its own date (a 4 June article cited for 2 and 3 June: 3 June)
  const rows = JSON.parse(fs.readFileSync(WP, "utf8")).filter((r) => !seen.has(normUrl(r.url || ""))), best = new Map();
  const dms = (d) => { const t = Date.parse(String(d || "").replace(/(\d+)(st|nd|rd|th)/, "$1") + (/\d{4}-\d\d-\d\d$/.test(d) ? "T00:00:00Z" : " UTC")); return isNaN(t) ? null : t; };
  for (const row of rows) {
    const k = normUrl(row.url || ""), cd = dms(row.date), dd = Date.parse(row.day + "T00:00:00Z");
    const score = cd == null ? 0 : Math.abs(cd - dd) + (dd > cd + 864e5 ? 365 * 864e5 : 0);   // never after the source was published
    const o = best.get(k); if (!o || score < o.score) best.set(k, { row, score });
  }
  for (const { row } of best.values()) {
    if (!/^https?:\/\//.test(row.url || "") || !row.title) continue;
    if (/wikipedia\.org|archive\.(?:org|today|ph|is)\b/.test(row.url)) continue;
    if (row.dated_by === "publication" && !onTopic([row.title, row.trans].filter(Boolean).join(" "))) { nOff++; continue; }
    const [actor, side] = SIDE(row.sub || "");
    const title = row.trans ? row.trans + " (" + row.title + ")" : row.title;
    const n0 = recs.length;
    add({ t: row.day, title: title.slice(0, 300), source: row.work || host(row.url), url: row.url, kind: classify([row.title, row.trans, row.text].filter(Boolean).join(" ")),
      actor, side, lang: row.lang && !/^en\b/i.test(row.lang) ? row.lang : "", via: "Cited in Wikipedia: " + WP_PAGE + (row.dated_by === "publication" ? " (dated by the report's own date)" : " (under the day " + row.day + ")") }, [row.text, row.sub].filter(Boolean).join(" • "));
    nWp += recs.length - n0;
  }
}

// 2. OSAP's own news index, filtered by the conflict's terms as the refresh job does
const fits = (t) => !!t && (isSecurity(t) || !!(strong && strong.test(t))) && terms && terms.test(t) && !(excl && excl.test(t));
const words = (s) => new Set(String(s).toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, " ").split(/\s+/).filter((w) => w.length > 2 && !STOPW.has(w)));
const STOPW = new Set("the and for with from that this after over into amid says said will its his her their has have was were are not but who what how why new more than about".split(" "));
const PER_DAY = +opt("--per-day", 40);
const jac = (a, b) => { let i = 0; for (const w of a) if (b.has(w)) i++; return i / (a.size + b.size - i || 1); };
let nNews = 0;
const dir = "data/live/news-index";
if (fs.existsSync(dir)) {
  const ctx = { window: {} }; vm.createContext(ctx);
  for (const f of fs.readdirSync(dir).filter((x) => /^\d{4}-\d\d-\d\d\.js$/.test(x)).sort()) {
    const day = f.slice(0, 10); if (day < FROM || day > TO) continue;
    vm.runInContext(fs.readFileSync(dir + "/" + f, "utf8"), ctx);
    const rows = (ctx.window.OSAP_NEWSIX_DAY || {})[day] || [];
    // row: [ccs, date, title_en, title_orig, outlet, link, summary, flags, dataSetIds]
    const stories = [];
    for (const r of rows) {
      const en = r[2] || r[3] || "", all = [r[2], r[3]].filter(Boolean).join(" ");
      if (!/^https?:\/\//.test(r[5] || "") || String(r[1]).slice(0, 10) !== day || !fits(all)) continue;
      const w = words(en); if (w.size < 3) continue;
      const probe = { title: en, title_en: en }; placeConflictReport(gz, probe, conf, site);
      const pl = probe.geo && probe.geo.p !== "country" ? probe.geo.n : "";
      // the same story: most words shared, or the same place named and some words shared ("US strikes Qeshm" / "Blasts on Qeshm Island")
      const s = stories.find((x) => { const j = jac(x.w, w); return j >= 0.4 || (pl && x.pl === pl && j >= 0.15); });
      if (s) { s.n++; if (!s.outlets.includes(r[4])) s.outlets.push(r[4]); continue; }
      stories.push({ w, n: 1, outlets: [r[4]], r, en, pl });
    }
    // a story is kept when two or more outlets carried it, or when it names a place in the war's theatre and reports an act of war
    // (commentary that one outlet ran and that names no place is left out); at most PER_DAY a day, most outlets first
    const ACT = /^(?:airstrike|missile|drone|maritime|attack|ied|ground|shelling|shooting|abduction|raid_or_arrest|ambush|humanitarian|talks)$/;
    const keep = [];
    for (const s of stories) {
      s.kind = classify(s.en);
      s.placed = !!s.pl;
      if (s.outlets.length >= 2 || (s.placed && ACT.test(s.kind))) keep.push(s);
    }
    keep.sort((a, b) => b.outlets.length - a.outlets.length || (b.placed ? 1 : 0) - (a.placed ? 1 : 0));
    for (const s of keep.slice(0, PER_DAY)) {
      const n0 = recs.length;
      add({ t: day, title: s.en.slice(0, 300), source: String(s.r[4] || host(s.r[5])), url: s.r[5], kind: s.kind, actor: "", side: "neutral", n: s.outlets.length,
        via: "OSAP news index, " + day + (s.outlets.length > 1 ? " (" + s.outlets.length + " outlets)" : "") }, "");
      nNews += recs.length - n0;
    }
  }
}
recs.sort((a, b) => a.t.localeCompare(b.t) || a.url.localeCompare(b.url));
const out = { schema: "osap-conflict-history-import/1", id, built: new Date().toISOString().slice(0, 16) + "Z", from: FROM, to: TO,
  sources: [...WPS.map((w) => ({ name: "Reports cited in Wikipedia: " + w.page, note: "Outlets' own headlines and links; dated by the timeline's day heading, or by the report's own date on other pages; Wikipedia text is not stored." })),
    { name: "All Wikipedia-cited reports", n: nWp, note: nOff + " reports cited on other pages left out because their headline is not about the war" },
    { name: "OSAP news index (" + dir + ")", n: nNews, note: "The refresh job's own news, filtered with this conflict's terms; one record per story per day." }],
  sha256: sha256(JSON.stringify(recs)), records: recs };
fs.writeFileSync(OUT, JSON.stringify(out, null, 0).replace(/\},\{"t"/g, '},\n{"t"') + "\n");
console.log(id, "history:", recs.length, "records (Wikipedia-cited", nWp + ", news index", nNews + ")", FROM, "to", TO);
