// Checks for event-summary drafts (tools/refresh_evsum.mjs), kept apart so tests can load them without running the job.
// every figure a draft gives must be one the reports give (a small model can add or total numbers): digits in the reports'
// time, headline, place and text, and 1 to 10 where a report spells the number out
const NUMW = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
export function unsupportedFigures(out, input) {
  const src = input.map((r) => [r.time, r.headline, r.place, r.text].join(" ")).join(" \n "), have = new Set((src.match(/\d+(?:[.,]\d+)*/g) || []).map((x) => x.replace(/,/g, "")));
  NUMW.forEach((w, i) => { if (new RegExp("\\b" + w + "\\b", "i").test(src)) have.add(String(i)); });
  const txt = [out.summary, out.unclear, ...out.points.map((p) => p.text), ...out.differ.map((p) => p.text)].join(" ").replace(/\[\d+\]/g, "");
  return (txt.match(/\d+(?:[.,]\d+)*/g) || []).map((x) => x.replace(/,/g, "")).filter((x) => !have.has(x));
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
      const k = w.toLowerCase().replace(/['’]s$/, "");
      // a demonym or plural of a reported name passes (Malaysian for Malaysia): its stem is enough
      if (!NAMEOK.has(k) && !src.includes(k) && !(k.length >= 7 && src.includes(k.slice(0, k.length - 3)))) bad.add(w);
    });
  }
  return [...bad];
}
const DEATH = /\b(died|dies|die|dead|deaths?|killed|killing|kills?|fatal\w*|murder\w*|bod(y|ies)|slain|corpses?|lives? lost)\b/i;
export function unsupportedDeaths(out, input) { return DEATH.test(draftText(out)) && !DEATH.test(srcText(input)); }
