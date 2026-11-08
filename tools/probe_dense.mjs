const H={"user-agent":"OSAP-refresh (github.com/01shane89-jpg/AXIOM-APSAP)"};
const j=await (await fetch("https://www.sanctionsmap.eu/api/v1/regime",{headers:H})).json();
const d=j.data; console.log("P n",d.length,"top keys",Object.keys(j).join(","));
const sh=(o,dep=0)=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,Array.isArray(v)?(v.length?["ARR"+v.length,typeof v[0]==="object"&&dep<1?sh(v[0],dep+1):String(v[0]).slice(0,60)]:"[]"):v&&typeof v==="object"?(dep<1?sh(v,dep+1):"OBJ"):String(v).slice(0,80)]));
for (const i of [0,10,40]) if(d[i]) console.log("P r"+i,JSON.stringify(sh(d[i])).slice(0,2500));
for (const u of ["https://www.sanctionsmap.eu/api/v1/regime/10","https://www.sanctionsmap.eu/api/v1/regime/10?lang=en"]) { const r=await fetch(u,{headers:H}); const x=await r.text(); console.log("P one",u,r.status,x.length,x.slice(0,1500).replace(/\s+/g," ")); }
