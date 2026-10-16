/* AXIOM OSAP: is a point at sea, and what lies on the coast round it (Shane 2026-10-05: "I tried to make it do a med plan
   from the sea and it gave me a ground evac option").
   where(lat, lon) tells land from sea with the province outlines the app already ships (assets/regions/<ISO3>.json, Natural
   Earth admin-1, public domain, the files Weather and Use my location read), so no server is asked about the point. A point
   outside every outline and more than SEA_KM from the nearest one is at sea; closer than that it is called coastal and treated
   as land, because the outlines are generalised to about 1 km and a harbour berth must still get its road route. Where no
   outline could be read the answer is "unknown" and callers keep their land behaviour.
   ports(lat, lon, km) reads OSAP's ports layer (data/infra/<cc>/port.json: NGA World Port Index, UN/LOCODE and OpenStreetMap,
   built by tools/build_infra.mjs) for every country whose box is within reach and returns the ports nearest the point.
   Distances at sea are great-circle (spherical haversine, Earth radius 3,440.065 NM): spatial separation only, never a
   navigation route, a rescue radius or a jurisdiction line.
   window.OSAP_SEA = { where, check (where + small-island road check), ports, nm, km, R_NM, SEA_KM }. where() and ports() only read files the app already holds; check() also sends the point (nothing else) to a public OSRM server. Nothing is stored. */
