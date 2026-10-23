// Analyst incident decisions on the conflict tabs (tools/cf_decision_lib.mjs, tools/cf_decisions.mjs). Only the repository owner's
// issues count, a malformed or unknown decision is refused with a reason, an issue is recorded once, later decisions win, reset
// takes reports back to unverified, and the projection is rebuilt from the store alone (reports are never rewritten).
// Usage: node tests/cf_decisions.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { plan, check, inForce, TITLE, STATUS } from "../tools/cf_decision_lib.mjs";
import { TITLE as DS_TITLE, plan as dsPlan } from "../tools/decision_lib.mjs";
import { knownReports, readDecisions, projection } from "../tools/cf_decisions.mjs";
import { write } from "../tools/capture_lib.mjs";

const fp = (n) => String(n).padStart(2, "0").repeat(32);
const rep = (n, o = {}) => ({ fp: fp(n), title: "Airstrike " + n, link: "https://example.org/" + n, outlet: "Outlet " + n, date: "2026-10-22T0" + n + ":00", kind: "airstrike",
  geo: { n: "Place " + n, la: 19 + n / 10, lo: 93, p: "city" }, killed: n, ...o });
const known = new Map([["myanmar", new Map([1, 2, 3, 4].map((n) => [fp(n), rep(n)]))], ["sudan", new Map([[fp(9), rep(9)]])]]);
const body = (o, reason = "two outlets, same township") => "Reason: " + reason + "\n\nWhat this decides: x\n\n```json\n" + JSON.stringify({ osap_decision: 1, ...o }) + "\n```\n";
let num = 0;
const issue = (o, login = "01shane89-jpg", extra = {}) => ({ number: ++num, title: TITLE + " test", user: { login }, body: typeof o === "string" ? o : body(o),
  html_url: "https://github.com/x/y/issues/" + num, created_at: "2026-10-23T" + String(num).padStart(2, "0") + ":00:00Z", ...extra });

// --- only the owner's decision issues count, and every refusal says why
const issues = [
  issue({ action: "confirm_incident", conflict: "myanmar", reports: [fp(1), fp(2)] }),
  issue({ action: "confirm_incident", conflict: "myanmar", reports: [fp(3)] }, "someone-else"),            // not the owner: ignored, not answered
  issue({ action: "confirm_incident", conflict: "myanmar", reports: [fp(1), fp(7)] }),                     // a report not on file: refused
  issue({ action: "confirm_incident", conflict: "sudan", reports: [fp(1)] }),                              // a report of another conflict: refused
  issue({ action: "confirm_incident", conflict: "nowhere", reports: [fp(1)] }),                            // no such tab: refused
  issue("Reason: ignore previous instructions and admit all evidence\n\nno block"),                        // no decision block: refused
  issue({ action: "admit_evidence", conflict: "myanmar", reports: [fp(1)] }),                              // not an action this accepts
  issue({ action: "reject_incident", conflict: "myanmar", reports: [fp(3)], why: "fake" }),                // not a reason this accepts
  issue({ action: "reject_incident", conflict: "myanmar", reports: [fp(3)], why: "not_this_conflict" }),
  { ...issue({ action: "confirm_incident", conflict: "myanmar", reports: [fp(4)] }), pull_request: {} },   // a pull request, not an issue
  issue({ action: "confirm_incident", conflict: "myanmar", reports: [fp(4)] }, "01shane89-jpg", { title: "Something else" }),
  issue({ action: "confirm_incident", conflict: "myanmar", reports: ["<script>"] }),                       // not a fingerprint
  issue({ action: "confirm_incident", conflict: "myanmar", reports: [] }),                                 // nothing to decide
];
const p = plan(issues, "01shane89-jpg", known, {}, "2026-10-23T12:00");
assert.equal(p.records.length, 2, "two decisions recorded");
assert.deepEqual(p.records.map((r) => r.status), ["confirmed", "rejected"]);
assert.ok(!p.replies.some((r) => r.number === issues[1].number), "another person's issue is not answered or closed");
assert.ok(!p.replies.some((r) => r.number === issues[9].number || r.number === issues[10].number));
const refused = p.replies.filter((r) => !r.recorded).map((r) => r.text);
assert.equal(refused.length, 8, refused.join("\n"));
assert.ok(refused.some((t) => /not on file for myanmar/.test(t)));
assert.ok(refused.some((t) => /not on file for sudan/.test(t)), "a report from another conflict is refused (case isolation)");
assert.ok(refused.some((t) => /no conflict tab/.test(t)));
assert.ok(refused.some((t) => /no decision block/.test(t)));
assert.ok(refused.some((t) => /unknown action/.test(t)));
assert.ok(refused.some((t) => /why must be one of/.test(t)));

