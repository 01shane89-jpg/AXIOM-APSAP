// Links between live reports and UCDP-coded events (assets/osap-cf-match.js, tools/cf_decision_lib.mjs link actions). The page only
// proposes, by fixed rules (close in place and time); nothing is linked until the repository owner decides "Same event" or "Not the
// same"; the event must be one the job holds, with the same fingerprint; a later decision replaces an earlier one; unlink takes it
// back; and the incident decisions (confirm / reject) are untouched by any of it. Usage: node tests/cf_match.test.mjs
import assert from "node:assert/strict";
import MATCH from "../assets/osap-cf-match.js";
import { plan, check, inForce, linksInForce, LINK_SCHEMA } from "../tools/cf_decision_lib.mjs";
import { projection } from "../tools/cf_decisions.mjs";

const fp = (n) => String(n).padStart(2, "0").repeat(32);
const rep = (n, o = {}) => ({ fp: fp(n), title_en: "Rebels attack Katwiguru village, two killed", date: "2026-09-30T14:00", kind: "ground",
  geo: { n: "Katwiguru", la: -0.99, lo: 29.45, p: "" }, killed: 2, ...o });
const ev = (id, o = {}) => ({ id: String(id), fp: String(id % 10).repeat(64), date: "2026-09-30", end: "2026-10-01", lat: -0.99174, lon: 29.44687, prec: 2, type: 3, best: 2, low: 2, high: 2,
  sideA: "FDLR-FOCA", sideB: "Civilians", where: "Katwiguru, Rutshuru", headline: "Rutshuru: Two dead during an FDLR incursion in Katwiguru", ...o });

// --- the proposal rules
assert.ok(MATCH.km(0, 0, 0, 1) > 110 && MATCH.km(0, 0, 0, 1) < 112, "one degree of longitude at the equator is about 111 km");
assert.equal(MATCH.gap(rep(1), ev(1)), 0, "inside UCDP's dates");
assert.equal(MATCH.gap(rep(1, { date: "2026-10-03T08:00" }), ev(1)), 2, "two days after UCDP's end date");
assert.equal(MATCH.radius(rep(1), ev(1)), 25); assert.equal(MATCH.radius(rep(1, { geo: { la: 0, lo: 0, p: "province" } }), ev(1)), 60);
assert.equal(MATCH.radius(rep(1), ev(1, { prec: 3 })), 60); assert.equal(MATCH.radius(rep(1), ev(1, { prec: 4 })), 120); assert.equal(MATCH.radius(rep(1), ev(1, { prec: 6 })), 0);
assert.ok(MATCH.pair(rep(1), ev(1)), "same place, same day");
assert.equal(MATCH.pair(rep(1, { date: "2026-10-04T08:00" }), ev(1)), null, "three days after: no");
assert.equal(MATCH.pair(rep(1, { geo: { la: -0.6, lo: 29.45 } }), ev(1)), null, "43 km away from a town-placed event: no");
assert.ok(MATCH.pair(rep(1, { geo: { la: -0.6, lo: 29.45 } }), ev(1, { prec: 3 })), "43 km from an event placed to a district: yes");
assert.equal(MATCH.pair(rep(1, { geo: null }), ev(1)), null, "a report with no pin is never proposed");
for (const k of ["legal", "talks", "humanitarian", "statement"]) assert.equal(MATCH.pair(rep(1, { kind: k }), ev(1)), null, k + " reports are never proposed");
assert.equal(MATCH.pair(rep(1), ev(1, { prec: 6 })), null, "an event UCDP placed only to the country is never proposed");
const far = ev(2, { lat: -0.85, lon: 29.45 }), late = ev(3, { date: "2026-09-28", end: "2026-09-28" }), none = ev(4, { lat: 5, lon: 5 });
const props = MATCH.propose([rep(1), rep(2, { geo: { la: -0.86, lo: 29.45 }, killed: null })], [none, late, far, ev(1)]);
assert.deepEqual(props.map((p) => p.ev.id), ["1", "2", "3"], "best first, never more than three: " + JSON.stringify(props.map((p) => [p.ev.id, p.km, p.days])));
assert.equal(props[1].fp, fp(2), "a proposal names the incident's closest report");
assert.ok(props[0].hints.includes("deaths agree") && props[0].hints.some((h) => /katwiguru/.test(h)), "hints: " + props[0].hints.join("; "));
assert.equal(props[0].rules, "match-v1");