(function (root) {
  "use strict";
  var W = typeof window !== "undefined" ? window : root;
  if (W.OSAP_SEA) return;
  var R_NM = 3440.065, R_KM = 6371.0088, SEA_KM = 1.0, NEAR_DEG = 3;
  var A3 = { th: "THA", vn: "VNM", kh: "KHM", la: "LAO", mm: "MMR", ph: "PHL", my: "MYS", sg: "SGP", id: "IDN", bn: "BRN", tl: "TLS", cn: "CHN", tw: "TWN", kp: "PRK",
    kr: "KOR", jp: "JPN", oki: "JPN", mn: "MNG", au: "AUS", nz: "NZL", pg: "PNG", in: "IND", pk: "PAK", np: "NPL", bt: "BTN", bd: "BGD", lk: "LKA", mv: "MDV" };

  function wrap(lon) { return ((lon + 540) % 360) - 180; }
  function hav(a, b, R) {
    var r = Math.PI / 180, dl = (b[0] - a[0]) * r, dn = wrap(b[1] - a[1]) * r;
    var h = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) * Math.sin(dn / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function nm(a, b) { return hav(a, b, R_NM); }
  function km(a, b) { return hav(a, b, R_KM); }

  /* ---------- land or sea from outlines: rings are [[lon, lat], ...] ---------- */
  function inRing(x, y, r) {
    var ins = false;
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
      var xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins;
    }
    return ins;
  }
  /* km from the point to the nearest edge of a ring (flat-earth within a few degrees, good enough to judge a 1 km margin) */
  function edgeKm(x, y, r) {
    var k = Math.cos(y * Math.PI / 180), best = Infinity;
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
      var ax = (r[j][0] - x) * k, ay = r[j][1] - y, bx = (r[i][0] - x) * k, by = r[i][1] - y, dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      var t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0, px = ax + t * dx, py = ay + t * dy, d = px * px + py * py;
      if (d < best) best = d;
    }
    return Math.sqrt(best) * 111.195;
  }
  /* regions: [[name, type, lat, lon, [s, w, n, e], [ring, ...]], ...] from one or more countries' files.
     -> { sea: true|false, coast_km, region } ; coast_km is null when no outline is within reach */
  function classify(lat, lon, regions) {
    var best = Infinity, bestR = null;
    for (var i = 0; i < regions.length; i++) {
      var r = regions[i], b = r[4], rs = r[5] || [];
      var far = b && (lat < b[0] - NEAR_DEG || lat > b[2] + NEAR_DEG || lon < b[1] - NEAR_DEG || lon > b[3] + NEAR_DEG);
      if (far) continue;
      var n = 0; rs.forEach(function (g) { if (inRing(lon, lat, g)) n++; });
      if (n % 2 === 1) return { sea: false, coast_km: 0, region: r[0] };
      rs.forEach(function (g) { var d = edgeKm(lon, lat, g); if (d < best) { best = d; bestR = r[0]; } });
    }
    if (best === Infinity) return { sea: true, coast_km: null, region: "" };
    return { sea: best > SEA_KM, coast_km: Math.round(best * 10) / 10, region: bestR || "" };
  }

  /* ---------- the countries near a point, and their files ---------- */
  function near(lat, lon, deg) {
    return (W.OSAP_COUNTRIES || []).filter(function (c) {
      var b = c.bounds; if (!b) return false;
      var dLo = Math.min(Math.abs(wrap(lon - b[0][1])), Math.abs(wrap(lon - b[1][1])));
      var inLo = wrap(lon - b[0][1]) >= 0 && wrap(b[1][1] - lon) >= 0;
      return lat >= b[0][0] - deg && lat <= b[1][0] + deg && (inLo || dLo <= deg);
    });
  }
  var REG = {}, PORT = {};
  function getJSON(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }); }
  function regions(a3) {
    if (!REG[a3]) REG[a3] = getJSON("assets/regions/" + a3 + ".json").then(function (j) { return (j && j.r) || []; }, function (e) { delete REG[a3]; throw e; });
    return REG[a3];
  }
  /* -> Promise { sea: true|false|null, coast_km, region, cc, read: [ISO3], failed: [ISO3] } ; sea null = unknown */
  function where(lat, lon) {
    if (!(isFinite(lat) && isFinite(lon))) return Promise.resolve({ sea: null, coast_km: null, region: "", cc: "", read: [], failed: [] });
    var C = near(lat, lon, NEAR_DEG), seen = {}, A = [];
    C.forEach(function (c) { var a = c.a3 || A3[c.id]; if (a && !seen[a]) { seen[a] = c.id; A.push(a); } });
    if (!A.length) return Promise.resolve({ sea: true, coast_km: null, region: "", cc: "", read: [], failed: [], open_ocean: true });
    return Promise.all(A.map(function (a) { return regions(a).then(function (r) { return { a: a, r: r }; }, function () { return { a: a, r: null }; }); })).then(function (got) {
      var ok = got.filter(function (g) { return g.r; }), all = [];
      ok.forEach(function (g) { g.r.forEach(function (r) { all.push(r); }); });
      var failed = got.filter(function (g) { return !g.r; }).map(function (g) { return g.a; });
      if (!ok.length) return { sea: null, coast_km: null, region: "", cc: "", read: [], failed: failed };
      var c = classify(lat, lon, all);
      /* a point near a country whose outline could not be read cannot be called sea with confidence */
      if (c.sea && failed.length) c.sea = null;
      var cc = "";
      ok.some(function (g) { return g.r.some(function (r) { if (r[0] === c.region) { cc = seen[g.a]; return true; } return false; }); });
      return { sea: c.sea, coast_km: c.coast_km, region: c.region, cc: cc, read: ok.map(function (g) { return g.a; }), failed: failed };
    });
  }

  /* ---------- small islands: the outlines leave many out (Ko Phi Phi reads as 26 km offshore), so a point the outlines call
     sea is checked against the road network: a mapped road within ROAD_M means land with roads (an island), and the caller
     keeps its land behaviour. The same public OSRM servers the medical plan already routes with; only the point is sent. */
  var OSRM = ["https://routing.openstreetmap.de/routed-car/", "https://router.project-osrm.org/"], ROAD_M = 300;
  function roadNear(lat, lon, ms) {
    var path = "nearest/v1/driving/" + lon.toFixed(5) + "," + lat.toFixed(5) + "?number=1";
    function go(i) {
      if (i >= OSRM.length) return Promise.reject(new Error("no road server answered"));
      var ac = typeof AbortController !== "undefined" ? new AbortController() : null, t = ac ? setTimeout(function () { ac.abort(); }, ms || 8000) : 0;
      return fetch(OSRM[i] + path, ac ? { signal: ac.signal } : {}).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(function (j) {
        clearTimeout(t);
        var w = j && j.code === "Ok" && j.waypoints && j.waypoints[0]; if (!w) throw new Error("no answer");
        return { m: w.distance, host: OSRM[i].split("/")[2] };
      }).catch(function () { clearTimeout(t); return go(i + 1); });
    }
    return go(0);
  }
  /* where() plus the road check: -> Promise { ...where, road_m, island: true when the road check overruled the outlines } */
  function check(lat, lon) {
    return where(lat, lon).then(function (w) {
      if (w.sea !== true || (w.coast_km != null && w.coast_km > 60)) return w;
      return roadNear(lat, lon).then(function (r) {
        w.road_m = Math.round(r.m); w.road_host = r.host;
        if (r.m <= ROAD_M) { w.sea = false; w.island = true; }
        return w;
      }, function (e) { w.road_err = e.message; return w; });
    });
  }

  /* ---------- ports within reach (OSAP's ports layer) ---------- */
  function portFile(cc) {
    if (!PORT[cc]) PORT[cc] = getJSON("data/infra/" + cc + "/port.json").then(function (j) { return (j && j.items) || []; }, function (e) { delete PORT[cc]; throw e; });
    return PORT[cc];
  }
  /* WPI ports first at the same distance band: they carry harbour size and depths; LOCODE-only points are approximate */
  var RANK = { wpi: 0, osm: 1, locode: 2 };
  function rk(s) { return Object.prototype.hasOwnProperty.call(RANK, s) ? RANK[s] : 9; }
  /* -> Promise { items: [{ id, name, lat, lon, cc, nm, km, src, url, size, approx, also }], read: [cc], failed: [cc] } */
  function ports(lat, lon, maxKm, max) {
    maxKm = maxKm || 400; max = max || 8;
    var deg = Math.min(12, maxKm / 100 + 1), C = near(lat, lon, deg).filter(function (c) { return /^[a-z]{2}$/.test(c.id); });
    return Promise.all(C.map(function (c) { return portFile(c.id).then(function (L) { return { cc: c.id, L: L }; }, function () { return { cc: c.id, L: null }; }); })).then(function (got) {
      var out = [];
      got.forEach(function (g) {
        (g.L || []).forEach(function (p) {
          if (!(isFinite(p.la) && isFinite(p.lo)) || !p.nm) return;
          var d = km([lat, lon], [p.la, p.lo]); if (d > maxKm) return;
          out.push({ id: p.id, name: String(p.nm).slice(0, 80), lat: p.la, lon: p.lo, cc: g.cc, km: d, nm: d / 1.852, src: p.s, url: p.u || "",
            size: p.x && p.x.size || "", approx: !!(p.x && p.x.approx), also: (p.also || []).map(function (a) { return a.s; }), fp: p.fp || "" });
        });
      });
      /* one name once: the same harbour listed by WPI and OSM within 3 km keeps the better-sourced entry */
      out.sort(function (a, b) { return a.km - b.km; });
      var kept = [];
      out.forEach(function (p) {
        var dup = kept.filter(function (q) { return km([p.lat, p.lon], [q.lat, q.lon]) < 3; })[0];
        if (!dup) { kept.push(p); return; }
        if (rk(p.src) < rk(dup.src)) kept[kept.indexOf(dup)] = p;
      });
      return { items: kept.slice(0, max), read: got.filter(function (g) { return g.L; }).map(function (g) { return g.cc; }), failed: got.filter(function (g) { return !g.L; }).map(function (g) { return g.cc; }) };
    });
  }

  W.OSAP_SEA = { where: where, check: check, roadNear: roadNear, ports: ports, nm: nm, km: km, R_NM: R_NM, SEA_KM: SEA_KM, _classify: classify };
})(this);
