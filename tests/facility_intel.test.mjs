// Facility intelligence (assets/osap-facility-intel.js, Medical Planner Build Plan v2 phase 1): who says a capability exists
// (V1 to U), whether it can be used now (only a planner's unexpired check says), and the planner's check as a decision record.
// Run from the repo root: node tests/facility_intel.test.mjs
globalThis.window = globalThis;
await import("../assets/osap-facility-intel.js");
const I = globalThis.OSAP_FACINTEL;
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

const osm = { kind: "osm", name: "OpenStreetMap", url: "https://www.openstreetmap.org/node/1" };
const caps = {
  "dx.ct": { status: "REPORTED", confidence: "LOW", availability: "unknown", source: osm, last_verified: null },
  "blood.bank": { status: "VERIFIED", confidence: "HIGH", availability: "unknown", source: { kind: "register", name: "HA Thailand certification" }, last_verified: "2026-09-01" },
  "ed.24_7": { status: "REPORTED", confidence: "MODERATE", availability: "unknown", source: { kind: "institution", name: "hospital.example" }, last_verified: null },
  "cc.icu": { status: "UNKNOWN", confidence: "UNKNOWN", availability: "unknown", source: null, last_verified: null },
  "surg.neuro": { status: "REPORTED", confidence: "LOW", availability: "unknown", source: { kind: "wd", name: "Wikipedia" }, last_verified: null } };

// ---------- grades ----------
ok(I.grade(caps["blood.bank"]) === "V2" && I.grade(caps["ed.24_7"]) === "V3" && I.grade(caps["dx.ct"]) === "V4" && I.grade(caps["surg.neuro"]) === "V4" && I.grade(caps["cc.icu"]) === "U",
  "grades: register V2, hospital's own page V3, OpenStreetMap and Wikipedia V4, nothing U");

// ---------- a check is validated before it is kept ----------
const T0 = "2026-10-02T08:30:00.000Z";
const good = { facility_id: "n1", facility_name: "King Narai Hospital", cap: "dx.ct", exists: "yes", now: "available", method: "phone", contact_role: "ED charge nurse", note: "CT up", at: T0 };
const c1 = I.makeCheck(good, T0);
ok(!c1.errors && c1.expires_at === "2026-10-03T08:30:00.000Z" && c1.by === "planner on this device" && c1.valid_h === 24, "a check: kept with its time, 24 h expiry and the planner on this device");
ok(I.makeCheck(Object.assign({}, good, { exists: "no", now: "available" }), T0).errors, "DENY: available now but the hospital does not have it");
ok(I.makeCheck(Object.assign({}, good, { method: "rumour" }), T0).errors, "DENY: an unknown way of checking");
ok(I.makeCheck(Object.assign({}, good, { cap: "<img src=x>" }), T0).errors, "DENY: a capability that is not a flag name");
ok(I.makeCheck(Object.assign({}, good, { valid_h: 0 }), T0).errors && I.makeCheck(Object.assign({}, good, { valid_h: 9999 }), T0).errors, "DENY: zero hours, or more than 30 days");
ok(I.makeCheck(Object.assign({}, good, { exists: "unknown" }), T0).exists === "yes", "usable now means it exists");
ok(I.makeCheck(Object.assign({}, good, { note: "x".repeat(900) }), T0).note.length === 300, "long notes are cut to 300 characters");

// ---------- applied to the flags ----------
let log = I.addCheck([], c1);
const at = (h) => new Date(Date.parse(T0) + h * 3600000).toISOString();
let A = I.apply(caps, log, "n1", at(1));
ok(A["dx.ct"].status === "VERIFIED" && A["dx.ct"].grade === "V1" && A["dx.ct"].source.kind === "planner" && A["dx.ct"].prior.source.kind === "osm", "a planner's check outranks OpenStreetMap (V1) and keeps what the source said");
ok(A["dx.ct"].now.state === "AVAILABLE" && A["dx.ct"].now.expires_at === c1.expires_at, "available now while the check is in date");
ok(caps["dx.ct"].status === "REPORTED" && !caps["dx.ct"].now, "the source flags are not changed");
ok(A["blood.bank"].grade === "V2" && A["blood.bank"].now.state === "UNKNOWN" && !A["blood.bank"].now.checked_at, "an official certificate says it exists, not that it can be used now");
A = I.apply(caps, log, "n1", at(25));
ok(A["dx.ct"].now.state === "UNKNOWN" && A["dx.ct"].now.expired && A["dx.ct"].now.was === "AVAILABLE" && A["dx.ct"].status === "VERIFIED", "past expiry: available now reads UNKNOWN; that it exists stays verified");
ok(I.apply(caps, log, "n2", at(1))["dx.ct"].grade === "V4", "a check of one hospital does not touch another");

// ---------- newer checks replace older ones; the log keeps both ----------
const c2 = I.makeCheck(Object.assign({}, good, { now: "unavailable", note: "CT down", at: at(2) }), at(2));
log = I.addCheck(log, c2);
ok(log.length === 2 && log[1].supersedes === c1.id && I.latest(log, "n1", "dx.ct") === log[1], "a newer check replaces the older one, which stays in the log");
ok(I.apply(caps, log, "n1", at(3))["dx.ct"].now.state === "UNAVAILABLE", "not available now, from the newer check");
ok(I.addCheck(log, log[1]).length === 2, "the same check twice is kept once");
const c3 = I.makeCheck(Object.assign({}, good, { exists: "unknown", now: "unknown", at: at(4) }), at(4));
log = I.addCheck(log, c3);
A = I.apply(caps, log, "n1", at(5));
ok(A["dx.ct"].status === "REPORTED" && A["dx.ct"].grade === "V4" && A["dx.ct"].now.state === "UNKNOWN", "undo: \"not said\" for both leaves the sources as they were");
const c4 = I.makeCheck(Object.assign({}, good, { cap: "blood.bank", exists: "no", now: "unknown", at: at(6) }), at(6));
A = I.apply(caps, I.addCheck(log, c4), "n1", at(7));
ok(A["blood.bank"].status === "NOT_AVAILABLE" && A["blood.bank"].grade === "V1" && A["blood.bank"].prior.status === "VERIFIED", "a planner saying it does not exist outranks the register, which is kept as prior");
let big = [];
for (let i = 0; i < I.MAX_LOG + 5; i++) big.push({ id: "x" + i, facility_id: "z", cap: "dx.ct", at: T0 });
ok(I.addCheck(big, c1).length === I.MAX_LOG, "the log keeps its newest " + I.MAX_LOG + " checks");

// ---------- the Facility object ----------
const R = I.record({ id: "n1", name: "King Narai Hospital", cc: "th", lat: 14.8, lon: 100.65, mgrs: "47P PS 1 2", caps: I.apply(caps, [c1], "n1", at(1)), contacts: { phone: "036 616 300" } }, [c1], at(1));
ok(R.capabilities.ct.grade === "V1" && R.capabilities.ct.available_now === "AVAILABLE" && R.capabilities.blood_bank.grade === "V2" && R.capabilities.icu.grade === "U" && R.capabilities.mri.status === "UNKNOWN",
  "Facility object: Build Plan v2 capability names with grade and available now");
ok(R.transport.helipad && R.transport.airfield === null && R.verification.checks === 1 && R.verification.current === 1 && R.verification.last_check === T0, "Facility object: transport and verification summary");
ok(I.record({ id: "n1", name: "K", caps: {} }, [c1], at(30)).verification.current === 0, "an expired check is not current");

console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
