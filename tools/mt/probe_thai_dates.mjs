// Diagnostic, writes nothing to the app: translates the stored Thai headlines that carry an abbreviated month ("พ.ย.") twice with
// MADLAD-400, as written and with the dates written out (tools/translate.mjs prepareForModel), and counts how often
// tools/mt_guard.mjs rejects each (wrong month, number, year). Run by the refresh workflow with only=probe-mt-th.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mtSuspect } from "../mt_guard.mjs";
import { prepareForModel } from "../translate.mjs";

const RE = /(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)/;
const seen = new Set(), items = [];
for (const f of fs.readdirSync("data/history").filter((f) => /^[a-z]{2,3}\.js$/.test(f))) {
  const s = fs.readFileSync("data/history/" + f, "utf8"), j = JSON.parse(s.slice(s.indexOf("={") + 1, s.lastIndexOf("}") + 1));
  for (const list of Object.values(j)) for (const i of Array.isArray(list) ? list : [])
    if (i && i.lang === "th" && i.title && RE.test(i.title) && !seen.has(i.title)) { seen.add(i.title); items.push({ text: i.title, lang: "th" }); }
}
const MT_DIR = process.env.MT_DIR || path.join(os.homedir(), ".cache/osap-mt/madlad400-3b-mt-ct2-int8");
if (!fs.existsSync(path.join(MT_DIR, "model.bin"))) { console.log("model not installed"); process.exit(1); }
const run = (list) => {
  const r = spawnSync(process.env.PYTHON || "python", ["tools/mt/madlad.py"], { input: JSON.stringify({ items: list }), encoding: "utf8",
    maxBuffer: 64 << 20, timeout: 30 * 60 * 1000, env: { ...process.env, MT_DIR, MT_BUDGET: "1500", MT_SCORES: "1" } });
  if (r.status !== 0) { console.log("failed:", String(r.stderr).slice(-600)); process.exit(1); }
  return JSON.parse(r.stdout);
};
console.log(items.length + " Thai headlines with an abbreviated month");
const a = run(items), b = run(items.map((i) => ({ ...i, text: prepareForModel(i.text, "th") })));
const tally = (res) => { const c = {}; items.forEach((it, k) => { const en = res.out[k]; const w = en ? (mtSuspect(it.text, en) || "ok").replace(/ .*/, "") : "empty"; c[w] = (c[w] || 0) + 1; }); return c; };
console.log("as written:      " + JSON.stringify(tally(a)));
console.log("dates written out: " + JSON.stringify(tally(b)));
console.log("\n=== 80 examples (as written | dates written out)");
items.slice(0, 80).forEach((it, k) => console.log(it.text.slice(0, 90) + "\n   A " + (mtSuspect(it.text, a.out[k] || "") ? "REJ " : "ok  ") + (a.out[k] || "").slice(0, 120) +
  "\n   B " + (mtSuspect(it.text, b.out[k] || "") ? "REJ " : "ok  ") + (b.out[k] || "").slice(0, 120)));
