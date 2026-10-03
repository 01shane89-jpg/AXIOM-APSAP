/* AXIOM OSAP: hospital data layer, OpenStreetMap provider (the global baseline; build prompt phase 4).
   Reads OSAP's stored copy of OpenStreetMap health facilities (data/medfac: index.json plus 2-degree tiles, built every
   4 weeks by tools/build_medfac.mjs). stored(o, R) hands back the raw elements the medical plan has always read;
   discoverFacilities(area) turns them into canonical records (assets/hospital-sources/base-provider.js). OpenStreetMap is
   open collaborative data, graded C3: what it lists is "reported", never "confirmed". */
(function () {
  "use strict";
  var W = window, H = W.OSAP_HOSP;
  if (!H) return;
  var MEDFAC = W.OSAP_MEDFAC || "data/medfac/", MF_TILE = 2, hav = H.hav, getJSON = H.getJSON;

  var mfIdxP = null;
  function mfIndex() {
    if (!mfIdxP) mfIdxP = getJSON(MEDFAC + "index.json", 15000).then(function (j) { if (!j || !j.countries || !j.tiles) throw new Error("no index"); return j; })
      .catch(function (e) { mfIdxP = null; throw e; });
    return mfIdxP;
  }
  function tileKeys(o, R) {
    var dLa = R / 111320, dLo = R / (111320 * Math.max(0.1, Math.cos(o[0] * Math.PI / 180))), out = [];
    for (var a = Math.floor((o[0] - dLa) / MF_TILE) * MF_TILE; a <= o[0] + dLa; a += MF_TILE)
      for (var b = Math.floor((o[1] - dLo) / MF_TILE) * MF_TILE; b <= o[1] + dLo; b += MF_TILE) {
        var k = a + "_" + ((((b + 180) % 360) + 360) % 360 - 180); if (out.indexOf(k) < 0) out.push(k);
      }
    return out;
  }
  /* countries within R of the POI: by the packaged country outlines (COUNTRY_BASE, WORLD_BASE) where there is one, so a
     country whose bounding box merely overlaps (Laos over central Thailand) is not counted; else by bounding box */
  var NE_IDX = null;
  function neIndex() {
    if (NE_IDX) return NE_IDX;
    NE_IDX = {};
    [W.COUNTRY_BASE, W.WORLD_BASE].forEach(function (fc) { ((fc && fc.features) || []).forEach(function (f) { if (f.properties && f.geometry && !NE_IDX[f.properties.n]) NE_IDX[f.properties.n] = f.geometry; }); });
    return NE_IDX;
  }
  function inRing(o, ring) {
    var x = o[1], y = o[0], inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  /* true when the outline comes within R of o (vertices, with a 30 km allowance for simplified edges) or holds o */
  function nearOutline(o, g, R) {
    var polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    for (var p = 0; p < polys.length; p++) {
      var ring = polys[p][0] || [];
      if (inRing(o, ring)) return true;
      for (var i = 0; i < ring.length; i++) if (hav(o, [ring[i][1], ring[i][0]]) <= R + 30000) return true;
    }
    return false;
  }
  function outlineOf(c) {
    var meta = {};
    (W.ASAP_WORLD || []).forEach(function (w) { meta[w.id] = w; });
    return neIndex()[(meta[c.id] && meta[c.id].ne) || c.ne || c.name] || null;
  }
  function ccNear(o, R) {
    var dLa = R / 111320, dLo = R / (111320 * Math.max(0.1, Math.cos(o[0] * Math.PI / 180))), ne = neIndex();
    var meta = {};
    (W.ASAP_WORLD || []).forEach(function (w) { meta[w.id] = w; });
    return (W.OSAP_COUNTRIES || []).filter(function (c) {
      var b = c.bounds; if (!b || !/^[a-z]{2}$/.test(c.id)) return false;
      if (!(o[0] + dLa >= b[0][0] && o[0] - dLa <= b[1][0] && o[1] + dLo >= b[0][1] && o[1] - dLo <= b[1][1])) return false;
      var g = ne[(meta[c.id] && meta[c.id].ne) || c.ne || c.name];
      return g ? nearOutline(o, g, R) : true;
    });
  }
  /* the raw stored elements within reach: { els (Overpass-shaped), missing (country names the copy lacks), at, n } */
  function stored(o, R) {
    return mfIndex().then(function (idx) {
      var near = ccNear(o, R), missing = near.filter(function (c) { return !idx.countries[c.id]; }).map(function (c) { return c.name; });
      var ks = tileKeys(o, R).filter(function (k) { return idx.tiles[k]; });
      return Promise.all(ks.map(function (k) { return getJSON(MEDFAC + "t/" + k + ".json", 20000); })).then(function (tiles) {
        var els = [];
        tiles.forEach(function (t) { (t || []).forEach(function (r) { els.push({ type: { n: "node", w: "way", r: "relation" }[r[0].charAt(0)] || "node", id: +r[0].slice(1), lat: r[1], lon: r[2], tags: r[4] || {} }); }); });
        var ats = near.map(function (c) { return idx.countries[c.id] && idx.countries[c.id].at; }).filter(Boolean).sort();
        return { els: els, missing: missing, at: ats[0] || "", n: near.length, near: near.map(function (c) { return c.id; }) };
      });
    });
  }

  function isHosp(t) { return t.amenity === "hospital" || t.healthcare === "hospital"; }
  function isClinic(t) { return t.amenity === "clinic" || t.amenity === "doctors" || /^(clinic|centre|doctor)$/.test(t.healthcare || ""); }
  /* one OpenStreetMap element as a canonical record; cc is the country the element lies in (upper-cased in the id) */
  function toFacility(e, cc, at) {
    var t = e.tags || {}, lat = e.lat != null ? e.lat : e.center && e.center.lat, lon = e.lon != null ? e.lon : e.center && e.center.lon;
    if (lat == null || lon == null || !(isHosp(t) || isClinic(t))) return null;
    var oid = (e.type || "node").charAt(0) + e.id, url = "https://www.openstreetmap.org/" + (e.type || "node") + "/" + e.id;
    var src = H.source("openstreetmap", { name: "OpenStreetMap", url: url, observed: (at || "").slice(0, 10), retrieved: (at || "").slice(0, 10) });
    var C = {};
    function rep(code, how) { if (!C[code]) C[code] = H.capability("reported", Object.assign({}, src, { excerpt: how })); }
    if (t.emergency === "yes") rep("ed.basic", "emergency=yes");
    else if (t.emergency === "no") C["ed.basic"] = H.capability("not_available", Object.assign({}, src, { excerpt: "emergency=no" }));
    String(t["healthcare:speciality"] || "").split(/[;,]/).map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean).forEach(function (v) {
      Object.keys(H.SPECIALITY_RE).forEach(function (k) { if (H.SPECIALITY_RE[k].test(v)) rep(k, "healthcare:speciality=" + v); });
    });
    var beds = parseInt(t.beds, 10);
    var addr = [t["addr:housenumber"], t["addr:street"], t["addr:subdistrict"], t["addr:district"], t["addr:city"] || t["addr:province"]].filter(Boolean).join(", ");
    return H.facility({
      id: (cc || "xx").toUpperCase() + "-OSM-" + oid, name: t["name:en"] || t.name || t.official_name || "", name_local: t.name && t.name !== t["name:en"] ? t.name : "",
      aliases: [t.official_name, t.alt_name, t.short_name, t["name:th"]].filter(function (x, i, a) { return x && a.indexOf(x) === i; }),
      country_code: (cc || "").toUpperCase(), admin1: t["addr:province"] || t["addr:state"] || "", admin2: t["addr:district"] || "",
      lat: lat, lon: lon, kind: isHosp(t) ? "hospital" : "clinic", operator: t.operator || "", ownership: t["operator:type"] || "",
      beds: beds > 0 ? { value: beds, sources: [Object.assign({}, src, { excerpt: "beds=" + t.beds })] } : null,
      contact: { phone: t.phone || t["contact:phone"] || "", website: t.website || t["contact:website"] || "", emergency_phone: t["emergency:phone"] || "" },
      address: addr, ids: { osm: oid, wikidata: /^Q\d+$/.test(t.wikidata || "") ? t.wikidata : "" },
      capabilities: C, sources: [src], source_last_updated: (at || "").slice(0, 10), last_checked: (at || "").slice(0, 10)
    });
  }
  /* which of the countries near the area holds the point (by outline); the first near country when no outline holds it */
  function ccOf(p, near) {
    for (var i = 0; i < near.length; i++) { var g = outlineOf(near[i]); if (g && nearOutline(p, g, 0)) return near[i].id; }
    return near.length ? near[0].id : "";
  }
  /* area: { lat, lon, radius_m, cc } */
  function discoverFacilities(area) {
    var o = [area.lat, area.lon], R = area.radius_m || 50000;
    return stored(o, R).then(function (st) {
      var near = ccNear(o, R), F = [];
      st.els.forEach(function (e) {
        var p = [e.lat, e.lon]; if (hav(o, p) > R) return;
        var f = toFacility(e, ccOf(p, near) || area.cc, st.at); if (f) F.push(f);
      });
      return { facilities: F, at: st.at, missing: st.missing };
    });
  }

  H.register({ id: "osm", tier: 2, countries: null, label: "OpenStreetMap (OSAP's stored copy)", discoverFacilities: discoverFacilities,
    stored: stored, toFacility: toFacility, tileKeys: tileKeys, ccNear: ccNear, inRing: inRing, nearOutline: nearOutline });
})();
