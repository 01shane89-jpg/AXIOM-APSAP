/* AXIOM OSAP: hospital data layer, facility identity resolver (hospital build prompt phase 5).
   Decides whether two records from different sources describe the same hospital, and merges those that do. Evidence, in
   order of weight: a shared identifier (OpenStreetMap, Wikidata, OSAP list or government code); the same website domain
   (within 2.5 km, or 20 km with the same name, since a group may share one site); the same distinctive name
   words, Thai with Thai and English with English ("hospital", "โรงพยาบาล" and the like left out), within 2.5 km. Location alone (under 250 m) only supports a match, it never makes one: two hospitals can share a block.
   Merging keeps every source, alias and identifier, and assesses each capability from all the evidence (base assess());
   disagreements are kept in conflicts, never settled silently. */
(function () {
  "use strict";
  var W = window, H = W.OSAP_HOSP;
  if (!H) return;

  var STOP = /^(hospital|hospitals|medical|medicine|centre|center|general|international|the|of|and|clinic|health|hosp|rph|rp|\u0e42\u0e23\u0e07\u0e1e\u0e22\u0e32\u0e1a\u0e32\u0e25|\u0e23\u0e1e|\u0e28\u0e39\u0e19\u0e22\u0e4c|\u0e01\u0e32\u0e23\u0e41\u0e1e\u0e17\u0e22\u0e4c|\u0e04\u0e13\u0e30\u0e41\u0e1e\u0e17\u0e22\u0e28\u0e32\u0e2a\u0e15\u0e23\u0e4c|\u0e21\u0e2b\u0e32\u0e27\u0e34\u0e17\u0e22\u0e32\u0e25\u0e31\u0e22|\u0e08\u0e31\u0e07\u0e2b\u0e27\u0e31\u0e14|\u0e2d\u0e33\u0e40\u0e20\u0e2d)$/;
  var SHARED_HOSTS = /(^|\.)(facebook\.com|fb\.com|line\.me|google\.com|wordpress\.com|blogspot\.com|wixsite\.com)$|^(moph\.go\.th|go\.th)$/;
  /* name words worth comparing: lower case, Thai and Latin letters and digits, the generic words removed */
  function nameWords(s) {
    return String(s || "").toLowerCase().replace(/\u0e42\u0e23\u0e07\u0e1e\u0e22\u0e32\u0e1a\u0e32\u0e25|\u0e23\u0e1e\./g, " ").split(/[^a-z0-9\u0e00-\u0e7f\u00c0-\u024f]+/)
      .filter(function (w) { return w.length >= 3 && !STOP.test(w); });
  }
  function allWords(r) {
    var L = [];
    [r.name, r.name_local].concat(r.aliases || []).forEach(function (n) { nameWords(n).forEach(function (w) { if (L.indexOf(w) < 0) L.push(w); }); });
    return L;
  }
  /* a website's own domain (www. dropped); shared hosts such as facebook.com or a ministry portal say nothing about identity */
  function domain(u) {
    var m = /^https?:\/\/([^/?#:]+)/i.exec(u || ""); if (!m) return "";
    var h = m[1].toLowerCase().replace(/^www\d?\./, "");
    return SHARED_HOSTS.test(h) ? "" : h;
  }
  /* the same distinctive words, compared within each script (an English name against a Thai alias has none in common).
     Place names make up much of a hospital's name, so a word more is a different hospital: "Khon Kaen Hospital" and
     "Khon Kaen Ram Hospital" are two. A missed match leaves two entries; a wrong one gives one hospital another's services. */
  function namesAgree(wa, wb) {
    function by(L, th) { return L.filter(function (w) { return /[\u0e00-\u0e7f]/.test(w) === th; }).sort().join(" "); }
    return [false, true].some(function (th) { var a = by(wa, th); return !!a && a === by(wb, th); });
  }
  function ids(r) { return r.ids || {}; }
  /* { level: "same" | "likely" | "possible" | "none", why } */
  function match(a, b) {
    var A = ids(a), B = ids(b);
    var keys = ["osm", "wikidata", "sof", "gov"];
    for (var i = 0; i < keys.length; i++) if (A[keys[i]] && A[keys[i]] === B[keys[i]]) return { level: "same", why: "same " + keys[i] + " id " + A[keys[i]] };
    var m = a.lat != null && b.lat != null ? H.hav([a.lat, a.lon], [b.lat, b.lon]) : Infinity;
    var da = domain(a.contact && a.contact.website), db = domain(b.contact && b.contact.website);
    var wa = allWords(a), wb = allWords(b);
    /* a hospital group can run one website for many branches, so the same site needs the same block or a name in common */
    if (da && da === db && (m < 2500 || (namesAgree(wa, wb) && m < 20000))) return { level: "same", why: "same website " + da + ", " + Math.round(m) + " m apart" };
    if (namesAgree(wa, wb) && m < 2500) return { level: "likely", why: "same name, " + Math.round(m) + " m apart" };
    if (m < 250) return { level: "possible", why: Math.round(m) + " m apart, names differ" };
    return { level: "none", why: "" };
  }
  /* one capability merged from two records: all the evidence, assessed together */
  function mergeCap(x, y) {
    if (!x) return y; if (!y) return x;
    var r = H.assess([x, y]);
    if (r.status !== "contradicted") {
      /* keep one copy of a source that both records carry */
      var seen = {}; r.sources = r.sources.filter(function (s) { var k = s.sha256 || (s.url + "|" + s.excerpt); if (seen[k]) return false; seen[k] = 1; return true; });
    }
    return r;
  }
  function uniq(L) { return L.filter(function (x, i) { return x && L.indexOf(x) === i; }); }
  /* merge b into a (a is the higher-authority record and keeps its id and name); returns a new record */
  function merge(a, b, why) {
    var f = H.facility(JSON.parse(JSON.stringify(a)));
    f.aliases = uniq(f.aliases.concat([b.name, b.name_local], b.aliases || [])).filter(function (n) { return n !== f.name && n !== f.name_local; });
    ["name_local", "admin1", "admin2", "operator", "ownership", "official_type", "official_designation", "address"].forEach(function (k) { if (!f[k] && b[k]) f[k] = b[k]; });
    ["phone", "website", "emergency_phone"].forEach(function (k) { if (!f.contact[k] && b.contact && b.contact[k]) f.contact[k] = b.contact[k]; });
    Object.keys(b.ids || {}).forEach(function (k) { if (!f.ids[k] && b.ids[k]) f.ids[k] = b.ids[k]; });
    if (!f.beds && b.beds) f.beds = b.beds;
    else if (f.beds && b.beds && f.beds.value !== b.beds.value) f.conflicts.push({ field: "beds", values: [{ value: f.beds.value, sources: f.beds.sources }, { value: b.beds.value, sources: b.beds.sources }] });
    Object.keys(b.capabilities || {}).forEach(function (k) {
      var c = mergeCap(f.capabilities[k], b.capabilities[k]); f.capabilities[k] = c;
      if (c.status === "contradicted" && !f.conflicts.some(function (x) { return x.field === "capabilities." + k; })) f.conflicts.push({ field: "capabilities." + k, values: c.sources.map(function (s) { return { source: s }; }) });
    });
    f.sources = f.sources.concat(b.sources || []);
    f.merged = (a.merged || [a.id]).concat(b.merged || [b.id]);
    f.match_basis = (a.match_basis || []).concat([b.id + ": " + why]);
    return f;
  }
  /* resolve a list (highest authority first): "same" and "likely" matches merge, "possible" ones stay apart and are noted */
  function resolve(L) {
    var out = [];
    (L || []).forEach(function (r) {
      var best = null;
      out.forEach(function (f, i) { var m = match(f, r); if ((m.level === "same" || m.level === "likely") && (!best || (m.level === "same" && best.m.level !== "same"))) best = { i: i, m: m }; });
      if (best) out[best.i] = merge(out[best.i], r, best.m.why);
      else out.push(r);
    });
    return out;
  }

  H.resolver = { nameWords: nameWords, domain: domain, match: match, merge: merge, mergeCap: mergeCap, resolve: resolve };
})();
