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
