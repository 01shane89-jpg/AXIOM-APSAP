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
// 출격 (a sortie, aircraft scrambled): "attack" in the English needs an attack word in the Korean
const SORTIE = /출격/;
const KO_ATTACK = /공격|습격|공습|타격|피격|테러|폭격|침공|기습|격추|포격|사격|발사|교전|공세|피습|침략|역습|반격/;

const applies = (s, re, script) => { re.lastIndex = 0; return (!script || script.test(s)) && re.test(s); };
const hasTerm = (s) => ZONES.some(([re, , script]) => applies(s, re, script));

export function protectTerms(text) {
  let s = String(text || "");
  if (!hasTerm(s)) return text;
  for (const [re, en, script] of ZONES) if (applies(s, re, script)) s = s.replace(re, (m, at, all) => {
    const before = all[at - 1] || "", after = all[at + m.length] || "";
    return (before && !/[\s"'“‘(\[]/.test(before) ? " " : "") + en + (after && !/[\s"'”’)\].,…:;!?]/.test(after) ? " " : "");
  });
  return s;
}

// "" when the English keeps the terms, else what it lost
export function termMissing(orig, en) {
  orig = String(orig || ""); en = String(en || "");
  if (hasTerm(orig) && !ZONE_EN(en)) return "air defense identification zone";
  if (SORTIE.test(orig) && /\battack/i.test(en) && !KO_ATTACK.test(orig) && !/\battack/i.test(orig)) return "attack (출격 is a scramble)";
  return "";
}
