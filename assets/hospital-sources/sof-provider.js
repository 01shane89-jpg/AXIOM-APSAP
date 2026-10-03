/* AXIOM OSAP: hospital data layer, OSAP's researched list (data/sof/<cc>.js, source source/sof/<cc>.json, schema
   apsap-sof/1). Referral hospitals with a source per record and, since 2026-10-03, per-capability "caps" (URL, quoted text,
   date). load(cc) hands back the country object the medical plan has always read; discoverFacilities(area) turns its
   hospitals into canonical records (assets/hospital-sources/base-provider.js), each capability "reported" and graded by
   the kind of page that states it. */
(function () {
  "use strict";
  var W = window, D = document, H = W.OSAP_HOSP;
  if (!H) return;

  function sofOf(c) { return (W.ASAP_SOF || {})[c] || null; }
  function load(c) {
    if (sofOf(c)) return Promise.resolve(sofOf(c));
    var F = W.OSAP_COUNTRY_FILES; if (F && F.sof && F.sof.indexOf(c) < 0) return Promise.resolve(null);
    return new Promise(function (res) {
      var s = D.createElement("script"), t = setTimeout(function () { res(sofOf(c)); }, 10000);
      s.src = "data/sof/" + c + ".js"; s.async = true;
      s.onload = function () { clearTimeout(t); res(sofOf(c)); }; s.onerror = function () { clearTimeout(t); res(null); };
      D.head.appendChild(s);
    });
  }
  /* the source type of a page, from what kind of page it is (never from the domain alone) */
  function typeOf(url, name, basis) {
    var s = (url || "") + " " + (name || "");
    if (/wikipedia/i.test(s)) return "wikipedia";
    if (/wikidata/i.test(s)) return "wikidata";
    if (/openstreetmap/i.test(s)) return "openstreetmap";
    if (/hospital website|official page title/i.test(basis || "") || /hospital website/i.test(name || "")) return "hospital_website";
    return url ? "institutional" : "unknown";
  }
  function slugOf(id) { return String(id || "").split(":").pop(); }
  function toFacility(h, cc, asof) {
    if (!h || h.lat == null || h.lon == null) return null;
    var main = H.source(typeOf(h.src, h.srcname), { name: h.srcname, url: h.src, observed: asof, retrieved: asof });
    var C = {};
    Object.keys(h.caps || {}).forEach(function (k) {
      var x = h.caps[k]; if (!x || !x.src || !H.CAP_BY_CODE[k]) return;
      var s = H.source(typeOf(x.src, x.srcname, x.quote_basis), { name: x.srcname, url: x.src, observed: x.asof, retrieved: x.asof, excerpt: x.quote });
      s.sha256 = x.sha256 || "";
      C[k] = H.capability("reported", s);
      if (k === "ed.24_7" && !C["ed.basic"]) C["ed.basic"] = H.capability("reported", s);
    });
    if (h.emergency_24h === true && !C["ed.24_7"]) C["ed.24_7"] = H.capability("reported", Object.assign({}, main, { excerpt: "24-hour emergency" }));
    /* the hospital's own website, from the pages that document its capabilities (for the resolver's domain match) */
    var site = "";
    Object.keys(h.caps || {}).some(function (k) { var x = h.caps[k], t = x && x.src ? typeOf(x.src, x.srcname, x.quote_basis) : ""; if (t === "hospital_website" || t === "institutional") { site = x.src; return true; } return false; });
    var o = {
      id: cc.toUpperCase() + "-SOF-" + slugOf(h.id), name: h.name || "", name_local: h.name_local || "", country_code: cc.toUpperCase(), admin1: h.city || "",
      lat: h.lat, lon: h.lon, kind: "hospital", ownership: h.type || "", address: h.address || "", ids: { sof: h.id }, contact: { website: site },
      official_designation: h.trauma_level || "", capabilities: C, sources: [main], source_last_updated: asof || "", last_checked: asof || ""
    };
    return H.facility(o);
  }
  /* area: { lat, lon, radius_m, cc } */
  function discoverFacilities(area) {
    var cc = area.cc;
    return load(cc).then(function (d) {
      if (!d) return { facilities: [], at: "" };
      var o = [area.lat, area.lon], R = area.radius_m || 50000;
      return { facilities: (d.hospitals || []).filter(function (h) { return h.lat != null && H.hav(o, [h.lat, h.lon]) <= R; })
        .map(function (h) { return toFacility(h, cc, d.asof); }).filter(Boolean), at: d.asof || "" };
    });
  }

  H.register({ id: "sof", tier: 1, countries: null, label: "OSAP researched referral hospitals", discoverFacilities: discoverFacilities,
    load: load, toFacility: toFacility, typeOf: typeOf });
})();
