// Prints how many non-English items in the translated snapshots have an English version, and which tool made it.
import fs from "node:fs";
for (const f of ["warnings", "news", "social"]) {
  let s; try { s = fs.readFileSync("data/live/" + f + ".js", "utf8"); } catch (e) { continue; }
  const counts = {}; for (const m of s.matchAll(/"mt":("([^"]*)"|null)/g)) { const k = m[2] || "English, no translation needed"; counts[k] = (counts[k] || 0) + 1; }
  const need = Object.entries(counts).filter(([k]) => !/^English/.test(k)).reduce((a, [, v]) => a + v, 0), un = counts.untranslated || 0;
  console.log(f + ": " + (need - un) + " of " + need + " non-English items translated" + (need ? " (" + Math.round(100 * (need - un) / need) + "%)" : "") + " | " + JSON.stringify(counts));
}