// --- the decision: only an event the job holds, with the same fingerprint
const known = new Map([["drc-east", new Map([1, 2].map((n) => [fp(n), rep(n)]))]]);
const ucdp = { "drc-east": new Map([["1", ev(1)], ["2", far]]) };
const ok = (o) => check({ osap_decision: 1, conflict: "drc-east", reports: [fp(1)], ...o }, known, {}, ucdp);
assert.equal(ok({ action: "link_coded", coded: { dataset: "ucdp", id: "1", fp: ev(1).fp } }).coded.id, "1");
assert.match(ok({ action: "link_coded", coded: { dataset: "ucdp", id: "9", fp: ev(9).fp } }).why, /not on file/);
assert.match(ok({ action: "link_coded", coded: { dataset: "ucdp", id: "1", fp: "a".repeat(64) } }).why, /changed since/);
assert.match(ok({ action: "link_coded", coded: { dataset: "mm_protest", id: "1", fp: ev(1).fp } }).why, /UCDP event/);
assert.match(ok({ action: "link_coded" }).why, /UCDP event/);
assert.match(ok({ action: "link_coded", coded: { dataset: "ucdp", id: "1", fp: ev(1).fp }, coding: {} }).why, /no coded record/);
assert.match(ok({ action: "merge_entities", coded: { dataset: "ucdp", id: "1", fp: ev(1).fp } }).why, /unknown action/);

let num = 0;
const body = (o, reason) => "Reason: " + reason + "\n\n```json\n" + JSON.stringify({ osap_decision: 1, conflict: "drc-east", ...o }) + "\n```\n";
const issue = (o, reason = "same village, same day, same toll", login = "01shane89-jpg") => ({ number: ++num, title: "OSAP incident decision: link", user: { login }, body: body(o, reason),
  html_url: "https://github.com/x/y/issues/" + num, created_at: "2026-10-23T" + String(num).padStart(2, "0") + ":00:00Z" });
const c1 = { dataset: "ucdp", id: "1", fp: ev(1).fp }, c2 = { dataset: "ucdp", id: "2", fp: far.fp };
const iss = [
  issue({ action: "link_coded", reports: [fp(1), fp(2)], coded: c1 }),
  issue({ action: "reject_link", reports: [fp(1)], coded: c2 }, "different attack, other village"),
  issue({ action: "link_coded", reports: [fp(1)], coded: c1 }, "x", "someone-else"),                     // not the owner: ignored
  issue({ action: "link_coded", reports: [fp(1)], coded: { dataset: "ucdp", id: "1", fp: "b".repeat(64) } }), // refused
  issue({ action: "confirm_incident", reports: [fp(1), fp(2)] }),
];
const p = plan(iss, "01shane89-jpg", known, {}, "2026-10-23T12:00", { ucdp });
const links = p.records.filter((r) => r.type === "link");
assert.equal(links.length, 2); assert.equal(p.records.length, 3, "two links and one incident confirmation recorded");
const L = links[0];
assert.equal(L.schema, LINK_SCHEMA); assert.equal(L.status, "same_event"); assert.equal(L.actor.login, "01shane89-jpg"); assert.equal(L.reason, "same village, same day, same toll");
assert.equal(L.coded_copy.id, "1"); assert.equal(L.coded_copy.sideA, "FDLR-FOCA"); assert.equal(L.report_copies.length, 2);
assert.equal(L.measure.within_rules, true); assert.equal(L.measure.closest.fp, fp(1)); assert.ok(L.measure.closest.km < 1);
assert.equal(links[1].status, "not_same"); assert.equal(links[1].measure.within_rules, true, "the analyst may still say no to a pair the rules propose");
assert.ok(p.replies.some((r) => !r.recorded && /changed since/.test(r.text)));
assert.equal(p.replies.length, 4, "the other user's issue is not answered");

// --- in force: links apart from incident decisions; later wins; unlink takes back
const after = plan([issue({ action: "unlink_coded", reports: [fp(2)], coded: c1 }, "second report was a different day")], "01shane89-jpg", known, p.index, "2026-10-23T13:00", { ucdp });
const all = p.records.concat(after.records);
const lf = linksInForce(all);
assert.deepEqual(lf["drc-east"][fp(1)].map((x) => [x.id, x.s]).sort(), [["1", "same_event"], ["2", "not_same"]]);
assert.equal(lf["drc-east"][fp(2)], undefined, "unlinked: report 2 carries no link");
const inc = inForce(all);
assert.equal(inc.by["drc-east"][fp(1)].s, "confirmed", "the incident confirmation stands"); assert.equal(inc.count, 1, "links are not incident decisions");
assert.ok(/"links":\{"drc-east"/.test(projection(all, "x")), "the page's projection carries the links");
assert.deepEqual(linksInForce(plan([issue({ action: "unlink_coded", reports: [fp(1)], coded: c1 }), issue({ action: "unlink_coded", reports: [fp(1)], coded: c2 })], "01shane89-jpg", known, {}, "x", { ucdp }).records.concat([])), {}, "unlink with nothing before: nothing");
console.log("cf_match: all checks passed");
