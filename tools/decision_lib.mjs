// Analyst decisions for the Deep South (Conflict Coverage plan, Phase 2): the record of what an analyst decided about the machine's
// suggestions. Only a person decides; this file only reads, checks and stores what they decided, and never makes a decision itself.
//
// Where decisions come from: a GitHub issue the repository owner opens from the review panel in the app (assets/osap-ds-review.js).
// The panel fills the issue in; the owner adds a reason and submits it. The refresh job reads open issues, keeps only those the owner
// opened, checks each against the rules below and the stores, and writes one decision record per accepted issue. Every issue it read
// is then answered and closed (tools/decisions_close.mjs, after the commit), saying whether it was recorded and why not if not.
// The issue text is untrusted: only the fenced JSON block and the "Reason:" line are read, both checked field by field.
//
// Actions:
//   same_event       { reports: [capture_id, ...] }        these reports describe one incident (2 to 50 reports)
//   not_same_event   { report: capture_id, from: [...] }    this report is a different incident from those reports
//   assess_claim     { claim_id, assessment }              corroborated, confirmed, disputed, withdrawn, or unassessed (a reset)
//
// Store: data/decisions/deepsouth/<YYYY-MM-DD>/<HHMM>.ndjson, append-only, never pruned, written with tools/capture_lib.mjs write();
// index.json maps decision_id -> 1. decision_id is "dec-issue-<number>", so an issue is recorded once: editing it later changes
// nothing (a new decision needs a new issue, and a later decision on the same thing wins).
import crypto from "node:crypto";

export const SCHEMA = "osap-decision/1";
export const TITLE = "OSAP decision:";
export const ASSESSMENTS = ["corroborated", "confirmed", "disputed", "withdrawn", "unassessed"];
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const CAP = /^cap-[0-9a-f]{20}$/, CLM = /^clm-[0-9a-f]{20}$/;

// The fenced JSON block and the reason from an issue body. Returns { data, reason } or { why }.
export function readBody(body) {
  const b = String(body || "").slice(0, 20000);
  const m = b.match(/```json\s*\n([\s\S]*?)\n```/);
  if (!m) return { why: "no decision block (a fenced json block) in the issue" };
  let data; try { data = JSON.parse(m[1]); } catch (e) { return { why: "the decision block is not valid JSON" }; }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { why: "the decision block is not an object" };
  const r = b.match(/^Reason:[ \t]*(.*)$/im);
  const reason = r ? r[1].replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 500) : "";
  return { data, reason };
}

// Checks one decision against the rules and the stores. known: { captures: Set, claims: Set }. Returns { action, ... } or { why }.
export function check(data, known) {
  if (data.osap_decision !== 1) return { why: "not an OSAP decision (osap_decision must be 1)" };
  const ids = (a, re, set, what) => {
    if (!Array.isArray(a) || !a.every((x) => typeof x === "string" && re.test(x))) return what + " must be a list of ids";
    const u = [...new Set(a)];
    const miss = u.filter((x) => !set.has(x));
    return miss.length ? what + " not on file: " + miss.join(", ") : u;
  };
  if (data.action === "same_event") {
    const r = ids(data.reports, CAP, known.captures, "reports"); if (typeof r === "string") return { why: r };
    if (r.length < 2 || r.length > 50) return { why: "same_event needs 2 to 50 different reports" };
    return { action: "same_event", reports: r.sort() };
  }
  if (data.action === "not_same_event") {
    if (typeof data.report !== "string" || !CAP.test(data.report)) return { why: "report must be one report id" };
    if (!known.captures.has(data.report)) return { why: "report not on file: " + data.report };
    const f = ids(data.from, CAP, known.captures, "from"); if (typeof f === "string") return { why: f };
    const from = f.filter((x) => x !== data.report).sort();
    if (!from.length || from.length > 50) return { why: "not_same_event needs 1 to 50 other reports" };
    return { action: "not_same_event", report: data.report, from };
  }
  if (data.action === "assess_claim") {
    if (typeof data.claim_id !== "string" || !CLM.test(data.claim_id)) return { why: "claim_id must be one claim id" };
    if (!known.claims.has(data.claim_id)) return { why: "claim not on file: " + data.claim_id };
    if (!ASSESSMENTS.includes(data.assessment)) return { why: "assessment must be one of " + ASSESSMENTS.join(", ") };
    return { action: "assess_claim", claim_id: data.claim_id, assessment: data.assessment };
  }
  return { why: "unknown action (same_event, not_same_event or assess_claim)" };
}

