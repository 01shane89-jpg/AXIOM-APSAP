// Hourly flood snapshot refresh (run by .github/workflows/refresh-flood.yml, or by hand with Node 18+).
// Pulls the same two ThaiWater feeds the page's Refresh button uses and rewrites
// data/thailand/flood-live-snapshot.js: stations, rain, over, asof and built change;
// warnings, exposure and province bulletins are kept as they were.
// Exit codes: 0 = snapshot updated or unchanged, 1 = feed failed (the old snapshot is left untouched).
import fs from "node:fs";

const TW = "https://api-v3.thaiwater.net/api/v1/thaiwater30/public/";
const FILE = "data/thailand/flood-live-snapshot.js";
const TIMEOUT = 30000;

async function getJSON(path) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(TW + path, { signal: ctl.signal, headers: { "user-agent": "AXIOM-ASAP flood refresh" } });
    if (!r.ok) throw new Error(path + " HTTP " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
// same field mapping as pullStations() / pullRain() in the page
function pullStations(wl) {
  const out = [];
  for (const r of wl) {
    const st = r.station || {}, g = r.geocode || {};
    const lat = parseFloat(st.tele_station_lat), lon = parseFloat(st.tele_station_long);
    if (!isFinite(lat) || !isFinite(lon) || r.situation_level == null) continue;
    const n = st.tele_station_name || {}, ag = (r.agency || {}).agency_shortname || {}, bs = (r.basin || {}).basin_name || {};
    out.push({ n: n.en || n.th || "Gauge", p: (g.province_name || {}).en || "", a: (g.amphoe_name || {}).en || "",
      lv: r.situation_level, msl: parseFloat(r.waterlevel_msl), d: parseFloat(r.diff_wl_bank),
      t: r.waterlevel_datetime, ag: ag.en || ag.th || "", b: bs.en || bs.th || "", lat, lon });
  }
  return out;
}
function pullRain(rn) {
  const out = [];
  for (const r of rn) {
    const st = r.station || {}, g = r.geocode || {}, mm = parseFloat(r.rain_24h);
    const lat = parseFloat(st.tele_station_lat), lon = parseFloat(st.tele_station_long);
    if (!isFinite(lat) || !isFinite(lon) || !(mm >= 60)) continue;
    const n = st.tele_station_name || {};
    out.push({ n: n.en || n.th || "", p: (g.province_name || {}).en || "", a: (g.amphoe_name || {}).en || "",
      mm, h1: parseFloat(r.rain_1h) || 0, t: r.rainfall_datetime, lat, lon });
  }
  return out.sort((a, b) => b.mm - a.mm);
}
const clean = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === "number" && !isFinite(v) ? null : v)));

try {
  const src = fs.readFileSync(FILE, "utf8");
  const LIVE = JSON.parse(src.slice(src.indexOf("=") + 1).trim().replace(/;$/, ""));
  const [wl, rn] = await Promise.all([getJSON("waterlevel_load"), getJSON("rain_24h")]);
  const stations = pullStations(wl.waterlevel_data.data), rain = pullRain(rn.data);
  if (stations.length < 100) throw new Error("feed returned only " + stations.length + " stations");
  const over = stations.map((s, i) => (s.lv === 5 ? i : -1)).filter((i) => i >= 0)
    .sort((a, b) => (stations[b].d || 0) - (stations[a].d || 0));
  const asof = stations.reduce((m, s) => (s.t > m ? s.t : m), "");
  if (asof === LIVE.asof) { console.log("unchanged: newest gauge reading is still " + asof); process.exit(0); }
  Object.assign(LIVE, clean({ stations, rain, over, asof }), { built: new Date().toISOString().slice(0, 16).replace("T", " ") + "Z" });
  fs.writeFileSync(FILE, "window.LIVE=" + JSON.stringify(LIVE) + ";\n");
  console.log(`updated: ${stations.length} gauges, ${over.length} over the bank, ${rain.length} rain stations >= 60 mm, as of ${asof}`);
} catch (e) {
  console.error("flood refresh failed, snapshot left as it was: " + (e.message || e));
  process.exit(1);
}
