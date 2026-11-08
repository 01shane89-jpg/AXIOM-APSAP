const ua={headers:{"user-agent":"OSAP-refresh (github.com/01shane89-jpg/AXIOM-APSAP)"}};
const t=async u=>{const r=await fetch(u,ua);return [r.status,await r.text()];};
const un=s=>s.replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/\s+/g," ");
let [s,h]=await t("https://www.data.jma.go.jp/svd/vaac/data/vaac_list.html");
const tk=[...h.matchAll(/href="(TextData\/\d{4}\/\d{8}_[^"]+_Text\.html)"/g)].map(m=>m[1]);
console.log("P tokyo",s,tk.length,tk.slice(0,3).join(" "),"last",tk.slice(-2).join(" "));
if(tk[0]){const [s2,x]=await t("https://www.data.jma.go.jp/svd/vaac/data/"+tk[0]);console.log("P tk1",s2,un(x).slice(0,900));}
[s,h]=await t("https://www.ospo.noaa.gov/products/atmosphere/vaac/messages.html");
const wa=[...h.matchAll(/href="(\/VAAC\/ARCH\d\d\/[^"]+\.html)"/g)].map(m=>m[1]);
console.log("P wash",s,wa.length,wa.slice(0,3).join(" "),"last",wa.slice(-2).join(" "));
console.log("P washhrefs",[...h.matchAll(/href="([^"]+)"/g)].map(m=>m[1]).filter(x=>/VAAC|vaac|ARCH/.test(x)).slice(0,15).join(" "));
if(wa[0]){const [s2,x]=await t("https://www.ospo.noaa.gov"+wa[0]);console.log("P wa1",s2,un(x).slice(0,900));}
