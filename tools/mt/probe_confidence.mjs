// Diagnostic, writes nothing to the app: translates tools/mt/probe_confidence_samples.json with MADLAD-400 (greedy, the refresh
// job's settings) and the model's own confidence (tools/mt/madlad.py MT_SCORES=1), so a cut-off below which a translation is
// treated as invented can be chosen on evidence. Reports the score spread of each sample set and of the lines tools/mt_guard.mjs
// rejects, what share of each set every candidate cut-off would reject, and the least confident lines the guard lets through
// (to be read by a person). Run by the refresh workflow with only=probe-mt-conf (the model lives in the Actions cache).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mtSuspect } from "../mt_guard.mjs";

const S = JSON.parse(fs.readFileSync("tools/mt/probe_confidence_samples.json", "utf8")).items;
const MT_DIR = process.env.MT_DIR || path.join(os.homedir(), ".cache/osap-mt/madlad400-3b-mt-ct2-int8");
if (!fs.existsSync(path.join(MT_DIR, "model.bin"))) { console.log("model not installed"); process.exit(1); }
const t0 = Date.now();
const r = spawnSync(process.env.PYTHON || "python", ["tools/mt/madlad.py"], { input: JSON.stringify({ items: S.map(({ text, lang }) => ({ text, lang })) }),
  encoding: "utf8", maxBuffer: 64 << 20, timeout: 40 * 60 * 1000, env: { ...process.env, MT_DIR, MT_BUDGET: "2100", MT_SCORES: "1" } });
if (r.status !== 0) { console.log("failed:", String(r.stderr).slice(-600)); process.exit(1); }
const { out, scores } = JSON.parse(r.stdout);
console.log("translated " + out.filter(Boolean).length + " of " + S.length + " in " + Math.round((Date.now() - t0) / 1000) + " s");
const rows = S.map((it, k) => ({ ...it, en: out[k] || "", score: scores[k], why: out[k] ? mtSuspect(it.text, out[k]) : "empty" }));
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(3) : "-"; };
const groups = {};
for (const x of rows) if (x.score != null) {
  for (const g of [x.set + (x.why ? " (guard rejects)" : " (guard passes)"), "lang " + x.lang + (x.why ? " rejected" : "")]) (groups[g] = groups[g] || []).push(x.score);
}
console.log("\n=== score spread (p10 / p25 / median / p75 / p90, n)");
for (const [g, a] of Object.entries(groups).sort()) console.log(`${g.padEnd(34)} ${q(a, .1)} ${q(a, .25)} ${q(a, .5)} ${q(a, .75)} ${q(a, .9)}  n=${a.length}`);
console.log("\n=== share each cut-off would reject (score below it)");
const sets = [...new Set(rows.map((x) => x.set))];
for (const cut of [-0.3, -0.4, -0.5, -0.6, -0.7, -0.8, -0.9, -1.0, -1.2, -1.5]) {
  const line = [];
  for (const st of sets) for (const g of [false, true]) {
    const a = rows.filter((x) => x.set === st && !!x.why === g && x.score != null);
    if (a.length) line.push(`${st}${g ? "/rej" : "/pass"} ${a.filter((x) => x.score < cut).length}/${a.length}`);
  }
  console.log(String(cut).padEnd(6), line.join("  "));
}
console.log("\n=== the 120 least confident lines the guard passes (read these)");
for (const x of rows.filter((x) => !x.why && x.score != null).sort((a, b) => a.score - b.score).slice(0, 120))
  console.log(`${x.score.toFixed(3)} [${x.set} ${x.lang}] ${x.text.slice(0, 110)}\n        -> ${x.en.slice(0, 160)}`);
console.log("\n=== 40 most confident 'target' lines (read these too)");
for (const x of rows.filter((x) => x.set === "target" && x.score != null).sort((a, b) => b.score - a.score).slice(0, 40))
  console.log(`${x.score.toFixed(3)} [${x.lang}] ${x.text.slice(0, 110)}\n        -> ${x.en.slice(0, 160)}`);
fs.mkdirSync("probe-out", { recursive: true });
fs.writeFileSync("probe-out/mt-confidence.json", JSON.stringify(rows));
