// Machine translation guard: catches an English "translation" the open model invented instead of translating.
// MADLAD-400 sometimes answers a Thai, Korean or Chinese headline with stock text that has nothing to do with it
// ("The 1980s were a time of great success for the band." for a Thai flood or shooting story, "2016-09-30 - ..." for a
// Korean one). Such a line passes every word check on its own, and identical inventions for different stories look like
// one story carried by several outlets, so it can lead the daily summary. A translation is suspect when it:
//   - names a year or a decade the original does not have (Buddhist Era years such as 2569 or "ปี 69" count as 2026);
//   - is one of the model's stock inventions ("... were a time of great success", "(in Japanese)", a web error page);
//   - gives a clock time the original does not have ("10.35am: The rain continues ..." for a Thai headline with no time in it);
//   - repeats a word run (the model looping);
//   - is still mostly in another script (the model gave Chinese back as Chinese);
//   - gives a number the original does not have (a date moved from "05 Novembre" to "28 Novembre", "Gulf 28" turned into
//     "Gulf Games 26", "The 100 Most Powerful People in the World" for an Armenian headline with no number in it).
// looksEnglish() finds a headline that is already English under another language's label (a Gulf or West African outlet's
// English titles, a broadcaster's YouTube channel): it is shown as written and never given to the model, which on 2026-11-08
// had "translated" 2,039 such English headlines, moving dates ("28-10-2026" to "28-10-2027") and cutting them short.
// lowConfidence() reads the model's own score (tools/mt/madlad.py MT_SCORES=1): below MT_MIN_SCORE a line is treated as invented.
//   - names a month the original does not give ("5 พ.ย. 69", 5 November 2026, as "5th of July, 69"; "２７日", the 27th, as
//     "27 July"): the original must carry that month's name (tools/mt_months.mjs) or its number.
// Pure: no files, no network. Used by tools/translate.mjs (new and cached translations), tools/history.mjs and
// tools/news_index.mjs (translations already stored) and tools/daily_lib.mjs (the summary's last check).

import { MONTHS } from "./mt_months.mjs";

// any script's decimal digits as ASCII ("২০০১" -> "2001"), so a year written in Bengali or Thai digits is recognised
export function asciiDigits(s) {
  return String(s || "").replace(/\p{Nd}/gu, (d) => {
    let cp = d.codePointAt(0), n = 0;
    while (n < 60 && /\p{Nd}/u.test(String.fromCodePoint(cp - 1))) { cp--; n++; }
    return String(n % 10);
  });
}

