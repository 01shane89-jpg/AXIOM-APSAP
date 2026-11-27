// Probe 55 (27 Nov 2026): OpenAIP exports page filters.
const UA = "AXIOM-OSAP/1.0 (open-source situational awareness; +https://01shane89-jpg.github.io/AXIOM-APSAP/)";
for (const q of ["?page=1", "?search=asp.geojson", "?q=asp.geojson", "?filter=asp", "?type=asp", "?format=geojson&type=airspace", "?page=2"]) {
  const r = await fetch("https://www.openaip.net/data/exports" + q, { headers: { "user-agent": UA } }); const t = await r.text();
  const all = [...t.matchAll(/openaip-system-exports\/([a-z0-9_]+\.[a-z]+)\?/g)].map((m) => m[1]);
  const asp = all.filter((f) => /_asp\.geojson$/.test(f));
  console.log("P", q, r.status, "files", all.length, "asp", asp.length, all.slice(0, 12).join(" "), "|", (t.match(/of (\d+) results/) || [])[0]);
  await new Promise((r) => setTimeout(r, 1500));
}
