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