const STOCK = [
  /\b(?:was|were) (?:a|the) (?:time|era|decade|period|year) of (?:great|economic|political|huge|rapid|prosperity)\b/i,
  /^\W*\(?in (?:japanese|chinese|korean|thai|english|mongolian|vietnamese)\)?\W*$/i,
  /\brequested URL\b.*\bnot found\b/i,
];
const DECADE = /\b(1[5-9]|20)(\d)0s\b|['’](\d)0s\b|\b(twenties|thirties|forties|fifties|sixties|seventies|eighties|nineties)\b/gi;
const DECADE_WORD = { twenties: 2, thirties: 3, forties: 4, fifties: 5, sixties: 6, seventies: 7, eighties: 8, nineties: 9 };
const CENTURY = /\b(\d{1,2})(?:st|nd|rd|th) century\b/gi;
// a clock time in the English: "10:35", "10.35am", "10.35 a.m.", "9am", "22.30 hrs"
const CLOCK = /(?<![\d.,:])([01]?\d|2[0-3])(?:[:.]([0-5]\d))?\s*(a\.?m\b\.?|p\.?m\b\.?|hrs\b|h\b|o'clock\b)?(?![\d.,:]?\d)/gi;
const YEAR = /(?<![\d,.:/])(1[5-9]\d\d|20\d\d)(?![\d,])/g;

// reason the English is not a translation of orig, or "" when nothing is wrong. now: the time of the check (ms), for the
// current year, which a translation may add (Japanese era years, "this year").
export function mtSuspect(orig, en, now = Date.now()) {
  orig = String(orig || ""); en = String(en || "").trim();
  if (!orig.trim() || !en || orig.trim() === en) return "";
  for (const re of STOCK) if (re.test(en)) return "stock text";
  if (/\b(\w+)(?:[\s,.]+\1\b){3,}/i.test(en)) return "loop";
  // still in the original's script (Chinese given back as Chinese): not a translation
  const lat = (en.match(/[A-Za-z]/g) || []).length, oth = (en.match(/\p{L}/gu) || []).length - lat;
  if (oth > lat) return "not English";
  // the original's numbers, thousands separators dropped, with the forms a year in it may take in English
  const o = asciiDigits(orig).replace(/(\d)[,.\s](?=\d{3}(?!\d))/g, "$1");
  const nums = o.match(/\d+/g) || [];
  const ok = new Set(), y = new Date(now).getUTCFullYear();
  for (const x of nums) {
    const v = +x; ok.add(v);
    if (v >= 2400 && v <= 2700) ok.add(v - 543);                 // Buddhist Era
    if (x.length === 2) { ok.add(1900 + v); ok.add(2000 + v); ok.add(1957 + v); }   // '86, ปี 69 (BE 2569 = 2026)
    if (x.length === 3 && v >= 60 && v <= 150) ok.add(v + 1911);   // Taiwan's Minguo years (115 = 2026)
  }
  [y - 1, y, y + 1].forEach((v) => ok.add(v));
  for (const m of en.matchAll(YEAR)) { const v = +m[1]; if (v % 1000 && !ok.has(v)) return "year " + v + " not in the original"; }
  for (const m of en.matchAll(DECADE)) {
    const d = m[2] || m[3] || String(DECADE_WORD[String(m[4] || "").toLowerCase()] || "");
    const full = m[1] ? +(m[1] + d + "0") : 0;
    if (!(full && ok.has(full)) && !nums.some((x) => x === d + "0" || (x.length === 4 && x.slice(2) === d + "0"))) return "decade not in the original";
  }
  // an hour and minute (or an hour with am/pm) the original does not give; a 24-hour time may come back as am/pm
  for (const m of en.matchAll(CLOCK)) {
    const h = +m[1], mi = m[2], ap = m[3] || "";
    if (!mi && !ap) continue;                    // a bare number, not a time
    if (mi && !ap && m[0].includes(".")) continue; // "6.5" is a magnitude or a decimal unless it has am/pm
    const hours = [h, h + 12, h - 12, h === 12 ? 0 : -1].filter((v) => v >= 0);
    const hourIn = hours.some((v) => nums.some((x) => +x === v));
    if (!hourIn || (mi && mi !== "00" && !nums.some((x) => x === mi || +x === +mi))) return "clock time not in the original";
  }
  for (const m of en.matchAll(CENTURY)) if (!nums.includes(m[1])) return "century not in the original";
  const n = extraNumber(orig, en);
  if (n) return "number " + n + " not in the original";
  const mo = extraMonth(orig, en);
  if (mo) return "month " + mo + " not in the original";
  return "";
}

// Numbers. The original's numbers are read in any digits, with Chinese, Japanese and Korean numerals and the counting units
// Asian languages write after a number (16万5000, 2억4000만, 9.4 แสน, ৫ লাখ); each may come back in English times a power of ten
// ("1499億" = "149.9 billion") or with an hour on the other clock ("19H" = "7 PM"). A number in the English that none of
// these explains is invented. Years are left to the year rule above. A small number (up to 12) may stand for a word ("cinco",
// "douze", "a dozen") only when the original has no number at all.
const CJK_D = { "〇": 0, "零": 0, "一": 1, "二": 2, "两": 2, "兩": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
const CJK_U = { "十": 10, "百": 100, "千": 1000 };
const cjkNumerals = (s) => s.replace(/[〇零一二三四五六七八九十百千两兩]+/g, (m) => {
  if (m.length === 1 && !(m in CJK_D)) return m;      // a lone 十/百/千 is a word as often as a number
  let tot = 0, cur = 0;
  for (const c of m) { if (c in CJK_D) cur = cur * 10 + CJK_D[c]; else { tot += (cur || 1) * CJK_U[c]; cur = 0; } }
  return " " + (tot + cur) + " ";
});
// counting units written after a number, and their value
const UNITS = [[/^(?:万|萬|만|หมื่น)/, 1e4], [/^(?:億|亿|억)/, 1e8], [/^(?:兆|조)/, 1e12], [/^(?:千|천|พัน)/, 1e3], [/^(?:百|백|ร้อย)/, 100],
  [/^(?:แสน|লাখ|লক্ষ|लाख)/, 1e5], [/^(?:ล้าน)/, 1e6], [/^(?:কোটি|करोड़)/, 1e7]];
const SCALES = [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e12];
const EN_SCALE = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12, lakh: 1e5, crore: 1e7, k: 1e3, m: 1e6, bn: 1e9 };
const same = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
function originalNumbers(orig) {
  let s = cjkNumerals(asciiDigits(orig.normalize("NFKC")));
  const tokens = new Set((s.match(/\d+/g) || []).map(Number));
  // Roman numerals ("XXX Cumbre", "León XIV", "Parte II")
  for (const m of orig.matchAll(/\b[IVXLC]{2,7}\b/g)) { const r = roman(m[0]); if (r) tokens.add(r); }
  const vals = [];
  // a number with thousands separators or a decimal point or comma, then any counting units after it
  const re = /\d+(?:[,.\s'’]\d{3}(?!\d))*(?:[.,]\d+)?/g;
  for (const m of s.matchAll(re)) {
    const raw = m[0], grouped = raw.replace(/[,.\s'’](?=\d{3}(?!\d))/g, "");
    const forms = new Set([+grouped.replace(",", "."), +raw.replace(/[,\s'’]/g, ""), +raw.replace(/[.\s'’]/g, "").replace(",", ".")]);
    // a counting unit after it ("16万", "2억"), and a second number with its own unit ("16万5000", "2억4000만")
    let rest = s.slice(m.index + raw.length).trimStart();
    const u = UNITS.find(([r]) => r.test(rest));
    if (u) {
      const v = +grouped.replace(",", ".") * u[1]; forms.add(v);
      rest = rest.replace(u[0], "").trimStart();
      const nx = rest.match(/^\d+/);
      if (nx) { const u2 = UNITS.find(([r]) => r.test(rest.slice(nx[0].length).trimStart())); forms.add(v + +nx[0] * (u2 && u2[1] < u[1] ? u2[1] : 1)); }
    }
    for (const f of forms) if (Number.isFinite(f)) vals.push(f);
  }
  return { tokens, vals };
}
function roman(r) {
  const V = { I: 1, V: 5, X: 10, L: 50, C: 100 }; let n = 0;
  for (let k = 0; k < r.length; k++) { const a = V[r[k]], b = V[r[k + 1]] || 0; n += a < b ? -a : a; }
  return n > 0 && n < 400 ? n : 0;
}
// names that carry a number of their own, which the model may add ("COVID-19", "the Nikkei 225", "the G20")
const NAMED_NUMBERS = /\b(?:COVID-19|Nikkei 225|G-?(?:7|8|20)|P-?5|Brent)\b/gi;
export function extraNumber(orig, en) {
  orig = String(orig || ""); en = String(en || "");
  const { tokens, vals } = originalNumbers(orig);
  const okVal = (x) => vals.some((v) => SCALES.some((k) => same(v * k, x) || same(v / k, x)));
  const okTok = (x) => tokens.has(x) || (x <= 12 && tokens.has(x + 12)) || (x >= 12 && x <= 24 && tokens.has(x - 12)) || (x === 12 && tokens.has(0));
  // a school or budget year written short ("2026-27" for ២០២៦-២០២៧): the short year is the year rule's job
  const enS = asciiDigits(en.normalize("NFKC")).replace(NAMED_NUMBERS, " ").replace(/\b((?:19|20)\d\d)\s*[-–/]\s*\d\d\b/g, "$1");
  const re = /(?<![\w.])(\d+(?:,\d{3}(?!\d))*(?:\.\d+)?)(?:\s*(thousand|million|billion|trillion|lakh|crore|k|m|bn)\b)?/gi;
  for (const m of enS.matchAll(re)) {
    const raw = m[1], v = +raw.replace(/,/g, ""), sc = m[2] ? EN_SCALE[m[2].toLowerCase()] : 1;
    const parts = raw.split(/[.,]/).map(Number);
    if (v >= 1900 && v <= 2100 && !raw.includes(".") && !m[2]) continue;        // a year: the year rule's job
    if (v <= 1 && parts.length === 1) continue;
    if (okVal(v * sc) || okVal(v) || parts.every(okTok)) continue;
    if (!tokens.size && !vals.length && v <= 12 && parts.length === 1) continue;  // a number word in the original
    return raw + (m[2] ? " " + m[2] : "");
  }
  return "";
}

// Months. "May" and "March" (also verbs) and the short forms ("Jan.", "Sep") count only next to a number.
const EN_MONTHS = ["jan(?:uary)?", "feb(?:ruary)?", "mar(?:ch)?", "apr(?:il)?", "may", "june?", "july?", "aug(?:ust)?", "sep(?:t(?:ember)?)?",
  "oct(?:ober)?", "nov(?:ember)?", "dec(?:ember)?"];
const EN_MONTH_RE = new RegExp("(?<!\\p{L})(" + EN_MONTHS.join("|") + ")(?!\\p{L})\\.?", "giu");
const EN_MONTH_ONE = EN_MONTHS.map((e) => new RegExp("^(?:" + e + ")$", "i"));
const LGC = /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}]/u;
const MONTH_STEMS = MONTHS.map((l) => l.map((st) => st.replace(/ı/g, "i")));
export function extraMonth(orig, en) {
  orig = String(orig || ""); en = String(en || "");
  if (!orig.trim() || orig.trim() === en.trim()) return "";
  // lowercase, Turkish dotted and dotless i folded, a zero typed for an O ("0CTOBRE") read as the letter
  const o = orig.normalize("NFKC").toLowerCase().replace(/\u0307/g, "").replace(/ı/g, "i").replace(/(?<!\d)0(?=[a-z]{3})/g, "o");
  const { tokens } = originalNumbers(orig);
  for (const m of en.matchAll(EN_MONTH_RE)) {
    const w = m[1], k = EN_MONTH_ONE.findIndex((r) => r.test(w)) + 1;
    if (!k) continue;
    const full = w.length > 4 && !/^(?:march|may)$/i.test(w);
    if (!full && !/\d/.test(en.slice(Math.max(0, m.index - 4), m.index + m[0].length + 4))) continue;
    if (tokens.has(k)) continue;                                  // "06.11.2026", "11月", "tháng 11"
    const named = MONTH_STEMS[k - 1].some((st) => {
      const word = LGC.test(st[0]);
      for (let i = o.indexOf(st); i >= 0; i = o.indexOf(st, i + 1)) if (!word || !LGC.test(o[i - 1] || "")) return true;
      return false;
    });
    if (!named) return w;
  }
  return "";
}

// A headline already in English under another language's label. Latin letters only (no accented letters, which English
// headlines rarely carry and French, Spanish, Vietnamese or Turkish always do), at least four words, and at least two different
// English function words making up 15% of them. "Le 13h au Bénin du Samedi" or "Kapuso Housemate Lans, wagi ng Tiktok" do
// not pass.
const EN_WORDS = new Set(("the of and to for with from after says said will has have are were by this that over into amid its " +
  "their than about who what how why which been being would could should").split(" "));
export function looksEnglish(s) {
  s = String(s || "");
  if (/[^\u0000-\u007F\u00A0-\u00BF\u00D7\u00F7\u2000-\u206F\u20A0-\u20CF\u2100-\u214F\uFE0F\u{1F000}-\u{1FAFF}]/u.test(s)) return false;
  const w = s.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [];
  if (w.length < 4) return false;
  const hits = w.filter((x) => EN_WORDS.has(x));
  return new Set(hits).size >= 2 && hits.length / w.length >= 0.15;
}

// A stored news item whose English headline or summary is suspect loses it, so the page shows the original and the item is
// checked in its own words; returns true when anything was removed.
export function dropSuspectMt(i, now) {
  if (!i || !i.mt || /^en\b/i.test(i.lang || "")) return false;
  // already English: shown as written, not as the model's rewrite of it
  if (i.title && looksEnglish(i.title)) { i.title_en = i.title; delete i.mt; return true; }
  let hit = false;
  if (i.title_en && i.title && mtSuspect(i.title, i.title_en, now)) { delete i.title_en; hit = true; }
  if (i.summary_en && i.summary && mtSuspect(i.summary, i.summary_en, now)) { delete i.summary_en; hit = true; }
  if (hit && !i.title_en && !i.summary_en) i.mt = "untranslated";
  return hit;
}

// The model's own confidence (CTranslate2's length-normalized log-probability of its least sure chunk, tools/mt/madlad.py).
// Set from tools/mt/probe_confidence.mjs on 2026-11-08 (602 stored headlines): faithful French, Spanish, German, Portuguese,
// Russian, Arabic, Italian and Dutch lines all scored above -0.9 (median -0.42), October's invented lines had a median of -1.6, and
// of the Korean, Armenian, Azerbaijani, Georgian, Thai, Chinese and other lines the other checks let through, 15 of 319 fell below
// -1.5, nearly all of them unrelated to the original ("The bridge is now undergoing a major renovation." for an Armenian court
// story). Between -1.5 and -1.0 good and bad lines mix, so they are kept.
export const MT_MIN_SCORE = -1.5;
export const lowConfidence = (score) => typeof score === "number" && Number.isFinite(score) && score < MT_MIN_SCORE;
