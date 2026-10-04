// Rules of the medical plan record (assets/osap-medplan-model.js, Medical Planner Build Plan v2 phase 0): one MedicalPlan
// object from what the plan worked out, its validation (VALID, WARNING, BLOCKING) and its stable form for the fingerprint.
// Run from the repo root: node tests/medplan_model.test.mjs
globalThis.window = globalThis;
await import("../assets/osap-medplan-model.js");
const M = globalThis.OSAP_MEDPLAN_MODEL;
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

const yes = { "blood.bank": "yes", "surg.or_emergency": "yes", "ed.24_7": "yes", "dx.ct": "yes" };
const KN = { id: "TH-OSM-w1", name: "King Narai Hospital", name_local: "โรงพยาบาลพระนารายณ์มหาราช", lat: 14.8, lon: 100.65, caps: { "ed.24_7": "yes" } };
const TU = { id: "TH-OSM-w2", name: "Thammasat University Hospital", name_local: "โรงพยาบาลธรรมศาสตร์เฉลิมพระเกียรติ", lat: 14.07, lon: 100.6, caps: { "dx.ct": "yes", "ed.24_7": "yes" } };
function input(o) {
  return Object.assign({
    cc: "th", country: "Thailand", built_at: "2026-10-03T15:00:00.000Z", now: "2026-10-03T15:01:00.000Z",
    poi: { lat: 14.81, lon: 100.69, mgrs: "47P PS 8255 3804", set_by: "poi" }, fields: {}, ll: {},
    categories: [{ id: "cat.major_trauma", label: "Major trauma", rows: [
      { role: "primary", state: "filled", stop: true, way: "road", time_s: 360, facility: KN },
      { role: "secondary", state: "gap" },
      { role: "tertiary", state: "filled", stop: true, way: "road", time_s: 5640, facility: TU }] }],
    routes: [{ facility_id: KN.id, s: 360, m: 4400, src: "routing.openstreetmap.de" }, { facility_id: TU.id, s: 5640, m: 98000, src: "routing.openstreetmap.de" }],
    air_bases: [{ name: "Test Air Rescue", lat: 14, lon: 100.6 }], air_legs: [], weather: null, pending: [], sources: [{ name: "Open-Meteo", state: "read", note: "read" }]
  }, o || {});
}
const by = (p, code) => p.validation_status.items.filter((x) => x.code === code)[0] || {};

// ---------- the record ----------
const p = M.build(input({ fields: { recv1: "Thammasat University Hospital" } }));
ok(p.schema === "osap-medplan/4" && p.poi.mgrs === "47P PS 8255 3804" && p.approvals.state === "AUTOMATED_DRAFT" && p.fingerprint === null, "one record: schema, POI, automatic draft, fingerprint set later");
ok(p.stabilization_facilities.length === 1 && p.stabilization_facilities[0].name === "King Narai Hospital" && p.definitive.name === "Thammasat University Hospital" && p.definitive.time_s === 5640,
  "POI > stabilization (King Narai, 6 min) > definitive care (Thammasat, 94 min)");
ok(p.casualty_profiles[0].pathway.map((x) => x.stage).join() === "stabilization,definitive", "the casualty pathway runs stabilization then definitive care");
ok(p.receiving_acceptance.length === 2 && p.receiving_acceptance.every((a) => a.status === "UNKNOWN"), "receiving acceptance is unknown until a planner records it");
ok(p.evacuation_assets.length === 1 && p.evacuation_assets[0].status === "POTENTIAL" && !p.evacuation_assets.some((a) => a.status === "CONFIRMED"), "an air rescue base found in open data is POTENTIAL, never confirmed");
const ux = p.unresolved_requirements.map((u) => u.code);
ok(ux.includes("cap.blood.bank") && ux.includes("cap.surg.or_emergency") && !ux.includes("cap.dx.ct"), "critical gaps at the definitive facility: blood and emergency theatre not documented, CT documented " + ux);
ok(p.ccp[0].status === "NOT_SET" && p.hlz.length === 2 && p.axp.length === 1, "CCP, AXP and HLZ are objects, not set until the planner fills them");

