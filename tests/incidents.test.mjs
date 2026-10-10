// Incident candidates: labelled pilot cases. Copies are one originator, nearby events in other districts or outside the window stay
// apart, a province-only report is listed rather than joined, differing figures stay visible, nothing is called confirmed.
import assert from "node:assert/strict";
import { suggest, headKey, reports } from "../tools/incident_lib.mjs";

const parentOf = { "TH-9606": "TH-96", "TH-9602": "TH-96", "TH-9403": "TH-94" };
let n = 0;
const R = (o) => ({ capture_id: "cap-" + ++n, rev: 1, source_id: "s" + n, outlet: o.outlet || "Outlet " + n, url: "https://e/" + n, title: o.title || "headline " + n,
  time: o.time, time_basis: "published", kind: o.kind ?? "ied", districts: o.d || [], provinces: o.p || [], killed: o.killed ?? null, injured: o.injured ?? null, ...o.extra });

const a1 = R({ time: "2026-10-01T08:00", d: ["TH-9602"], title: "Bomb at Tak Bai petrol station - Thai PBS", injured: 2 });
const a2 = R({ time: "2026-10-01T09:00", d: ["TH-9602"], title: "Bomb at Tak Bai petrol station | Bangkok Post", injured: 2 });    // a copy
const a3 = R({ time: "2026-10-01T20:00", d: ["TH-9602"], title: "Two hurt in petrol station blast", injured: 3 });                   // independent, other figure
const b1 = R({ time: "2026-10-01T10:00", d: ["TH-9606"], title: "Bomb in Rueso" });                                                 // nearby district: separate
const a4 = R({ time: "2026-10-04T08:00", d: ["TH-9602"], title: "New bomb in Tak Bai" });                                           // same district, 3 days later
const c1 = R({ time: "2026-10-01T12:00", d: ["TH-9602"], kind: "arson", title: "Shops burned in Tak Bai" });                         // other kind, same night
const p1 = R({ time: "2026-10-01T11:00", p: ["TH-96"], title: "Bomb in Narathiwat" });                                              // province only
const m1 = R({ time: "2026-10-01T11:00", d: ["TH-9602", "TH-9606"], title: "Bombs in Tak Bai and Rueso" });                         // two districts

const s = suggest([a3, b1, a1, a4, a2, c1, p1, m1], parentOf);
const of = (r) => s.candidates.find((c) => c.reports.some((x) => x.capture_id === r.capture_id));
assert.equal(of(a1), of(a2)); assert.equal(of(a1), of(a3), "same district, kind and window join");
assert.notEqual(of(a1), of(b1), "another district never joins");
assert.notEqual(of(a1), of(a4), "outside the 36-hour window stays apart");
assert.notEqual(of(a1), of(c1), "another kind stays apart");
assert.deepEqual(of(a1).nearby, [of(c1).candidate_id], "but is pointed at");
const A = of(a1);
assert.equal(A.reports.find((x) => x.capture_id === a2.capture_id).copy_of, a1.capture_id, "the copy points at its originator");
assert.equal(A.originators, 2, "a copy is not an independent originator");
assert.deepEqual(A.contradictions, ["injured: 2 vs 3"], "differing figures stay side by side");
assert.deepEqual(A.figures.injured, [{ n: 2, captures: [a1.capture_id, a2.capture_id] }, { n: 3, captures: [a3.capture_id] }]);
assert.equal(A.location_level, "district");
for (const c of s.candidates) assert.match(c.status, /not reviewed/), assert.ok(!/confirm/i.test(JSON.stringify(c)));
// province-only and multi-district reports are listed with what they could belong to, never joined
const P = s.unplaced.find((u) => u.capture_id === p1.capture_id);
assert.deepEqual(P.could_match.sort(), [of(a1).candidate_id, of(b1).candidate_id].sort());
assert.ok(s.unplaced.find((u) => u.capture_id === m1.capture_id).why.includes("more than one district"));
assert.ok(!s.candidates.some((c) => c.reports.some((x) => x.capture_id === p1.capture_id || x.capture_id === m1.capture_id)));
// stable ids and order-independence
const s2 = suggest([m1, p1, c1, a2, a4, a1, b1, a3].map((r) => ({ ...r, copy_of: undefined })), parentOf);
assert.deepEqual(s2.candidates.map((c) => c.candidate_id).sort(), s.candidates.map((c) => c.candidate_id).sort());
// headline key ignores case, punctuation and an outlet suffix
assert.equal(headKey("Bomb at Tak Bai petrol station - Thai PBS"), headKey("BOMB at Tak Bai, petrol station | Bangkok Post"));

// reports(): folds claims of the capture's latest revision only
const cap = { capture_id: "cap-x", rev: 2, source_id: "s", title: "t", observed: "2026-10-01T00:00", published: null };
const cl = (rev, predicate, value) => ({ predicate, value, evidence: [{ capture_id: "cap-x", rev }], claim_id: predicate + rev });
const r = reports([cap], [cl(1, "killed", { n: 9 }), cl(2, "killed", { n: 2 }), cl(2, "location", { place_id: "TH-9602", level: "district" })]);
assert.equal(r[0].killed, 2); assert.equal(r[0].time_basis, "first seen"); assert.deepEqual(r[0].districts, ["TH-9602"]);
console.log("incident candidates ok:", s.candidates.length, "candidates,", s.unplaced.length, "listed apart");
