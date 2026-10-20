// One-off: fetch og:image preview photos for brief SIGACT source articles.
import fs from 'node:fs'; import crypto from 'node:crypto';
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const links=JSON.parse(fs.readFileSync('brief-photos/links.json','utf8'));
const out=[]; fs.mkdirSync('brief-photos/img',{recursive:true});
const pick=(h,re)=>{const m=h.match(re);return m?m[1].replace(/&amp;/g,'&'):null};
for(const {fp,link} of links){
  const rec={fp,link};
  try{
    const r=await fetch(link,{headers:{'user-agent':UA,'accept-language':'en,th;q=0.8'},redirect:'follow',signal:AbortSignal.timeout(25000)});
    rec.status=r.status; const h=(await r.text()).slice(0,400000);
    let img=pick(h,/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)/i)||pick(h,/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image/i)||pick(h,/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)/i);
    rec.title=pick(h,/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i);
    if(img){ img=new URL(img,link).href; rec.image=img;
      const ir=await fetch(img,{headers:{'user-agent':UA,referer:link},signal:AbortSignal.timeout(25000)});
      rec.imgStatus=ir.status; const ct=ir.headers.get('content-type')||'';
      if(ir.ok&&ct.startsWith('image/')){const b=Buffer.from(await ir.arrayBuffer());
        if(b.length<6e6){const ext=ct.includes('png')?'png':ct.includes('webp')?'webp':ct.includes('gif')?'gif':'jpg';
          const f=`brief-photos/img/${fp.slice(0,16)}.${ext}`;fs.writeFileSync(f,b);rec.file=f;rec.bytes=b.length;rec.sha256=crypto.createHash('sha256').update(b).digest('hex');}}
    }
  }catch(e){rec.error=String(e.message||e).slice(0,200)}
  console.log(JSON.stringify(rec)); out.push(rec);
}
fs.writeFileSync('brief-photos/manifest.json',JSON.stringify({fetched:new Date().toISOString(),items:out},null,1));
