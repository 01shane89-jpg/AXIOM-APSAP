// Test only: does the FOSSGIS Valhalla router take exclude_locations and exclude_polygons (the evacuation route's safer option)?
const V = "https://valhalla1.openstreetmap.de/route?json=";
const UA = { "User-Agent": "Mozilla/5.0 OSAP-probe", Origin: "https://01shane89-jpg.github.io" };
async function q(name, body) {
  try {
    const r = await fetch(V + encodeURIComponent(JSON.stringify(body)), { headers: UA, signal: AbortSignal.timeout(40000) });
    const j = await r.json().catch(() => null);
    console.log(name, r.status, r.headers.get("access-control-allow-origin"), j && j.trip ? (j.trip.summary.length.toFixed(1) + " km " + Math.round(j.trip.summary.time / 60) + " min") : JSON.stringify(j).slice(0, 300));
  } catch (e) { console.log(name, "ERR", String(e)); }
}
const base = { locations: [{ lat: 13.7563, lon: 100.5018 }, { lat: 13.6900, lon: 101.0779 }], costing: "auto", units: "kilometers" };
await q("plain", base);
const pts = []; for (let i = 0; i < 40; i++) pts.push({ lat: 13.74 - i * 0.002, lon: 100.6 + i * 0.01 });
await q("exclude_locations 40", { ...base, exclude_locations: pts });
await q("exclude_locations 60", { ...base, exclude_locations: pts.concat(pts.slice(0, 20).map((p) => ({ lat: p.lat + 0.05, lon: p.lon }))) });
const sq = (la, lo, d) => [[lo - d, la - d], [lo + d, la - d], [lo + d, la + d], [lo - d, la + d], [lo - d, la - d]];
await q("exclude_polygons 1 small", { ...base, exclude_polygons: [sq(13.72, 100.8, 0.01)] });
await q("exclude_polygons 10 x 2km", { ...base, exclude_polygons: Array.from({ length: 10 }, (_, i) => sq(13.72, 100.65 + i * 0.04, 0.01)) });
await q("exclude_polygons 1 big", { ...base, exclude_polygons: [sq(13.72, 100.8, 0.1)] });
await q("alternates 2", { ...base, alternates: 2 });
