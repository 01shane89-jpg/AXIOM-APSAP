// Machine translation guard: catches an English "translation" the open model invented instead of translating.
// MADLAD-400 sometimes answers a Thai, Korean or Chinese headline with stock text that has nothing to do with it
// ("The 1980s were a time of great success for the band." for a Thai flood or shooting story, "2016-09-30 - ..." for a
// Korean one). Such a line passes every word check on its own, and identical inventions for different stories look like
// one story carried by several outlets, so it can lead the daily summary. A translation is suspect when it:
//   - names a year or a decade the original does not have (Buddhist Era years such as 2569 or "ปี 69" count as 2026);
//   - is one of the model's stock inventions ("... were a time of great success", "(in Japanese)", a web error page);
//   - repeats a word run (the model looping);
//   - is still mostly in another script (the model gave Chinese back as Chinese).
// Pure: no files, no network. Used by tools/translate.mjs (new and cached translations), tools/history.mjs and
// tools/news_index.mjs (translations already stored) and tools/daily_lib.mjs (the summary's last check).

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
  for (const m of en.matchAll(CENTURY)) if (!nums.includes(m[1])) return "century not in the original";
  return "";
}

// A stored news item whose English headline or summary is suspect loses it, so the page shows the original and the item is
// checked in its own words; returns true when anything was removed.
export function dropSuspectMt(i, now) {
  if (!i || !i.mt || /^en\b/i.test(i.lang || "")) return false;
  let hit = false;
  if (i.title_en && i.title && mtSuspect(i.title, i.title_en, now)) { delete i.title_en; hit = true; }
  if (i.summary_en && i.summary && mtSuspect(i.summary, i.summary_en, now)) { delete i.summary_en; hit = true; }
  if (hit && !i.title_en && !i.summary_en) i.mt = "untranslated";
  return hit;
}
