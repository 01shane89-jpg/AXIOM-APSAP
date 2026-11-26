// Which scheduled data jobs to start again: the late ones in data/live/health.json (tools/health_lib.mjs lateJobs) that can be
// started by hand (workflow_dispatch with no required inputs). Used by refresh-keeper.yml each round, so a job whose own schedule
// GitHub skips (refresh-avwx.yml every 20 min and refresh-darkships.yml every 15 min fired only every 4 to 9 h in the week to
// 20 Nov 2026) is started again instead of sitting late in the panel.
// node tools/late_jobs.mjs <health.json>  -> one workflow file per line
import fs from "node:fs";
import { lateJobs } from "./health_lib.mjs";

/** can this workflow be started by hand with no inputs? (workflow_dispatch present, no input marked required: true) */
export function dispatchable(yml) {
  const t = String(yml);
  if (!/^\s{2}workflow_dispatch\s*:/m.test(t)) return false;
  const m = /^\s{2}workflow_dispatch\s*:[^\n]*\n((?:\s{4,}[^\n]*\n|\s*\n)*)/m.exec(t);
  return !(m && /^\s+required\s*:\s*true\b/m.test(m[1]));
}

/** health.json + workflow texts by file -> files to start (never the keeper itself) */
export function toRestart(health, ymlOf, now = Date.now()) {
  return lateJobs(health && health.jobs && health.jobs.list, now, health && health.jobs && health.jobs.at).map((j) => j.file)
    .filter((f) => /^[\w.-]+\.ya?ml$/.test(f) && f !== "refresh-keeper.yml" && dispatchable(ymlOf(f)));
}

if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  let health = null;
  try { health = JSON.parse(fs.readFileSync(process.argv[2], "utf8")); } catch (e) { process.exit(0); }
  const ymlOf = (f) => { try { return fs.readFileSync(".github/workflows/" + f, "utf8"); } catch (e) { return ""; } };
  for (const f of toRestart(health, ymlOf)) console.log(f);
}
