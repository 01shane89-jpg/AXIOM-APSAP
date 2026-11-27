// Probe 22 (27 Nov 2026): OpenAIP public data exports (airspace files) and EMM NewsBrief page.
const { UA } = await import("./dense_lib.mjs");
const get = async (u) => { const r = await fetch(u, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(60000) }); return [r.status, r.headers.get("content-type"), await r.text()]; };
let [s, ct, t] = await get("https://www.openaip.net/data/exports");
const links = [...t.matchAll(/href="(https:\/\/s3\.openaip\.net\/[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
console.log("P exports", s, links.length, "links; names:", links.map((l) => l.split("?")[0].split("/").pop()).slice(0, 60).join(" "));
console.log("P pager", [...t.matchAll(/href="([^"]*(page|offset|search|filter)[^"]*)"/gi)].map((m) => m[1]).slice(0, 10).join(" "));
const nx = t.match(/__NEXT_DATA__[^>]*>([\s\S]{0,1500})/); if (nx) console.log("P next", nx[1].slice(0, 1500));
for (const q of ["?search=pl_asp", "?q=pl_asp", "?page=2", "?type=airspace"]) { const [s2, , t2] = await get("https://www.openaip.net/data/exports" + q); console.log("P", q, s2, [...t2.matchAll(/openaip-system-exports\/([^"?]+)/g)].map((m) => m[1]).slice(0, 15).join(" ")); }
const asp = links.find((l) => /_asp\.geojson/.test(l));
if (asp) { const [s3, ct3, t3] = await get(asp); console.log("P asp", asp.split("?")[0], s3, ct3, t3.length, t3.slice(0, 700).replace(/\s+/g, " ")); }
[s, ct, t] = await get("https://emm.newsbrief.eu/NewsBrief/clusteredition/en/latest.html");
console.log("P emm", s, t.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 900));
