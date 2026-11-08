// Test only: checks the keyless hosts the "Newest imagery" picker would use. Prints results; writes nothing.
const ORIGIN = "https://axiom-osap.netlify.app";
const bb = [100.45, 13.65, 100.65, 13.85]; // Bangkok
const now = Date.now(), from = new Date(now - 40 * 864e5).toISOString().slice(0, 19) + "Z", to = new Date(now).toISOString().slice(0, 19) + "Z";
async function get(u, opt = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(u, { headers: { Origin: ORIGIN, ...(opt.headers || {}) }, method: opt.method || "GET", body: opt.body, signal: AbortSignal.timeout(30000) });
    const ct = r.headers.get("content-type") || "", acao = r.headers.get("access-control-allow-origin");
    let body = null, len = 0;
    if (/json/.test(ct)) { body = await r.json(); len = JSON.stringify(body).length; } else { const b = await r.arrayBuffer(); len = b.byteLength; }
    console.log(`${r.status} ${Date.now() - t0}ms acao=${acao} ct=${ct} len=${len} ${u.slice(0, 200)}`);
    return { r, body };
  } catch (e) { console.log(`ERR ${e.message} ${u.slice(0, 200)}`); return {}; }
}
function sum(f) { const p = f.properties || {}; return { id: f.id, dt: p.datetime, cloud: p["eo:cloud_cover"], plat: p.platform, assets: Object.fromEntries(Object.entries(f.assets || {}).filter(([k]) => /visual|rendered|preview|thumb|tilejson|red|browse/i.test(k)).map(([k, a]) => [k, (a.href || "").slice(0, 160)])), links: (f.links || []).filter(l => /preview|tile/i.test(l.rel)).map(l => l.rel + " " + (l.href || "").slice(0, 200)) }; }
const ES = "https://earth-search.aws.element84.com/v1";
for (const c of ["sentinel-2-l2a", "sentinel-2-c1-l2a", "landsat-c2-l2"]) {
  const { body } = await get(`${ES}/search?collections=${c}&bbox=${bb}&datetime=${from}/${to}&limit=3&sortby=-properties.datetime`);
  (body?.features || []).slice(0, 2).forEach(f => console.log(JSON.stringify(sum(f))));
}
const PC = "https://planetarycomputer.microsoft.com/api/stac/v1";
for (const c of ["landsat-c2-l2", "sentinel-2-l2a"]) {
  const { body } = await get(`${PC}/search?collections=${c}&bbox=${bb}&datetime=${from}/${to}&limit=3&sortby=-datetime`);
  const fs = body?.features || [];
  fs.slice(0, 2).forEach(f => console.log(JSON.stringify(sum(f))));
  if (fs[0]) {
    const tj = (fs[0].links || []).find(l => l.rel === "tilejson") || fs[0].assets?.tilejson;
    if (tj) { const { body: t } = await get(tj.href); console.log("tilejson", JSON.stringify(t).slice(0, 600)); if (t?.tiles?.[0]) await get(t.tiles[0].replace("{z}", "12").replace("{x}", "3189").replace("{y}", "1882")); }
    const pv = fs[0].assets?.rendered_preview; if (pv) await get(pv.href);
  }
}
await get("https://planetarycomputer.microsoft.com/api/sas/v1/token/landsat-c2");
const LL = "https://landsatlook.usgs.gov/stac-server";
{ const { body } = await get(`${LL}/search?collections=landsat-c2l2-sr&bbox=${bb}&datetime=${from}/${to}&limit=3`, {});
  const fs = body?.features || []; fs.slice(0, 2).forEach(f => console.log(JSON.stringify(sum(f))));
  for (const k of ["reduced_resolution_browse", "thumbnail"]) if (fs[0]?.assets?.[k]) await get(fs[0].assets[k].href); }
// GIBS: HLS and daily layers, newest dates from capabilities
const cap = await (await fetch("https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml", { signal: AbortSignal.timeout(60000) })).text();
console.log("GIBS caps bytes", cap.length);
const layers = cap.split("<Layer>").slice(1);
for (const L of layers) {
  const id = (L.match(/<ows:Identifier>([^<]+)</) || [])[1] || "";
  if (!/HLS|Landsat|Sentinel|CorrectedReflectance_TrueColor|MODIS_Terra_CorrectedReflectance_TrueColor|VIIRS_.*CorrectedReflectance_TrueColor|BlueMarble/i.test(id)) continue;
  const tms = (L.match(/<TileMatrixSet>([^<]+)</) || [])[1], fmt = (L.match(/<Format>([^<]+)</) || [])[1];
  const dim = (L.match(/<Value>([^<]+)<\/Value>\s*<\/Dimension>/) || [])[1] || (L.match(/<Dimension>[\s\S]*?<\/Dimension>/) || [""])[0].replace(/\s+/g, " ").slice(-200);
  const def = (L.match(/<Default>([^<]+)</) || [])[1];
  console.log("GIBS", id, tms, fmt, "default=" + def, "values(tail)=" + String(dim).slice(-120));
}
for (const id of ["HLS_S30_Nadir_BRDF_Adjusted_Reflectance", "HLS_L30_Nadir_BRDF_Adjusted_Reflectance"]) {
  for (const d of [0, 1, 2, 3, 5, 8].map(k => new Date(now - k * 864e5).toISOString().slice(0, 10)))
    await get(`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${id}/default/${d}/GoogleMapsCompatible_Level12/10/797/470.png`);
}
