// Diagnostic (only=probe-refdata): fetches open reference data for the hand-researched country layers that the research
// environment cannot reach itself: the U.S. State Department travel advisory feed, and Wikidata lists of hospitals,
// U.S. diplomatic posts and seaports per country. Writes raw results to probe-out/refdata/ only; nothing in data/.
// The research thread turns them into apsap-sof/1 records by hand (selection, checks, fingerprints).
import fs from "node:fs";

const OUT = "probe-out/refdata";
fs.mkdirSync(OUT, { recursive: true });
const UA = "AXIOM-OSAP reference-data probe (https://github.com/01shane89-jpg/AXIOM-APSAP)";
const CCS = (process.env.CCS || "").split(/[ ,]+/).filter(Boolean).map((c) => c.toUpperCase());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];

async function get(url, opt = {}) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { ...opt, headers: { "User-Agent": UA, ...(opt.headers || {}) }, signal: AbortSignal.timeout(90000) });
      if (r.ok) return await r.text();
      log.push(`${r.status} ${url.slice(0, 160)}`);
      if (r.status !== 429 && r.status < 500) return null;
    } catch (e) { log.push(`ERR ${e.message} ${url.slice(0, 160)}`); }
    await sleep(5000 * (i + 1));
  }
  return null;
}
async function sparql(q) {
  const t = await get("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(q), { headers: { Accept: "application/sparql-results+json" } });
  if (!t) return null;
  try { return JSON.parse(t).results.bindings.map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value]))); } catch (e) { return null; }
}

// 1. State Department advisories (one feed, every country)
for (const u of ["https://travel.state.gov/_res/rss/TAsTWs.xml", "https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories.html"]) {
  const t = await get(u);
  if (t) { fs.writeFileSync(`${OUT}/advisories-${u.endsWith(".xml") ? "rss.xml" : "index.html"}`, t); log.push(`ok ${t.length} ${u}`); }
}

// 2. Per country: hospitals, U.S. posts, seaports (Wikidata, ranked by number of Wikipedia articles). Grouped per item so
// multi-valued properties do not repeat rows; several countries run at once (Wikidata allows 5 parallel queries), and no new
// country starts after DEADLINE so the park step always runs.
const T0 = Date.now(), DEADLINE = +(process.env.DEADLINE_MIN || 17) * 60000;
async function one(cc) {
  const C = `?c wdt:P297 "${cc}".`, t = Date.now();
  const hosp = await sparql(`SELECT ?h ?sl (SAMPLE(?en) AS ?hLabel) (SAMPLE(?any) AS ?hLabelAny) (SAMPLE(?coord) AS ?coord)
    (SAMPLE(?admL) AS ?admLabel) (SAMPLE(?web) AS ?web) WHERE { ${C}
    ?h wdt:P17 ?c; wdt:P31/wdt:P279* wd:Q16917; wdt:P625 ?coord; wikibase:sitelinks ?sl.
    FILTER NOT EXISTS { ?h wdt:P576 ?end } FILTER NOT EXISTS { ?h wdt:P3999 ?closed }
    OPTIONAL { ?h rdfs:label ?en FILTER(LANG(?en) = "en") } OPTIONAL { ?h rdfs:label ?any }
    OPTIONAL { ?h wdt:P131 ?adm. ?adm rdfs:label ?admL FILTER(LANG(?admL) = "en") } OPTIONAL { ?h wdt:P856 ?web } }
    GROUP BY ?h ?sl ORDER BY DESC(?sl) LIMIT 40`);
  const all = await sparql(`SELECT ?m ?mLabel ?coord ?admLabel ?addr ?op ?c2 WHERE {
    ?m wdt:P31 ?type. VALUES ?root { wd:Q3917681 wd:Q7843791 } ?type wdt:P279* ?root. ?m wdt:P17 ?c2. ?c2 wdt:P297 "${cc}".
    FILTER NOT EXISTS { ?m wdt:P576 ?end }
    OPTIONAL { ?m wdt:P137 ?op } OPTIONAL { ?m wdt:P625 ?coord } OPTIONAL { ?m wdt:P131 ?adm } OPTIONAL { ?m wdt:P6375 ?addr }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 3000`);
  const posts = all && all.filter((m) => /Q30$|Q789915$/.test(m.op || "") || /United States|\bU\.S\.|\bUS (Embassy|Consulate)|American (Embassy|Consulate)/.test(m.mLabel || ""));
  const ports = await sparql(`SELECT ?p ?sl (SAMPLE(?en) AS ?pLabel) (SAMPLE(?coord) AS ?coord) (SAMPLE(?lc) AS ?locode) WHERE { ${C}
    ?p wdt:P31 ?type. VALUES ?type { wd:Q44782 wd:Q283202 wd:Q2143825 wd:Q721207 }
    ?p wdt:P17 ?c; wdt:P625 ?coord; wikibase:sitelinks ?sl. OPTIONAL { ?p wdt:P1937 ?lc }
    FILTER NOT EXISTS { ?p wdt:P576 ?end } OPTIONAL { ?p rdfs:label ?en FILTER(LANG(?en) = "en") } }
    GROUP BY ?p ?sl ORDER BY DESC(?sl) LIMIT 30`);
  fs.writeFileSync(`${OUT}/${cc.toLowerCase()}.json`, JSON.stringify({ cc, hosp, posts, ports }));
  log.push(`${cc} ${Math.round((Date.now() - t) / 1000)}s hospitals ${hosp ? hosp.length : "fail"} posts ${posts ? posts.length : "fail"} ports ${ports ? ports.length : "fail"}`);
  console.log(log[log.length - 1]);
  fs.writeFileSync(`${OUT}/log.txt`, log.join("\n") + "\n");
}
const queue = [...CCS];
await Promise.all([0, 1, 2, 3].map(async () => {
  while (queue.length) {
    if (Date.now() - T0 > DEADLINE) { log.push("deadline: skipped " + queue.splice(0).join(" ")); break; }
    await one(queue.shift());
  }
}));
fs.writeFileSync(`${OUT}/log.txt`, log.join("\n") + "\n");
console.log(log.join("\n"));
