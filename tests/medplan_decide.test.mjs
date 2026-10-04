// The evacuation decision (assets/osap-medplan-decide.js, Medical Planner Build Plan v2 phase 2): stabilise first or bypass,
// on time to the required capability, part by part. Run from the repo root: node tests/medplan_decide.test.mjs
globalThis.window = globalThis;
await import("../assets/osap-medplan-decide.js");
const D = globalThis.OSAP_MEDDECIDE;
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const M = 60;
const lo = (to, o) => Object.assign({ name: "King Narai Hospital", to_s: to * M, gain: ["blood.bank", "dx.ct"], now: {} }, o || {});
const hi = (to, o) => Object.assign({ name: "Thammasat University Hospital", to_s: to * M, required: ["dx.ct", "surg.neuro"], now: {} }, o || {});

// ---------- the sums ----------
let d = D.compare(lo(6), hi(94), 80 * M, {});
ok(d.direct.total_s === (94 + 5) * M && d.direct.parts.map((p) => p.code).join() === "move,handoff", "direct = move from injury + handoff (5 min default)");
ok(d.via.total_s === (6 + 5 + 30 + 15 + 80 + 5) * M && d.via.parts.map((p) => p.code).join() === "move,handoff,stabilise,activation,transfer,handoff", "via = move + handoff + stabilise + transfer activation + transfer + handoff");
ok(d.basis === "estimate" && d.rule === "osap.medplan.decide/1" && d.golden_s === 3600, "every time is an estimate, under a named rule");

// ---------- the decision ----------
ok(d.decision === "stabilise" && d.reason === "direct_beyond_golden_hour", "Build Plan v2 example: King Narai 6 min, Thammasat 94 min: stabilise first");
d = D.compare(lo(6), hi(40), 40 * M, {});
ok(d.decision === "bypass" && d.reason === "direct_inside_golden_hour", "definitive care inside the golden hour (40 + 5 min): bypass");
ok(D.compare(lo(6), hi(56), 50 * M, {}).decision === "stabilise", "56 min + 5 min handoff is past the golden hour: the handoff counts");
ok(D.compare(lo(6), hi(56), 50 * M, { handoff_min: 0 }).decision === "bypass", "with the planner's handoff set to 0 the same move is inside it");
d = D.compare(lo(70), hi(70), 5 * M, {});
ok(d.decision === "bypass" && d.reason === "direct_no_slower", "the stop is no nearer and going direct is no slower: bypass");
d = D.compare(lo(6, { gain: ["blood.bank", "dx.ct"], now: { "blood.bank": "UNAVAILABLE", "dx.ct": "UNAVAILABLE" } }), hi(94), 80 * M, {});
ok(d.decision === "bypass" && d.reason === "stop_adds_nothing_available_now", "a planner's check says everything the stop adds is down now: bypass, it adds nothing");
ok(D.compare(lo(6, { now: { "blood.bank": "UNAVAILABLE" } }), hi(94), 80 * M, {}).decision === "stabilise", "one of two capabilities down still leaves a reason to stop");
ok(D.compare(lo(6, { same: true }), hi(6), 0, {}).decision === "same", "the same hospital for both: one stop");

// ---------- can the required care be used on arrival ----------
ok(D.compare(lo(6), hi(94), 80 * M, {}).access.state === "not_confirmed", "no planner's check: required care not confirmed, never assumed");
ok(D.compare(lo(6), hi(94, { now: { "dx.ct": "AVAILABLE", "surg.neuro": "AVAILABLE" } }), 80 * M, {}).access.state === "confirmed", "every required capability checked available now: confirmed");
const a = D.compare(lo(6), hi(94, { now: { "dx.ct": "AVAILABLE", "surg.neuro": "UNAVAILABLE" } }), 80 * M, {}).access;
ok(a.state === "unavailable" && a.down.join() === "surg.neuro", "a required capability checked down now is named");
ok(D.access(["trauma.designated"], {}).state === "not_confirmed", "a designation alone says nothing about now");
ok(D.compare(lo(6), hi(94), 80 * M, { golden_min: -1, dwell_min: "x" }).golden_s === 3600 && D.compare(lo(6), hi(94), 80 * M, { dwell_min: "x" }).via.parts[2].s === 1800, "bad settings fall back to the defaults");
ok(/inside the golden hour/.test(D.why({ reason: "direct_inside_golden_hour" })) && D.why({ reason: "nope" }) === "", "each reason reads as a sentence");

console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
