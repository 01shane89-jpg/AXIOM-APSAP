// One-off diagnostic, run by hand from the workflow (only=probe): prints the shape of the free tropical-cyclone
// sources so the parser in refresh_storms.mjs matches what they really return. Writes nothing.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 (AXIOM-ASAP)";
async function get(u) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), 30000);
  try { const r = await fetch(u, { signal: c.signal, headers: { "user-agent": UA } }); return { status: r.status, text: await r.text() }; }
  catch (e) { return { status: 0, text: String(e.message) }; } finally { clearTimeout(t); }
}
function shape(v, d = 0) {
  if (Array.isArray(v)) return v.length ? "[" + v.length + "× " + shape(v[0], d + 1) + (v.length > 1 && d < 2 ? " | last: " + shape(v[v.length - 1], d + 1) : "") + "]" : "[]";
  if (v && typeof v === "object") return "{" + Object.entries(v).slice(0, 30).map(([k, x]) => k + ":" + (d > 4 ? "…" : shape(x, d + 1))).join(", ") + "}";
  return JSON.stringify(v).slice(0, 60);
}
async function show(label, u, raw = 1500) {
  const r = await get(u);
  console.log("\n=== " + label + " " + u + " -> " + r.status + " (" + r.text.length + " chars)");
  try { console.log(shape(JSON.parse(r.text)).slice(0, 6000)); } catch { console.log(r.text.slice(0, raw)); }
  return r;
}
const t = await show("JMA list", "https://www.jma.go.jp/bosai/typhoon/data/targetTc.json");
let tcs = []; try { tcs = JSON.parse(t.text); } catch {}
for (const x of tcs.slice(0, 3)) {
  const id = x.tropicalCyclone || x.tc || x.id || Object.values(x)[0];
  await show("JMA spec " + id, "https://www.jma.go.jp/bosai/typhoon/data/" + id + "/specifications.json");
  await show("JMA forecast " + id, "https://www.jma.go.jp/bosai/typhoon/data/" + id + "/forecast.json");
}
const rss = await get("https://www.gdacs.org/xml/rss.xml");
const tc = [...rss.text.matchAll(/<gdacs:eventtype>TC<\/gdacs:eventtype>[\s\S]*?<gdacs:eventid>(\d+)<\/gdacs:eventid>[\s\S]*?<gdacs:episodeid>(\d+)<\/gdacs:episodeid>/g)].slice(0, 2);
console.log("\nGDACS TC events in RSS:", tc.map((m) => m[1] + "/" + m[2]).join(", "));
for (const [, id, ep] of tc) {
  const g = await get("https://www.gdacs.org/datareport/resources/TC/" + id + "/geojson_" + id + "_" + ep + ".geojson");
  console.log("\n=== GDACS geojson " + id + "_" + ep + " -> " + g.status + " (" + g.text.length + ")");
  try {
    const j = JSON.parse(g.text), cls = {};
    for (const f of j.features || []) { const k = (f.properties.Class || f.properties.class || "?") + "/" + f.geometry.type; (cls[k] = cls[k] || []).push(f); }
    for (const [k, fs] of Object.entries(cls)) {
      console.log(k, fs.length);
      for (const f of [fs[0], fs[fs.length - 1]]) console.log("   ", JSON.stringify(f.properties).slice(0, 700), JSON.stringify(f.geometry.coordinates).slice(0, 120));
    }
  } catch { console.log(g.text.slice(0, 800)); }
  await show("GDACS geteventdata", "https://www.gdacs.org/gdacsapi/api/events/geteventdata?eventtype=TC&eventid=" + id, 800);
}
await show("GDACS list SEARCH", "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC", 600);
await show("GDACS list MAP eventtype", "https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventtype=TC", 600);
const j = await show("JTWC rss", "https://www.metoc.navy.mil/jtwc/rss/jtwc.rss", 3000);
const w = (j.text.match(/https?:\/\/[^"'<\s]+(?:web|wrn)?\.txt/gi) || []).slice(0, 2);
for (const u of w) await show("JTWC warning", u.replace(/&amp;/g, "&"), 3000);
const rw = await fetch("https://api.reliefweb.int/v2/reports?appname=axiom-asap", { method: "POST", headers: { "content-type": "application/json", "user-agent": UA },
  body: JSON.stringify({ limit: 2, filter: { field: "date.created", value: { from: new Date(Date.now() - 9 * 864e5).toISOString().slice(0, 19) + "+00:00" } } }) }).catch((e) => ({ status: 0, text: async () => e.message }));
console.log("\n=== ReliefWeb API", rw.status, (await rw.text()).slice(0, 500));
await show("ReliefWeb RSS", "https://reliefweb.int/updates/rss.xml?search=primary_country.iso3:phl", 600);
