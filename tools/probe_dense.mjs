const H={"user-agent":"OSAP-refresh (github.com/01shane89-jpg/AXIOM-APSAP)"};
const t=async(n,u,o={})=>{try{const r=await fetch(u,{...o,headers:{...H,...(o.headers||{})}});const x=await r.text();console.log("P",n,r.status,r.headers.get("content-type"),r.headers.get("content-range")||"",x.length,x.replace(/\s+/g," ").slice(0,700));return x}catch(e){console.log("P",n,"ERR",e.message)}};
await t("bfs","https://www.imis.bfs.de/ogc/opendata/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=opendata:odlinfo_odl_1h_latest&outputFormat=application/json&maxFeatures=3");
await t("bfs-count","https://www.imis.bfs.de/ogc/opendata/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=opendata:odlinfo_odl_1h_latest&outputFormat=application/json&propertyName=value,end_measure");
await t("safecast","https://api.safecast.org/measurements.json?captured_after=2026-11-07&per_page=5");
await t("safecast-dev","https://api.safecast.org/devices.json?per_page=3");
await t("radnet-range","https://radnet.epa.gov/cdx-radnet-rest/api/rest/csv/2026/fixed/AK/ANCHORAGE",{headers:{range:"bytes=-600"}});
const p=await t("radnet-page","https://www.epa.gov/radnet/radnet-csv-file-downloads");
if(p){const l=[...p.matchAll(/href="([^"]*cdx-radnet-rest[^"]*)"/g)].map(m=>m[1]);console.log("P radnet-links",l.length,l.slice(0,5).join(" "))}
await t("adsblol-pt","https://api.adsb.lol/v2/point/55.5/20.0/250");
await t("adsblol-lat","https://api.adsb.lol/v2/lat/55.5/lon/20.0/dist/250");
await t("ripe-crs","https://stat.ripe.net/data/country-resource-stats/data.json?resource=MM&starttime="+new Date(Date.now()-3*864e5).toISOString().slice(0,10)+"&resolution=1h");
await t("ioda","https://api.ioda.inetintel.cc.gatech.edu/v2/outages/alerts?from="+Math.floor(Date.now()/1e3-86400)+"&until="+Math.floor(Date.now()/1e3)+"&entityType=country");
await t("celestrak-active-count","https://celestrak.org/NORAD/elements/gp.php?GROUP=military&FORMAT=json");
