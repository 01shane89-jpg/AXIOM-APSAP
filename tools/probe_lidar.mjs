// Test only: asks candidate keyless LiDAR / high-resolution elevation services for a sample answer with the real network and
// prints status, type, size, CORS header and a short peek, so the lidar coverage layer and terrain sources use only services
// that answer a browser with no key. Writes nothing to the repo. Run: node tools/probe_lidar.mjs
const O = "https://01shane89-jpg.github.io";
const tile = (z, lat, lon) => { const n = 2 ** z, r = lat * Math.PI / 180; return { z, x: Math.floor((lon + 180) / 360 * n), y: Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n) }; };
const merc = (lat, lon) => [lon * 20037508.34 / 180, Math.log(Math.tan((90 + lat) * Math.PI / 360)) * 6378137];
const bb = (lat, lon, m = 600) => { const [x, y] = merc(lat, lon); return [x - m, y - m, x + m, y + m].map((v) => v.toFixed(1)).join(","); };
const T = (u, c) => u.replace("{z}", c.z).replace("{x}", c.x).replace("{y}", c.y);
const P = { zurich: [47.37, 8.54], amsterdam: [52.37, 4.9], paris: [48.86, 2.35], london: [51.5, -0.12], denver: [39.74, -104.99],
  wellington: [-41.29, 174.78], sydney: [-33.87, 151.2], madrid: [40.42, -3.7], oslo: [59.91, 10.75], vienna: [48.21, 16.37],
  copenhagen: [55.68, 12.57], chiangmai: [18.79, 98.98], manila: [14.6, 121.0], tallinn: [59.44, 24.75], helsinki: [60.17, 24.94] };
const J = [];
for (const k of ["zurich", "amsterdam", "paris", "london", "denver", "wellington", "sydney", "madrid", "oslo", "vienna", "copenhagen", "chiangmai", "tallinn", "helsinki"])
  for (const z of [12, 15, 17]) J.push([`mapterhorn ${k} z${z}`, T("https://tiles.mapterhorn.com/{z}/{x}/{y}.webp", tile(z, ...P[k]))]);
