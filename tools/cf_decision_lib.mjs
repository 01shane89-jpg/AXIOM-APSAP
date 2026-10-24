// Analyst incident decisions for the conflict tabs: the record of an analyst confirming or rejecting a machine-grouped incident
// (reports the page groups as one incident: same kind and place within 36 hours, or near-identical headlines). Every incident starts
// unverified; only a person changes that, and this file only reads, checks and stores what they decided. It never decides.
//
// Where decisions come from: a GitHub issue the repository owner opens from a conflict tab's review queue (assets/osap-conflicts.js).
// The page fills the issue in; the owner adds a reason and submits it. tools/cf_decisions.mjs (workflow record-incident-decisions.yml,
// run when an issue is opened, so a decision shows within a minute or two) reads open issues, keeps only the owner's, checks each
// against the rules below and the conflict report files, and writes one decision record per accepted issue. Every issue it read is
// then answered and closed (tools/decisions_close.mjs). The issue text is untrusted: only the fenced JSON block and the "Reason:"
// line are read, both checked field by field. A different title from the Deep South decisions (tools/decision_lib.mjs), so neither
// job answers the other's issues.
//
// Actions (reports are the reports' SHA-256 fingerprints, as listed on the tab):
//   confirm_incident  { conflict, reports: [fp, ...] }        these reports describe one real incident (1 to 50 reports)
//   reject_incident   { conflict, reports: [fp, ...], why }   not an incident of this conflict; why: not_incident, not_this_conflict,
//                                                             wrong_place_or_time, duplicate or other
//   reset_incident    { conflict, reports: [fp, ...] }        back to unverified (undoes an earlier decision on these reports)
// A confirmation says the reports describe a real incident. It does not make any figure, party or claim in them true: casualty figures
// stay "as reported", and statements by any party stay claims.
// A confirmation may carry the incident's coded record ("coding", checked by checkCoding() in assets/osap-cf-code.js): event type and
// sub-event type, two actors with what each attribution rests on, the place with its precision (1 to 3), and the fatalities one of the
// incident's reports gives, cited by that report. The page offers rule and AI suggestions for each field; the analyst ticks every field
// before the issue opens, and a coding with a field left unticked is refused. The record keeps what the analyst was shown for each
// field and whether they accepted or changed it, plus the AI suggestions on file for the reports (data/live/conflicts/suggest.js,
// copied from the job's own file, never from the issue), so it can always be told what the AI proposed and what the analyst decided.
//
// Store: data/decisions/conflicts/<YYYY-MM-DD>/<HHMM>.ndjson, append-only, never pruned (tools/capture_lib.mjs write());
// index.json maps decision_id -> 1. decision_id is "cfdec-issue-<number>", so an issue is recorded once. Each record keeps a copy of
// the reports as they stood when the decision was recorded (from the job's own files, never from the issue), so the decision still
// reads correctly after the reports age out of the tab.
import crypto from "node:crypto";
import { readBody } from "./decision_lib.mjs";
import CODE from "../assets/osap-cf-code.js";

export const SCHEMA = "osap-incident-decision/1";
export const TITLE = "OSAP incident decision:";
export const WHY = ["not_incident", "not_this_conflict", "wrong_place_or_time", "duplicate", "other"];
export const STATUS = { confirm_incident: "confirmed", reject_incident: "rejected", reset_incident: "unverified" };
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const FP = /^[0-9a-f]{64}$/, CF = /^[a-z0-9][a-z0-9-]{0,60}$/;
export { readBody };

// known: Map conflict id -> Map fp -> report (the job's own records). parties: { conflict id: [party names] }.
// Returns { action, conflict, reports, why?, coding? } or { why }.
export function check(data, known, parties = {}) {
  if (!data || data.osap_decision !== 1) return { why: "not an OSAP decision (osap_decision must be 1)" };
  if (!STATUS[data.action]) return { why: "unknown action (confirm_incident, reject_incident or reset_incident)" };
  if (typeof data.conflict !== "string" || !CF.test(data.conflict)) return { why: "conflict must be a conflict id" };
  const reps = known.get(data.conflict);
  if (!reps) return { why: "no conflict tab with the id " + data.conflict };
  if (!Array.isArray(data.reports) || !data.reports.every((x) => typeof x === "string" && FP.test(x))) return { why: "reports must be a list of report fingerprints" };
  const r = [...new Set(data.reports)];
  if (r.length < 1 || r.length > 50) return { why: "an incident needs 1 to 50 reports" };
  const miss = r.filter((x) => !reps.has(x));
  if (miss.length) return { why: "reports not on file for " + data.conflict + ": " + miss.map((x) => x.slice(0, 16)).join(", ") };
  const out = { action: data.action, conflict: data.conflict, reports: r.sort() };
  if (data.action === "reject_incident") {
    if (data.why != null && !WHY.includes(data.why)) return { why: "why must be one of " + WHY.join(", ") };
    out.why = data.why || "other";
  }
  if (data.coding != null) {
    if (data.action !== "confirm_incident") return { why: "only a confirmation carries a coded record" };
    const c = CODE.checkCoding(data.coding, new Map(r.map((x) => [x, reps.get(x)])), parties[data.conflict] || []);
    if (!c.coding) return { why: "coded record: " + c.why };
    out.coding = c.coding;
  }
  return out;
}

