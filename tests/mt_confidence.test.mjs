// The model's own confidence (tools/mt_guard.mjs lowConfidence, tools/translate.mjs). Run: node tests/mt_confidence.test.mjs
// A stand-in for tools/mt/madlad.py answers with fixed lines and scores, so no model is needed. The low-scoring line is real
// MADLAD-400 output for an Armenian headline on the election of the Constitutional Court's president (probe of 2026-11-08).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { lowConfidence, MT_MIN_SCORE } from "../tools/mt_guard.mjs";

let ok = 0; const t = async (name, f) => { await f(); ok++; console.log("ok -", name); };
await t("scores below the cut-off are low confidence; missing scores are not", () => {
  assert.equal(MT_MIN_SCORE, -1.5);
  assert.equal(lowConfidence(-1.606), true);
  assert.equal(lowConfidence(-0.42), false);
  assert.equal(lowConfidence(-1.5), false);
  for (const v of [null, undefined, NaN, "-2"]) assert.equal(lowConfidence(v), false);
});

const repo = process.cwd(), dir = fs.mkdtempSync(path.join(os.tmpdir(), "osap-conf-"));
fs.mkdirSync(path.join(dir, "model")); fs.writeFileSync(path.join(dir, "model", "model.bin"), "");
const fake = path.join(dir, "fake-madlad.mjs");
fs.writeFileSync(fake, `#!/usr/bin/env node
let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const items = JSON.parse(s).items;
  if (process.env.MT_SCORES !== "1") { process.stdout.write(JSON.stringify({ out: items.map(() => "no scores asked") })); return; }
  const out = items.map((i) => /Սահմանադրական/.test(i.text) ? "The bridge is now undergoing a major renovation." : "Armen Grigoryan elected to the ethics committee");
  process.stdout.write(JSON.stringify({ out, scores: items.map((i) => /Սահմանադրական/.test(i.text) ? -1.606 : -0.61) }));
});`);
fs.chmodSync(fake, 0o755);
process.chdir(dir);
Object.assign(process.env, { MT_DIR: path.join(dir, "model"), PYTHON: fake });
const { translateAll } = await import(path.join(repo, "tools/translate.mjs"));
await t("a translation the model is unsure of is not used, even after the beam retry", async () => {
  const [a, b] = await translateAll([
    { text: "Արմեն Գրիգորյանն ընտրվել է ՀՀ գլխավոր դատախազին առընթեր էթիկայի հանձնաժողովի անդամ", lang: "hy" },
    { text: "Վլադիմիր Վարդանյանն ընտրվեց Սահմանադրական դատարանի նախագահ", lang: "hy" }]);
  assert.equal(a.en, "Armen Grigoryan elected to the ethics committee");
  assert.match(a.tool, /MADLAD/);
  assert.equal(b.en, null, "the invented line is dropped and the original is shown");
});
process.chdir(repo); fs.rmSync(dir, { recursive: true, force: true });
console.log(ok + " passed");
