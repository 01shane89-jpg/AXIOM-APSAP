// Terms whose meaning a machine translation must keep (tools/translate.mjs prepareForModel, tools/mt_guard.mjs mtSuspect).
// 2026-11-17, Russian aircraft near Korea and Japan: MADLAD-400 read 카디즈 (KADIZ, the Korea Air Defense Identification Zone)
// as "Cádiz" ("enter Cádiz after leaving Italy"), a Khmer "flew into its air defense zone" (ហោះចូលតំបន់ការពារដែនអាកាស) as
// "flying into its airspace", and 공군 전투기 출격 대응 (fighters scrambled in response) as "fighters respond to attack".
// Entering an ADIZ is not entering a country's airspace, and a scramble is not an attack.
//   protectTerms(text): what the model is given, each term written in English ("카디즈" -> "KADIZ"). The original stays the
//     cache key, the guard input and what is shown.
//   termMissing(orig, en): the guard. A translation that drops an ADIZ (calls it airspace or a Spanish city), or that turns a
//     scramble into an attack when the original names none, is rejected and the original is shown.
// the acronym in capitals only: "Cadiz" is the city the model made of 카디즈
const ZONE_EN = (en) => /\b[KJC]?ADIZ\b/.test(en) || /\bair[- ]defen[cs]e (?:and )?(?:identification )?zones?\b|\bidentification zones?\b/i.test(en);
// [source pattern, what the model is given, the script the text must have]; each one is an air defense identification zone
const ZONES = [
  // Korean: written out in Korean with the acronym, which the model keeps ("Korean air defense identification zone (KADIZ)");
  // given "KADIZ" alone it wrote "Kadiz" in 3 of 4 headlines (local probe, 2026-11-17)
  [/(?:한국\s*)?(?:카디즈|KADIZ)(?=[^A-Za-z)]|$)/g, "한국 방공식별구역(KADIZ)", /[\uAC00-\uD7AF]/],
  [/(?:일본\s*)?(?:자디즈|JADIZ)(?=[^A-Za-z)]|$)/g, "일본 방공식별구역(JADIZ)", /[\uAC00-\uD7AF]/],
  [/(?:중국\s*)?(?:차디즈|CADIZ)(?=[^A-Za-z)]|$)/g, "중국 방공식별구역(CADIZ)", /[\uAC00-\uD7AF]/],
  [/방공\s*식별\s*구역(?!\()/g, "air defense identification zone"],
  [/防空識別圏/g, "air defense identification zone"],
  [/防空識別區|防空识别区/g, "air defense identification zone"],
  [/តំបន់\s*ការពារ\s*ដែនអាកាស/g, "air defense zone"],
  [/เขตแสดงตนเพื่อการป้องกันภัยทางอากาศ/g, "air defense identification zone"],
  [/vùng nhận dạng phòng không/gi, "air defense identification zone"],
  [/(?:опознавательн\p{L}*\s+)?зон\p{L}*\s+(?:опознавания\s+)?ПВО/gu, "air defense identification zone"],
];
// 2026-11-17, mines in the Strait of Hormuz: Republika's "Tabrak Ranjau" (hit a mine) came out as "Collision with a Whale",
// "Hantam Ranjau Laut" as "Hit a Sea Ranch", Thai ทุ่นระเบิด (a mine) as "bomb truck", Vietnamese thủy lôi as "a jetty", and
// Newtalk's 荷姆茲 (Hormuz) as "Homs" (Syria), Arabic هرمز as "Hermes". [source pattern, what the model is given (null: the
// original is kept), what the English must have, what was lost].
const MINE_EN = /\b(?:land|sea)?mine|\bde-?min/i;
const ATTACHE_EN = /\battach[eé]/i;
const KEEP = [
  [/\branjau(?:\s+laut)?\b/gi, "mine", MINE_EN, "mine"],                   // Indonesian, Malay
  [/ทุ่นระเบิด/g, "mine", MINE_EN, "mine"],                                // Thai
  [/\bthủy lôi\b/gi, "naval mine", MINE_EN, "mine"],                       // Vietnamese
  [/觸雷|触雷|水雷|機雷|地雷|기뢰|지뢰/g, null, MINE_EN, "mine"],
  // Arabic as a whole word with its prefixes (لغمان is Laghman, الغموض "mystery")
  [/(?<![\u0600-\u06FF])(?:ال|[وبل]|بال|وال)?(?:لغم|ألغام|الغام)(?![\u0600-\u06FF])/g, null, MINE_EN, "mine"],
  [/荷姆茲|霍爾木茲|霍尔木兹|荷莫茲|ホルムズ/g, "Hormuz", /\bH[oe]rmoz|\bHormuz|\bOrmuz/i, "Strait of Hormuz"],
  // Arabic, with its prefixes (بهرمز "in Hormuz"); باهرمز is a family name
  [/(?<![\u0600-\u06FF])(?:ال|[وبل]|وب)?هرمز(?![\u0600-\u06FF])/g, "Hormuz", /\bH[oe]rmoz|\bHormuz/i, "Strait of Hormuz"],
  [/ฮอร์มุซ/g, "Hormuz", /\bH[oe]rmoz|\bHormuz/i, "Strait of Hormuz"],
  // Thai "radioactive bomb", which the model wrote as "nuclear bomb" (Naewna, 2026-11-18)
  [/ระเบิดกัมมันต(?:ภาพ)?รังสี/g, "radioactive bomb", /radioactiv|radiolog|dirty/i, "radioactive bomb"],
  [/호르무즈/g, null, /\bH[oe]rmoz|\bHormuz/i, "Strait of Hormuz"],
  // 2026-11-20, the UK expelling Myanmar's defence attaché: Berita Harian's "atase pertahanan" came out as "defence chief",
  // Myanmar Now's စစ်သံမှူး as "ambassador", and every Thai ทูตทหาร (military attaché) in the stored index as a "military
  // ambassador" (12 of 12 lines, Thai, Malay, Burmese, Chinese). An attaché is neither an ambassador nor a chief.
  [/(?:ผู้ช่วย)?ทูต(?:ฝ่าย)?ทหาร(?:บก|เรือ|อากาศ)?/g, "military attaché", ATTACHE_EN, "attaché"],
  [/ผู้ช่วยทูต/g, "attaché", ATTACHE_EN, "attaché"],
  [/\batase\s+pertahanan\b/gi, "defence attaché", ATTACHE_EN, "attaché"],
  [/\batase\s+(?:militer|tentera|ketenteraan)\b/gi, "military attaché", ATTACHE_EN, "attaché"],
  [/\batase\b/gi, "attaché", ATTACHE_EN, "attaché"],
  [/စစ်သံမှူး/g, "military attaché", ATTACHE_EN, "attaché"],
  [/武官/g, "military attaché", ATTACHE_EN, "attaché"],
  // 2026-11-21, Taiwan (IG Post 45): the model read 共機 (PLA aircraft) and 共艦 (PLA warships) as "joint aircraft" or "joint
  // flights", 國軍 (Taiwan's armed forces) as "Japan's army" (30 of 98 stored lines), and the Mainland Affairs Council (陸委會) as
  // "the National People's Congress", "Land Commission" or "National Committee" (123 of 123 stored lines: Taiwan's
  // China-policy body written as Beijing's). Each changes who acts. 公共機関 is Japanese for "public institutions", not 共機, and
  // 共機艦 is a combined count of aircraft and warships (tools/mt_zh.mjs).
  [/(?<![公])共(?:機|机)(?![艦舰船])/g, "PLA aircraft", /\b(?:Chinese|China|PLA|Communist|CCP|CPC)\b/i, "PLA aircraft (共機)"],
  [/(?<![公])共(?:艦|舰)/g, "PLA warships", /\b(?:Chinese|China|PLA|PLAN|Communist|CCP|CPC)\b/i, "PLA warships (共艦)"],
  [/國軍/g, "Taiwan's armed forces", /^(?![\s\S]*\bJapan)[\s\S]*\b(?:Taiwan(?:ese)?|ROC|armed forces|military|army|troops|soldiers|defen[cs]e|forces)\b/i, "Taiwan's armed forces (國軍)"],
  [/陸委會|陆委会/g, "Mainland Affairs Council", /Mainland Affairs Council|\bMAC\b/, "Mainland Affairs Council (陸委會)"],
];
// Iraq and Syria named in the English when the original names neither (Newtalk's 伊, Iran, read as "Iraqi forces" and
// "Syria"; Korean 이란 as "Iraq"; a Croatian "Russians fired on a school" as "a Syrian attack"). Measured on the stored
// index, 2026-11-17: 43 of 1,278 English lines naming Iraq or Syria, nearly all wrong. Iran is not checked: the model writes
// it for the Revolutionary Guard and the like, which is the reader's context, not an invention.
const fold = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
// The country's name in 68 languages (Intl.DisplayNames; a Latin, Cyrillic or Greek name without its last letter, for its
// inflected forms: Iračana, Ιρακινή, Сирії), its capital, and the short forms the news uses (叙, 敘; Arabic سوري "Syrian").
const LOCALES = ("af am ar az be bg bn bs ca cs cy da de el es et eu fa fi fil fr ga gl gu he hi hr hu hy id is it ja ka kk km kn " +
  "ko ky lo lt lv mk ml mn mr ms my ne nl no pa pl ps pt ro ru si sk sl so sq sr sv sw ta te th tk tr uk ur uz vi zh-Hans zh-Hant zu").split(" ");