// ---------- validation ----------
ok(by(p, "receiving.match").level === "ok", "unit details naming the definitive destination pass");
ok(p.validation_status.status === "WARNING" && /AMBER/.test(p.validation_status.label), "open gaps make the plan amber, medical verification required");
const pKN = M.build(input({ fields: { recv1: "King Narai" } }));
ok(by(pKN, "receiving.match").level === "warning" && /stabilization stop/.test(by(pKN, "receiving.match").detail), "unit details naming the stabilization stop warn and name the definitive care");
const pX = M.build(input({ fields: { recv1: "Bangkok Hospital Pattaya" } }));
ok(by(pX, "receiving.match").level === "blocking" && pX.validation_status.status === "BLOCKING" && /does not match the calculated definitive destination, Thammasat/.test(by(pX, "receiving.match").detail),
  "unit details naming another hospital are a blocking error (Build Plan v2 example)");
const pTh = M.build(input({ fields: { recv1: "โรงพยาบาลธรรมศาสตร์เฉลิมพระเกียรติ" } }));
ok(by(pTh, "receiving.match").level === "ok", "the Thai name matches as well");
const pP = M.build(input({ pending: ["weather", "blood banks, chambers and air rescue bases"] }));
ok(pP.validation_status.status === "BLOCKING" && /Still reading: weather/.test(by(pP, "data.pending").detail), "data still being read blocks printing");
const p0 = M.build(input({ poi: { lat: 14.8, lon: 100.6, mgrs: "x", set_by: "c" }, categories: [{ id: "cat.major_trauma", label: "Major trauma", rows: [{ role: "primary", state: "gap" }, { role: "secondary", state: "gap" }, { role: "tertiary", state: "gap" }] }] }));
ok(by(p0, "poi").level === "warning" && by(p0, "definitive").level === "warning" && p0.definitive === null && p0.unresolved_requirements.some((u) => u.code === "no_definitive.cat.major_trauma"),
  "no POI and no documented definitive care are warnings, and the gap is listed, never filled in");
const pF = M.build(input({ fields: { recv1: "Thammasat", medevac1: "Unit MEDEVAC, +66 0", freq1: "DUSTOFF 41.5", ccp1: "47P PS 8255 3804 Bridge", axp: "14.80, 100.66", hlz1: "14.79, 100.67", hlz2: "14.78, 100.68", casevac: "2 x HMMWV" },
  ll: { ccp1: Object.assign([14.81, 100.69], { mgrs: "47P PS 8255 3804" }), axp: [14.8, 100.66], hlz1: [14.79, 100.67], hlz2: [14.78, 100.68] },
  categories: [{ id: "cat.major_trauma", label: "Major trauma", rows: [{ role: "tertiary", state: "filled", stop: true, way: "road", time_s: 600, facility: Object.assign({}, TU, { caps: yes }) }] }] }));
const warn = pF.validation_status.items.filter((x) => x.level !== "ok").map((x) => x.code).sort().join();
ok(warn === "acceptance,medevac.provider,route.alternate,stabilization,verification", "with everything filled, only what phase 0 cannot confirm stays amber: " + warn);
ok(/not confirmed available now: no planner's check in date/.test(by(pF, "verification").detail) && /Blood availability, emergency operating theatre, 24-hour emergency department and CT scanner/.test(by(pF, "verification").detail),
  "phase 1: critical capabilities are not usable now until a planner's check says so (names keep their capitals)");
