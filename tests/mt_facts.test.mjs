// Casualty facts a machine translation may not add (tools/mt_facts.mjs, used by tools/mt_guard.mjs mtSuspect) and the re-check of
// summaries already written (tools/daily_lib.mjs scrubDay). Run: node tests/mt_facts.test.mjs
// The rejected lines are real MADLAD-400 output from the news pool (2026-11-09 to 2026-11-15).
import assert from "node:assert/strict";
import { mtSuspect, dropSuspectMt, extraNumber } from "../tools/mt_guard.mjs";
import { extraCount, extraHarm, numberWordValues, fold } from "../tools/mt_facts.mjs";
import { scrubDay, trustMt } from "../tools/daily_lib.mjs";

const now = Date.parse("2026-11-16T12:00:00Z");
let ok = 0; const t = (name, f) => { f(); ok++; console.log("ok -", name); };

// 2026-11-15: three outlets' reports of the Revolutionary Guards' drone attack on a US base in Bahrain each gained a death toll
t("the Bahrain attack headlines that gained \"killed 10\" are rejected", () => {
  assert.match(mtSuspect("Persischer Golf - Iranische Revolutionsgarden melden neuen Drohnenangriff auf US-Stützpunkt im Bahrain",
    "Iran's Revolutionary Guards Forces Attack U.S. Base in Bahrain, Kill 10", now, "de"), /casualty count 10/);
  assert.match(mtSuspect("Iranische Revolutionsgarden melden neuen Drohnenangriff auf US-Stützpunkt im Bahrain",
    "Iran's Revolutionary Guards Forces Attack U.S. Base in Bahrain, Kill 10", now, "de"), /casualty count 10/);
  assert.match(mtSuspect("Bahreinā atskan sprādzieni un trauksmes sirēnas: Irāna paziņo par uzbrukumu ASV militārajai bāzei",
    "Iran announces attack on US military base in Bahrain, says it has killed 10", now, "lv"), /casualty count 10/);
  assert.match(mtSuspect("Drugi napad za tri dana: Iran ponovo gađao američke snage u Bahreinu", "Iran fires on US forces in Bahrain, killing 10", now, "sr"), /casualty count 10/);
  // without a language tag (a news-index row) the same lines are still rejected
  assert.ok(mtSuspect("Bahreinā atskan sprādzieni un trauksmes sirēnas: Irāna paziņo par uzbrukumu ASV militārajai bāzei",
    "Iran announces attack on US military base in Bahrain, says it has killed 10", now));
  // the faithful reports of the same attack pass
  assert.equal(mtSuspect("Iran bevestigt droneaanval op Amerikaanse militaire basis in Bahrein - Israël doodt Hamas-commandant in Gazastrook",
    "Iran confirms drone attack on US military base in Bahrain - Israel kills Hamas commander in Gaza", now, "nl"), "");
  assert.equal(mtSuspect("Israel mata comandante do Hamas em Gaza; Irã diz ter atacado base dos EUA no Bahrein",
    "Israel Kills Hamas Commander in Gaza; Iran Says It Attack U.S. Base in Bahrain", now, "pt"), "");
});
t("a stored Bahrain item loses the invented English and keeps its original", () => {
  const i = { title: "Persischer Golf - Iranische Revolutionsgarden melden neuen Drohnenangriff auf US-Stützpunkt im Bahrain", lang: "de",
    title_en: "Iran's Revolutionary Guards Forces Attack U.S. Base in Bahrain, Kill 10", mt: "MADLAD-400 (Google open model, run in the refresh job)" };
  assert.equal(dropSuspectMt(i, now), true);
  assert.equal(i.title_en, undefined);
  assert.equal(i.mt, "untranslated");
  assert.equal(i.title, "Persischer Golf - Iranische Revolutionsgarden melden neuen Drohnenangriff auf US-Stützpunkt im Bahrain");
});
t("other invented counts are rejected, nearly all of them the model's \"10\"", () => {
  for (const [o, e, l] of [
    ["Neun Tote bei Absturz von Geschäftsflugzeug in Florida", "10 dead in plane crash near Florida", "de"],
    ["Tote bei Erdbeben im Norden Tibets", "Earthquake in northern Tibet kills 10", "de"],
    ["Mueren seis en un incendio en Brooklyn, Nueva York", "Six killed in Brooklyn fire, 10 injured", "es"],
    ["Vijf gewonden na ontploffing in chalet op Belgische kerstmarkt", "10 injured in explosion at Christmas market in Belgium", "nl"],
    ["Geen doden nadat riviercruiseschip kapseist in New Orleans door aanvaring met tanker", "10 dead after cruise ship capsized in New Orleans", "nl"],
    ["Ascienden a 8 los muertos y a 19 los heridos por el derrumbe de un edificio en Nueva York", "19 injured in New York building collapse, more than 20 people are missing", "es"],
    ["횡성 영동고속도로서 3대 추돌, 2명 사망 3명 부상", "Three people died and 10 were injured in the accident.", "ko"],
    ["Βενεζουέλα: Επίθεση του στρατού σε στρατόπεδο Κολομβιανών ανταρτών με αρκετούς νεκρούς", "Venezuela: Army attacks Colombian guerrilla camp, kills 10", "el"],
    ["قتيل بقصف إسرائيلي جنوب لبنان ونواف يحذر من \"مغامرة عبثية\"", "Israeli bombers kill 10 in southern Lebanon", "ar"],
  ]) assert.match(mtSuspect(o, e, now, l), /casualty count/, e);
});
t("counts the original gives, in digits or words, pass", () => {
  for (const [o, e, l] of [
    ["Neun Tote bei Absturz von Geschäftsflugzeug in Florida", "Nine dead in business jet crash in Florida", "de"],
    ["Negen doden bij crash privéjet in Florida", "9 dead in private jet crash in Florida", "nl"],
    ["Polen: Mindestens sechs Tote nach Schüssen in Krakau", "Poland: At least 6 dead in shooting in Krakow", "de"],
    ["Nigeria : au moins vingt morts dans une attaque de « bandits » dans le Nord-Est", "Nigeria: At least 20 killed in attack by bandits in Northeast", "fr"],
    ["Al menos diez muertos y 16 heridos por riña en una cárcel del noroeste de México", "At least 10 killed and 16 injured in riot at prison in northwestern Mexico", "es"],
    ["Russische aanval op station in Oekraïense stad Dnipro: zeker dertien doden", "Russian attack on railway station in Dnipro: at least 13 dead", "nl"],
    ["पछिल्लो २४ घण्टामा सवारी दुर्घटनामा पाँचको मृत्यु, ३१३ घाइते", "5 dead, 313 injured in road accidents in last 24 hours", "ne"],
    ["ลอบวางระเบิดรถทหารพราน รือเสาะ นราธิวาส เจ็บ 2", "Bomb attack on ranger vehicle in Rueso, Narathiwat, 2 injured", "th"],
    ["Ucraina: doi morți în atacul rusesc asupra orașului Harkov", "Ukraine: two dead in Russian attack on Kharkiv", "ro"],
    ["Un muerto y cuatro heridos tras ataque armado en Francia", "One dead and four injured in gunman attack in France", "es"],
    ["إسرائيل تعتقل ثلاثة شبان في القنيطرة", "Israel arrests three young men in Quneitra", "ar"],
    ["طنجة: توقيف شخصين متورطين في السرقة", "Tangier: two persons arrested for theft", "ar"],   // the dual ending, not a number word
    ["Ascienden a 74 mil 594 los muertos por ofensiva israelí en Gaza", "Gaza: 74,594 dead in Israeli offensive", "es"],
  ]) assert.equal(mtSuspect(o, e, now, l), "", e);
  assert.deepEqual([...numberWordValues("Mindestens sechs Tote", "de")], [6]);
  assert.equal(extraNumber("Al menos diez muertos y 16 heridos", "At least 10 killed and 16 injured"), "");
});
t("a death or injury the original does not mention is rejected", () => {
  for (const [o, e, l] of [
    ["대법, 김건희 구속 2개월 연장…\"증거 인멸·도망 염려\"(종합)", "\"There is no evidence of the death of Kim Jong-nam\".", "ko"],
    ["นายกฯ แจง พ.ย. คิวแน่นซักฟอกไม่ได้ คาดเริ่มเร็วสุด ต้นเดือน ธ.ค.", "The first of the three, he is a 19-year-old who has been in prison for his involvement in the murders.", "th"],
    ["札幌市への詐欺で実刑判決 就労継続支援の「信頼揺るがしかねない」", "A man sentenced to death for fraud against Sapporo City.", "ja"],
    ["中壢火車站周邊3移工爆衝突 警依法裁罰", "Three migrant workers killed in explosion near Chuan-dong railway station", "zh"],
    ["“ოცნება” არჩევნების შედეგების გასაჩივრებას კრძალავს” – 3 სამოქალაქო ორგანიზაციის შეფასება", "The 3-year-old who was killed in a car accident", "ka"],
  ]) assert.ok(mtSuspect(o, e, now, l), e);
  assert.equal(extraHarm("ระทึก! ยิงสกัดไล่ล่าเก๋งต้องสงสัยกลางชุมชน", "A gunman was killed in the community", "th"), "");   // ยิง, shooting
});
t("deaths and injuries the original does mention pass, in any form of the word", () => {
  for (const [o, e, l] of [
    ["Murió el histórico capo narco mexicano Miguel Ángel Félix Gallardo", "Mexican narco-boss Miguel Ángel Félix Gallardo has died", "es"],
    ["Drame à Belle-Rose : un homme de 64 ans meurt en tombant de son manguier", "A 64-year-old man dies after falling from a mango tree in Belle-Rose", "fr"],
    ["Nesslau: Körperverletzung und Raubversuch – Zwei Festnahmen", "Nesslau: Bodily injury and attempted robbery – two arrests", "de"],
    ["Zaak schadeclaim nabestaanden Decembermoorden uitgesteld tot februari", "Case of damages claim relatives December murders postponed until February", "nl"],
    ["В Ташкенте водитель насмерть сбил пешехода возле рынка", "In Tashkent, a driver killed a pedestrian near the market", "ru"],
    ["Pożar w kurorcie turystycznym w Tajlandii. 11 osób nie żyje", "Fire in tourist resort in Thailand. 11 people dead", "pl"],
    ["যৌতুকের টাকা না দেওয়ায় স্ত্রীকে গলা ও হাতের রগ কে’টে হ’ত্যা", "Wife killed by cutting her throat and arm for not paying dowry", "bn"],
    ["日사회 모순 비판한 작가 무라카미 류 별세", "Murakami Ryu, a writer who criticized the contradictions of Japanese society, dies", "ko"],
    ["Widow collects 4,500 euros after clan leader's death | krone.tv NEWS", "Widow collects 4,500 euros after clan leader's death. krone.tv NEWS", "de"],
  ]) assert.equal(mtSuspect(o, e, now, l), "", e);
  // a language with no listed words is not judged on casualty words
  assert.equal(extraHarm("Abantu babiri bapfuye mu mpanuka", "Two people died in an accident", "rw"), "");
});
t("fold reads accents, broken-up words and letter forms the same", () => {
  assert.equal(fold("Tötet"), "totet");
  assert.equal(fold("ZWÖLF Straße"), "zwolf strasse");
  assert.equal(fold("Sau­tján"), "sautjan");
  assert.equal(extraCount("Sau­tján létust í sprengingu", "Seventeen killed in blast", () => false, "is"), "Seventeen");   // 17 is not a listed Icelandic word
});
t("a kept daily summary that quoted an invented headline quotes the original, and its AI lines that cited it are dropped", () => {
  const en = "10 injured in explosion at Christmas market in Belgium", orig = "Vijf gewonden na ontploffing in chalet op Belgische kerstmarkt";
  const rules = { date: "2026-11-16", method: "rules",
    refs: [{ n: 1, title: en, orig, outlet: "NOS", url: "https://example.org/a", flags: "m" }, { n: 2, title: "Bird flu detected in Gelderland", outlet: "NOS", url: "https://example.org/b", flags: "" }],
    bluf: [{ text: "342 relevant reports. Most reported: “" + en + "” (3 outlets).", refs: [1] }], events: [{ text: en, refs: [1] }, { text: "Bird flu detected in Gelderland", refs: [2] }] };
  assert.equal(scrubDay(rules, now), 1);
  assert.equal(rules.refs[0].title, orig);
  assert.equal(rules.refs[0].orig, undefined);
  assert.equal(rules.refs[0].mt_rejected, true);
  assert.doesNotMatch(rules.refs[0].flags, /m/);
  assert.match(rules.bluf[0].text, /Vijf gewonden/);
  assert.doesNotMatch(rules.bluf[0].text, /10 injured/);
  assert.equal(rules.events[0].text, orig);
  assert.equal(rules.events[1].text, "Bird flu detected in Gelderland");
  assert.equal(scrubDay(rules, now), 0);   // a second pass changes nothing (the check runs on every refresh)

  const ai = { date: "2026-11-15", method: "ai", refs: [{ n: 1, title: en, orig, flags: "m" }, { n: 2, title: "Bird flu detected in Gelderland", flags: "" }],
    bluf: [{ text: "Ten people were injured in a blast at a Belgian Christmas market [1].", refs: [1] }], ai_watch: [{ text: "Bird flu spread", refs: [2] }],
    rules_bluf: [{ text: "Most reported: “" + en + "” (3 outlets).", refs: [1] }], events: [] };
  assert.equal(scrubDay(ai, now), 1);
  assert.equal(ai.method, "rules");
  assert.equal(ai.ai_dropped, 1);
  assert.match(ai.bluf[0].text, /Vijf gewonden/);
  assert.equal(ai.ai_watch.length, 1);
  // a faithful translation is left as it was
  const fine = { method: "rules", refs: [{ n: 1, title: "Five injured in explosion at Belgian Christmas market", orig, flags: "m" }], bluf: [], events: [] };
  assert.equal(scrubDay(fine, now), 0);
  assert.equal(trustMt({ title: en, orig, flags: "m" }, now).mt_rejected, true);
});
console.log(ok + " passed");
