// Measures the grounding check (tools/ground.mjs) on the daily summaries as they are: how many AI lines of the newest day of each
// country trace to their sources, how many would be flagged for a name, and how many dropped, by kind. Run:
//   node tools/ground_audit.mjs [--date YYYY-MM-DD | --all] [--json out.json] [--show N]   (newest day of each country by default)
// Read-only: it changes no file except the --json report.
import fs from "node:fs";
import { groundLines, groundStats } from "./ground.mjs";
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : ""; };
const DIR = "data/live/daily", date = arg("--date"), show = +arg("--show") || 0;
const tot = { countries: 0, /* country-days */ lines: 0, traced: 0, flagged: 0, dropped: 0, kinds: {}, emptied: 0 };
const samples = [];
for (const f of fs.readdirSync(DIR).filter((f) => f.endsWith(".js")).sort()) {
  const w = {}; try { new Function("window", fs.readFileSync(`${DIR}/${f}`, "utf8"))(w); } catch (e) { continue; }
  const doc = w.OSAP_DAILY && Object.values(w.OSAP_DAILY)[0]; if (!doc || !doc.days) continue;
  for (const d of doc.days.filter((x, i) => (process.argv.includes("--all") ? true : date ? x.date === date : i === 0))) {
  if (!d || d.method !== "ai") continue;
  tot.countries++;
  const ctx = { place: d.name, facts: (d.watch || []).filter((x) => x.from !== "brief").map((x) => x.text), window: d.window };
  const lines = [...(d.bluf || []), ...(d.ai_watch || [])].map(({ g, ...p }) => p);
  const { kept, dropped } = groundLines(lines, d.refs, ctx), s = groundStats(kept, dropped);
  tot.lines += s.checked; tot.traced += s.traced; tot.flagged += s.flagged; tot.dropped += s.dropped;
  for (const k in s.kinds) tot.kinds[k] = (tot.kinds[k] || 0) + s.kinds[k];
  if (!kept.some((p) => (d.bluf || []).some((b) => b.text === p.text))) tot.emptied++;
  for (const x of dropped) samples.push({ cc: doc.cc || f.slice(0, -3), drop: true, text: x.text, gaps: x.gaps });
  for (const p of kept) if (p.g.s === "flagged") samples.push({ cc: doc.cc || f.slice(0, -3), drop: false, text: p.text, gaps: p.g.m.map(([k, w]) => k + ": " + w) });
  }
}
console.log(JSON.stringify(tot));
for (const s of samples.slice(0, show)) console.log((s.drop ? "DROP " : "FLAG ") + s.cc + " | " + s.text + " | " + JSON.stringify(s.gaps));
if (arg("--json")) fs.writeFileSync(arg("--json"), JSON.stringify({ totals: tot, samples }, null, 1));
