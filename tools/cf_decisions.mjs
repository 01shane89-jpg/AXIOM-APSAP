// Records the repository owner's incident decisions for the conflict tabs (tools/cf_decision_lib.mjs) and rebuilds the projection the
// page reads (data/live/conflicts/verified.js). Run by .github/workflows/record-incident-decisions.yml when an issue is opened, and on
// a schedule to catch any it missed. What to tell each issue goes to a file outside the repo for tools/decisions_close.mjs.
// The projection is rebuilt from the decision store alone, so it can be deleted and rebuilt at any time.
// Usage: GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/repo GITHUB_REPOSITORY_OWNER=owner node tools/cf_decisions.mjs
//        (no token: no issues are read, only the projection is rebuilt)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { plan, inForce, TITLE } from "./cf_decision_lib.mjs";
import { readIndex, write } from "./capture_lib.mjs";

const CF_DIR = "data/live/conflicts", DEC_DIR = "data/decisions/conflicts", OUT = path.join(CF_DIR, "verified.js");
export const REPLIES = path.join(process.env.RUNNER_TEMP || os.tmpdir(), "osap-cf-decision-replies.json");

// a conflict file's object: "(window.X=window.X||{})[id]={...};"
function readJs(f) { const t = fs.readFileSync(f, "utf8"); return JSON.parse(t.slice(t.indexOf("={") + 1).replace(/;\s*$/, "")); }

// Map conflict id -> Map fp -> report, from every conflict's current and older file.
export function knownReports(dir = CF_DIR) {
  const known = new Map();
  if (!fs.existsSync(dir)) return known;
  for (const f of fs.readdirSync(dir).sort()) {
    const m = f.match(/^([a-z0-9][a-z0-9-]*?)(\.older)?\.js$/);
    if (!m || /^(index|auto|bundle|verified)$/.test(m[1])) continue;
    let o; try { o = readJs(path.join(dir, f)); } catch (e) { continue; }
    if (!known.has(m[1])) known.set(m[1], new Map());
    for (const i of o.items || []) if (i && /^[0-9a-f]{64}$/.test(i.fp || "")) known.get(m[1]).set(i.fp, i);
  }
  return known;
}

export function readDecisions(dir = DEC_DIR) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const d of fs.readdirSync(dir).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort())
    for (const f of fs.readdirSync(path.join(dir, d)).filter((x) => x.endsWith(".ndjson")).sort())
      for (const l of fs.readFileSync(path.join(dir, d, f), "utf8").split("\n")) if (l.trim()) try { out.push(JSON.parse(l)); } catch (e) {}
  return out;
}

export function projection(decisions, asof) {
  const p = inForce(decisions);
  return "window.OSAP_CF_VERIFIED=" + JSON.stringify({ schema: "osap-incident-verified/1", asof, decisions: p.count, by: p.by, incidents: p.incidents }).replace(/<\//g, "<\\/") + ";\n";
}

async function main() {
  const now = new Date().toISOString(), recorded = now.slice(0, 16);
  const token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY, owner = process.env.GITHUB_REPOSITORY_OWNER;
  if (token && repo && owner) {
    const url = "https://api.github.com/repos/" + repo + "/issues?state=open&creator=" + encodeURIComponent(owner) + "&per_page=100&sort=created&direction=asc";
    const res = await fetch(url, { headers: { authorization: "Bearer " + token, accept: "application/vnd.github+json", "user-agent": "osap-refresh" }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error("issues HTTP " + res.status);
    const issues = (await res.json()).filter((i) => String(i.title || "").startsWith(TITLE));
    const d = plan(issues, owner, knownReports(), readIndex(DEC_DIR), recorded);
    write(DEC_DIR, d.records, d.index, { collected: recorded });
    fs.writeFileSync(REPLIES, JSON.stringify(d.replies));
    console.log(`incident decisions: ${issues.length} decision issues open, ${d.records.length} recorded, ${d.replies.filter((r) => !r.recorded).length} refused`);
  } else console.log("incident decisions: no token, issues not read (a local run); projection rebuilt only");
  fs.mkdirSync(CF_DIR, { recursive: true });
  const decs = readDecisions();
  // asof: when the newest decision was recorded, so a run with nothing new leaves the file unchanged (no empty commits)
  const last = decs.map((d) => String(d.recorded || "")).sort().pop() || "";
  fs.writeFileSync(OUT, projection(decs, last ? last.replace("T", " ") + "Z" : ""));
  console.log(`projection: ${decs.length} decisions -> ${OUT}`);
}
if (import.meta.url === "file://" + path.resolve(process.argv[1] || "")) main().catch((e) => { console.error("incident decisions failed:", e.message); process.exit(1); });