const allNow = { "blood.bank": "AVAILABLE", "surg.or_emergency": "AVAILABLE", "ed.24_7": "AVAILABLE", "dx.ct": "AVAILABLE" };
const chk = { id: "chk:1", facility_id: TU.id, cap: "dx.ct", exists: "yes", now: "available", at: "2026-10-03T14:00:00.000Z" };
const pV = M.build(input({ checks: [chk, Object.assign({}, chk, { id: "chk:2", facility_id: "elsewhere" })], categories: [{ id: "cat.major_trauma", label: "Major trauma", rows: [{ role: "tertiary", state: "filled", stop: true, way: "road", time_s: 600, facility: Object.assign({}, TU, { caps: yes, caps_now: allNow }) }] }] }));
ok(by(pV, "verification").level === "ok" && pV.facility_verifications.length === 1 && pV.facility_verifications[0].id === "chk:1", "phase 1: all four checked and in date is green; only checks of the plan's hospitals are carried");
const pU = M.build(input({ categories: [{ id: "cat.major_trauma", label: "Major trauma", rows: [{ role: "tertiary", state: "filled", stop: true, way: "road", time_s: 600, facility: Object.assign({}, TU, { caps: yes, caps_now: Object.assign({}, allNow, { "dx.ct": "UNAVAILABLE" }) }) }] }] }));
ok(by(pU, "verification").level === "warning" && /CT scanner reported not available now at Thammasat University Hospital/.test(by(pU, "verification").detail), "phase 1: a check saying not available now is named");
ok(M.canonical(pV) !== M.canonical(M.build(input({ checks: [], categories: [{ id: "cat.major_trauma", label: "Major trauma", rows: [{ role: "tertiary", state: "filled", stop: true, way: "road", time_s: 600, facility: Object.assign({}, TU, { caps: yes, caps_now: allNow }) }] }] }))), "phase 1: the planner's checks are in the fingerprint");
ok(pF.evacuation_assets[0].status === "PLANNED" && /entered, not confirmed/.test(by(pF, "medevac.provider").detail), "a medevac provider the planner typed is PLANNED, not confirmed");
const pS = M.build(input({ sources: [{ name: "FOSSGIS OSRM", state: "failed" }] }));
ok(by(pS, "sources").level === "warning" && /FOSSGIS OSRM/.test(by(pS, "sources").detail), "a source that was not reached is named");

// ---------- stable form ----------
const a = M.build(input()), b = M.build(input({ now: "2026-10-03T18:00:00.000Z" }));
b.fingerprint = "abc";
ok(M.canonical(a) === M.canonical(b), "the same plan gives the same fingerprint input; update time and fingerprint are left out");
ok(M.canonical(a) !== M.canonical(M.build(input({ fields: { recv1: "X" } }))), "a change in the plan changes the fingerprint input");
ok(M.names("Thammasat Hosp.", TU) && !M.names("Hospital", TU) && !M.names("King", TU), "name matching ignores generic words and needs a distinctive part");

// ---------- phase 2: the stabilise-or-bypass decision rides in the record ----------
const dec = { rule: "osap.medplan.decide/1", decision: "stabilise", reason: "direct_beyond_golden_hour", from: "primary", direct: { total_s: 5940, parts: [] }, via: { total_s: 8460, parts: [] }, access: { state: "not_confirmed", down: [], of: ["dx.ct"] }, golden_s: 3600, basis: "estimate" };
const pD = M.build(input({ categories: [{ id: "cat.major_trauma", label: "Major trauma", rows: [
  { role: "primary", state: "filled", stop: true, way: "road", time_s: 360, facility: KN },
  { role: "secondary", state: "gap" },
  { role: "tertiary", state: "filled", stop: true, way: "road", time_s: 5640, facility: TU, decision: dec }] }] }));
const pd = pD.casualty_profiles[0].decisions;
ok(pd.length === 1 && pd[0].to_role === "tertiary" && pd[0].decision === "stabilise" && pd[0].via.total_s === 8460 && pd[0].access.state === "not_confirmed", "phase 2: each decision is in the casualty profile with both totals and whether care is confirmed now");
ok(M.canonical(pD) !== M.canonical(M.build(input())), "phase 2: the decision is in the fingerprint");

