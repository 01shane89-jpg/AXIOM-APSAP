// One translation cache file per refresh lane (tools/translate.mjs). Run: node tests/mt_cache_lanes.test.mjs
// 2026-11-08: the fast and news lanes both committed data/live/translation-cache.json and each push dropped the other lane's new
// translations, so ~210 warnings were translated again on every run. A lane now reads every lane's file and writes only its own.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repo = process.cwd(), dir = fs.mkdtempSync(path.join(os.tmpdir(), "osap-lanes-"));
fs.mkdirSync(path.join(dir, "model")); fs.writeFileSync(path.join(dir, "model", "model.bin"), "");
const fake = path.join(dir, "fake-madlad.mjs");
fs.writeFileSync(fake, `#!/usr/bin/env node
let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const items = JSON.parse(s).items;
  process.stdout.write(JSON.stringify({ out: items.map(() => "Heavy rain warning for the north"), scores: items.map(() => -0.4) }));
});`);
fs.chmodSync(fake, 0o755);
process.chdir(dir);
fs.mkdirSync("data/live", { recursive: true });
const MT = "MADLAD-400 (Google open model, run in the refresh job)";
const crypto = await import("node:crypto");
const key = (s, lang) => crypto.createHash("sha1").update((lang || "") + "|" + s).digest("hex").slice(0, 20);
const news = { [key("ข่าวน้ำท่วมเชียงใหม่", "th")]: { en: "Flood news in Chiang Mai", tool: MT, at: Date.parse("2026-11-08T17:00Z") } };
const shared = { [key("ข่าวน้ำท่วมเชียงใหม่", "th")]: { en: "Old flood line", tool: MT, at: Date.parse("2026-11-08T12:00Z") },
  [key("ฝนตกหนัก", "th")]: { en: "Heavy rain", tool: MT, at: Date.parse("2026-11-08T12:00Z") } };
fs.writeFileSync("data/live/translation-cache-news.json", JSON.stringify(news));
fs.writeFileSync("data/live/translation-cache.json", JSON.stringify(shared));
const newsBefore = fs.readFileSync("data/live/translation-cache-news.json", "utf8");
Object.assign(process.env, { MT_DIR: path.join(dir, "model"), PYTHON: fake, MT_CACHE_LANE: "fast" });
const { translateAll, saveCache } = await import(path.join(repo, "tools/translate.mjs"));
let ok = 0; const t = async (name, f) => { await f(); ok++; console.log("ok -", name); };

await t("a lane uses the other lanes' translations, the newest where two files hold the same text", async () => {
  const [a, b] = await translateAll([{ text: "ข่าวน้ำท่วมเชียงใหม่", lang: "th" }, { text: "ฝนตกหนัก", lang: "th" }]);
  assert.equal(a.en, "Flood news in Chiang Mai");
  assert.equal(b.en, "Heavy rain");
});
await t("a lane writes only its own file, with only what it translated", async () => {
  const [c] = await translateAll([{ text: "ประกาศเตือนฝนตกหนักภาคเหนือ", lang: "th" }]);
  assert.equal(c.en, "Heavy rain warning for the north");
  saveCache();
  const own = JSON.parse(fs.readFileSync("data/live/translation-cache-fast.json", "utf8"));
  assert.deepEqual(Object.values(own).map((v) => v.en), ["Heavy rain warning for the north"]);
  assert.equal(fs.readFileSync("data/live/translation-cache-news.json", "utf8"), newsBefore, "the news lane's file is untouched");
  assert.equal(JSON.parse(fs.readFileSync("data/live/translation-cache.json", "utf8"))[key("ฝนตกหนัก", "th")].en, "Heavy rain", "the shared file is untouched");
});
console.log(ok + " passed");
