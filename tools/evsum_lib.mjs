// Checks for event-summary drafts (tools/refresh_evsum.mjs), kept apart so tests can load them without running the job.
// every figure a draft gives must be one the reports give (a small model can add or total numbers): digits in the reports'
// time, headline, place and text, and 1 to 10 where a report spells the number out
const NUMW = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
// digits of other scripts (Thai, Lao, Khmer, Myanmar, Arabic-Indic, Devanagari, Bengali) are read as 0-9
const DIGITS = [0x0e50, 0x0ed0, 0x17e0, 0x1040, 0x0660, 0x06f0, 0x0966, 0x09e6];
export function asciiDigits(s) {
  return String(s || "").replace(/[\u0e50-\u0e59\u0ed0-\u0ed9\u17e0-\u17e9\u1040-\u1049\u0660-\u0669\u06f0-\u06f9\u0966-\u096f\u09e6-\u09ef]/g, (c) => {
    const k = c.codePointAt(0), b = DIGITS.find((z) => k >= z && k <= z + 9); return String(k - b);
  });
}
export function unsupportedFigures(out, input) {
  // leading zeros are dropped on both sides: a report's time 2026-11-08T07:30 gives the 8 of "November 8" and the 7 of "7:30"
  // (8 Nov 2026: most rejections were dates and times written that way)
  const num = (x) => x.replace(/,/g, "").replace(/^0+(?=\d)/, "");
  // the source's own name counts too (Emirates 24/7, BF1)
  const src = asciiDigits(input.map((r) => [r.time, r.source, r.headline, r.place, r.text].join(" ")).join(" \n ")), have = new Set();
  for (const t of src.match(/\d+(?:[.,]\d+)*/g) || []) {
    const v = num(t); have.add(v);
    // a time or decimal written 15.00 also gives its parts (a draft writes 15:00), and a Thai Buddhist-era year its common-era year
    if (/^\d{1,2}\.\d{2}$/.test(t)) t.split(".").forEach((x) => have.add(num(x)));
    if (/^25\d\d$/.test(v)) have.add(String(+v - 543));
  }
  NUMW.forEach((w, i) => { if (new RegExp("\\b" + w + "\\b", "i").test(src)) have.add(String(i)); });
  const txt = asciiDigits([out.summary, out.unclear, ...out.points.map((p) => p.text), ...out.differ.map((p) => p.text)].join(" ").replace(/\[\d+\]/g, ""));
  return (txt.match(/\d+(?:[.,]\d+)*/g) || []).map(num).filter((x) => !have.has(x));
}

