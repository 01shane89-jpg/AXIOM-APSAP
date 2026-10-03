/* AXIOM OSAP: hospital data layer, base (Shane's hospital build prompt, 2026-10-03, phases 2 and 3).
   Discovery (which facilities exist round a point) and capability assessment (what each can provide) are kept apart.
   Providers discover facilities and hand back canonical facility records; the medical plan reads them through
   window.OSAP_HOSP and never talks to a source itself. Providers, highest authority first:
     country   official national or local health datasets (assets/hospital-sources/countries/<cc>-provider.js), when one exists
     sof       OSAP's researched list (data/sof/<cc>.js): referral hospitals with sourced capabilities
     osm       OpenStreetMap, the global baseline (OSAP's stored copy in data/medfac, live Overpass only where it is missing)
   A country with no adapter works on the global providers alone.

   Canonical facility record, schema "osap-facility/1" (new fields may be added; readers ignore fields they do not know):
     { schema, id (stable: <CC>-<SRC>-<source id>, e.g. TH-OSM-n123), name, name_local, aliases[], country_code, admin1, admin2,
       lat, lon, kind ("hospital" | "clinic"), operator, ownership, official_type, official_designation, beds (null or
       { value, sources }), contact { phone, website, emergency_phone }, address, ids { osm, wikidata, sof, gov },
       capabilities { <code>: capability }, osap_classification, confidence, sources[], record_created, last_checked,
       last_verified, source_last_updated }
   capability: { status, value, sources[] }. status is one of STATUS; "unknown" is never read as "no": a capability is
   "not_available" only where a source says so.
   source: { source_type, source_name, url, observed_date, retrieved_date, reliability (A-F), credibility (1-6), language,
     machine_translated, ai_derived, excerpt, sha256 }. Reliability follows the source type (SOURCE_TYPES), never the domain
   alone: a .go.th page is graded by what kind of page it is.
   Every record is a draft computed by fixed rules from open data: not analyst-approved and not AI. */
