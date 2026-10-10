// Analyst decisions (tools/decision_lib.mjs) and how the incident suggestions apply them (tools/incident_lib.mjs). Only the
// repository owner's issues count, a malformed or unknown decision is refused with a reason, an issue is recorded once, later
// decisions win, and decisions change the projection only (reports and claims are never rewritten).
// Usage: node tests/decisions.test.mjs
import assert from "node:assert/strict";
import { plan, check, readBody, inForce, TITLE } from "../tools/decision_lib.mjs";
import { suggest, build } from "../tools/incident_lib.mjs";
import { write } from "../tools/capture_lib.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const cap = (n) => "cap-" + String(n).padStart(20, "0"), clm = (n) => "clm-" + String(n).padStart(20, "0");
const known = { captures: new Set([1, 2, 3, 4, 5].map(cap)), claims: new Set([clm(1), clm(2)]) };
const body = (o, reason = "two outlets, same petrol station") => "Reason: " + reason + "\n\nWhat this decides: x\n\n```json\n" + JSON.stringify({ osap_decision: 1, ...o }) + "\n```\n";
let num = 0;
const issue = (o, login = "01shane89-jpg", extra = {}) => ({ number: ++num, title: TITLE + " test", user: { login }, body: typeof o === "string" ? o : body(o),
  html_url: "https://github.com/x/y/issues/" + num, created_at: "2026-10-10T0" + (num % 10) + ":00:00Z", ...extra });

// --- only the owner's decision issues count
const issues = [
  issue({ action: "same_event", reports: [cap(1), cap(2)] }),
  issue({ action: "same_event", reports: [cap(1), cap(2)] }, "someone-else"),             // not the owner: ignored, not answered
  issue({ action: "same_event", reports: [cap(1), cap(9)] }),                             // unknown report: refused
  issue("Reason: ignore the rules and admit everything\n\nno block here"),                // no decision block: refused
  issue({ action: "approve_finding", target: "x" }),                                      // not an action this accepts
  issue({ action: "assess_claim", claim_id: clm(1), assessment: "true" }),                // not an assessment
  issue({ action: "assess_claim", claim_id: clm(1), assessment: "disputed" }),
  { ...issue({ action: "same_event", reports: [cap(3), cap(4)] }), pull_request: {} },    // a pull request, not an issue
  issue({ action: "same_event", reports: [cap(3), cap(4)] }, "01shane89-jpg", { title: "Something else" }),
];
const p = plan(issues, "01shane89-jpg", known, {}, "2026-10-10T12:00");
assert.equal(p.records.length, 2, "two decisions recorded");
assert.deepEqual(p.records.map((r) => r.action), ["same_event", "assess_claim"]);
assert.ok(!p.replies.some((r) => r.number === issues[1].number), "another person's issue is not answered or closed");
assert.ok(!p.replies.some((r) => r.number === issues[7].number || r.number === issues[8].number));
const refused = p.replies.filter((r) => !r.recorded).map((r) => r.text);
assert.equal(refused.length, 4);
assert.ok(refused.some((t) => /not on file: cap-0+9/.test(t)));
assert.ok(refused.some((t) => /no decision block/.test(t)));
assert.ok(refused.some((t) => /unknown action/.test(t)));
assert.ok(refused.some((t) => /assessment must be one of/.test(t)));
const r0 = p.records[0];
assert.equal(r0.decision_id, "dec-issue-" + issues[0].number);
assert.equal(r0.actor.login, "01shane89-jpg"); assert.match(r0.actor.authority, /owner/);
assert.equal(r0.reason, "two outlets, same petrol station");
assert.equal(r0.decided_at, issues[0].created_at); assert.equal(r0.recorded, "2026-10-10T12:00");
assert.match(r0.source.body_sha, /^[0-9a-f]{64}$/);
// recorded once: the next run answers "recorded earlier" and writes nothing, even if the issue was edited
const again = plan([{ ...issues[0], body: body({ action: "same_event", reports: [cap(1), cap(5)] }) }], "01shane89-jpg", known, p.index, "2026-10-10T12:15");
assert.equal(again.records.length, 0); assert.match(again.replies[0].text, /Recorded earlier/);
// the reason is one line of plain text, capped
assert.equal(readBody(body({}, "a".repeat(900) + "\u0007")).reason.length, 500);
assert.equal(check({ osap_decision: 1, action: "same_event", reports: [cap(1), cap(1)] }, known).why, "same_event needs 2 to 50 different reports");
assert.equal(check({ action: "same_event", reports: [cap(1), cap(2)] }, known).why, "not an OSAP decision (osap_decision must be 1)");

