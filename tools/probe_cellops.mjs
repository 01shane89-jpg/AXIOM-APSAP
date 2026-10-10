// Test only: can OSAP name the network on masts without a key? Probes keyless cell-ID sources from a GitHub runner.
// Prints to the log; writes nothing to the repo.
import { PMTiles } from "pmtiles";
const log = (...a) => console.log(...a);
async function head(u) {
  try { const r = await fetch(u, { method: "GET", headers: { Range: "bytes=0-511" }, signal: AbortSignal.timeout(30000) });
    log("==", u, r.status, r.headers.get("content-type"), r.headers.get("content-range") || r.headers.get("content-length")); return r; }
  catch (e) { log("==", u, "ERR", e.message); return null; }
}
async function page(u, re) {
  try { const r = await fetch(u, { signal: AbortSignal.timeout(30000) }); const t = await r.text();
    log("==", u, r.status, t.length + " bytes"); const m = [...new Set(t.match(re) || [])].slice(0, 40); log(m.join("\n")); return t; }
  catch (e) { log("==", u, "ERR", e.message); return ""; }
}
// 1. OpenCelliD as PMTiles on Source Cooperative
for (const u of ["https://data.source.coop/smartmaps/opencellid/cellid.pmtiles", "https://data.source.coop/smartmaps/opencellid/opencellid.pmtiles"]) {
  const r = await head(u); if (!r || r.status >= 400) continue;
  try {
    const p = new PMTiles(u), h = await p.getHeader(), md = await p.getMetadata();
    log("header", JSON.stringify({ minZoom: h.minZoom, maxZoom: h.maxZoom, tileType: h.tileType, bounds: [h.minLon, h.minLat, h.maxLon, h.maxLat] }));
    log("metadata", JSON.stringify(md).slice(0, 3000));
    const { VectorTile } = await import("@mapbox/vector-tile"); const Pbf = (await import("pbf")).default;
    for (const [lat, lon] of [[13.756, 100.502], [16.44, 102.83], [37.566, 126.978], [14.599, 120.984]]) {
      const z = h.maxZoom, n = 2 ** z, x = Math.floor((lon + 180) / 360 * n), y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
      const t = await p.getZxy(z, x, y); if (!t) { log("tile", z, x, y, "none"); continue; }
      const vt = new VectorTile(new Pbf(new Uint8Array(t.data)));
      for (const name of Object.keys(vt.layers)) {
        const L = vt.layers[name], c = {}; let ex = null;
        for (let i = 0; i < L.length; i++) { const f = L.feature(i).properties; ex = ex || f; const k = (f.mcc ?? "?") + "-" + (f.mnc ?? f.net ?? "?") + " " + (f.radio ?? ""); c[k] = (c[k] || 0) + 1; }
        log("tile", lat, lon, "z" + z, name, L.length, "features; example", JSON.stringify(ex), "; by mcc-mnc", JSON.stringify(c).slice(0, 600));
      }
    }
  } catch (e) { log("pmtiles read failed:", e.message); }
}
// 2. beaconDB (public-domain successor to Mozilla Location Service): look for its data dumps
await page("https://beacondb.net/", /https?:\/\/[^"'\s<>]*(export|dump|download|\.csv|\.gz)[^"'\s<>]*/gi);
await page("https://codeberg.org/beacondb/beacondb", /https?:\/\/[^"'\s<>]*(export|dump|download|\.csv|\.gz)[^"'\s<>]*/gi);
await page("https://beacondb.net/export/", /href="[^"]+"/gi);
// 3. MCC-MNC tables (names of every country's mobile operators)
const mm = await head("https://raw.githubusercontent.com/cavoq/mcc-mnc-list/main/mcc-mnc-list.json");
try { const j = await (await fetch("https://raw.githubusercontent.com/cavoq/mcc-mnc-list/main/mcc-mnc-list.json")).json();
  log("mcc-mnc rows", j.length, JSON.stringify(j.filter((r) => String(r.mcc) === "520").slice(0, 12))); } catch (e) { log("mcc-mnc json", e.message); }
await page("https://github.com/cavoq/mcc-mnc-list", /licen[sc]e[^<]{0,80}/gi);
