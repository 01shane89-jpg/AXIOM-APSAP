// Measures the grounding check (tools/ground.mjs) on the daily summaries as they are: how many AI lines of the newest day of each
// country trace to their sources, how many would be flagged for a name, and how many dropped, by kind. Run:
//   node tools/ground_audit.mjs [--date YYYY-MM-DD | --all] [--json out.json] [--show N]   (newest day of each country by default)
// --retry also writes each dropped line once more through the AI gateway (tools/ground_retry.mjs; OSAP_AI_ORDER, GITHUB_TOKEN,
// OSAP_LOCAL_LLM or ANTHROPIC_API_KEY as for the summaries) and counts how many second drafts pass every check: the recovered rate.
// Read-only: it changes no file except the --json report.
import fs from "node:fs";
import { groundLines, groundStats } from "./ground.mjs";
import { groundCtx } from "./daily_lib.mjs";
import { retryDropped } from "./ground_retry.mjs";
import { gateway } from "./ai_gateway.mjs";
const RETRY = process.argv.includes("--retry");
const AI = RETRY ? gateway({ anthropicCapUsd: +(process.env.DAILY_ANTHROPIC_CAP_USD || 0) }) : null;
const chat = async (messages) => { const r = await AI.chat({ messages, max_tokens: 400 }); return r && { content: r.content, model: r.model, provider: r.provider }; };
const retry = { tried: 0, recovered: 0, why: {} };
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
  if (RETRY && dropped.length) {
    const r = await retryDropped(dropped.map((x, i) => ({ ...x, section: i < lines.length && (d.bluf || []).some((b) => b.text === x.text) ? "bluf" : "watch" })), d, ctx, { chat, budget: { left: 99 } });
    for (const a of r.attempts) { retry.tried++; if (a.ok) retry.recovered++; else retry.why[a.why] = (retry.why[a.why] || 0) + 1; }
  }
  for (const x of dropped) samples.push({ cc: doc.cc || f.slice(0, -3), drop: true, text: x.text, gaps: x.gaps });
  for (const p of kept) if (p.g.s === "flagged") samples.push({ cc: doc.cc || f.slice(0, -3), drop: false, text: p.text, gaps: p.g.m.map(([k, w]) => k + ": " + w) });
  }
}
console.log(JSON.stringify(tot));
if (RETRY) console.log("retry: " + JSON.stringify(retry) + (AI && Object.keys(AI.status().dropped).length ? " providers dropped: " + JSON.stringify(AI.status().dropped) : ""));
for (const s of samples.slice(0, show)) console.log((s.drop ? "DROP " : "FLAG ") + s.cc + " | " + s.text + " | " + JSON.stringify(s.gaps));
if (arg("--json")) fs.writeFileSync(arg("--json"), JSON.stringify({ totals: tot, samples }, null, 1));
