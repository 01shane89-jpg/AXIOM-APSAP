/* AXIOM OSAP: facility intelligence (Medical Planner Build Plan v2, phase 1).
   Every capability of a hospital carries two separate answers:
     exists     does the hospital have it at all, graded by who says so:
                  V1 human verified   a planner's own check (phone call, visit, liaison), recorded on this device
                  V2 official source  an official register (for example a current HA Thailand certificate)
                  V3 facility reported the hospital's own page, or OSAP's sourced list quoting it
                  V4 community source  OpenStreetMap, Wikidata, Wikipedia
                  U  unknown           no source says
     available  can it be used now: only a planner's check says so, and that answer expires (24 hours unless the planner
                sets another time). Past its expiry it reads UNKNOWN again, with when it was last checked.
   So "the hospital owns a CT" is never read as "the CT works and is free now".
   A planner's check is a decision record: append-only, attributed to the planner on this device (a role, never a name),
   with how it was checked, when, and what it replaced. The newest check for a capability wins; a check that says
   "not said" for both answers leaves the sources as they were, which is how a mistaken check is undone.
   Pure: no page, no network, no AI. assets/osap-medplan.js stores the checks and applies them. */
(function (root) {
  "use strict";
  var GRADE = { V1: "Human verified", V2: "Official source", V3: "Facility reported", V4: "Community source", U: "Unknown" };
  var METHOD = { phone: "Phone call", visit: "Visit", liaison: "Liaison officer or medical channel", other: "Other" };
  var EXISTS = ["yes", "no", "unknown"], NOW = ["available", "unavailable", "unknown"];
  var DEF_HOURS = 24, MAX_HOURS = 24 * 30, MAX_LOG = 2000;
  /* Build Plan v2's facility capability names, mapped onto the plan's capability flags */
  var CAP_MAP = {
    emergency_department: "ed.basic", ct: "dx.ct", mri: "dx.mri", surgery: "surg.general", emergency_or: "surg.or_emergency",
    anesthesia: "surg.anaesthesia", blood_bank: "blood.bank", massive_transfusion: "blood.mtp", icu: "cc.icu", ventilator: "cc.ventilator",
    neurosurgery: "surg.neuro", orthopedics: "surg.ortho", vascular: "surg.vascular", plastics: "surg.plastic", burns: "spec.burn",
    ophthalmology: "surg.ophthalmology", pediatrics: "spec.pediatric_trauma", obstetrics: "spec.obstetric", cath_lab: "spec.cath_lab",
    stroke: "spec.stroke", hyperbaric: "spec.hyperbaric" };
  var TRANSPORT_MAP = { ambulance: "trans.transfer", helipad: "trans.helipad", critical_care_transfer: "trans.critical_care_transport" };

  function str(x) { return x == null ? "" : String(x); }
  function clip(s, n) { s = str(s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n) : s; }
  function ms(iso) { var t = Date.parse(iso); return isFinite(t) ? t : NaN; }
  function crowd(src) { return !src || src.kind === "osm" || /wiki|openstreetmap/i.test(str(src.name)); }

  /* who says the capability exists */
  function grade(flag) {
    if (!flag || !flag.source || flag.status === "UNKNOWN") return "U";
    var k = flag.source.kind;
    if (k === "planner") return "V1";
    if (k === "register") return "V2";
    if (crowd(flag.source)) return "V4";
    return "V3";
  }

  /* a planner's check from what was typed, or { errors } saying what is wrong; nothing typed is trusted as markup */
  function makeCheck(x, nowIso) {
    var e = [];
    var at = x.at || nowIso, t = ms(at);
    if (!isFinite(t)) e.push("time");
    if (!clip(x.facility_id, 200)) e.push("facility");
    if (!/^[a-z_]+(\.[a-z0-9_]+)+$/.test(str(x.cap))) e.push("capability");
    var ex = EXISTS.indexOf(x.exists) >= 0 ? x.exists : null, nw = NOW.indexOf(x.now) >= 0 ? x.now : null;
    /* usable now means it exists */
    if (ex === "unknown" && nw === "available") ex = "yes";
    if (!ex) e.push("exists");
    if (!nw) e.push("available now");
    if (!METHOD[x.method]) e.push("how checked");
    var h = x.valid_h == null || x.valid_h === "" ? DEF_HOURS : +x.valid_h;
    if (!(h > 0 && h <= MAX_HOURS)) e.push("hours");
    if (ex === "no" && nw === "available") e.push("cannot be available now when the hospital does not have it");
    if (e.length) return { errors: e };
    return {
      id: "chk:" + new Date(t).toISOString() + ":" + clip(x.facility_id, 200) + ":" + x.cap,
      facility_id: clip(x.facility_id, 200), facility_name: clip(x.facility_name, 120), cap: x.cap,
      exists: ex, now: nw, method: x.method, contact_role: clip(x.contact_role, 80), note: clip(x.note, 300),
      at: new Date(t).toISOString(), valid_h: h, expires_at: new Date(t + h * 3600000).toISOString(),
      by: "planner on this device", supersedes: x.supersedes || null
    };
  }
  /* add a check to the log (oldest first), naming the check it replaces; the log keeps its newest MAX_LOG entries */
  function addCheck(log, c) {
    var L = (Array.isArray(log) ? log : []).slice(), prev = latest(L, c.facility_id, c.cap);
    if (prev && prev.id === c.id) return L;
    c = Object.assign({}, c, { supersedes: prev ? prev.id : null });
    L.push(c);
    return L.length > MAX_LOG ? L.slice(-MAX_LOG) : L;
  }
  function forFacility(log, id) { return (Array.isArray(log) ? log : []).filter(function (c) { return c && c.facility_id === id; }); }
  function latest(log, id, cap) {
    var b = null;
    forFacility(log, id).forEach(function (c) { if (c.cap === cap && (!b || ms(c.at) >= ms(b.at))) b = c; });
    return b;
  }
  /* is it usable now: AVAILABLE or UNAVAILABLE only from an unexpired planner's check, else UNKNOWN */
  function nowState(c, nowIso) {
    if (!c || c.now === "unknown") return { state: "UNKNOWN", checked_at: c ? c.at : null, expires_at: null, expired: false };
    var expired = ms(nowIso) >= ms(c.expires_at);
    return { state: expired ? "UNKNOWN" : c.now === "available" ? "AVAILABLE" : "UNAVAILABLE", checked_at: c.at, expires_at: c.expires_at, expired: expired, was: c.now.toUpperCase(),
      method: c.method, contact_role: c.contact_role };
  }
  /* the facility's flags with every planner's check applied: a new object, the source flags untouched */
  function apply(caps, log, id, nowIso) {
    var out = {}, C = caps || {};
    Object.keys(C).forEach(function (k) {
      var x = Object.assign({}, C[k]), c = latest(log, id, k);
      if (c && c.exists !== "unknown") {
        var src = { kind: "planner", name: "Planner's check (" + METHOD[c.method].toLowerCase() + ")", url: "", at: c.at };
        x = { status: c.exists === "yes" ? "VERIFIED" : "NOT_AVAILABLE", confidence: "HIGH", availability: C[k].availability || "unknown", source: src,
          how: (c.contact_role ? "confirmed by " + c.contact_role : "confirmed") + (c.note ? ": " + c.note : ""), last_verified: c.at, prior: C[k] };
      }
      x.grade = grade(x);
      x.now = nowState(c, nowIso);
      if (c) x.check_id = c.id;
      out[k] = x;
    });
    return out;
  }
  /* Build Plan v2's Facility object for one hospital */
  function record(f, log, nowIso) {
    var C = f.caps || {}, caps = {}, tr = {};
    function one(k) {
      var x = C[k] || { status: "UNKNOWN" };
      return { flag: k, status: x.status, grade: x.grade || grade(x), grade_label: GRADE[x.grade || grade(x)], available_now: x.now ? x.now.state : "UNKNOWN",
        checked_at: x.now ? x.now.checked_at : null, expires_at: x.now ? x.now.expires_at : null, source: x.source ? { kind: x.source.kind, name: x.source.name, url: x.source.url || "" } : null };
    }
    Object.keys(CAP_MAP).forEach(function (n) { caps[n] = one(CAP_MAP[n]); });
    Object.keys(TRANSPORT_MAP).forEach(function (n) { tr[n] = one(TRANSPORT_MAP[n]); });
    tr.airfield = f.airfield || null;
    var mine = forFacility(log, f.id), last = mine.reduce(function (b, c) { return !b || ms(c.at) > ms(b.at) ? c : b; }, null);
    return {
      id: f.id, name: f.name, aliases: f.aliases || [], country: f.cc || "", coordinates: [f.lat, f.lon], mgrs: f.mgrs || "", type: f.type || "hospital",
      trauma_designation: f.designation || null, capabilities: caps, transport: tr, contacts: f.contacts || {}, sources: f.sources || [],
      verification: { checks: mine.length, last_check: last ? last.at : null,
        current: mine.filter(function (c) { return latest(mine, c.facility_id, c.cap) === c && c.now !== "unknown" && ms(nowIso) < ms(c.expires_at); }).length }
    };
  }

  root.OSAP_FACINTEL = { GRADE: GRADE, METHOD: METHOD, CAP_MAP: CAP_MAP, TRANSPORT_MAP: TRANSPORT_MAP, DEF_HOURS: DEF_HOURS, MAX_LOG: MAX_LOG,
    grade: grade, makeCheck: makeCheck, addCheck: addCheck, latest: latest, forFacility: forFacility, nowState: nowState, apply: apply, record: record };
})(typeof window !== "undefined" ? window : globalThis);
