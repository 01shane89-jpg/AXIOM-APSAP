// PROBE BRANCH ONLY: WMO SWIC coverage - which issuing services appear in wmo_all.json, plus candidate source-list files.
import fs from "node:fs";
const UA = { "user-agent": "AXIOM-OSAP/1.0 (probe)" };
const out = {};
try {
  const r = await fetch("https://severeweather.wmo.int/v2/json/wmo_all.json", { headers: UA, signal: AbortSignal.timeout(90000) });
  const j = await r.json(); const items = j.items || [];
  out.status = r.status; out.cors = r.headers.get("access-control-allow-origin"); out.n = items.length; out.keys = Object.keys(items[0] || {});
  out.sample = items.slice(0, 3);
  const by = {};
  for (const w of items) { const p = String(w.url || "").split("/")[0]; const k = String(w.url || "").slice(0, 2); by[k] = by[k] || { n: 0, sev: {}, dirs: {} }; by[k].n++; by[k].sev[w.s] = (by[k].sev[w.s] || 0) + 1; by[k].dirs[p] = 1; }
  out.by = by;
} catch (e) { out.error = e.message; }
out.cands = [];
for (const u of ["https://severeweather.wmo.int/v2/json/sources.json", "https://severeweather.wmo.int/v2/json/members.json", "https://severeweather.wmo.int/v2/json/cap_sources.json", "https://severeweather.wmo.int/v2/sources.html", "https://severeweather.wmo.int/v2/json/wmo_members.json", "https://alertingauthority.wmo.int/rss.xml", "https://severeweather.wmo.int/v2/json/rss.json"]) {
  try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(30000) }); const t = await r.text(); out.cands.push({ u, status: r.status, bytes: t.length, head: t.slice(0, 1500) }); } catch (e) { out.cands.push({ u, error: e.message }); }
}
fs.mkdirSync("probe-out", { recursive: true });
fs.writeFileSync("probe-out/dense.json", JSON.stringify(out, null, 1));
console.log("PROBEJSON" + JSON.stringify(out));
