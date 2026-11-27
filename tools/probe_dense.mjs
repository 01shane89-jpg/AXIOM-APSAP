// Probe 56 (27 Nov 2026): OpenAIP asp files: list all, schema and type mix for a few.
const UA = "AXIOM-OSAP/1.0 (open-source situational awareness; +https://01shane89-jpg.github.io/AXIOM-APSAP/)";
const links = {};
for (let p = 1; p <= 40; p++) {
  const t = await (await fetch("https://www.openaip.net/data/exports?format=geojson&type=airspace&page=" + p, { headers: { "user-agent": UA } })).text();
  const got = [...t.matchAll(/https:\/\/s3\.openaip\.net\/openaip-system-exports\/([a-z]{2})_asp\.geojson\?[^"'\s<]+/g)];
  const any = [...t.matchAll(/openaip-system-exports\/[a-z0-9_]+\.geojson\?/g)].length;
  for (const m of got) links[m[1]] = m[0].replace(/&amp;/g, "&");
  if (!any) { console.log("P last page", p - 1); break; }
  await new Promise((r) => setTimeout(r, 800));
}
console.log("P asp countries", Object.keys(links).length, Object.keys(links).join(","));
for (const cc of ["pl", "tw", "jp", "il"]) {
  if (!links[cc]) { console.log("P none", cc); continue; }
  const r = await fetch(links[cc]); const j = await r.json(); const f = j.features || [];
  const types = {}; for (const x of f) { const k = x.properties.type; types[k] = (types[k] || 0) + 1; }
  console.log("P", cc, r.status, f.length, JSON.stringify(types));
  const ex = {}; for (const x of f) { const k = x.properties.type; if (!ex[k]) ex[k] = x.properties.name; } console.log("P   names", JSON.stringify(ex));
  console.log("P   props", JSON.stringify(f[0].properties).slice(0, 800), f[0].geometry.type, JSON.stringify(f[0].geometry.coordinates).length);
}
