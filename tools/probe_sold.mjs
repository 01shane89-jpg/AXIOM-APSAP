// Test only (branch claude/sold-sources-probe, never merge): round 4. Prints to the log.
const UA = "AXIOM-OSAP/1.0 (+https://axiom-osap.netlify.app; source probe)";
async function get(url, opt = {}) { const r = await fetch(url, { method: opt.body ? "POST" : "GET", body: opt.body, headers: { "User-Agent": UA, ...(opt.h || {}) }, signal: AbortSignal.timeout(opt.to || 120000) }); return [r.status, await r.text()]; }
try {
  const [st, t] = await get("https://severeweather.wmo.int/v2/json/wmo_all.json"); const j = JSON.parse(t);
  console.log("SWIC", st, j.itemCount, "keys:", Object.keys(j).join(","));
  console.log("SWIC item0", JSON.stringify(j.items[0]).slice(0, 1500));
  const by = {}; for (const i of j.items) { const k = (i.capURL || i.url || i.id || "").split("/")[2] + " " + (i.countryCode || i.cc || i.iso || ""); by[k] = (by[k] || 0) + 1; }
  console.log("SWIC hosts", JSON.stringify(Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 80)));
} catch (e) { console.log("SWIC ERR", e.message); }
for (const u of ["https://severeweather.wmo.int/v2/json/", "https://severeweather.wmo.int/disclaimer.html", "https://severeweather.wmo.int/about.html", "https://severeweather.wmo.int/"]) {
  try { const [st, t] = await get(u); console.log("PAGE", u, st, (t.match(/[^<>]{0,160}(copyright|licen[cs]e|terms|disclaimer|commercial|redistribut|reproduc)[^<>]{0,200}/gi) || []).slice(0, 8).join(" || ").replace(/\s+/g, " ")); } catch (e) { console.log("PAGE ERR", u, e.message); }
}
const pp = async (label, sql) => { try { const [st, t] = await get("https://postpass.geofabrik.de/api/0.2/interpreter", { body: new URLSearchParams({ data: sql }), h: { "Content-Type": "application/x-www-form-urlencoded" }, to: 240000 }); console.log(label, st, t.length, t.slice(0, 600).replace(/\s+/g, " ")); } catch (e) { console.log(label, "ERR", e.message); } };
await pp("PP cables", "SELECT ST_StartPoint(geom) AS geom, tags->>'name' AS name, tags->>'operator' AS op FROM postpass_line WHERE tags->>'communication'='line' AND tags->>'location'='underwater' LIMIT 3");
await pp("PP cables count", "SELECT ST_Collect(ST_StartPoint(geom)) AS geom, count(*) AS n FROM postpass_line WHERE tags->>'communication'='line' AND tags->>'location'='underwater'");
await pp("PP submarine", "SELECT ST_Collect(ST_StartPoint(geom)) AS geom, count(*) AS n FROM postpass_line WHERE tags->>'submarine'='yes' AND tags ? 'communication'");
await pp("PP landing pts", "SELECT ST_Collect(geom) AS geom, count(*) AS n FROM postpass_point WHERE tags->>'telecom'='landing_point' OR tags->>'man_made'='cable_landing_point' OR tags->>'telecom'='cable_landing'");
try { const [st, t] = await get("https://scsanctions.un.org/resources/xml/en/consolidated.xml"); const n = (t.match(/<INDIVIDUAL>/g) || []).length, e = (t.match(/<ENTITY>/g) || []).length; const nat = (t.match(/<NATIONALITY>\s*<VALUE>[^<]+/g) || []).length; console.log("UN", st, "individuals", n, "entities", e, "nationality values", nat, t.match(/<NATIONALITY>[\s\S]{0,120}/)?.[0].replace(/\s+/g, " "), t.match(/<ENTITY_ADDRESS>[\s\S]{0,200}/)?.[0].replace(/\s+/g, " ")); } catch (e) { console.log("UN ERR", e.message); }
for (const u of ["https://www.ransomlook.io/api", "https://www.ransomlook.io/terms", "https://github.com/RansomLook/RansomLook/blob/main/README.md", "https://www.gdacs.org/About/termsofuse.aspx", "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;DR;WF&alertlevel=green;orange;red&fromDate=2026-11-01"]) {
  try { const [st, t] = await get(u); console.log("PAGE", u, st, t.length, (t.match(/[^<>"]{0,160}(licen[cs]e|CC[- ]BY|commercial|terms|attribution|reproduc)[^<>"]{0,200}/gi) || []).slice(0, 6).join(" || ").replace(/\s+/g, " ").slice(0, 1200)); } catch (e) { console.log("PAGE ERR", u, e.message); }
}
