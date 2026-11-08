// Machine translation guard (tools/mt_guard.mjs) and its use in the daily summary. Run: node tests/mt_guard.test.mjs
// The rejected lines are real MADLAD-400 output from the news pool (2026-09-29 to 2026-10-04).
import assert from "node:assert/strict";
import fs from "node:fs";
import { mtSuspect, dropSuspectMt, asciiDigits, extraNumber, looksEnglish, extraMonth } from "../tools/mt_guard.mjs";
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
// 2026-10-06: a Thai PBS YouTube headline with no time in it came back as "10.35am: The rain continues ..." (Mae Hong Son floods)
t("a clock time the original does not give is rejected; times it does give pass", () => {
  assert.equal(mtSuspect("น้ำป่าทะลักท่วมหลายจุดใน จ.แม่ฮ่องสอน | จับตาสถานการณ์ | 6 ต.ค. 69",
    "10.35am: The rain continues to fall in Mae Hong Son Province, causing flooding and damage to the infrastructure of many areas.", now), "clock time not in the original");
  assert.ok(mtSuspect("اخبار ساعت شش دوشنبه ۱۳ مهر: آمریکا تمام بمب‌افکن‌های خود را از پایگاه فرفورد بریتانیا منتقل کرد", "6:30 a.m. – The United States announces that it has removed all of its bombers.", now));
  assert.equal(mtSuspect("เวลา 10.35 น. ฝนตกหนัก", "At 10.35am heavy rain fell", now), "");
  assert.equal(mtSuspect("เวลา 22.30 น. ฝนตกหนัก", "At 10:30pm heavy rain fell", now), "");
  assert.equal(mtSuspect("রাত ৮টার সংবাদ", "8:00pm news", now), "");
  assert.equal(mtSuspect("แผ่นดินไหว ขนาด 6.5", "A magnitude 6.5 earthquake", now), "");
  assert.equal(mtSuspect("ราคา 1,234.50 บาท", "Price 1,234.50 baht", now), "");
  assert.equal(mtSuspect("ฝนตก 3 วัน", "Rain for 3 days", now), "");
});
// 2026-11-08: of 88,095 stored translations, 1,231 gave a number the original does not have. Real MADLAD-400 output below.
const n8 = Date.parse("2026-11-08T06:00:00Z");
t("a number the original does not have is rejected", () => {
  assert.match(mtSuspect("CANAL3-BENIN : Journal Télévisé 19h30 du Jeudi 05 Novembre  2026", "CANAL3-BENIN: Journal Télévisé 19h30 du Jeudi 28 Novembre 2026", n8), /number 28/);
  assert.match(mtSuspect("مشاريع رياضية متعثرة ورهانات استثمارية تلاحق استعدادات بغداد لخليجي 28", "Sports projects and investment risks haunt Baghdad’s preparations for the Gulf Games 26", n8), /number 26/);
  assert.match(mtSuspect("Կրակոցներ Կրակովի կենտրոնում․ զոհերի թիվը հասել է 6-ի, կա 15 վիրավոր", "The 15th Infantry Division was shot down by the 6th, 7th and 9th.", n8), /number 7/);
  assert.match(mtSuspect("Սարգսյանը՝ հանրային ճնշումների մասին", "The 100 Most Powerful People in the World", n8), /number 100/);
  assert.match(mtSuspect("Bijna iedereen kan volgend jaar hogere hypotheek krijgen: ‘Verschil van 10.000 tot 35.000 euro’", "Almost everyone can get a higher mortgage next year: ‘Differences of 10,000 to 35,002 euros’", n8), /35,002/);
  assert.match(mtSuspect("Đắk Lắk đề nghị xác minh thông tin 845 triệu đồng tiền thưởng ở trường học", "The school is expected to receive an additional $850 million in grants from the government.", n8), /850/);
  assert.match(mtSuspect("Journal en Arabe de 18h du 30/10/2026", "Journal en Arabe de 18h du 09/10/2026", n8), /number 09/);
});
t("numbers written another way pass", () => {
  const same = (o, e) => assert.equal(extraNumber(o, e), "", o + " -> " + e);
  same("１０月の米雇用、１６万５０００人増 予想大幅超過、失業率４．１％", "U.S. employment increases by 165,000 in October, far exceeding expectations, unemployment rate at 4.1%.");
  same("ソウル交通公社、是正命令後も鉄道準事故報告漏れ…課徴金2億4000万ウォン", "Seoul Transportation Corporation fined 240 million won");
  same("外資砍台股1499億元 買賣超前十檔一次看", "Foreign investors sell 149.9 billion yuan of Taiwan stocks");
  same("文化部1.38億預算只有17字", "The Ministry of Culture's 138 million budget is only 17 words");
  same("ยอดผู้หนีภัยลดลงจาก 1.1 ล้านเหลือ 9.4 แสน", "Refugees down from 1.1 million to 940,000");
  same("Tri muškarca uhapšena zbog 1,2 kg kokaina", "Three men arrested for 1.2 kg of cocaine");
  same("France : Entre 40 000 et 60 000 manifestants attendus", "France: Between 40,000 and 60,000 protesters expected");
  same("XAAGU 19H DU 11/10/2026", "XAAGU 7PM 10/11/2026");
  same("Clausura de la XXX Cumbre Iberoamericana en Madrid", "Closing of the 30th Ibero-American Summit in Madrid");
  same("Lajmet në orën 21:00", "News at 9:00 pm");
  same("Sommet: cinq morts et douze blessés", "Summit: 5 dead and 12 injured");                 // number words, no digits in the original
  same("ឆ្នាំសិក្សា២០២៦-២០២៧", "the 2026-27 school year");
  same("日증시, 반도체 투자 우려에 6만선 무너져", "Nikkei 225 falls below 60,000");
  same("公費流感新冠疫苗2階開打", "Second phase of COVID-19 and flu shots begins");
});
t("a headline already in English under another label is shown as written", () => {
  for (const s of ["Bahrain News Center: His Majesty the King issues Decree No. 55 of 2026, 28-10-2026",
    "Did Qatar interfere in the elections? Shin Bet investigates suspicion of foreign funding",
    "9 dead after business jet crashes into residential area in Florida"]) assert.ok(looksEnglish(s), s);
  for (const s of ["CANAL3-BENIN : Le 13h au Bénin du Samedi 31 Octobre 2026", "Kapuso Housemate Lans, wagi ng parangal",
    "President Simons: regering werkt aan aanpak corruptie", "Hallan tres cuerpos en la vivienda del presunto autor del tiroteo",
    "Prisvinner innrømmer AI-bruk i roman", "Zürcher Spitzen-Imam tritt nach homophoben Aussagen zurück", "한병도 대통령"]) assert.ok(!looksEnglish(s), s);
  const i = { title: "Bahrain News Center: His Majesty the King issues Decree No. 55 of 2026, 28-10-2026", title_en: "Bahrain News Center: His Majesty the King issues Decree No. 55 of 2026, 28-10-2027", mt: "MADLAD-400", lang: "ar" };
  assert.equal(dropSuspectMt(i, n8), true);
  assert.equal(i.title_en, i.title); assert.equal(i.mt, undefined);
});
// 2026-11-08: 211 stored translations named a month the original does not give, 136 of them Thai ("พ.ย." is November).
t("a month the original does not give is rejected", () => {
  assert.match(mtSuspect("ข่าวดึก | 5 พ.ย. 69", "Late News | 5th of July, 69", n8), /month July/);
  assert.match(mtSuspect("ปภ. เตือน 61 จังหวัด เตรียมรับมือฝนตกหนักมาก ช่วง 5-9 พ.ย.นี้", "61 provinces are warned of heavy rainfall from July 5 to 9.", n8), /month July/);
  assert.match(mtSuspect("２３～２４日に先島諸島接近か 大型台風３０号", "Typhoon 30 approaches Senkaku Islands on June 23-24", n8), /month June/);
  assert.match(mtSuspect("ອຸຕຸເຕືອນ! ວັນທີ 5-6 ພະຈິກ 2026 ຈະມີຝົນຕົກ", "Weather Alert! October 5-6, 2026 Rainfall", n8), /month October/);
  assert.match(mtSuspect("Kantipur Samachar | कान्तिपुर समाचार, १९ कार्तिक २०८३", "Kantipur Samachar | Kantip News, 19th of March 2083", n8), /month March/);
});
t("months the original gives, in any language or as a number, pass", () => {
  const same = (o, e) => assert.equal(extraMonth(o, e), "", o + " -> " + e);
  same("«الفاو»: انخفاض أسعار الغذاء العالمية بأكتوبر", "FAO: World Food Prices Fall in October");
  same("المسائية : الجمعة  06 نونبر 2026", "P.M.: Friday, 6 November 2026");
  same("Sjever Brača od 1. studenoga brzobrodskom linijom", "From November 1, the north of Brač is connected");
  same("İSRAİL'İN 7 EKİM İSTİHBARAT FİYASKOSU", "ISRAEL'S OCTOBER 7 INTELLIGENCE FIASCO");
  same("Андреевски: поскап за 211 проценти од јануари", "211 percent more expensive since January");
  same("PANI archivó en setiembre expediente", "PANI filed in September the case");
  same("LE DEBAT 09 0CTOBRE 2026", "THE DEBATE 09 OCTOBER 2026");
  same("FONOTAGA A LE PALEMENE O SAMOA - 28 OKETOPA 2026", "SAMOA PARLIAMENT - 28 OCTOBER 2026");
  same("Kunjungan pada 06.11.2026", "Visit on November 6, 2026");
  same("11月3日の米大統領選", "The US presidential election on November 3");
  same("ጥቅምት 27 ቀን", "October 27");                      // Ethiopian Tikimt straddles October and November
  same("Prime Minister may visit", "Prime Minister may visit");
  same("Protesters march on parliament", "Manifestants march on parliament");   // "march" is not a month here
});
console.log(ok + " passed");
