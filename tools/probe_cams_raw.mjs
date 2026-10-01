// Test only: fetches candidate official, keyless traffic camera lists and prints status, CORS header and a raw sample.
const O = "https://01shane89-jpg.github.io";
const C = {
  sg: "https://api.data.gov.sg/v1/transport/traffic-images",
  hk: "https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.xml",
  tw1: "https://tisvcloud.freeway.gov.tw/history/motc20/CCTV.xml",
  tw2: "https://tisvcloud.freeway.gov.tw/cctv_info.xml.gz",
  tw3: "https://tisvcloud.freeway.gov.tw/history/motc20/",
  nz: "https://trafficnz.info/service/traffic/rest/4/cameras/all",
  gb: "https://api.tfl.gov.uk/Place/Type/JamCam",
  fi: "https://tie.digitraffic.fi/api/weathercam/v1/stations",
  on: "https://511on.ca/api/v2/get/cameras",
  ab: "https://511.alberta.ca/api/v2/get/cameras",
  bc1: "https://images.drivebc.ca/webcam/api/v1/webcams",
  bc2: "https://www.drivebc.ca/api/webcams/",
  nsw1: "https://data.livetraffic.com/cameras/traffic-cam.json",
  nsw2: "https://www.livetraffic.com/datajson/all-feeds-web.json",
  qc: "https://ws.mapserver.transports.gouv.qc.ca/swtq?service=wfs&version=2.0.0&request=getfeature&typename=ms:infos_cameras&outfile=Camera&srsname=EPSG:4326&outputformat=geojson",
  ca7: "https://cwwp2.dot.ca.gov/data/d7/cctv/cctvStatusD07.json",
  nyc: "https://webcams.nyctmc.org/api/cameras",
  es: "https://infocar.dgt.es/datex2/dgt/PredefinedLocationsPublication/camaras/content.xml",
  ie: "https://data.tii.ie/Datasets/TrafficCameras/cameras.json",
};
for (const [k, u] of Object.entries(C)) {
  const t = Date.now();
  try {
    const r = await fetch(u, { headers: { Origin: O, "User-Agent": "Mozilla/5.0 (OSAP probe)" }, signal: AbortSignal.timeout(30000) });
    const b = Buffer.from(await r.arrayBuffer());
    console.log(`\n=== ${k} ${r.status} ${r.headers.get("content-type")} ${b.length}B ${Date.now() - t}ms ACAO=${r.headers.get("access-control-allow-origin")}`);
    console.log(b.slice(0, 1500).toString("utf8").replace(/\s+/g, " "));
  } catch (e) { console.log(`\n=== ${k} ERROR ${e.message} ${e.cause ? e.cause.code || e.cause.message : ""}`); }
}
