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
ok(p.schema === "osap-medplan/5" && p.poi.mgrs === "47P PS 8255 3804" && p.approvals.state === "AUTOMATED_DRAFT" && p.fingerprint === null, "one record: schema, POI, automatic draft, fingerprint set later");
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

/* phase 4: recorded aircraft with their status now; only a confirmed one inside its limits clears the provider item */
const AC = { id: "air:1", provider: "Test Air Ambulance", aircraft_type: "H145", base: { name: "Test Base", lat: 14, lon: 100.6 }, status: "CONFIRMED", status_now: "CONFIRMED", limits_now: [], launch_min: 15, cruise_kn: 120, last_confirmed: "2026-10-03T14:00:00.000Z", expires_at: "2026-10-04T02:00:00.000Z" };
const pAir = M.build(input({ aircraft: [AC], air_missions: [{ facility_id: TU.id, asset_id: "air:1", provider: "Test Air Ambulance", s: 3000, parts: [{ code: "call", s: 300 }], pickup: "the point of injury" }] }));
ok(pAir.evacuation_assets[0].status === "CONFIRMED" && pAir.evacuation_assets[0].name === "Test Air Ambulance (H145)" && by(pAir, "medevac.provider").level === "ok" && /confirmed until 2026-10-04 02:00Z/.test(by(pAir, "medevac.provider").detail) &&
  pAir.air_routes[0].status === "CONFIRMED" && pAir.air_routes[0].legs.length === 1, "phase 4: a confirmed aircraft clears the provider item and its mission is an air route");
const pLap = M.build(input({ aircraft: [Object.assign({}, AC, { status_now: "UNKNOWN" })] })), pLim = M.build(input({ aircraft: [Object.assign({}, AC, { limits_now: ["not night capable"] })] }));
const pPl = M.build(input({ aircraft: [Object.assign({}, AC, { status: "PLANNED", status_now: "PLANNED" })] }));
ok(/confirmation expired; confirm again/.test(by(pLap, "medevac.provider").detail) && /stopped by its limits now: not night capable/.test(by(pLim, "medevac.provider").detail) && /entered, not confirmed\)\. Air does not compete/.test(by(pPl, "medevac.provider").detail) &&
  [pLap, pLim, pPl].every((q) => by(q, "medevac.provider").level === "warning"), "phase 4: an expired, limited or planned aircraft keeps the provider item amber and says why");

/* phase 5: the operational picture: flood on the primary with the alternate that avoids it, HLZ forecast, data age */
const FL = { kind: "Disaster alert", layer: "gdacs", at_km: 31.2, off_km: 0.8, src: "GDACS", age_h: 20, text: "Orange flood alert for Thailand", url: "https://www.gdacs.org/" };
const fic = (o) => M.build(input(Object.assign({ now: "2026-10-04T12:00:00.000Z", pac: pacOf([{ id: "P", s: 5600, m: 98000, src: "OSRM", hazards: [H1, FL] }, { id: "A", s: 6440, m: 104000, src: "OSRM", hazards: [H1] }, { id: "C", s: 6000, m: 101000, src: "OSRM", hazards: [FL] }]) }, o || {})));
const pFl = fic(), fFl = pFl.operational_picture.flags.filter((f) => f.code === "route.flood")[0];
ok(fFl && fFl.text === "PRIMARY ROUTE INTERSECTS FLOOD WARNING / ALTERNATE ROUTE A AVAILABLE +14 MINUTES" && /Disaster alert at 31\.2 km along, 0\.8 km off the road \(Orange flood alert for Thailand\), GDACS\. Line A has no flood warning/.test(fFl.detail),
  "phase 5: a flood warning on the primary is flagged with the quickest line clear of floods and its extra time: " + (fFl || {}).text);
const pFl2 = M.build(input({ now: "2026-10-04T12:00:00.000Z", pac: pacOf([{ id: "P", s: 5600, m: 98000, src: "OSRM", hazards: [FL] }, { id: "A", s: 6000, m: 101000, src: "OSRM", hazards: [FL] }]) }));
ok(/^PRIMARY ROUTE INTERSECTS FLOOD WARNING \/ NO CLEARER ALTERNATE ROUTE FOUND$/.test(pFl2.operational_picture.flags[0].text), "phase 5: no line clear of the flood says so, never a false alternate");
ok(pA.operational_picture.flags[0].text === "PRIMARY ROUTE PASSES 2 REPORTED HAZARDS / ALTERNATE ROUTE A AVAILABLE +10 MINUTES",
  "phase 5: other hazards: the quickest line with fewer: " + pA.operational_picture.flags[0].text);
