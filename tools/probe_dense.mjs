// Probe 29 (27 Nov 2026): OpenAIP public exports: every page, airspace files, sizes and type mix.
const { UA, sleep } = await import("./dense_lib.mjs");
const get = async (u, as = "text") => { const r = await fetch(u, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error("HTTP " + r.status); return as === "json" ? r.json() : r.text(); };
const asp = new Map(); let pages = 0;
for (let p = 1; p <= 200; p++) {
  const t = await get("https://www.openaip.net/data/exports" + (p > 1 ? "?page=" + p : "")); pages++;
  const L = [...t.matchAll(/href="(https:\/\/s3\.openaip\.net\/openaip-system-exports\/([a-z]{2})_asp\.geojson\?[^"]+)"/g)];
  for (const m of L) asp.set(m[2], m[1].replace(/&amp;/g, "&"));
  if (!/openaip-system-exports\//.test(t)) break;
  await sleep(250);
}
console.log("P pages", pages, "asp files", asp.size, [...asp.keys()].join(" "));
const types = {}, icao = {}; let bytes = 0, feats = 0, verts = 0;
const pick = ["us", "kr", "jp", "tw", "pl", "ua", "ir", "gb", "cn", "ru"];
for (const cc of pick) {
  if (!asp.has(cc)) { console.log("P", cc, "none"); continue; }
  const t = await get(asp.get(cc)); bytes += t.length; const j = JSON.parse(t);
  const tc = {};
  for (const f of j.features) { feats++; const ty = f.properties.type; types[ty] = (types[ty] || 0) + 1; tc[ty] = (tc[ty] || 0) + 1; verts += JSON.stringify(f.geometry.coordinates).split("],[").length; }
  const ex = j.features.filter((f) => [1, 2, 3, 12].includes(f.properties.type)).slice(0, 3).map((f) => f.properties.type + ":" + f.properties.name);
  console.log("P", cc, t.length, j.features.length, JSON.stringify(tc), ex.join(" | "));
}
console.log("P sample bytes", bytes, "features", feats, "vertices", verts, "types", JSON.stringify(types));
