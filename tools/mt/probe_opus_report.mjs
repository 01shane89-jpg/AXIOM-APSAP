// Diagnostic: reads probe-out/mt-opus.json (tools/mt/probe_opus.py) and prints, per language, chrF++ against human translations,
// speed, and how many real OSAP headlines each model's English the guard (tools/mt_guard.mjs) rejects, then lines side by side.
import fs from "node:fs";
import { mtSuspect } from "../mt_guard.mjs";
const { summary, rows } = JSON.parse(fs.readFileSync("probe-out/mt-opus.json", "utf8"));
const now = Date.now();
console.log("lang  opus model                          n   chrF++ MADLAD / OPUS   s per line MADLAD / OPUS   headlines rejected MADLAD / OPUS");
for (const s of summary) {
  const h = rows.filter((r) => r.lang === s.lang && r.set !== "ntrex");
  const rej = (k) => h.filter((r) => !r[k] || mtSuspect(r.text, r[k], now)).length;
  console.log(`${s.lang.padEnd(5)} ${String(s.opus_model || "none").padEnd(35)} ${String(s.n).padStart(3)}   ${s.madlad_chrf} / ${s.opus_chrf ?? "-"}` +
    `   ${s.madlad_s_per_line} / ${s.opus_s_per_line ?? "-"}   ${rej("madlad")} / ${s.opus_model ? rej("opus") : "-"} of ${h.length}`);
}
console.log("\n=== side by side");
for (const r of rows) {
  console.log(`\n[${r.lang} ${r.set}] ${r.text.slice(0, 160)}`);
  if (r.gold) console.log("  human : " + r.gold.slice(0, 200));
  const why = (k) => (r[k] ? mtSuspect(r.text, r[k], now) : "empty");
  console.log("  MADLAD: " + (r.madlad || "").slice(0, 200) + (why("madlad") ? "   <" + why("madlad") + ">" : ""));
  console.log("  OPUS  : " + (r.opus || "").slice(0, 200) + (r.opus && why("opus") ? "   <" + why("opus") + ">" : ""));
}