ok(!pA0.operational_picture.flags.some((f) => /^route\./.test(f.code)) && !pAn.operational_picture.flags.some((f) => /^route\./.test(f.code)), "phase 5: no route flag without hazards held (and none invented when they could not be checked: the validation says that)");

const HW = (days, o) => Object.assign({ name: "the primary HLZ", hlz: true, mgrs: "47P PS 81 37", at: "2026-10-04T11:50:00.000Z", days }, o || {});
const pW = fic({ hlz_wx: HW([{ day: "2026-10-04", vis: 9000, gust: 12, lc: 20 }, { day: "2026-10-05", vis: 1400, gust: 34, lc: 40 }]) });
const fW = pW.operational_picture.flags.filter((f) => f.code === "weather.hlz")[0];
ok(fW && fW.text === "PRIMARY HLZ VISIBILITY FORECAST 1.4 KM, GUSTS 34 KN / AIR EVACUATION REVIEW REQUIRED" && /^2026-10-05 \(UTC day\) at 47P PS 81 37/.test(fW.detail) && by(pW, "weather.hlz").level === "warning",
  "phase 5: HLZ visibility under 1.6 km or gusts of 30 kn need an air evacuation review: " + (fW || {}).text);
const pWok = fic({ hlz_wx: HW([{ day: "2026-10-04", vis: 9000, gust: 12, lc: 20 }]) }), pWpoi = fic({ hlz_wx: HW([{ day: "2026-10-04", vis: 800, gust: 5, lc: 95 }], { hlz: false, name: "the point of injury" }) });
const pWerr = fic({ hlz_wx: HW([], { err: "no answer in 20 s" }) });
ok(by(pWok, "weather.hlz").level === "ok" && /not a flying decision/.test(by(pWok, "weather.hlz").detail) && /^POINT OF INJURY \(NO HLZ GRID\) VISIBILITY FORECAST 0\.8 KM, LOW CLOUD 95%/.test(pWpoi.operational_picture.flags.filter((f) => f.code === "weather.hlz")[0].text) &&
  /FORECAST NOT READ \/ CHECK AVIATION WEATHER/.test(by(pWerr, "weather.hlz").detail), "phase 5: a clear HLZ forecast is green (not a flying decision); no HLZ grid says it used the POI; an unread forecast is amber");
ok(/^HEAVY RAIN FORECAST 34 MM 2026-10-05 \/ ROADS AND LANDING ZONES MAY FLOOD$/.test((fic({ weather_days: [{ day: "2026-10-04", rain: 2 }, { day: "2026-10-05", rain: 34.2 }] }).operational_picture.flags.filter((f) => f.code === "weather.rain")[0] || {}).text), "phase 5: heavy rain at the POI is flagged");
ok(pFl.operational_picture.flags.some((f) => f.code === "air.none" && /^NO CONFIRMED AIR MEDEVAC/.test(f.text)) && !fic({ aircraft: [AC], now: "2026-10-03T20:00:00.000Z" }).operational_picture.flags.some((f) => f.code === "air.none"), "phase 5: no confirmed aircraft is flagged; a confirmed one clears it");

const AGE = [{ key: "hospitals", label: "Hospital dataset", at: "2026-08-20T00:00:00.000Z", basis: "OSAP's stored copy of OpenStreetMap", stale_h: 840 },
  { key: "hazards", label: "Road hazards", at: "2026-10-04T11:40:00.000Z", basis: "feeds held on this device", stale_h: 6 },
  { key: "weather", label: "Weather forecast", at: "2026-10-04T11:50:00.000Z", basis: "live read", live: true, stale_h: 6 },
  { key: "verification", label: "Facility verification", at: "2026-10-03T08:00:00.000Z", expires_at: "2026-10-04T08:00:00.000Z", basis: "planner's check" },
  { key: "aircraft", label: "Aircraft confirmation", at: null, basis: "none recorded" }];
const pD5 = fic({ data_age: AGE }), da = pD5.operational_picture.data_age;
ok(da.map((a) => a.state).join() === "STALE,CURRENT,CURRENT,STALE,NONE" && da[0].age_h === 1092 && da[2].live && !da[0].live, "phase 5: each dataset dated by its content, current or stale by its own use-by, none when undated: " + da.map((a) => a.key + " " + a.state).join(", "));
const ff = pD5.operational_picture.flags.filter((f) => /^data\.age/.test(f.code)).map((f) => f.text);
ok(ff.join(" | ") === "HOSPITAL DATASET 46 DAYS OLD / CONFIRM BEFORE USE | FACILITY VERIFICATION 28 H OLD / CONFIRM BEFORE USE | AIRCRAFT CONFIRMATION NOT AVAILABLE / CONFIRM BEFORE USE" &&
  by(pD5, "data.age").level === "warning" && /Hospital dataset 46 days old; Facility verification 28 h old; Aircraft confirmation not available/.test(by(pD5, "data.age").detail), "phase 5: stale or missing data is flagged and amber, never shown as live: " + ff.join(" | "));
