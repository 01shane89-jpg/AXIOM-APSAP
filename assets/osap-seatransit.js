/* AXIOM OSAP: sea transit medical support assessment (Shane 2026-10-05: a maritime medevac assessment for a Philippines to
   Sri Lanka transit, "We need to be able to do this").
   The question it answers: a vessel sails this corridor; where along it can a casualty reach shore care, through whom, and
   where must the vessel plan to keep the casualty aboard?
   - The planner enters the transit as waypoints (tap the map, type a grid, or start from the example corridor), with the
     vessel's speed and departure time. The line between waypoints is a conceptual planning corridor (great circle), never a
     navigation route, traffic scheme or charted passage; the master supplies the approved route.
   - OSAP samples the corridor every N NM and, for each point, measures great-circle distance (spherical haversine, Earth radius
     3,440.065 NM) to the nearest port (OSAP's ports layer: World Port Index, UN/LOCODE, OpenStreetMap), the nearest hospital in
     OSAP's sourced list (data/sof, each with its source), the nearest hospital OpenStreetMap maps (reference only, crowd
     data), the nearest airport with a mapped runway of 1,500 m or more (onward fixed-wing transfer) and the nearest coast.
   - A point with no sourced hospital within the hospital limit and no port within the port limit is REMOTE: plan prolonged
     onboard care, early diversion and rescue authority coordination. No point is ever called covered: distance is spatial
     separation only, not a rescue radius, aircraft range or jurisdiction boundary.
   - Each leg between waypoints is a segment with its times at the stated speed, the coasts it passes, its worst gap to shore
     care and the rescue coordination leads of the countries near it (data/seamed/rcc.json: published institutional contacts,
     not called, revalidate before sailing). Being nearest to a country does not make it the coordinating authority.
   - 100 and 200 NM reference rings round any support point the planner picks, labelled as distances, not envelopes.
   - Print: an assessment in the shape of the one Shane supplied: decision and key judgments, corridor map, segments, distance
     table, support points, rescue coordination leads, communications plan, onboard care triggers, extraction branches, timing
     and decision points, degraded operations, the readiness worksheet with sign-off lines, evidence limits and sources.
   Kept on this device only (localStorage "osap-seatr"). Automatic draft by fixed rules from open data: not AI and not
   analyst-approved. W.OSAP_SEATRANSIT = { open(opts), close(), state(), core }. */
