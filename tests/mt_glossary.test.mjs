// Terms a machine translation must keep (tools/mt_glossary.mjs, used by tools/mt_guard.mjs mtSuspect and tools/translate.mjs
// prepareForModel). The rejected lines are real MADLAD-400 output from the news pool, 2026-11-17 (Russian aircraft entering the
// Korean and Japanese air defense identification zones). Run: node tests/mt_glossary.test.mjs
import assert from "node:assert/strict";
import { protectTerms, termMissing, countryAdded, hedgeLost } from "../tools/mt_glossary.mjs";
import { mtSuspect } from "../tools/mt_guard.mjs";
import { prepareForModel } from "../tools/translate.mjs";

const now = Date.parse("2026-11-17T09:00:00Z");
let ok = 0; const t = (name, f) => { f(); ok++; console.log("ok -", name); };

t("KADIZ read as the Spanish city is rejected", () => {
  assert.match(mtSuspect("새벽 러 군용기 카디즈 진입…공군 출격 대응", "Russian military aircraft enter Cádiz at dawn...", now, "ko"), /air defense identification zone/);
  assert.match(mtSuspect("러 군용기, 17일 카디즈 진입 후 이탈…軍 \"전투기 투입해 대비\"", "Russian military aircraft leaves Italy after entering Cadiz on 17th...", now, "ko"), /air defense/);
  assert.equal(mtSuspect("새벽 러 군용기 카디즈 진입…공군 출격 대응", "Russian military aircraft enter KADIZ at dawn, Air Force scrambles in response", now, "ko"), "");
  assert.equal(termMissing("러 군용기 카디즈 진입", "Russian aircraft enter the Korea Air Defense Identification Zone"), "");
  assert.equal(termMissing("러 군용기 카디즈 진입", "Russian military aircraft entered the Korean air defence and identification zone (KADIZ)"), "");
  assert.match(termMissing("러 군용기, 17일 카디즈 진입 후 이탈", "Russian military aircraft leaves Italy after entering Kadiz on 17th..."), /air defense/);
});

t("an air defense zone called airspace is rejected", () => {
  assert.match(mtSuspect("កូរ៉េខាងត្បូង បញ្ជូនយន្តហោះចម្បាំងស្ទាក់ចាប់ ក្រោយយន្តហោះរុស្ស៊ីហោះចូលតំបន់ ការពារដែនអាកាសរបស់ខ្លួន",
    "South Korea sends fighter jets to deter Russian aircraft flying into its airspace", now, "km"), /air defense/);
  // the Japanese report says airspace in the original: nothing to keep, nothing rejected
  assert.equal(termMissing("ភាពតានតឹងដែនអាកាស ជប៉ុនប្រើប្រាស់យន្តហោះចម្បាំង ឆ្លើយតបនិងយន្តហោះរុស្ស៊ី បានហោះរំលោភចូល ដែនអាកាសរបស់ខ្លួន",
    "Airspace tension Japan uses fighter jets in response to Russian aircraft flying into its airspace"), "");
  assert.equal(termMissing("不只共機擾台？2俄羅斯軍機逼進台灣 闖我防空識別區國軍緊盯", "Two Russian military aircraft enter Taiwan, breaking into our air defense zone."), "");
  assert.match(termMissing("中国军机进入日本防空识别区", "Chinese military aircraft enter Japanese airspace"), /air defense/);
});

t("a scramble turned into an attack is rejected, a real attack is not", () => {
  assert.match(mtSuspect("러 군용기 여러 대 KADIZ 진입…공군 전투기 출격 대응", "Russian military aircraft entered KADIZ... Air Force fighters respond to attack", now, "ko"), /출격/);
  assert.equal(termMissing("러 군용기 여러 대 KADIZ 진입…공군 전투기 출격 대응", "Russian military aircraft entered KADIZ; Air Force fighters scramble in response"), "");
  assert.equal(termMissing("북 미사일 공격에 전투기 출격", "Fighters scramble after North Korean missile attack"), "");
  assert.equal(termMissing("심정지로 숨져", "died of a heart attack"), "", "no 출격: the check does not apply");
});