// a small model often cites as [6, 7], [6-8], [Report 6], (6)(7), (reports 6 and 7) or "report 6" instead of [6][7]; those numbers
// were read as figures and the whole draft rejected (8 Nov 2026: 0 of 20 kept). Each form is rewritten to [6][7] before the checks,
// and only numbers 1..n (the reports given) count as citations.
export function normCites(s, n) {
  const list = (body) => {
    const out = [];
    for (const part of String(body).split(/\s*(?:,|;|&|\band\b)\s*/i)) {
      const m = part.match(/^(?:reports?\s*|records?\s*|#|no\.?\s*)?(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?$/i);
      if (!m) return null;
      const a = +m[1], b = m[2] ? +m[2] : a;
      if (a < 1 || b > n || b < a || b - a > 9) return null;
      for (let i = a; i <= b; i++) out.push(i);
    }
    return out.length ? out : null;
  };
  const cite = (whole, body) => { const l = list(body); return l ? l.map((x) => "[" + x + "]").join("") : whole; };
  return String(s || "")
    // brackets: [6, 7] [6-8] [Report 6] [reports 6 and 7]
    .replace(/\[([^\[\]]{1,40})\]/g, cite)
    // parentheses only when they read as a citation: (6) (6, 7) (report 6) (reports 6 and 7) — not (24) or (2026)
    .replace(/\(((?:(?:reports?|records?)\s*)?\d{1,2}(?:\s*(?:,|;|&|-|–|\band\b)\s*(?:(?:reports?|records?)\s*)?\d{1,2})*)\)/gi, cite)
    // in running text: "report 6", "reports 6 and 7"
    .replace(/\b([Rr]eport|[Rr]ecord)s?\s+((?:#|no\.?\s*)?\d{1,2}(?:\s*(?:,|&|-|–|\band\b)\s*\d{1,2})*)\b(?!\s*(?:[:.]\d|%|people|dead|killed|injured))/g, (w, k, b) => { const l = list(b), word = k.toLowerCase(); return l ? (l.length > 1 ? "the " + word + "s " : "a " + word + " ") + l.map((x) => "[" + x + "]").join("") : w; });
}

// a small model also invents names (a prime minister, a "Lieutenant General Wang") and deaths. Every capitalised word inside a
// sentence must occur somewhere in the reports or their source names, and a draft may speak of deaths only if a report does.
const NAMEOK = new Set(("january february march april may june july august september october november december monday tuesday wednesday thursday friday saturday sunday ai utc gmt ict myt mst wib wit pht sgt jst kst ist zulu english" +
  // titles and institutions are not names (8 Nov 2026: "Prime Minister" was rejected); the person's name after them still has to be in the reports
  " prime minister ministry president vice deputy king queen prince princess governor general lieutenant colonel major captain sergeant commander" +
  " chief officer police army navy air force forces military court supreme constitutional parliament senate senator government department" +
  " province provincial district region regional state city national international security defence defense foreign interior affairs" +
  " spokesperson spokesman office agency council committee commission authority ministers united nations").split(" "));
// country and territory names in English (Intl), word by word: a draft may name the country a report is about
try { const dn = new Intl.DisplayNames(["en"], { type: "region" });
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) { const c = String.fromCharCode(a, b), n = dn.of(c); if (n && n !== c) n.toLowerCase().split(/[^\p{L}]+/u).forEach((w) => w.length > 2 && NAMEOK.add(w)); }
} catch (e) {}
const srcText = (input) => input.map((r) => [r.source, r.headline, r.place, r.text].join(" ")).join(" \n ");
const draftText = (out) => [out.summary, out.unclear, ...out.points.map((p) => p.text), ...out.differ.map((p) => p.text)].join(" \n ").replace(/\[\d+\]/g, "");
export function unsupportedNames(out, input) {
  const src = srcText(input).toLowerCase(), bad = new Set();
  for (const part of draftText(out).split(/(?<=[.!?:;"'“”(])\s+|\n/)) {
    const words = part.match(/[\p{L}][\p{L}'’-]*/gu) || [];
    words.slice(1).forEach((w) => {
      if (!/^\p{Lu}/u.test(w) || w.length < 3) return;
      const k = w.toLowerCase().replace(/['’]s$/, "").replace(/['’-]+$/, ""), one = k.replace(/(?<=\p{L}{3})s$/u, "");
      // a demonym or plural of a reported name passes (Malaysian for Malaysia): its stem is enough
      if (!NAMEOK.has(k) && !src.includes(k) && !src.includes(one) && !(k.length >= 7 && src.includes(k.slice(0, k.length - 3)))) bad.add(w);
    });
  }
  return [...bad];
}
const DEATH = /\b(died|dies|die|dead|deaths?|killed|killing|kills?|fatal\w*|murder\w*|bod(y|ies)|slain|corpses?|lives? lost)\b/i;
export function unsupportedDeaths(out, input) { return DEATH.test(draftText(out)) && !DEATH.test(srcText(input)); }

// a short look at where a rejected figure sits in the draft, for the run log (at most 60 characters of the draft, never the reports)
export function figureContext(out, fig) {
  const txt = draftText(out).replace(/\s+/g, " "), i = txt.search(new RegExp("(?<![\\d.,])" + String(fig).replace(/\./g, "\\.") + "(?![\\d])"));
  return i < 0 ? "" : ' ("…' + txt.slice(Math.max(0, i - 30), i + 30) + '…")';
}

// ---------- flashpoint name terms (plain watch lists in tools/refresh_evsum.mjs) ----------
// Reports are matched to a curated flashpoint by the place words in its name. Generic words, Thai/Lao place prefixes ("Chiang",
// "Mae", "Ban": they start hundreds of town names) and country words say nothing about which flashpoint a report is about.
// A proper-name part with two or more telling words is matched whole ("Golden Triangle", "Shwe Kokko"): on 22 Nov 2026 the Thai
// daily summary told readers the Northern drug corridor was elevated "due to mentions of 'chiang'", because "Chiang Mai", "Chiang
// Saen", "Golden" and "Triangle" were each matched alone and any Chiang Rai story counted (an elephant festival, a water meeting).
export const FP_GENERIC = new Set("chong ban phu khao doi mae nong wat around near along with from temples temple checkpoint villages village fishing grounds posts post camps bank scam scams sector sectors tribal phnom hill hills hub hubs park parks dry state states zone old new great little black white yellow three four five first second shoal shoals reef reefs trade shipping targets target strike deep fortress front islands border borders front frontline zone zones river rivers island islands strait straits line area areas region regions north south east west northern southern eastern western central upper lower corridor crossing crossings point points pass mountains mountain hills coast coastal waters province state district city town camp base disputed dispute tensions maritime conflict civil war insurgency armed group groups spillover route routes sea gulf bay valley plateau lake desert chiang muang mueang after before attack attacks site sites buildup inland government strip basin delta peninsula heights canal highlands lowlands archipelago atoll atolls channel".split(" "));
const FP_JOIN = new Set(["of", "the", "del", "de", "la", "el", "al", "and", "da", "do", "dos", "das", "di"]);
// country names and their demonyms ("Thai", "Myanmar", "Sudanese", "Iranian", "Chinese")
const CWORDS = (() => {
  const out = new Set(["burmese", "filipino", "dutch", "swiss", "british", "korean", "emirati", "saudi", "kiwi", "okinawa"]);
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "region" }), A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (const a of A) for (const b of A) { const n = dn.of(a + b); if (n && n !== a + b) n.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4).forEach((w) => out.add(w)); }
  } catch (e) {}
  return [...out];
})();
/** a country word or demonym: same first five letters (Afghan/Afghanistan), or the whole name but its last letter
 *  (Iran/Iranian, China/Chinese; 22 Nov 2026 "mentions iranian" matched the Iranian nuclear sites flashpoint in Jordan and Oman) */
export function countryWord(w) {
  const l = String(w).toLowerCase(), k = Math.min(5, l.length);
  if (l.length < 4) return false; // "Ta", "Sai", "Cay": too short to be a country word (and never kept as a word alone)
  return CWORDS.some((c) => Math.abs(c.length - l.length) <= 6 && (c.slice(0, k) === l.slice(0, k) || (c.length >= 4 && l.startsWith(c.slice(0, c.length - 1)) && c.length - 1 >= 4) || l.startsWith(c)));
}
const telling = (w) => w.length >= 4 && !FP_GENERIC.has(w.toLowerCase()) && !countryWord(w);
// place-name prefixes that only mean something with the word after them ("Chiang Saen", "Ban Nong Chan", "Mae Sot", "Chong Bok")
const FP_PREFIX = new Set(["chiang", "mae", "ban", "nong", "chong", "phu", "khao", "doi", "wat", "muang", "mueang", "phnom"]);
/** "Golden Triangle and Mekong (Chiang Saen–Chiang Khong)" -> ["Golden Triangle", "Mekong", "Chiang Saen", "Chiang Khong"] (max 8).
 *  A part written as a proper name (every word capitalised, or of/the/del ...) is matched whole, trimmed of generic and country
 *  words at its ends; other parts give their telling words one by one, as before. */
export function flashpointTerms(name) {
  const out = [];
  for (const part of String(name || "").split(/[()–—,;/]| and | to /)) {
    const words = part.split(/[^A-Za-zÀ-ɏ0-9'’-]+/).map((w) => w.replace(/['’]s$/, "")).filter(Boolean);
    if (!words.length) continue;
    const proper = words.every((w) => /^[A-ZÀ-Þ0-9]/.test(w) || /^[a-z]{1,3}-[A-ZÀ-Þ]/.test(w) || FP_JOIN.has(w.toLowerCase())); // "ez-Zor", "al-Aqsa"
    if (!proper) { words.filter(telling).forEach((w) => out.push(w)); continue; }
    const kind = (w) => { const l = w.toLowerCase(); return FP_JOIN.has(l) ? "J" : FP_PREFIX.has(l) ? "P" : FP_GENERIC.has(l) ? "G" : countryWord(w) ? "C" : "W"; };
    const k = words.map(kind);
    let i = 0, j = words.length - 1;
    while (i <= j && k[i] !== "W" && k[i] !== "P") i++;
    while (j >= i && k[j] !== "W") j--;
    if (i > j) continue;
    const span = words.slice(i, j + 1), ks = k.slice(i, j + 1);
    // worth matching: a telling word, or a prefix with a name after it ("Mae Sot")
    const ok = span.some((w, n) => ks[n] === "W" && (w.length >= 4 || (n > 0 && ks[n - 1] === "P" && w.length >= 3)));
    if (ok) out.push(span.join(" "));
  }
  return [...new Set(out)].slice(0, 8);
}
/** one case-blind regex for the terms; words of a phrase may be split by spaces or hyphens ("Golden-Triangle") */
export function termsRegex(terms) {
  if (!terms || !terms.length) return null;
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // a hyphen inside a name is optional ("Deir ez-Zor" = "Deir Ezzor")
  return new RegExp("\\b(" + terms.map((t) => t.split(/\s+/).map((w) => esc(w).replace(/-/g, "[\\s-]?")).join("[\\s-]+")).join("|") + ")\\b", "i");
}
