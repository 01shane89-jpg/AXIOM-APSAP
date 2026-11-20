// Country brief refresh (Shane 2026-11-20: "we can't afford to have stuck data. Ever"). Rules in tools/brief_lib.mjs; run by
// .github/workflows/refresh-briefs.yml, or by hand with Node 18+ from the repo root:
//   node tools/refresh_briefs.mjs plan               Lists the briefs due (last check BRIEF_DUE_DAYS or more ago, oldest first) and
//                                                    splits them into shards for the workflow's matrix (GITHUB_OUTPUT "shards").
//   node tools/refresh_briefs.mjs draft <cc,cc,...>  Asks the AI gateway (GitHub Models with the workflow's GITHUB_TOKEN, else the
//                                                    runner's own open-weight model) for each country's update and writes the checked
//                                                    result to out/briefs/<cc>.json. Nothing in data/ changes.
//   node tools/refresh_briefs.mjs apply [dir]        Merges every out/briefs/<cc>.json into data/brief/<cc>.js and writes the run
//                                                    record data/live/brief-refresh.js (read by tools/health.mjs).
// Env: BRIEFS_ONLY=cc,cc (plan: just these), BRIEFS_ALL=1 (plan: every brief, the backfill), BRIEFS_MAX (plan: most this run),
// BRIEFS_SHARDS (plan), BRIEFS_BUDGET_MIN (draft: stop starting countries after this), BRIEFS_MODEL (GitHub Models model),
// BRIEFS_NOW (ISO, tests), OSAP_LOCAL_LLM + OSAP_LOCAL_MODEL, OSAP_AI_ORDER.
// A country whose draft failed (no model answer, reply not JSON) is written with "error" and its brief is left as it was and still
// due, so the next run tries again; a country with no reports in OSAP is still checked, and what has gone stale is taken off.
import fs from "node:fs";
import path from "node:path";
import { gateway, parseJsonReply } from "./ai_gateway.mjs";
import { collectReports, buildPrompt, validateUpdate, applyUpdate, dueList, shards, SYSTEM, PROMPT_V, dayOf, ageDays, BRIEF_DUE_DAYS, BRIEF_STALE_DAYS } from "./brief_lib.mjs";

const NOW = process.env.BRIEFS_NOW ? Date.parse(process.env.BRIEFS_NOW) : Date.now();
const BRIEF_DIR = "data/brief", OUT = "out/briefs", RECORD = "data/live/brief-refresh.js";
const PRIORITY = "th kh la mm vn my sg id bn ph tl cn tw jp oki kr kp mn in pk bd np bt lk mv au nz pg ua ru il ir".split(" ");
const HEAD = (cc) => `window.ASAP_BRIEF=window.ASAP_BRIEF||{};window.ASAP_BRIEF[${JSON.stringify(cc)}]=`;

export function readBrief(cc, dir = BRIEF_DIR) {
  let t; try { t = fs.readFileSync(path.join(dir, cc + ".js"), "utf8"); } catch (e) { return null; }
  if (!t.startsWith("window.ASAP_BRIEF")) return null;   // a sealed hidden-area brief (tools/seal_hidden.mjs) is never read here
  try { const w = {}; new Function("window", t)(w); return (w.ASAP_BRIEF || {})[cc] || null; } catch (e) { return null; }
}
const readWin = (f, v) => { try { const w = {}; new Function("window", fs.readFileSync(f, "utf8"))(w); return w[v]; } catch (e) { return null; } };
const listBriefs = () => fs.readdirSync(BRIEF_DIR).filter((f) => /^[a-z]{2,3}\.js$/.test(f)).map((f) => f.slice(0, -3)).sort();

function plan() {
  const only = process.env.BRIEFS_ONLY ? process.env.BRIEFS_ONLY.split(",").map((s) => s.trim()).filter(Boolean) : null;
  const briefs = (only || listBriefs()).map((cc) => { const b = readBrief(cc); return b && { cc, checked: b.checked || null }; }).filter(Boolean);
  let due = only ? briefs.map((b) => b.cc) : dueList(briefs, NOW, { priority: PRIORITY, all: !!process.env.BRIEFS_ALL });
  const max = +(process.env.BRIEFS_MAX || 0); if (max > 0) due = due.slice(0, max);
  const sh = shards(due, +(process.env.BRIEFS_SHARDS || 3));
  console.log(`briefs plan: ${briefs.length} readable briefs, ${due.length} due, ${sh.length} shard(s)`);
  sh.forEach((s, i) => console.log(`  shard ${i + 1}: ${s}`));
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `shards=${JSON.stringify(sh)}\ncount=${due.length}\n`);
}

