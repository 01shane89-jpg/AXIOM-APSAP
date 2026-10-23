// Checks the Deep South headline rules (tools/deepsouth_lib.mjs): training, exercises and drills are kind "training", never an
// attack (an ISOC IED-awareness course was filed as a bomb, 2026-10-21), unless the headline says someone was hurt or attacked;
// training headlines never raise an IED alert; and the translation guard puts security-force terms and public officials into
// English before the model sees them ("อส." came out as "Mumbai", "'ทวี'" as "Tway") and rejects a translation that loses them.
// Run from the repo root: node tests/deepsouth_kinds.test.mjs
import assert from "node:assert/strict";
import { classify, kindWords, markAlerts, placeSubst, placeMismatch } from "../tools/deepsouth_lib.mjs";

const IED_COURSE = "“รู้ให้เท่าทัน ป้องกันภัย” จากวัตถุระเบิดแสวงเครื่อง หน่วยเฉพาะกิจอโณทัย จัดอบรมเสริมความรู้ IED ให้กับกำลังพลในพื้นที่จังหวัดชายแดนใต้";
assert.equal(classify(IED_COURSE), "training", "IED-awareness course is training");
assert.equal(kindWords(IED_COURSE).kind, "training");
assert.equal(classify("Fire drill at Pattani school"), "training");
assert.equal(classify("Rangers hold bomb disposal exercise in Yala"), "training");
// an attack stays an attack, whatever else the headline says
assert.equal(classify("Ranger killed in bomb attack near training camp"), "ied");
assert.equal(classify("คนร้ายลอบวางระเบิดทหารพรานขณะฝึก"), "ied");
assert.equal(classify("Bomb attack kills two rangers in Narathiwat"), "ied");
assert.equal(classify("Gunmen shoot village defence volunteer"), "shooting");
// a bomb on a train is not training (the word "train" alone is not a training word)
assert.equal(classify("Bomb found on train at Sungai Kolok"), "ied");

// training never alerts, even from an official source with explosive words
const items = markAlerts([{ date: "2026-10-20T03:00", kind: "training", exp: 1, link: "https://www.isoc.go.th/x", geo: { prov: "Yala" } }], () => "");
assert.equal(items[0].alert, undefined, "no IED alert for training");

// translation guard
assert.match(placeSubst("เหตุปะทะคนร้ายลอบยิง อส. เดินทางไปละหมาด"), /Or Sor volunteer/);
assert.match(placeSubst("'ทวี' แนะ 'รัฐบาล' คลอดพ.ร.ก.สันติภาพ"), /Thawee Sodsong/);
assert.equal(placeSubst("ความรุนแรงทวีขึ้น"), "ความรุนแรงทวีขึ้น", "ทวี as the verb 'to increase' is left alone");
assert.match(placeSubst("กอ.รมน.ภาค 4 แถลง"), /^ISOC แถลง$/);
assert.equal(placeMismatch("ลอบยิง อส.", "Terrorist shooting in Mumbai"), true, "lost term rejects the translation");
assert.equal(placeMismatch("'ทวี' แนะ", "Tway suggests"), true);
assert.equal(placeMismatch("'ทวี' แนะ", "Thawee suggests"), false);
assert.equal(placeMismatch("ลอบยิง อส.", "Or Sor volunteer shot"), false);
assert.equal(placeMismatch("ความรุนแรงทวีขึ้น", "Violence increases"), false);
console.log("deepsouth_kinds.test.mjs: all passed");