J.push(["mapterhorn tilejson", "https://tiles.mapterhorn.com/tilejson.json"]);
J.push(["mapterhorn attribution", "https://download.mapterhorn.com/attribution.json"]);
J.push(["mapterhorn repo tree", "https://api.github.com/repos/mapterhorn/mapterhorn/git/trees/main?recursive=1"]);
const d = P.denver;
J.push(["3dep json", "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer?f=json"]);
J.push(["3dep lerc", `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?bbox=${bb(...d)}&bboxSR=3857&imageSR=3857&size=256,256&format=lerc&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image`]);
J.push(["3dep tiff", `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?bbox=${bb(...d)}&bboxSR=3857&imageSR=3857&size=256,256&format=tiff&pixelType=F32&f=image`]);
J.push(["3dep index json", "https://index.nationalmap.gov/arcgis/rest/services/3DEPElevationIndex/MapServer?f=json"]);
J.push(["3dep index export", `https://index.nationalmap.gov/arcgis/rest/services/3DEPElevationIndex/MapServer/export?bbox=-14000000,2500000,-7000000,6500000&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image`]);
J.push(["ea imageserver", "https://environment.data.gov.uk/image/rest/services/SURVEY/LIDAR_Composite_1m_DTM_2022_Elevation/ImageServer?f=json"]);
J.push(["ea services", "https://environment.data.gov.uk/image/rest/services/SURVEY?f=json"]);
J.push(["ea wms caps", "https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wms?service=WMS&request=GetCapabilities"]);
J.push(["ahn wcs caps", "https://service.pdok.nl/rws/ahn/wcs/v1_0?service=WCS&request=GetCapabilities&version=2.0.1"]);
J.push(["ahn wms caps", "https://service.pdok.nl/rws/ahn/wms/v1_0?service=WMS&request=GetCapabilities"]);
J.push(["ahn wcs tiff", `https://service.pdok.nl/rws/ahn/wcs/v1_0?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=dtm_05m&FORMAT=image/tiff&SUBSET=x(121000,121200)&SUBSET=y(487000,487200)`]);
J.push(["es wcs caps", "https://servicios.idee.es/wcs-inspire/mdt?SERVICE=WCS&REQUEST=GetCapabilities"]);
J.push(["es wms caps", "https://servicios.idee.es/wms-inspire/mdt?SERVICE=WMS&REQUEST=GetCapabilities"]);
J.push(["fr wmsr bil", `https://data.geopf.fr/wms-r?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES&STYLES=&CRS=EPSG:3857&BBOX=${bb(...P.paris)}&WIDTH=256&HEIGHT=256&FORMAT=image/x-bil;bits=32`]);
J.push(["fr wmts caps", "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetCapabilities"]);
J.push(["ch wmts relief", T("https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissalti3d-reliefschattierung/default/current/3857/{z}/{x}/{y}.png", tile(14, ...P.zurich))]);
J.push(["nz stac", "https://nz-elevation.s3.ap-southeast-2.amazonaws.com/catalog.json"]);
J.push(["nz basemaps nokey", T("https://basemaps.linz.govt.nz/v1/tiles/elevation/WebMercatorQuad/{z}/{x}/{y}.png?pipeline=terrain-rgb", tile(12, ...P.wellington))]);
J.push(["au ga services", "https://services.ga.gov.au/gis/rest/services?f=json"]);
J.push(["au ga elevation folder", "https://services.ga.gov.au/gis/rest/services/Elevation?f=json"]);
J.push(["dk dataforsyningen", "https://api.dataforsyningen.dk/dhm_wcs_DAF?service=WCS&request=GetCapabilities"]);
J.push(["no wcs caps", "https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25833?service=WCS&request=GetCapabilities"]);
J.push(["at basemap gelaende", T("https://mapsneu.wien.gv.at/basemap/bmapgelaende/grau/google3857/{z}/{y}/{x}.jpeg", tile(12, ...P.vienna))]);
J.push(["esri terrain3d", "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer?f=json"]);
J.push(["esri terrain3d query", "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=5&f=json"]);
J.push(["esri hillshade json", "https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer?f=json"]);
J.push(["opentopo catalog", "https://portal.opentopography.org/API/otCatalog?productFormat=PointCloud&minx=-105.1&miny=39.6&maxx=-104.9&maxy=39.8&detail=false&outputFormat=json&include_federated=true"]);
J.push(["gsi dem5a", T("https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/{z}/{x}/{y}.png", tile(15, 35.36, 138.73))]);
J.push(["aws terrarium", T("https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png", tile(12, ...P.denver))]);
const peek = (b, ty) => /json|xml|text|html/.test(ty || "") ? b.toString("utf8", 0, 900).replace(/\s+/g, " ") : b.subarray(0, 12).toString("hex");
for (const [n, u] of J) {
  try {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), 25000);
    const r = await fetch(u, { headers: { Origin: O, "User-Agent": "Mozilla/5.0 OSAP-probe" }, signal: ac.signal });
    const b = Buffer.from(await r.arrayBuffer()); clearTimeout(t);
    const ty = r.headers.get("content-type");
    console.log(`## ${n} | ${r.status} | ${ty} | ${b.length}B | cors=${r.headers.get("access-control-allow-origin")}\n   ${u}\n   ${peek(b, ty)}`);
    if (/caps|tree|attribution|tilejson|services|folder|stac|query|index json|3dep json|terrain3d$/.test(n) && /json|xml/.test(ty || "")) {
      const s = b.toString("utf8");
      const hits = s.match(/(<(ows:)?Identifier>[^<]*<|<Name>[^<]*<|"name"\s*:\s*"[^"]*"|"path"\s*:\s*"[^"]*(source|coverage|attribution)[^"]*")/gi) || [];
      console.log("   names: " + [...new Set(hits)].slice(0, 200).join(" "));
    }
  } catch (e) { console.log(`## ${n} | ERROR ${e.message}\n   ${u}`); }
}
