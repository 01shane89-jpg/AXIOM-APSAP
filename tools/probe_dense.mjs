const H={"user-agent":"OSAP-refresh (github.com/01shane89-jpg/AXIOM-APSAP)"};
const t=async(n,u,o={})=>{try{const r=await fetch(u,{...o,headers:{...H,...(o.headers||{})}});const x=await r.text();console.log("P",n,r.status,r.headers.get("content-type"),x.length,x.replace(/\s+/g," ").slice(0,600));return x}catch(e){console.log("P",n,"ERR",e.message)}};
await t("smap-regimes","https://www.sanctionsmap.eu/api/v1/regime");
await t("smap-country","https://www.sanctionsmap.eu/api/v1/country");
const d=await t("dataeu","https://data.europa.eu/api/hub/search/datasets/consolidated-list-of-persons-groups-and-entities-subject-to-eu-financial-sanctions");
if(d){const u=[...d.matchAll(/"(https:\/\/webgate[^"]+)"/g)].map(m=>m[1]);console.log("P dataeu-urls",[...new Set(u)].join(" "));for(const x of [...new Set(u)].slice(0,4)) await t("eu-file "+x.slice(-60),x,{method:"GET"});}
for (const v of ["xmlFullSanctionsList_1_1/content?token=n002hqt8","csvFullSanctionsList_1_1/content?token=n002hqt8","xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw"]) await t("eu "+v,"https://webgate.ec.europa.eu/fsd/fsf/public/files/"+v);
const f=await t("pk-fatal","https://data.humdata.org/dataset/4ce16b45-5526-471d-8918-2ed76082f1c8/resource/4cfc43b6-cc9c-403b-966f-fc37b8dd7d4b/download/dppadposs-fatalities.csv");
if(f){const L=f.split("\n");console.log("P pk-fatal-tail",L.length,L.slice(-4).join(" // "))}
