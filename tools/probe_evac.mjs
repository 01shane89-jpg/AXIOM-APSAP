// Test only: checks the free, no-key sources for the embassy and evacuation points layer. Prints to the log.
const UA = { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) OSAP-probe/1.0 (+https://01shane89-jpg.github.io/AXIOM-APSAP/)", "Accept": "*/*" };
async function get(u, opt = {}) {
  try { const r = await fetch(u, { ...opt, headers: { ...UA, ...(opt.headers || {}) }, signal: AbortSignal.timeout(90000) }); const t = await r.text(); return [r.status, t]; }
  catch (e) { return [0, String(e)]; }
}
async function sparql(q) { const [s, t] = await get("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(q), { headers: { Accept: "application/sparql-results+json" } }); try { return [s, JSON.parse(t).results.bindings]; } catch { return [s, t.slice(0, 300)]; } }
for (const c of ["Ghana", "Thailand", "Angola"]) {
  const [s, t] = await get(`https://travel.state.gov/content/travel/en/international-travel/International-Travel-Country-Information-Pages/${c}.html`);
  const i = t.indexOf("Telephone"); console.log("TSG", c, s, t.length, i >= 0 ? JSON.stringify(t.slice(Math.max(0, i - 600), i + 400).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")) : "no Telephone");
}
for (const u of ["https://gh.usembassy.gov/embassy/accra/", "https://ao.usembassy.gov/"]) { const [s, t] = await get(u); console.log("USEMB", u, s, t.length); }
let [s, b] = await sparql(`SELECT ?m ?mLabel ?cc ?coord ?phone ?web ?addr ?typeLabel WHERE {
  ?m wdt:P137 ?op . VALUES ?op { wd:Q30 wd:Q789915 } ?m wdt:P31 ?type . ?type wdt:P279* wd:Q7843791 .
  OPTIONAL { ?m wdt:P17 ?c . ?c wdt:P297 ?cc } OPTIONAL { ?m wdt:P625 ?coord } OPTIONAL { ?m wdt:P1329 ?phone } OPTIONAL { ?m wdt:P856 ?web } OPTIONAL { ?m wdt:P6375 ?addr }
  FILTER NOT EXISTS { ?m wdt:P576 ?end } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`);
console.log("WD missions", s, Array.isArray(b) ? b.length : b);
if (Array.isArray(b)) { console.log("with coord", b.filter(x => x.coord).length, "phone", b.filter(x => x.phone).length, "addr", b.filter(x => x.addr).length, "cc", new Set(b.map(x => x.cc && x.cc.value)).size); console.log(JSON.stringify(b.slice(0, 3))); }
[s, b] = await sparql(`SELECT ?cls ?clsLabel (COUNT(?x) AS ?n) WHERE { ?cls rdfs:label "border crossing"@en . ?x wdt:P31 ?cls . SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } GROUP BY ?cls ?clsLabel`);
console.log("WD border crossing classes", s, JSON.stringify(b));
for (const h of ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]) {
  const [s2, t2] = await get(h, { method: "POST", body: "data=" + encodeURIComponent('[out:json][timeout:170];nwr["barrier"="border_control"];out count;'), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  console.log("OVERPASS", h, s2, t2.slice(0, 400));
  if (s2 === 200) break;
}
