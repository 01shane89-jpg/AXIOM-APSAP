const fs=require('fs');const topo=require('./tc/package/dist/topojson-client.js');
const UN="AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH CM CA CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG MK NO OM PK PW PA PG PY PE PH PL PT QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA SS ES LK SD SR SE CH SY TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ VU VE VN YE ZM ZW".split(" ");
console.log('UN',UN.length,new Set(UN).size);
const EXTRA=["TW","XK","PS","EH"];
const codes=require('./ia/package/codes.json');const byA2={};for(const c of codes)byA2[c[0]]={a3:c[1],num:c[2]};
byA2.XK={a3:"XKX",num:null};
const CL=require('./cl/package/countries.min.json');
const t50=require('./wa2/package/countries-50m.json');const f50=topo.feature(t50,t50.objects.countries).features;
const byNum={},byName={};for(const f of f50){if(f.id)byNum[f.id]=f;byName[f.properties.name]=f;}
const NAMEFIX={XK:"Kosovo",EH:"W. Sahara",PS:"Palestine",TW:"Taiwan",CY:"Cyprus",SO:"Somalia"};
const SHORT={BO:"Bolivia",BN:"Brunei",CD:"DR Congo",CG:"Republic of the Congo",CI:"Côte d'Ivoire",CV:"Cabo Verde",CZ:"Czechia",FM:"Micronesia",GB:"United Kingdom",IR:"Iran",KP:"North Korea",KR:"South Korea",LA:"Laos",MD:"Moldova",MK:"North Macedonia",PS:"Palestine",RU:"Russia",SY:"Syria",SZ:"Eswatini",TZ:"Tanzania",TW:"Taiwan",US:"United States",VE:"Venezuela",VN:"Vietnam",XK:"Kosovo",EH:"Western Sahara",TL:"Timor-Leste",VA:"Vatican",BS:"Bahamas",GM:"Gambia",KN:"Saint Kitts and Nevis",LC:"Saint Lucia",VC:"Saint Vincent and the Grenadines",ST:"São Tomé and Príncipe",TR:"Türkiye"};
function area(r){let a=0;for(let i=0,j=r.length-1;i<r.length;j=i++)a+=(r[j][0]+r[i][0])*(r[j][1]-r[i][1]);return Math.abs(a/2);}
function bounds(f){const g=f.geometry;const polys=g.type==='Polygon'?[g.coordinates]:g.coordinates;const ar=polys.map(p=>area(p[0]));const mx=Math.max(...ar);
 let b=[90,180,-90,-180];polys.forEach((p,i)=>{if(ar[i]<mx*0.1&&!(ar[i]>0.5))return;for(const[x,y]of p[0]){b[0]=Math.min(b[0],y);b[1]=Math.min(b[1],x);b[2]=Math.max(b[2],y);b[3]=Math.max(b[3],x);}});
 if(b[3]-b[1]>300){ // crosses the antimeridian: shift western longitudes east by 360
   b=[90,999,-90,-999];polys.forEach((p,i)=>{if(ar[i]<mx*0.1&&!(ar[i]>0.5))return;for(let[x,y]of p[0]){if(x<0)x+=360;b[0]=Math.min(b[0],y);b[1]=Math.min(b[1],x);b[2]=Math.max(b[2],y);b[3]=Math.max(b[3],x);}});}
 const pad=Math.max(0.15,Math.min(1,(b[2]-b[0])*0.04));
 return [[+(b[0]-pad).toFixed(1),+(b[1]-pad).toFixed(1)],[+(b[2]+pad).toFixed(1),+(b[3]+pad).toFixed(1)]];}
const out=[],miss=[];
for(const a2 of UN.concat(EXTRA)){const m=byA2[a2]||{};let f=(m.num&&byNum[m.num])||byName[NAMEFIX[a2]]||byName[(CL[a2]||{}).name];
 if(!f){if(a2==='TV'){out.push({a2,a3:'TUV',name:'Tuvalu',cont:'OC',ne:'Tuvalu',bounds:[[-10.9,175.9],[-5.4,180]]});continue;}miss.push(a2);continue;}
 out.push({a2,a3:m.a3,name:SHORT[a2]||(CL[a2]||{}).name||f.properties.name,cont:(CL[a2]||{}).continent||(a2==='XK'?'EU':'?'),ne:f.properties.name,bounds:bounds(f)});}
console.log('found',out.length,'missing',miss);
fs.writeFileSync('world-list.json',JSON.stringify(out));