(function (root) {
  "use strict";
  var W = typeof window !== "undefined" ? window : root, D = W.document;
  if (W.OSAP_SEATRANSIT) return;
  var R_NM = 3440.065, KEY = "osap-seatr";
  var DEF = { kn: 14, step: 50, remH: 200, remP: 100, rwy: 1500 };
  var HOSP_NM = 300, PORT_KM = 600, NEAR_CC_NM = 300;

  /* ---------- pure geometry (exported as core, tested in node) ---------- */
  var RAD = Math.PI / 180;
  function wrap(lon) { return ((lon + 540) % 360) - 180; }
  function nm(a, b) {
    var dl = (b[0] - a[0]) * RAD, dn = wrap(b[1] - a[1]) * RAD;
    var h = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dn / 2) * Math.sin(dn / 2);
    return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  /* the point a fraction f along the great circle from a to b */
  function gcAt(a, b, f) {
    var p1 = a[0] * RAD, l1 = a[1] * RAD, p2 = b[0] * RAD, l2 = b[1] * RAD, d = nm(a, b) / R_NM;
    if (d < 1e-9) return [a[0], a[1]];
    var A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    var x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2), y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2), z = A * Math.sin(p1) + B * Math.sin(p2);
    return [Math.atan2(z, Math.sqrt(x * x + y * y)) / RAD, wrap(Math.atan2(y, x) / RAD)];
  }
  /* the point dist NM from p on bearing brg (degrees) */
  function dest(p, brg, dist) {
    var d = dist / R_NM, t = brg * RAD, p1 = p[0] * RAD, l1 = p[1] * RAD;
    var p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
    var l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return [p2 / RAD, wrap(l2 / RAD)];
  }
  function ring(c, dist, n) { var o = []; n = n || 90; for (var i = 0; i <= n; i++) o.push(dest(c, i * 360 / n, dist)); return o; }
  /* waypoints [{lat, lon, n}] -> sample points every step NM along each leg, every waypoint included:
     [{ lat, lon, nm (from the start), leg (index of the leg it lies on), wp (waypoint index or -1) }] */
  function densify(wps, step) {
    var out = [], cum = 0; step = step > 0 ? step : DEF.step;
    for (var i = 0; i < wps.length; i++) {
      var a = [wps[i].lat, wps[i].lon];
      out.push({ lat: a[0], lon: a[1], nm: cum, leg: Math.min(i, wps.length - 2), wp: i });
      if (i === wps.length - 1) break;
      var b = [wps[i + 1].lat, wps[i + 1].lon], L = nm(a, b), k = Math.floor(L / step);
      for (var j = 1; j <= k; j++) { var d = j * step; if (L - d < step * 0.25) break; var p = gcAt(a, b, d / L); out.push({ lat: p[0], lon: p[1], nm: cum + d, leg: i, wp: -1 }); }
      cum += L;
    }
    return out;
  }
  /* the great-circle line itself for drawing: a point every ~20 NM, longitudes unwrapped so the line never jumps the map */
  function line(wps) {
    var o = [];
    for (var i = 0; i + 1 < wps.length; i++) {
      var a = [wps[i].lat, wps[i].lon], b = [wps[i + 1].lat, wps[i + 1].lon], n = Math.max(1, Math.ceil(nm(a, b) / 20));
      for (var j = i ? 1 : 0; j <= n; j++) o.push(gcAt(a, b, j / n));
    }
    for (var k = 1; k < o.length; k++) { var dl = o[k][1] - o[k - 1][1]; if (dl > 180) o[k][1] -= 360; else if (dl < -180) o[k][1] += 360; }
    return o;
  }
  function nearest(p, list) {
    var best = null, bd = Infinity;
    for (var i = 0; i < list.length; i++) { var d = nm(p, [list[i].lat, list[i].lon]); if (d < bd) { bd = d; best = list[i]; } }
    return best ? { node: best, nm: bd } : null;
  }
  /* sets: { ports, hosp (sourced), osm (reference), af (onward airports) }; opts: { remH, remP, kn, dep (ms) }
     -> per point: { port, hosp, osm, af, remote, eta } with each { node, nm } or null */
  function assess(points, sets, opts) {
    return points.map(function (pt) {
      var p = [pt.lat, pt.lon], r = { pt: pt };
      ["ports", "hosp", "osm", "af"].forEach(function (k) { r[k] = (sets[k] || []).length ? nearest(p, sets[k]) : null; });
      r.remote = !(r.hosp && r.hosp.nm <= opts.remH) && !(r.ports && r.ports.nm <= opts.remP);
      r.eta = opts.dep ? opts.dep + pt.nm / opts.kn * 3600000 : null;
      return r;
    });
  }
  /* one row per leg: distance, times, worst gaps, remote share and the countries whose coasts lie nearest its points */
  function segments(wps, rows, opts) {
    var out = [], cum = 0;
    for (var i = 0; i + 1 < wps.length; i++) {
      var L = nm([wps[i].lat, wps[i].lon], [wps[i + 1].lat, wps[i + 1].lon]);
      var R = rows.filter(function (r) { return r.pt.leg === i; }).concat(rows.filter(function (r) { return r.pt.wp === i + 1; }));
      function worst(k) { var m = null; R.forEach(function (r) { var v = r[k] ? r[k].nm : Infinity; if (m === null || v > m) m = v; }); return m; }
      var rem = R.filter(function (r) { return r.remote; }), cc = {};
      R.forEach(function (r) { if (r.coast && r.coast.cc) cc[r.coast.cc] = 1; });
      out.push({ i: i, from: wps[i], to: wps[i + 1], nm0: cum, nm: L, t0: opts.dep ? opts.dep + cum / opts.kn * 3600000 : null, t1: opts.dep ? opts.dep + (cum + L) / opts.kn * 3600000 : null,
        hours: L / opts.kn, worstHosp: worst("hosp"), worstPort: worst("ports"), remote: rem.length, n: R.length,
        remoteNm: rem.length ? [Math.min.apply(null, rem.map(function (r) { return r.pt.nm; })), Math.max.apply(null, rem.map(function (r) { return r.pt.nm; }))] : null, coasts: Object.keys(cc) });
      cum += L;
    }
    return out;
  }
  var core = { nm: nm, gcAt: gcAt, dest: dest, ring: ring, densify: densify, line: line, nearest: nearest, assess: assess, segments: segments, R_NM: R_NM, DEF: DEF };
  if (!D) { W.OSAP_SEATRANSIT = { core: core }; return; }

  /* ---------- helpers ---------- */
  var L = W.L;
  function G() { return W.OSAP_GEO; }
  function E(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function clean(s, n) { return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n || 60); }
  function safeUrl(u) { return /^https:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function link(u, t) { u = safeUrl(u); return u ? '<a href="' + E(u) + '" target="_blank" rel="noopener noreferrer">' + E(t || u) + "</a>" : E(t || ""); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function grid(lat, lon) { var g = G(); return (g && g.mgrs && g.mgrs(lat, lon, 5)) || lat.toFixed(4) + ", " + lon.toFixed(4); }
  function ll(lat, lon) { return Math.abs(lat).toFixed(2) + (lat >= 0 ? " N" : " S") + " / " + Math.abs(lon).toFixed(2) + (lon >= 0 ? " E" : " W"); }
  function nmT(v) { return v == null || !isFinite(v) ? "–" : (v >= 100 ? Math.round(v) : v.toFixed(1)) + " NM"; }
  function hrs(h) { if (!isFinite(h)) return "–"; var m = Math.round(h * 60), d = Math.floor(m / 1440), hh = Math.floor((m % 1440) / 60), mm = m % 60; return (d ? d + " d " : "") + hh + " h " + (mm < 10 ? "0" : "") + mm + " min"; }
  function dual(ms) { var T = W.OSAP_TIME; return T && T.dualT ? T.dualT(ms, { date: true }) : new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z"; }
  function zulu(ms) { return new Date(ms).toISOString().slice(5, 16).replace("T", " ") + "Z"; }
  function parseGrid(t) {
    t = String(t || "").trim(); if (!t) return null;
    var m = /^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/.exec(t);
    if (m) { var a = +m[1], b = +m[2]; if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return [a, b]; }
    var g = G(); if (g && g.parse) { try { var p = g.parse(t); if (p && isFinite(p.lat)) return [p.lat, p.lon]; if (p && isFinite(p[0])) return [p[0], p[1]]; } catch (e) {} }
    return null;
  }
  function getJSON(u, ms) {
    var ac = W.AbortController ? new AbortController() : null, t = setTimeout(function () { if (ac) ac.abort(); }, ms || 20000);
    return fetch(u, ac ? { signal: ac.signal } : {}).then(function (r) { clearTimeout(t); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }, function (e) { clearTimeout(t); throw e; });
  }

  /* ---------- the plan kept on this device ---------- */
  var EXAMPLE = [
    { n: "Manila Bay", lat: 14.50, lon: 120.75 }, { n: "South China Sea", lat: 6.50, lon: 111.00 }, { n: "Singapore approaches", lat: 1.15, lon: 104.45 },
    { n: "Southern Malacca", lat: 2.30, lon: 101.90 }, { n: "Northern Malacca", lat: 5.50, lon: 98.00 }, { n: "Western strait exit", lat: 6.20, lon: 95.50 },
    { n: "Open ocean reference", lat: 5.80, lon: 90.00 }, { n: "Sri Lanka south approach", lat: 5.70, lon: 84.00 }, { n: "Colombo", lat: 6.95, lon: 79.80 }];
  function blank() { return { wps: [], kn: DEF.kn, dep: "", step: DEF.step, remH: DEF.remH, remP: DEF.remP, f: {}, rings: [] }; }
  var P = (function () { var p = lsGet(KEY, null); return p && Array.isArray(p.wps) ? Object.assign(blank(), p) : blank(); })();
  function save() { lsSet(KEY, P); }
  function num(k) { var v = +P[k]; return isFinite(v) && v > 0 && v < 100000 ? v : DEF[k]; }
  function depMs() { var t = Date.parse(String(P.dep || "") + (/Z$/.test(P.dep || "") ? "" : "Z")); return isFinite(t) ? t : null; }

  var S = { busy: false, tok: 0, msg: "", res: null, picking: false };
  var layer = null;

  /* ---------- data: everything the corridor needs, read once ---------- */
  var SOF = {}, RCC = null, TILE = {}, MFI = null, AF = {};
  function nearCountries(pts, deg) {
    return (W.OSAP_COUNTRIES || []).filter(function (c) {
      var b = c.bounds; if (!b || !/^[a-z]{2,3}$/.test(c.id)) return false;
      return pts.some(function (p) { return p.lat >= b[0][0] - deg && p.lat <= b[1][0] + deg && wrap(p.lon - b[0][1] + deg) >= -1e-9 && wrap(b[1][1] + deg - p.lon) >= -1e-9 && wrap(p.lon - b[0][1] + deg) <= (b[1][1] - b[0][1]) + 2 * deg + 1e-9; });
    });
  }
  function sofLoad(cc) {
    if (!SOF[cc]) {
      var pv = W.OSAP_HOSP && W.OSAP_HOSP.provider("sof");
      SOF[cc] = pv ? pv.load(cc).then(function (s) { return s; }, function () { return null; }) : Promise.resolve(null);
    }
    return SOF[cc];
  }
  function rccLoad() { if (!RCC) RCC = getJSON("data/seamed/rcc.json", 15000).catch(function (e) { RCC = null; throw e; }); return RCC; }
  function afLoad(cc) {
    if (!AF[cc]) AF[cc] = getJSON("data/infra/" + cc + "/af.json", 20000).then(function (j) { return (j && j.items) || []; }, function () { return null; });
    return AF[cc];
  }
  var MEDFAC = W.OSAP_MEDFAC || "data/medfac/";
  function mfIndex() { if (!MFI) MFI = getJSON(MEDFAC + "index.json", 15000).catch(function (e) { MFI = null; throw e; }); return MFI; }
  function tile(k) { if (!TILE[k]) TILE[k] = getJSON(MEDFAC + "t/" + k + ".json", 20000).catch(function () { return null; }); return TILE[k]; }
  function tileKeysFor(pts, nmR) {
    var seen = {}, out = [];
    pts.forEach(function (p) {
      var dLa = nmR / 60, dLo = nmR / (60 * Math.max(0.15, Math.cos(p.lat * RAD)));
      for (var a = Math.floor((p.lat - dLa) / 2) * 2; a <= p.lat + dLa; a += 2)
        for (var b = Math.floor((p.lon - dLo) / 2) * 2; b <= p.lon + dLo; b += 2) { var k = a + "_" + ((((b + 180) % 360) + 360) % 360 - 180); if (!seen[k]) { seen[k] = 1; out.push(k); } }
    });
    return out;
  }

  /* ---------- the assessment ---------- */
  function run() {
    if (P.wps.length < 2) { S.msg = "Add at least two waypoints."; render(); return; }
    var tok = ++S.tok, Sea = W.OSAP_SEA;
    S.busy = true; S.res = null; S.msg = "Reading ports, hospitals, airports and coastlines along the corridor…"; render(); draw();
    function live() { return tok === S.tok; }
    var pts = densify(P.wps, num("step")), ccs = nearCountries(pts, 6), errs = [];
    var portsP = Promise.all(pts.map(function (p) { return Sea ? Sea.ports(p.lat, p.lon, PORT_KM, 3).then(function (r) { if (r.failed.length) errs.push("ports not read: " + r.failed.join(", ")); return r.items; }, function () { return []; }) : []; }));
    var coastP = Promise.all(pts.map(function (p) { return Sea ? Sea.where(p.lat, p.lon).catch(function () { return null; }) : null; }));
    var sofP = Promise.all(ccs.map(function (c) { return sofLoad(c.id).then(function (s) { return { cc: c.id, s: s }; }); }));
    var afP = Promise.all(ccs.filter(function (c) { return /^[a-z]{2}$/.test(c.id); }).map(function (c) { return afLoad(c.id).then(function (L) { return { cc: c.id, L: L }; }); }));
    var osmP = mfIndex().then(function (idx) {
      var ks = tileKeysFor(pts, HOSP_NM).filter(function (k) { return idx.tiles[k]; });
      return Promise.all(ks.map(tile)).then(function (T) {
        var H = [], seen = {};
        T.forEach(function (t) { (t || []).forEach(function (r) { var tg = r[4] || {}; if (!(tg.amenity === "hospital" || tg.healthcare === "hospital") || seen[r[0]]) return; seen[r[0]] = 1;
          var n = tg["name:en"] || tg.name || ""; if (!n) return; H.push({ id: "osm:" + r[0], name: clean(n, 80), lat: r[1], lon: r[2], cc: r[3], kind: "osmh", er: tg.emergency === "yes", url: "https://www.openstreetmap.org/" + ({ n: "node", w: "way", r: "relation" }[r[0].charAt(0)] || "node") + "/" + r[0].slice(1) }); }); });
        return { H: H, at: (idx.countries && Object.keys(idx.countries).map(function (c) { return idx.countries[c].at; }).sort()[0]) || "" };
      });
    }, function (e) { errs.push("OpenStreetMap hospitals not read (" + e.message + ")"); return { H: [] }; });
    Promise.all([portsP, coastP, sofP, afP, osmP, rccLoad().catch(function (e) { errs.push("rescue contacts not read (" + e.message + ")"); return null; })]).then(function (r) {
      if (!live()) return;
      var ports = {}, hosp = [], af = [], ccNames = {};
      r[0].forEach(function (L) { L.forEach(function (p) { ports[p.id] = { id: p.id, name: p.name, lat: p.lat, lon: p.lon, cc: p.cc, kind: "port", src: p.src, url: p.url, size: p.size, approx: p.approx }; }); });
      r[2].forEach(function (x) {
        var s = x.s; if (!s) return; ccNames[x.cc] = s.country || x.cc.toUpperCase();
        (s.hospitals || []).forEach(function (h) { if (!isFinite(h.lat) || !isFinite(h.lon) || !h.src) return;
          hosp.push({ id: h.id, name: clean(h.name, 90), lat: h.lat, lon: h.lon, cc: x.cc, kind: "hosp", city: h.city || "", notes: clean(h.notes || "", 160), level: h.trauma_level || "", er24: h.emergency_24h === true,
            caps: h.caps ? Object.keys(h.caps) : [], url: h.src, srcname: h.srcname || "source", asof: s.asof || "" }); });
      });
      r[3].forEach(function (x) { (x.L || []).forEach(function (a) { var rw = a.x && a.x.rw_m; if (!(rw >= num("rwy")) || !isFinite(a.la)) return;
        af.push({ id: a.id, name: clean(a.nm, 80), lat: a.la, lon: a.lo, cc: x.cc, kind: "af", rw: rw, icao: a.x.icao || "", url: a.u || "", sched: !!a.x.sched }); }); });
      var sets = { ports: Object.keys(ports).map(function (k) { return ports[k]; }), hosp: hosp, osm: r[4].H, af: af };
      var rows = assess(pts, sets, { remH: num("remH"), remP: num("remP"), kn: num("kn"), dep: depMs() });
      rows.forEach(function (row, i) { var w = r[1][i]; row.coast = w ? { sea: w.sea, km: w.coast_km, region: w.region, cc: w.cc } : null; });
      var segs = segments(P.wps, rows, { kn: num("kn"), dep: depMs() });
      /* rescue leads: the countries whose coast or support lies within NEAR_CC_NM of the corridor */
      var near = {};
      rows.forEach(function (row) {
        if (row.coast && row.coast.cc && row.coast.km != null && row.coast.km / 1.852 <= NEAR_CC_NM) near[row.coast.cc] = Math.min(near[row.coast.cc] || Infinity, row.pt.nm);
        ["ports", "hosp"].forEach(function (k) { var x = row[k]; if (x && x.nm <= NEAR_CC_NM && x.node.cc) near[x.node.cc] = Math.min(near[x.node.cc] || Infinity, row.pt.nm); });
      });
      var rcc = r[5] ? r[5].centres.filter(function (c) { return near[c.cc] != null; }).sort(function (a, b) { return near[a.cc] - near[b.cc] || (a.kind === "rcc" ? -1 : 1); }) : [];
      segs.forEach(function (sg) {
        var cs = {}; rows.forEach(function (row) { if (row.pt.leg !== sg.i && row.pt.wp !== sg.i + 1) return; ["ports", "hosp"].forEach(function (k) { var x = row[k]; if (x && x.nm <= NEAR_CC_NM) cs[x.node.cc] = 1; }); if (row.coast && row.coast.cc && row.coast.km / 1.852 <= NEAR_CC_NM) cs[row.coast.cc] = 1; });
        sg.leads = Object.keys(cs);
      });
      /* support points: each node nearest to at least one sample point, with its closest approach to the corridor */
      var used = {};
      rows.forEach(function (row) { ["ports", "hosp", "osm", "af"].forEach(function (k) { var x = row[k]; if (!x) return; var id = x.node.id; if (!used[id] || used[id].nm > x.nm) used[id] = { node: x.node, nm: x.nm, at: row.pt.nm }; }); });
      var nodes = Object.keys(used).map(function (k) { return used[k]; }).sort(function (a, b) { return a.at - b.at; });
      S.res = { at: Date.now(), pts: pts, rows: rows, segs: segs, nodes: nodes, rcc: rcc, rccDoc: r[5], ccNames: ccNames, osmAt: r[4].at || "", errs: errs.filter(function (x, i, a) { return a.indexOf(x) === i; }).slice(0, 6),
        counts: { ports: sets.ports.length, hosp: hosp.length, osm: r[4].H.length, af: af.length }, opts: { kn: num("kn"), dep: depMs(), step: num("step"), remH: num("remH"), remP: num("remP"), rwy: num("rwy") } };
      S.busy = false; S.msg = ""; render(); draw(); fit();
    }).catch(function (e) { if (!live()) return; S.busy = false; S.msg = "The assessment failed: " + (e && e.message || e); render(); });
  }

  /* ---------- key judgments: facts read from the result, never a claim of coverage ---------- */
  function judgments(res) {
    var segs = res.segs, rows = res.rows, tot = segs.reduce(function (a, s) { return a + s.nm; }, 0), J = [];
    J.push("The corridor is " + nmT(tot) + " in " + segs.length + " segment" + (segs.length > 1 ? "s" : "") + ", about " + hrs(tot / res.opts.kn) + " at " + res.opts.kn + " kn" + (res.opts.dep ? ", departing " + zulu(res.opts.dep) + ", arriving about " + zulu(res.opts.dep + tot / res.opts.kn * 3600000) : "") + ".");
    var rem = rows.filter(function (r) { return r.remote; });
    if (rem.length) {
      var runs = [], cur = null; rows.forEach(function (r) { if (r.remote) { if (!cur) { cur = [r.pt.nm, r.pt.nm]; runs.push(cur); } else cur[1] = r.pt.nm; } else cur = null; });
      J.push("Remote stretches (no sourced hospital within " + res.opts.remH + " NM and no port within " + res.opts.remP + " NM): " + runs.map(function (x) { return x[0] === x[1] ? "at NM " + Math.round(x[0]) : "NM " + Math.round(x[0]) + " to " + Math.round(x[1]); }).join("; ") + ". Plan prolonged onboard care, early diversion decisions and rescue authority coordination there; do not rely on helicopter retrieval.");
    } else J.push("Every sample point has a sourced hospital within " + res.opts.remH + " NM or a port within " + res.opts.remP + " NM. That is distance only: it does not show an aircraft, a crew, a deck or hoist, or an accepting hospital.");
    var w = null; rows.forEach(function (r) { var v = r.hosp ? r.hosp.nm : Infinity; if (!w || v > (w.hosp ? w.hosp.nm : Infinity)) w = r; });
    if (w) J.push("The longest distance to a sourced hospital is " + (w.hosp ? nmT(w.hosp.nm) + " (" + w.hosp.node.name + ")" : "beyond the search") + " at NM " + Math.round(w.pt.nm) + " (" + ll(w.pt.lat, w.pt.lon) + ").");
    var cc = {}; segs.forEach(function (s) { s.leads.forEach(function (c) { cc[c] = 1; }); });
    var n = Object.keys(cc).length;
    if (n) J.push("The corridor passes near " + n + " countr" + (n > 1 ? "ies" : "y") + " (" + Object.keys(cc).map(function (c) { return (res.ccNames[c] || c.toUpperCase()); }).join(", ") + "): plan arrangements with several rescue authorities. Proximity to a country does not alone make it the coordinating authority.");
    J.push("Public data does not establish an aircraft launch time, a route-wide hoist service, a rescue radius for this vessel, or hospital acceptance. Each must be confirmed with the provider before it counts.");
    return J;
  }

  /* ---------- screen ---------- */
  function style() {
    if (D.getElementById("seatr-css")) return;
    var s = D.createElement("style"); s.id = "seatr-css";
    s.textContent =
      "#seatr:not([hidden]){position:fixed;inset:0;z-index:4000;background:rgba(0,0,0,.35);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:24px 12px}" +
      "#seatr .stbox{background:var(--surface,#fff);color:var(--ink,#1d2329);width:min(980px,100%);border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.35);padding:0 14px 14px;font-size:13px;line-height:1.4}" +
      "#seatr .chead{position:sticky;top:0;z-index:2;display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:var(--surface,#fff);padding:10px 0 8px;border-bottom:1px solid var(--line,#d5dbe1)}" +
      "#seatr .chead h2{flex:1;min-width:max-content;font-size:15px;margin:0}#seatr h3{font-size:13.5px;margin:14px 0 6px}#seatr h4{font-size:12.5px;margin:10px 0 4px}" +
      "#seatr .obs{color:var(--muted,#56626f)}#seatr .stbad{color:var(--bad,#c0392b);font-weight:600}#seatr .stok{color:var(--ok,#2b8a3e)}" +
      "#seatr button,#seatr select,#seatr input,#seatr textarea{font:inherit;font-size:12.5px}" +
      "#seatr .stbtns{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0}" +
      "#seatr button{border:1px solid var(--line,#d5dbe1);background:var(--surface2,var(--surface,#fff));color:var(--ink,#1d2329);border-radius:4px;padding:5px 10px;min-height:32px;cursor:pointer;font-weight:600}" +
      "#seatr button.stgo,#seatr button[aria-pressed=true]{background:var(--accent,#1c5d99);color:var(--on-accent,#fff);border-color:var(--accent,#1c5d99)}#seatr button[disabled]{opacity:.45;cursor:default}" +
      "#seatr select,#seatr input,#seatr textarea{border:1px solid var(--line,#d5dbe1);border-radius:4px;background:var(--surface,#fff);color:var(--ink,#1d2329);padding:4px 6px;min-height:32px;max-width:100%}" +
      "#seatr .strow{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:flex-end}#seatr .strow label{display:flex;flex-direction:column;gap:2px;font-size:12px}" +
      "#seatr .stscroll{overflow-x:auto}#seatr table{border-collapse:collapse;width:100%;margin:4px 0}#seatr th,#seatr td{border-bottom:1px solid var(--line,#d5dbe1);padding:3px 6px;text-align:left;vertical-align:top}" +
      "#seatr th{font-size:11.5px;color:var(--muted,#56626f);font-weight:600}#seatr td.n{white-space:nowrap;text-align:right}#seatr tr.strem td{background:rgba(192,57,43,.08)}" +
      "#seatr .stwp input{width:150px}#seatr .stwp td{vertical-align:middle}#seatr details{margin:6px 0}#seatr summary{cursor:pointer;font-weight:600}" +
      "#seatr .stgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px 12px}#seatr .stgrid label{display:flex;flex-direction:column;gap:2px;font-size:12px}#seatr .stgrid label.wide{grid-column:1/-1}" +
      "#seatr .stjud li{margin:3px 0}#seatr code{font-size:11.5px}" +
      ".stmk{background:#0b4f8a;color:#fff;border:2px solid #fff;border-radius:3px;font:700 10px/14px system-ui,sans-serif;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.5);white-space:nowrap}" +
      ".stmk.wp{background:#111}.stmk.hosp{background:#D7141A}.stmk.af{background:#1d5fa8}.stmk.osmh{background:#8a8f96}" +
      "html.seatr-picking .leaflet-container{cursor:crosshair}" +
      ".stdoc h2{font-size:17px}.stdoc h3{font-size:13px;margin:12px 0 4px;break-after:avoid}.stdoc table{border-collapse:collapse;width:100%;font-size:10.5px}.stdoc th,.stdoc td{border-bottom:1px solid #ccd;padding:2px 4px;text-align:left;vertical-align:top}" +
      ".stdoc td.n{text-align:right;white-space:nowrap}.stdoc tr{break-inside:avoid}.stdoc .obs{color:#56626f}.stdoc svg{width:100%;height:auto;border:1px solid #ccd;background:#dfe9f3}.stdoc figure{margin:6px 0;break-inside:avoid}" +
      ".stdoc .stsign p{margin:14px 0}.stdoc .stbad{color:#b02a1e;font-weight:600}" +
      "@media (max-width:700px){#seatr .stwp input{width:110px}}";
    D.head.appendChild(s);
  }
  function box() {
    var el = D.getElementById("seatr");
    if (!el) {
      el = D.createElement("div"); el.id = "seatr"; el.hidden = true; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Sea transit medical assessment");
      D.body.appendChild(el);
      el.addEventListener("click", onClick); el.addEventListener("change", onChange);
      el.addEventListener("keydown", function (e) { if (e.key === "Escape") { if (S.picking) { pickEnd(); render(); } else close(); } });
      el.addEventListener("submit", function (e) { e.preventDefault(); if (e.target.id === "st-add") addTyped(); });
      if (W.OSAP_SPLIT) W.OSAP_SPLIT.add(el, ".chead");
    }
    return el;
  }
  function open(opts) {
    opts = opts || {}; style();
    if (opts.at && isFinite(opts.at[0]) && P.wps.length === 0) P.wps.push({ n: "Start", lat: +opts.at[0].toFixed(5), lon: +opts.at[1].toFixed(5) });
    var el = box(); render(); el.hidden = false;
    if (W.OSAP_SPLIT) W.OSAP_SPLIT.apply();
    draw(); fit();
    var h = el.querySelector("h2"); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  }
  function close() {
    var el = D.getElementById("seatr"); if (el) el.hidden = true;
    pickEnd(); S.tok++; S.busy = false;
    if (layer) { layer.remove(); layer = null; }
    if (W.OSAP_SPLIT && W.OSAP_SPLIT.top) W.OSAP_SPLIT.top();
  }
  function wpHtml() {
    if (!P.wps.length) return '<p class="obs">No waypoints yet. Tap <b>Pick on map</b> and tap each turning point in order, type grids below, or start from the example corridor.</p>';
    var cum = 0;
    return '<div class="stscroll"><table class="stwp"><thead><tr><th>#</th><th>Name</th><th>Position</th><th>Leg</th><th class="noprint"></th></tr></thead><tbody>' + P.wps.map(function (w, i) {
      var leg = i ? nm([P.wps[i - 1].lat, P.wps[i - 1].lon], [w.lat, w.lon]) : 0; cum += leg;
      return "<tr><td>WP" + (i + 1) + '</td><td><input data-st-wpn="' + i + '" maxlength="40" value="' + E(w.n || "") + '" aria-label="Name of waypoint ' + (i + 1) + '"></td><td><code>' + E(ll(w.lat, w.lon)) + "</code><br><span class=\"obs\">" + E(grid(w.lat, w.lon)) + '</span></td><td class="n">' + (i ? nmT(leg) + '<br><span class="obs">' + nmT(cum) + " total</span>" : "start") + "</td>" +
        '<td class="noprint"><button type="button" data-st-up="' + i + '"' + (i ? "" : " disabled") + ' aria-label="Move up">↑</button> <button type="button" data-st-del="' + i + '" aria-label="Remove waypoint ' + (i + 1) + '">Remove</button></td></tr>';
    }).join("") + "</tbody></table></div>";
  }
  function render() {
    var el = box(), res = S.res;
    var head = '<div class="chead"><h2>Sea transit medical assessment</h2><span class="aitag" tabindex="0" title="Draft worked out by fixed rules from open data on this device. Not AI and not analyst-approved. Distances are spatial separation only: no point is ever called covered.">Automatic draft</span>' +
      '<button type="button" data-st="print"' + (res ? "" : " disabled") + ">Print assessment</button><button type=\"button\" data-st=\"close\">Close</button></div>";
    var route = '<h3>1. Transit corridor</h3>' + wpHtml() +
      '<div class="stbtns"><button type="button" data-st="pick"' + (S.picking ? ' aria-pressed="true"' : "") + ">" + (S.picking ? "Done picking" : "Pick on map") + '</button><button type="button" data-st="example">Example: Manila to Colombo</button>' + (P.wps.length ? '<button type="button" data-st="reverse">Reverse</button><button type="button" data-st="clear">Clear</button>' : "") + "</div>" +
      '<form id="st-add" class="stbtns" autocomplete="off"><input id="st-grid" maxlength="60" placeholder="Add a waypoint: lat, lon or MGRS" aria-label="Add a waypoint by grid"><input id="st-name" maxlength="40" placeholder="Name (optional)" aria-label="Waypoint name"><button type="submit">Add</button></form>' +
      '<div class="strow"><label>Speed (kn)<input data-st-num="kn" inputmode="decimal" maxlength="5" value="' + E(P.kn) + '"></label>' +
      '<label>Departure (UTC)<input type="datetime-local" data-st-dep="1" value="' + E(P.dep || "") + '"></label>' +
      '<label>Sample every<select data-st-num="step">' + [25, 50, 100].map(function (v) { return '<option value="' + v + '"' + (num("step") === v ? " selected" : "") + ">" + v + " NM</option>"; }).join("") + "</select></label>" +
      '<label title="A point is remote when no sourced hospital is within this distance and no port is within the next one">Remote: no sourced hospital within (NM)<input data-st-num="remH" inputmode="numeric" maxlength="4" value="' + E(P.remH) + '"></label>' +
      '<label>and no port within (NM)<input data-st-num="remP" inputmode="numeric" maxlength="4" value="' + E(P.remP) + '"></label></div>' +
      '<p class="obs">The line between waypoints is a great-circle planning corridor, not a navigation route, traffic scheme or charted passage. If the departure port or the passage changes (Sunda or Lombok instead of Malacca, for example), work it out again: do not reuse an assessment for another route.</p>' +
      '<div class="stbtns">' + (S.busy ? '<button type="button" data-st="stop">Stop</button>' : '<button type="button" class="stgo" data-st="run"' + (P.wps.length >= 2 ? "" : " disabled") + ">" + (res ? "Work out again" : "Work out the assessment") + "</button>") + "</div>" +
      '<p id="st-msg" class="obs" role="status">' + E(S.msg) + "</p>";
    el.innerHTML = '<div class="stbox">' + head + route + (res ? resultHtml(res, false) : "") + fieldsHtml() +
      '<p class="obs">Kept on this device only. Automatic draft by fixed rules from open data: not AI and not analyst-approved. Final approval belongs to the vessel operator, the master, the medical authority and the participating providers.</p></div>';
  }
  function cName(res, c) { return (res.ccNames && res.ccNames[c]) || (W.OSAP_COUNTRIES || []).filter(function (x) { return x.id === c; }).map(function (x) { return x.name; })[0] || String(c).toUpperCase(); }
  function nodeTxt(x, withSrc) {
    if (!x) return '<span class="obs">none in reach</span>';
    var n = x.node;
    return nmT(x.nm) + '<br><span class="obs">' + E(n.name) + (n.cc ? " (" + E(String(n.cc).toUpperCase()) + ")" : "") + (withSrc && n.url ? " " + link(n.url, "source") : "") + "</span>";
  }
  function segConcept(s) {
    if (s.remote && s.remote === s.n) return '<span class="stbad">Remote segment</span>: onboard care, early diversion, assisting vessels and RCC coordination; no shore support within the limits.';
    if (s.remote) return '<span class="stbad">Partly remote</span> (NM ' + Math.round(s.remoteNm[0]) + " to " + Math.round(s.remoteNm[1]) + "): prolonged onboard care there; shore options elsewhere on the segment need provider acceptance.";
    return "Shore support within the limits on every sample point: compare the ports and hospitals below on total time to the care needed, not on preferred country.";
  }
  function resultHtml(res, print) {
    var h = "";
    h += "<h3>2. Key judgments</h3><ul class=\"stjud\">" + judgments(res).map(function (j) { return "<li>" + E(j) + "</li>"; }).join("") + "</ul>";
    if (res.errs.length) h += '<p class="stbad">Not everything could be read: ' + E(res.errs.join("; ")) + ". Gaps below may be data gaps, not empty sea.</p>";
    h += "<h3>3. Segments and support concept</h3><div class=\"stscroll\"><table><thead><tr><th>Segment</th><th>Distance and time</th><th>Coasts near</th><th>Worst gap to a sourced hospital / port</th><th>Support concept</th></tr></thead><tbody>" +
      res.segs.map(function (s) {
        return "<tr" + (s.remote ? ' class="strem"' : "") + "><td><b>WP" + (s.i + 1) + " " + E(s.from.n || "") + "</b> to <b>WP" + (s.i + 2) + " " + E(s.to.n || "") + "</b></td>" +
          '<td class="n">' + nmT(s.nm) + "<br>" + hrs(s.hours) + (s.t0 ? '<br><span class="obs">' + zulu(s.t0) + " to " + zulu(s.t1) + "</span>" : "") + "</td>" +
          "<td>" + (s.leads.length ? E(s.leads.map(function (c) { return cName(res, c); }).join(", ")) : '<span class="obs">none within ' + NEAR_CC_NM + " NM</span>") + "</td>" +
          '<td class="n">' + nmT(s.worstHosp) + " / " + nmT(s.worstPort) + "</td><td>" + segConcept(s) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
    var R = print ? res.rows.filter(function (r, i) { return r.pt.wp >= 0 || r.remote || i % Math.max(1, Math.round(100 / res.opts.step)) === 0; }) : res.rows;
    h += "<h3>4. Distance table</h3><p class=\"obs\">Great-circle distances (spherical haversine, Earth radius 3,440.065 NM) from points along the corridor every " + res.opts.step + " NM" + (print ? " (waypoints, remote points and every ~100 NM shown)" : "") + ". Spatial separation only: they exclude the aircraft's real base, air routing, refuelling, reserves, retrieval, ground transfer and treatment delay. Do not divide an advertised maximum range by two and call the result rescue coverage.</p>" +
      '<div class="stscroll"><table><thead><tr><th>Point</th><th>NM from start' + (res.opts.dep ? " / ETA" : "") + '</th><th>Nearest coast</th><th>Port</th><th>Sourced hospital</th><th>Hospital (OSM, reference)</th><th>Airport ≥ ' + res.opts.rwy + " m runway</th></tr></thead><tbody>" +
      R.map(function (r) {
        var p = r.pt, c = r.coast;
        return "<tr" + (r.remote ? ' class="strem"' : "") + "><td>" + (p.wp >= 0 ? "<b>WP" + (p.wp + 1) + " " + E(P.wps[p.wp] ? P.wps[p.wp].n : "") + "</b><br>" : "") + "<code>" + E(ll(p.lat, p.lon)) + "</code>" + (r.remote ? '<br><span class="stbad">Remote</span>' : "") + "</td>" +
          '<td class="n">' + Math.round(p.nm) + (r.eta ? '<br><span class="obs">' + zulu(r.eta) + "</span>" : "") + "</td>" +
          "<td>" + (!c ? '<span class="obs">not read</span>' : c.sea === false ? "on land / coastal" : c.km == null ? "over 160 NM" : nmT(c.km / 1.852) + (c.region ? '<br><span class="obs">' + E(c.region) + (c.cc ? " (" + E(c.cc.toUpperCase()) + ")" : "") + "</span>" : "")) + "</td>" +
          '<td class="n">' + nodeTxt(r.ports) + '</td><td class="n">' + nodeTxt(r.hosp) + '</td><td class="n">' + nodeTxt(r.osm) + '</td><td class="n">' + nodeTxt(r.af) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
    /* support points */
    var by = { hosp: [], port: [], af: [], osmh: [] };
    res.nodes.forEach(function (x) { (by[x.node.kind] || []).push(x); });
    function nodeRows(L, extra) {
      return L.map(function (x) {
        var n = x.node, on = P.rings.indexOf(n.id) >= 0;
        return "<tr><td><b>" + E(n.name) + "</b> " + '<span class="obs">' + E(cName(res, n.cc)) + "</span>" + (extra ? "<br>" + extra(n) : "") + '<br><code>' + E(grid(n.lat, n.lon)) + "</code></td>" +
          '<td class="n">' + nmT(x.nm) + '<br><span class="obs">at NM ' + Math.round(x.at) + "</span></td><td>" + (n.url ? link(n.url, "source") : "") + "</td>" +
          (print ? "" : '<td class="noprint"><button type="button" data-st-ring="' + E(n.id) + '" aria-pressed="' + on + '">100/200 NM rings</button> <button type="button" data-st-go="' + E(n.id) + '">Map</button></td>') + "</tr>";
      }).join("");
    }
    var th = "<thead><tr><th>Name</th><th>Closest to corridor</th><th>Source</th>" + (print ? "" : '<th class="noprint"></th>') + "</tr></thead>";
    h += "<h3>5. Receiving hospitals and support points</h3>" +
      "<h4>Hospitals in OSAP's sourced list</h4>" + (by.hosp.length ? '<div class="stscroll"><table>' + th + "<tbody>" + nodeRows(by.hosp, function (n) {
        return '<span class="obs">' + E([n.level, n.er24 ? "24-hour emergency department (sourced)" : "", n.caps.length ? n.caps.length + " capabilities sourced" : "", n.notes].filter(Boolean).join(" · ")) + "</span>";
      }) + "</tbody></table></div>" : '<p class="stbad">No hospital in OSAP\'s sourced list is the nearest to any point. See the reference list and confirm local options.</p>') +
      '<p class="obs">A listing is a lead, not acceptance, staffed beds or a landing site. Match the hospital to the intervention needed (surgery, blood, critical care, neurology, cardiac, burns, diving, paediatrics) and get its acceptance. Use the nearest clinically adequate accepted facility when delay to a more distant centre would harm; a trauma-centre class in one country does not translate directly into another\'s.</p>' +
      "<h4>Ports</h4>" + (by.port.length ? '<div class="stscroll"><table>' + th + "<tbody>" + nodeRows(by.port, function (n) { return '<span class="obs">' + E([{ wpi: "World Port Index", osm: "OpenStreetMap", locode: "UN/LOCODE" }[n.src] || n.src, n.size ? n.size + " harbour" : "", n.approx ? "position approximate" : ""].filter(Boolean).join(" · ")) + "</span>"; }) + "</tbody></table></div>" : '<p class="obs">None read.</p>') +
      '<p class="obs">A port listing does not show a safe approach, a berth, stretcher lifting, sea-state limits or an ambulance: confirm with the port and the receiving hospital.</p>' +
      "<h4>Airports for onward fixed-wing transfer</h4>" + (by.af.length ? '<div class="stscroll"><table>' + th + "<tbody>" + nodeRows(by.af, function (n) { return '<span class="obs">' + E([n.icao, "runway " + n.rw + " m (mapped)", n.sched ? "scheduled service" : ""].filter(Boolean).join(" · ")) + "</span>"; }) + "</tbody></table></div>" : '<p class="obs">None read.</p>') +
      '<p class="obs">A fixed-wing air ambulance can move a patient from an accepted airport; it cannot collect a casualty from a ship.</p>' +
      "<details" + (print ? " open" : "") + "><summary>Hospitals OpenStreetMap maps near the corridor (" + by.osmh.length + ", reference only)</summary>" + (by.osmh.length ? '<div class="stscroll"><table>' + th + "<tbody>" + nodeRows(by.osmh, function (n) { return '<span class="obs">' + (n.er ? "emergency=yes in OpenStreetMap" : "no emergency tag") + "</span>"; }) + "</tbody></table></div>" : "") +
      '<p class="obs">Crowd-edited data: shows where a hospital is mapped, never its capability. Not a planned receiving facility until a credible source documents it.</p></details>';
    /* rescue coordination */
    var doc = res.rccDoc;
    h += "<h3>6. Rescue coordination leads</h3>" + (res.rcc.length ? '<div class="stscroll"><table><thead><tr><th>Authority</th><th>Telephone and email</th><th>Role and source</th></tr></thead><tbody>' + res.rcc.map(function (c) {
      return "<tr><td><b>" + E(c.name) + "</b><br><span class=\"obs\">" + E(cName(res, c.cc)) + "</span></td><td>" + (c.tel || []).map(function (t) { var d = t.replace(/\s*\(.*\)$/, ""); return /^\+?[\d ]+$/.test(d) ? '<a href="tel:' + E(d.replace(/\s+/g, "")) + '">' + E(t) + "</a>" : E(t); }).join("<br>") +
        (c.email || []).map(function (m) { return '<br><a href="mailto:' + E(m) + '">' + E(m) + "</a>"; }).join("") + (c.vhf ? "<br>VHF " + E(c.vhf) : "") + (c.dsc ? " · DSC " + E(c.dsc) : "") + (c.mmsi ? " · MMSI " + E(c.mmsi) : "") + "</td>" +
        "<td>" + E(c.role) + (c.note ? ' <span class="obs">' + E(c.note) + "</span>" : "") + "<br>" + link(c.src, c.srcname) + (c.src_date ? ' <span class="obs">(' + E(c.src_date) + ")</span>" : "") + "</td></tr>";
    }).join("") + "</tbody></table></div>" : '<p class="stbad">' + (doc ? "OSAP holds no rescue coordination contacts for the countries near this corridor yet. Get the responsible RCC for each segment from current GMDSS and rescue-region publications." : "The rescue contacts could not be read.") + "</p>") +
      '<p class="obs">' + E(doc ? doc.via : "") + ". Published institutional contacts, not called or tested by OSAP: revalidate before sailing. Email carries information but should never be the only way to make an urgent request. These are coordination leads, not a map of rescue jurisdiction: the responsible RCC coordinates cross-border support, and responsibility does not change at a nearest-coast line. No validated search and rescue region boundaries are drawn.</p>";
    h += doctrineHtml(print);
    h += "<h3>13. Evidence and limitations</h3><ul>" +
      "<li>Ports: OSAP's ports layer (" + res.counts.ports + " read near the corridor; NGA World Port Index, UN/LOCODE, OpenStreetMap). Airports: OSAP's airfield layer (OurAirports and OpenStreetMap), runways as mapped, " + res.counts.af + " with " + res.opts.rwy + " m or more.</li>" +
      "<li>Sourced hospitals: OSAP's researched list (" + res.counts.hosp + " near the corridor), each with its source; a provider or hospital statement supports a lead, not current readiness. OpenStreetMap hospitals: " + res.counts.osm + " near the corridor" + (res.osmAt ? ", stored copy from " + E(res.osmAt.slice(0, 10)) : "") + ", reference only.</li>" +
      "<li>Coastlines: Natural Earth admin-1 outlines in the app (public domain), generalised to about 1 km.</li>" +
      "<li>Rescue contacts: " + E(doc ? doc.about : "not read") + "</li>" +
      "<li>Not established by any of this: aircraft standby or launch time, vessel acceptance, hoist radius, hospital bed status, landing-site coordinates or evacuation cost.</li></ul>" +
      '<p class="obs">Worked out ' + E(dual(res.at)) + ". Corridor, distances and leads are an automatic draft: not AI and not analyst-approved.</p>";
    return h;
  }
  /* planning doctrine: fixed text, the same for every transit, written for this tool from the supplied assessment's structure */
  function doctrineHtml(print) {
    function tbl(head, rows) { return '<div class="stscroll"><table><thead><tr>' + head.map(function (x) { return "<th>" + E(x) + "</th>"; }).join("") + "</tr></thead><tbody>" + rows.map(function (r) { return "<tr>" + r.map(function (c, i) { return "<td>" + (i ? E(c) : "<b>" + E(c) + "</b>") + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></div>"; }
    function sec(n, t, body) { return print ? "<h3>" + n + ". " + E(t) + "</h3>" + body : "<details><summary>" + n + ". " + E(t) + "</summary>" + body + "</details>"; }
    return (print ? "" : "<h3>7 to 12. Planning sections</h3>") +
      sec(7, "Communications plan", tbl(["", "Means"], [
        ["Primary", "Vessel GMDSS distress, urgency or safety procedure as the situation requires, plus direct contact with the rescue authority."],
        ["Alternate", "Tested satellite voice to the RCC and to the contracted medical coordinator."],
        ["Contingency", "Independent voice equipment, or relay through another station or vessel."],
        ["Emergency", "Distress alert when the situation meets distress criteria, then position and casualty information."]]) +
        '<p class="obs">VHF 16 is local line-of-sight voice, not a solution for an ocean crossing; VHF DSC 70 is for DSC signalling. The radio officer or a qualified watchkeeper applies the procedure. Get HF working frequencies from the rescue authority. Test ordinary duty contacts before sailing without sending a false distress alert; keep paper contacts and position data.</p>') +
      sec(8, "Onboard care and medical activation", '<p>Name a medical lead and backup, a 24-hour telemedical service and a protected treatment space; record their qualifications and permitted procedures. Stock to those qualifications: haemorrhage control, AED, oxygen, suction, ventilation, monitoring, dressings, splints, thermal protection and secure transport packaging. For remote segments, work out oxygen at the real flow or ventilator use, battery endurance, drugs, consumables and staff relief, including the delay of a failed extraction; do not take endurance from a generic golden hour.</p>' +
        tbl(["Trigger", "Immediate action", "Destination requirement"], [
          ["Threatened airway, severe breathing failure, shock, major bleeding or falling consciousness", "Treat within training; telemedical and rescue activation at once; assess diversion in parallel.", "Facility able to give the resuscitation and definitive intervention needed."],
          ["Major trauma, serious chest pain, suspected stroke, severe burns or significant drowning injury", "Record onset and trends; urgent clinician assessment; coordinate retrieval and acceptance.", "The surgical, neurological, cardiac, burns or critical care capability the case needs."],
          ["Stable but significant illness or injury", "Compare medically acceptable waiting time, port diversion and transfer options.", "Accepted service able to diagnose and treat; avoid needless transfer delay."],
          ["Several casualties", "Declare number and severity early; triage; spread staff and supplies; ask for more assets.", "Several receiving facilities and transport waves; never assume one aircraft."]]) +
        "<p>In parallel: start treatment and consultation; contact the responsible rescue authority and the medical transport coordinator; assess safe diversion now; secure hospital acceptance and prepare the surface option while aircraft feasibility is worked out; set the next communication time and update when the patient or position changes.</p>" +
        '<p class="obs">Advanced airway, sedation, ventilation, invasive procedures and blood need qualified staff and authorised protocols: urgency does not make an untrained crew an advanced clinical team. Patient-specific treatment, priority and acceptable delay are for the treating or telemedical clinician.</p>') +
      sec(9, "Extraction and transfer", tbl(["Branch", "Required before it counts"], [
        ["Helicopter landing", "Operator accepts the aircraft and vessel combination; deck size and load; obstacles and exhausts; motion limits; fire cover; trained deck crew; lighting; patient access; aircraft and escort weight."],
        ["Maritime hoist", "Serviceable approved hoist; qualified crew; accepted hoist area; motion and weather limits; patient weight and packaging; night capability if needed; a team able to keep up the care needed."],
        ["Boat or port diversion", "A named craft or port; safe alongside or landing; stretcher lift and freeboard; sea-state limit; clinical escort and kit; shore ambulance and hospital acceptance."]]) +
        '<p class="obs">Follow the aircraft crew\'s instructions for heading, speed, lighting, deck preparation and rescue equipment; never improvise the aviation interface or assume a large open deck is suitable. The master controls navigation and safety, the aircraft commander accepts or rejects the aviation task, and the clinical lead decides the patient\'s needs: no one role authorises the others. A military aircraft may rescue without an ICU team; an ICU aircraft may be unable to retrieve at sea.</p>') +
      sec(10, "Timing and decision points", "<p>Time to the treatment needed = recognition + report + tasking + aircraft and team preparation + travel to the vessel + extraction + travel to shore + unloading + ambulance + handover + intervention. Several run in parallel: record real times rather than adding overlapping steps.</p>" +
        tbl(["Scenario", "Likely controlling delays", "Planning response"], [
          ["Near shore, suitable deck, aircraft and team available", "Tasking, deck acceptance, receiving-site arrangements.", "Get a provider-specific estimate; compare with an immediate port diversion."],
          ["No accepted deck; hoist needed", "A compatible aircraft and crew, weather, packaging.", "Activate maritime rescue early; keep preparing the surface transfer."],
          ["Aircraft unavailable or extraction refused", "Vessel speed, diversion distance, sea state, rescue boats.", "Safest clinically acceptable port or rendezvous; reassess onboard endurance."],
          ["Open-ocean casualty", "Distance, assisting assets, jurisdiction, onboard endurance.", "Early RCC and telemedical coordination; the nearest appropriate diversion may be in another country."],
          ["Ashore but needs higher care", "Stabilisation, bed acceptance, aircraft preparation, permits, two ambulance legs.", "Treat onward evacuation separately; never delay needed local treatment."]]) +
        "<p>Record: recognition, first medical contact, rescue notification, tasking decision, aircraft launch, arrival at the vessel, extraction complete, shore arrival, hospital handover, treatment start, and the time and reason of every change of plan. State in the worksheet when to stop waiting for an unconfirmed aircraft, when to divert, and when oxygen, battery or staffing forces another pathway.</p>") +
      sec(11, "Degraded operations and special cases", tbl(["Risk", "Mitigation and decision"], [
        ["Weather or sea state", "Check marine and aviation forecasts; set night, visibility, wind and motion limits. Helicopter and boat options can fail together."],
        ["Diving injury", "Diving-medicine advice and oxygen at once; confirm a recompression facility's readiness and acceptance and the flight altitude or cabin pressure. A chamber listing is not emergency availability."],
        ["Hazardous cargo or contamination", "Send exposure details and safety data sheets; settle decontamination and isolation before boarding an aircraft or entering shore care."],
        ["Hospital cannot receive", "Named alternate, ambulance re-route and fresh acceptance; check the intervention needed, not only an ICU bed."],
        ["Communications failure", "Independent voice backup, scheduled updates, relays, paper contacts and position; never rely on an internet app alone."],
        ["Aircraft capacity too small", "Declare casualty numbers and weights; several movements, surface assets and more than one hospital."],
        ["Cross-border movement", "RCC coordination plus patient entry, aviation permits, airport handling, customs and immigration. Authority boundaries are not aircraft-range boundaries."],
        ["Payment or administrative delay", "A named 24-hour company authoriser, insurer contact and guarantee-of-payment process; emergency spending authority set in advance."]]) +
        '<p class="obs">After definitive treatment, document fitness for onward transport, follow-up, escort, medication and destination acceptance; send records and imaging properly; plan family liaison and crew replacement apart from the emergency. Military or government vessels: set naval or diplomatic liaison, facility entry, eligibility and funding before sailing; military status and a nearby base do not give aircraft release, landing permission or hospital entitlement.</p>');
  }
  var FIELDS = [
    ["vessel", "Vessel name / flag / IMO / MMSI"], ["ports", "Departure and arrival ports, dates"], ["route", "Approved route and segment timings (master)"],
    ["medlead", "Medical lead and backup, qualifications"], ["telemed", "24-hour telemedical service"], ["endur", "Oxygen, power and staffing endurance"],
    ["rcc", "Current RCC by segment; tested telephone and satellite contacts"], ["air", "Aircraft provider, actual base, aircraft and backup, launch arrangement"],
    ["deck", "Accepted landing or hoist method; deck specification; patient capacity"], ["recv", "Primary and alternate hospital by casualty type; accepted shore point; ambulance"],
    ["divert", "Diversion ports or rendezvous; safe approach; unloading; realistic vessel time"], ["special", "Specialist pathways: diving, burns, hazardous exposure, infection, paediatric"],
    ["funds", "24-hour spending authoriser; insurer; guarantee of payment; cross-border and military access"], ["valid", "Provider acceptance date; duty contact check; communications rehearsal"],
    ["stop", "When to stop waiting for an unconfirmed aircraft, and when to divert"], ["decision", "Decision (one or two lines for the top of the assessment)"]];
  function fieldsHtml() {
    var f = P.f || {};
    return "<h3>12. Transit readiness worksheet</h3><p class=\"obs noprint\">Fill these in; they print in the assessment and stay on this device. For each segment, either confirm a feasible extraction and receiving chain or mark it remote, needing prolonged onboard support and diversion. Never mark a segment covered only because an RCC answers or an operator advertises medical flights.</p><div class=\"stgrid\">" +
      FIELDS.map(function (x) { var long = x[0] === "decision" || x[0] === "stop" || x[0] === "route"; return '<label class="' + (long ? "wide" : "") + '">' + E(x[1]) + (long ? '<textarea data-st-f="' + x[0] + '" maxlength="600" rows="2">' + E(f[x[0]] || "") + "</textarea>" : '<input data-st-f="' + x[0] + '" maxlength="200" value="' + E(f[x[0]] || "") + '">') + "</label>"; }).join("") + "</div>";
  }

  /* ---------- the map ---------- */
  function mk(p, t, cls, tip) {
    var w = Math.max(22, t.length * 7 + 8);
    return L.marker(p, { icon: L.divIcon({ className: "stmk " + cls, html: E(t), iconSize: [w, 18], iconAnchor: [w / 2, 9] }), keyboard: false }).bindTooltip(E(tip));
  }
  function draw() {
    var map = W.__asapMap; if (!map || !L) return;
    if (layer) layer.remove();
    layer = L.layerGroup().addTo(map);
    if (P.wps.length >= 2) L.polyline(line(P.wps), { color: "#0b4f8a", weight: 3, dashArray: "8 6", interactive: false }).addTo(layer);
    var res = S.res;
    if (res) {
      var run = [];
      res.rows.forEach(function (r, i) { if (r.remote) run.push([r.pt.lat, r.pt.lon]); if ((!r.remote || i === res.rows.length - 1) && run.length) { if (run.length > 1) L.polyline(run, { color: "#c0392b", weight: 6, opacity: .55, interactive: false }).addTo(layer); else L.circleMarker(run[0], { radius: 6, color: "#c0392b", fillOpacity: .5 }).addTo(layer); run = []; } });
      res.nodes.forEach(function (x) {
        var n = x.node, t = { hosp: "H", port: "PT", af: "A", osmh: "h" }[n.kind] || "?";
        if (n.kind === "osmh") L.circleMarker([n.lat, n.lon], { radius: 3, color: "#8a8f96", weight: 1, fillOpacity: .7 }).bindTooltip(E(n.name + " (OpenStreetMap, reference only)")).addTo(layer);
        else mk([n.lat, n.lon], t, n.kind, n.name + " · " + nmT(x.nm) + " from the corridor").addTo(layer);
      });
    }
    P.rings.forEach(function (id) {
      var n = res && res.nodes.filter(function (x) { return x.node.id === id; })[0]; if (!n) return;
      [100, 200].forEach(function (d) { L.polyline(ring([n.node.lat, n.node.lon], d), { color: "#6a3d9a", weight: 1.5, dashArray: "6 6", interactive: false }).addTo(layer); });
    });
    P.wps.forEach(function (w, i) { mk([w.lat, w.lon], "WP" + (i + 1), "wp", (w.n || "Waypoint " + (i + 1)) + " · " + ll(w.lat, w.lon)).addTo(layer); });
  }
  function fit() {
    var map = W.__asapMap; if (!map || !L || !P.wps.length) return;
    var pts = line(P.wps.length > 1 ? P.wps : P.wps.concat(P.wps));
    try { map.fitBounds(L.latLngBounds(pts.map(function (p) { return [p[0], p[1]]; })), { padding: [30, 30], maxZoom: 9 }); } catch (e) {}
  }

  /* ---------- the corridor map for print: land outlines the app already holds, drawn as SVG (no tiles needed) ---------- */
  function svgMap(res) {
    var Lp = line(P.wps), la = Lp.map(function (p) { return p[0]; }), lo = Lp.map(function (p) { return p[1]; });
    var s = Math.min.apply(null, la), n = Math.max.apply(null, la), w = Math.min.apply(null, lo), e = Math.max.apply(null, lo);
    var pad = Math.max(2, (e - w) * 0.08, (n - s) * 0.15); s -= pad; n += pad; w -= pad; e += pad;
    var k = Math.cos(((s + n) / 2) * RAD), Wd = 1000, Ht = Math.max(300, Math.min(800, Math.round(Wd * (n - s) / ((e - w) * k))));
    function X(lon) { return ((lon - w) / (e - w) * Wd).toFixed(1); } function Y(lat) { return ((n - lat) / (n - s) * Ht).toFixed(1); }
    function path(ring, shift) { return ring.map(function (c, i) { return (i ? "L" : "M") + X(c[0] + shift) + " " + Y(c[1]); }).join("") + "Z"; }
    var land = "";
    [W.WORLD_BASE, W.COUNTRY_BASE].forEach(function (fc) {
      ((fc && fc.features) || []).forEach(function (f) {
        var g = f.geometry; if (!g) return; var polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
        polys.forEach(function (pg) { var r0 = pg[0]; if (!r0 || !r0.length) return;
          [0, -360, 360].forEach(function (sh) { var inb = r0.some(function (c) { var x = c[0] + sh; return x >= w - 5 && x <= e + 5 && c[1] >= s - 5 && c[1] <= n + 5; }); if (inb) land += '<path d="' + path(r0, sh) + '"/>'; }); });
      });
    });
    var o = '<svg viewBox="0 0 ' + Wd + " " + Ht + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Corridor map"><g fill="#f2efe6" stroke="#9aa3ad" stroke-width=".6">' + land + "</g>";
    P.rings.forEach(function (id) { var x = res.nodes.filter(function (q) { return q.node.id === id; })[0]; if (!x) return; [100, 200].forEach(function (d) { var r = ring([x.node.lat, x.node.lon], d); o += '<path d="' + r.map(function (c, i) { return (i ? "L" : "M") + X(c[1]) + " " + Y(c[0]); }).join("") + '" fill="none" stroke="#6a3d9a" stroke-dasharray="6 5" stroke-width="1.2"/><text x="' + X(r[0][1]) + '" y="' + Y(r[0][0]) + '" font-size="11" fill="#6a3d9a">' + d + " NM</text>"; }); });
    o += '<path d="' + Lp.map(function (c, i) { return (i ? "L" : "M") + X(c[1]) + " " + Y(c[0]); }).join("") + '" fill="none" stroke="#0b4f8a" stroke-width="2.5" stroke-dasharray="9 6"/>';
    res.rows.forEach(function (r) { if (r.remote) o += '<circle cx="' + X(r.pt.lon) + '" cy="' + Y(r.pt.lat) + '" r="5" fill="#c0392b" fill-opacity=".55"/>'; });
    res.nodes.forEach(function (x) { var q = x.node; if (q.kind === "osmh") return; var c = { hosp: "#D7141A", port: "#0b4f8a", af: "#1d5fa8" }[q.kind];
      o += '<rect x="' + (X(q.lon) - 4) + '" y="' + (Y(q.lat) - 4) + '" width="8" height="8" fill="' + c + '" stroke="#fff"/>'; });
    P.wps.forEach(function (p, i) { o += '<circle cx="' + X(p.lon) + '" cy="' + Y(p.lat) + '" r="4.5" fill="#111"/><text x="' + (+X(p.lon) + 6) + '" y="' + (+Y(p.lat) - 6) + '" font-size="12" font-weight="700" fill="#111">WP' + (i + 1) + "</text>"; });
    return o + "</svg>";
  }
  function printView() {
    var res = S.res, el = D.getElementById("brief"); if (!res || !el) return false;
    var f = P.f || {};
    el.innerHTML = '<div class="bbar noprint"><button type="button" class="refresh primary" id="std-print">Print or save PDF</button> <button type="button" class="refresh" id="std-close">Back</button> <span class="obs">Every page as it prints. Choose "Save as PDF" in the print dialog to keep a copy.</span></div>' +
      '<article class="bpage stdoc"><header><h2>Sea transit medical support assessment</h2><span class="aitag" title="Draft built by fixed rules from open data on this device. Not AI and not analyst-approved.">Automatic draft</span>' +
      '<p class="obs">' + E(P.wps[0].n || "Start") + " to " + E(P.wps[P.wps.length - 1].n || "End") + " · worked out " + E(dual(res.at)) + "</p></header>" +
      (f.decision ? "<p><b>Decision:</b> " + E(f.decision) + "</p>" : '<p class="obs"><b>Decision:</b> to be entered by the planner (worksheet).</p>') +
      '<p class="obs"><b>Authority and scope.</b> A planning assessment, not a directive or an approved flight or medical order. Final approval belongs to the vessel operator, the master, the medical authority and the participating providers. No agency endorsement, aircraft reservation or hospital acceptance is implied.</p>' +
      '<figure>' + svgMap(res) + '<figcaption class="obs">The dashed line is a conceptual medical planning corridor (great circle between the waypoints), not a navigation route, traffic separation scheme or charted passage. Red dots: remote points. Squares: support points (red hospital, dark blue port, blue airport). Purple dashed rings, where shown, are 100 and 200 NM geodesic distances from a support point: not helicopter operating envelopes, rescue guarantees or SAR boundaries. Land: Natural Earth (public domain), generalised.</figcaption></figure>' +
      "<h3>1. Transit corridor</h3>" + '<div class="stscroll"><table><thead><tr><th>#</th><th>Name</th><th>Position</th><th>Grid</th></tr></thead><tbody>' + P.wps.map(function (w, i) { return "<tr><td>WP" + (i + 1) + "</td><td>" + E(w.n || "") + "</td><td>" + E(ll(w.lat, w.lon)) + "</td><td>" + E(grid(w.lat, w.lon)) + "</td></tr>"; }).join("") + "</tbody></table></div>" +
      "<p>Speed " + res.opts.kn + " kn" + (res.opts.dep ? ", departure " + E(zulu(res.opts.dep)) : ", no departure time set") + ". Remote when no sourced hospital is within " + res.opts.remH + " NM and no port within " + res.opts.remP + " NM.</p>" +
      resultHtml(res, true) +
      "<h3>12. Transit readiness worksheet</h3><table><tbody>" + FIELDS.filter(function (x) { return x[0] !== "decision"; }).map(function (x) { return "<tr><td><b>" + E(x[1]) + "</b></td><td>" + (f[x[0]] ? E(f[x[0]]) : '<span class="obs">not entered</span>') + "</td></tr>"; }).join("") + "</tbody></table>" +
      '<p><b>Initial request information</b>: vessel identity; position and time; course and speed; number and weight of casualties; onset or mechanism; consciousness and vital-sign trends; treatment and oxygen or ventilation needs; clinical capability aboard; deck or hoist arrangements; weather and vessel motion; hazards; intended diversion; primary and alternate communications.</p>' +
      '<div class="stsign"><p>Master review: ____________________ Date: __________</p><p>Medical authority review: ____________________ Date: __________</p><p>Company authorisation: ____________________ Date: __________</p></div>' +
      "</article>";
    el.hidden = false; D.documentElement.classList.add("briefing"); el.scrollTop = 0; try { W.scrollTo(0, 0); } catch (e) {}
    D.getElementById("std-print").addEventListener("click", function () { setTimeout(function () { try { W.print(); } catch (e) {} }, 60); });
    D.getElementById("std-close").addEventListener("click", function () { el.hidden = true; el.innerHTML = ""; D.documentElement.classList.remove("briefing"); var b = D.querySelector('#seatr [data-st="print"]'); if (b) b.focus(); });
    return true;
  }

  /* ---------- input ---------- */
  function pickStart() {
    var map = W.__asapMap; if (!map) return;
    S.picking = true; D.documentElement.classList.add("seatr-picking"); S.msg = "Tap each turning point in order. Done picking (or Esc) stops."; map.on("click", onPick); render();
  }
  function onPick(e) {
    if (!S.picking) return;
    P.wps.push({ n: "WP" + (P.wps.length + 1), lat: +e.latlng.lat.toFixed(5), lon: +wrap(e.latlng.lng).toFixed(5) }); dirty(); render(); draw();
  }
  function pickEnd() { var map = W.__asapMap; if (map) map.off("click", onPick); S.picking = false; D.documentElement.classList.remove("seatr-picking"); if (/Tap each turning point/.test(S.msg)) S.msg = ""; }
  function addTyped() {
    var g = D.getElementById("st-grid"), n = D.getElementById("st-name"), p = parseGrid(g && g.value);
    if (!p) { S.msg = "Not a grid. Type lat, lon (6.95, 79.80) or MGRS."; render(); var g2 = D.getElementById("st-grid"); if (g2) g2.focus(); return; }
    P.wps.push({ n: clean(n && n.value, 40) || "WP" + (P.wps.length + 1), lat: +p[0].toFixed(5), lon: +wrap(p[1]).toFixed(5) }); dirty(); render(); draw(); fit();
    var g3 = D.getElementById("st-grid"); if (g3) g3.focus();
  }
  /* any change to the corridor or the limits makes the last result stale */
  function dirty() { save(); if (S.res) { S.res = null; S.msg = "The corridor changed: work the assessment out again."; } S.tok++; S.busy = false; }
  function onClick(e) {
    if (e.target.id === "seatr") { close(); return; }
    var b = e.target.closest && e.target.closest("[data-st],[data-st-del],[data-st-up],[data-st-ring],[data-st-go]"); if (!b) return;
    var k = b.getAttribute("data-st");
    if (k === "close") close();
    else if (k === "pick") { if (S.picking) { pickEnd(); render(); } else pickStart(); }
    else if (k === "example") { pickEnd(); P.wps = EXAMPLE.map(function (w) { return Object.assign({}, w); }); dirty(); S.msg = "Example corridor from the supplied assessment (Manila, South China Sea, Singapore, Malacca, Colombo). Replace with the master's approved route."; render(); draw(); fit(); }
    else if (k === "reverse") { P.wps.reverse(); dirty(); render(); draw(); }
    else if (k === "clear") { pickEnd(); P.wps = []; P.rings = []; dirty(); render(); draw(); }
    else if (k === "run") { pickEnd(); run(); }
    else if (k === "stop") { S.tok++; S.busy = false; S.msg = "Stopped."; render(); }
    else if (k === "print") printView();
    else if (b.hasAttribute("data-st-del")) { P.wps.splice(+b.getAttribute("data-st-del"), 1); dirty(); render(); draw(); }
    else if (b.hasAttribute("data-st-up")) { var i = +b.getAttribute("data-st-up"); if (i > 0) { var t = P.wps[i - 1]; P.wps[i - 1] = P.wps[i]; P.wps[i] = t; dirty(); render(); draw(); } }
    else if (b.hasAttribute("data-st-ring")) { var id = b.getAttribute("data-st-ring"), j = P.rings.indexOf(id); if (j >= 0) P.rings.splice(j, 1); else P.rings.push(id); P.rings = P.rings.slice(-6); save(); render(); draw(); var nb = D.querySelector('#seatr [data-st-ring="' + (W.CSS && CSS.escape ? CSS.escape(id) : id) + '"]'); if (nb) nb.focus(); }
    else if (b.hasAttribute("data-st-go")) { var n = S.res && S.res.nodes.filter(function (x) { return x.node.id === b.getAttribute("data-st-go"); })[0], map = W.__asapMap; if (n && map) { if (W.OSAP_SPLIT && W.OSAP_SPLIT.focus) W.OSAP_SPLIT.focus(n.node.lat, n.node.lon, 9); else map.setView([n.node.lat, n.node.lon], 9); } }
  }
  function onChange(e) {
    var t = e.target;
    if (t.hasAttribute("data-st-wpn")) { var w = P.wps[+t.getAttribute("data-st-wpn")]; if (w) { w.n = clean(t.value, 40); save(); draw(); } return; }
    if (t.hasAttribute("data-st-num")) { var k = t.getAttribute("data-st-num"); P[k] = +t.value > 0 ? +t.value : DEF[k]; dirty(); render(); draw(); var a = D.querySelector('#seatr [data-st-num="' + k + '"]'); if (a) a.focus(); return; }
    if (t.hasAttribute("data-st-dep")) { P.dep = String(t.value || "").slice(0, 16); dirty(); render(); var d = D.querySelector("#seatr [data-st-dep]"); if (d) d.focus(); return; }
    if (t.hasAttribute("data-st-f")) { P.f = P.f || {}; P.f[t.getAttribute("data-st-f")] = String(t.value || "").slice(0, 600); save(); }
  }

  W.OSAP_SEATRANSIT = { open: open, close: close, state: function () { return { plan: JSON.parse(JSON.stringify(P)), busy: S.busy, res: S.res }; }, run: run, printView: printView, core: core };
})(this);
