/* AXIOM OSAP: the medical plan as one object (Medical Planner Build Plan v2, phase 0).
   build(input) turns what the plan worked out (assets/osap-medplan.js: the casualty pathways, routes, air bases, unit details,
   weather and the state of every source) into one MedicalPlan record; validate(plan) rates it VALID, WARNING or BLOCKING by
   fixed rules. The screen, the print view and the fingerprint all read this one record, so a printed plan can never say one
   thing in one section and another elsewhere. Pure: no page, no network, no AI; the same input always gives the same plan.
   Terms: a casualty's path runs POI > stabilization > definitive care. Internally the plan still picks Primary, Secondary and
   Tertiary per casualty type; here a Tertiary (or a Secondary when it is the last planned stop) is the definitive care and the
   stops before it are stabilization. Air assets are POTENTIAL (an air rescue base found in open data) or PLANNED (entered by
   the planner), or CONFIRMED when the planner records the provider's confirmation (phase 4, assets/osap-medplan-air.js), which expires. Receiving acceptance
   is UNKNOWN until a planner records it. */
(function (root) {
  "use strict";
  var SCHEMA = "osap-medplan/5";
  var STAGE = { stabilization: "stabilization", primary: "stabilization", secondary: "stabilization", tertiary: "definitive" };
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
  /* a CCP, AXP or HLZ: what the planner typed, its grid, and the planner's own check (status, when, capacity, notes) */
  var SITE_STATUS = { usable: "USABLE", limited: "LIMITED", unusable: "UNUSABLE" };
  function point(text, ll, role, v, k) {
    v = v || {}; var st = !blank(text) && SITE_STATUS[v[k + "_st"]];
    return { role: role, text: str(text), lat: ll ? ll[0] : null, lon: ll ? ll[1] : null, mgrs: ll && ll.mgrs || "", status: blank(text) ? "NOT_SET" : st || "PLANNER_ENTERED",
      verified_at: st ? v[k + "_at"] || null : null, capacity: blank(text) ? "" : str(v[k + "_cap"]).slice(0, 60), notes: blank(text) ? "" : str(v[k + "_note"]).slice(0, 200) };
  }
  function fac(f) {
    return { id: f.id, name: f.name, name_local: f.name_local || "", aliases: f.aliases || [], lat: f.lat, lon: f.lon, mgrs: f.mgrs || "", caps: f.caps || {},
      caps_now: f.caps_now || {}, intel: f.intel || null, designation: f.designation || "", source: f.source || "" };
  }

  function mins(sec) { var m = Math.round((+sec || 0) / 60); return m < 60 ? m + " min" : Math.floor(m / 60) + " h " + ("0" + m % 60).slice(-2) + " min"; }
  /* the road lines to each hospital: P is the plan's own route (its time drives the plan); A and C, and the hazards along every
     line, come from the Route tab's alternates (phase 3). router_time_s is the router's time for that line, so A and C compare
     with P like for like. */
  function groundRoutes(I) {
    var pac = {}, out = [];
    (I.pac || []).forEach(function (x) { pac[x.facility_id] = x; });
    (I.routes || []).forEach(function (r) {
      var L = (pac[r.facility_id] || {}).lines || [], p = L.filter(function (l) { return l.id === "P"; })[0];
      out.push({ facility_id: r.facility_id, option: "P", time_s: r.s, distance_m: r.m, source: r.src || "", basis: r.s == null ? "not routed" : "road router",
        router_time_s: p ? p.s : null, hazards: p ? p.hazards : null });
      L.forEach(function (l) {
        if (l.id === "P") return;
        out.push({ facility_id: r.facility_id, option: l.id, time_s: l.s, distance_m: l.m, source: l.src || "", how: l.how || "", basis: "road router", router_time_s: l.s, hazards: l.hazards });
      });
    });
    return out;
  }

  /* ---------- the medical operational picture (phase 5) ----------
     What the other OSAP layers say about this plan, as flags a planner reads first: the hazards OSAP holds along the primary
     route (a flood warning above all) with the alternate that avoids them, the forecast at the primary HLZ against fixed
     rotary-wing review rules, heavy rain, the air MEDEVAC state, and how old every dataset is. Each flag is a prompt to
     check, never a clearance or a decision; the rules are fixed and named so the same input always flags the same way. */
  var PIC = { vis_m: 1600, gust_kn: 30, lc: 90, rain_mm: 20, rule: "osap.medplan.picture/1" };
  var FLOOD = /flood|inundat|flash.?water/i;
  function isFlood(h) { return FLOOD.test(str(h.kind) + " " + str(h.text)); }
  function hrs(a, b) { var x = Date.parse(a), y = Date.parse(b); return isFinite(x) && isFinite(y) ? Math.max(0, Math.round((y - x) / 36e5)) : null; }
  function ageWord(h) { return h == null ? "age unknown" : h < 1 ? "under 1 hour old" : h < 48 ? h + " h old" : Math.round(h / 24) + " days old"; }
  /* each dataset with when its content dates from (not when this device fetched it) and whether it is past its use-by */
  function dataAge(rows, now) {
    return (rows || []).map(function (x) {
      var at = x.at || null, h = at ? hrs(at, now) : null, ex = x.expires_at || null;
      var stale = at == null ? true : ex ? !(Date.parse(now) < Date.parse(ex)) : x.stale_h != null && h != null && h > x.stale_h;
      return { key: x.key, label: x.label, at: at, age_h: h, basis: str(x.basis), live: !!x.live, kind: x.live ? "live" : x.expires_at || x.key === "verification" || x.key === "aircraft" ? "record" : "snapshot", stale_after_h: x.stale_h == null ? null : x.stale_h, expires_at: ex, stale: stale,
        state: at == null ? "NONE" : stale ? "STALE" : "CURRENT", note: str(x.note) };
    });
  }
  function picture(p, I) {
    var F = [], now = I.now || I.built_at || "";
    function flag(code, level, text, detail, src) { F.push({ code: code, level: level, text: text, detail: detail || "", source: src || "" }); }
    /* the primary road line to the definitive facility and the hazards OSAP holds along it */
    var def = p.definitive, ga = def && (p.ground_alternates || []).filter(function (x) { return x.facility_id === def.facility_id; })[0];
    var pl = def && p.ground_routes.filter(function (r) { return r.facility_id === def.facility_id && r.option === "P"; })[0];
    var alts = def ? p.ground_routes.filter(function (r) { return r.facility_id === def.facility_id && r.option !== "P" && r.hazards; }) : [];
    if (pl && ga && ga.state === "done" && pl.hazards && pl.hazards.length) {
      var hz = pl.hazards, fl = hz.filter(isFlood), pt = pl.router_time_s;
      var clear = (fl.length ? alts.filter(function (r) { return !r.hazards.some(isFlood); }) : alts.filter(function (r) { return r.hazards.length < hz.length; }))
        .sort(function (a, b) { return a.time_s - b.time_s; })[0];
      var head = fl.length ? "PRIMARY ROUTE INTERSECTS FLOOD WARNING" : "PRIMARY ROUTE PASSES " + hz.length + " REPORTED HAZARD" + (hz.length === 1 ? "" : "S");
      var tail = clear ? "ALTERNATE ROUTE " + clear.option + " AVAILABLE " + (pt != null ? "+" + Math.round(Math.max(0, clear.time_s - pt) / 60) + " MINUTES" : "(TIME NOT KNOWN)") : "NO CLEARER ALTERNATE ROUTE FOUND";
      var first = (fl[0] || hz[0]);
      flag(fl.length ? "route.flood" : "route.hazard", "warning", head + " / " + tail,
        "To " + def.name + ": " + first.kind + " at " + first.at_km + " km along, " + first.off_km + " km off the road" + (first.text ? " (" + first.text + ")" : "") + (first.src ? ", " + first.src : "") +
        (clear ? ". Line " + clear.option + " has " + (fl.length ? "no flood warning" : clear.hazards.length + " hazard" + (clear.hazards.length === 1 ? "" : "s")) + " held within " + ga.hazard_km + " km." : ". Plan a line by hand in the Route tab.") +
        " Check against current reporting.", "OSAP hazards along the route (" + ga.hazard_km + " km, " + ga.hazard_days + " days)");
    }
    /* heavy rain at the point of injury: roads and landing zones may flood */
    var wet = (I.weather_days || []).filter(function (d) { return d.rain != null && d.rain >= PIC.rain_mm; })[0];
    if (wet) flag("weather.rain", "warning", "HEAVY RAIN FORECAST " + Math.round(wet.rain) + " MM " + wet.day + " / ROADS AND LANDING ZONES MAY FLOOD", "Forecast for the point of injury. Check the routes and the HLZ on the day.", "Open-Meteo forecast");
    /* the forecast at the primary HLZ (or at the point of injury when the HLZ has no grid) against rotary-wing review rules */
    var hw = I.hlz_wx;
    if (hw) {
      var where = hw.hlz ? "PRIMARY HLZ" : "POINT OF INJURY (NO HLZ GRID)";
      if (hw.err) flag("weather.hlz", "warning", where + " FORECAST NOT READ / CHECK AVIATION WEATHER", "The forecast for " + (hw.name || "the pickup") + " could not be read: " + hw.err + ".", "Open-Meteo forecast");
      else {
        var bad = (hw.days || []).map(function (d) {
          var w = [];
          if (d.vis != null && d.vis < PIC.vis_m) w.push("VISIBILITY FORECAST " + (Math.round(d.vis / 100) / 10) + " KM");
          if (d.gust != null && d.gust >= PIC.gust_kn) w.push("GUSTS " + Math.round(d.gust) + " KN");
          if (d.lc != null && d.lc >= PIC.lc) w.push("LOW CLOUD " + Math.round(d.lc) + "%");
          return { d: d, w: w };
        }).filter(function (x) { return x.w.length; })[0];
        if (bad) flag("weather.hlz", "warning", where + " " + bad.w.join(", ") + " / AIR EVACUATION REVIEW REQUIRED",
          bad.d.day + " (UTC day) at " + (hw.mgrs || hw.name || "the pickup") + ". Rules: visibility under " + PIC.vis_m / 1000 + " km, gusts " + PIC.gust_kn + " kn or more, low cloud " + PIC.lc + "% or more. Model values for one point; use an aviation forecast for the flying decision.", "Open-Meteo forecast");
      }
    }
    /* air MEDEVAC: only a confirmed aircraft inside its limits is an air option */
    var conf = p.evacuation_assets.filter(function (a) { return a.kind === "air" && a.status === "CONFIRMED"; }), fit = conf.filter(function (a) { return !(a.limits_now || []).length; });
    if (!fit.length) flag("air.none", "warning", conf.length ? "CONFIRMED AIRCRAFT STOPPED BY ITS LIMITS NOW / GROUND EVACUATION PLANNED" : "NO CONFIRMED AIR MEDEVAC / GROUND EVACUATION PLANNED",
      conf.length ? conf[0].name + ": " + conf[0].limits_now.join("; ") + "." : "Air times are potential only until a provider confirms an aircraft (section 4).", "planner's aircraft records");
    /* data age: anything past its use-by, or never read, is said, never shown as if live */
    var ages = dataAge(I.data_age, now);
    ages.forEach(function (a) {
      if (a.state === "CURRENT") return;
      flag("data.age." + a.key, "warning", a.label.toUpperCase() + (a.state === "NONE" ? " NOT AVAILABLE" : " " + ageWord(a.age_h).toUpperCase()) + " / CONFIRM BEFORE USE",
        (a.state === "NONE" ? "No date for it on this device" : "Dated " + a.at.slice(0, 16).replace("T", " ") + "Z" + (a.expires_at ? ", expired " + a.expires_at.slice(0, 16).replace("T", " ") + "Z" : a.stale_after_h != null ? ", older than " + (a.stale_after_h >= 48 ? Math.round(a.stale_after_h / 24) + " days" : a.stale_after_h + " h") : "")) +
        (a.basis ? " (" + a.basis + ")" : "") + (a.note ? ". " + a.note : "") + ".", a.label);
    });
    return { flags: F, data_age: ages, offline: !!I.offline, rule: PIC.rule, rules: { hlz_vis_m: PIC.vis_m, hlz_gust_kn: PIC.gust_kn, hlz_low_cloud_pct: PIC.lc, rain_mm: PIC.rain_mm } };
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
      /* a stabilization stop (the quickest hospital inside the golden hour when the first MTF is beyond it) comes first and is
         never the definitive care */
      var stops = filled.filter(function (r) { return r.stop; }).sort(function (a, b) { return (b.role === "stabilization") - (a.role === "stabilization"); });
      var mtf = stops.filter(function (r) { return r.role !== "stabilization"; });
      /* the definitive care is the last planned stop that reaches Tertiary care, else the last planned stop */
      var last = mtf.filter(function (r) { return r.role === "tertiary"; })[0] || mtf[mtf.length - 1] || null;
      var path = [];
      stops.forEach(function (r) {
        var stage = r === last ? "definitive" : STAGE[r.role] === "definitive" ? "definitive" : "stabilization";
        path.push({ stage: stage, role: r.role, facility_id: r.facility.id, name: r.facility.name, way: r.way, time_s: r.time_s, basis: "estimate" });
        addFac(stage === "definitive" ? defi : stab, r.facility, { for: [c.id], role: r.role, way: r.way, time_s: r.time_s });
      });
      /* alternate MTFs: another hospital that also qualifies on documented care; never a planned stop */
      rows.forEach(function (r) {
        if (!r.alt || !r.alt.facility) return;
        addFac(alts, r.alt.facility, { for: [c.id], role: r.role, why: "alternate " + r.role + ": also qualifies on documented care", way: r.alt.way, time_s: r.alt.time_s });
      });
      filled.filter(function (r) { return !r.stop && r.stabilisation_option; }).forEach(function (r) {
        addFac(alts, r.facility, { for: [c.id], role: r.role, why: "bypassed: going direct reaches the needed care sooner; stays the stabilization option", way: r.way, time_s: r.time_s });
      });
      var gaps = rows.filter(function (r) { return r.state !== "filled" && r.role !== "stabilization"; }).map(function (r) { return r.role; });
      if (!last) unresolved.push({ code: "no_definitive." + c.id, text: "No definitive care documented for " + c.label.toLowerCase() });
      /* phase 2: each stabilise-or-bypass decision with its time to the required care, part by part */
      var decisions = rows.filter(function (r) { return r.decision; }).map(function (r) { return Object.assign({ to_role: r.role }, r.decision); });
      profiles.push({ id: c.id, label: c.label, pathway: path, gaps: gaps, stabilization_gap: rows.some(function (r) { return r.role === "stabilization" && r.state !== "filled"; }), bypass: path.length && stops.length < filled.length, decisions: decisions });
    });
    var trauma = profiles.filter(function (p) { return p.id === "cat.major_trauma"; })[0] || profiles[0] || null;
    var def = trauma ? trauma.pathway.filter(function (x) { return x.stage === "definitive"; })[0] : null;
    var defF = def ? F[def.facility_id] : null;
    var v = I.fields || {};
    var air = (I.air_bases || []).map(function (b) { return { kind: "air", name: b.name, base: b.name, lat: b.lat, lon: b.lon, phone: b.phone || "", status: "POTENTIAL", source: "OpenStreetMap air rescue base", last_confirmed: null }; });
    ["medevac1", "medevac2"].forEach(function (k, i) { if (!blank(v[k])) air.unshift({ kind: "air", name: str(v[k]), status: "PLANNED", source: "planner (unit details " + (i ? "alternate" : "primary") + ")", last_confirmed: null }); });
    /* phase 4: the aircraft the planner recorded, each with its status now (a confirmation past its time reads UNKNOWN) */
    (I.aircraft || []).slice().reverse().forEach(function (a) {
      air.unshift({ kind: "air", id: a.id, name: a.provider + (a.aircraft_type ? " (" + a.aircraft_type + ")" : ""), provider: a.provider, aircraft_type: a.aircraft_type, base: a.base ? a.base.name : "",
        lat: a.base ? a.base.lat : null, lon: a.base ? a.base.lon : null, status: a.status_now || a.status, recorded_status: a.status, limits_now: a.limits_now || [], launch_time_min: a.launch_min, cruise_speed_kn: a.cruise_kn,
        day_capable: a.day_capable, night_capable: a.night_capable, weather_limits: a.weather_limits, patient_capacity: a.patient_capacity, litter_capacity: a.litter_capacity,
        critical_care_capability: a.critical_care_capability, hoist: a.hoist, request_method: a.request_method, call_sign: a.call_sign, frequency: a.frequency, phone: a.phone,
        source: "planner (aircraft for this plan)", last_confirmed: a.last_confirmed, expires_at: a.expires_at });
    });
    if (!blank(v.casevac)) air.push({ kind: "ground", name: str(v.casevac), status: "PLANNED", source: "planner (CASEVAC vehicles)", last_confirmed: null });
    var plan = {
      schema: SCHEMA, id: "mp-" + str(I.cc) + "-" + (I.poi ? I.poi.lat.toFixed(4) + "_" + I.poi.lon.toFixed(4) : "none"), version: 1,
      created_at: I.built_at || "", updated_at: I.now || I.built_at || "",
      country: { cc: I.cc || "", name: I.country || "" },
      mission: { unit: str(v.unit), mission: str(v.mission), notes: str(v.notes) },
      poi: I.poi ? { lat: I.poi.lat, lon: I.poi.lon, mgrs: I.poi.mgrs || "", set_by: I.poi.set_by || "", environment: I.poi.environment || "land", coast_km: I.poi.coast_km == null ? null : I.poi.coast_km, env_set_by: I.poi.env_set_by || "map" } : null,
      sea_leg: I.sea_leg || null,
      casualty_profiles: profiles,
      stabilization_facilities: stab, definitive_facilities: defi, alternates: alts,
      facilities: F,
      evacuation_assets: air,
      ground_routes: groundRoutes(I),
      ground_alternates: (I.pac || []).map(function (x) { return { facility_id: x.facility_id, state: x.state, error: x.err || "", lines: (x.lines || []).length, hazard_km: x.hazard_km, hazard_days: x.hazard_days }; }),
      air_routes: (I.air_missions || []).map(function (a) { return { facility_id: a.facility_id, asset_id: a.asset_id, provider: a.provider, time_s: a.s, pickup: a.pickup, legs: a.parts, status: "CONFIRMED", basis: "confirmed aircraft; straight-line legs, an estimate" }; })
        .concat((I.air_legs || []).map(function (a) { return { facility_id: a.facility_id, time_s: a.s, status: "POTENTIAL", basis: "straight-line estimate at " + a.kn + " kn from " + a.base + "; not an executable air plan" }; })),
      ccp: [point(v.ccp1, I.ll && I.ll.ccp1, "primary", v, "ccp1"), point(v.ccp2, I.ll && I.ll.ccp2, "alternate", v, "ccp2")],
      axp: [point(v.axp, I.ll && I.ll.axp, "primary", v, "axp")],
      hlz: [point(v.hlz1, I.ll && I.ll.hlz1, "primary", v, "hlz1"), point(v.hlz2, I.ll && I.ll.hlz2, "alternate", v, "hlz2")],
      communications: { medevac: [str(v.freq1), str(v.freq2)].filter(function (x) { return !blank(x); }) },
      receiving: { primary: str(v.recv1), alternate: str(v.recv2) },
      /* the planner's checks of the plan's hospitals (phase 1), oldest first */
      facility_verifications: (I.checks || []).filter(function (c) { return c && F[c.facility_id]; }),
      receiving_acceptance: defi.concat(stab).map(function (x) { return { facility_id: x.facility_id, status: "UNKNOWN", recorded_at: null }; }),
      environmental_conditions: { weather: I.weather || null, at: I.weather_at || "", hlz: I.hlz_wx ? { name: I.hlz_wx.name || "", hlz: !!I.hlz_wx.hlz, mgrs: I.hlz_wx.mgrs || "", at: I.hlz_wx.at || "", error: I.hlz_wx.err || "", days: I.hlz_wx.days || [] } : null },
      unresolved_requirements: unresolved,
      pending: (I.pending || []).slice(),
      approvals: { state: "AUTOMATED_DRAFT", history: [] },
      source_manifest: (I.sources || []).slice(),
      definitive: defF ? { facility_id: defF.id, name: defF.name, time_s: def.time_s, way: def.way } : null,
      fingerprint: null
    };
    plan.operational_picture = picture(plan, I);
    if (defF) CRITICAL.forEach(function (c) { if ((defF.caps || {})[c[0]] !== "yes") unresolved.push({ code: "cap." + c[0], text: c[1] + " at " + defF.name + " not documented" }); });
    plan.validation_status = validate(plan);
    return plan;
  }

  /* ---------- page 1: the medical CONOP for one casualty type (phase 6) ----------
     Read straight from the plan record, never worked out again: the status, the POI, ground and air state, the stabilization
     stop and the definitive care for the casualty type chosen, the state of the P and A lines to it, and the critical gaps
     a planner must close. */
  function conop(p, catId) {
    var prof = p.casualty_profiles.filter(function (c) { return c.id === catId; })[0] || p.casualty_profiles[0] || null;
    function stop(x) {
      if (!x) return null;
      var g = p.ground_routes.filter(function (r) { return r.facility_id === x.facility_id && r.option === "P"; })[0];
      return { facility_id: x.facility_id, name: x.name, way: x.way, time_s: x.time_s, distance_m: g ? g.distance_m : null };
    }
    var path = prof ? prof.pathway : [], stab = stop(path.filter(function (x) { return x.stage === "stabilization"; })[0]), def = stop(path.filter(function (x) { return x.stage === "definitive"; })[0]);
    var routes = def ? p.ground_routes.filter(function (r) { return r.facility_id === def.facility_id; }) : [], P = routes.filter(function (r) { return r.option === "P"; })[0];
    var ga = def && (p.ground_alternates || []).filter(function (x) { return x.facility_id === def.facility_id; })[0], A = routes.filter(function (r) { return r.option !== "P"; })[0];
    var air = p.evacuation_assets.filter(function (a) { return a.kind === "air" && a.status === "CONFIRMED" && !(a.limits_now || []).length; })[0];
    var gaps = [], dF = def && p.facilities[def.facility_id];
    if (!def) gaps.push("Definitive care for " + (prof ? prof.label.toLowerCase() : "this casualty") + " not documented");
    if (dF) CRITICAL.forEach(function (c) { if ((dF.caps || {})[c[0]] !== "yes") gaps.push(c[1]); else if ((dF.caps_now || {})[c[0]] === "UNAVAILABLE") gaps.push(c[1] + " reported not available now"); });
    if (prof && prof.stabilization_gap) gaps.push("No stabilization stop documented inside the golden hour");
    if (def) gaps.push("Receiving hospital acceptance");
    if (!air) gaps.push("Air MEDEVAC provider");
    var sea = p.poi && p.poi.environment === "sea", sl = sea ? p.sea_leg : null;
    if (sea) gaps.push("Air pickup at sea: accepted deck landing or hoist" + (sl && sl.port ? "; landing at " + sl.port + " confirmed with the port" : ""));
    (p.validation_status.items || []).forEach(function (x) { if (x.level === "blocking") gaps.unshift(x.label + ": " + x.detail); });
    return {
      casualty: prof ? { id: prof.id, label: prof.label } : null, status: p.validation_status.status, status_label: p.validation_status.label, poi: p.poi ? p.poi.mgrs : "",
      ground: sea && !(sl && sl.port) ? "NONE: AT SEA, NO LANDING PORT" : P && P.time_s != null ? "AVAILABLE" : def ? "NOT ROUTED" : "NO DESTINATION",
      at_sea: sea, sea_leg: sl && sl.port ? { port: sl.port, nm: sl.nm, kn: sl.kn, s: sl.s } : null,
      air: air ? "CONFIRMED" : "NOT CONFIRMED", air_asset: air ? air.name : "",
      stabilization: stab, stabilization_gap: !!(prof && prof.stabilization_gap), definitive: def, bypass: !!(prof && prof.bypass),
      primary_route: P && P.time_s != null ? "AVAILABLE" : def ? "NOT ROUTED" : "NO DESTINATION",
      alternate_route: !def ? "NO DESTINATION" : A ? "AVAILABLE" : !ga ? "NOT LOOKED FOR" : ga.state === "pending" ? "CHECKING" : "NONE FOUND",
      route_flags: (p.operational_picture && def && p.definitive && p.definitive.facility_id === def.facility_id ? p.operational_picture.flags : []).filter(function (f) { return /^route\./.test(f.code); }).map(function (f) { return f.text; }),
      critical_gaps: gaps
    };
  }

  /* one check: ok, warning or blocking, in the order a planner reads them (Build Plan v2 validation screen) */
  function validate(p) {
    var it = [];
    function add(code, level, label, detail) { it.push({ code: code, level: level, label: label, detail: detail || "" }); }
    if (p.pending && p.pending.length) add("data.pending", "blocking", "Plan data complete", "Still reading: " + p.pending.join(", ") + ". The plan cannot be printed until they finish or fail.");
    else add("data.pending", "ok", "Plan data complete");
    add("poi", p.poi && p.poi.set_by === "poi" ? "ok" : "warning", "Point of injury", p.poi && p.poi.set_by === "poi" ? p.poi.mgrs : "Not set: the plan is centred on " + (p.poi && p.poi.set_by === "c" ? "the map or area centre" : "a stand-in point") + ".");
    /* a point of injury at sea: no road starts there; the road legs start at the landing port after a boat leg */
    if (p.poi && p.poi.environment === "sea") {
      var sl = p.sea_leg;
      add("poi.sea", "warning", "Point of injury at sea", sl && sl.port ? "Road legs start at " + sl.port + " after " + sl.nm + " NM by boat at " + sl.kn + " kn (straight line, not a navigation route). Air pickup needs an accepted deck landing or a hoist; confirm both, and coordinate through the responsible RCC."
        : "No landing port is known within reach: no road leg. Plan air extraction (accepted deck or hoist), prolonged onboard care and early diversion, through the responsible RCC.");
    }
    var stab = p.stabilization_facilities[0], def = p.definitive;
    add("stabilization", stab ? "ok" : "warning", "Stabilization facility", stab ? stab.name : "None documented by a credible source; stabilize en route or confirm a local facility.");
    add("definitive", def ? "ok" : "warning", "Definitive care facility", def ? def.name : "No hospital with the needed care documented by a credible source.");
    var r0 = def && p.ground_routes.filter(function (r) { return r.facility_id === def.facility_id; })[0];
    add("route.primary", r0 && r0.time_s != null ? "ok" : "warning", "Primary ground route", r0 && r0.time_s != null ? (p.sea_leg && p.sea_leg.port ? "Road router, from the landing port " + p.sea_leg.port : "Road router") : p.poi && p.poi.environment === "sea" && !(p.sea_leg && p.sea_leg.port) ? "None: the point of injury is at sea with no landing port known." : def ? "No road route to the definitive facility yet." : "No destination to route to.");
    /* phase 3: the alternate and contingency lines to the definitive facility, and the hazards OSAP holds along the primary */
    var ga = def && (p.ground_alternates || []).filter(function (x) { return x.facility_id === def.facility_id; })[0];
    var lines = def ? p.ground_routes.filter(function (r) { return r.facility_id === def.facility_id && r.option !== "P"; }) : [];
    var pl = def && p.ground_routes.filter(function (r) { return r.facility_id === def.facility_id && r.option === "P"; })[0], pt = pl && pl.router_time_s;
    function plus(r) { return (pt != null && r.time_s != null ? "+" + mins(Math.max(0, r.time_s - pt)) + " on the primary, " : "") + mins(r.time_s) + " drive"; }
    if (!def) add("route.alternate", "warning", "Alternate ground route", "No destination to route to.");
    else if (!ga) add("route.alternate", "warning", "Alternate ground route", "Not looked for.");
    else if (ga.state === "pending") add("route.alternate", "warning", "Alternate ground route", "Still looking.");
    else if (ga.state === "failed") add("route.alternate", "warning", "Alternate ground route", "None found (" + ga.error + "); plan one by hand.");
    else if (!lines.length) add("route.alternate", "warning", "Alternate ground route", "The routers gave no distinct alternate line; plan one by hand.");
    else add("route.alternate", "ok", "Alternate ground route", lines.map(function (r) { return r.option + " " + plus(r); }).join(", ") + (lines.length < 2 ? "; no contingency line" : "") + ". The planner decides which line to drive.");
    var hz = pl && pl.hazards;
    if (!def || !ga || ga.state !== "done" || !pl) { /* nothing to check the hazards on yet: the items above say why */ }
    else if (hz == null) add("route.hazards", "warning", "Hazards along the primary route", "Could not be checked on this device.");
    else if (hz.length) {
      var calm = lines.filter(function (r) { return r.hazards && r.hazards.length < hz.length; })[0];
      add("route.hazards", "warning", "Hazards along the primary route", hz.length + " reported within " + ga.hazard_km + " km in the last " + ga.hazard_days + " days, first: " + hz[0].kind + " at " + hz[0].at_km + " km" +
        (calm ? "; line " + calm.option + " has " + calm.hazards.length : "") + ". Check against current reporting.");
    }
    else add("route.hazards", "ok", "Hazards along the primary route", "None held within " + ga.hazard_km + " km in the last " + ga.hazard_days + " days (not a clearance).");
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
    var fit = conf.filter(function (a) { return !(a.limits_now || []).length; }), lapsed = p.evacuation_assets.filter(function (a) { return a.kind === "air" && a.recorded_status === "CONFIRMED" && a.status !== "CONFIRMED"; });
    add("medevac.provider", fit.length ? "ok" : "warning", "Air MEDEVAC provider",
      fit.length ? fit[0].name + " confirmed" + (fit[0].expires_at ? " until " + fit[0].expires_at.slice(0, 16).replace("T", " ") + "Z" : "") :
      conf.length ? conf[0].name + " confirmed but stopped by its limits now: " + conf[0].limits_now.join("; ") + "." :
      lapsed.length ? lapsed[0].name + ": confirmation expired; confirm again." :
      planned.length ? planned[0].name + " (entered, not confirmed). Air does not compete with the road until an aircraft is confirmed." : "None confirmed. Air does not compete with the road until an aircraft is confirmed.");
    /* phase 3: a CCP, AXP or HLZ is a map object only with a grid; a name alone cannot be drawn, routed or flown to */
    function site(code, label, x) {
      if (x.status === "NOT_SET") add(code, "warning", label, "Not set.");
      else if (x.lat == null) add(code, "warning", label, x.text + ": no grid, so it is not on the map. Give an MGRS grid or lat, lon.");
      else if (x.status === "UNUSABLE") add(code, "warning", label, x.text + ": checked not usable" + (x.verified_at ? " (" + x.verified_at.slice(0, 16).replace("T", " ") + "Z)" : "") + (x.notes ? ": " + x.notes : "") + ". Choose another.");
      else if (x.status === "LIMITED") add(code, "warning", label, x.text + ": usable with limits" + (x.notes ? ": " + x.notes : "") + ".");
      else add(code, "ok", label, x.text + (x.status === "USABLE" && x.verified_at ? " (checked usable " + x.verified_at.slice(0, 16).replace("T", " ") + "Z)" : ""));
    }
    site("ccp", "Casualty collection point (CCP)", p.ccp[0]);
    site("axp", "Ambulance exchange point (AXP)", p.axp[0]);
    site("hlz", "Helicopter landing zone (HLZ)", p.hlz[0]);
    site("hlz.alternate", "Alternate HLZ", p.hlz[1]);
    /* phase 5: the forecast at the pickup and the age of the data the plan stands on */
    var op = p.operational_picture;
    if (op) {
      var wf = op.flags.filter(function (f) { return f.code === "weather.hlz"; })[0], hw = p.environmental_conditions && p.environmental_conditions.hlz;
      if (wf) add("weather.hlz", "warning", "Forecast at the pickup", wf.text + ". " + wf.detail);
      else if (hw && hw.days && hw.days.length) add("weather.hlz", "ok", "Forecast at the pickup", "No review rule met at " + (hw.hlz ? "the primary HLZ" : "the point of injury (the HLZ has no grid)") + " for the next " + hw.days.length + " days (not a flying decision).");
      var st = op.data_age.filter(function (a) { return a.state !== "CURRENT"; });
      if (op.data_age.length) add("data.age", st.length ? "warning" : "ok", "Data age", st.length ? st.map(function (a) { return a.label + (a.state === "NONE" ? " not available" : " " + ageWord(a.age_h)); }).join("; ") + "." :
        "Every dataset is within its use-by" + (op.offline ? " (this device is offline: saved copies)" : "") + ".");
    }
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

  root.OSAP_MEDPLAN_MODEL = { SCHEMA: SCHEMA, PIC: PIC, build: build, validate: validate, picture: picture, conop: conop, dataAge: dataAge, canonical: canonical, names: names, core: core };
})(typeof window !== "undefined" ? window : globalThis);