(function () {
  "use strict";
  var W = window;
  var SCHEMA = "osap-facility/1";
  var STATUS = ["confirmed", "reported", "not_confirmed", "contradicted", "not_available", "unknown"];
  /* Admiralty-style grading by source type: reliability of the source, credibility of what it says about this field */
  var SOURCE_TYPES = {
    government_registry: { reliability: "A", credibility: "2", label: "Government health registry" },
    accreditation: { reliability: "A", credibility: "2", label: "Accreditation record" },
    official_designation: { reliability: "A", credibility: "1", label: "Official designation" },
    hospital_website: { reliability: "B", credibility: "3", label: "Hospital's own website" },
    institutional: { reliability: "B", credibility: "3", label: "University or institutional page" },
    openstreetmap: { reliability: "C", credibility: "3", label: "OpenStreetMap (open collaborative)" },
    wikidata: { reliability: "C", credibility: "4", label: "Wikidata (open collaborative)" },
    wikipedia: { reliability: "C", credibility: "4", label: "Wikipedia (open collaborative)" },
    directory: { reliability: "D", credibility: "4", label: "Commercial or unverified directory" },
    planner: { reliability: "B", credibility: "2", label: "Planner's own check" },
    unknown: { reliability: "F", credibility: "6", label: "Cannot be assessed" }
  };
  /* the capabilities tracked (prompt section 7), keyed by the medical plan's codes, with the prompt's names */
  var CAPABILITIES = [
    ["ed.basic", "emergency_department", "Emergency department"], ["ed.24_7", "emergency_24h", "24-hour emergency"],
    ["trans.ambulance", "ambulance", "Ambulance"], ["cc.icu", "icu", "ICU"], ["surg.or_emergency", "operating_room", "Operating room"],
    ["surg.anaesthesia", "anesthesia", "Anaesthesia"], ["lab.basic", "laboratory", "Laboratory"], ["blood.bank", "blood_bank", "Blood bank"],
    ["dx.xray", "xray", "X-ray"], ["dx.ultrasound", "ultrasound", "Ultrasound"], ["dx.ct", "ct", "CT"], ["dx.mri", "mri", "MRI"],
    ["surg.general", "general_surgery", "General surgery"], ["surg.ortho", "orthopedics", "Orthopaedics"], ["surg.neuro", "neurosurgery", "Neurosurgery"],
    ["spec.cardiology", "cardiology", "Cardiology"], ["surg.thoracic", "cardiothoracic", "Cardiothoracic surgery"], ["surg.vascular", "vascular_surgery", "Vascular surgery"],
    ["spec.burn", "burn_care", "Burn care"], ["spec.dialysis", "dialysis", "Dialysis"], ["spec.obstetric", "obstetrics", "Obstetrics"],
    ["spec.pediatrics", "pediatrics", "Paediatrics"], ["trans.helipad", "helipad", "Helipad"], ["trans.critical_care_transport", "air_ambulance_support", "Air ambulance support"],
    ["trauma.team", "trauma_team", "Trauma team or centre"], ["surg.trauma", "trauma_surgery", "Trauma surgery"], ["cc.ventilator", "ventilator", "Mechanical ventilation"],
    ["surg.plastic", "plastic_surgery", "Plastic surgery"], ["dx.ir", "interventional_radiology", "Interventional radiology"], ["blood.mtp", "massive_transfusion", "Massive transfusion"],
    ["spec.cath_lab", "cath_lab", "Cardiac catheterisation"], ["spec.stroke", "stroke", "Stroke unit"], ["spec.hyperbaric", "hyperbaric", "Hyperbaric chamber"],
    ["spec.pediatric_trauma", "pediatric_trauma", "Paediatric trauma"], ["spec.rehabilitation", "rehabilitation", "Rehabilitation"], ["surg.ophthalmology", "ophthalmology", "Ophthalmology"],
    ["surg.maxfac", "maxillofacial", "Maxillofacial surgery"]];
  /* OpenStreetMap healthcare:speciality values (one value, lower case) that state a capability */
  var SPECIALITY_RE = {
    "surg.trauma": /^(trauma|traumatology|trauma_surgery)$/, "surg.general": /^(surgery|general_surgery)$/, "surg.anaesthesia": /^(anaesthetics?|anesthesiology|anaesthesiology|anesthesia)$/,
    "blood.bank": /^(blood_bank|transfusion(_medicine)?|haematology_blood_bank)$/, "dx.xray": /^(x_?ray|radiography)$/, "dx.ultrasound": /^(ultrasound|sonography)$/,
    "dx.ct": /^(ct|computed_tomography|tomography)$/, "dx.mri": /^(mri|magnetic_resonance_imaging)$/, "dx.ir": /^interventional_radiology$/,
    "cc.icu": /^(intensive(_care)?|critical_care|icu)$/, "surg.neuro": /^neurosurgery$/, "surg.ortho": /^(orthopa?edics|orthopa?edic_surgery|orthopa?edic_trauma)$/,
    "surg.vascular": /^vascular_surgery$/, "surg.thoracic": /^(thoracic_surgery|cardiothoracic_surgery|cardiac_surgery)$/, "surg.plastic": /^(plastic_surgery|reconstructive_surgery)$/,
    "surg.ophthalmology": /^ophthalmology$/, "surg.maxfac": /^(maxillofacial_surgery|oral_and_maxillofacial_surgery|oral_surgery)$/, "spec.burn": /^(burns?|burn_care|burn_unit)$/,
    "spec.pediatric_trauma": /^(paediatric|pediatric)_trauma$/, "spec.obstetric": /^(obstetrics|gynaecology_obstetrics|obstetrics_gynaecology|obstetrics_gynecology)$/,
    "spec.cath_lab": /^(cardiac_catheterisation|cardiac_catheterization|interventional_cardiology)$/, "spec.stroke": /^(stroke|stroke_unit)$/,
    "spec.hyperbaric": /^(hyperbaric(_medicine)?|diving_medicine)$/, "spec.rehabilitation": /^(rehabilitation|physical_medicine_and_rehabilitation)$/ };
  var CAP_BY_CODE = {}, CAP_BY_NAME = {};
  CAPABILITIES.forEach(function (c) { CAP_BY_CODE[c[0]] = c; CAP_BY_NAME[c[1]] = c; });

  function today() { return new Date().toISOString().slice(0, 10); }
  function clip(s, n) { s = String(s == null ? "" : s).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  /* a source entry, graded by its type; sha256 is filled later by fingerprint() (crypto.subtle is asynchronous) */
  function source(type, o) {
    var g = SOURCE_TYPES[type] || SOURCE_TYPES.unknown;
    o = o || {};
    return { source_type: SOURCE_TYPES[type] ? type : "unknown", source_name: clip(o.name || g.label, 140), url: /^https?:\/\//i.test(o.url || "") ? o.url : "",
      observed_date: o.observed || "", retrieved_date: o.retrieved || "", reliability: o.reliability || g.reliability, credibility: o.credibility || g.credibility,
      language: o.lang || "", machine_translated: !!o.mt, ai_derived: false, excerpt: o.excerpt ? clip(o.excerpt, 300) : "", sha256: "" };
  }
  /* a canonical record with every field present, so readers never meet undefined */
  function facility(o) {
    var f = {
      schema: SCHEMA, id: "", name: "", name_local: "", aliases: [], country_code: "", admin1: "", admin2: "", lat: null, lon: null, kind: "hospital",
      operator: "", ownership: "", official_type: "", official_designation: "", beds: null,
      contact: { phone: "", website: "", emergency_phone: "" }, address: "", ids: { osm: "", wikidata: "", sof: "", gov: "" },
      capabilities: {}, osap_classification: "", confidence: "", sources: [],
      record_created: "", last_checked: "", last_verified: "", source_last_updated: ""
    };
    Object.keys(o || {}).forEach(function (k) {
      if (o[k] == null) return;
      if ((k === "contact" || k === "ids") && typeof o[k] === "object") Object.keys(o[k]).forEach(function (j) { if (o[k][j]) f[k][j] = o[k][j]; });
      else f[k] = o[k];
    });
    return f;
  }
  /* one capability with its evidence; statuses outside STATUS are refused */
  function capability(status, src, value) {
    if (STATUS.indexOf(status) < 0) throw new Error("capability status " + status);
    return { status: status, value: value === undefined ? (status === "not_available" ? false : status === "unknown" ? null : true) : value, sources: src ? [src] : [] };
  }
  function getCap(f, code) { return (f && f.capabilities && f.capabilities[code]) || { status: "unknown", value: null, sources: [] }; }
  /* SHA-256 of a source entry's canonical JSON (sorted keys, sha256 left out), the way OSAP fingerprints its records */
  function canon(o) {
    if (Array.isArray(o)) return "[" + o.map(canon).join(",") + "]";
    if (o && typeof o === "object") return "{" + Object.keys(o).filter(function (k) { return k !== "sha256"; }).sort().map(function (k) { return JSON.stringify(k) + ":" + canon(o[k]); }).join(",") + "}";
    return JSON.stringify(o);
  }
  function fingerprint(src) {
    if (!(W.crypto && W.crypto.subtle && W.TextEncoder)) return Promise.resolve("");
    return W.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canon(src))).then(function (b) {
      src.sha256 = Array.prototype.map.call(new Uint8Array(b), function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); return src.sha256;
    }, function () { return ""; });
  }
  function getJSON(url, ms) {
    var ac = W.AbortController ? new AbortController() : null, t = setTimeout(function () { if (ac) ac.abort(); }, ms), o = ac ? { signal: ac.signal } : {};
    return fetch(url, o).then(function (r) { clearTimeout(t); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); },
      function (e) { clearTimeout(t); throw new Error(e && e.name === "AbortError" ? "no answer in " + Math.round(ms / 1000) + " s" : "network error"); });
  }
  var RAD = Math.PI / 180;
  function hav(a, b) {
    var dLa = (b[0] - a[0]) * RAD, dLo = (b[1] - a[1]) * RAD, x = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 6371008.8 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  /* provider registry. A provider: { id, tier (0 country, 1 sof, 2 osm), countries (array, or null for every country),
     discoverFacilities(area) -> Promise<{ facilities, at, missing? }>, lookupFacility(id), getCapabilities(f),
     getOfficialClassification(f), getBedCapacity(f) } (the last four optional) */
  var P = [];
  function register(p) { P = P.filter(function (x) { return x.id !== p.id; }).concat([p]).sort(function (a, b) { return a.tier - b.tier; }); }
  function provider(id) { for (var i = 0; i < P.length; i++) if (P[i].id === id) return P[i]; return null; }
  function providers(cc) { return P.filter(function (p) { return !p.countries || !cc || p.countries.indexOf(cc) >= 0; }); }
  /* every provider for the area, highest authority first; one failing provider never stops the others, and each one's
     outcome is reported (a failure is a failure, never "no hospitals") */
  function discover(area) {
    var L = providers(area && area.cc);
    return Promise.all(L.map(function (p) {
      return Promise.resolve().then(function () { return p.discoverFacilities(area); }).then(function (r) {
        return { provider: p.id, ok: true, at: (r && r.at) || "", missing: (r && r.missing) || [], facilities: (r && r.facilities) || [] };
      }, function (e) { return { provider: p.id, ok: false, err: String((e && e.message) || e).slice(0, 200), facilities: [] }; });
    })).then(function (R) {
      return { facilities: R.reduce(function (a, r) { return a.concat(r.facilities); }, []), outcome: R.map(function (r) { return { provider: r.provider, ok: r.ok, at: r.at, missing: r.missing, err: r.err || "", n: r.facilities.length }; }) };
    });
  }

  W.OSAP_HOSP = { SCHEMA: SCHEMA, STATUS: STATUS, SOURCE_TYPES: SOURCE_TYPES, CAPABILITIES: CAPABILITIES, CAP_BY_CODE: CAP_BY_CODE, CAP_BY_NAME: CAP_BY_NAME, SPECIALITY_RE: SPECIALITY_RE,
    facility: facility, source: source, capability: capability, getCap: getCap, fingerprint: fingerprint, canon: canon,
    register: register, provider: provider, providers: providers, discover: discover, getJSON: getJSON, hav: hav, clip: clip, today: today };
})();
