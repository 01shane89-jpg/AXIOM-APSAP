// Replace the Asia-Pacific slivers of the US and Russia in country-outlines.js with their whole Natural Earth 1:50m outlines
// (points closer than MIN degrees to the last kept one dropped), and add Tuvalu (1:10m; 1:50m has none) to world-outlines.js.
const fs=require("fs"),topo=require("./tc/package/dist/topojson-client.js");
const MIN=+(process.env.MIN||0.05);
const r=v=>Math.round(v*100)/100;
// Douglas-Peucker: keep a point only when it is more than TOL degrees off the line between its kept neighbours
const TOL=+(process.env.TOL||0.02);
function dp(pts,tol){if(pts.length<3||!tol)return pts;const keep=new Uint8Array(pts.length);keep[0]=keep[pts.length-1]=1;
 /* a closed ring starts and ends on the same point: also keep the point farthest from it and simplify both halves */
 let far=1,fd=-1;for(let i=1;i<pts.length-1;i++){const d=Math.hypot(pts[i][0]-pts[0][0],pts[i][1]-pts[0][1]);if(d>fd){fd=d;far=i;}}keep[far]=1;const st=[[0,far],[far,pts.length-1]];
 while(st.length){const [a,b]=st.pop();const [x1,y1]=pts[a],[x2,y2]=pts[b];const dx=x2-x1,dy=y2-y1,L=Math.hypot(dx,dy)||1e-12;let m=-1,md=tol;
  for(let i=a+1;i<b;i++){const d=Math.abs(dy*pts[i][0]-dx*pts[i][1]+x2*y1-y2*x1)/L;if(d>md){md=d;m=i;}}if(m>0){keep[m]=1;st.push([a,m],[m,b]);}}
 return pts.filter((p,i)=>keep[i]);}
const rp=(ring,min)=>{ring=dp(ring,min?TOL:0);const o=[];for(const [x,y] of ring){const p=[r(x),r(y)];const l=o[o.length-1];if(!l||Math.abs(l[0]-p[0])+Math.abs(l[1]-p[1])>=min&&!(l[0]===p[0]&&l[1]===p[1]))o.push(p);}if(o.length&&(o[0][0]!==o[o.length-1][0]||o[0][1]!==o[o.length-1][1]))o.push(o[0]);return o.length>=4?o:null;};
const SMALL=+(process.env.SMALL||0.2);   // islands smaller than this many degrees across are left out
const big=(ring)=>{const xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]);return Math.max(...xs)-Math.min(...xs)>=SMALL||Math.max(...ys)-Math.min(...ys)>=SMALL;};
// Sutherland-Hodgman against the line x=180: keep the west side (x<=180) or the east side
function clip(r,west){const inside=(p)=>west?p[0]<=180:p[0]>=180,o=[];for(let i=0;i<r.length;i++){const a=r[i],b=r[(i+1)%r.length];const ia=inside(a),ib=inside(b);
 if(ia)o.push(a);if(ia!==ib){const t=(180-a[0])/(b[0]-a[0]);o.push([180,a[1]+t*(b[1]-a[1])]);}}if(o.length&&(o[0][0]!==o[o.length-1][0]||o[0][1]!==o[o.length-1][1]))o.push(o[0]);return o;}
const feat=(res,name,min)=>{const t=require("./wa2/package/countries-"+res+".json");const f=topo.feature(t,t.objects.countries).features.find(f=>f.properties.name===name);if(!f)return null;const g=f.geometry;/* a ring that crosses the 180th meridian (Chukotka) jumps from +180 to -180 and would draw a line across the world:
   make it continuous, then cut it at 180 into a part west of the line and a part east of it (shifted back to -180..) */
 const raw=(g.type==="Polygon"?[g.coordinates]:g.coordinates).flatMap(p=>{const xs=p[0].map(q=>q[0]);if(Math.max(...xs)-Math.min(...xs)<=180)return [p];
  const east=p.map(r=>r.map(([x,y])=>[x<0?x+360:x,y]));
  const w=clip(east[0],true),e=clip(east[0],false).map(([x,y])=>[x-360,y]);return [w,e].filter(r=>r.length>=4).map(r=>[r]);});
 const polys=raw.map(p=>p.map(x=>rp(x,min)).filter(Boolean)).filter(p=>p.length&&big(p[0]));return {type:"Feature",properties:{n:name},geometry:{type:"MultiPolygon",coordinates:polys}}};
function feat10(n){const t=require("./wa2/package/countries-10m.json");const f=topo.feature(t,t.objects.countries).features.find(f=>f.properties.name===n);const g=f.geometry;return {type:"Feature",properties:{n},geometry:{type:"MultiPolygon",coordinates:(g.type==="Polygon"?[g.coordinates]:g.coordinates).map(p=>p.map(x=>rp(x,0)).filter(Boolean)).filter(p=>p.length)}}}
function load(p,g){const t=fs.readFileSync(p,"utf8");const pre="window."+g+"=";if(!t.startsWith(pre))throw p;return JSON.parse(t.slice(pre.length).trim().replace(/;$/,""));}
function save(p,g,o){fs.writeFileSync(p,"window."+g+"="+JSON.stringify(o)+";\n");}
const cb=load("data/basemap/country-outlines.js","COUNTRY_BASE");
for (const n of ["United States of America","Russia"]) { const i=cb.features.findIndex(f=>f.properties.n===n); cb.features[i]=feat("50m",n,MIN); }
save("data/basemap/country-outlines.js","COUNTRY_BASE",cb);
const wb=load("data/basemap/world-outlines.js","WORLD_BASE");
if(!wb.features.some(f=>f.properties.n==="Tuvalu")) wb.features.push((()=>{const s0=SMALL;return feat10("Tuvalu")})());
save("data/basemap/world-outlines.js","WORLD_BASE",wb);
