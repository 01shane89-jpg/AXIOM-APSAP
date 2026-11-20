// Chinese headlines: a 機艦 count of aircraft and ships kept as one noun, and an aircraft carrier the original does not name
// (tools/mt_zh.mjs, used by tools/mt_guard.mjs mtSuspect). The rejected lines are real MADLAD-400 output, Taiwan, 2026-11-20.
// Run: node tests/mt_zh.test.mjs
import assert from "node:assert/strict";
import { zhCombinedCountLost, zhCarrierAdded } from "../tools/mt_zh.mjs";
import { mtSuspect } from "../tools/mt_guard.mjs";

const now = Date.parse("2026-11-20T09:00:00Z");
let ok = 0; const t = (name, f) => { f(); ok++; console.log("ok -", name); };

t("a combined count of aircraft and ships keeps both", () => {
  const cna = "中共17機艦船4空飄氣球擾台 國軍嚴密監控應處";
  assert.equal(zhCombinedCountLost(cna, "The Chinese Communist Party has 17 ships and four balloon jamming sites."), "the aircraft");
  assert.match(mtSuspect(cna, "The Chinese Communist Party has 17 ships and four balloon jamming sites.", now, "zh"), /aircraft and ships: the aircraft left out/);
  assert.equal(zhCombinedCountLost("不只俄機擾台！偵獲15共機艦、4氣球侵擾 國軍嚴密監控應處", "Not just the Russians, but 15 aircraft and four balloons have been detected."), "the ships");
  assert.equal(zhCombinedCountLost("空飄氣球季又來了？中共15機艦擾台 4氣球近我本島上空", "15 Chinese ships are in the air, and four balloons fly over my home island."), "the aircraft");
  assert.equal(zhCombinedCountLost(cna, "17 Chinese aircraft and ships and 4 balloons near Taiwan, military monitoring"), "");
  assert.equal(zhCombinedCountLost("中共15機艦擾台", "15 Chinese military aircraft and vessels harass Taiwan"), "");
  assert.equal(zhCombinedCountLost("新／中共軍機3架次、船艦15艘擾台", "3 Chinese military aircraft and 15 ships near Taiwan"), "", "separate counts are not a 機艦 count");
});

t("an aircraft carrier needs a carrier word in the original", () => {
  const en = "The Chinese Communist Party's 14 aircraft carriers are in the sea around the shipyard.";
  assert.equal(zhCarrierAdded("中共14機艦船台海周邊活動 國軍嚴密掌握應處", en), "aircraft carrier");
  assert.match(mtSuspect("中共14機艦船台海周邊活動 國軍嚴密掌握應處", en, now, "zh"), /aircraft carrier not in the original/);
  assert.equal(zhCombinedCountLost("中共14機艦船台海周邊活動", en), "the aircraft and ships", "a carrier is not aircraft");
  assert.equal(zhCarrierAdded("福建艦通過台灣海峽", "Aircraft carrier Fujian transits the Taiwan Strait"), "");
  assert.equal(zhCarrierAdded("遼寧號航艦編隊", "Liaoning aircraft carrier group"), "");
  assert.equal(zhCarrierAdded("中, 항공모함급 과학연구 인공섬 건설 추진", "China to build an aircraft carrier-class artificial island"), "", "Korean 항공모함");
  assert.equal(zhCarrierAdded("美, 재공습 고려 속 항모 파견", "US sends aircraft carrier as it weighs new strikes"), "", "Korean 항모");
  assert.equal(zhCarrierAdded("Carrier news", "aircraft carrier"), "", "not Chinese");
});

console.log(ok + " passed");
