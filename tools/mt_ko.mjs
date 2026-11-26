// Korean, Chinese and Japanese headlines: an amount in the wrong order of magnitude, and a Korean name romanized as another
// person's (tools/mt_guard.mjs mtSuspect). Both from the 23 Nov news index (IG daily run):
//   cjkAmountWrong(orig, en): Korean, Chinese and Japanese count large amounts in ten-thousands (만, 萬/万) and hundred-millions
//     (억, 億/亿), and the model often moves the scale: Hankyoreh's 1억 원 (100 million won, the president's reward) came out as
//     "1 million won", 3억 as "30 million", 55만원 (550,000) as "55 thousand won". An English amount of 10,000 or more must equal
//     an amount in the original (within 1%), when the original writes one with such a unit. Returns the English amount, or "".
//   koNameWrong(orig, en): a Korean name in the English ("Ju Ji-jin", "Su Kyung-jin" for the education minister 최교진, Choi
//     Kyo-jin) whose surname and given-name syllables are not those of any three Hangul syllables in the original. Only the
//     romanized Korean name form (Surname Given-name, hyphenated or as three short words) is judged, so a foreign name written
//     in Hangul (트럼프, Trump) is never compared. Returns the English name, or "".
const CJK_UNIT = /[만억조萬万億亿兆]/;
const UNIT = { "천": 1e3, "千": 1e3, "백": 1e2, "百": 1e2, "만": 1e4, "萬": 1e4, "万": 1e4, "억": 1e8, "億": 1e8, "亿": 1e8, "조": 1e12, "兆": 1e12 };
const RUN = /\d[\d,.]*\s*[천千백百]?\s*[만萬万억億亿조兆](?:\s*\d[\d,.]*\s*[천千백百]?\s*[만萬万억億亿조兆]?)*/g;
const n = (s) => +String(s).replace(/,/g, "");
// "3억1000만" -> 310,000,000; "1千万" -> 10,000,000; "55만" -> 550,000
export function cjkAmounts(text) {
  const out = [];
  for (const m of String(text || "").matchAll(RUN)) {
    let total = 0;
    for (const g of m[0].matchAll(/(\d[\d,.]*)\s*([천千백百])?\s*([만萬万억億亿조兆])?/g)) {
      const v = n(g[1]) * (g[2] ? UNIT[g[2]] : 1);
      total += g[3] ? v * UNIT[g[3]] : v;
    }
    out.push(total);
  }
  return out;
}
const SCALE = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };
const EN_AMT = /(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion|trillion)\b|\b(\d{1,3}(?:,\d{3}){1,4})\b/gi;
export function cjkAmountWrong(orig, en) {
  orig = String(orig || ""); en = String(en || "");
  if (!CJK_UNIT.test(orig)) return "";
  const vals = cjkAmounts(orig);
  if (!vals.length) return "";
  // plain digits in the original count as written ("10,000 people")
  for (const m of orig.matchAll(/\d[\d,]*(?:\.\d+)?/g)) vals.push(n(m[0]));
  // "1 trillion 415.2 billion" is one amount (거제시's 1조 4152억)
  const amts = [];
  for (const m of en.matchAll(EN_AMT)) {
    const v = m[2] ? n(m[1]) * SCALE[m[2].toLowerCase()] : n(m[3]), prev = amts[amts.length - 1];
    if (prev && m[2] && prev.scale > SCALE[m[2].toLowerCase()] && /^\s*(?:and\s+)?$/.test(en.slice(prev.end, m.index))) {
      prev.v += v; prev.text += en.slice(prev.end, m.index + m[0].length); prev.end = m.index + m[0].length; prev.scale = SCALE[m[2].toLowerCase()]; continue;
    }
    amts.push({ v, text: m[0], end: m.index + m[0].length, scale: m[2] ? SCALE[m[2].toLowerCase()] : 1 });
  }
  for (const { v, text } of amts) {
    if (v < 1e4) continue;
    if (!vals.some((x) => x > 0 && Math.abs(x - v) / x < 0.01)) return text;
  }
  return "";
}

// ---------- Korean names ----------
const SUR = { 김: "kim gim", 이: "lee yi rhee i ri", 리: "lee ri rhee", 박: "park bak pak", 최: "choi choe", 정: "jung jeong chung jong", 강: "kang gang",
  조: "cho jo", 윤: "yoon yun", 장: "jang chang", 임: "lim im", 한: "han", 오: "oh o", 서: "seo suh", 신: "shin sin", 권: "kwon gwon",
  황: "hwang", 안: "ahn an", 송: "song", 류: "ryu yoo yu lyu", 유: "yoo yu", 전: "jeon jun chun", 홍: "hong", 고: "ko go", 문: "moon mun",
  양: "yang", 손: "son sohn", 배: "bae", 백: "baek paek", 허: "heo huh", 노: "noh roh no", 남: "nam", 심: "shim sim", 우: "woo u",
  하: "ha", 곽: "kwak gwak", 성: "sung seong", 차: "cha", 주: "joo ju chu", 구: "koo gu ku", 민: "min", 진: "jin chin", 나: "na ra",
  엄: "um eom", 원: "won", 천: "chun cheon", 방: "bang", 공: "kong gong", 현: "hyun hyeon", 함: "ham", 변: "byun byeon", 염: "yeom yum",
  여: "yeo yuh", 추: "choo chu", 도: "do doh", 소: "so", 석: "seok suk", 선: "sun seon", 설: "seol sul", 마: "ma", 길: "gil kil",
  연: "yeon yun", 위: "wi wee", 표: "pyo", 명: "myung myeong", 기: "ki gi", 반: "ban", 왕: "wang", 금: "keum geum", 옥: "ok",
  육: "yook yuk", 인: "in", 맹: "maeng", 제: "je", 모: "mo", 탁: "tak", 국: "kook guk", 봉: "bong", 경: "kyung gyeong", 태: "tae", 지: "ji", 채: "chae" };
