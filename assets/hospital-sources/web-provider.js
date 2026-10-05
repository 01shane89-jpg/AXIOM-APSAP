/* AXIOM OSAP: hospital data layer, what hospitals state on their own websites (data/hospitals/<cc>/web.json, built by
   tools/build_hospital_web.mjs from the website reader, tools/read_hospital_sites.mjs, on GitHub Actions). Targeted
   extraction after a facility is identified (build prompt phase 6): each entry is tied to the OpenStreetMap entry or OSAP
   list record whose website was read. Source type "hospital_website" (Admiralty B3); every capability is "reported", with
   the page, the quoted text, the date read and the SHA-256 of the evidence entry. A file that cannot be read is reported
   as not read, never as "no capability". */
(function () {
  "use strict";
  var W = window, H = W.OSAP_HOSP;
  if (!H) return;
  var BASE = W.OSAP_HOSP_DATA || "data/hospitals/", BASIS = "hospital website text (automatic match)";
  var cache = {};

  /* resolves to the country's file, or null when there is none; a failed read rejects so the caller can say so */
  function load(cc) {
    if (!cc || !/^[a-z]{2,3}$/.test(cc)) return Promise.resolve(null);
    if (!cache[cc]) cache[cc] = H.getJSON(BASE + cc + "/web.json", 20000).then(function (j) { return j && j.schema === "osap-hospital-web/1" ? j : null; }, function (e) {
      delete cache[cc]; if (/HTTP 404/.test(e.message)) return null; throw e;
    });
    return cache[cc];
  }
  function pub(r) { return (r.name || r.name_local || "Hospital") + " website"; }
  function evSource(r, e) {
    var s = H.source("hospital_website", { name: pub(r), url: e.url, observed: e.observed, retrieved: e.observed, excerpt: e.excerpt, lang: /[\u0e00-\u0e7f]/.test(e.excerpt) ? "th" : "",
      excerpt_en: e.excerpt_en || "", mt: e.excerpt_en ? e.mt || "machine translation" : "" });
    s.sha256 = e.sha256 || ""; s.page_title = e.title || "";
    return s;
  }
  /* one entry as a canonical record */
  function toFacility(r, cc) {
    var C = {};
    Object.keys(r.caps || {}).forEach(function (k) {
      if (!H.CAP_BY_CODE[k]) return;
      C[k] = { status: "reported", value: true, sources: (r.caps[k] || []).map(function (e) { return evSource(r, e); }) };
    });
    var at = String(r.observed || ((r.caps && r.caps[Object.keys(r.caps)[0]] || [])[0] || {}).observed || "");
    return H.facility({ id: cc.toUpperCase() + "-WEB-" + String(r.key).replace(/[^A-Za-z0-9_-]+/g, "_"), name: r.name, name_local: r.name_local, country_code: cc.toUpperCase(),
      lat: r.lat, lon: r.lon, kind: "hospital", contact: { website: r.website }, ids: { osm: r.osm || "", sof: r.sof || "" }, capabilities: C,
      sources: [H.source("hospital_website", { name: pub(r), url: r.website, observed: at, retrieved: at })], source_last_updated: at, last_checked: at });
  }
  /* the plan's record format (source/sof/SCHEMA.txt "caps"): the first quote per capability, with its fingerprint */
  function sofCaps(r) {
    var o = {};
    Object.keys(r.caps || {}).forEach(function (k) {
      var e = (r.caps[k] || [])[0]; if (!e || !H.CAP_BY_CODE[k]) return;
      o[k] = { src: e.url, srcname: pub(r), quote: e.excerpt, quote_basis: BASIS, asof: e.observed, sha256: e.sha256 || "", stype: "hospital_website" };
      /* the English machine translation stored beside a Thai quote (tools/build_hospital_web.mjs), with the tool named */
      if (e.excerpt_en) { o[k].quote_en = e.excerpt_en; o[k].quote_mt = e.mt || "machine translation"; }
    });
    return o;
  }
  /* OSAP's list for a country with the website evidence folded in, for the medical plan. Records are copied, never changed
     in place. Website evidence joins the list record it was read for, or the one the resolver finds to be the same
     hospital; a quote never replaces a capability the list already documents, except one resting only on a page title.
     Hospitals the list lacks are added as website-documented records at the location of the entry that gave the website. */
  function fold(list, doc, cc) {
    var L = (list || []).map(function (h) { var c = {}; Object.keys(h).forEach(function (k) { c[k] = h[k]; }); if (h.caps) c.caps = Object.assign({}, h.caps); return c; });
    if (!doc || !doc.facilities) return L;
    var sofP = H.provider("sof"), canon = L.map(function (h) { return sofP ? sofP.toFacility(h, cc, "") : null; });
    doc.facilities.forEach(function (r) {
      if (r.lat == null || r.lon == null) return;
      var caps = sofCaps(r); if (!Object.keys(caps).length) return;
      var wf = toFacility(r, cc), at = -1, why = "";
      for (var i = 0; i < L.length && at < 0; i++) if (r.sof && L[i].id === r.sof) { at = i; why = "read for this record"; }
      for (var j = 0; j < L.length && at < 0; j++) {
        if (!canon[j]) continue;
        var m = H.resolver ? H.resolver.match(canon[j], wf) : { level: "none" };
        if (m.level === "same" || m.level === "likely") { at = j; why = m.why; }
      }
      if (at >= 0) {
        var h = L[at]; h.caps = h.caps || {};
        Object.keys(caps).forEach(function (k) { var old = h.caps[k]; if (!old || old.quote_basis === "official page title") h.caps[k] = caps[k]; });
        h.web_match = h.web_match || why;
        return;
      }
      var add = { id: "web:" + cc + ":" + r.key, name: r.name || r.name_local, name_local: r.name_local || null, city: null, address: null, emergency_24h: null, type: null,
        trauma_level: null, notes: null, lat: r.lat, lon: r.lon, prec: r.osm ? "exact" : "approx", coord_basis: r.coord_basis || "", src: r.website || caps[Object.keys(caps)[0]].src,
        srcname: pub(r), caps: caps, web_only: true };
      L.push(add); canon.push(sofP ? sofP.toFacility(add, cc, "") : null);
    });
    return L;
  }
  function discoverFacilities(area) {
    return load(area.cc).then(function (d) {
      if (!d) return { facilities: [], at: "" };
      var o = [area.lat, area.lon], R = area.radius_m || 50000;
      return { facilities: d.facilities.filter(function (r) { return r.lat != null && H.hav(o, [r.lat, r.lon]) <= R; }).map(function (r) { return toFacility(r, area.cc); }), at: String(d.read_at || "").slice(0, 10) };
    });
  }

  H.register({ id: "web", tier: 1.5, countries: null, label: "Hospitals' own websites (automatic reading)", discoverFacilities: discoverFacilities,
    load: load, toFacility: toFacility, fold: fold, sofCaps: sofCaps });
})();
