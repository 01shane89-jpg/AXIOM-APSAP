// Builds data/conflicts/extra/<id>.js (window.OSAP_CF_EXTRA[id]) from the hand-curated files in tools/conflict_extras/:
//   <id>-places.json    bases, facilities, chokepoints ([name, kind, side, cc, lat, lon, why, src])
//   <id>-backfill.json  dated past events found by web search (titles only), so the tab has history before the feeds began
//   <id>-history.json   reports cited by Wikipedia's pages on the war and OSAP's own news index, one or more for every day
//                       (tools/conflict_extras/import_history.mjs; headlines and links only)
//   <id>-facts.json     phases, figures (each a claim by whoever gave the number), hand-drawn areas
// Every record and place gets a SHA-256 fingerprint of its canonical JSON. Party statements stay claims:
// claim_status "Reported, not verified". Run: node tools/conflict_extras/build.mjs iran-war
import fs from "node:fs";
import crypto from "node:crypto";
import { ccFromName } from "../geo_cc.mjs";

const id = process.argv[2] || "iran-war", dir = "tools/conflict_extras/";
const read = (n) => { try { return JSON.parse(fs.readFileSync(dir + id + "-" + n + ".json", "utf8")); } catch { return null; } };
const canon = (o) => JSON.stringify(Object.keys(o).filter((k) => k !== "fp").sort().reduce((a, k) => ((a[k] = o[k]), a), {}));
const fp = (o) => crypto.createHash("sha256").update(canon(o)).digest("hex");
const short = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 10);
const CLAIM = "Reported, not verified";

const P = read("places") || { places: [] }, B = read("backfill") || [], F = read("facts") || {}, H = read("history") || { records: [], sources: [] };
// a place may carry a 9th element { aliases, prec, basis }: aliases are the names reports use for it (the refresh job pins a report
// that names one on the place, tools/gazetteer.mjs siteMatcher); prec "site" when the position is the site itself, with its basis
const places = P.places.map(([name, kind, side, cc, lat, lon, why, src, more]) => {
  const m = more || {};
  const o = { id: "cfp:" + id + ":" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), name, kind, side, cc, lat, lon, prec: m.prec || "approx",
    why, why_status: "Draft, AI-generated, not analyst-approved", src, srcname: m.srcname || (/wikipedia/.test(src) ? "Wikipedia" : new URL(src).hostname.replace(/^www\./, "")),
    ...(m.aliases && m.aliases.length ? { aliases: m.aliases } : {}), ...(m.basis ? { basis: m.basis } : {}),
    // reports pinned only to the site's country whose headline uses these words: listed with the place as related, never moved onto it
    ...(m.related ? { related: m.related } : {}) };
  return { ...o, fp: fp(o) };
});
const seen = new Set();
// a record may name one of the places above (site): it then takes that place's position and name, and the place lists it
const byName = new Map(places.map((p) => [p.name, p]));
const records = B.filter((r) => r.url && r.title && !seen.has(r.url + r.title) && seen.add(r.url + r.title)).map((r) => {
  const s = r.site ? byName.get(r.site) : null;
  if (r.site && !s) throw new Error("backfill record names an unknown site: " + r.site);
  // one report that names several sites (a survey of damage across bases) sits on the first and is listed on the others too ("also")
  const also = (r.also || []).map((n) => { const a = byName.get(n); if (!a) throw new Error("backfill record names an unknown site: " + n); if (!s || a === s) throw new Error("'also' needs a different first site: " + r.title); return a.id; });
  const o = { id: "cfb:" + id + ":" + short(r.url + "|" + r.title), t: r.t, lat: s ? s.lat : r.lat, lon: s ? s.lon : r.lon,
    prec: s ? s.prec : r.lat == null ? "none" : r.place && r.place.toLowerCase() !== (r.cc || "") && !ccFromName(r.place) ? "approx" : "country",   // a place that is a country's name is not a town
    place: s ? s.name : r.place || "", ...(s ? { site: s.id } : {}), ...(also.length ? { also } : {}), ...(r.about ? { about: r.about } : {}), cc: r.cc || (s && s.cc) || null, kind: r.kind, actor: r.actor, side: r.side, title: r.title, source: r.source, url: r.url,
    claim_status: CLAIM, basis: "Web search result title" + (r.gap_fill ? ", checked by opening the page (its own title and date)" : "") + "; date only (time unknown); " +
      (s ? "placed on the named site the report is about" : r.lat == null ? "no place: the report covers the whole war that day" : "position is the named place's approximate centre"), backfill: true };
  return { ...o, fp: fp(o) };
});
// the imported history: each record is a report as its outlet headlined it, never ruled true or false; a report already in the
// backfill above is not added twice
const nB = records.length, urls = new Set(records.map((r) => r.url));
for (const r of H.records || []) {
  if (!r.url || !r.title || urls.has(r.url)) continue; urls.add(r.url);
  // a report the import placed on a named site takes that site's position as listed now (sites can be moved to better coordinates)
  const sp = r.lat != null && r.prec === "site" ? byName.get(r.place) : null;
  const o = { id: "cfh:" + id + ":" + short(r.url + "|" + r.title), t: r.t, ...(r.lat != null ? { lat: sp ? sp.lat : r.lat, lon: sp ? sp.lon : r.lon, place: r.place } : { place: "" }), prec: r.lat != null ? r.prec || "approx" : "none",
    cc: r.cc || null, kind: r.kind, actor: r.actor || "", side: r.side || "neutral", title: r.title, source: r.source, url: r.url, via: r.via, ...(r.outlets ? { outlets: r.outlets } : {}), ...(r.lang ? { lang: r.lang } : {}),
    claim_status: CLAIM };   // basis: history.basis, by prec
  records.push({ ...o, fp: fp(o) });
}
records.sort((a, b) => a.t.localeCompare(b.t) || a.id.localeCompare(b.id));
const figures = (F.figures || []).map((f) => { const o = { ...f, claim_status: CLAIM }; return { ...o, fp: fp(o) }; });
const areas = (F.areas || []).map((a) => {
  const o = { id: "cfa:" + id + ":" + short(a.name), ...a, claim_status: CLAIM, src: a.url, asof: a.from };
  delete o.url; return { ...o, fp: fp(o) };
});
const out = { schema: "osap-conflict-extra/1", id, asof: new Date().toISOString().slice(0, 16) + "Z", note: P.note || "",
  history: { from: H.from || "", to: H.to || "", sources: H.sources || [], sha256: H.sha256 || "", backfill: nB,
    basis: { all: "Headline and link only; date only (time unknown)", site: "placed on the named site", approx: "placed by the town or place the headline or its citing sentence names; position approximate",
      country: "only a country is named: pinned on it, not on a place in it", none: "no place named: listed, not on the map" }, imported: records.length - nB }, phases: F.phases || [], figures, places, areas, records };
fs.mkdirSync("data/conflicts/extra", { recursive: true });
fs.writeFileSync("data/conflicts/extra/" + id + ".js", "window.OSAP_CF_EXTRA=window.OSAP_CF_EXTRA||{};window.OSAP_CF_EXTRA[" + JSON.stringify(id) + "]=" + JSON.stringify(out) + ";\n");
console.log(id, "places", places.length, "records", records.length, "figures", figures.length, "areas", areas.length);
