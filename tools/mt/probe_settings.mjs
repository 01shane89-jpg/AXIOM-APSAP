// Diagnostic, writes nothing: translates tools/mt/probe_samples.json with MADLAD-400 under several decoding settings and
// reports how many lines tools/mt_guard.mjs flags as invented under each, so the settings in tools/mt/madlad.py can be chosen
// on evidence. Run by the refresh workflow with only=probe-mt (the model lives in the Actions cache).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mtSuspect } from "../mt_guard.mjs";

const S = JSON.parse(fs.readFileSync("tools/mt/probe_samples.json", "utf8"));
const MT_DIR = process.env.MT_DIR || path.join(os.homedir(), ".cache/osap-mt/madlad400-3b-mt-ct2-int8");
if (!fs.existsSync(path.join(MT_DIR, "model.bin"))) { console.log("model not installed"); process.exit(1); }
const SETTINGS = [
  { name: "current (greedy, penalty 1.2, no-repeat 4)", env: { MT_BEAM: "1", MT_REP_PENALTY: "1.2", MT_NO_REPEAT: "4" } },
  { name: "before 2026-09-27 (greedy, no penalty)", env: { MT_BEAM: "1", MT_REP_PENALTY: "1", MT_NO_REPEAT: "0" } },
  { name: "greedy, no-repeat 4 only", env: { MT_BEAM: "1", MT_REP_PENALTY: "1", MT_NO_REPEAT: "4" } },
  { name: "beam 4, no-repeat 4", env: { MT_BEAM: "4", MT_REP_PENALTY: "1", MT_NO_REPEAT: "4" } },
];
const items = [...S.bad.map((x) => ({ ...x, set: "bad" })), ...S.good.map((x) => ({ ...x, set: "good" }))];
const loop = (en) => /\b(\w+)(?:[\s,.]+\1\b){3,}/i.test(en);
const rows = [];
for (const st of SETTINGS) {
  const t0 = Date.now();
  const r = spawnSync(process.env.PYTHON || "python", ["tools/mt/madlad.py"], { input: JSON.stringify({ items: items.map(({ text, lang }) => ({ text, lang })) }),
    encoding: "utf8", maxBuffer: 64 << 20, timeout: 20 * 60 * 1000, env: { ...process.env, MT_DIR, MT_BUDGET: "900", ...st.env } });
  if (r.status !== 0) { console.log(st.name, "failed:", String(r.stderr).slice(-400)); continue; }
  const out = JSON.parse(r.stdout).out, n = { bad: 0, good: 0 }, empty = { bad: 0, good: 0 }, loops = { bad: 0, good: 0 };
  console.log("\n=== " + st.name + " (" + Math.round((Date.now() - t0) / 1000) + " s)");
  items.forEach((it, k) => {
    const en = out[k] || "", why = en ? mtSuspect(it.text, en) : "empty";
    if (!en) empty[it.set]++; else if (why) n[it.set]++;
    if (en && loop(en)) loops[it.set]++;
    console.log(`  [${it.set}${why ? " INVENTED: " + why : ""}] ${it.text.slice(0, 60)}\n      -> ${en.slice(0, 140)}`);
  });
  rows.push(`${st.name}: invented ${n.bad}/${S.bad.length} of the bad set, ${n.good}/${S.good.length} of the good set; loops ${loops.bad + loops.good}; empty ${empty.bad + empty.good}`);
}
console.log("\n=== summary\n" + rows.join("\n"));