async function draft(list) {
  const AI = gateway({ githubModel: process.env.BRIEFS_MODEL || "openai/gpt-4.1-mini" });
  const budget = +(process.env.BRIEFS_BUDGET_MIN || 0) * 60e3, t0 = Date.now();
  fs.mkdirSync(OUT, { recursive: true });
  let made = 0, quiet = 0, failed = 0, stopped = "";
  for (const cc of list) {
    const brief = readBrief(cc);
    if (!brief) { console.log(`${cc}: no readable brief, skipped`); continue; }
    const dailyF = `data/live/daily/${cc}.js`, d = readWin(dailyF, "OSAP_DAILY");
    const reports = collectReports(d && d[cc], NOW);
    const rec = { cc, date: dayOf(NOW), reports, prompt: PROMPT_V };
    if (!reports.length) { rec.upd = { sections: {}, watch: [], threat: [], rejected: [] }; rec.note = "no OSAP reports in the last 7 days"; quiet++; }
    else if (stopped || (budget && Date.now() - t0 > budget)) { stopped = stopped || "time budget used"; rec.error = "not reached: " + stopped; }
    else if (!AI.available()) { stopped = "no AI provider: " + JSON.stringify(AI.status().dropped); rec.error = stopped; }
    else {
      const t1 = Date.now();
      try {
        const res = await AI.chat({ messages: [{ role: "system", content: SYSTEM }, { role: "user", content: buildPrompt(brief, reports, NOW) }], max_tokens: 1100 });
        if (!res) { stopped = "no AI provider: " + JSON.stringify(AI.status().dropped); rec.error = stopped; }
        else {
          const o = parseJsonReply(res.content);
          if (!o) rec.error = res.provider + " reply was not JSON";
          else {
            rec.upd = validateUpdate(o, reports, brief);
            rec.meta = { provider: res.provider, model: res.model, ms: Date.now() - t1, ...(res.usage ? { tokens: { in: res.usage.prompt_tokens, out: res.usage.completion_tokens } } : {}) };
            made++;
          }
        }
      } catch (e) { rec.error = String(e.message || e).slice(0, 160); }
    }
    if (rec.error) failed++;
    fs.writeFileSync(path.join(OUT, cc + ".json"), JSON.stringify(rec) + "\n");
    const u = rec.upd;
    console.log(`${cc}: ${reports.length} reports; ` + (rec.error ? "ERROR " + rec.error : rec.note ? rec.note
      : `kept ${Object.values(u.sections).flat().length} section lines, ${u.watch.length} watch, ${u.threat.length} rating changes; dropped ${u.rejected.length}` +
        (u.rejected.length ? " (" + u.rejected.slice(0, 4).map((r) => r.where + ": " + r.why).join("; ") + ")" : "") + ` [${rec.meta.provider} ${Math.round(rec.meta.ms / 1000)} s]`));
  }
  console.log(`briefs draft: ${made} drafted, ${quiet} with no reports, ${failed} failed` + (stopped ? `; stopped: ${stopped}` : ""));
}

function apply(dir = OUT) {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).filter((f) => /(^|\/)[a-z]{2,3}\.json$/.test(f)) : [];
  const prev = readWin(RECORD, "OSAP_BRIEF_REFRESH") || {};
  const countries = { ...(prev.countries || {}) };
  let changed = 0, checked = 0, errors = 0;
  for (const f of files) {
    let rec; try { rec = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch (e) { continue; }
    const cc = rec.cc, brief = readBrief(cc);
    if (!brief || !/^[a-z]{2,3}$/.test(cc)) continue;
    if (rec.error) { errors++; countries[cc] = { ...(countries[cc] || {}), checked: brief.checked || null, as_of: brief.as_of, error: rec.error, tried: rec.date }; continue; }
    const nb = applyUpdate(brief, rec.upd, rec.reports, { ...(rec.meta || {}), ...(rec.note ? { note: rec.note } : {}) }, NOW);
    fs.writeFileSync(path.join(BRIEF_DIR, cc + ".js"), HEAD(cc) + JSON.stringify(nb) + ";\n");
    checked++; if (nb.as_of !== brief.as_of || JSON.stringify(nb.pmesii) !== JSON.stringify(brief.pmesii)) changed++;
    countries[cc] = { checked: nb.checked, as_of: nb.as_of, kept: nb.refresh.kept, rejected: nb.refresh.rejected, reports: nb.refresh.reports, ...(rec.note ? { note: rec.note } : {}) };
  }
  // every readable brief is listed, so the record shows the ones no run has reached
  for (const cc of listBriefs()) if (!countries[cc]) { const b = readBrief(cc); if (b) countries[cc] = { checked: b.checked || null, as_of: b.as_of }; }
  const all = Object.values(countries);
  const overdue = Object.entries(countries).filter(([, c]) => ageDays(c.checked, NOW) > BRIEF_DUE_DAYS + 3).map(([cc]) => cc).sort();
  const stale = Object.entries(countries).filter(([, c]) => ageDays(c.checked, NOW) > BRIEF_STALE_DAYS).map(([cc]) => cc).sort();
  const run = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
  const out = { asof: new Date(NOW).toISOString().slice(0, 19) + "Z", run, dueDays: BRIEF_DUE_DAYS, staleDays: BRIEF_STALE_DAYS,
    total: all.length, lastRun: { checked, changed, errors }, overdue, stale, countries };
  fs.mkdirSync(path.dirname(RECORD), { recursive: true });
  fs.writeFileSync(RECORD, "window.OSAP_BRIEF_REFRESH=" + JSON.stringify(out) + ";\n");
  console.log(`briefs apply: ${checked} checked, ${changed} changed, ${errors} failed; ${overdue.length} overdue, ${stale.length} unchecked for ${BRIEF_STALE_DAYS}+ days`);
}

const [cmd, arg] = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1].endsWith("refresh_briefs.mjs")) {
  if (cmd === "plan") plan();
  else if (cmd === "draft") await draft(String(arg || "").split(",").map((s) => s.trim()).filter(Boolean));
  else if (cmd === "apply") apply(arg || OUT);
  else { console.error("usage: node tools/refresh_briefs.mjs plan | draft <cc,cc> | apply [dir]"); process.exit(2); }
}
