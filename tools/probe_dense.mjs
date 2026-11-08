// PROBE BRANCH ONLY: batch 2 (signals/measurement) candidates + UN peacekeeping CSV columns + EU FSF retry.
const UA = "AXIOM-OSAP/1.0 (situational awareness; hourly; +https://github.com/01shane89-jpg/AXIOM-APSAP)";
const P = (tag, s) => console.log("PX " + tag + " | " + String(s).replace(/\s+/g, " ").slice(0, 1800));
async function show(tag, u, n = 1200) {
  try { const r = await fetch(u, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(40000) }); const t = await r.text(); P(tag, r.status + " " + r.headers.get("content-type") + " " + t.length + " " + t.slice(0, n)); return t; }
  catch (e) { P(tag, "ERR " + (e.cause ? e.cause.code || e.cause.message : e.message)); return ""; }
}
await show("celestrak-recon", "https://celestrak.org/NORAD/elements/gp.php?GROUP=military&FORMAT=json", 900);
await show("celestrak-resource", "https://celestrak.org/NORAD/elements/gp.php?GROUP=resource&FORMAT=json", 400);
await show("celestrak-radar", "https://celestrak.org/NORAD/elements/gp.php?GROUP=radar&FORMAT=json", 400);
await show("usgs-explosion", "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&eventtype=explosion,quarry%20blast,nuclear%20explosion,chemical%20explosion,mine%20collapse,sonic%20boom,experimental%20explosion,industrial%20explosion,mining%20explosion,other%20event&starttime=" + new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10) + "&limit=20", 1500);
await show("usgs-types", "https://earthquake.usgs.gov/fdsnws/event/1/application.json", 1500);
await show("eurdep-wfs", "https://remap.jrc.ec.europa.eu/api/maps/api/v1/stations?f=json", 600);
await show("eurdep-gm", "https://remap.jrc.ec.europa.eu/GammaDoseRates.aspx", 400);
await show("eurdep-geo", "https://remon.jrc.ec.europa.eu/api/public/stations", 400);
await show("radnet", "https://www.epa.gov/radnet/radnet-csv-file-downloads", 400);
await show("radnet-data", "https://radnet.epa.gov/cdx-radnet-rest/api/rest/csv/2026/fixed/AK/ANCHORAGE", 400);
await show("ripe-ris", "https://stat.ripe.net/data/bgp-updates/data.json?resource=AS12880&starttime=" + new Date(Date.now() - 3600e3).toISOString().slice(0, 19), 600);
await show("ripe-country-routing", "https://stat.ripe.net/data/country-routing-stats/data.json?resource=IR", 600);
await show("ripe-visibility", "https://stat.ripe.net/data/country-resource-stats/data.json?resource=IR&resolution=1d&starttime=" + new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10), 900);
await show("grip-bgp", "https://api.grip.inetintel.cc.gatech.edu/json/events?length=5&start=0&ts_start=" + new Date(Date.now() - 864e5).toISOString().slice(0, 19), 1200);
await show("adsblol-mil", "https://api.adsb.lol/v2/mil", 500);
try { const r = await fetch("https://data.humdata.org/dataset/819dce10-ac8a-4960-8756-856a9f72d820/resource/7f738eb4-6f77-4b5c-905a-ed6d45cc5515/download/dppadposs-pko.csv", { headers: { "user-agent": UA } }); const t = await r.text(); P("pk-csv", r.status + " " + t.length + " " + t.split("\n").slice(0, 4).join(" // ")); } catch (e) { P("pk-csv", "ERR " + e.message); }
try { const r = await fetch("https://data.humdata.org/dataset/f6b91534-494c-45b1-97a4-cd01bafb4e72/resource/b1efbe57-2bbe-4f3b-9b05-6c2c2e891822/download/dpo-postsactual.csv", { headers: { "user-agent": UA } }); const t = await r.text(); P("pk-posts", r.status + " " + t.length + " " + t.split("\n").slice(0, 3).join(" // ")); } catch (e) { P("pk-posts", "ERR " + e.message); }
await show("hdx-pk-fatal", "https://data.humdata.org/api/3/action/package_search?q=peacekeeping%20fatalities%20dpo&rows=5", 300);
try { const r = await fetch("https://data.humdata.org/api/3/action/package_search?q=fatalities+peacekeeping&rows=8", { headers: { "user-agent": UA } }); const j = await r.json(); for (const d of j.result.results) P("hdx-f", d.name + " | " + d.license_title + " | " + (d.resources || []).map((x) => x.url).slice(0, 2).join(" ")); } catch (e) {}
for (const u of ["https://webgate.ec.europa.eu/fsd/fsf/public/files/csvFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw", "https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList/content?token=dG9rZW4tMjAxNw", "https://webgate.ec.europa.eu/fsd/fsf/public/rss"]) await show("eu " + u.slice(40, 100), u, 300);