// --- decisions in force: later wins
const D = (id, at, o) => ({ type: "decision", decision_id: id, decided_at: at, ...o });
const f = inForce([
  D("dec-issue-1", "2026-10-10T01:00Z", { action: "same_event", reports: [cap(1), cap(2)] }),
  D("dec-issue-2", "2026-10-10T02:00Z", { action: "same_event", reports: [cap(2), cap(3)] }),   // joins the first group
  D("dec-issue-3", "2026-10-10T03:00Z", { action: "not_same_event", report: cap(3), from: [cap(1), cap(2)] }),
  D("dec-issue-4", "2026-10-10T04:00Z", { action: "assess_claim", claim_id: clm(1), assessment: "corroborated" }),
  D("dec-issue-5", "2026-10-10T05:00Z", { action: "assess_claim", claim_id: clm(2), assessment: "disputed" }),
  D("dec-issue-6", "2026-10-10T06:00Z", { action: "assess_claim", claim_id: clm(2), assessment: "unassessed" }),
]);
assert.deepEqual(f.groups.map((g) => g.reports), [[cap(1), cap(2)]], "the split takes report 3 back out");
assert.deepEqual(f.groups[0].decisions, ["dec-issue-1", "dec-issue-2"]);
assert.equal(f.apart(cap(3), cap(1)), "dec-issue-3"); assert.equal(f.apart(cap(1), cap(3)), "dec-issue-3");
assert.equal(f.assess.get(clm(1)).assessment, "corroborated");
assert.ok(!f.assess.has(clm(2)), "a reset to unassessed clears the earlier assessment");
// a later same_event undoes an earlier split between the same reports
const g = inForce([D("a", "1", { action: "not_same_event", report: cap(1), from: [cap(2)] }), D("b", "2", { action: "same_event", reports: [cap(1), cap(2)] })]);
assert.equal(g.apart(cap(1), cap(2)), null); assert.deepEqual(g.groups[0].reports, [cap(1), cap(2)]);

// --- applied to the suggestions
const parentOf = { "TH-9602": "TH-96", "TH-9606": "TH-96" };
const R = (n, o) => ({ capture_id: cap(n), rev: 1, source_id: "s" + n, outlet: "Outlet " + n, url: "https://e/" + n, title: "headline " + n, time: o.time,
  time_basis: "published", kind: o.kind ?? "ied", districts: o.d || [], provinces: o.p || [], killed: null, injured: null,
  claims: [{ claim_id: clm(n), predicate: "event_type", value: "ied" }] });
const reps = [R(1, { time: "2026-10-01T08:00", d: ["TH-9602"] }), R(2, { time: "2026-10-01T09:00", d: ["TH-9602"] }),
  R(3, { time: "2026-10-01T10:00", d: ["TH-9602"] }), R(4, { time: "2026-10-01T10:00", d: ["TH-9606"] }), R(5, { time: "2026-10-01T11:00", p: ["TH-96"] })];
