// Test only: checks the free, no-key sources for the embassy and evacuation points layer. Prints to the log.
const UA = { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) OSAP-probe/1.0 (+https://01shane89-jpg.github.io/AXIOM-APSAP/)", "Accept": "text/html,application/json,*/*" };
async function get(u, opt = {}) {
  try { const r = await fetch(u, { ...opt, headers: { ...UA, ...(opt.headers || {}) }, signal: AbortSignal.timeout(120000) }); const t = await r.text(); return [r.status, t, r.url]; }
  catch (e) { return [0, String(e), u]; }
}
const OP = ["https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
async function op(q) { for (const h of OP) { const [s, t] = await get(h, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" } }); if (s === 200) { try { return JSON.parse(t); } catch { console.log("bad json", h, t.slice(0, 200)); } } else console.log("OP", h, s, t.slice(0, 120)); } return null; }
let j = await op('[out:json][timeout:170];(nwr["office"="diplomatic"]["country"="US"];nwr["amenity"="embassy"]["country"="US"];);out center tags;');
if (j) {
  const e = j.elements; console.log("OSM US missions", e.length, "remark", j.remark || "");
  const k = {}; e.forEach(x => { const d = x.tags.diplomatic || x.tags.amenity; k[d] = (k[d] || 0) + 1; }); console.log(JSON.stringify(k));
  console.log("phone", e.filter(x => x.tags.phone || x.tags["contact:phone"]).length, "addr", e.filter(x => x.tags["addr:street"]).length, "web", e.filter(x => x.tags.website || x.tags["contact:website"]).length);
  console.log(JSON.stringify(e.slice(0, 2)));
}
j = await op('[out:json][timeout:170];nwr["barrier"="border_control"];out center tags qt;');
if (j) {
  const e = j.elements, k = {}; e.forEach(x => Object.keys(x.tags).forEach(t => k[t] = (k[t] || 0) + 1));
  console.log("BC", e.length, JSON.stringify(Object.entries(k).sort((a, b) => b[1] - a[1]).slice(0, 40)));
  console.log(JSON.stringify(e.filter(x => x.tags.name).slice(0, 4)));
}
for (const cc of ["gh", "ao", "th", "uk", "tz", "ml", "kg", "dk", "om", "si"]) {
  const [s, t, u] = await get(`https://${cc}.usembassy.gov/`);
  const txt = t.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ");
  const ph = [...txt.matchAll(/(?:Phone|Tel(?:ephone)?|Emergency|After[- ]hours)[^+0-9(]{0,40}(\+?[0-9][0-9 ()\-.]{6,22}[0-9])/gi)].map(m => m[0]).slice(0, 6);
  console.log("USEMB", cc, s, u, t.length, JSON.stringify(ph));
}
