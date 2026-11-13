// Test only: night lights + Sentinel-1 radar probe. Prints results; writes nothing.
const ORIGIN = "https://axiom-osap.netlify.app";
async function get(u, quiet) {
  const t0 = Date.now();
  try {
    const r = await fetch(u, { headers: { Origin: ORIGIN }, signal: AbortSignal.timeout(60000) });
    const ct = r.headers.get("content-type") || "", b = Buffer.from(await r.arrayBuffer());
    if (!quiet) console.log(`${r.status} ${Date.now() - t0}ms acao=${r.headers.get("access-control-allow-origin")} ct=${ct} len=${b.length} ${u.slice(0, 240)}`);
    return { r, b, ct };
  } catch (e) { console.log(`ERR ${e.message} ${u.slice(0, 200)}`); return {}; }
}
const G = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/";
const cap = await get(G + "1.0.0/WMTSCapabilities.xml");
const xml = cap.b ? cap.b.toString() : "";
const layers = xml.split("<Layer>").slice(1);
const want = /DayNight|Black_Marble|CityLights|OPERA|RTC|Sentinel-?1|S1_|Nighttime|NightLights|_DNB/i;
const found = [];
for (const L of layers) {
  const id = (L.match(/<ows:Identifier>([^<]+)<\/ows:Identifier>/) || [])[1] || "";
  if (!want.test(id)) continue;
  const tms = [...L.matchAll(/<TileMatrixSet>([^<]+)<\/TileMatrixSet>/g)].map(m => m[1]).join(",");
  const fmt = [...L.matchAll(/<Format>([^<]+)<\/Format>/g)].map(m => m[1]).join(",");
  const def = (L.match(/<Default>([^<]+)<\/Default>/) || [])[1] || "";
  const vals = [...L.matchAll(/<Value>([^<]+)<\/Value>/g)].map(m => m[1]);
  const title = (L.match(/<ows:Title[^>]*>([^<]+)<\/ows:Title>/) || [])[1] || "";
  const tpl = (L.match(/template="([^"]+)"/) || [])[1] || "";
  console.log(`LAYER ${id} | ${title} | tms=${tms} fmt=${fmt} default=${def} times=${vals.slice(0, 2).join(" ")} … ${vals.slice(-2).join(" ")} (${vals.length}) tpl=${tpl.slice(-60)}`);
  found.push({ id, tms, fmt, def, tpl });
}
// tile tests: Bangkok + Kyiv + Manila at z6/z8; default time and a few recent days
const tiles = { z5: "5/24/14", z6: "6/49/29", z8: "8/199/118", z7kyiv: "7/77/43", z8manila: "8/217/115" };
const now = Date.now();
for (const f of found) {
  const ext = /jpeg/.test(f.fmt) ? "jpg" : "png";
  const tm = f.tms.split(",")[0];
  const days = ["default"]; for (let k = 0; k < 4; k++) days.push(new Date(now - k * 864e5).toISOString().slice(0, 10));
  if (f.def && !days.includes(f.def)) days.push(f.def);
  for (const d of days) for (const [n, t] of Object.entries(tiles)) {
    const z = +t.split("/")[0]; if (/Level(\d+)/.test(tm) && z > +tm.match(/Level(\d+)/)[1]) continue;
    const g = await get(`${G}${f.id}/default/${d}/${tm}/${t}.${ext}`, true);
    console.log(`TILE ${f.id} ${d} ${n} -> ${g.r ? g.r.status : "ERR"} len=${g.b ? g.b.length : 0} acao=${g.r ? g.r.headers.get("access-control-allow-origin") : ""}`);
  }
}
// CMR: OPERA RTC-S1 granules (keyless) over Bangkok / Kyiv / Manila, newest first
for (const [sn, bb] of [["OPERA_L2_RTC-S1_V1", "100.45,13.65,100.65,13.85"], ["OPERA_L2_RTC-S1_V1", "30.4,50.35,30.6,50.55"], ["OPERA_L2_RTC-S1_V1", "120.9,14.5,121.1,14.7"], ["SENTINEL-1A_SLC", "100.45,13.65,100.65,13.85"]]) {
  const c = await get(`https://cmr.earthdata.nasa.gov/search/granules.json?short_name=${sn}&bounding_box=${bb}&sort_key=-start_date&page_size=5`);
  if (c.b) { try { const j = JSON.parse(c.b); (j.feed.entry || []).forEach(e => console.log("CMR", sn, e.title, e.time_start, e.id, (e.links || []).filter(l => /browse|png|tif/i.test(l.href || "")).slice(0, 3).map(l => l.href).join(" "))); } catch (e) { console.log(c.b.toString().slice(0, 300)); } }
}
// CMR collections: OPERA RTC / DSWx-S1 / Sentinel-1 browse
const cc = await get("https://cmr.earthdata.nasa.gov/search/collections.json?keyword=OPERA%20RTC-S1&page_size=10");
if (cc.b) try { JSON.parse(cc.b).feed.entry.forEach(e => console.log("COLL", e.short_name, e.title, e.time_start)); } catch (e) {}
// Earth Search sentinel-1-grd presence + Planetary Computer sentinel-1-rtc
await get("https://earth-search.aws.element84.com/v1/collections/sentinel-1-grd");
const pc = await get("https://planetarycomputer.microsoft.com/api/stac/v1/search?collections=sentinel-1-rtc&bbox=100.45,13.65,100.65,13.85&limit=3&sortby=-datetime");
if (pc.b) try { JSON.parse(pc.b).features.forEach(f => console.log("PC", f.id, f.properties.datetime, f.assets.tilejson && f.assets.tilejson.href)); } catch (e) { console.log(pc.b.toString().slice(0, 300)); }
const pg = await get("https://planetarycomputer.microsoft.com/api/stac/v1/search?collections=sentinel-1-grd&bbox=100.45,13.65,100.65,13.85&limit=3&sortby=-datetime");
if (pg.b) try { JSON.parse(pg.b).features.forEach(f => { console.log("PCGRD", f.id, f.properties.datetime, f.assets.tilejson && f.assets.tilejson.href); }); } catch (e) {}