// issues: the GitHub API's open issues. owner: the repository owner's login. index: the store's index. recorded: this run's time.
// Pure. Returns { records, index, replies: [{ number, recorded, text }] }: records to append, the new index, and what to tell each issue.
export function plan(issues, owner, known, index, recorded) {
  const records = [], next = { ...index }, replies = [];
  const mine = issues.filter((i) => !i.pull_request && String(i.title || "").startsWith(TITLE))
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.number - b.number));
  for (const i of mine) {
    const id = "dec-issue-" + i.number;
    // only the repository owner's own issues count; anyone else's are left alone (not answered, not closed)
    if (!i.user || String(i.user.login).toLowerCase() !== String(owner).toLowerCase()) continue;
    if (next[id]) { replies.push({ number: i.number, recorded: true, text: "Recorded earlier as " + id + "." }); continue; }
    const b = readBody(i.body);
    const c = b.why ? b : check(b.data, known);
    if (c.why) { replies.push({ number: i.number, recorded: false, text: "Not recorded: " + c.why + ". Nothing changed. Open a new decision from the app to try again." }); continue; }
    const { action, ...target } = c;
    records.push({ schema: SCHEMA, type: "decision", decision_id: id, action, ...target, reason: b.reason,
      actor: { login: i.user.login, authority: "repository owner (opened the decision issue)" },
      source: { issue: i.number, url: i.html_url, created_at: i.created_at, body_sha: sha(String(i.body || "")) },
      seen: b.data.seen && typeof b.data.seen === "object" ? { asof: String(b.data.seen.asof || "").slice(0, 20), status: String(b.data.seen.status || "").slice(0, 80) } : null,
      decided_at: i.created_at, recorded });
    next[id] = 1;
    replies.push({ number: i.number, recorded: true, text: "Recorded as " + id + " (" + action + "). It shows in the app after this refresh." });
  }
  return { records, index: next, replies };
}

// The decisions in force, in the order they were made (a later decision on the same thing wins). decisions: all decision records.
// Returns { groups: [{ group_id, reports, decisions }], apart(a, b) -> decision_id or null, assess: Map claim_id -> assessment, count }.
export function inForce(decisions) {
  const ds = [...decisions].filter((d) => d.type === "decision")
    .sort((a, b) => (a.decided_at < b.decided_at ? -1 : a.decided_at > b.decided_at ? 1 : a.decision_id < b.decision_id ? -1 : 1));
  const group = new Map(), made = new Map(), apart = new Map(), assess = new Map();
  const pair = (a, b, id) => { if (!apart.has(a)) apart.set(a, new Map()); if (id) apart.get(a).set(b, id); else apart.get(a).delete(b); };
  for (const d of ds) {
    if (d.action === "same_event") {
      // the listed reports, and every report already grouped with any of them, become one group; a split between them is undone
      const old = new Set(d.reports.map((r) => group.get(r)).filter(Boolean));
      const gid = [...old].sort()[0] || d.decision_id;
      for (const [r, g] of group) if (old.has(g)) group.set(r, gid);
      for (const r of d.reports) group.set(r, gid);
      made.set(gid, [...new Set([...[...old].flatMap((g) => made.get(g) || []), d.decision_id])]);
      for (const g of old) if (g !== gid) made.delete(g);
      for (const r of d.reports) for (const o of d.reports) if (o !== r) pair(r, o, null);
    } else if (d.action === "not_same_event") {
      if (d.from.some((f) => group.get(f) && group.get(f) === group.get(d.report))) group.delete(d.report);
      for (const f of d.from) { pair(d.report, f, d.decision_id); pair(f, d.report, d.decision_id); }
    } else if (d.action === "assess_claim") {
      if (d.assessment === "unassessed") assess.delete(d.claim_id);
      else assess.set(d.claim_id, { assessment: d.assessment, decision_id: d.decision_id, decided_at: d.decided_at, reason: d.reason || "" });
    }
  }
  const groups = new Map();
  for (const [r, g] of group) { if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); }
  return { groups: [...groups].filter(([, rs]) => rs.length > 1).map(([g, rs]) => ({ group_id: g, reports: rs.sort(), decisions: made.get(g) || [] })),
    apart: (a, b) => apart.get(a)?.get(b) || null, assess, count: ds.length };
}
