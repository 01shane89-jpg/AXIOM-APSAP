// PROBE BRANCH ONLY: IMB PRC live piracy map categories (WP Go Maps REST, the data the public map page loads).
const UA = "AXIOM-OSAP/1.0 (situational awareness; hourly; +https://github.com/01shane89-jpg/AXIOM-APSAP)";
for (const u of ["https://icc-ccs.org/wp-json/wpgmza/v1/categories", "https://icc-ccs.org/wp-json/wpgmza/v1/marker-categories", "https://icc-ccs.org/wp-json/wpgmza/v1/markers?filter=%7B%22map_id%22%3A%2223%22%7D"]) {
  try { const r = await fetch(u, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(40000) }); const t = await r.text(); console.log("PC " + u + " | " + r.status + " | " + t.length + " | " + t.slice(0, 1500).replace(/\s+/g, " ")); } catch (e) { console.log("PC " + u + " ERR " + e.message); }
}
const page = await (await fetch("https://icc-ccs.org/map/", { headers: { "user-agent": UA } })).text();
for (const m of page.matchAll(/category[^<]{0,40}<[^>]*>[^<]{0,80}|data-category-id="\d+"[^>]*>[^<]{0,80}|"category_name":"[^"]+"|"id":"?\d+"?,"(name|category_name)":"[^"]+"/gi)) console.log("PCP " + m[0].slice(0, 200));
for (const m of page.matchAll(/(Actual|Attempted|Suspicious|Hijack|Boarded|Fired)[^<"]{0,60}/g)) console.log("PCL " + m[0]);