t("the model is given the terms spelled out (Korean with the acronym, other scripts in English); the rest is left alone", () => {
  assert.equal(protectTerms("새벽 러 군용기 카디즈 진입…공군 출격 대응"), "새벽 러 군용기 한국 방공식별구역(KADIZ) 진입…공군 출격 대응");
  assert.equal(protectTerms("러 군용기, 동해 카디즈진입"), "러 군용기, 동해 한국 방공식별구역(KADIZ) 진입");
  assert.equal(protectTerms("러 군용기 여러 대 KADIZ 진입"), "러 군용기 여러 대 한국 방공식별구역(KADIZ) 진입");
  assert.equal(protectTerms("중국 군용기 한국 방공식별구역(KADIZ) 진입"), "중국 군용기 한국 방공식별구역(KADIZ) 진입", "already written out: unchanged");
  assert.equal(protectTerms("Chinese aircraft enter the KADIZ"), "Chinese aircraft enter the KADIZ", "English text is not touched");
  assert.equal(protectTerms("闖我防空識別區國軍緊盯"), "闖我 air defense identification zone 國軍緊盯");
  assert.equal(protectTerms("중국 방공식별구역 선포"), "중국 air defense identification zone 선포");
  assert.equal(protectTerms("ខ្លួនហោះចូលតំបន់ការពារដែនអាកាស"), "ខ្លួនហោះចូល air defense zone");
  assert.equal(protectTerms("Ohne Begriff"), "Ohne Begriff");
  assert.equal(prepareForModel("새벽 러 군용기 카디즈 진입", "ko"), "새벽 러 군용기 한국 방공식별구역(KADIZ) 진입");
});

// 2026-11-17, Hormuz: real output from the stored index
t("a mine read as a whale, a ranch, a bomb or a jetty is rejected", () => {
  assert.match(mtSuspect("Kapal Tanker Super Angkut 2 Juta Barel Minyak Tenggelam di Selat Hormuz Usai Tabrak Ranjau",
    "Supertanker Carrying 2 Million Barrels of Oil Sunk in Strait of Hormuz After Collision with a Whale", now, "id"), /term mine/);
  assert.match(termMissing("Dua Kapal Tangker Arahan Militer AS Hantam Ranjau Laut", "Two US-Ordered Tanker Ships Hit a Sea Ranch"), /mine/);
  assert.match(termMissing("อิหร่านเผยมีเรือบรรทุกน้ำมัน 3 ลำ ชนทุ่นระเบิดในช่องแคบฮอร์มุซ", "Iran says three oil tankers hit a bomb in the Strait of Hormuz."), /mine/);
  assert.match(termMissing("Lại thêm tàu chở dầu phát nổ vì trúng thủy lôi ở eo biển Hormuz", "Another oil tanker exploded after hitting a jetty in the Strait of Hormuz."), /mine/);
  assert.equal(termMissing("Kapal Tanker Tenggelam Usai Tabrak Ranjau", "Supertanker sank after hitting a mine"), "");
  assert.equal(termMissing("รถแบ็กโฮเหยียบทุ่นระเบิด", "Backhoe hits a landmine"), "");
  // Arabic only as a whole word: لغمان is Laghman, الغموض "mystery"
  assert.equal(termMissing("تیراندازی هوایی در مراسم عروسی در لغمان", "Aerial shooting at wedding in Laghman kills two people"), "");
  assert.equal(termMissing("5 انفجارات تهز جزيرة قشم الإيرانية.. وتحليق طائرات يثير الغموض", "Five explosions shake Qeshm island"), "");
  assert.match(termMissing("تصعيد بعد اصطدام ناقلتي نفط بألغام", "Escalation after two tankers collide"), /mine/);
});

t("Hormuz read as Homs or Hermes is rejected", () => {
  assert.match(termMissing("荷姆茲海峽單月37船遇襲創新高!", "37 ships attacked in a month in the Strait of Homs, record high!"), /Hormuz/);
  assert.match(termMissing("«مجموعة السبع» تطالب إيران بوقف الهجمات في «هرمز»", "G7 Demands Iran to Stop Hermès Attacks"), /Hormuz/);
  assert.equal(termMissing("تصعيد بهرمز", "Escalation in Hormuz"), "", "بهرمز is \"in Hormuz\"");
  assert.equal(termMissing("بيان هام للشيخ كمال باهرمز", "Important statement by Sheikh Kamal Bahormuz"), "", "باهرمز is a family name");
  assert.equal(termMissing("3油輪在荷姆茲觸雷爆炸!", "Three oil tankers hit a mine in Hormuz"), "");
});

t("Iraq or Syria the original does not name is rejected", () => {
  assert.equal(countryAdded("3油輪在荷姆茲觸雷爆炸! 伊怪美軍引導關閉AIS 迄今至少25海員在此喪生",
    "Three oil tankers hit a mine in Homs, Iraqi forces shut down AIS and at least 25 seamen have died."), "Iraq");
  assert.match(mtSuspect("川普稱「極不可能」大規模再襲伊! 美軍陸海封鎖", "Trump Says It Is 'Extremely Unlikely' That Syria Will Re-Attack On A Large Scale", now, "zh"), /country Syria/);
  assert.equal(countryAdded("'기름값 심판' 받은 트럼프…이란 전쟁이 부메랑 됐다", "The war in Iraq has turned into a boomerang."), "Iraq");
  assert.equal(countryAdded("Stravičan napad: 24 osobe poginule, Rusi gađali školu", "24 killed in Syrian attack, Russians fire on school"), "Syria");
  // named in any language, inflected, or by its capital
  assert.equal(countryAdded("Alarm na letališču v Münchnu: Iračana sta se izdajala za grška diplomata", "Two Iraqis posing as Greek diplomats"), "");
  assert.equal(countryAdded("Γερμανία: συνελήφθησαν δύο Ιρακινοί", "Germany: Two Iraqis arrested"), "");
  assert.equal(countryAdded("سەرۆکوەزیرانی عێراق", "Iraqi Prime Minister"), "");
  assert.equal(countryAdded("دمشق تعلن بدء تحقيقات", "Syrian government announces investigation"), "");
  assert.equal(countryAdded("সিরিয়ায় বন্যা", "Syria Floods"), "");
  assert.equal(countryAdded("伊朗再攻荷姆茲海峽油輪", "Iran attacks oil tanker in Strait of Hormuz"), "", "Iran is not checked");
});