ok(by(fic({ data_age: AGE.slice(1, 3), offline: true }), "data.age").level === "ok" && /offline: saved copies/.test(by(fic({ data_age: AGE.slice(1, 3), offline: true }), "data.age").detail), "phase 5: all current is green, and an offline device says its copies are saved ones");
ok(M.canonical(pD5) !== M.canonical(pFl) && pW.environmental_conditions.hlz.days.length === 2, "phase 5: the picture and the HLZ forecast are in the record and the fingerprint");

/* phase 6: page 1, the medical CONOP for one casualty type, read from the record */
const c1 = M.conop(pFl, "cat.major_trauma");
ok(c1.casualty.label === "Major trauma" && c1.status === "WARNING" && c1.poi === "47P PS 8255 3804" && c1.ground === "AVAILABLE" && c1.air === "NOT CONFIRMED" &&
  c1.stabilization.name === "King Narai Hospital" && c1.stabilization.time_s === 360 && c1.stabilization.distance_m === 4400 && c1.definitive.name === "Thammasat University Hospital" && c1.definitive.time_s === 5640 &&
  c1.primary_route === "AVAILABLE" && c1.alternate_route === "AVAILABLE" && c1.route_flags[0] === "PRIMARY ROUTE INTERSECTS FLOOD WARNING / ALTERNATE ROUTE A AVAILABLE +14 MINUTES",
  "phase 6: the CONOP reads status, POI, ground, air, stabilization, definitive, P and A lines and the route flag from the record");
ok(c1.critical_gaps.join() === "Blood availability,Emergency operating theatre,Receiving hospital acceptance,Air MEDEVAC provider: none documented for this country in OSAP; ask the national emergency number and International SOS", "phase 6: critical gaps at the definitive care, acceptance and air: " + c1.critical_gaps.join(", "));
ok(c1.air_asset === "No air medevac service documented for this country in OSAP" && c1.air_documented === null, "air: with no documented service the CONOP says so, never blank");
/* Shane 2026-10-06 ("We NEED to know about air medevac"): a documented air medical service names who to call and how, stays
   NOT CONFIRMED, never competes with the road, and is named in the gaps, the provider check and the picture */
const SKY = { id: "th-niem-sky-doctor", provider: "Thai Sky Doctor (National Institute for Emergency Medicine, NIEM)", request: "Call 1669, Thailand's emergency medical number, and ask for Sky Doctor air transport",
  phone: "1669", missions: "Scene pickup by helicopter", src: "https://thailand.go.th/issue-focus-detail/001_07_002-2", srcname: "THAILAND.GO.TH", fp: "abc" };
const pSky = M.build(input({ air_providers: [SKY] })), cSky = M.conop(pSky, "cat.major_trauma"), sky = pSky.evacuation_assets.filter((a) => a.status === "DOCUMENTED");
ok(sky.length === 1 && sky[0].kind === "air" && sky[0].phone === "1669" && sky[0].source_url === SKY.src && pSky.air_routes.every((r) => r.provider !== SKY.provider), "air: a documented service is an asset with its source, never an air route");
ok(cSky.air === "NOT CONFIRMED" && cSky.air_asset === "Request: Thai Sky Doctor (National Institute for Emergency Medicine, NIEM), call 1669 (documented service, not confirmed for this mission)" && cSky.air_documented.phone === "1669",
  "air: the CONOP names the documented service and how to call it, still not confirmed: " + cSky.air_asset);