// What a record keeps of each report: the fields the tab shows, copied from the job's file.
function snap(i) {
  const o = { fp: i.fp, title: String(i.title_en || i.title || "").slice(0, 300), link: /^https?:\/\//.test(i.link || "") ? i.link : "", outlet: String(i.outlet || "").slice(0, 120),
    date: String(i.date || "").slice(0, 20), kind: i.kind || null };
  if (i.geo && i.geo.la != null) o.geo = { n: String(i.geo.n || "").slice(0, 120), la: +i.geo.la, lo: +i.geo.lo, p: i.geo.p || null };
  if (i.killed != null) o.killed = i.killed;
  if (i.injured != null) o.injured = i.injured;
  return o;
}

// issues: the GitHub API's open issues. owner: the repository owner's login. known: see check(). index: the store's index.
// Pure. Returns { records, index, replies: [{ number, recorded, text }] }.
// ctx: { parties: { conflict: [names] }, suggest: the AI suggestion file's object (data/live/conflicts/suggest.js) }.
export function plan(issues, owner, known, index, recorded, ctx = {}) {
  const records = [], next = { ...index }, replies = [];
  const mine = issues.filter((i) => !i.pull_request && String(i.title || "").startsWith(TITLE))
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.number - b.number));
  for (const i of mine) {
    const id = "cfdec-issue-" + i.number;
    // only the repository owner's own issues count; anyone else's are left alone (not answered, not closed)
    if (!i.user || String(i.user.login).toLowerCase() !== String(owner).toLowerCase()) continue;
    if (next[id]) { replies.push({ number: i.number, recorded: true, text: "Recorded earlier as " + id + "." }); continue; }
    const b = readBody(i.body);
    const c = b.why ? b : check(b.data, known, ctx.parties || {});
    if (!c.action) { replies.push({ number: i.number, recorded: false, text: "Not recorded: " + c.why + ". Nothing changed. Open a new decision from the app to try again." }); continue; }
    const reps = known.get(c.conflict);
    records.push({ schema: SCHEMA, type: "decision", decision_id: id, action: c.action, status: STATUS[c.action], conflict: c.conflict, reports: c.reports,
      ...(c.why ? { why: c.why } : {}), reason: b.reason,
      ...(c.coding ? { record: c.coding, ai_suggestions: aiOnFile(ctx.suggest, c.conflict, c.reports) } : {}),
      incident_id: "inc-" + sha(c.conflict + "|" + c.reports.join(",")).slice(0, 20),
      report_copies: c.reports.map((fp) => snap(reps.get(fp))),
      actor: { login: i.user.login, authority: "repository owner (opened the decision issue)" },
      source: { issue: i.number, url: i.html_url, created_at: i.created_at, body_sha: sha(String(i.body || "")) },
      seen: b.data.seen && typeof b.data.seen === "object" ? { asof: String(b.data.seen.asof || "").slice(0, 20), status: String(b.data.seen.status || "").slice(0, 40) } : null,
      decided_at: i.created_at, recorded });
    next[id] = 1;
    replies.push({ number: i.number, recorded: true, text: "Recorded as " + id + " (" + STATUS[c.action] + "). It shows in the app within a few minutes." });
  }
  return { records, index: next, replies };
}

// the AI suggestions the job holds for these reports, as they stood when the decision was recorded (proposals, never the record)
function aiOnFile(sug, conflict, reports) {
  const m = sug && sug.by && sug.by[conflict], out = [];
  if (!m) return out;
  for (const fp of reports) if (m[fp]) out.push({ fp, provider: String(m[fp].p || ""), model: String(m[fp].m || "").slice(0, 120), prompt: String(sug.pv || ""), at: String(m[fp].at || ""), fields: m[fp].f || {} });
  return out;
}

// The decisions in force, in the order they were made: a later decision on a report replaces an earlier one, and reset takes the
// report back to unverified. Returns the projection the page reads: { by: { conflict: { fp: { s, inc, d, at, why, r } } },
// incidents: { conflict: [{ incident_id, status, reports, decision_id, decided_at, reason, why, lead }] }, count }.
export function inForce(decisions) {
  const ds = decisions.filter((d) => d && d.type === "decision" && d.schema === SCHEMA)
    .sort((a, b) => (a.decided_at < b.decided_at ? -1 : a.decided_at > b.decided_at ? 1 : a.decision_id < b.decision_id ? -1 : 1));
  const by = {};
  for (const d of ds) {
    const m = by[d.conflict] || (by[d.conflict] = {});
    for (const fp of d.reports) {
      if (d.status === "unverified") delete m[fp];
      else m[fp] = { s: d.status, inc: d.incident_id, d: d.decision_id, at: d.decided_at, ...(d.why ? { why: d.why } : {}), r: String(d.reason || "").slice(0, 300) };
    }
  }
  // an incident is listed while at least one of its reports still carries its decision
  const incidents = {};
  for (const d of ds) {
    if (d.status === "unverified") continue;
    const m = by[d.conflict] || {}, live = d.reports.filter((fp) => m[fp] && m[fp].d === d.decision_id);
    if (!live.length) continue;
    const copies = (d.report_copies || []).filter((c) => live.includes(c.fp));
    const lead = copies.find((c) => c.geo) || copies[0] || null;
    (incidents[d.conflict] || (incidents[d.conflict] = [])).push({ incident_id: d.incident_id, status: d.status, reports: live, decision_id: d.decision_id,
      decided_at: d.decided_at, reason: d.reason || "", ...(d.why ? { why: d.why } : {}), ...(d.record ? { record: d.record } : {}), lead });
  }
  return { by, incidents, count: ds.length };
}
