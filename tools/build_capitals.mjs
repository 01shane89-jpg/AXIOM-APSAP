// Capital cities of every country with an ISO 3166-1 alpha-2 code, from Wikidata (CC0), for the claim trail map
// (assets/osap-trailmap.js), which places each outlet at its home country's capital. Writes data/basemap/capitals.js.
// Run by hand with Node 20+ when the list needs a refresh:  node tools/build_capitals.mjs
// Rules: the capital statement with the best rank (preferred over normal; deprecated and ended ones skipped), then the lowest
// Wikidata id, so the result is the same on every run. OSAP's own codes that are not ISO get a fixed entry (OKI below).
import { writeFileSync } from "node:fs";
const UA = "AXIOM-OSAP capitals snapshot (+https://github.com/01shane89-jpg/AXIOM-APSAP)";
const Q = `SELECT ?iso ?cap ?capLabel ?coord ?rank WHERE {
  ?c wdt:P297 ?iso; p:P36 ?st. ?st ps:P36 ?cap; wikibase:rank ?rank. FILTER(?rank != wikibase:DeprecatedRank)
  FILTER NOT EXISTS { ?st pq:P582 ?end }
  ?cap wdt:P625 ?coord.
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul,fr,es,de,pt,ar,ru,zh". } }`;
const FIXED = { oki: ["Naha", 26.2124, 127.6809, "Q207954"], xk: ["Pristina", 42.6629, 21.1655, "Q25270"] };
export function pick(bindings) {
  const by = {};
  for (const b of bindings) {
    const iso = String(b.iso && b.iso.value || "").toLowerCase(); if (!/^[a-z]{2}$/.test(iso)) continue;
    const m = /^Point\(([-\d.]+) ([-\d.]+)\)$/.exec(b.coord && b.coord.value || ""); if (!m) continue;
    const lon = +m[1], lat = +m[2]; if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) continue;
    const q = String(b.cap.value).split("/").pop(), pref = /PreferredRank$/.test(b.rank && b.rank.value || "") ? 0 : 1;
    const cand = { n: String(b.capLabel && b.capLabel.value || q).slice(0, 60), lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4, q, pref };
    const cur = by[iso], qn = (x) => +x.q.replace(/^Q/, "");
    if (!cur || cand.pref < cur.pref || (cand.pref === cur.pref && qn(cand) < qn(cur))) by[iso] = cand;
  }
  for (const [k, v] of Object.entries(FIXED)) if (!by[k]) by[k] = { n: v[0], lat: v[1], lon: v[2], q: v[3], pref: 0 };
  const out = {}; for (const k of Object.keys(by).sort()) { const v = by[k]; out[k] = [v.n, v.lat, v.lon, v.q]; }
  return out;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await fetch("https://query.wikidata.org/sparql?query=" + encodeURIComponent(Q), { headers: { Accept: "application/sparql-results+json", "User-Agent": UA } });
  if (!r.ok) throw new Error("Wikidata answered " + r.status);
  const caps = pick((await r.json()).results.bindings);
  const n = Object.keys(caps).length; if (n < 190) throw new Error("only " + n + " capitals, not writing");
  const doc = { schema: "osap-capitals/1", asof: new Date().toISOString().slice(0, 10), source: "Wikidata (CC0): capital (P36) of each country with an ISO 3166-1 alpha-2 code (P297), coordinate (P625)", caps };
  writeFileSync("data/basemap/capitals.js", "window.OSAP_CAPITALS=" + JSON.stringify(doc) + ";\n");
  console.log(n + " capitals written");
}
