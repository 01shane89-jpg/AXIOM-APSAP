// Test only: fetches sample tiles from the elevation shading sources in the Layers menu (index.html HSX) with the real network
// and prints status, type, size and CORS header per tile, plus the Esri service's zoom levels. Writes nothing to the repo.
// Run: node tools/probe_hillshade.mjs
const t = (z, lat, lon) => {
  const n = 2 ** z, x = Math.floor((lon + 180) / 360 * n), r = lat * Math.PI / 180;
  return { z, x, y: Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n) };
};
const PLACES = [["Chiang Mai", 18.79, 98.98], ["Manila", 14.6, 121.0], ["Mindanao, Marawi", 8.0, 124.29], ["Singapore", 1.35, 103.82],
  ["Mt Fuji", 35.36, 138.73, "jp"], ["Okinawa, Naha", 26.21, 127.68, "jp"], ["Taipei", 25.03, 121.56], ["Seoul", 37.56, 126.98],
  ["Sydney", -33.87, 151.2], ["Wellington", -41.29, 174.78], ["Denver", 39.74, -104.99], ["London", 51.5, -0.12]];
const SRC = {
  esri: (c) => `https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/${c.z}/${c.y}/${c.x}`,
  gsi: (c) => `https://cyberjapandata.gsi.go.jp/xyz/hillshademap/${c.z}/${c.x}/${c.y}.png`
};
let bad = 0;
try {
  const j = await (await fetch("https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer?f=json")).json();
  console.log("esri service: levels", (j.tileInfo && j.tileInfo.lods || []).map((l) => l.level).join(","), "| copyright:", j.copyrightText);
} catch (e) { console.log("esri service json failed:", e.message); bad++; }
for (const [name, lat, lon, jp] of PLACES) {
  for (const z of [12, 15, 16, 17]) {
    for (const k of Object.keys(SRC)) {
      if (k === "gsi" && !jp) continue;   /* GSI answers 404 outside Japan; the map asks it only inside its bounds */
      const u = SRC[k](t(z, lat, lon));
      try {
        const r = await fetch(u, { headers: { Origin: "https://01shane89-jpg.github.io" } });
        const b = Buffer.from(await r.arrayBuffer());
        console.log(`${name.padEnd(18)} ${k.padEnd(5)} z${z} ${r.status} ${r.headers.get("content-type")} ${b.length}B cors=${r.headers.get("access-control-allow-origin")}`);
        if (z <= 16 && r.status !== 200) bad++;   /* z17 and up are enlarged from z16 on the map (maxNativeZoom 16) */
      } catch (e) { console.log(`${name} ${k} z${z} ERROR ${e.message}`); bad++; }
    }
  }
}
console.log(bad ? `${bad} problems` : "all sample tiles answered");
process.exit(bad ? 1 : 0);
