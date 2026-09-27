const fs=require('fs');const topo=require('./tc/package/dist/topojson-client.js');
const W=JSON.parse(fs.readFileSync('world-list.json'));
const CORE="th vn kh la mm ph my sg id bn tl cn tw kp kr jp mn au nz pg in pk np bt bd lk mv".split(" ");
const base=require('./old-base-names.json');
for(const res of ['50m','110m']){
 const t=require('./wa2/package/countries-'+res+'.json');const fs_=topo.feature(t,t.objects.countries).features;
 const r=v=>Math.round(v*100)/100;
 const rp=ring=>{const o=[];for(const [x,y] of ring){const p=[r(x),r(y)];const l=o[o.length-1];if(!l||l[0]!==p[0]||l[1]!==p[1])o.push(p);}return o.length>=4?o:null;};
 const feats=fs_.filter(f=>!base.includes(f.properties.name)).map(f=>{const g=f.geometry;if(!g)return null;const polys=(g.type==='Polygon'?[g.coordinates]:g.coordinates).map(p=>p.map(rp).filter(Boolean)).filter(p=>p.length);if(!polys.length)return null;return {type:"Feature",properties:{n:f.properties.name},geometry:{type:"MultiPolygon",coordinates:polys}}}).filter(Boolean);
 const s=JSON.stringify({type:"FeatureCollection",features:feats});
 fs.writeFileSync('world-'+res+'.json',s);console.log(res,feats.length,s.length);
}
