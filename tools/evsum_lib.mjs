// Checks for event-summary drafts (tools/refresh_evsum.mjs), kept apart so tests can load them without running the job.
// every figure a draft gives must be one the reports give (a small model can add or total numbers): digits in the reports'
// time, headline, place and text, and 1 to 10 where a report spells the number out
const NUMW = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
export function unsupportedFigures(out, input) {
  // leading zeros are dropped on both sides: a report's time 2026-11-08T07:30 gives the 8 of "November 8" and the 7 of "7:30"
  // (8 Nov 2026: most rejections were dates and times written that way)
  const num = (x) => x.replace(/,/g, "").replace(/^0+(?=\d)/, "");
  const src = input.map((r) => [r.time, r.headline, r.place, r.text].join(" ")).join(" \n "), have = new Set((src.match(/\d+(?:[.,]\d+)*/g) || []).map(num));
  NUMW.forEach((w, i) => { if (new RegExp("\\b" + w + "\\b", "i").test(src)) have.add(String(i)); });
  const txt = [out.summary, out.unclear, ...out.points.map((p) => p.text), ...out.differ.map((p) => p.text)].join(" ").replace(/\[\d+\]/g, "");
  return (txt.match(/\d+(?:[.,]\d+)*/g) || []).map(num).filter((x) => !have.has(x));
}

// a small model often cites as [6, 7], [6-8], [Report 6], (6)(7), (reports 6 and 7) or "report 6" instead of [6][7]; those numbers
// were read as figures and the whole draft rejected (8 Nov 2026: 0 of 20 kept). Each form is rewritten to [6][7] before the checks,
// and only numbers 1..n (the reports given) count as citations.
export function normCites(s, n) {
  const list = (body) => {
    const out = [];
    for (const part of String(body).split(/\s*(?:,|;|&|\band\b)\s*/i)) {
      const m = part.match(/^(?:reports?\s*|#|no\.?\s*)?(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?$/i);
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
    .replace(/\(((?:reports?\s*)?\d{1,2}(?:\s*(?:,|;|&|-|–|\band\b)\s*(?:reports?\s*)?\d{1,2})*)\)/gi, cite)
    // in running text: "report 6", "reports 6 and 7"
    .replace(/\b[Rr]eports?\s+((?:#|no\.?\s*)?\d{1,2}(?:\s*(?:,|&|-|–|\band\b)\s*\d{1,2})*)\b(?!\s*(?:[:.]\d|%|people|dead|killed|injured))/g, (w, b) => { const l = list(b); return l ? (l.length > 1 ? "the reports " : "a report ") + l.map((x) => "[" + x + "]").join("") : w; });
}

// a small model also invents names (a prime minister, a "Lieutenant General Wang") and deaths. Every capitalised word inside a
// sentence must occur somewhere in the reports or their source names, and a draft may speak of deaths only if a report does.
const NAMEOK = new Set("january february march april may june july august september october november december monday tuesday wednesday thursday friday saturday sunday ai utc gmt ict myt mst wib wit pht sgt jst kst ist zulu english".split(" "));
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
