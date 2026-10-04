/* AXIOM OSAP: the medical plan as one object (Medical Planner Build Plan v2, phase 0).
   build(input) turns what the plan worked out (assets/osap-medplan.js: the casualty pathways, routes, air bases, unit details,
   weather and the state of every source) into one MedicalPlan record; validate(plan) rates it VALID, WARNING or BLOCKING by
   fixed rules. The screen, the print view and the fingerprint all read this one record, so a printed plan can never say one
   thing in one section and another elsewhere. Pure: no page, no network, no AI; the same input always gives the same plan.
   Terms: a casualty's path runs POI > stabilization > definitive care. Internally the plan still picks Primary, Secondary and
   Tertiary per casualty type; here a Tertiary (or a Secondary when it is the last planned stop) is the definitive care and the
   stops before it are stabilization. Air assets are POTENTIAL (an air rescue base found in open data) or PLANNED (entered by
   the planner); none is CONFIRMED until a planner confirms it, so no air asset is treated as available. Receiving acceptance
   is UNKNOWN until a planner records it. */
(function (root) {
  "use strict";
  var SCHEMA = "osap-medplan/3";
  var STAGE = { primary: "stabilization", secondary: "stabilization", tertiary: "definitive" };
  /* the capabilities whose absence a planner must close before the plan is relied on (Build Plan v2, CONOP "critical gaps") */
  var CRITICAL = [["blood.bank", "Blood availability"], ["surg.or_emergency", "Emergency operating theatre"], ["ed.24_7", "24-hour emergency department"], ["dx.ct", "CT scanner"]];

  function str(x) { return x == null ? "" : String(x); }
  function lower(L) { var n = L.map(function (c, i) { return i && !/^.[A-Z]/.test(c[1]) ? c[1].charAt(0).toLowerCase() + c[1].slice(1) : c[1]; }); return n.length < 2 ? n.join("") : n.slice(0, -1).join(", ") + " and " + n[n.length - 1]; }
  function blank(x) { return !str(x).trim(); }
  /* a facility name reduced to the words that tell it apart, for matching what a planner typed */
  var GENERIC = /\b(the|hospital|hospitals|medical|center|centre|clinic|general|of|and|hosp|rph|international)\b|โรงพยาบาล|รพ\.?/gi;
  function core(s) { return str(s).normalize("NFKC").toLowerCase().replace(GENERIC, " ").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim(); }
  /* true when a typed name names this facility: one core name holds the other, or most of the words agree */
  function names(text, fac) {
    var t = core(text); if (t.length < 3 || !fac) return false;
    return [fac.name, fac.name_local].concat(fac.aliases || []).some(function (n) {
      var c = core(n); if (c.length < 3) return false;
      if (t.indexOf(c) >= 0 || c.indexOf(t) >= 0) return true;
      var a = t.split(" "), b = c.split(" "), hit = a.filter(function (w) { return w.length > 2 && b.indexOf(w) >= 0; }).length;
      return hit >= 2 && hit >= Math.ceil(Math.min(a.length, b.length) * 0.6);
    });
  }
  function point(text, ll, role) { return { role: role, text: str(text), lat: ll ? ll[0] : null, lon: ll ? ll[1] : null, mgrs: ll && ll.mgrs || "", status: blank(text) ? "NOT_SET" : "PLANNER_ENTERED", verified_at: null }; }
  function fac(f) {
    return { id: f.id, name: f.name, name_local: f.name_local || "", aliases: f.aliases || [], lat: f.lat, lon: f.lon, mgrs: f.mgrs || "", caps: f.caps || {},
      caps_now: f.caps_now || {}, intel: f.intel || null, designation: f.designation || "", source: f.source || "" };
  }

  /* input: see planInput() in assets/osap-medplan.js */
  function build(I) {
    var F = {}, stab = [], defi = [], alts = [], profiles = [], unresolved = [];
    function addFac(list, f, extra) {
      if (!F[f.id]) F[f.id] = fac(f);
      var had = list.filter(function (x) { return x.facility_id === f.id; })[0];
      if (had) { had.for.push(extra.for[0]); return; }
      list.push(Object.assign({ facility_id: f.id, name: f.name }, extra));
    }
    (I.categories || []).forEach(function (c) {
      var rows = c.rows || [], filled = rows.filter(function (r) { return r.state === "filled"; });
      var stops = filled.filter(function (r) { return r.stop; });
      /* the definitive care is the last planned stop that reaches Tertiary care, else the last planned stop */
      var last = stops.filter(function (r) { return r.role === "tertiary"; })[0] || stops[stops.length - 1] || null;
      var path = [];
      stops.forEach(function (r) {
        var stage = r === last ? "definitive" : STAGE[r.role] === "definitive" ? "definitive" : "stabilization";
        path.push({ stage: stage, role: r.role, facility_id: r.facility.id, name: r.facility.name, way: r.way, time_s: r.time_s, basis: "estimate" });
        addFac(stage === "definitive" ? defi : stab, r.facility, { for: [c.id], role: r.role, way: r.way, time_s: r.time_s });
      });
      filled.filter(function (r) { return !r.stop && r.stabilisation_option; }).forEach(function (r) {
        addFac(alts, r.facility, { for: [c.id], role: r.role, why: "bypassed: going direct reaches the needed care sooner; stays the stabilization option", way: r.way, time_s: r.time_s });
      });
      var gaps = rows.filter(function (r) { return r.state !== "filled"; }).map(function (r) { return r.role; });
      if (!last) unresolved.push({ code: "no_definitive." + c.id, text: "No definitive care documented for " + c.label.toLowerCase() });
      /* phase 2: each stabilise-or-bypass decision with its time to the required care, part by part */
      var decisions = rows.filter(function (r) { return r.decision; }).map(function (r) { return Object.assign({ to_role: r.role }, r.decision); });
      profiles.push({ id: c.id, label: c.label, pathway: path, gaps: gaps, bypass: path.length && stops.length < filled.length, decisions: decisions });
    });
    var trauma = profiles.filter(function (p) { return p.id === "cat.major_trauma"; })[0] || profiles[0] || null;
    var def = trauma ? trauma.pathway.filter(function (x) { return x.stage === "definitive"; })[0] : null;
    var defF = def ? F[def.facility_id] : null;
    var v = I.fields || {};
    var air = (I.air_bases || []).map(function (b) { return { kind: "air", name: b.name, base: b.name, lat: b.lat, lon: b.lon, phone: b.phone || "", status: "POTENTIAL", source: "OpenStreetMap air rescue base", last_confirmed: null }; });
    ["medevac1", "medevac2"].forEach(function (k, i) { if (!blank(v[k])) air.unshift({ kind: "air", name: str(v[k]), status: "PLANNED", source: "planner (unit details " + (i ? "alternate" : "primary") + ")", last_confirmed: null }); });
    if (!blank(v.casevac)) air.push({ kind: "ground", name: str(v.casevac), status: "PLANNED", source: "planner (CASEVAC vehicles)", last_confirmed: null });
    var plan = {
      schema: SCHEMA, id: "mp-" + str(I.cc) + "-" + (I.poi ? I.poi.lat.toFixed(4) + "_" + I.poi.lon.toFixed(4) : "none"), version: 1,
      created_at: I.built_at || "", updated_at: I.now || I.built_at || "",
      country: { cc: I.cc || "", name: I.country || "" },
      mission: { unit: str(v.unit), mission: str(v.mission), notes: str(v.notes) },
      poi: I.poi ? { lat: I.poi.lat, lon: I.poi.lon, mgrs: I.poi.mgrs || "", set_by: I.poi.set_by || "" } : null,
      casualty_profiles: profiles,
      stabilization_facilities: stab, definitive_facilities: defi, alternates: alts,
      facilities: F,
      evacuation_assets: air,
      ground_routes: (I.routes || []).map(function (r) { return { facility_id: r.facility_id, option: "P", time_s: r.s, distance_m: r.m, source: r.src || "", basis: r.s == null ? "not routed" : "road router" }; }),
      air_routes: (I.air_legs || []).map(function (a) { return { facility_id: a.facility_id, time_s: a.s, basis: "straight-line estimate at " + a.kn + " kn from " + a.base + "; not an executable air plan" }; }),
      ccp: [point(v.ccp1, I.ll && I.ll.ccp1, "primary"), point(v.ccp2, I.ll && I.ll.ccp2, "alternate")],
      axp: [point(v.axp, I.ll && I.ll.axp, "primary")],
      hlz: [point(v.hlz1, I.ll && I.ll.hlz1, "primary"), point(v.hlz2, I.ll && I.ll.hlz2, "alternate")],
      communications: { medevac: [str(v.freq1), str(v.freq2)].filter(function (x) { return !blank(x); }) },
      receiving: { primary: str(v.recv1), alternate: str(v.recv2) },
      /* the planner's checks of the plan's hospitals (phase 1), oldest first */
      facility_verifications: (I.checks || []).filter(function (c) { return c && F[c.facility_id]; }),
      receiving_acceptance: defi.concat(stab).map(function (x) { return { facility_id: x.facility_id, status: "UNKNOWN", recorded_at: null }; }),
      environmental_conditions: { weather: I.weather || null, at: I.weather_at || "" },
      unresolved_requirements: unresolved,
      pending: (I.pending || []).slice(),
      approvals: { state: "AUTOMATED_DRAFT", history: [] },
      source_manifest: (I.sources || []).slice(),
      definitive: defF ? { facility_id: defF.id, name: defF.name, time_s: def.time_s, way: def.way } : null,
      fingerprint: null
    };
    if (defF) CRITICAL.forEach(function (c) { if ((defF.caps || {})[c[0]] !== "yes") unresolved.push({ code: "cap." + c[0], text: c[1] + " at " + defF.name + " not documented" }); });
    plan.validation_status = validate(plan);
    return plan;
  }

  /* one check: ok, warning or blocking, in the order a planner reads them (Build Plan v2 validation screen) */
  function validate(p) {
    var it = [];
    function add(code, level, label, detail) { it.push({ code: code, level: level, label: label, detail: detail || "" }); }
    if (p.pending && p.pending.length) add("data.pending", "blocking", "Plan data complete", "Still reading: " + p.pending.join(", ") + ". The plan cannot be printed until they finish or fail.");
    else add("data.pending", "ok", "Plan data complete");
    add("poi", p.poi && p.poi.set_by === "poi" ? "ok" : "warning", "Point of injury", p.poi && p.poi.set_by === "poi" ? p.poi.mgrs : "Not set: the plan is centred on " + (p.poi && p.poi.set_by === "c" ? "the map or area centre" : "a stand-in point") + ".");
    var stab = p.stabilization_facilities[0], def = p.definitive;
    add("stabilization", stab ? "ok" : "warning", "Stabilization facility", stab ? stab.name : "None documented by a credible source; stabilize en route or confirm a local facility.");
    add("definitive", def ? "ok" : "warning", "Definitive care facility", def ? def.name : "No hospital with the needed care documented by a credible source.");
    var r0 = def && p.ground_routes.filter(function (r) { return r.facility_id === def.facility_id; })[0];
    add("route.primary", r0 && r0.time_s != null ? "ok" : "warning", "Primary ground route", r0 && r0.time_s != null ? "Road router" : def ? "No road route to the definitive facility yet." : "No destination to route to.");
    add("route.alternate", "warning", "Alternate ground route", "Not built yet (Build Plan v2 phase 3).");
    /* what the planner typed as the receiving facility must name the hospital the plan sends the casualty to */
    var rec = p.receiving.primary;
    if (!rec.trim()) add("receiving.match", "warning", "Receiving facility (unit details)", def ? "Not filled in; the plan's definitive care is " + def.name + "." : "Not filled in.");
    else if (def && names(rec, p.facilities[def.facility_id])) add("receiving.match", "ok", "Receiving facility (unit details)", rec);
    else {
      var st = p.stabilization_facilities.filter(function (x) { return names(rec, p.facilities[x.facility_id]); })[0];
      if (st) add("receiving.match", "warning", "Receiving facility (unit details)", "“" + rec + "” is the stabilization stop; the definitive care is " + (def ? def.name : "not identified") + ".");
      else add("receiving.match", "blocking", "Receiving facility (unit details)", "“" + rec + "” does not match the calculated " + (def ? "definitive destination, " + def.name : "plan: no definitive destination was found") + ". Correct section 9 or the plan before use.");
    }
    add("acceptance", "warning", "Definitive facility acceptance", "Not recorded: call the receiving hospital.");
    /* phase 1: the critical capabilities at the definitive facility, usable now only on a planner's unexpired check */
    var dF = def && p.facilities[def.facility_id], nowC = dF ? dF.caps_now || {} : {};
    var off = CRITICAL.filter(function (c) { return nowC[c[0]] === "UNAVAILABLE"; }), unc = CRITICAL.filter(function (c) { return nowC[c[0]] !== "AVAILABLE" && nowC[c[0]] !== "UNAVAILABLE"; });
    add("verification", dF && !off.length && !unc.length ? "ok" : "warning", "Capabilities confirmed available now",
      !dF ? "No definitive facility." : off.length ? lower(off) + " reported not available now at " + dF.name + " by a planner's check; find another destination or check again." :
      unc.length ? lower(unc) + " at " + dF.name + " not confirmed available now: no planner's check in date." : "Checked by a planner and in date at " + dF.name + ".");
    var blood = p.unresolved_requirements.filter(function (u) { return u.code === "cap.blood.bank"; })[0];
    add("blood", def && !blood ? "ok" : "warning", "Blood availability", def ? (blood ? blood.text + "." : "Documented at " + def.name + ".") : "No definitive facility.");
    var conf = p.evacuation_assets.filter(function (a) { return a.kind === "air" && a.status === "CONFIRMED"; });
    var planned = p.evacuation_assets.filter(function (a) { return a.kind === "air" && a.status === "PLANNED"; });
    add("medevac.provider", conf.length ? "ok" : "warning", "Air MEDEVAC provider", conf.length ? conf[0].name : planned.length ? planned[0].name + " (entered, not confirmed)" : "None confirmed.");
    add("ccp", p.ccp[0].status !== "NOT_SET" ? "ok" : "warning", "Casualty collection point (CCP)", p.ccp[0].text || "Not set.");
    add("hlz", p.hlz[0].status !== "NOT_SET" ? "ok" : "warning", "Helicopter landing zone (HLZ)", p.hlz[0].text || "Not set.");
    add("hlz.alternate", p.hlz[1].status !== "NOT_SET" ? "ok" : "warning", "Alternate HLZ", p.hlz[1].text || "Not set.");
    var cv = p.evacuation_assets.filter(function (a) { return a.kind === "ground"; })[0];
    add("casevac", cv ? "ok" : "warning", "CASEVAC platform", cv ? cv.name : "Not set.");
    add("comms", p.communications.medevac.length ? "ok" : "warning", "MEDEVAC communications", p.communications.medevac[0] || "No frequency or call sign set.");
    var failed = p.source_manifest.filter(function (s) { return s.state === "failed"; });
    if (failed.length) add("sources", "warning", "Sources reached", "Not reached: " + failed.map(function (s) { return s.name; }).join(", ") + ".");
    var status = it.some(function (x) { return x.level === "blocking"; }) ? "BLOCKING" : it.some(function (x) { return x.level === "warning"; }) ? "WARNING" : "VALID";
    return { status: status, label: { VALID: "GREEN: plan complete", WARNING: "AMBER: medical verification required", BLOCKING: "RED: blocking error" }[status], items: it, rule: "osap.medplan.validate/1" };
  }
  /* the plan as stable JSON for its SHA-256 fingerprint: sorted keys; the fingerprint and the update time left out */
  function canonical(p) {
    function walk(x) {
      if (Array.isArray(x)) return x.map(walk);
      if (x && typeof x === "object") { var o = {}; Object.keys(x).sort().forEach(function (k) { if (k !== "fingerprint" && k !== "updated_at") o[k] = walk(x[k]); }); return o; }
      return x;
    }
    return JSON.stringify(walk(p));
  }

  root.OSAP_MEDPLAN_MODEL = { SCHEMA: SCHEMA, build: build, validate: validate, canonical: canonical, names: names, core: core };
})(typeof window !== "undefined" ? window : globalThis);
