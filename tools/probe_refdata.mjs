// Diagnostic (only=probe-refdata): fetches open reference data for the hand-researched country layers that the research
// environment cannot reach itself: the U.S. State Department travel advisory feed, and Wikidata lists of hospitals,
// U.S. diplomatic posts and seaports per country. Writes raw results to probe-out/refdata/ only; nothing in data/.
// The research thread turns them into apsap-sof/1 records by hand (selection, checks, fingerprints).
import fs from "node:fs";

const OUT = "probe-out/refdata";
fs.mkdirSync(OUT, { recursive: true });
const UA = "AXIOM-OSAP reference-data probe (https://github.com/osap-app/osap-app.github.io)";
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

// 2. Per country: hospitals, U.S. posts, seaports from Wikidata's search API (haswbstatement, sorted by incoming links) and
// wbgetentities; SPARQL times out on large countries. Items are written in the same shape the research thread reads.
const T0 = Date.now(), DEADLINE = +(process.env.DEADLINE_MIN || 17) * 60000, API = "https://www.wikidata.org/w/api.php?format=json&";
const QC = {};
for (const b of (await sparql(`SELECT ?c ?cc WHERE { ?c wdt:P297 ?cc; wdt:P31 wd:Q6256 }`)) || []) QC[b.cc] = b.c.split("/").pop();
for (const b of (await sparql(`SELECT ?c ?cc WHERE { ?c wdt:P297 ?cc }`)) || []) QC[b.cc] = QC[b.cc] || b.c.split("/").pop();
// the Kingdom of the Netherlands (Q29999) also carries "NL"; items use the Netherlands (Q55) as their country
QC.NL = "Q55";
async function search(q, n) {
  const t = await get(API + "action=query&list=search&srnamespace=0&srlimit=" + n + "&srsort=incoming_links_desc&srsearch=" + encodeURIComponent(q));
  try { return JSON.parse(t).query.search.map((x) => x.title); } catch (e) { return null; }
}
async function ents(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const t = await get(API + "action=wbgetentities&props=labels|claims|sitelinks&languages=en&ids=" + ids.slice(i, i + 50).join("|"));
    try { out.push(...Object.values(JSON.parse(t).entities)); } catch (e) {}
  }
  return out;
}
const claim = (e, p) => ((e.claims || {})[p] || []).map((c) => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value).filter(Boolean);
const lab = (e) => (e.labels && e.labels.en && e.labels.en.value) || null;
const coord = (e) => { const c = claim(e, "P625")[0]; return c ? `Point(${c.longitude} ${c.latitude})` : null; };
const wd = (e) => "http://www.wikidata.org/entity/" + e.id;
async function one(cc) {
  const q = QC[cc], t = Date.now();
  if (!q) { log.push(`${cc} no QID`); return; }
  const C = `haswbstatement:P17=${q}`;
  const hIds = await search(`haswbstatement:P31=Q16917 ${C} -haswbstatement:P576`, 50);
  const pIds = await search(`haswbstatement:P31=Q44782 ${C} -haswbstatement:P576`, 30);
  const mIds = [...new Set([...((await search(`${C} haswbstatement:P137=Q30`, 20)) || []),
    ...((await search(`haswbstatement:P31=Q3917681 ${C} "United States"`, 20)) || []), ...((await search(`haswbstatement:P31=Q7843791 ${C} "United States"`, 20)) || [])])];
  const E = await ents([...(hIds || []), ...(pIds || []), ...mIds]), byId = Object.fromEntries(E.map((e) => [e.id, e]));
  const adm = await ents([...new Set(E.map((e) => (claim(e, "P131")[0] || {}).id).filter(Boolean))]), admL = Object.fromEntries(adm.map((e) => [e.id, lab(e)]));
  const row = (e) => ({ lab: lab(e), coord: coord(e), sl: String(Object.keys(e.sitelinks || {}).length), adm: admL[(claim(e, "P131")[0] || {}).id] || null });
  const hosp = hIds && hIds.map((i) => byId[i]).filter(Boolean).map((e) => { const r = row(e); return { h: wd(e), hLabel: r.lab, coord: r.coord, sl: r.sl, admLabel: r.adm, web: claim(e, "P856")[0] || null }; })
    .sort((x, y) => y.sl - x.sl);
  const ports = pIds && pIds.map((i) => byId[i]).filter(Boolean).map((e) => { const r = row(e); return { p: wd(e), pLabel: r.lab, coord: r.coord, sl: r.sl, locode: claim(e, "P1937")[0] || null }; })
    .sort((x, y) => y.sl - x.sl);
  const posts = mIds.map((i) => byId[i]).filter(Boolean).filter((e) => claim(e, "P137").some((v) => v.id === "Q30" || v.id === "Q789915") || /United States|\bU\.S\.|American (Embassy|Consulate)/.test(lab(e) || ""))
    .filter((e) => !claim(e, "P576").length).map((e) => { const r = row(e); return { m: wd(e), mLabel: r.lab, coord: r.coord, admLabel: r.adm, addr: claim(e, "P6375").map((v) => v.text)[0] || null }; });
  fs.writeFileSync(`${OUT}/${cc.toLowerCase()}.json`, JSON.stringify({ cc, hosp, posts, ports }));
  log.push(`${cc} ${Math.round((Date.now() - t) / 1000)}s hospitals ${hosp ? hosp.length : "fail"} posts ${posts.length} ports ${ports ? ports.length : "fail"}`);
  console.log(log[log.length - 1]);
  fs.writeFileSync(`${OUT}/log.txt`, log.join("\n") + "\n");
}
const queue = [...CCS];
await Promise.all([0, 1].map(async () => {
  while (queue.length) {
    if (Date.now() - T0 > DEADLINE) { log.push("deadline: skipped " + queue.splice(0).join(" ")); break; }
    await one(queue.shift());
  }
}));
fs.writeFileSync(`${OUT}/log.txt`, log.join("\n") + "\n");
console.log(log.join("\n"));