const named = (cc, extra) => {
  const f = new Set(extra.split(" "));
  for (const l of LOCALES) {
    let n = ""; try { n = new Intl.DisplayNames([l], { type: "region" }).of(cc); } catch { continue; }
    if (!n || n === cc) continue;
    f.add(/^[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}]/u.test(n) && n.length > 4 ? n.slice(0, -1) : n);
  }
  return [...f].map(fold).filter(Boolean);
};
const ADDED = [
  ["Iraq", /\bIraq(?:i|is)?\b/, named("IQ", "irak iraq iraak irač irák ірак ιρακ عراق عێراق بغداد baghdad bagdad багдад 巴格達 巴格达 バグダッド 바그다드")],
  ["Syria", /\bSyria(?:n|ns)?\b/, named("SY", "syri siri suri suuri szir syyri sýr σύρ سوري سوری شام 叙 敘 دمشق damas damask damasc дамаск 大馬士革 大马士革 ダマスカス 다마스쿠스")],
];
// 2026-11-18, an Iranian "dirty bomb" warning: LSM's "ASV izlūkdienesti brīdina par iespējamu Irānas netīrās bumbas uzbrukumu"
// (US intelligence warns of a possible Iranian dirty bomb attack) came out as "Iran's Dirty Bomb Attack on Washington, D.C.",
// and Naewna's ระเบิดกัมมันตรังสี (a radioactive bomb) as "nuclear bomb". A radioactive or dirty bomb is not a nuclear one,
// and a possible or suspected event is not one that happened.
const RADIO = /กัมมันตรังสี|กัมมันตภาพรังสี|radioakti|radioacti|radiactiv|radioattiv|radioaktīv|радиоактив|радіоактив|放射性|放射能|방사능|방사성|phóng xạ|radyoakti|ραδιενεργ|רדיואקטיב|netīr\S* bumb|schmutzige\S* bombe|bombe sale|bomba sucia|bomba suja|грязн\S* бомб|脏弹|髒彈|ダーティボム|더티\s?밤|ระเบิดสกปรก|bom bẩn|bom kotor/i;
const NUCLEAR = /นิวเคลียร์|nukle|nuclé|nuclea|ядерн|атомн|核|원자|핵|hạt nhân|nükleer|πυρην|نووي|גרעינ|kodol|atom/i;
// A word saying the event is possible, suspected or alleged, in the languages of the index. The nouns for "possibilities,
// opportunities" (mogelijkheden, возможности, možnosti) and 不可能 "impossible" are not hedges.
const HEDGE = /iespējam|varētu|\bmöglich(?!keit)|mutma(?:ß|ss)lich|angeblich|(?<!notre |votre |leur )\bpossibles?\b|présumé|pourrait|\bposibles?\b|possíve(?:l|is)|\bpresunt|\bsupuest|\bsuposto|podría|poderia|\bpossibil[ei]\b|potrebbe|(?<!не)возможн(?!ост)|(?<!не)можлив(?!іст)|предполага|якобы|możliw(?!oś)|rzekom|domniema|(?<!不)可能(?!性?(?:接受|是))|疑似|가능성|kemungkinan|diduga|có thể|محتمل|مزعوم|يشتبه|olası|muhtemel|pravděpodob|\bmožn(?:é|á|ý)\b|lehetséges|feltételez|mogelijk(?!he)|vermoedelijk|πιθαν|\bmoguć(?!nost)/i;
// what an English line keeps of it: a hedge, an attribution, a question
const HEDGE_EN = /possib|potential|\bmay\b|might|could|likely|alleg|suspect|suspic|report|warn|fear|risk|threat|plan|claim|\bsa(?:y|ys|id)\b|accus|probe|investigat|probabl|\?|rumou?r|expect|would|\bcan\b|cannot|can't|unable|allow|enabl|presum|purport|supposed|perhaps|maybe|whether|consider|prepar|\bif\b|in case|\bany\b|unconfirmed|believ|estimat|chance|scenario|prospect|question|\bnot\b|\bno\b|doubt|unlikely|odds/i;
// 출격 (a sortie, aircraft scrambled): "attack" in the English needs an attack word in the Korean
const SORTIE = /출격/;
// 2026-11-19, Russian aircraft near Japan, Korea and Taiwan: PTS News' 俄軍機侵擾日韓台 (intruded on, harassed) came out as
// "attacked", Kampuchea Thmey's fighters sent to intercept (យន្តហោះចម្បាំងស្ទាក់) as "Fighter Rescue Aircraft". In the stored
// index every Chinese or Japanese intrusion headline translated with "attack" and no attack word in the original was wrong
// (coast guard ships "harassing" Kinmen as "attacked the Golden Gate Bridge", a drone 侵入 as "drone attack").
const INTRUDE = /侵擾|侵扰|擾台|扰台|擾日|擾我|機擾|机扰|闖入|闯入|逼近|侵犯|進入|进入|穿越|飛越|飞越|繞台|绕台|侵入/;
const ZH_ATTACK = /攻|襲|袭|轟炸|轰炸|打擊|打击|擊落|击落|開火|开火|交火|炮擊|炮击|射擊|射击|發射|发射|入侵|侵略|戰爭|战争|爆炸|空爆|砲撃|撃墜/;
const KO_ATTACK = /공격|습격|공습|타격|피격|테러|폭격|침공|기습|격추|포격|사격|발사|교전|공세|피습|침략|역습|반격/;

