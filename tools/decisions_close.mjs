// Answers and closes the analyst-decision issues the Deep South step read this run (tools/decision_lib.mjs). Runs after the commit
// step, on main only. A recorded decision's issue is answered and closed only when that commit went through (COMMITTED=success), so a
// failed push leaves the issue open and the next run records it again; a refused issue is answered with the reason and closed either
// way. The replies file sits outside the repo (RUNNER_TEMP) and holds only issue numbers and the fixed reply text.
// Usage (in the refresh job): GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/repo COMMITTED=success node tools/decisions_close.mjs
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const file = path.join(process.env.RUNNER_TEMP || os.tmpdir(), "osap-decision-replies.json");
const token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY, committed = process.env.COMMITTED === "success";
if (!fs.existsSync(file)) { console.log("no analyst-decision issues read this run"); process.exit(0); }
if (!token || !repo) { console.log("no token or repository; issues left open"); process.exit(0); }
const replies = JSON.parse(fs.readFileSync(file, "utf8"));
const api = (p, method, body) => fetch("https://api.github.com/repos/" + repo + p, { method,
  headers: { authorization: "Bearer " + token, accept: "application/vnd.github+json", "user-agent": "osap-refresh", "content-type": "application/json" },
  body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
let closed = 0, left = 0;
for (const r of replies) {
  if (!Number.isInteger(r.number)) continue;
  if (r.recorded && !committed) { left++; continue; }
  try {
    const c = await api("/issues/" + r.number + "/comments", "POST", { body: String(r.text).slice(0, 1000) + "\n\n---\n_Answered by the OSAP refresh job_" });
    if (!c.ok) throw new Error("comment HTTP " + c.status);
    const x = await api("/issues/" + r.number, "PATCH", { state: "closed", state_reason: r.recorded ? "completed" : "not_planned" });
    if (!x.ok) throw new Error("close HTTP " + x.status);
    closed++;
  } catch (e) { console.error("issue " + r.number + " not closed: " + e.message); left++; }
}
console.log(`analyst-decision issues: ${closed} answered and closed, ${left} left open for the next run`);