t("the model is given Hormuz and the mine in English", () => {
  assert.equal(protectTerms("Kapal Tanker Tenggelam Usai Tabrak Ranjau"), "Kapal Tanker Tenggelam Usai Tabrak mine");
  assert.equal(protectTerms("Dua Kapal Tangker Hantam Ranjau Laut"), "Dua Kapal Tangker Hantam mine");
  assert.equal(protectTerms("荷姆茲海峽單月37船遇襲"), "Hormuz 海峽單月37船遇襲");
  assert.equal(protectTerms("تطالب إيران بوقف الهجمات في «هرمز»"), "تطالب إيران بوقف الهجمات في «Hormuz»");
  assert.equal(protectTerms("ชนทุ่นระเบิดในช่องแคบฮอร์มุซ"), "ชน mine ในช่องแคบ Hormuz");
  assert.equal(protectTerms("trúng thủy lôi ở eo biển Hormuz"), "trúng naval mine ở eo biển Hormuz");
  assert.equal(protectTerms("北 지뢰폭발"), "北 지뢰폭발", "Korean is left alone");
});

// 2026-11-18, the Iranian "dirty bomb" warning: real output from the stored index
t("a possible attack made into one that happened is rejected", () => {
  assert.match(mtSuspect("ASV izlūkdienesti brīdina par iespējamu Irānas netīrās bumbas uzbrukumu Vašingtonā",
    "Iran's Dirty Bomb Attack on Washington, D.C.", now, "lv"), /possible or suspected/);
  assert.equal(hedgeLost("ASV izlūkdienesti brīdina par iespējamu Irānas netīrās bumbas uzbrukumu Vašingtonā",
    "US intelligence warns of a possible Iranian dirty bomb attack in Washington"), "");
  assert.match(hedgeLost("Zeker 180 mensen met mogelijk ebola op de vlucht", "180 people with Ebola on the run"), /possible/);
  assert.match(hedgeLost("Fallece estudiante presuntamente en accidente de motocicleta", "Medical Student Dies in Motorcycle Accident"), /possible/);
  assert.equal(hedgeLost("Caso La Reina: prisión preventiva por presunto lavado de activos", "Detained on Suspicion of Asset Laundering"), "");
  // not hedges: "opportunities", "impossible", "make possible", "did our best"
  assert.equal(hedgeLost("Suriname en VAE onderzoeken nieuwe investeringsmogelijkheden", "Suriname and UAE explore new investment opportunities"), "");
  assert.equal(hedgeLost("Возобновление транзита газа через Украину невозможно", "Gas transit through Ukraine is ruled out"), "");
  assert.equal(hedgeLost("Nieuwe regels maken harder optreden tegen milieucriminaliteit mogelijk", "New rules allow tougher action against environmental crime"), "");
  assert.equal(hedgeLost("« Convaincus d’avoir fait tout notre possible »", "“Convinced we did our best”"), "");
  assert.equal(hedgeLost("習近平再提「一國兩制」 陸委會：不可能接受", "Mainland Affairs Council rejects Xi's call"), "");
});

t("a radioactive bomb made into a nuclear one is rejected", () => {
  assert.match(mtSuspect("ผวาทั้งประเทศ ข่าวกรองสหรัฐฯ แฉแผนลับ 'อิหร่าน' เตรียมใช้ 'ระเบิดกัมมันตรังสี' สังหารคนของ",
    "\"Iran's secret plan to use nuclear bomb against Trump administration\".", now, "th"), /radioactive/);
  assert.equal(termMissing("แฉอิหร่านวางแผนลอบวาง 'ระเบิดกัมมันตรังสี-อาวุธเคมี'", "Iran plans to smuggle 'radiological-chemical bomb'"), "");
  assert.equal(hedgeLost("อิหร่านเร่งพัฒนาอาวุธนิวเคลียร์และสารกัมมันตรังสี", "Iran speeds up nuclear weapons work"), "", "the original says nuclear too");
  assert.equal(protectTerms("เตรียมใช้ 'ระเบิดกัมมันตรังสี' สังหาร"), "เตรียมใช้ 'radioactive bomb' สังหาร");
});

console.log(ok + " passed");
