// Test only: does the Comms tab's own vector-tile reader (decodeCells in assets/osap-comms.js) read real OpenCelliD tiles?
import fs from "node:fs";
import { PMTiles } from "pmtiles";
const src = fs.readFileSync("assets/osap-comms.js", "utf8");
const decodeCells = new Function(src.slice(src.indexOf("  function decodeCells(buf)"), src.indexOf("  var OT = new Map()")) + "; return decodeCells;")();
const p = new PMTiles("https://data.source.coop/smartmaps/opencellid/cellid.pmtiles");
for (const [nm, lat, lon, z] of [["Bangkok", 13.756, 100.502, 14], ["Bangkok", 13.756, 100.502, 10], ["Bangkok", 13.756, 100.502, 8], ["Manila", 14.599, 120.984, 14], ["Paris", 48.857, 2.352, 12]]) {
  const n = 2 ** z, x = Math.floor((lon + 180) / 360 * n), y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
  const t = await p.getZxy(z, x, y); if (!t) { console.log(nm, z, "none"); continue; }
  const d = decodeCells(t.data), c = {};
  d.cells.forEach((e) => { const k = e[2] + "-" + e[3]; c[k] = (c[k] || 0) + 1; });
  console.log(nm, "z" + z, "ext", d.ext, "cells", d.cells.length, "first", JSON.stringify(d.cells[0]), "by code", JSON.stringify(c).slice(0, 400));
}
