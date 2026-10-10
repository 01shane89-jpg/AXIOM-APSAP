// Test only: OpenCelliD PMTiles on Source Cooperative: browser access (CORS), licence and age; MCC-MNC operator names.
const log = (...a) => console.log(...a);
const U = "https://data.source.coop/smartmaps/opencellid/cellid.pmtiles";
for (const m of ["OPTIONS", "GET"]) {
  try { const r = await fetch(U, { method: m, headers: { Origin: "https://01shane89-jpg.github.io", Range: "bytes=0-99", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "range" }, signal: AbortSignal.timeout(30000) });
    const h = {}; r.headers.forEach((v, k) => { if (/access-control|last-modified|etag|cache|content-range/.test(k)) h[k] = v; }); log(m, r.status, JSON.stringify(h)); } catch (e) { log(m, "ERR", e.message); }
}
for (const u of ["https://source.coop/smartmaps/opencellid", "https://source.coop/api/v1/repositories/smartmaps/opencellid", "https://data.source.coop/smartmaps/opencellid/README.md", "https://source.coop/api/v1/accounts/smartmaps/repositories/opencellid"]) {
  try { const r = await fetch(u, { signal: AbortSignal.timeout(30000) }); const t = await r.text(); log("==", u, r.status); log(t.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").match(/.{0,200}(licen[cs]e|CC[ -]BY|updated|created|date|202[3-6])[^.]{0,200}/gi)?.slice(0, 12).join("\n") || t.slice(0, 1500)); } catch (e) { log(u, "ERR", e.message); }
}
for (const u of ["https://raw.githubusercontent.com/cavoq/mcc-mnc-list/master/mcc-mnc-list.json", "https://raw.githubusercontent.com/cavoq/mcc-mnc-list/master/mcc-mnc-list.csv"]) {
  try { const r = await fetch(u); const t = await r.text(); log("==", u, r.status, t.length); if (r.ok) { if (u.endsWith("json")) { const j = JSON.parse(t); log("rows", j.length, JSON.stringify(j.slice(0, 1)), JSON.stringify(j.filter((x) => String(x.mcc) === "520"))); } else log(t.split("\n").slice(0, 3).join("\n")); } } catch (e) { log(u, "ERR", e.message); }
}
