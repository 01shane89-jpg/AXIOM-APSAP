// Machine translation guard (tools/mt_guard.mjs) and its use in the daily summary. Run: node tests/mt_guard.test.mjs
// The rejected lines are real MADLAD-400 output from the news pool (2026-09-29 to 2026-10-04).
import assert from "node:assert/strict";
import fs from "node:fs";
import { mtSuspect, dropSuspectMt, asciiDigits } from "../tools/mt_guard.mjs";
import { compileRelevance } from "../tools/topics_lib.mjs";
import { buildRules, fromRow } from "../tools/daily_lib.mjs";

const now = Date.parse("2026-10-04T12:00:00Z");
let ok = 0; const t = (name, f) => { f(); ok++; console.log("ok -", name); };

t("invented stock lines are rejected", () => {
  assert.ok(mtSuspect("อนุทิน แจกงานรมต.สู้ท่วม ปชน.ส่งทีมลงช่วยปชช. จ่อใช้สภาฯรุกรบ.แก้วิกฤต", "The 1980s were a time of great success for the band, and they continued to do so until the late 1990s.", now));
  assert.ok(mtSuspect("ระทึก! ยิงสกัดไล่ล่าเก๋งต้องสงสัยกลางชุมชนวัดธรรมฯ ชลบุรี ยึด ...", "The 1980s were a time of great success for the band.", now));
  assert.ok(mtSuspect("批桃園「被按下停止鍵」 賴清德力挺黃世杰：需要一流人才帶領", "The 1980s were a time of great success for the company.", now));
  assert.ok(mtSuspect("韓國瑜輔選大讚謝國樑 童子瑋：「太少來基隆」與市民感受有落差", "\"韓國瑜副選大讚謝國樑\" (in Korean).", now));
});
t("a line still in the original's script is not a translation", () => {
  assert.equal(mtSuspect("助講不捨李四川被抹黑 蔣萬安：自己也被丟滿身泥巴", "李四川被诬蔑 蒋万安：自己也被扔满身泥", now), "not English");
  assert.equal(mtSuspect("蔣萬安：TPASS 擴大", "Chiang Wan-an: TPASS expands (蔣萬安)", now), "");
});
t("a year or decade the original does not have is rejected", () => {
  assert.match(mtSuspect("포천 플라스틱 재활용 공장서 화재…인명 피해 없어", "2016-09-30 - Fire in plastic recycling plant", now), /2016/);
  assert.match(mtSuspect("Registro Civil reporta más de 509.000 adultos mayores atendidos entre 2025 y 2026", "Civil Registry reports more than 509,000 elderly adults assisted between 2025 and 2016", now), /2016/);
  assert.ok(mtSuspect("1호선 의왕~성균관대역 선로서 60대 전동차에 치여 사망", "The 1950s: the first train to be built in the United States.", now));
});
t("faithful translations pass, years in any digits or calendar", () => {
  assert.equal(mtSuspect("ลอบวางระเบิดรถทหารพราน รือเสาะ นราธิวาส เจ็บ 2", "Bomb attack on ranger vehicle in Rueso, Narathiwat, 2 injured", now), "");
  assert.equal(mtSuspect("২০০১ সালের নির্বাচনে বিএনপির নেতৃত্বাধীন জোটের বিপুল জয়", "The BNP-led coalition's overwhelming victory in the 2001 elections", now), "");
  assert.equal(mtSuspect("งบประมาณปี 2569 ล่าช้า", "The 2026 budget is delayed", now), "");                  // Buddhist Era year
  assert.equal(mtSuspect("น้ำท่วมหนักสุดในรอบ ปี 54", "Worst flooding since 2011", now), "");                     // short BE year
  assert.equal(mtSuspect("公費流感抗病毒藥劑延長至今(115)年10月31日止", "Publicly funded flu drugs extended until October 31, 2026", now), "");   // Minguo year
  assert.equal(mtSuspect("1930년대 군산으로 시간여행", "Time travel to Gunsan in the 1930s", now), "");
  assert.equal(mtSuspect("이재명 대통령, 국무회의 주재", "President Lee chairs the Cabinet meeting this year", now), "");
  assert.equal(mtSuspect("2천여명 대피", "2000 people evacuated", now), "");                                           // a round number, not a year
  assert.equal(asciiDigits("๒๕๖๙ ২০০১"), "2569 2001");
});
t("a stored item loses an invented headline and keeps its original", () => {
  const i = { title: "เดือดกลางน้ำท่วม! ชาวบ้านปทุมธานี-รองนายกฯ หวิดวางมวย โต้เถียงปมสูบน้ำ", title_en: "The 1980s were a time of great success for the band.", mt: "MADLAD-400", lang: "th" };
  assert.equal(dropSuspectMt(i, now), true);
  assert.equal(i.title_en, undefined); assert.equal(i.mt, "untranslated");
  const g = { title: "ลอบวางระเบิด", title_en: "Bomb planted", mt: "MADLAD-400", lang: "th" };
  assert.equal(dropSuspectMt(g, now), false); assert.equal(g.title_en, "Bomb planted");
});
// The Thailand summary of 2026-10-04 led with "The 1980s were a time of great success for the band" (3 outlets): three different
// Thai stories (a shooting chase in Chonburi, a flood row in Pathum Thani, an MP's flood visit) given the same invented line.
t("regression: invented lines never lead the daily summary or merge different stories", () => {
  const R = compileRelevance(JSON.parse(fs.readFileSync("tools/relevance.json", "utf8")));
  const row = (en, orig, outlet, url, date, flags) => fromRow(["th", date, en, orig, outlet, url, "", flags, ""]);
  const band = "The 1980s were a time of great success for the band.";
  const items = [
    row(band, "ระทึก! ยิงสกัดไล่ล่าเก๋งต้องสงสัยกลางชุมชนวัดธรรมฯ ชลบุรี ยึด ...", "เดลินิวส์", "https://www.dailynews.co.th/news/6246364/", "2026-10-03T16:15", "sm"),
    row(band.replace(".", ", but they had to face financial difficulties."), "‘วีระยุทธ’ ลงพื้นที่บางคล้า พบชาวบ้านโดนน้ำท่วมนานนับสัปดาห์ แต่ยังไร้ความช่วยเหลือ", "Khaosod", "https://www.khaosod.co.th/politics/news_10424180", "2026-10-03T13:29", "m"),
    row(band, "เดือดกลางน้ำท่วม! ชาวบ้านปทุมธานี-รองนายกฯ หวิดวางมวย โต้เถียงปมสูบน้ำ", "Amarin TV", "https://www.amarintv.com/news/social/559313", "2026-10-03T06:36", "m"),
    row("South bandits shoot down Rueso policeman, Narathiwat. One injured", "คนร้ายยิงตำรวจรือเสาะ นราธิวาส เจ็บ 1", "Matichon", "https://www.matichon.co.th/region/news_1", "2026-10-03T10:00", "m"),
    row("Two hurt in petrol station blast", "", "Bangkok Post", "https://www.bangkokpost.com/thailand/general/1", "2026-10-03T11:00", ""),
  ];
  const d = buildRules({ cc: "th", name: "Thailand", end: Date.parse("2026-10-04T00:05:00Z"), items }, R);
  const text = JSON.stringify([d.bluf, d.events, d.refs]);
  assert.ok(!/1980s|the band/i.test(text), "no invented line anywhere in the summary");
  assert.ok(!d.events.some((e) => e.n > 1), "three different stories are not one event carried by three outlets");
  assert.ok(d.events.some((e) => /ยิงสกัดไล่ล่า/.test(e.text)), "the shooting chase is listed in its own words");
  assert.ok(d.events.some((e) => /policeman/.test(e.text)) && d.events.some((e) => /blast/.test(e.text)));
});
console.log(ok + " passed");