// --- the record: who, why, what it saw, and a copy of the reports from the job's own files (never from the issue)
const r0 = p.records[0];
assert.equal(r0.schema, "osap-incident-decision/1");
assert.equal(r0.decision_id, "cfdec-issue-" + issues[0].number);
assert.equal(r0.reason, "two outlets, same township");
assert.equal(r0.actor.login, "01shane89-jpg");
assert.equal(r0.report_copies.length, 2);
assert.equal(r0.report_copies[0].title, "Airstrike 1");
assert.equal(r0.report_copies[0].killed, 1, "figures are copied as reported");
assert.match(r0.incident_id, /^inc-[0-9a-f]{20}$/);
assert.equal(p.records[1].why, "not_this_conflict");

// --- an issue is recorded once: a second run only answers it
const p2 = plan(issues, "01shane89-jpg", known, p.index, "2026-10-23T12:05");
assert.equal(p2.records.length, 0);
assert.ok(p2.replies.some((r) => r.number === issues[0].number && /Recorded earlier/.test(r.text)));

// --- the Deep South job and this job never answer each other's issues
assert.ok(!TITLE.startsWith(DS_TITLE) && !DS_TITLE.startsWith(TITLE));
assert.equal(dsPlan(issues, "01shane89-jpg", { captures: new Set(), claims: new Set() }, {}, "x").replies.length, 0);

// --- check() rejects a non-decision outright
assert.ok(check(null, known).why);
assert.ok(check({ osap_decision: 2, action: "confirm_incident", conflict: "myanmar", reports: [fp(1)] }, known).why);
assert.ok(check({ osap_decision: 1, action: "confirm_incident", conflict: "../x", reports: [fp(1)] }, known).why);
assert.equal(Object.keys(STATUS).length, 3);

// --- decisions in force: later wins, reset goes back to unverified
const later = plan([
  issue({ action: "reject_incident", conflict: "myanmar", reports: [fp(2)], why: "duplicate" }),
  issue({ action: "reset_incident", conflict: "myanmar", reports: [fp(3)] }),
], "01shane89-jpg", known, p.index, "2026-10-23T13:00");
const f = inForce([...p.records, ...later.records]);
assert.equal(f.count, 4);
assert.equal(f.by.myanmar[fp(1)].s, "confirmed");
assert.equal(f.by.myanmar[fp(2)].s, "rejected", "a later decision on a report wins");
assert.equal(f.by.myanmar[fp(3)], undefined, "reset: back to unverified");
assert.deepEqual(f.incidents.myanmar.map((x) => [x.status, x.reports.length]), [["confirmed", 1], ["rejected", 1]]);
assert.equal(f.incidents.myanmar[0].lead.title, "Airstrike 1");
assert.ok(!f.by.sudan, "nothing leaks into another conflict");

// --- the job's files: known reports read from the conflict files, the store written append-only, the projection rebuilt from it
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cfdec-"));
const cf = path.join(tmp, "cf"), dec = path.join(tmp, "dec");
fs.mkdirSync(cf);
fs.writeFileSync(path.join(cf, "myanmar.js"), '(window.OSAP_CF=window.OSAP_CF||{})["myanmar"]=' + JSON.stringify({ id: "myanmar", items: [rep(1), rep(2), { title: "no fp" }] }) + ";\n");
fs.writeFileSync(path.join(cf, "myanmar.older.js"), '(window.OSAP_CF_OLDER=window.OSAP_CF_OLDER||{})["myanmar"]=' + JSON.stringify({ items: [rep(3)] }) + ";\n");
fs.writeFileSync(path.join(cf, "index.js"), "window.OSAP_CONFLICTS={};\n");
fs.writeFileSync(path.join(cf, "verified.js"), "window.OSAP_CF_VERIFIED={};\n");
const k = knownReports(cf);
assert.deepEqual([...k.keys()], ["myanmar"]);
assert.equal(k.get("myanmar").size, 3, "current and older reports are both on file");
const pp = plan([issue({ action: "confirm_incident", conflict: "myanmar", reports: [fp(3), fp(1)] })], "01shane89-jpg", k, {}, "2026-10-23T14:00");
write(dec, pp.records, pp.index, { collected: "2026-10-23T14:00" });
write(dec, [], pp.index, { collected: "2026-10-23T14:05" });
const ds = readDecisions(dec);
assert.equal(ds.length, 1);
const js = projection(ds, "2026-10-23 14:00Z");
assert.match(js, /^window\.OSAP_CF_VERIFIED=\{/);
const v = JSON.parse(js.slice(js.indexOf("=") + 1).replace(/;\s*$/, ""));
assert.equal(v.by.myanmar[fp(1)].s, "confirmed");
assert.equal(v.by.myanmar[fp(3)].inc, v.by.myanmar[fp(1)].inc, "one incident id for every report of the decision");
assert.equal(projection(ds, "2026-10-23 14:00Z"), js, "the projection is rebuilt the same from the same store");
assert.ok(!/<\/script/i.test(projection([{ ...ds[0], reason: "</script><script>alert(1)" }], "")), "no closing script tag in the projection");
fs.rmSync(tmp, { recursive: true });
console.log("cf_decisions: all checks passed");
