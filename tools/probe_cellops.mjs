// Test only: OpenCelliD PMTiles tile sizes and cell counts by zoom over Bangkok, rural Isan and Seoul.
import { PMTiles } from "pmtiles";
const p = new PMTiles("https://data.source.coop/smartmaps/opencellid/cellid.pmtiles");
for (const [nm, lat, lon] of [["Bangkok", 13.756, 100.502], ["Isan", 15.8, 103.5], ["Seoul", 37.566, 126.978], ["Paris", 48.857, 2.352]]) {
  const row = [];
  for (let z = 4; z <= 14; z++) {
    const n = 2 ** z, x = Math.floor((lon + 180) / 360 * n), y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
    const t0 = Date.now(); const t = await p.getZxy(z, x, y);
    row.push("z" + z + ":" + (t ? Math.round(t.data.byteLength / 1024) + "KB" : "none") + "/" + (Date.now() - t0) + "ms");
  }
  console.log(nm, row.join(" "));
}
