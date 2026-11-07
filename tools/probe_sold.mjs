// Test only (branch claude/sold-sources-probe, never merge): round 2, radar layer names and tiles. Prints to the log.
const UA = "AXIOM-OSAP/1.0 (+https://axiom-osap.netlify.app; source probe)";
async function hit(label, url, opt = {}) {
  const t = Date.now();
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, ...(opt.h || {}) }, signal: AbortSignal.timeout(opt.to || 60000) });
    const b = Buffer.from(await r.arrayBuffer()), s = b.toString("latin1");
    let info = opt.grep ? [...new Set(s.match(opt.grep) || [])].slice(0, opt.max || 40).join(" | ") : s.slice(0, 160).replace(/[^\x20-\x7e]+/g, ".");
    console.log(`${label}: ${r.status} ${b.length}B ${Date.now() - t}ms ct=${r.headers.get("content-type")} cors=${r.headers.get("access-control-allow-origin")} ${info}`);
  } catch (e) { console.log(`${label}: ERR ${e.message}`); }
}
await hit("dwd names", "https://maps.dwd.de/geoserver/dwd/wms?service=WMS&version=1.3.0&request=GetCapabilities", { grep: /<Name>dwd:[^<]*<\/Name>/g, max: 400 });
await hit("fmi names", "https://openwms.fmi.fi/geoserver/Radar/wms?service=WMS&version=1.3.0&request=GetCapabilities", { grep: /<Name>(suomi|finland|composite|euref)[^<]*<\/Name>/gi, max: 60 });
await hit("fmi getmap", "https://openwms.fmi.fi/geoserver/Radar/wms?service=WMS&version=1.3.0&request=GetMap&layers=Radar:suomi_dbz_eureffin&styles=&format=image/png&transparent=true&crs=EPSG:3857&bbox=2000000,8000000,4000000,11000000&width=256&height=256");
await hit("knmi getmap", "https://geoservices.knmi.nl/adaguc-server?DATASET=RADAR&SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=RAD_NL25_PCP_CM&STYLES=&FORMAT=image/png&TRANSPARENT=true&CRS=EPSG:3857&BBOX=300000,6500000,800000,7100000&WIDTH=256&HEIGHT=256");
await hit("jma times", "https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json", { grep: /"basetime":"\d+","validtime":"\d+"/g, max: 3 });
const tt = await (await fetch("https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json")).json().catch(() => []);
if (tt[0]) await hit("jma tile z6", `https://www.jma.go.jp/bosai/jmatile/data/nowc/${tt[0].basetime}/none/${tt[0].validtime}/surf/hrpns/6/56/25.png`);
await hit("geomet RRAI legend", "https://geo.weather.gc.ca/geomet?version=1.3.0&service=WMS&request=GetLegendGraphic&sld_version=1.1.0&layer=RADAR_1KM_RRAI&format=image/png");
await hit("nowcoast caps time", "https://nowcoast.noaa.gov/geoserver/observations/weather_radar/wms?service=WMS&version=1.3.0&request=GetCapabilities", { grep: /<Dimension[^>]*>[^<]{0,60}/g, max: 6 });
await hit("bom", "https://reg.bom.gov.au/products/IDR00004.loop.shtml", {});
await hit("ims radar", "https://ims.gov.il/sites/default/files/ims_data/map_images/IMSRadar/IMSRadar.gif", {});
await hit("meteofrance", "https://public-api.meteofrance.fr/", {});
await hit("aemet radar wms", "https://www.aemet.es/es/eltiempo/observacion/radar", {});
await hit("ipma", "https://www.ipma.pt/", {});
await hit("chmi radar", "https://opendata.chmi.cz/meteorology/weather/radar/composite/maxz/png/", { grep: /href="[^"]+png"/g, max: 3 });
await hit("imgw radar", "https://danepubliczne.imgw.pl/api/data/product", {});
await hit("dmi radar", "https://dmigw.govcloud.dk/v1/radardata/collections", {});
await hit("geosphere at", "https://dataset.api.hub.geosphere.at/v1/datasets", { grep: /"[^"]*(radar|inca|nowcast)[^"]*"/gi, max: 10 });
await hit("opera odim open", "https://www.eumetnet.eu/activities/observations-programme/current-activities/opera/", {});
await hit("meteoswiss", "https://data.geo.admin.ch/api/stac/v0.9/collections", { grep: /ch\.meteoschweiz\.[a-z0-9-]*radar[a-z0-9-]*/g, max: 10 });
await hit("geoadmin radar wms", "https://wms.geo.admin.ch/?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities", { grep: /<Name>ch\.meteoschweiz[^<]*<\/Name>/g, max: 20, to: 60000 });
await hit("cwa radar png", "https://cwaopendata.s3.ap-northeast-1.amazonaws.com/Observation/O-A0058-003.png", {});
await hit("cwa radar json", "https://cwaopendata.s3.ap-northeast-1.amazonaws.com/Observation/O-A0058-005.json", {});
await hit("hko radar 64", "https://www.hko.gov.hk/wxinfo/radars/rad_064_png/", {});