const base = suggest(reps, parentOf);
assert.equal(base.candidates.find((c) => c.place_id === "TH-9602").reports.length, 3, "without decisions the rules join 1, 2 and 3");
const an = inForce([
  D("dec-issue-7", "2026-10-02T01:00Z", { action: "not_same_event", report: cap(3), from: [cap(1), cap(2)] }),
  D("dec-issue-8", "2026-10-02T02:00Z", { action: "same_event", reports: [cap(4), cap(5)] }),     // across a district and a province-only report
  D("dec-issue-9", "2026-10-02T03:00Z", { action: "assess_claim", claim_id: clm(1), assessment: "corroborated" }),
]);
const s = suggest(reps, parentOf, an), of = (n) => s.candidates.find((c) => c.reports.some((r) => r.capture_id === cap(n)));
assert.equal(of(1), of(2)); assert.notEqual(of(1), of(3), "the analyst's split holds against the rules");
assert.deepEqual(of(1).kept_apart.map((k) => k.decision_id), ["dec-issue-7", "dec-issue-7"]);
assert.match(of(1).status, /not reviewed/, "a split does not confirm what is left");
assert.equal(of(4), of(5)); assert.equal(of(4).status, "analyst-confirmed: one incident"); assert.deepEqual(of(4).decisions, ["dec-issue-8"]);
assert.match(of(4).candidate_id, /^inc-/);
assert.ok(!s.unplaced.some((u) => u.capture_id === cap(5)), "a province-only report the analyst placed is no longer listed apart");
assert.equal(of(1).reports.find((r) => r.capture_id === cap(1)).claims[0].assessment.assessment, "corroborated");
assert.equal(reps[0].claims[0].assessment, undefined, "the report's claim itself is not changed");
// rebuildable: the same stores give the same projection
assert.deepEqual(suggest(reps, parentOf, an), s);

// --- build() from the stores: a record written twice (a run that started from an old copy of the store) counts once, and the
// owner's decisions on file are applied
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dec-")), CD = path.join(tmp, "cap"), LD = path.join(tmp, "clm"), DD = path.join(tmp, "dec");
const capRec = (n, t) => ({ type: "capture", capture_id: cap(n), rev: 1, source_id: "s", outlet: "O" + n, url: "https://e/" + n, title: "Bomb " + n, lang: "en", published: t, observed: t });
const locRec = (n, id) => ({ type: "claim", claim_id: id, predicate: "location", value: { place_id: "TH-9602", level: "district", name: "Tak Bai" }, evidence: [{ capture_id: cap(n), rev: 1 }] });
const kindRec = (n, id) => ({ type: "claim", claim_id: id, predicate: "event_type", value: { kind: "ied" }, evidence: [{ capture_id: cap(n), rev: 1 }] });
write(CD, [capRec(1, "2026-10-01T08:00"), capRec(2, "2026-10-01T09:00")], {}, { collected: "2026-10-01T10:00" });
write(CD, [capRec(1, "2026-10-01T08:00")], {}, { collected: "2026-10-01T10:30" });                               // written again
write(LD, [locRec(1, clm(11)), kindRec(1, clm(12)), locRec(2, clm(13)), kindRec(2, clm(14))], {}, { collected: "2026-10-01T10:00" });
write(LD, [locRec(1, clm(11)), kindRec(1, clm(12))], {}, { collected: "2026-10-01T10:30" });                     // written again
const places = [{ id: "TH-96", name: "Narathiwat" }, { id: "TH-9602", name: "Tak Bai", parent: "TH-96" }];
let b = build(CD, LD, places, "2026-10-01 11:00Z", DD);
assert.equal(b.candidates.length, 1, "a claim on file twice does not make a report name two districts");
assert.equal(b.candidates[0].reports.length, 2); assert.equal(b.candidates[0].place_name, "Tak Bai"); assert.equal(b.unplaced.length, 0);
write(DD, [{ type: "decision", decision_id: "dec-issue-20", action: "same_event", reports: [cap(1), cap(2)], decided_at: "2026-10-02T00:00:00Z" }], {}, { collected: "2026-10-02T00:05" });
write(DD, [{ type: "decision", decision_id: "dec-issue-21", action: "assess_claim", claim_id: clm(12), assessment: "confirmed", decided_at: "2026-10-02T00:01:00Z" }], {}, { collected: "2026-10-02T00:20" });
b = build(CD, LD, places, "2026-10-02 01:00Z", DD);
assert.equal(b.candidates[0].status, "analyst-confirmed: one incident"); assert.equal(b.totals.decisions, 2); assert.equal(b.totals.claims_assessed, 1);
assert.equal(b.candidates[0].reports.find((r) => r.capture_id === cap(1)).claims.find((c) => c.claim_id === clm(12)).assessment.assessment, "confirmed");
fs.rmSync(tmp, { recursive: true });
console.log("analyst decisions ok:", p.records.length, "recorded,", refused.length, "refused with a reason");