// a syllable as a loose key: the initial consonant's class and whether it ends in a nasal or l, which survive every
// romanization in use (kyo/gyo, jin/chin, seong/sung); the vowel is not compared
const INI = ["g", "g", "n", "d", "d", "l", "m", "b", "b", "s", "s", "", "j", "j", "j", "g", "d", "b", "h"];
const FIN = ["", "", "", "", "n", "n", "n", "", "l", "l", "l", "l", "l", "l", "l", "l", "m", "", "", "", "", "n", "", "", "", "", "", ""];
const hangulKey = (ch) => { const c = ch.charCodeAt(0) - 0xac00; if (c < 0 || c > 11171) return null; return INI[Math.floor(c / 588)] + "|" + FIN[c % 28]; };
const romanKey = (s) => {
  s = s.toLowerCase().replace(/['’]/g, "");
  const m = s.match(/^(ch|kk|tt|pp|ss|jj|sh|[gkndtrlmbpsjhcfwy])?/); let i = (m && m[1]) || "";
  i = { k: "g", kk: "g", c: "j", ch: "j", jj: "j", t: "d", tt: "d", p: "b", pp: "b", f: "b", r: "l", sh: "s", ss: "s", w: "", y: "" }[i] ?? i;
  const fin = /(ng|n|m)$/.test(s) ? (/m$/.test(s) ? "m" : "n") : /(l|r)$/.test(s) ? "l" : "";
  return i + "|" + fin;
};
const sameSyl = (ch, rom) => { const a = hangulKey(ch), b = romanKey(rom); if (!a) return false; const [ai, af] = a.split("|"), [bi, bf] = b.split("|"); return ai === bi && af === bf; };
// "Choi Kyo-jin", "Ju Ji-jin", "Kim Jong Un"
const EN_NAME = /\b([A-Z][a-z]{0,4})\s+([A-Z][a-z]{0,5})-([a-z]{1,5})\b|\b([A-Z][a-z]{0,4})\s+([A-Z][a-z]{0,4})\s+([A-Z][a-z]{0,4})\b/g;
// a romanized Korean syllable (initial, vowel, final): "Dome-size", "Ban From Exit", "Han River Bus" are English words, not names
const SYL = /^(?:ch|kk|tt|pp|ss|jj|sh|[gkndtrlmbpsjhcwy])?(?:y|w)?(?:ae|eo|eu|oe|ui|wa|wo|wi|ya|ye|yo|yu|oo|ee|ea|ou|ai|ay|oh|a|e|i|o|u)(?:ng|k|n|m|l|p|t|r|b|g|d|h)?$/i;
const PLACE = /^(?:Hong Kong|Daegu|Busan|Seoul|Incheon|Gwangju|Daejeon|Ulsan|Jeju|Sejong|Suwon|Pohang|Changwon|Gimhae|Goyang)\b|-(?:gu|dong|gun|eup|myeon)$/;
export function koNameWrong(orig, en) {
  orig = String(orig || ""); en = String(en || "");
  if (!/[가-힣]/.test(orig)) return "";
  const syl = [...orig].filter((c) => /[가-힣]/.test(c) || /\s/.test(c));
  for (const m of en.matchAll(EN_NAME)) {
    const [s, g1, g2] = m[1] ? [m[1], m[2], m[3]] : [m[4], m[5], m[6]];
    const sl = s.toLowerCase();
    if (PLACE.test(m[0]) || ![s, g1, g2].every((w) => SYL.test(w))) continue;                               // "Hong Kong Stock", "Daegu Dong-gu"
    const surs = Object.keys(SUR).filter((h) => SUR[h].split(" ").includes(sl));
    // the hyphenated given name is the Korean form, so its surname is judged even when it is not one ("Su" for 최);
    // three plain words count only with a Korean surname ("Kim Jong Un", not "Lee Hsien Loong" read loosely)
    if (!surs.length && !m[1]) continue;
    const surOk = (ch) => (surs.length ? surs.includes(ch) : sameSyl(ch, s));
    let ok = false;
    for (let i = 0; i + 2 < syl.length && !ok; i++)
      ok = surOk(syl[i]) && sameSyl(syl[i + 1], g1) && sameSyl(syl[i + 2], g2);
    if (!ok) return m[0];
  }
  return "";
}
