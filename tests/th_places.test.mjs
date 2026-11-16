// Thai place names in machine translation (tools/th_places.mjs, tools/mt/th_places.json): the guard that rejects a translation
// leaving out or replacing a place, and the English names the model is given. Run: node tests/th_places.test.mjs
// The rejected lines are real MADLAD-400 output from the stored Thai headlines (2026-10-17 to 2026-11-16).
import assert from "node:assert/strict";
import { thaiPlaces, protectThaiPlaces, missingThaiPlace } from "../tools/th_places.mjs";
import { mtSuspect } from "../tools/mt_guard.mjs";
import { prepareForModel } from "../tools/translate.mjs";

const now = Date.parse("2026-11-16T12:00:00Z");
let ok = 0; const t = (name, f) => { f(); ok++; console.log("ok -", name); };
const places = (s) => thaiPlaces(s).map((p) => p.en[0]);

t("the Patong fire headlines that lost Patong are rejected", () => {
  assert.match(mtSuspect("เปิดภาพนาทีไฟไหม้ป่าตอง เพลิงโหมลุกลามเสียชีวิต 11 คน", "11 dead in forest fire.", now, "th"), /place ป่าตอง \(Patong\)/);
  assert.match(mtSuspect("เจเศรษฐ์ลงพื้นที่ไฟไหม้ป่าตอง", "J. Settha visits forest fire in Tonle Sap", now, "th"), /Patong/);
  assert.match(mtSuspect("นายกฯ ห่วงไฟไหม้กลางป่าตอง สายตรงสั่ง ‘ผู้ว่าฯภูเก็ต’ ช่วยผู้บาดเจ็บ",
    "Prime Minister worried about fire in the pine forest, calls on Phuket governor to help injured", now, "th"), /Patong/);
  assert.equal(mtSuspect("เปิดภาพนาทีไฟไหม้ป่าตอง เพลิงโหมลุกลามเสียชีวิต 11 คน", "Fire in Patong: 11 dead as the blaze spread", now, "th"), "");
});

t("a place turned into another place is rejected", () => {
  assert.match(mtSuspect("ตร.ซ้อนแผน ตะครุบหนุ่มแก๊งคอลฯ อ้างเป็นตำรวจขอนแก่น ตุ๋นป้าสูญทรัพย์", "Police catch call-center gang man posing as police in Kangar", now, "th"), /Khon Kaen/);
  assert.match(mtSuspect("ตำรวจ ปส.ยิงปะทะขบวนการขนยาไอซ์ วิสามัญฯ 2 คน ที่เพชรบุรี", "Police shoot down two suspected traffickers in Perth.", now, "th"), /Phetchaburi/);
  assert.match(mtSuspect("กระบี่ฝนตกต่อเนื่อง ทำน้ำท่วมกระทบ 5 อำเภอ", "5 districts in Kampong Thom flood due to heavy rainfall.", now, "th"), /Krabi/);
  assert.match(mtSuspect("สภา กทม. ชงยกระดับความปลอดภัย 437 โรงเรียน", "The council of the city of Seoul has raised security level in 437 schools", now, "th"), /Bangkok/);
});

t("a faithful translation passes, whatever the spelling or spacing", () => {
  assert.equal(missingThaiPlace("ผู้ว่าฯ สงขลา เร่งสำรวจภูเขา", "Songkhla governor orders survey of the hills"), "");
  assert.equal(missingThaiPlace("‘สุชาติ’ สั่งบุกบางละมุง ตรวจขยะอุตสาหกรรม", "Suchart orders a raid in Bang La Mung over industrial waste"), "");
  assert.equal(missingThaiPlace("จับยาบ้าที่บุรีรัมย์", "Methamphetamine seized in Buriram"), "");
  assert.equal(missingThaiPlace("ป่วนยะลา 8 จุด", "Yala's eight attacks"), "");
  assert.equal(missingThaiPlace("สภา กทม. อนุมัติงบ", "BMA council approves budget"), "");
});

t("place names only count as whole words", () => {
  // ชุมพร (Chumphon) inside ประชุมพรรค "party meeting", ตาก inside เพนตากอน (Pentagon)
  assert.deepEqual(places("จับตา ‘สีจิ้นผิง’ ประชุมพรรคคอมมิวนิสต์จีน"), []);
  assert.deepEqual(places("อดีตมือสอบสวน UFO เพนตากอน เผยทฤษฎี"), []);
  assert.deepEqual(places("ไฟใต้ลาม! โจรล้ำเส้นป่วนถึง”สตูล-สงขลา”"), ["Satun", "Songkhla"]);
});

t("names that are also common words need a place marker or a neighboring place", () => {
  assert.deepEqual(places("ชาวนาเอาข้าวมาตากบนถนน"), []);                // ตาก "to dry"
  assert.deepEqual(places("เผยแพร่ข่าวปลอม"), []);                       // เผยแพร่ "to publish"
  assert.deepEqual(places("ทัพฟ้าพิทักษ์น่านฟ้าไทย"), []);                // น่านฟ้า "airspace"
  assert.deepEqual(places("ไม่มีใครรู้เลย"), []);                        // เลย "at all"
  assert.deepEqual(places("มูลนิธิแม่ฟ้าหลวงฯ ผนึกบิ๊กเอกชน"), []);       // the Princess Mother's foundation
  assert.deepEqual(places("จับวัยรุ่น จ.ตาก ค้ายาบ้า"), ["Tak"]);
  assert.deepEqual(places("ชายแดนตาก-แม่ฮ่องสอน"), ["Tak", "Mae Hong Son"]);
  assert.deepEqual(places("ศอ.ปส.จ.แพร่ ร่วม"), ["Phrae"]);
  assert.deepEqual(places("ปะทะเดือดชายแดนแม่ฟ้าหลวง"), ["Mae Fa Luang"]);
  // a common word that is only a district name is not on the list at all
  assert.deepEqual(places("ปัญหาสังคม"), []);
});

t("short district names count only after the district marker", () => {
  assert.deepEqual(places("เหตุยิงที่ อ.ฮอด"), ["Hot"]);
  assert.deepEqual(places("ฮอด"), []);
});

t("the model is given the English place names, and the original stays as it was", () => {
  assert.equal(protectThaiPlaces("เปิดภาพนาทีไฟไหม้ป่าตอง เพลิงโหมลุกลาม"), "เปิดภาพนาทีไฟไหม้ Patong เพลิงโหมลุกลาม");
  assert.equal(protectThaiPlaces("ผู้ว่าฯ สงขลา เร่งสำรวจ"), "ผู้ว่าฯ Songkhla เร่งสำรวจ");
  assert.equal(protectThaiPlaces("ชาวนาเอาข้าวมาตากบนถนน"), "ชาวนาเอาข้าวมาตากบนถนน");
  assert.equal(protectThaiPlaces("No Thai here"), "No Thai here");
  // the Thai date rewriting still applies after the place names are written in
  assert.equal(prepareForModel("ไฟไหม้ป่าตอง 5 พ.ย. 69", "th"), "ไฟไหม้ Patong 5 พฤศจิกายน 2026");
});

t("text without Thai is never judged", () => {
  assert.equal(missingThaiPlace("Feuer in Patong", "forest fire"), "");
  assert.equal(missingThaiPlace("", ""), "");
});

console.log(ok + " passed");
