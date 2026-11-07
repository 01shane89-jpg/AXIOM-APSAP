// Test only (branch claude/sold-sources-probe, never merge): checks keyless, commercially usable replacements for the
// sources the sold version drops. Prints to the log; writes nothing.
const UA = "AXIOM-OSAP/1.0 (+https://axiom-osap.netlify.app; source probe)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function hit(label, url, opt = {}) {
  const t = Date.now();
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, ...(opt.h || {}) }, signal: AbortSignal.timeout(opt.to || 30000) });
    const b = Buffer.from(await r.arrayBuffer());
    let info = "";
    if (opt.json) { try { const j = JSON.parse(b.toString()); info = opt.json(j); } catch (e) { info = "not json: " + b.toString().slice(0, 120).replace(/\s+/g, " "); } }
    else if (opt.grep) { const s = b.toString(); info = (s.match(opt.grep) || []).slice(0, 12).join(" | "); }
    else info = b.toString().slice(0, 160).replace(/\s+/g, " ");
    console.log(`${label}: ${r.status} ${b.length}B ${Date.now() - t}ms ct=${r.headers.get("content-type")} cors=${r.headers.get("access-control-allow-origin")} ${info}`);
    return r.status;
  } catch (e) { console.log(`${label}: ERR ${e.message} ${Date.now() - t}ms`); return 0; }
}
const ac = (j) => "ac=" + ((j.ac || j.aircraft || []).length) + " keys=" + Object.keys(j).join(",");
console.log("== adsb.lol endpoints");
await hit("lol mil", "https://api.adsb.lol/v2/mil", { json: ac });
await hit("lol ladd", "https://api.adsb.lol/v2/ladd", { json: ac });
await hit("lol pia", "https://api.adsb.lol/v2/pia", { json: ac });
await hit("lol re-api box json", "https://re-api.adsb.lol/?json&box=30,60,-20,40", { json: ac });
await hit("lol re-api all json", "https://re-api.adsb.lol/?all&json", { json: ac });
await hit("lol site re-api", "https://adsb.lol/re-api/?json&box=30,60,-20,40", { json: ac });
await hit("lol api 0 routeset", "https://api.adsb.lol/api/0/me", { json: (j) => JSON.stringify(j).slice(0, 200) });
await hit("lol globe aircraft.json", "https://globe.adsb.lol/data/aircraft.json", { json: ac });
await hit("lol point 250", "https://api.adsb.lol/v2/point/51/0/250", { json: ac, h: {} });
console.log("== adsb.lol point rate: gap 1.5 s, 30 calls");
let n429 = 0, ok = 0;
for (let i = 0; i < 30; i++) { const s = await hit("pt" + i, `https://api.adsb.lol/v2/point/${40 + (i % 10)}/${-100 + i * 5}/250`, { json: (j) => "ac=" + (j.ac || []).length }); if (s === 429) n429++; else if (s === 200) ok++; await sleep(1500); }
console.log("gap1.5 ok", ok, "429", n429);
await sleep(20000);
console.log("== gap 3 s, 30 calls"); n429 = 0; ok = 0;
for (let i = 0; i < 30; i++) { const s = await hit("pt" + i, `https://api.adsb.lol/v2/point/${10 + (i % 10)}/${-100 + i * 5}/250`, { json: (j) => "ac=" + (j.ac || []).length }); if (s === 429) n429++; else if (s === 200) ok++; await sleep(3000); }
console.log("gap3 ok", ok, "429", n429);
console.log("== other ADS-B");
await hit("airplanes.live mil", "https://api.airplanes.live/v2/mil", { json: ac });
await hit("adsb.im?", "https://api.adsb.im/v2/mil", { json: ac });
await hit("theairtraffic", "https://api.theairtraffic.com/v2/mil", { json: ac });
await hit("hpradar", "https://api.hpradar.com/v2/mil", { json: ac });
console.log("== radar");
await hit("rainviewer", "https://api.rainviewer.com/public/weather-maps.json", { json: (j) => "past=" + ((j.radar || {}).past || []).length + " host=" + j.host });
await hit("nowcoast caps", "https://nowcoast.noaa.gov/geoserver/observations/weather_radar/wms?service=WMS&version=1.3.0&request=GetCapabilities", { grep: /<Name>[^<]*<\/Name>/g, to: 60000 });
await hit("nowcoast radar png", "https://nowcoast.noaa.gov/geoserver/observations/weather_radar/wms?service=WMS&version=1.3.0&request=GetMap&layers=base_reflectivity_mosaic&styles=&format=image/png&transparent=true&crs=EPSG:3857&bbox=-11000000,3500000,-9000000,5500000&width=256&height=256");
await hit("geomet caps radar", "https://geo.weather.gc.ca/geomet?service=WMS&version=1.3.0&request=GetCapabilities&layer=RADAR_1KM_RRAI", { grep: /<Name>[^<]*<\/Name>|<Dimension[^>]*>[^<]{0,80}/g });
await hit("geomet radar png", "https://geo.weather.gc.ca/geomet?service=WMS&version=1.3.0&request=GetMap&layers=RADAR_1KM_RRAI&styles=&format=image/png&transparent=true&crs=EPSG:3857&bbox=-9000000,5000000,-7000000,7000000&width=256&height=256");
await hit("geomet radar global?", "https://geo.weather.gc.ca/geomet?service=WMS&version=1.3.0&request=GetCapabilities&layer=RADAR_COVERAGE_RRAI.INV", { grep: /<Name>[^<]*<\/Name>/g });
await hit("dwd caps", "https://maps.dwd.de/geoserver/dwd/wms?service=WMS&version=1.3.0&request=GetCapabilities", { grep: /<Name>dwd:[^<]*(Radar|radar|RV|WN|Nieder)[^<]*<\/Name>/g, to: 60000 });
await hit("dwd radar png", "https://maps.dwd.de/geoserver/dwd/wms?service=WMS&version=1.3.0&request=GetMap&layers=dwd:Niederschlagsradar&styles=&format=image/png&transparent=true&crs=EPSG:3857&bbox=500000,6000000,1700000,7500000&width=256&height=256");
await hit("fmi caps", "https://openwms.fmi.fi/geoserver/Radar/wms?service=WMS&version=1.3.0&request=GetCapabilities", { grep: /<Name>[^<]*<\/Name>/g, to: 60000 });
await hit("jma times N1", "https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json", { json: (j) => JSON.stringify(j[0]) });
await hit("knmi?", "https://geoservices.knmi.nl/adaguc-server?DATASET=RADAR&SERVICE=WMS&REQUEST=GetCapabilities", { grep: /<Name>[^<]*<\/Name>/g });
await hit("opera eumetnet", "https://opera.meteo.be/", {});
await hit("meteogate opera", "https://api.meteogate.eu/", {});
await hit("smhi radar", "https://opendata-download-radar.smhi.se/api/version/latest/area/sweden/product/comp", { json: (j) => JSON.stringify(j).slice(0, 200) });
await hit("metno radar", "https://api.met.no/weatherapi/radar/2.0/available.json?type=reflectivity&area=nordic", { json: (j) => JSON.stringify(j).slice(0, 200) });
await hit("aemet?", "https://www.aemet.es/", {});
await hit("ims israel?", "https://ims.gov.il/", {});
await hit("tmd radar", "https://weather.tmd.go.th/", {});
await hit("pagasa?", "https://www.pagasa.dost.gov.ph/", {});
await hit("bmkg radar", "https://radar.bmkg.go.id/sidarma-new/api/radar/list?token=", {});
await hit("hko radar", "https://www.hko.gov.hk/wxinfo/radars/radar.htm", {});
await hit("cwa taiwan opendata radar", "https://opendata.cwa.gov.tw/fileapi/v1/opendataapi/O-A0058-001?format=JSON", {});
await hit("kma?", "https://www.weather.go.kr/", {});
await hit("gibs imerg", "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/IMERG_Precipitation_Rate_30min/default/default/GoogleMapsCompatible_Level6/2/1/1.png");
console.log("== GNSS / opensky alternatives");
await hit("gpsjam manifest", "https://gpsjam.org/data/manifest.csv");
await hit("flightradar gpsjam?", "https://www.flightradar24.com/data/gps-jamming", {});
