// What the model is given (tools/translate.mjs prepareForModel). Run: node tests/mt_prepare.test.mjs
// 2026-11-08 probe (tools/mt/probe_thai_dates.mjs, 276 stored Thai headlines with an abbreviated month): as written, 91 passed the
// guard and 135 came back with the wrong month ("5 พ.ย. 69" as "5th of July, 69"); with the dates written out, 207 passed.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repo = process.cwd(), dir = fs.mkdtempSync(path.join(os.tmpdir(), "osap-prep-"));
fs.mkdirSync(path.join(dir, "model")); fs.writeFileSync(path.join(dir, "model", "model.bin"), "");
const fake = path.join(dir, "fake-madlad.mjs"), seen = path.join(dir, "seen.json");
fs.writeFileSync(fake, `#!/usr/bin/env node
let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const items = JSON.parse(s).items; require("fs").writeFileSync(${JSON.stringify(seen)}, JSON.stringify(items));
  process.stdout.write(JSON.stringify({ out: items.map(() => "Late News | 5 November 2026"), scores: items.map(() => -0.5) }));
});`.replace("#!/usr/bin/env node", "#!/usr/bin/env node\nconst require = (await import('node:module')).createRequire(import.meta.url);"));
fs.renameSync(fake, fake.replace(/\.mjs$/, ".mjs")); fs.chmodSync(fake, 0o755);
process.chdir(dir);
Object.assign(process.env, { MT_DIR: path.join(dir, "model"), PYTHON: fake });
const { prepareForModel, translateAll } = await import(path.join(repo, "tools/translate.mjs"));
let ok = 0; const t = async (name, f) => { await f(); ok++; console.log("ok -", name); };

await t("Thai abbreviated months and years are written out", () => {
  assert.equal(prepareForModel("ข่าวดึก | 5 พ.ย. 69", "th"), "ข่าวดึก | 5 พฤศจิกายน 2026");
  assert.equal(prepareForModel("ฝนสะสม 8-13 พ.ย.นี้", "th"), "ฝนสะสม 8-13 พฤศจิกายน นี้");
  assert.equal(prepareForModel("ดัชนี ต.ค.69 หดตัว", "th"), "ดัชนี ตุลาคม 2026 หดตัว");
  assert.equal(prepareForModel("สรุปราคาทองคำ 3 พ.ย. 2569", "th"), "สรุปราคาทองคำ 3 พฤศจิกายน 2026");
  assert.equal(prepareForModel("ต.ค.69 - ก.ย.70", "th"), "ตุลาคม 2026 - กันยายน 2027");
  assert.equal(prepareForModel("Le 5 nov. 2026", "fr"), "Le 5 nov. 2026");
});
await t("the model is given the written-out dates; the original stays the original", async () => {
  const [r] = await translateAll([{ text: "ข่าวดึก | 5 พ.ย. 69", lang: "th" }]);
  assert.equal(JSON.parse(fs.readFileSync(seen, "utf8"))[0].text, "ข่าวดึก | 5 พฤศจิกายน 2026");
  assert.equal(r.en, "Late News | 5 November 2026", "passes the guard against the original's own พ.ย. 69");
});
process.chdir(repo); fs.rmSync(dir, { recursive: true, force: true });
console.log(ok + " passed");