/* phase 3: alternate and contingency lines to the definitive facility, hazards along the primary */
const H1 = { kind: "Conflict event", layer: "ucdp", at_km: 12.3, off_km: 0.4, src: "UCDP", age_h: 72, text: "x", url: "https://ucdp.uu.se/" };
const pacOf = (lines, state) => [{ facility_id: TU.id, state: state || "done", err: state === "failed" ? "OSRM: 504" : "", hazard_km: 2, hazard_days: 30, lines }];
const pA = M.build(input({ pac: pacOf([{ id: "P", s: 5600, m: 98000, src: "FOSSGIS OSRM", how: "fastest", hazards: [H1, H1] }, { id: "A", s: 6200, m: 104000, src: "FOSSGIS OSRM", how: "alternative", hazards: [H1] }, { id: "C", s: 7000, m: 120000, src: "FOSSGIS Valhalla", how: "detour", hazards: [] }]) }));
const gA = pA.ground_routes.filter((r) => r.facility_id === TU.id);
ok(gA.map((r) => r.option).join() === "P,A,C" && gA[0].time_s === 5640 && gA[0].router_time_s === 5600 && gA[0].hazards.length === 2 && gA[2].how === "detour", "phase 3: P keeps the plan's route time; A and C follow with their hazards");
ok(by(pA, "route.alternate").level === "ok" && /A \+10 min on the primary, 1 h 43 min drive, C \+23 min on the primary, 1 h 57 min drive/.test(by(pA, "route.alternate").detail), "phase 3: alternate is green with A and C and how much longer each is: " + by(pA, "route.alternate").detail);
ok(by(pA, "route.hazards").level === "warning" && /2 reported within 2 km in the last 30 days, first: Conflict event at 12.3 km; line A has 1/.test(by(pA, "route.hazards").detail), "phase 3: hazards on the primary are amber and name the line with fewer: " + by(pA, "route.hazards").detail);
const pA0 = M.build(input({ pac: pacOf([{ id: "P", s: 5600, m: 98000, src: "OSRM", hazards: [] }]) }));
ok(by(pA0, "route.alternate").level === "warning" && /no distinct alternate/.test(by(pA0, "route.alternate").detail) && by(pA0, "route.hazards").level === "ok" && /not a clearance/.test(by(pA0, "route.hazards").detail), "phase 3: one line only is amber; no hazards held is green but not a clearance");
const pAf = M.build(input({ pac: pacOf([], "failed") })), pAp = M.build(input({ pac: pacOf([], "pending") }));
ok(/None found \(OSRM: 504\)/.test(by(pAf, "route.alternate").detail) && !by(pAf, "route.hazards").code && /Still looking/.test(by(pAp, "route.alternate").detail), "phase 3: a failed or pending lookup says so and checks no hazards");
const pAn = M.build(input({ pac: pacOf([{ id: "P", s: 5600, m: 98000, src: "OSRM", hazards: null }, { id: "A", s: 5900, m: 99000, src: "OSRM", hazards: null }]) }));
ok(by(pAn, "route.hazards").level === "warning" && /Could not be checked/.test(by(pAn, "route.hazards").detail) && /no contingency line/.test(by(pAn, "route.alternate").detail), "phase 3: hazards that could not be checked are amber, never clear");
ok(M.canonical(pA) !== M.canonical(pA0) && pA.ground_alternates[0].lines === 3, "phase 3: the lines and hazards are in the fingerprint");

/* phase 3: CCP, AXP and HLZ are map objects only with a grid */
const pG = M.build(input({ fields: { ccp1: "Bridge", hlz1: "14.79, 100.67" }, ll: { hlz1: [14.79, 100.67] } }));
ok(by(pG, "ccp").level === "warning" && /Bridge: no grid, so it is not on the map/.test(by(pG, "ccp").detail) && by(pG, "hlz").level === "ok" && by(pG, "axp").detail === "Not set." && pG.hlz[0].lat === 14.79, "phase 3: a named CCP without a grid is amber; an HLZ with a grid is on the map; AXP is checked");

const pH = M.build(input({ fields: { hlz1: "14.79, 100.67", hlz1_st: "unusable", hlz1_at: "2026-10-04T08:00:00.000Z", hlz1_note: "wires on approach", hlz1_cap: "1 UH-60", ccp1: "14.8, 100.6", ccp1_st: "usable", ccp1_at: "2026-10-04T07:30:00.000Z" }, ll: { hlz1: [14.79, 100.67], ccp1: [14.8, 100.6] } }));
ok(pH.hlz[0].status === "UNUSABLE" && pH.hlz[0].capacity === "1 UH-60" && by(pH, "hlz").level === "warning" && /checked not usable \(2026-10-04 08:00Z\): wires on approach\. Choose another/.test(by(pH, "hlz").detail) &&
  pH.ccp[0].status === "USABLE" && /checked usable 2026-10-04 07:30Z/.test(by(pH, "ccp").detail), "phase 3: a planner's check of a point (usable or not, when, capacity, notes) is in the record and the validation");

if (fails) { console.log(fails + " FAILED"); process.exit(1); }
console.log("all medical plan record checks passed");
