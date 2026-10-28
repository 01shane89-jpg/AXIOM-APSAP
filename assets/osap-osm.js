/* AXIOM OSAP: one way to read OpenStreetMap live, for every map feature that needs the area on screen.
   Postpass first (Geofabrik's keyless SQL API over a live OpenStreetMap database, CORS open), then the public Overpass servers
   one after another. Probed 2026-10-28 from GitHub runners (tools/probe_power.sh): Postpass answered every Thailand view in
   0.2 to 8 s; overpass-api.de refused (406), maps.mail.ru answered one view in 20 to 30 s and 504'd on the rest, kumi.systems and
   private.coffee never answered. So a feature that asks Overpass alone often gets nothing.
   - OSAP_OSM.query({ sql, ql, signal, ppMs, opMs }) -> Promise of { elements, via, at } (at: the data's time when known): Postpass when there is SQL, else or on failure
     each Overpass server with the Overpass QL. Elements are always Overpass-shaped: lines as ways with geometry [{lat, lon}],
     points with center (and lat/lon for nodes), areas as a closed way or a relation with outer/inner member rings.
     Fails with Error("busy") when the servers were busy or slow, another Error when nothing answered, AbortError when aborted.
   - A server that failed is tried last for the next 10 minutes (never dropped: the next one may be down too).
   - OSAP_OSM.health() -> { host: { ok, fail, last, err, ms } } for this page, so a panel can say which source went dark.
   Nothing here writes anything; the answers are views over community-mapped public data. */
