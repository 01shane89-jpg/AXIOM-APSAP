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
  [/호르무즈/g, null, /\bH[oe]rmoz|\bHormuz/i, "Strait of Hormuz"],
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
// 출격 (a sortie, aircraft scrambled): "attack" in the English needs an attack word in the Korean
const SORTIE = /출격/;
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
  if (SORTIE.test(orig) && /\battack/i.test(en) && !KO_ATTACK.test(orig) && !/\battack/i.test(orig)) return "attack (출격 is a scramble)";
  return "";
}

// The country the English names that the original does not (Iraq, Syria), or "".
export function countryAdded(orig, en) {
  const o = fold(orig);
  for (const [name, re, forms] of ADDED) if (re.test(String(en || "")) && !forms.some((f) => o.includes(f))) return name;
  return "";
}
