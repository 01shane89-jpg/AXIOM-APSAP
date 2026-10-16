/* AXIOM OSAP: air MEDEVAC assets and missions (Medical Planner Build Plan v2, phase 4).
   An aircraft the planner records for the plan, with a status:
     CONFIRMED    the provider has confirmed it for this mission; the confirmation expires (12 hours unless the planner sets
                  another time) and then reads UNKNOWN again
     PLANNED      entered by the planner, not yet confirmed
     POTENTIAL    found in open data (an air rescue base), never confirmed
     UNAVAILABLE  the provider says it cannot fly this mission
     UNKNOWN      nothing said, or a confirmation past its time
   Only a CONFIRMED aircraft, inside its time and not stopped by its own limits, competes with ground transport when the
   plan picks destinations. Every other aircraft is shown for planning, never used for the plan's choice.
   A mission is worked out leg by leg, not as distance / speed:
     call + mission approval + launch + base to pickup + time on the ground + pickup to hospital + handoff
   The pickup is the primary HLZ when it has a grid, else the point of injury (said so). Flight legs are straight lines at the
   aircraft's cruise speed: estimates, without routing, winds, refuelling or crew duty.
   Pure: no page, no network, no AI. assets/osap-medplan.js stores the aircraft on this device and draws them. */
(function (root) {
  "use strict";
  var STATUS = ["CONFIRMED", "PLANNED", "POTENTIAL", "UNAVAILABLE", "UNKNOWN"];
  var STATUS_LABEL = { CONFIRMED: "Confirmed", PLANNED: "Planned, not confirmed", POTENTIAL: "Potential (open data)", UNAVAILABLE: "Unavailable", UNKNOWN: "Unknown" };
  var DEF = { call_min: 5, approval_min: 10, launch_min: 15, ground_min: 10, handoff_min: 5, cruise_kn: 120, valid_h: 12 };
  var MAX_ASSETS = 20;

  function str(x) { return x == null ? "" : String(x); }
  function clip(s, n) { s = str(s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n) : s; }
  function ms(iso) { var t = Date.parse(iso); return isFinite(t) ? t : NaN; }
  function numIn(x, lo, hi, d) { if (x == null || x === "") return d; x = +x; return isFinite(x) && x >= lo && x <= hi ? x : NaN; }
  function yn(x) { return x === true || x === "yes" ? "yes" : x === false || x === "no" ? "no" : "unknown"; }
  var RAD = Math.PI / 180;
  function hav(a, b) {
    var dl = (b[0] - a[0]) * RAD, dn = (b[1] - a[1]) * RAD;
    var h = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dn / 2) * Math.sin(dn / 2);
    return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function flyS(m, kn) { return m / (kn * 1852 / 3600); }

  /* an aircraft from what the planner typed, or { errors } saying what is wrong; nothing typed is trusted as markup */
  function makeAsset(x, nowIso) {
    var e = [], t = ms(x.last_confirmed || nowIso);
    var provider = clip(x.provider, 120), status = STATUS.indexOf(x.status) >= 0 ? x.status : null;
    if (!provider) e.push("provider");
    if (!status) e.push("status");
    var lat = +x.base_lat, lon = +x.base_lon, hasBase = x.base_lat !== "" && x.base_lat != null && isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    if (!hasBase) e.push("base grid");
    var n = {};
    [["call_min", 0, 120], ["approval_min", 0, 240], ["launch_min", 0, 240], ["ground_min", 0, 120], ["handoff_min", 0, 60], ["cruise_kn", 40, 600], ["valid_h", 1, 168]].forEach(function (k) {
      n[k[0]] = numIn(x[k[0]], k[1], k[2], DEF[k[0]]); if (!isFinite(n[k[0]])) e.push(k[0].replace(/_/g, " "));
    });
    var vis = numIn(x.min_vis_km, 0, 20, null), gust = numIn(x.max_gust_kn, 0, 100, null), litters = numIn(x.litter_capacity, 0, 20, null);
    if (vis !== null && !isFinite(vis)) e.push("minimum visibility");
    if (gust !== null && !isFinite(gust)) e.push("maximum gust");
    if (litters !== null && !isFinite(litters)) e.push("litter capacity");
    if (status === "CONFIRMED" && !isFinite(t)) e.push("confirmation time");
    if (e.length) return { errors: e };
    var id = clip(x.id, 80) || "air:" + new Date(isFinite(t) ? t : ms(nowIso)).toISOString() + ":" + provider.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
    return {
      id: id, provider: provider, aircraft_type: clip(x.aircraft_type, 60), base: { name: clip(x.base_name, 120) || provider, lat: lat, lon: lon },
      status: status, call_min: n.call_min, approval_min: n.approval_min, launch_min: n.launch_min, ground_min: n.ground_min, handoff_min: n.handoff_min,
      cruise_kn: n.cruise_kn, day_capable: yn(x.day_capable), night_capable: yn(x.night_capable), weather_limits: { min_vis_km: vis, max_gust_kn: gust },
      patient_capacity: clip(x.patient_capacity, 40), litter_capacity: litters, critical_care_capability: yn(x.critical_care_capability), hoist: yn(x.hoist),
      request_method: clip(x.request_method, 160), call_sign: clip(x.call_sign, 40), frequency: clip(x.frequency, 40), phone: clip(x.phone, 40),
      last_confirmed: status === "CONFIRMED" ? new Date(t).toISOString() : null, valid_h: n.valid_h,
      expires_at: status === "CONFIRMED" ? new Date(t + n.valid_h * 3600000).toISOString() : null, by: "planner on this device"
    };
  }
  /* add or replace an aircraft (same id) in the list; the list keeps its newest MAX_ASSETS */
  function upsert(list, a) {
    var L = (Array.isArray(list) ? list : []).filter(function (x) { return x && x.id !== a.id; });
    L.push(a); return L.slice(-MAX_ASSETS);
  }
  /* the status now: a confirmation past its time reads UNKNOWN */
  function state(a, nowIso) {
    if (!a) return { status: "UNKNOWN", expired: false };
    if (a.status === "CONFIRMED") { var ex = !(ms(nowIso) < ms(a.expires_at)); return { status: ex ? "UNKNOWN" : "CONFIRMED", expired: ex, was: ex ? "CONFIRMED" : null }; }
    return { status: a.status, expired: false };
  }
  /* what stops the aircraft now, from its own limits: night without night capability, forecast visibility or gusts past its
     limits. wx: { night: bool, vis_km, gust_kn } for the time of the mission, any of them null when not known */
  function limits(a, wx) {
    var L = [];
    wx = wx || {};
    if (wx.night === true && a.night_capable !== "yes") L.push(a.night_capable === "no" ? "not night capable" : "night capability not known");
    if (wx.night === false && a.day_capable === "no") L.push("not day capable");
    var w = a.weather_limits || {};
    if (w.min_vis_km != null && wx.vis_km != null && wx.vis_km < w.min_vis_km) L.push("forecast visibility " + wx.vis_km + " km below its " + w.min_vis_km + " km minimum");
    if (w.max_gust_kn != null && wx.gust_kn != null && wx.gust_kn > w.max_gust_kn) L.push("forecast gusts " + Math.round(wx.gust_kn) + " kn above its " + w.max_gust_kn + " kn limit");
    return L;
  }
  /* one mission: the aircraft from its base to the pickup and on to the hospital, leg by leg */
  function mission(a, pickup, dest, o) {
    o = o || {};
    var kn = a.cruise_kn, inM = hav([a.base.lat, a.base.lon], pickup.ll), outM = hav(pickup.ll, dest.ll);
    var parts = [
      { code: "call", label: "call", s: a.call_min * 60 },
      { code: "approval", label: "mission approval", s: a.approval_min * 60 },
      { code: "launch", label: "launch", s: a.launch_min * 60 },
      { code: "inbound", label: "fly " + (a.base.name || "base") + " to " + pickup.name, s: Math.round(flyS(inM, kn)), m: Math.round(inM) },
      { code: "ground", label: "on the ground at " + pickup.name, s: a.ground_min * 60 },
      { code: "outbound", label: "fly to " + dest.name, s: Math.round(flyS(outM, kn)), m: Math.round(outM) },
      { code: "handoff", label: "handoff", s: a.handoff_min * 60 }
    ];
    var st = state(a, o.now), lim = limits(a, o.wx), total = parts.reduce(function (t, p) { return t + p.s; }, 0);
    var why = [];
    if (st.status !== "CONFIRMED") why.push(st.expired ? "confirmation expired " + a.expires_at.slice(0, 16).replace("T", " ") + "Z" : STATUS_LABEL[st.status].toLowerCase());
    why = why.concat(lim);
    return { asset_id: a.id, provider: a.provider, status: st.status, pickup: pickup.name, pickup_is_hlz: !!pickup.hlz, facility_id: dest.id, parts: parts, total_s: total,
      competes: !why.length, not_competing: why, basis: "estimate: straight-line legs at " + kn + " kn" };
  }
  /* the quickest mission to a hospital from the aircraft that compete, or null when none does */
  function best(assets, pickup, dest, o) {
    var b = null;
    (assets || []).forEach(function (a) { var m = mission(a, pickup, dest, o); if (m.competes && (!b || m.total_s < b.total_s)) b = m; });
    return b;
  }

  /* air medical services documented by a government or the service's own published page, per country (Shane 2026-10-06:
     "We NEED to know about air medevac"). A documented service is not an aircraft for this mission: it is who to ask and how,
     with the source's own words. It never competes with the road; only an aircraft the planner records as CONFIRMED does.
     Published institutional numbers only. fp: SHA-256 of the entry's canonical JSON (keys sorted, fp left out), checked by
     tests/medplan_air.test.mjs. A country without an entry has none documented in OSAP yet, which is not "no air medevac". */
  var DIRECTORY = {
    th: [{
      id: "th-niem-sky-doctor", provider: "Thai Sky Doctor (National Institute for Emergency Medicine, NIEM)", kind: "public air medical service",
      request: "Call 1669, Thailand's emergency medical number, and ask for Sky Doctor air transport", phone: "1669",
      missions: "Scene pickup by helicopter (HEMS, primary mission); hospital-to-hospital transfer by helicopter or aeroplane (secondary mission)",
      aircraft: "Aircraft of government and private agencies under agreement with NIEM; the Royal Thai Police, Royal Thai Air Force and Marine Police support its missions",
      bases: "Not published in the source", eligibility: "Not stated in the source: confirm cost, eligibility and response time with 1669",
      quote: "Calls for this service, like a medical emergency call, can be made using the 1669 system.",
      quote2: "Primary Mission is an emergency operation that is performed before reaching the hospital, known as a Helicopter Emergency Medical Service (HEMS), operated by helicopter only",
      src: "https://thailand.go.th/issue-focus-detail/001_07_002-2", srcname: "THAILAND.GO.TH (Royal Thai Government): Thai Sky Doctor: Air Patient Assistance Program",
      page_updated: "2023-07-12", read: "2026-10-06",
      fp: "a010b2e66a283b3ad8844f6d23e0e864f2504c48b1eca78f7ad8c10d8cb45f9a"
    }]
  };
  Object.keys(DIRECTORY).forEach(function (k) { DIRECTORY[k].forEach(Object.freeze); Object.freeze(DIRECTORY[k]); }); Object.freeze(DIRECTORY);
  function providers(cc) { return (DIRECTORY[String(cc || "").toLowerCase()] || []).map(function (d) { return Object.assign({}, d); }); }

  root.OSAP_MEDAIR = { STATUS: STATUS, STATUS_LABEL: STATUS_LABEL, DEF: DEF, MAX_ASSETS: MAX_ASSETS, makeAsset: makeAsset, upsert: upsert, state: state, limits: limits, mission: mission, best: best, providers: providers, DIRECTORY: DIRECTORY };
})(typeof window !== "undefined" ? window : globalThis);
