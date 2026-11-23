// Probe 5 (23 Nov 2026): the new eia-choke feed run for real (ONLY=eia-choke), plus what it reads.
process.env.ONLY = "eia-choke";
const { runAll } = await import("./dense_lib.mjs");
const { eiaChokepoints } = await import("./dense_nov8_now.mjs");
await runAll(1);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 (AXIOM-ASAP hourly refresh)";
const html = await (await fetch("https://www.eia.gov/international/content/analysis/special_topics/World_Oil_Transit_Chokepoints/", { headers: { "user-agent": UA } })).text();
const L = eiaChokepoints(html);
const cj = await (await fetch("https://services9.arcgis.com/weJ1QsnbMYJlCHdG/ArcGIS/rest/services/PortWatch_chokepoints_database/FeatureServer/0/query?where=1%3D1&outFields=portname,lat,lon&returnGeometry=false&f=json", { headers: { "user-agent": UA } })).json();
const pw = (cj.features || []).map((f) => f.attributes);
console.log("P portwatch names:", pw.map((p) => p.portname + " (" + p.lat.toFixed(1) + "," + p.lon.toFixed(1) + ")").join("; "));
for (const c of L) {
  const near = pw.map((p) => ({ p, d: Math.hypot(p.lat - c.lat, p.lon - c.lon) })).sort((a, b) => a.d - b.d)[0];
  console.log("P", c.name, JSON.stringify({ periods: c.periods, total: c.total, crude: c.crude, products: c.products, lng: c.lng, updated: c.updated }), "nearest PW:", near && near.p.portname, near && near.d.toFixed(2));
}
