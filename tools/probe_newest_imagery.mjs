// Test only: checks the keyless hosts the "Newest imagery" picker would use. Prints results; writes nothing.
const ORIGIN = "https://axiom-osap.netlify.app";
async function get(u) {
  const t0 = Date.now();
  try {
    const r = await fetch(u, { headers: { Origin: ORIGIN }, signal: AbortSignal.timeout(30000) });
    const ct = r.headers.get("content-type") || "", b = Buffer.from(await r.arrayBuffer());
    console.log(`${r.status} ${Date.now() - t0}ms acao=${r.headers.get("access-control-allow-origin")} cache=${r.headers.get("cache-control")} ct=${ct} len=${b.length} ${u.slice(0, 220)}`);
    return { r, b, ct };
  } catch (e) { console.log(`ERR ${e.message} ${u.slice(0, 200)}`); return {}; }
}
const L = "https://planetarycomputer.microsoft.com/api/data/v1/item/tiles/WebMercatorQuad/";
const lq = "?collection=landsat-c2-l2&item=LC09_L2SP_129051_20261025_02_T1&assets=red&assets=green&assets=blue&color_formula=gamma%20RGB%202.7,%20saturation%201.5,%20sigmoidal%20RGB%2015%200.55&nodata=0&format=png";
for (const t of ["12/3191/1899", "10/797/474", "8/199/118", "14/12764/7596", "12/3170/1880"]) await get(L + t + "@1x" + lq);
// HLS day coverage around Bangkok z9 tile
const now = Date.now();
for (const id of ["HLS_S30_Nadir_BRDF_Adjusted_Reflectance", "HLS_L30_Nadir_BRDF_Adjusted_Reflectance"])
  for (let k = 3; k < 14; k++) { const d = new Date(now - k * 864e5).toISOString().slice(0, 10); await get(`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${id}/default/${d}/GoogleMapsCompatible_Level12/9/398/236.png`); }
// GIBS DescribeDomains for HLS (dates with data over a bbox)
await get("https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/HLS_S30_Nadir_BRDF_Adjusted_Reflectance/default/GoogleMapsCompatible_Level12/all/2026-10-01--2026-11-08.xml");
const dd = await get("https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/HLS_S30_Nadir_BRDF_Adjusted_Reflectance/default/250m/all/2026-10-01--2026-11-08.xml");
if (dd.b) console.log(dd.b.toString().slice(0, 800));
// CMR granule search for HLS over a bbox (keyless)
const c = await get("https://cmr.earthdata.nasa.gov/search/granules.json?short_name=HLSS30&bounding_box=100.45,13.65,100.65,13.85&sort_key=-start_date&page_size=5");
if (c.b) { try { const j = JSON.parse(c.b); (j.feed.entry || []).forEach(e => console.log("CMR", e.title, e.time_start, e.cloud_cover)); } catch (e) { console.log(c.b.toString().slice(0, 300)); } }
const c2 = await get("https://cmr.earthdata.nasa.gov/search/granules.json?short_name=HLSL30&bounding_box=100.45,13.65,100.65,13.85&sort_key=-start_date&page_size=5");
if (c2.b) { try { const j = JSON.parse(c2.b); (j.feed.entry || []).forEach(e => console.log("CMR", e.title, e.time_start, e.cloud_cover)); } catch (e) {} }
// PC search with only Landsat 8/9 via CQL2 GET
await get("https://planetarycomputer.microsoft.com/api/stac/v1/search?collections=landsat-c2-l2&bbox=100.45,13.65,100.65,13.85&limit=5&sortby=-datetime&filter-lang=cql2-text&filter=" + encodeURIComponent("platform IN ('landsat-8','landsat-9')"));
