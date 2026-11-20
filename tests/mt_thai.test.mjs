// Thai headlines: a death, a foreign currency or a country the Thai does not have (tools/mt_thai.mjs, used by
// tools/mt_guard.mjs mtSuspect). The rejected lines are real MADLAD-400 output from the Deep South feed, 2026-11-20.
// Run: node tests/mt_thai.test.mjs
import assert from "node:assert/strict";
import { thaiDeathAdded, thaiCurrencyAdded, thaiCountryAdded } from "../tools/mt_thai.mjs";
import { mtSuspect } from "../tools/mt_guard.mjs";
import { missingThaiPlace, protectThaiPlaces } from "../tools/th_places.mjs";

const now = Date.parse("2026-11-20T09:00:00Z");
let ok = 0; const t = (name, f) => { f(); ok++; console.log("ok -", name); };

const AMARIN = "ระทึกกลางดึก! คนร้ายซุ่มยิง \"นายก ทต.บานา\" หน้าบ้านพักปัตตานี ...";
const NAEWNA = "เสียหายกว่า 10 ล้าน ศอ.บต.ลงพื้นที่สำรวจความเสียหาย อบต.ยะลา หลัง ...";
const MGR = "อุกอาจ! คนร้ายลอบยิงนายกเทศมนตรีเมืองบานาบาดเจ็บ ญาตินำตัวส่ง รพ.ล่าสุดปลอดภัยแล้ว";
const STANDARD = "เลขาฯ สมช. ย้ำไม่ยอมให้เหตุรุนแรงใต้ลามพื้นที่อื่น ขอร่วมกันประณามผู้ก่อเหตุโจมตีเป้าหมายอ่อนแอ เผยเฝ้าระวังภัยไซเบอร์ทั่วโลก";

t("a shooting with no death in the Thai is not 'killed'", () => {
  assert.equal(thaiDeathAdded(AMARIN, "A man shot and killed the mayor of Bana in front of his residence in Pattani."), "killed");
  assert.match(mtSuspect(AMARIN, "A man shot and killed the mayor of Bana in front of his residence in Pattani.", now, "th"), /"killed" not in the original/);
  assert.equal(thaiDeathAdded("ยิง \"นายกเทศมนตรีเมืองบานา\" จ.ปัตตานี เจ็บสาหัส", "Bana mayor shot dead in Pattani"), "dead");
});

t("a real death in the Thai passes", () => {
  assert.equal(thaiDeathAdded("คนร้ายยิงดับ อส. ที่ปัตตานี", "Gunmen shoot dead a volunteer ranger in Pattani"), "");
  assert.equal(thaiDeathAdded("ระเบิดรถยนต์ ทหารพราน เสียชีวิต 2 นาย", "Car bomb kills 2 rangers"), "");
  assert.equal(thaiDeathAdded("คนร้ายลอบยิงนายกเทศมนตรีบาดเจ็บ", "Gunmen shoot and wound a mayor"), "");
  assert.equal(thaiDeathAdded("ขยายเส้นตาย ยื่นเอกสาร", "Deadline for documents extended"), "");
  assert.equal(thaiDeathAdded("Police kill suspect", "Police kill suspect"), "", "not Thai: left to the other checks");
});

t("a Thai paper's ล้าน is baht, not rupees or dollars", () => {
  const en = "SBPAC to investigate damages in Yala after 10 million rupees lost";
  assert.equal(thaiCurrencyAdded(NAEWNA, en), "rupees");
  assert.match(mtSuspect(NAEWNA, en, now, "th"), /currency rupees not in the original/);
  assert.equal(thaiCurrencyAdded(NAEWNA, "Over $10 million in damage in Yala"), "dollars");
  assert.equal(thaiCurrencyAdded(NAEWNA, "Over 10 million baht in damage, SBPAC surveys Yala"), "");
  assert.equal(thaiCurrencyAdded("ส่งออกพุ่ง 5 พันล้านดอลลาร์", "Exports jump 5 billion dollars"), "");
  assert.equal(thaiCurrencyAdded("ค่าเงินหยวนอ่อนตัว 1 ล้าน", "Yuan weakens, 1 million yuan"), "");
});

t("a country the Thai does not name is rejected", () => {
  const en = "The Secretary of State for Foreign Affairs, Mr. Lee Myung-bak, said that the United States would not allow violence to spread beyond its borders.";
  assert.equal(thaiCountryAdded(STANDARD, en), "United States");
  assert.match(mtSuspect(STANDARD, en, now, "th"), /country United States not in the original/);
  assert.equal(thaiCountryAdded("เหตุรุนแรงชายแดนใต้ ยิงถล่มป้อม", "South Korea border violence, outpost attacked"), "South Korea");
  assert.equal(thaiCountryAdded("ทรัมป์ ขู่ขึ้นภาษีไทย", "U.S. threatens tariffs on Thailand"), "", "Trump stands for the US");
  assert.equal(thaiCountryAdded("กัมพูชา ยิงปืนใหญ่ข้ามแดน", "Cambodia fires artillery across the border"), "");
  assert.equal(thaiCountryAdded("ศาลอังกฤษ สั่งอายัดทรัพย์ 'สายการบินเวียตเจ็ท'", "British court orders seizure of VietJet assets in Vietnam"), "", "an old region code (VD) does not hide the Thai name");
  assert.equal(thaiCountryAdded("ข่าวใต้", "German minister visits"), "Germany");
  assert.equal(thaiCountryAdded("ฝนตกหนัก ภาคใต้", "Heavy rain in southern Thailand"), "", "Thailand is the reader's context");
  assert.equal(thaiCountryAdded("ฝนตกหนัก ภาคใต้", "Heavy rain in the south, us and them"), "", "lower-case 'us' is a word");
});

t("Bana is a place the translation must keep", () => {
  assert.match(missingThaiPlace(MGR, "Assassins shot and wounded Banana City Mayor, family takes him to hospital."), /Bana/);
  assert.equal(missingThaiPlace(MGR, "Gunmen shot and wounded the Bana mayor; family takes him to hospital, now safe."), "");
  assert.match(protectThaiPlaces(MGR), /Bana/);
});

console.log(ok + " passed");
