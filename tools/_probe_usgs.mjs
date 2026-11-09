// TEMP probe (removed before merge): first-seen time of each new quake in USGS's live search vs the hour feed, polled every 15 s
const F = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_hour.geojson";
const S = () => "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=2.5&orderby=time&limit=400&starttime=" + new Date(Date.now() - 65 * 60e3).toISOString().slice(0, 19);
const seen = { f: new Map(), s: new Map() }, upd = new Map(), base = { f: null, s: null }, end = Date.now() + (+process.env.MIN || 40) * 60e3;
const med = (a) => { a = a.slice().sort((x, y) => x - y); return a.length ? a[a.length >> 1] : null; };
while (Date.now() < end) {
  for (const [k, u] of [["f", F], ["s", S()]]) {
    try {
      const g = await (await fetch(u, { signal: AbortSignal.timeout(12000), headers: { "user-agent": "AXIOM-OSAP flash probe" } })).json(), now = Date.now();
      const ids = (g.features || []).map((f) => { if (!upd.has(f.id)) upd.set(f.id, +f.properties.updated); return f.id; });
      if (!base[k]) { base[k] = new Set(ids); continue; }
      for (const id of ids) if (!base[k].has(id) && !seen[k].has(id)) { seen[k].set(id, now); console.log(`${new Date(now).toISOString().slice(11, 19)}Z ${k === "f" ? "feed  " : "search"} ${id} ${Math.round((now - upd.get(id)) / 1000)} s after published`); }
    } catch (e) { console.log(k, "failed", e.message); }
  }
  await new Promise((r) => setTimeout(r, 15000));
}
const both = [...seen.s.keys()].filter((id) => seen.f.has(id));
console.log(`search first-seen ${seen.s.size}, feed ${seen.f.size}, both ${both.length}`);
console.log(`published->seen median: search ${med([...seen.s].map(([id, t]) => (t - upd.get(id)) / 1000))} s, feed ${med([...seen.f].map(([id, t]) => (t - upd.get(id)) / 1000))} s`);
console.log(`feed later than search by (median s): ${med(both.map((id) => (seen.f.get(id) - seen.s.get(id)) / 1000))}; each: ${both.map((id) => Math.round((seen.f.get(id) - seen.s.get(id)) / 1000)).join(", ")}`);
