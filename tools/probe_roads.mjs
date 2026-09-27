// One-off probe: which free, no-key road-closure feeds answer from a GitHub runner. Prints status, size and a short sample only.
const C = [
  ["nz", "NZTA delays", "https://www.journeys.nzta.govt.nz/assets/map-data-cache/delays.json"],
  ["nz", "NZTA roadworks", "https://www.journeys.nzta.govt.nz/assets/map-data-cache/roadworks.json"],
  ["cn-hk", "HK TD special traffic news", "https://resource.data.one.gov.hk/td/en/specialtrafficnews.xml"],
  ["tw", "Taiwan freeway incidents", "https://tisvcloud.freeway.gov.tw/history/motc20/Incident.xml"],
  ["tw", "Taiwan THB road events", "https://thbapp.thb.gov.tw/opendata/section/list1.xml"],
  ["nl", "NDW status messages", "https://opendata.ndw.nu/actuele_statusberichten.xml.gz"],
  ["nl", "NDW roadworks", "https://opendata.ndw.nu/wegwerkzaamheden.xml.gz"],
  ["fr", "Bison Fute DIR events", "https://tipi.bison-fute.gouv.fr/bison-fute-ouvert/publicationsDIR/Evenementiel-DIR/grt/RRN/content.xml"],
  ["au-sa", "SA traffic events", "https://maps.sa.gov.au/arcgis/rest/services/DPTIExtTransport/TrafficSA/MapServer/0/query?where=1%3D1&outFields=*&f=json&resultRecordCount=5"],
  ["au-wa", "WA Main Roads incidents", "https://services2.arcgis.com/cHGEnmsJ165IBJRM/arcgis/rest/services/WebEoc_RoadIncidents/FeatureServer/1/query?where=1%3D1&outFields=*&f=json&resultRecordCount=5"],
  ["au-tas", "Tasmania road closures", "https://www.transport.tas.gov.au/roadcl/rss"],
  ["jp", "JARTIC open data", "https://www.jartic.or.jp/"],
  ["us", "WSDOT alerts (keyless RSS)", "https://wsdot.com/Traffic/api/HighwayAlerts/HighwayAlertsREST.svc/GetAlertsAsJson"],
  ["ca-on", "Ontario 511 events", "https://511on.ca/api/v2/get/event?format=json"],
  ["ca-bc", "DriveBC open511 events", "https://api.open511.gov.bc.ca/events?format=json&limit=5"],
  ["ca-ab", "Alberta 511 events", "https://511.alberta.ca/api/v2/get/event?format=json"],
  ["be", "Belgium Wallonia traffic", "https://trafiroutes.wallonie.be/trafiroutes/Evenements_FR.rss"],
  ["ie", "Ireland TII events", "https://data.tii.ie/Datasets/Its/DatexII/TrafficEvents/Content.xml"],
  ["fi", "Finland Digitraffic road messages", "https://tie.digitraffic.fi/api/traffic-message/v1/messages?inactiveHours=0&includeAreaGeometry=false&situationType=TRAFFIC_ANNOUNCEMENT"],
  ["no", "Norway Vegvesen DATEX (needs login?)", "https://datex-server-get-v3-1.atlas.vegvesen.no/datexapi/GetSituation/pullsnapshotdata"],
  ["osm", "Overpass test", "https://overpass-api.de/api/status"],
  ["tiles", "OpenTopoMap tile", "https://a.tile.opentopomap.org/5/25/14.png"],
  ["tiles", "OSM tile", "https://tile.openstreetmap.org/5/25/14.png"],
  ["tiles", "OpenFreeMap style", "https://tiles.openfreemap.org/styles/liberty"],
  ["flood", "JRC GSW occurrence tile", "https://storage.googleapis.com/global-surface-water/tiles2021/occurrence/6/50/29.png"],
  ["flood", "JRC GSW recurrence tile", "https://storage.googleapis.com/global-surface-water/tiles2021/recurrence/6/50/29.png"],
  ["flood", "GIBS MODIS flood 3-day tile", "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Combined_Flood_3-Day/default/2026-09-25/GoogleMapsCompatible_Level9/6/29/50.png"],
  ["flood", "GIBS MODIS flood 2-day tile", "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Combined_Flood_2-Day/default/2026-09-25/GoogleMapsCompatible_Level9/6/29/50.png"],
  ["flood", "GFM WMS capabilities", "https://geoserver.gfm.eodc.eu/geoserver/gfm/wms?service=WMS&request=GetCapabilities"],
  ["flood", "GFM ows capabilities", "https://geoserver.gfm.eodc.eu/geoserver/ows?service=WMS&request=GetCapabilities"],
  ["flood", "JRC flood hazard catalogue", "https://data.jrc.ec.europa.eu/api/3/action/package_show?id=jrc-floods-floodmapgl_rp100y-tif"],
  ["tiles", "GIBS Blue Marble tile", "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/2004-08-01/GoogleMapsCompatible_Level8/5/14/25.jpeg"],
];
for (const [cc, name, url] of C) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { "user-agent": "AXIOM-OSAP probe (github.com/01shane89-jpg/AXIOM-APSAP)", accept: "*/*" }, signal: AbortSignal.timeout(20000) });
    const buf = Buffer.from(await r.arrayBuffer());
    let txt = buf.slice(0, 2).toString("hex") === "1f8b" ? "(gzip " + buf.length + " bytes)" : buf.slice(0, 260).toString("utf8").replace(/\s+/g, " ");
    console.log(`${cc} | ${name} | ${r.status} | ${r.headers.get("content-type")} | ${buf.length} B | ${Date.now() - t0} ms | ${txt}`);
  } catch (e) { console.log(`${cc} | ${name} | ERR ${e.name}: ${String(e.message).slice(0, 120)}`); }
}

try {
  const t = await (await fetch("https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml", { signal: AbortSignal.timeout(30000) })).text();
  const ids = [...t.matchAll(/<ows:Identifier>([^<]*(Flood|Water|Relief|Blue)[^<]*)<\/ows:Identifier>/gi)].map(m => m[1]);
  console.log("GIBS layers:", [...new Set(ids)].join(", "));
} catch (e) { console.log("GIBS caps ERR", e.message); }
