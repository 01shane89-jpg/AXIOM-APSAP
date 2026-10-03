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
ok(p.schema === "osap-medplan/3" && p.poi.mgrs === "47P PS 8255 3804" && p.approvals.state === "AUTOMATED_DRAFT" && p.fingerprint === null, "one record: schema, POI, automatic draft, fingerprint set later");
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
const pF = M.build(input({ fields: { recv1: "Thammasat", medevac1: "Unit MEDEVAC, +66 0", freq1: "DUSTOFF 41.5", ccp1: "Bridge", hlz1: "Football field", hlz2: "Temple yard", casevac: "2 x HMMWV" },
  categories: [{ id: "cat.major_trauma", label: "Major trauma", rows: [{ role: "tertiary", state: "filled", stop: true, way: "road", time_s: 600, facility: Object.assign({}, TU, { caps: yes }) }] }] }));
const warn = pF.validation_status.items.filter((x) => x.level !== "ok").map((x) => x.code).sort().join();
ok(warn === "acceptance,medevac.provider,route.alternate,stabilization", "with everything filled, only what phase 0 cannot confirm stays amber: " + warn);
ok(pF.evacuation_assets[0].status === "PLANNED" && /entered, not confirmed/.test(by(pF, "medevac.provider").detail), "a medevac provider the planner typed is PLANNED, not confirmed");
const pS = M.build(input({ sources: [{ name: "FOSSGIS OSRM", state: "failed" }] }));
ok(by(pS, "sources").level === "warning" && /FOSSGIS OSRM/.test(by(pS, "sources").detail), "a source that was not reached is named");

// ---------- stable form ----------
const a = M.build(input()), b = M.build(input({ now: "2026-10-03T18:00:00.000Z" }));
b.fingerprint = "abc";
ok(M.canonical(a) === M.canonical(b), "the same plan gives the same fingerprint input; update time and fingerprint are left out");
ok(M.canonical(a) !== M.canonical(M.build(input({ fields: { recv1: "X" } }))), "a change in the plan changes the fingerprint input");
ok(M.names("Thammasat Hosp.", TU) && !M.names("Hospital", TU) && !M.names("King", TU), "name matching ignores generic words and needs a distinctive part");

if (fails) { console.log(fails + " FAILED"); process.exit(1); }
console.log("all medical plan record checks passed");
