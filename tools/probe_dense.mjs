// Probe: GIBS MODIS 3-day flood archive dates over Thailand (14 Nov 2026).
const UA = "AXIOM-OSAP/1.0 (open-source situational awareness; +https://01shane89-jpg.github.io/AXIOM-APSAP/)";
const B = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/";
for (const d of ["2026-09-24", "2026-09-25", "2026-10-15", "2026-11-12", "2026-11-13", "2025-01-01", "2023-06-01"]) {
  const u = B + "MODIS_Combined_Flood_3-Day/default/" + d + "/GoogleMapsCompatible_Level9/6/29/49.png";
  try { const r = await fetch(u, { headers: { "user-agent": UA } }); const b = Buffer.from(await r.arrayBuffer()); console.log("P", d, r.status, r.headers.get("content-type"), b.length); } catch (e) { console.log("P", d, "ERR", e.message); }
}
const cap = await (await fetch(B + "1.0.0/WMTSCapabilities.xml", { headers: { "user-agent": UA } })).text();
const i = cap.indexOf("<ows:Identifier>MODIS_Combined_Flood_3-Day</ows:Identifier>");
const blk = cap.slice(Math.max(0, cap.lastIndexOf("<Layer>", i)), cap.indexOf("</Layer>", i));
console.log("P dim", (blk.match(/<Dimension>[\s\S]*?<\/Dimension>/) || [""])[0].replace(/\s+/g, " ").slice(0, 600));