(function () {
  "use strict";
  var W = window;
  var POSTPASS = "https://postpass.geofabrik.de/api/interpreter";
  var OVERPASS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
  var COOL = 600000, H = {};
  function host(u) { return u.split("/")[2]; }
  function note(u, ok, err, ms) {
    var h = H[host(u)] || (H[host(u)] = { ok: 0, fail: 0, last: 0, err: "", ms: 0, bad: 0 });
    h.last = Date.now(); h.ms = ms;
    if (ok) { h.ok++; h.bad = 0; h.err = ""; } else { h.fail++; h.bad = Date.now(); h.err = err; }
  }
  /* servers that failed in the last ten minutes go to the back, in their original order */
  function order(list) {
    var now = Date.now(), good = [], cold = [];
    list.forEach(function (u) { var h = H[host(u)]; (h && h.bad && now - h.bad < COOL ? cold : good).push(u); });
    return good.concat(cold);
  }
  /* Postpass GeoJSON -> Overpass elements: one way per line part, a centre per point; throws on an answer that is not GeoJSON */
  var OSMT = { N: "node", W: "way", R: "relation" };
  function elements(j) {
    if (!j || !Array.isArray(j.features)) throw new Error("not GeoJSON");
    var out = [];
    j.features.forEach(function (f) {
      var g = f && f.geometry, p = (f && f.properties) || {};
      if (!g || !g.coordinates) return;
      var base = { type: OSMT[p.osm_type] || "way", id: p.osm_id, tags: p.tags || {} };
      var ll = function (c) { return { lat: c[1], lon: c[0] }; };
      var add = function (o) { var e = { type: base.type, id: base.id, tags: base.tags }; for (var k in o) e[k] = o[k]; out.push(e); };
      if (g.type === "Point") { var c = ll(g.coordinates); add(base.type === "node" ? { lat: c.lat, lon: c.lon, center: c } : { center: c }); }
      else if (g.type === "LineString") add({ geometry: g.coordinates.map(ll) });
      else if (g.type === "MultiLineString") g.coordinates.forEach(function (part) { add({ geometry: part.map(ll) }); });
      /* an area: a closed way when it is one ring, else a multipolygon relation of outer and inner rings (holes kept) */
      else if (g.type === "Polygon" || g.type === "MultiPolygon") {
        var polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates, mem = [];
        polys.forEach(function (rs) { rs.forEach(function (r, i) { mem.push({ type: "way", role: i ? "inner" : "outer", geometry: r.map(ll) }); }); });
        if (mem.length === 1) add({ type: "way", geometry: mem[0].geometry });
        else if (mem.length) add({ type: "relation", members: mem });
      }
    });
    return out;
  }
  /* "geom && ST_MakeEnvelope(west, south, east, north)" for a Leaflet bounds */
  function env(b) {
    return "geom && ST_MakeEnvelope(" + [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map(function (v) { return v.toFixed(4); }).join(",") + ",4326)";
  }
  function post(u, body, ms, signal) {
    var one = new AbortController(), slow = false, t0 = Date.now();
    var st = setTimeout(function () { slow = true; one.abort(); }, ms);
    var off = function () { one.abort(); };
    if (signal) { if (signal.aborted) one.abort(); else signal.addEventListener("abort", off); }
    /* POST so the service worker never caches it */
    return fetch(u, { method: "POST", body: body, headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: one.signal })
      .then(function (r) { if (!r.ok) throw new Error(r.status === 429 || r.status === 504 ? "busy" : "HTTP " + r.status); return r.json(); })
      .then(function (j) { clearTimeout(st); note(u, true, "", Date.now() - t0); return j; }, function (e) {
        clearTimeout(st);
        if (signal && signal.aborted) throw e;
        var m = slow ? "busy" : (e && e.message) || "no answer";
        note(u, false, slow ? "no answer in " + Math.round(ms / 1000) + " s" : m, Date.now() - t0);
        throw new Error(m);
      });
  }
  function query(o) {
    var signal = o.signal, busy = false, errs = [];
    var ops = o.ql ? order(OVERPASS) : [];
    var op = function (i) {
      if (i >= ops.length) { var e = new Error(busy ? "busy" : errs.join("; ") || "no source"); e.tried = errs; return Promise.reject(e); }
      return post(ops[i], "data=" + encodeURIComponent(o.ql), o.opMs || 35000, signal)
        /* Overpass answers 200 with a "remark" and no elements when a query times out or runs out of memory: a failure, not an empty map */
        .then(function (j) {
          if (j && j.remark && /error/i.test(j.remark)) { var b = /timed? ?out|memory/i.test(j.remark); note(ops[i], false, b ? "busy" : "error remark", 0); throw new Error(b ? "busy" : "remark"); }
          return { elements: j.elements || [], via: host(ops[i]), at: (j.osm3s && j.osm3s.timestamp_osm_base) || "" };
        })
        .catch(function (e) { if (signal && signal.aborted) throw e; if (e.message === "busy") busy = true; errs.push(host(ops[i]) + ": " + e.message); return op(i + 1); });
    };
    if (!o.sql) return op(0);
    return post(POSTPASS, "data=" + encodeURIComponent(o.sql), o.ppMs || 30000, signal)
      /* Postpass reads a live copy of OpenStreetMap kept within minutes of the main database: "now" is the honest stamp */
      .then(function (j) { return { elements: elements(j), via: host(POSTPASS), at: new Date().toISOString().slice(0, 19) + "Z" }; })
      .catch(function (e) {
        if (signal && signal.aborted) throw e;
        if (e.message === "not GeoJSON") note(POSTPASS, false, "not GeoJSON", 0);
        if (e.message === "busy") busy = true;
        errs.push(host(POSTPASS) + ": " + e.message);
        return op(0);
      });
  }
  function health() { var o = {}; for (var k in H) o[k] = { ok: H[k].ok, fail: H[k].fail, last: H[k].last, err: H[k].err, ms: H[k].ms }; return o; }
  /* "Postpass and 3 Overpass servers did not answer" style line for a panel note, from what this page has seen */
  function dark() {
    var now = Date.now();
    return Object.keys(H).filter(function (k) { return H[k].bad && now - H[k].bad < COOL; });
  }
  W.OSAP_OSM = { query: query, elements: elements, env: env, health: health, dark: dark, POSTPASS: POSTPASS, OVERPASS: OVERPASS.slice() };
})();