ok(cSky.critical_gaps.some((g) => /^Air MEDEVAC provider not confirmed: request Thai Sky Doctor .*Call 1669.* and record the aircraft in section 4$/.test(g)), "air: the gap says who to request and to record it: " + cSky.critical_gaps.join(" | "));
ok(/None confirmed\. Documented service: Thai Sky Doctor .*Call 1669/.test(by(pSky, "medevac.provider").detail) && by(pSky, "medevac.provider").level === "warning", "air: the provider check stays amber and names the documented service: " + by(pSky, "medevac.provider").detail);
ok(/Documented service: Thai Sky Doctor/.test(pSky.operational_picture.flags.filter((f) => f.code === "air.none")[0].detail), "air: the picture's no-confirmed-air flag names the documented service");
const cSkyA = M.conop(M.build(input({ air_providers: [SKY], aircraft: [AC], now: "2026-10-03T20:00:00.000Z" })), "cat.major_trauma");
ok(cSkyA.air === "CONFIRMED" && cSkyA.air_asset === "Test Air Ambulance (H145)" && !cSkyA.critical_gaps.some((g) => /Air MEDEVAC/.test(g)), "air: a confirmed aircraft still wins over a documented service");
const c2 = M.conop(M.build(input({ fields: { recv1: "Somewhere Else Clinic" }, categories: [{ id: "cat.major_burn", label: "Major burn", rows: [{ role: "tertiary", state: "gap" }] }] })), "cat.major_burn");
ok(c2.definitive === null && c2.ground === "NO DESTINATION" && c2.alternate_route === "NO DESTINATION" && /^Receiving facility \(unit details\): /.test(c2.critical_gaps[0]) && c2.critical_gaps.includes("Definitive care for major burn not documented"),
  "phase 6: no definitive care says so, and a blocking error leads the gaps: " + c2.critical_gaps.join(" | "));
const cA = M.conop(M.build(input({ aircraft: [AC], now: "2026-10-03T20:00:00.000Z" })), "cat.major_trauma");
ok(cA.air === "CONFIRMED" && cA.air_asset === "Test Air Ambulance (H145)" && !cA.critical_gaps.includes("Air MEDEVAC provider") && cA.alternate_route === "NOT LOOKED FOR", "phase 6: a confirmed aircraft shows as confirmed and leaves the gaps");

/* Shane 2026-10-04: a stabilization stop when the first MTF is beyond the golden hour, and documented alternate MTFs; nothing
   short of credible documentation is either (Shane 2026-10-02) */
const SH = { id: "TH-OSM-n12", name: "Sena Hospital", lat: 14.82, lon: 100.7, caps: { "ed.basic": "yes" } };
const ALT = { id: "TH-OSM-n7", name: "Other Regional Hospital", lat: 14.5, lon: 100.6, caps: { "ed.24_7": "yes", "cc.icu": "yes" } };
const pStab = M.build(input({ categories: [{ id: "cat.major_trauma", label: "Major trauma", rows: [
  { role: "primary", state: "filled", stop: true, way: "road", time_s: 6600, facility: TU, alt: { facility: ALT, way: "road", time_s: 7000 } },
  { role: "secondary", state: "gap" },
  { role: "tertiary", state: "gap" },
  { role: "stabilization", state: "filled", stop: true, way: "road", time_s: 240, facility: SH }] }],
  routes: [{ facility_id: TU.id, s: 6600, m: 98000, src: "x" }, { facility_id: SH.id, s: 240, m: 2000, src: "x" }] }));
ok(pStab.casualty_profiles[0].pathway.map((x) => x.stage + ":" + x.name).join() === "stabilization:Sena Hospital,definitive:Thammasat University Hospital" && pStab.definitive.name === "Thammasat University Hospital",
  "stabilization stop: first on the path, never the definitive care: " + pStab.casualty_profiles[0].pathway.map((x) => x.stage + ":" + x.name).join());
ok(pStab.casualty_profiles[0].gaps.join() === "secondary,tertiary" && by(pStab, "stabilization").level === "ok" && by(pStab, "stabilization").detail === "Sena Hospital", "stabilization stop: a documented emergency department is the stabilization facility");
ok(pStab.alternates.some((a) => a.name === "Other Regional Hospital" && a.role === "primary") && !!pStab.facilities[ALT.id], "alternate MTF: a documented alternate is in the record");
const cStab = M.conop(pStab, "cat.major_trauma");
ok(cStab.stabilization.name === "Sena Hospital" && !cStab.stabilization_gap, "CONOP: the stabilization stop is named");
const pNo = M.build(input({ categories: [{ id: "cat.major_trauma", label: "Major trauma", rows: [
  { role: "primary", state: "filled", stop: true, way: "road", time_s: 6600, facility: TU }, { role: "secondary", state: "gap" }, { role: "tertiary", state: "gap" }, { role: "stabilization", state: "gap" }] }] }));
const cNo = M.conop(pNo, "cat.major_trauma");
ok(pNo.stabilization_facilities.length === 0 && by(pNo, "stabilization").level === "warning" && cNo.stabilization === null && cNo.stabilization_gap && cNo.critical_gaps.includes("No stabilization stop documented inside the golden hour") && pNo.casualty_profiles[0].gaps.join() === "secondary,tertiary",
  "stabilization: with none documented inside the golden hour, the record, validation and CONOP say so and nothing is put in");
if (fails) { console.log(fails + " FAILED"); process.exit(1); }
console.log("all medical plan record checks passed");
