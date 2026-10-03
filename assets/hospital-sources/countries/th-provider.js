/* AXIOM OSAP: hospital data layer, Thailand's official hospital records (data/hospitals/th/registry.json, built by
   tools/build_th_registry.mjs from HA Thailand open data and Open Development Thailand; hospital build prompt phase 7).
   Tier 0, above OSAP's own list: one record per MOPH hospital code (H code) with its official type, MOPH service level,
   beds open, HA accreditation stage and dates, and the programmes HA has certified. Source types "government_registry"
   (hospital data, Admiralty A2) and "accreditation" (HA's certificates, A2). A certified programme confirms only the
   capability it cannot run without (a stroke centre certificate confirms stroke care, not neurosurgery); a certificate past
   its end date is kept, reported and marked expired. A hospital without a certificate is not "without the capability":
   the registry says nothing about what it does not certify. Records with no location are kept for the gap count. */
(function () {
  "use strict";
  var W = window, H = W.OSAP_HOSP;
  if (!H) return;
  var BASE = W.OSAP_HOSP_DATA || "data/hospitals/", cache = null;

  /* resolves to the registry, or null for another country or when there is none; a failed read rejects so the caller can say so */
  function load(cc) {
    if (cc !== "th") return Promise.resolve(null);
    if (!cache) cache = H.getJSON(BASE + "th/registry.json", 20000).then(function (j) { return j && j.schema === "osap-th-registry/1" ? j : null; }, function (e) {
      cache = null; if (/HTTP 404/.test(e.message)) return null; throw e;
    });
    return cache;
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  /* a certificate or accreditation is current until its end date; without one it is read as current */
  function current(to) { return !to || String(to) >= today(); }
  function srcOf(doc, k) { return (doc && doc.sources && doc.sources[k]) || {}; }
  function regSource(doc, r) {
    var s = srcOf(doc, "hospital");
    return H.source("government_registry", { name: s.name || "HA Thailand open data", url: s.page || "", observed: r.retrieved, retrieved: r.retrieved,
      excerpt: [r.hcode ? "H code " + r.hcode : "", r.type_th, r.beds_open ? "beds open " + r.beds_open : ""].filter(Boolean).join(", "), lang: "th" });
  }
  /* one certified programme as evidence: the certificate's own words and dates */
  function progSource(doc, r, p) {
    var s = srcOf(doc, p.src), on = current(p.to);
    var x = H.source("accreditation", { name: s.name || "HA Thailand certification", url: s.page || "", observed: p.from || r.retrieved, retrieved: r.retrieved, lang: "th",
      credibility: on ? "" : "3", excerpt: p.name_th + (p.stage ? " (" + p.stage + ")" : "") + (p.from || p.to ? ", " + (p.from || "?") + " to " + (p.to || "?") : "") + (on ? "" : ", expired") });
    x.sha256 = r.sha256 || "";
    return x;
  }
  /* the OpenStreetMap id as OSAP writes it ("w402895256") from an entry's link or id */
  function osmKey(s) {
    var m = /(node|way|relation)[/:](\d+)/.exec(String(s || "")); if (m) return m[1][0] + m[2];
    m = /^([nwr])(\d+)$/.exec(String(s || "")); return m ? m[1] + m[2] : "";
  }
  function toFacility(r, doc) {
    var C = {};
    (r.programs || []).forEach(function (p) {
      var on = current(p.to);
      (p.caps || []).forEach(function (k) {
        if (!H.CAP_BY_CODE[k]) return;
        var c = H.capability(on ? "confirmed" : "reported", progSource(doc, r, p));
        C[k] = C[k] ? H.assess([C[k], c]) : c;
      });
    });
    var main = regSource(doc, r);
    return H.facility({ id: "TH-GOV-" + r.hcode, name: r.name_en || r.name_th, name_local: r.name_th, country_code: "TH", admin1: r.province, lat: r.lat, lon: r.lon,
      kind: r.kind || "hospital", ownership: r.affiliation_th || "", official_type: r.type_en || r.type_th || "", official_designation: r.level_en || "",
      beds: r.beds_open ? { value: r.beds_open, sources: [main] } : null, ids: { gov: r.hcode, osm: r.osm || "" }, capabilities: C, sources: [main],
      record_created: r.retrieved, last_checked: r.retrieved, last_verified: r.retrieved, source_last_updated: srcOf(doc, "hospital").last_modified || "" });
  }
  /* look-ups for one registry: by OpenStreetMap id, and every placed record (for matching OSAP's own list by name) */
  function index(doc) {
    var by = {}, placed = [];
    ((doc && doc.hospitals) || []).forEach(function (r) {
      if (r.osm) by[r.osm] = r;
      if (r.lat != null) placed.push(r);
    });
    return { doc: doc, byOsm: by, placed: placed, total: ((doc && doc.hospitals) || []).length };
  }
  /* the registry record for a plan's hospital: the OpenStreetMap entry it was placed on, else the one the resolver finds to
     be the same hospital as the canonical record given (same name within 2.5 km, or the same identifier) */
  function lookup(ix, osm, canon) {
    if (!ix) return null;
    var k = osmKey(osm); if (k && ix.byOsm[k]) return ix.byOsm[k];
    if (!canon || canon.lat == null || !H.resolver) return null;
    var best = null;
    ix.placed.forEach(function (r) {
      if (Math.abs(r.lat - canon.lat) > 0.05 || Math.abs(r.lon - canon.lon) > 0.05) return;
      var m = H.resolver.match(toFacility(r, ix.doc), canon);
      if ((m.level === "same" || m.level === "likely") && (!best || (m.level === "same" && best.level !== "same"))) best = { r: r, level: m.level };
    });
    return best && best.r;
  }
  function discoverFacilities(area) {
    return load(area.cc).then(function (d) {
      if (!d) return { facilities: [], at: "" };
      var o = [area.lat, area.lon], R = area.radius_m || 50000;
      return { facilities: d.hospitals.filter(function (r) { return r.lat != null && H.hav(o, [r.lat, r.lon]) <= R; }).map(function (r) { return toFacility(r, d); }),
        at: String(d.built || "").slice(0, 10), missing: d.hospitals.filter(function (r) { return r.lat == null; }).map(function (r) { return r.hcode; }) };
    });
  }

  H.register({ id: "th-registry", tier: 0, countries: ["th"], label: "Thailand official hospital records (HA Thailand open data)", discoverFacilities: discoverFacilities,
    load: load, toFacility: toFacility, index: index, lookup: lookup, current: current, osmKey: osmKey });
})();