const applies = (s, re, script) => { re.lastIndex = 0; return (!script || script.test(s)) && re.test(s); };
const hasZone = (s) => ZONES.some(([re, , script]) => applies(s, re, script));
const hasTerm = (s) => hasZone(s) || KEEP.some(([re, en]) => en && applies(s, re));
const spaced = (en) => (m, ...a) => {
  const at = a[a.length - 2], all = a[a.length - 1], before = all[at - 1] || "", after = all[at + m.length] || "";
  return (before && !/[\s"'“‘(\[«]/.test(before) ? " " : "") + en + (after && !/[\s"'”’)\].,…:;!?»]/.test(after) ? " " : "");
};

export function protectTerms(text) {
  let s = String(text || "");
  if (!hasTerm(s)) return text;
  for (const [re, en, script] of ZONES) if (applies(s, re, script)) s = s.replace(re, spaced(en));
  for (const [re, en] of KEEP) if (en && applies(s, re)) s = s.replace(re, spaced(en));
  return s;
}

// "" when the English keeps the terms, else what it lost
export function termMissing(orig, en) {
  orig = String(orig || ""); en = String(en || "");
  if (hasZone(orig) && !ZONE_EN(en)) return "air defense identification zone";
  for (const [re, , must, lost] of KEEP) if (applies(orig, re) && !must.test(en)) return lost;
  if (INTRUDE.test(orig) && /\battack/i.test(en) && !ZH_ATTACK.test(orig) && !/\battack/i.test(orig)) return "attack (the original says an intrusion)";
  if (/ស្ទាក់/.test(orig) && /\brescu/i.test(en) && !/សង្គ្រោះ/.test(orig)) return "rescue (ស្ទាក់ is an intercept)";
  if (SORTIE.test(orig) && /\battack/i.test(en) && !KO_ATTACK.test(orig) && !/\battack/i.test(orig)) return "attack (출격 is a scramble)";
  return "";
}

// "" when the English keeps the original's hedge and kind of bomb, else what it dropped or hardened
export function hedgeLost(orig, en) {
  orig = String(orig || ""); en = String(en || "");
  if (RADIO.test(orig) && !NUCLEAR.test(orig) && /\bnuclear|\batom/i.test(en) && !/radioactiv|radiolog|dirty|radiation/i.test(en)) return "radioactive, not nuclear";
  if (HEDGE.test(orig) && !HEDGE_EN.test(en)) return "possible or suspected";
  return "";
}

// The country the English names that the original does not (Iraq, Syria), or "".
export function countryAdded(orig, en) {
  const o = fold(orig);
  for (const [name, re, forms] of ADDED) if (re.test(String(en || "")) && !forms.some((f) => o.includes(f))) return name;
  return "";
}

// 2026-11-20, the ICJ's Rohingya genocide case: Thai Post's "ICJ announces its verdict on Myanmar" (ประกาศคำตัดสิน) came out
// as "has ruled Myanmar guilty" 15 days before the ruling. A finding of guilt or a conviction in the English needs a word for
// guilt, a conviction, a sentence or a verdict against someone in the original. Measured on the stored index (20 Nov): 27
// of 1,184 English lines saying guilty or convicted, nearly all wrong: a suspect (ผู้ต้องหา, 涉), a case sent to prosecutors
// (송치), a sentence asked for (求刑), an impeachment (luận tội) or a hearing to drop the charges read as a conviction or plea.
const GUILT = /culp|conden|convict|coupable|schuld|verurteil|colpevol|bersalah|ผิด|พิพากษ|จำคุก|โทษ|有罪|判|罪|유죄|선고|징역|형|виновн|вінават|винуват|осужд|осуд|засуд|присуд|приговор|вирок|مذنب|إدان|ادان|أدين|يدين|تدين|ارتكاب|محكوم|حكم|حکم|suçlu|mahk[uû]m|có tội|kết án|tuyên án|phạm tội|ένοχ|καταδικ|skaz|winn|winien|vinen|vinn|odsouz|odsúd|osuđ|осуђ|bűnös|elítél|ítél|skyldig|dömd|dömt|dømt|domfelt|syyllin|tuomi|veroordeel|dihukum|divonis|vonis|penjara|kesalahan|အပြစ်|ပြစ်ဒဏ်|ထောင်|ពិរុទ្ធ|កាត់ទោស|ទោស|দোষী|দণ্ড|সাজা|दोषी|सजा|मुजरिम|مجرم|محکوم|אשם|הורשע|דין|დამნაშავ|მსჯავრ|გაასამართლ|condamn|kalt|pinarusahan|nahatulan|süüdi|mõist|مدان|مدين|καταδ|tiền án|lãnh án|xử tội|án tù|reo\b|notiesā|tiesāt|fajtor|fajës|fajes|dënim|dënua|dënon|dënuar|dënonte|vinov|nuteist|nuosprend|осъд|kriv|obsoj|obsod|syylli|döms|veroordel|condann|julgad|təqsir|təqsirli|viinov|виновен|sentenc|guilty|culpa|grižnj|savjest|元凶|usvedč|məhkum|teist|内疚|內疚|귀책|mang tội|nhận tội|혐의 인정|гэм буру|ნასამართლ|kết tội|yahamije|icyaha|ενοχ|vainīg|vainig|vaini|vině|vina\b|вина|usvědč|souzen|fäll|döm|dæm|domm|մեղավոր|դատապարտ|günä|condemn|en tort|ސާބިތ|죄|ادين|اُدين|кривиц|крив/i;
// "" when the English adds no finding of guilt, else the word it added
export function verdictAdded(orig, en) {
  orig = String(orig || ""); en = String(en || "");
  const m = en.match(/\bguilty\b|\bconvicted\b/i);
  if (!m || /\bnot guilty\b|\binnocent\b/i.test(en)) return "";
  return GUILT.test(orig) || GUILT.test(fold(orig)) ? "" : m[0].toLowerCase();
}
