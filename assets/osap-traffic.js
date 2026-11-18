/* AXIOM OSAP · Live traffic: all aircraft (ADS-B) and ships (AIS) as Map overlays switches on every tab.
   Aircraft: the cells on screen from the live-air branch (tools/refresh_air.mjs, .github/workflows/refresh-air.yml), swept from
   the free, keyless aggregators adsb.fi and adsb.lol, plus OpenSky Network's anonymous world snapshot. None of them lets another site read it, so the page cannot ask them itself; positions
   are a few minutes old (each pop-up gives the age). Zoomed in (the screen fits in a 250 nm circle), the area on screen is also
   asked live every 15 s through OSAP's own server (/api/air, netlify/edge-functions/osap-air.js), which can read them; the sweep
   fills in beyond that circle and stands in whenever the live answer fails. Ships: asked straight from Open Waters AIS (ais.openwaters.io/v1/vessels,
   no key, CORS open), which re-serves AISHub, Kystverket, Fintraffic and volunteer receivers, each with its own credit.
   Every item is a position the aircraft or ship itself broadcast, passed on as reported: not verified, not an identification,
   and not everything out there (transponders can be off, and areas without receivers show nothing). Read-only: it never adds
   a record. Off by default; nothing is fetched until a switch is on, and nothing refreshes while the page is hidden.
   Paths: each aircraft and ship draws a short trail of the positions this page has seen it at (the last 10 minutes for
   aircraft, the last hour for ships; trails build while the map is open and are kept in memory only). Selecting one draws
   its whole path: a ship's from Open Waters AIS's own track for it (last 24 hours, or 7 days on request; gaps where no
   receiver heard it are drawn dotted), an aircraft's current flight from OpenSky Network through OSAP's own server
   (/api/air-track, netlify/edge-functions/osap-air-track.js), or, where that is not available, the positions seen here. */
(function () {
  "use strict";
  var W = window, D = document;
  var AIR = "https://raw.githubusercontent.com/01shane89-jpg/AXIOM-APSAP/live-air/";
  var SEA = "https://ais.openwaters.io/v1/vessels";
  // live positions for the area on screen, asked through OSAP's own server (netlify/edge-functions/osap-air.js) every 15 s
  var LIVE = "/api/air", LIVE_EVERY = 15e3, LIVE_NM = 250, LIVE_OLD = 90e3;
  var EVERY = 60e3, AIR_STALE = 20 * 60e3, SEA_STALE = 6 * 3600e3, MAX_CELLS = 40, SEA_BOX = 10, MAX_BOXES = 8, LSK = "osap-traffic";
  var KINDS = [
    ["cargo", "Cargo", "#2e7d32"], ["tanker", "Tankers", "#c62828"], ["pass", "Passenger and ferries", "#1565c0"],
    ["gov", "Military and law enforcement", "#4a148c"], ["fish", "Fishing", "#ef6c00"], ["service", "Tugs, pilots, rescue, other service", "#00838f"],
    ["fast", "High-speed craft", "#f9a825"], ["leisure", "Sailing and pleasure craft", "#ad1457"], ["other", "Other or not stated", "#757575"]];
  var KC = {}; KINDS.forEach(function (k) { KC[k[0]] = k[2]; });
  var S = lsGet() || {};
  S.air = !!S.air; S.ground = !!S.ground; S.sea = !!S.sea; S.trail = S.trail !== false; S.k = S.k || {};
  KINDS.forEach(function (k) { if (S.k[k[0]] == null) S.k[k[0]] = true; });
  var map = null, renAir = null, renSea = null, renSel = null, gAir = null, gSea = null, timer = null, mvT = null, tick = 0;
  var A = { idx: null, cells: {}, err: "", busy: false, note: "", shown: 0, live: null, lerr: "", lbusy: false, loff: false, lnote: "" };
  var V = { list: {}, err: "", busy: false, note: "", shown: 0, trunc: false, attr: {}, at: 0 };
  var gSel = null, gAirT = null, gSeaT = null, SEL = null, TRACK = "/api/air-track";

  function lsGet() { try { return JSON.parse(localStorage.getItem(LSK) || "null"); } catch (e) { return null; } }
  function lsSet() { try { localStorage.setItem(LSK, JSON.stringify(S)); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function zt(ms) { return W.OSAP_TIME && W.OSAP_TIME.dualT ? W.OSAP_TIME.dualT(ms, { date: true }) : new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z"; }
  function ago(ms) { var m = Math.max(0, Math.round((Date.now() - ms) / 60e3)); return m < 1 ? "under a minute ago" : m < 60 ? m + " min ago" : m < 2880 ? Math.floor(m / 60) + " h" + (m % 60 ? " " + m % 60 + " min" : "") + " ago" : Math.round(m / 1440) + " days ago"; }
  function mgrs(lat, lon) { try { return W.MGRS_OF ? W.MGRS_OF(lat, lon) : ""; } catch (e) { return ""; } }
  function where(lat, lon) { var g = mgrs(lat, lon); return esc(lat.toFixed(4) + ", " + lon.toFixed(4)) + (g ? " · MGRS " + esc(g) : ""); }
  function sha256(s) {
    if (!(W.crypto && crypto.subtle && W.TextEncoder)) return Promise.resolve("");
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
    });
  }
  function getJson(u, ms) {
    var ctl = W.AbortController ? new AbortController() : null, t = setTimeout(function () { if (ctl) ctl.abort(); }, ms || 20000);
    return fetch(u, ctl ? { signal: ctl.signal, cache: "no-cache" } : {}).then(function (r) {
      clearTimeout(t);
      if (!r.ok) return r.text().then(function (x) { throw new Error("HTTP " + r.status + (x && x.length < 80 ? ": " + x.trim() : "")); });
      return r.json();
    }, function (e) { clearTimeout(t); throw e && e.name === "AbortError" ? new Error("no answer in " + Math.round((ms || 20000) / 1000) + " s") : e; });
  }

  /* one canvas marker for both: a pointed shape turned to the heading, or a dot when it has none or is not moving */
  var Glyph = L.CircleMarker.extend({
    _updatePath: function () {
      var r = this._renderer, o = this.options;
      if (!r || !r._ctx || o.hdg == null) return L.CircleMarker.prototype._updatePath.call(this);
      if (!r._drawing || this._empty()) return;
      var c = r._ctx, p = this._point, s = this._radius, a = (o.hdg * Math.PI) / 180, pts = o.shape === "air" ?
        [[0, -1.6], [0.25, -0.5], [1.4, 0.2], [1.4, 0.5], [0.25, 0.2], [0.2, 1.0], [0.6, 1.4], [-0.6, 1.4], [-0.2, 1.0], [-0.25, 0.2], [-1.4, 0.5], [-1.4, 0.2], [-0.25, -0.5]] :
        [[0, -1.6], [0.6, -0.6], [0.6, 1.3], [-0.6, 1.3], [-0.6, -0.6]];
      var ca = Math.cos(a), sa = Math.sin(a);
      c.beginPath();
      pts.forEach(function (q, i) { var x = p.x + (q[0] * ca - q[1] * sa) * s, y = p.y + (q[0] * sa + q[1] * ca) * s; if (i) c.lineTo(x, y); else c.moveTo(x, y); });
      c.closePath();
      r._fillStroke(c, this);
    }
  });

  /* ---------- paths ---------- */
  /* every position this page receives is kept per aircraft (ICAO address) or ship (MMSI), in memory only, in time order:
     [time ms, lat, lon, alt ft or null]. Trails draw the last few minutes of it; the selected one's whole path comes from
     its source where there is one (pathLoad). A jump faster than anything in the class can fly or sail, a long silence or a
     crossing of the 180th meridian starts a new piece instead of joining the dots */
  var TR = { air: {}, sea: {} }, TRAIL = { air: 10 * 60e3, sea: 60 * 60e3 }, KEEP = { air: 2 * 3600e3, sea: 6 * 3600e3 }, TMAX = 240, TIDS = 8000;
  var VMAX = { air: 1300 * 1852 / 3600e3, sea: 60 * 1852 / 3600e3 }, GAP = { air: 10 * 60e3, sea: 2 * 3600e3 }, prT = { air: 0, sea: 0 };
  function trAdd(kind, id, t, lat, lon, alt) {
    if (!id || !isFinite(t) || !isFinite(lat) || !isFinite(lon)) return;
    var s = TR[kind], a = s[id] || (s[id] = []), i = a.length - 1;
    while (i >= 0 && a[i][0] > t) i--;
    if (i >= 0 && a[i][0] === t) return; // the same report again
    a.splice(i + 1, 0, [t, lat, lon, alt == null ? null : alt]);
    if (a.length > TMAX) a.splice(0, a.length - TMAX);
  }
  function trPrune(kind) {
    var now = Date.now(); if (now - prT[kind] < 60e3) return; prT[kind] = now;
    var s = TR[kind], ids = Object.keys(s);
    ids.forEach(function (id) { var a = s[id]; while (a.length && now - a[0][0] > KEEP[kind]) a.shift(); if (!a.length) delete s[id]; });
    ids = Object.keys(s);
    if (ids.length > TIDS) ids.sort(function (x, y) { return s[x][s[x].length - 1][0] - s[y][s[y].length - 1][0]; }).slice(0, ids.length - TIDS).forEach(function (id) { delete s[id]; });
  }
  // points -> { solid: [[latlng, ...], ...], gaps: [[latlng, latlng], ...] }; brk: indexes where the source says a gap starts
  function pieces(kind, pts, brk) {
    var solid = [], gaps = [], cur = [], bset = {};
    (brk || []).forEach(function (i) { bset[i] = 1; });
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], q = pts[i - 1];
      if (q) {
        var wrap = Math.abs(p[2] - q[2]) > 180, dt = Math.max(1, p[0] - q[0]), d = map ? map.distance([q[1], q[2]], [p[1], p[2]]) : 0;
        var gap = bset[i] || dt > GAP[kind], jump = d / dt > VMAX[kind] && d > 2000;
        if (wrap || gap || jump) {
          if (cur.length > 1) solid.push(cur);
          if (gap && !wrap && !jump) gaps.push([[q[1], q[2]], [p[1], p[2]]]);
          cur = [];
        }
      }
      cur.push([p[1], p[2]]);
    }
    if (cur.length > 1) solid.push(cur);
    return { solid: solid, gaps: gaps };
  }
  function trailOf(kind, id, upto) {
    var a = TR[kind][id]; if (!a || a.length < 2) return null;
    var from = upto - TRAIL[kind], pts = a.filter(function (p) { return p[0] >= from && p[0] <= upto; });
    return pts.length > 1 ? pieces(kind, pts).solid : null;
  }
  function drawTrail(g, ren, pane, kind, id, upto, col) {
    var segs = S.trail && trailOf(kind, id, upto); if (!segs) return;
    segs.forEach(function (ll) { g.addLayer(L.polyline(ll, { renderer: ren, pane: pane, interactive: false, color: col, weight: kind === "air" ? 1.6 : 2, opacity: 0.55, lineCap: "round", lineJoin: "round" })); });
  }

  /* the selected one's whole path. key "air:<hex>" or "sea:<mmsi>"; the pop-up (and its copy in the Details panel) carries
     a line data-trpath=key that says where the path came from, how long and how many positions */
  function selKey(kind, id) { return kind + ":" + id; }
  function pathLine(kind, id) {
    return '<p class="obs trpath" style="margin:4px 0" data-trpath="' + esc(selKey(kind, id)) + '">' + pathText(selKey(kind, id)) + "</p>";
  }
  function span(ms) { var m = Math.round(ms / 60e3); return m < 60 ? m + " min" : m < 2880 ? Math.floor(m / 60) + " h" + (m % 60 ? " " + m % 60 + " min" : "") : Math.round(m / 1440) + " days"; }
  function pathText(key) {
    if (!SEL || SEL.key !== key) return "Path: tap to show.";
    var hide = ' <button type="button" class="trnow" data-trpath-act="hide">Hide path</button>';
    if (SEL.st === "loading") return "Path: loading…" + hide;
    if (SEL.st === "private") return "Path history is not shown for small private craft." + hide;
    var n = SEL.pts.length, t0 = n ? SEL.pts[0][0] : 0, t1 = n ? SEL.pts[n - 1][0] : 0;
    if (n < 2) return "<b>Path</b>: " + esc(SEL.note || "no earlier positions yet") + "." + hide;
    var more = SEL.kind === "sea" && SEL.days < 7 && SEL.st === "ok" ? ' <button type="button" class="trnow" data-trpath-act="week">Show 7 days</button>' : "";
    return "<b>Path on the map</b> (" + esc(SEL.src) + "): " + n.toLocaleString() + " positions from " + esc(zt(t0)) + " to " + esc(zt(t1)) + " (" + esc(span(t1 - t0)) + ")" +
      (SEL.gaps ? ", " + SEL.gaps + " gap" + (SEL.gaps > 1 ? "s" : "") + " where no receiver heard it (dotted)" : "") + "." +
      (SEL.note ? " " + esc(SEL.note) + "." : "") + " Each point is as broadcast, not verified." + more + hide;
  }
  function pathFill() {
    legend();
    if (!SEL) return;
    Array.prototype.forEach.call(D.querySelectorAll("[data-trpath]"), function (e) { e.innerHTML = pathText(e.getAttribute("data-trpath")); });
  }
  function pathDraw() {
    if (!gSel) return;
    gSel.clearLayers();
    if (!SEL || SEL.pts.length < 2 || !map) { if (map && map.hasLayer(gSel) && !SEL) map.removeLayer(gSel); return; }
    if (!map.hasLayer(gSel)) gSel.addTo(map);
    // its own canvas in its own pane above both kinds, so the path is not buried under a busy port's markers; never tappable
    var air = SEL.kind === "air", ren = renSel, pane = "trafselpane", col = air ? "#ff6d00" : "#d500f9";
    var pc = pieces(SEL.kind, SEL.pts, SEL.brk);
    SEL.gaps = pc.gaps.length;
    pc.gaps.forEach(function (ll) { gSel.addLayer(L.polyline(ll, { renderer: ren, pane: pane, interactive: false, color: col, weight: 2.5, opacity: 0.9, dashArray: "3 6" })); });
    pc.solid.forEach(function (ll) {
      gSel.addLayer(L.polyline(ll, { renderer: ren, pane: pane, interactive: false, color: "#fff", weight: 6.5, opacity: 0.85, lineCap: "round", lineJoin: "round" }));
      gSel.addLayer(L.polyline(ll, { renderer: ren, pane: pane, interactive: false, color: col, weight: 3.5, opacity: 1, lineCap: "round", lineJoin: "round" }));
    });
    var f = SEL.pts[0];
    gSel.addLayer(L.circleMarker([f[1], f[2]], { renderer: ren, pane: pane, interactive: false, radius: 4, color: col, weight: 2, fillColor: "#fff", fillOpacity: 1 }));
  }
  function pathHide() { SEL = null; pathDraw(); pathFill(); Array.prototype.forEach.call(D.querySelectorAll("[data-trpath]"), function (e) { e.innerHTML = "Path hidden."; }); }
  function sessionPts(kind, id) { return (TR[kind][id] || []).slice(); }
  function pathPick(kind, id, priv) {
    var key = selKey(kind, id);
    if (SEL && SEL.key === key && SEL.st !== "err") { pathFill(); return; }
    SEL = { key: key, kind: kind, id: id, st: priv ? "private" : "loading", pts: [], brk: null, src: "", note: "", days: 1, gaps: 0 };
    pathDraw(); pathFill();
    if (!priv) pathLoad(SEL);
  }
  function pathLoad(sel) {
    var done = function () { if (SEL !== sel) return; pathDraw(); pathFill(); };
    if (sel.kind === "sea") {
      var q = sel.days > 1 ? "?from=" + encodeURIComponent(new Date(Date.now() - sel.days * 864e5).toISOString().slice(0, 19) + "Z") : "";
      getJson(SEA + "/" + encodeURIComponent(sel.id) + "/track" + q, 25000).then(function (j) {
        var g = j && j.geometry, p = j && j.properties, c = g && g.coordinates, t = p && p.times;
        if (!g || g.type !== "LineString" || !Array.isArray(c) || !Array.isArray(t) || c.length !== t.length) throw new Error("unexpected answer");
        var pts = [];
        for (var i = 0; i < c.length; i++) { var ms = Date.parse(t[i]); if (c[i] && typeof c[i][0] === "number" && typeof c[i][1] === "number" && isFinite(ms)) pts.push([ms, c[i][1], c[i][0], null]); }
        sel.pts = pts; sel.brk = Array.isArray(p.breaks) ? p.breaks.filter(function (x) { return typeof x === "number"; }) : null;
        sel.src = "Open Waters AIS track" + (j.attribution ? ", " + Object.keys(j.attribution).map(function (k) { return { udp: "volunteer receivers", aishub: "AISHub", aisstream: "aisstream.io", barentswatch: "BarentsWatch" }[k] || k.slice(0, 30); }).join(", ") : "");
        sel.note = (p.simplified ? "Simplified by the source" : "") + (p.truncated ? (p.simplified ? "; " : "") + "cut short by the source" : "");
        sel.st = "ok";
      }).catch(function (e) {
        sel.pts = sessionPts("sea", sel.id); sel.st = "err"; sel.src = "positions seen since the map was opened";
        sel.note = "Open Waters AIS did not give this ship's track (" + String(e && e.message || e).slice(0, 80) + ")";
      }).then(done);
      return;
    }
    getJson(TRACK + "?hex=" + encodeURIComponent(sel.id), 15000).then(function (j) {
      if (!j || j.schema !== "osap-air-track/1" || !Array.isArray(j.path) || !j.src) throw new Error("unexpected answer");
      var pts = j.path.filter(function (r) { return Array.isArray(r) && typeof r[1] === "number" && typeof r[2] === "number"; }).map(function (r) { return [r[0] * 1000, r[1], r[2], r[3]]; });
      var last = pts.length ? pts[pts.length - 1][0] : 0;
      // newer positions this page has seen than the end of OpenSky's path
      sessionPts("air", sel.id).forEach(function (p) { if (p[0] > last) pts.push(p); });
      sel.pts = pts; sel.src = String(j.src.name || "OpenSky Network") + " flight path" + (j.src.nc ? ", non-commercial source" : ""); sel.st = "ok";
    }).catch(function (e) {
      var m = String(e && e.message || e);
      sel.pts = sessionPts("air", sel.id); sel.st = "err"; sel.src = "positions seen since the map was opened";
      sel.note = /^HTTP 401/.test(m) ? "Sign in for the whole flight from OpenSky" : /^HTTP 404/.test(m) ? "No earlier flight path from OpenSky for this aircraft" : "OpenSky's flight path did not load (" + m.slice(0, 80) + ")";
    }).then(done);
  }

  /* ---------- aircraft ---------- */
  var EMERG = { "7500": "7500 (unlawful interference)", "7600": "7600 (radio failure)", "7700": "7700 (emergency)" };
  function acObj(x, f) { var o = {}; for (var i = 0; i < f.length; i++) o[f[i]] = x[i]; return o; }
  function acColour(a) { return EMERG[a.sqk] ? "#d50000" : a.fl & 4 ? "#9e9e9e" : a.fl & 1 ? "#33691e" : "#0277bd"; }
  function acPop(a) {
    var s = a.S || (A.idx && A.idx.sources[a.src]) || {}, track = safeUrl(String(s.track || "").replace("{hex}", encodeURIComponent(a.hex)));
    var alt = a.fl & 4 ? "on the ground" : a.alt != null ? a.alt.toLocaleString() + " ft (barometric)" : "not sent", pos = a.pos * 1000;
    return '<div class="pop trafpop"><b>' + esc(a.fl & 1 ? "Military aircraft" : "Aircraft") + (a.cs ? " · " + esc(a.cs) : "") + "</b>" +
      (EMERG[a.sqk] ? '<p class="obs" style="margin:4px 0;color:#d50000"><b>Squawking ' + esc(EMERG[a.sqk]) + "</b>, as broadcast. Not confirmed.</p>" : "") +
      '<p class="obs" style="margin:4px 0">' +
        (a.t ? "Type " + esc(a.t) + (a.desc ? " (" + esc(a.desc) + ")" : "") + "<br>" : "") +
        (a.reg ? "Registration " + esc(a.reg) + "<br>" : "") +
        "ICAO address " + esc(a.hex.toUpperCase()) + (a.sqk ? " · squawk " + esc(a.sqk) : "") + "<br>" +
        "Altitude " + esc(alt) + (a.gs != null ? " · " + esc(a.gs) + " kt" : "") + (a.trk != null ? " · heading " + esc(("00" + a.trk).slice(-3)) + "°" : "") + "<br>" +
        "Position " + where(a.lat, a.lon) + "<br>" +
        "Reported " + esc(zt(pos)) + " (" + esc(ago(pos)) + ")" + (a.fl & 2 ? " · placed by receiver timing (MLAT)" : "") + (a.fl & 8 ? " · relayed by ground radar (TIS-B)" : "") + "</p>" +
      (a.fl & 1 ? '<p class="obs" style="margin:4px 0">Marked military in the aggregator\'s aircraft database.</p>' : "") +
      '<p class="obs" style="margin:4px 0">Source: ' + (track ? '<a href="' + esc(track) + '" target="_blank" rel="noopener noreferrer">' + esc(s.name || "") + " live track</a>" : esc(s.name || "")) +
        " (" + esc(s.licence || "") + (s.nc ? ", non-commercial source" : "") + ")</p>" + pathLine("air", a.hex) +
      '<p class="obs" style="font-size:10.5px">A position the aircraft broadcast, relayed by volunteer receivers and ' + (a.live ? "asked live by OSAP's server for the area on screen." : "collected by OSAP every few minutes.") + ' Reported, not verified, and not an identification. Record fingerprint <span class="trfp" data-fp="' +
        esc([a.hex, a.cs, a.reg, a.t, a.lat, a.lon, a.alt, a.gs, a.trk, a.pos, s.name, a.sqk].join("␟")) + '">computing…</span></p></div>';
  }
  function acTip(a) {
    return esc(a.cs || a.reg || a.hex.toUpperCase()) + (a.t ? " · " + esc(a.t) : "") + " · " + (a.fl & 4 ? "ground" : a.alt != null ? esc(a.alt.toLocaleString()) + " ft" : "alt ?") + " · " + esc(ago(a.pos * 1000));
  }
  function cellsInView() {
    var b = map.getBounds(), s = Math.max(-90, b.getSouth()), n = Math.min(90, b.getNorth()), w = b.getWest(), e = b.getEast(), out = [];
    if (e - w >= 360) { w = -180; e = 180; }
    for (var la = Math.floor(s / 10) * 10; la < n; la += 10)
      for (var lo = Math.floor(w / 10) * 10; lo < e; lo += 10) {
        var L0 = ((lo + 180) % 360 + 360) % 360 - 180;
        out.push(la + "_" + L0);
      }
    return out;
  }
  function airLoad() {
    if (A.busy || !S.air) return;
    A.busy = true;
    getJson(AIR + "index.json").then(function (j) {
      if (!j || j.schema !== "osap-air-traffic/1" || !j.cells || !Array.isArray(j.f)) throw new Error("unexpected file");
      A.idx = j; A.err = "";
    }).catch(function (e) { A.err = String(e && e.message || e); }).then(function () { A.busy = false; airCells(); });
  }
  // the circle that covers the screen (centre to the farthest corner), or null when that is wider than the providers answer for
  function viewCircle() {
    var c = map.getCenter(), b = map.getBounds(), r = 0;
    [b.getNorthEast(), b.getNorthWest(), b.getSouthEast(), b.getSouthWest()].forEach(function (p) { r = Math.max(r, map.distance(c, p) / 1852); });
    if (!(r > 0) || r > LIVE_NM || Math.abs(c.lat) > 85) return null;
    return { lat: +c.lat.toFixed(3), lon: +(((c.lng + 180) % 360 + 360) % 360 - 180).toFixed(3), nm: Math.ceil(r) };
  }
  function liveFresh() { return A.live && Date.now() - Date.parse(A.live.built) < LIVE_OLD ? A.live : null; }
  function liveLoad() {
    if (!S.air || !map || A.loff || A.lbusy || !/^https?:$/.test(location.protocol)) return;
    var c = viewCircle();
    if (!c) { A.lnote = "zoom"; A.live = null; airDraw(); return; }
    A.lnote = ""; A.lbusy = true;
    getJson(LIVE + "?lat=" + c.lat + "&lon=" + c.lon + "&nm=" + c.nm, 12000).then(function (j) {
      if (!j || j.schema !== "osap-air-live/1" || !Array.isArray(j.ac) || !Array.isArray(j.f) || !j.src) throw new Error("unexpected answer");
      A.live = j; A.lerr = "";
    }).catch(function (e) {
      var m = String(e && e.message || e);
      // no relay on this site (GitHub Pages, a local copy): stop asking and keep to the sweep
      if (/^HTTP 404/.test(m)) A.loff = true;
      A.lerr = /^HTTP 502/.test(m) ? "the live providers did not answer" : /^HTTP 401/.test(m) ? "sign in needed" : m;
    }).then(function () { A.lbusy = false; airDraw(); });
  }
  function refreshNow() { if (!S.air) return; A.loff = false; airLoad(); liveLoad(); }
  function airCells() {
    if (!S.air || !A.idx || !map) { airDraw(); return; }
    var all = cellsInView(), want = all.filter(function (k) { return A.idx.cells[k]; });
    if (want.length > MAX_CELLS || all.length > 2 * MAX_CELLS) { A.note = "zoom"; airDraw(); return; }
    A.note = "";
    var need = want.filter(function (k) { return !A.cells[k] || A.cells[k].built !== A.idx.built; });
    if (!need.length) { airDraw(); return; }
    Promise.all(need.map(function (k) {
      return getJson(AIR + "a/" + k + ".json").then(function (j) {
        if (j && j.schema === "osap-air-cell/1" && Array.isArray(j.ac)) A.cells[k] = { built: j.built, ac: j.ac };
      }).catch(function (e) { A.err = String(e && e.message || e); });
    })).then(airDraw);
  }
  function addAc(a, q) { q.push(a); A.shown++; }
  function drawAc(a) {
    var col = acColour(a), m = new Glyph([a.lat, a.lon], { renderer: renAir, pane: "trafairpane", radius: EMERG[a.sqk] ? 8 : 5.5, hdg: a.fl & 4 ? null : a.trk,
      shape: "air", color: "#fff", weight: 1, fillColor: col, fillOpacity: 0.95 });
    m.bindPopup(function () { pathPick("air", a.hex); return acPop(a); }, { maxWidth: 330 });
    m.bindTooltip(function () { return acTip(a); }, { direction: "top", offset: [0, -6] });
    gAir.addLayer(m);
  }
  function airDraw() {
    if (!gAir) return;
    gAir.clearLayers(); gAirT.clearLayers(); A.shown = 0;
    var lv = S.air && map ? liveFresh() : null, lhex = {}, q = [];
    if (lv) {
      var lb = map.getBounds().pad(0.15), lc = L.latLng(lv.lat, lv.lon), lnow = Date.now();
      lv.ac.forEach(function (x) {
        var a = acObj(x, lv.f); a.S = lv.src; a.live = true;
        if (a.lat == null || a.lon == null || !a.hex) return;
        lhex[a.hex] = 1; trAdd("air", a.hex, a.pos * 1000, a.lat, a.lon, a.alt);
        if (!lb.contains([a.lat, a.lon]) || ((a.fl & 4) && !S.ground) || lnow - a.pos * 1000 > AIR_STALE) return;
        addAc(a, q);
      });
    }
    if (S.air && A.idx && A.note !== "zoom") {
      var b = map.getBounds().pad(0.15), f = A.idx.f, now = Date.now();
      cellsInView().forEach(function (k) {
        var c = A.cells[k]; if (!c || !A.idx.cells[k]) return;
        c.ac.forEach(function (x) {
          var a = acObj(x, f);
          if (a.lat == null || a.lon == null || !a.hex) return;
          trAdd("air", a.hex, a.pos * 1000, a.lat, a.lon, a.alt);
          if (!b.contains([a.lat, a.lon])) return;
          if ((a.fl & 4) && !S.ground) return;
          if (now - a.pos * 1000 > AIR_STALE) return;
          // inside the live circle the live answer is the picture; the sweep only fills in beyond it
          if (lv && (lhex[a.hex] || map.distance(lc, [a.lat, a.lon]) / 1852 < lv.nm)) return;
          addAc(a, q);
        });
      });
    }
    trPrune("air");
    // trails first, so every aircraft is drawn over the lines
    q.forEach(function (a) { if (!(a.fl & 4)) drawTrail(gAirT, renAir, "trafairpane", "air", a.hex, a.pos * 1000, acColour(a)); });
    q.forEach(drawAc);
    legend(); panel();
  }

  /* ---------- ships ---------- */
  function kindOf(t) {
    t = +t || 0;
    if (t === 30) return "fish";
    if (t === 35 || t === 55) return "gov";
    if (t >= 31 && t <= 34 || t >= 50 && t <= 59) return "service";
    if (t === 36 || t === 37) return "leisure";
    if (t >= 40 && t <= 49) return "fast";
    if (t >= 60 && t <= 69) return "pass";
    if (t >= 70 && t <= 79) return "cargo";
    if (t >= 80 && t <= 89) return "tanker";
    return "other";
  }
  var NAV = ["under way using engine", "at anchor", "not under command", "restricted manoeuvrability", "constrained by draft", "moored", "aground",
    "engaged in fishing", "under way sailing", "", "", "towing astern", "pushing ahead or towing alongside", "", "AIS-SART, MOB or EPIRB active", ""];
  var TYPE = { 30: "Fishing", 31: "Towing", 32: "Towing (large)", 33: "Dredging or underwater operations", 34: "Diving operations", 35: "Military operations",
    36: "Sailing", 37: "Pleasure craft", 50: "Pilot vessel", 51: "Search and rescue", 52: "Tug", 53: "Port tender", 54: "Anti-pollution", 55: "Law enforcement",
    58: "Medical transport", 59: "Non-combatant (RR Resolution 18)" };
  function typeName(t) {
    t = +t || 0;
    if (TYPE[t]) return TYPE[t];
    var g = Math.floor(t / 10);
    return g === 2 ? "Wing in ground" : g === 4 ? "High-speed craft" : g === 6 ? "Passenger" : g === 7 ? "Cargo" : g === 8 ? "Tanker" : g === 9 || g === 5 ? "Other" : "";
  }
  var DN = null; try { DN = W.Intl && Intl.DisplayNames ? new Intl.DisplayNames(["en"], { type: "region" }) : null; } catch (e) { DN = null; }
  function flagName(f) { if (!f || !/^[A-Z]{2}$/.test(f)) return ""; try { return (DN && DN.of(f)) || f; } catch (e) { return f; } }
  function shPop(v) {
    var p = v.p, k = kindOf(p.type), seen = Date.parse(p.seen), priv = k === "leisure", nav = p.nav_status != null ? NAV[p.nav_status] : "";
    var attr = (V.attr && V.attr[p.source]) || "Open Waters AIS (https://openwaters.io/ais/)", link = "https://openwaters.io/ais/vessels/" + encodeURIComponent(p.mmsi);
    var size = p.length ? p.length + " m" + (p.beam ? " × " + p.beam + " m" : "") : "";
    return '<div class="pop trafpop"><b>' + esc(priv ? "Sailing or pleasure craft" : p.name || "Vessel") + (typeName(p.type) && !priv ? " · " + esc(typeName(p.type)) : "") + "</b>" +
      '<p class="obs" style="margin:4px 0">' +
        "MMSI " + esc(p.mmsi) + (!priv && p.imo ? " · IMO " + esc(p.imo) : "") + (!priv && p.callsign ? " · call sign " + esc(p.callsign) : "") + "<br>" +
        (p.flag ? "Flag " + esc(flagName(p.flag)) + " (from the MMSI)<br>" : "") +
        (size ? "Size " + esc(size) + (p.draught ? " · draft " + esc(p.draught) + " m" : "") + "<br>" : "") +
        (nav ? "Status " + esc(nav) + "<br>" : "") +
        (p.sog != null ? "Speed " + esc(p.sog) + " kn" : "") + (p.cog != null ? " · course " + esc(Math.round(p.cog)) + "°" : "") + (p.heading != null && p.heading < 360 ? " · heading " + esc(p.heading) + "°" : "") + "<br>" +
        (!priv && p.destination ? "Destination (as entered by the crew) " + esc(p.destination) + (p.eta ? " · ETA " + esc(p.eta) : "") + "<br>" : "") +
        "Position " + where(v.lat, v.lon) + "<br>" +
        "Last heard " + (isFinite(seen) ? esc(zt(seen)) + " (" + esc(ago(seen)) + ")" : "time not given") + "</p>" +
      (priv ? '<p class="obs" style="margin:4px 0">Name and call sign of small private craft are not shown.</p>' : "") +
      '<p class="obs" style="margin:4px 0">Source: <a href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">Open Waters AIS vessel page</a> · ' + esc(attr) + "</p>" + pathLine("sea", p.mmsi) +
      '<p class="obs" style="font-size:10.5px">A position the ship broadcast on AIS, as reported. AIS can be switched off or spoofed; not verified and not an identification. Record fingerprint <span class="trfp" data-fp="' +
        esc([p.mmsi, priv ? "" : p.name, v.lat, v.lon, p.sog, p.cog, p.heading, p.seen, p.source].join("␟")) + '">computing…</span></p></div>';
  }
  function shTip(v) {
    var p = v.p, k = kindOf(p.type), seen = Date.parse(p.seen);
    return esc(k === "leisure" ? "Pleasure craft" : p.name || "MMSI " + p.mmsi) + " · " + esc(typeName(p.type) || "type not stated") + (p.sog != null ? " · " + esc(p.sog) + " kn" : "") + (isFinite(seen) ? " · " + esc(ago(seen)) : "");
  }
  /* the free tier answers one box of at most 100 square degrees, so the screen is cut into 10° boxes; too many means zoom in */
  function seaBoxes() {
    var b = map.getBounds(), s = Math.max(-85, b.getSouth()), n = Math.min(85, b.getNorth()), w = b.getWest(), e = b.getEast(), out = [];
    if (e - w >= 360) return null;
    var nx = Math.ceil((e - w) / SEA_BOX), ny = Math.ceil((n - s) / SEA_BOX);
    if (nx * ny > MAX_BOXES) return null;
    var dx = (e - w) / nx, dy = (n - s) / ny;
    for (var i = 0; i < nx; i++) for (var j = 0; j < ny; j++) {
      var lo1 = w + i * dx, lo2 = lo1 + dx, la1 = s + j * dy, la2 = la1 + dy;
      var a1 = ((lo1 + 180) % 360 + 360) % 360 - 180, a2 = a1 + (lo2 - lo1);
      if (a2 > 180) { out.push([la1, a1, la2, 180]); out.push([la1, -180, la2, a2 - 360]); } else out.push([la1, a1, la2, a2]);
    }
    return out.map(function (q) { return q.map(function (x) { return +x.toFixed(3); }); });
  }
  function seaLoad() {
    if (!S.sea || !map) return;
    var boxes = seaBoxes();
    if (!boxes) { V.note = "zoom"; seaDraw(); return; }
    if (V.busy) { V.again = true; return; } // the view moved while asking: ask again for the new view when this answer is in
    V.note = ""; V.busy = true; V.again = false;
    var got = {}, trunc = false, attr = {}, errs = [];
    Promise.all(boxes.map(function (q) {
      return getJson(SEA + "?bbox=" + q.join(","), 25000).then(function (j) {
        if (!j || !Array.isArray(j.features)) throw new Error("unexpected answer");
        if (j.truncated) trunc = true;
        if (j.attribution) for (var k in j.attribution) attr[k] = String(j.attribution[k]).slice(0, 300);
        j.features.forEach(function (f) {
          var p = f && f.properties, c = f && f.geometry && f.geometry.coordinates;
          if (!p || !c || typeof c[0] !== "number" || typeof c[1] !== "number" || p.mmsi == null) return;
          if (p.kind && p.kind !== "vessel") return;
          got[p.mmsi] = { lat: c[1], lon: c[0], p: p };
          trAdd("sea", String(p.mmsi), Date.parse(p.seen), c[1], c[0], null);
        });
      }).catch(function (e) { errs.push(String(e && e.message || e)); });
    })).then(function () {
      V.busy = false;
      if (errs.length < boxes.length) { V.list = got; V.trunc = trunc; V.attr = attr; V.at = Date.now(); }
      V.err = errs.length ? errs[0] : "";
      seaDraw();
      if (V.again) seaLoad();
    });
  }
  function seaDraw() {
    if (!gSea) return;
    gSea.clearLayers(); gSeaT.clearLayers(); V.shown = 0;
    if (S.sea && V.note !== "zoom") {
      var b = map.getBounds().pad(0.15), now = Date.now(), q = [];
      trPrune("sea");
      Object.keys(V.list).forEach(function (id) {
        var v = V.list[id], p = v.p, k = kindOf(p.type), seen = Date.parse(p.seen);
        if (!S.k[k] || !b.contains([v.lat, v.lon])) return;
        if (isFinite(seen) && now - seen > SEA_STALE) return;
        q.push(id);
        drawTrail(gSeaT, renSea, "trafseapane", "sea", String(p.mmsi), isFinite(seen) ? seen : now, KC[k]);
      });
      q.forEach(function (id) {
        var v = V.list[id], p = v.p, k = kindOf(p.type);
        var moving = p.sog != null && p.sog >= 0.5, hdg = moving ? (p.heading != null && p.heading < 360 ? p.heading : p.cog) : null;
        var m = new Glyph([v.lat, v.lon], { renderer: renSea, pane: "trafseapane", radius: moving ? 5 : 3.5, hdg: hdg, shape: "ship",
          color: "#fff", weight: 1, fillColor: KC[k], fillOpacity: 0.9 });
        m.bindPopup(function () { pathPick("sea", String(p.mmsi), k === "leisure"); return shPop(v); }, { maxWidth: 330 });
        m.bindTooltip(function () { return shTip(v); }, { direction: "top", offset: [0, -6] });
        gSea.addLayer(m); V.shown++;
      });
    }
    legend(); panel();
  }

  /* ---------- panel, legend, switches ---------- */
  function legend() {
    if (!W.OSAP_LEGEND) return;
    W.OSAP_LEGEND.set("traffic-air", S.air ? "<h3>Air traffic (ADS-B)</h3>" +
      [["#0277bd", "Aircraft"], ["#33691e", "Military (aggregator database)"], ["#d50000", "Emergency squawk"]].concat(S.ground ? [["#9e9e9e", "On the ground"]] : [])
        .map(function (r) { return '<p class="mlkey" style="margin:2px 0"><span style="background:' + r[0] + '"></span>' + r[1] + "</p>"; }).join("") +
      '<p class="mlkey" style="margin:2px 0">Pointed to the heading.' + (S.trail ? " Line behind: positions seen in the last 10 min." : "") + "</p>" + selLegend("air") + airAge() : "");
    W.OSAP_LEGEND.set("traffic-sea", S.sea ? "<h3>Ships (AIS)</h3>" +
      KINDS.filter(function (k) { return S.k[k[0]]; }).map(function (k) { return '<p class="mlkey" style="margin:2px 0"><span style="background:' + k[2] + '"></span>' + esc(k[1]) + "</p>"; }).join("") +
      '<p class="mlkey" style="margin:2px 0">Pointed to the heading when moving; small dot when stopped.' + (S.trail ? " Line behind: positions seen in the last hour." : "") + "</p>" + selLegend("sea") : "");
  }
  function selLegend(kind) {
    if (!SEL || SEL.kind !== kind || SEL.pts.length < 2) return "";
    return '<p class="mlkey" style="margin:2px 0"><span style="background:' + (kind === "air" ? "#ff6d00" : "#d500f9") + '"></span>Selected ' + (kind === "air" ? "aircraft" : "ship") +
      "'s path (open circle = earliest point, dotted = not heard) " + '<button type="button" class="trnow" data-trpath-act="hide">Hide path</button></p>';
  }
  // how old the aircraft on the map are, on the map itself (the legend), so old positions never pass for live ones
  function secAgo(ms) { var x = Math.max(0, Math.round((Date.now() - ms) / 1000)); return x < 90 ? x + " s ago" : ago(ms); }
  var NOWBTN = '<button type="button" class="trnow" data-trf-now="1">Refresh now</button>';
  function liveLine() {
    var lv = liveFresh();
    if (A.loff && !lv) return "";
    if (lv) return "<b>Live</b> for the area on screen: " + esc(lv.src.name) + ", asked " + esc(secAgo(Date.parse(lv.built))) + " (updates every 15 s).";
    if (A.lnote === "zoom") return "Zoom in for live positions (the live feed answers for up to " + LIVE_NM + " nm around the center).";
    if (A.lerr) return "Live positions unavailable (" + esc(A.lerr) + ").";
    return A.lbusy ? "Asking for live positions…" : "";
  }
  function airAge() {
    var lv = S.air && map ? liveFresh() : null, ll = liveLine();
    if (lv) return '<p class="mlkey tra-age" style="margin:2px 0">' + ll + " " + NOWBTN + "</p>";
    if (!A.idx) return '<p class="mlkey" style="margin:2px 0">' + (A.err ? "Could not load the live files." : "Loading…") + "</p>";
    var b = Date.parse(A.idx.built), old = Date.now() - b > AIR_STALE;
    return '<p class="mlkey tra-age" style="margin:2px 0' + (old ? ";color:#c62828;font-weight:600" : "") + '">' + (old ? "Stale: " : "") + "data " + esc(ago(b).replace(" ago", "")) + " old (swept " + esc(zt(b)) + ")" +
      (old ? ". OSAP's sweep has not run since; these positions are that old." : ".") + (ll ? " " + ll : "") + " " + NOWBTN + "</p>";
  }
  function airStatus() {
    if (!S.air) return "Off. Switch on to load.";
    if (A.err && !A.idx) return "Could not load the live air traffic files (" + esc(A.err) + ").";
    if (!A.idx) return "Loading…" + (liveLine() ? " " + liveLine() : "");
    var b = Date.parse(A.idx.built), old = Date.now() - b > AIR_STALE;
    return (old ? '<b style="color:#c62828">Stale: OSAP\'s sweep has not run since.</b> ' : "") + "Swept " + esc(zt(b)) + " (" + esc(ago(b)) + "), " + A.idx.total.toLocaleString() + " aircraft worldwide. " +
      (A.note === "zoom" ? "<b>Zoom in to see them</b> (too much of the world on screen)." : A.shown.toLocaleString() + " on screen" + (S.ground ? "" : " in the air") + ".") +
      (A.err ? " Last update failed (" + esc(A.err) + "); showing the previous one." : "") + (liveLine() ? " " + liveLine() : "") + " " + NOWBTN;
  }
  function seaStatus() {
    if (!S.sea) return "Off. Switch on to load.";
    if (V.note === "zoom") return "<b>Zoom in to see ships.</b> The free ship feed answers for about 10° × 10° at a time, so OSAP asks for up to " + MAX_BOXES + " such boxes.";
    if (V.err && !V.at) return "Could not load ships (" + esc(V.err) + ").";
    if (!V.at) return "Loading…";
    return "Updated " + esc(zt(V.at)) + ". " + V.shown.toLocaleString() + " ships on screen" + (V.busy ? ", refreshing…" : "") + "." +
      (V.trunc ? " Busy area: the feed left out some ships not heard for over 30 minutes." : "") +
      (V.err ? " Part of the update failed (" + esc(V.err) + ")." : "");
  }
  // emergency squawks worldwide from the sweep's index (tools/refresh_air.mjs, rules milpat-v1): a list that takes the map there
  function emergList() {
    var x = S.air && A.idx && Array.isArray(A.idx.emerg) ? A.idx.emerg : [], f = (A.idx && A.idx.f) || [];
    var ix = function (k) { return f.indexOf(k); }, now = Date.now() / 1000;
    x = x.filter(function (r) { return Array.isArray(r) && EMERG[r[ix("sqk")]] && now - r[ix("pos")] <= AIR_STALE / 1000 + 900; });
    if (!x.length) return "";
    return '<p class="mlkey" style="margin:4px 0 0;color:#d50000"><b>Emergency squawks now (' + x.length + ")</b>, as broadcast, not confirmed</p>" +
      '<ul class="tremlist">' + x.slice(0, 10).map(function (r) {
        var la = r[ix("lat")], lo = r[ix("lon")];
        return '<li><button type="button" data-trgo="' + esc(la + "," + lo) + '">' + esc(r[ix("cs")] || String(r[ix("hex")]).toUpperCase()) + (r[ix("t")] ? " · " + esc(r[ix("t")]) : "") + " · " + esc(EMERG[r[ix("sqk")]]) + " · " + esc(ago(r[ix("pos")] * 1000)) + "</button></li>";
      }).join("") + "</ul>";
  }
  function panel() {
    var a = D.getElementById("tra-st"), s = D.getElementById("trs-st"), em = D.getElementById("tra-em");
    if (a) a.innerHTML = airStatus();
    if (em) em.innerHTML = emergList();
    if (s) s.innerHTML = seaStatus();
  }
  function mount() {
    var air = D.getElementById("ml-air");
    if (!air) return false;
    if (!D.getElementById("ml-trair")) {
      var d = D.createElement("div"); d.id = "ml-trair";
      d.innerHTML = '<label class="mlrow"><input type="checkbox" data-trf="air"' + (S.air ? " checked" : "") + '><span><b>All air traffic</b><i>Every aircraft broadcasting ADS-B, from adsb.fi, adsb.lol and OpenSky. Zoomed in, positions come live for the area on screen every 15 seconds; zoomed out, from OSAP&#39;s world sweep (5 to 15 minutes old). Each pop-up gives its age</i></span></label>' +
        '<label class="mlrow trsub"><input type="checkbox" data-trf="ground"' + (S.ground ? " checked" : "") + '><span><b>Include aircraft on the ground</b></span></label>' +
        '<label class="mlrow trsub"><input type="checkbox" data-trf="trail"' + (S.trail ? " checked" : "") + '><span><b>Trails behind aircraft and ships</b><i>The last 10 minutes (aircraft) or hour (ships) of positions seen while the map is open. Tap one for its whole path</i></span></label>' +
        '<p class="mlkey" id="tra-st"></p><div id="tra-em"></div>';
      d.style.cssText = "border-top:1px solid var(--line,#ddd);margin-top:6px;padding-top:4px";
      air.appendChild(d); // after the drone switches and their notes
    }
    if (!D.getElementById("ml-sea")) {
      var s = D.createElement("div"); s.id = "ml-sea";
      s.innerHTML = '<div class="mlh">Ships</div>' +
        '<label class="mlrow"><input type="checkbox" data-trf="sea"' + (S.sea ? " checked" : "") + '><span><b>Ships (AIS)</b><i>Ships broadcasting AIS, from Open Waters AIS (AISHub, Norway, Finland and volunteer receivers). Asked for the area on screen; refreshed every minute</i></span></label>' +
        '<div class="trkinds">' + KINDS.map(function (k) {
          return '<label><input type="checkbox" data-trk="' + k[0] + '"' + (S.k[k[0]] ? " checked" : "") + '><span class="trsw" style="background:' + k[2] + '"></span>' + esc(k[1]) + "</label>";
        }).join("") + "</div>" +
        '<label class="mlrow trsub"><input type="checkbox" data-trf="trail"' + (S.trail ? " checked" : "") + '><span><b>Trails behind ships</b><i>Tap a ship for its whole path (last 24 hours, from Open Waters AIS)</i></span></label>' +
        '<p class="mlkey" id="trs-st"></p>' +
        '<p class="mlkey">Only ships with AIS switched on appear, and only where a receiver hears them: coastal coverage is good, open ocean thin (no satellite AIS in the free feed). Military ships often transmit nothing. Positions and names are as broadcast, not verified.</p>';
      air.parentNode.insertBefore(s, air.nextSibling);
    }
    return true;
  }
  function run() {
    var any = S.air || S.sea;
    // each kind's trails (gAirT, gSeaT) are their own group, cleared and drawn before the markers so the lines lie under them
    if (S.air) { if (!map.hasLayer(gAirT)) gAirT.addTo(map); if (!map.hasLayer(gAir)) gAir.addTo(map); if (!A.idx) airLoad(); else airCells(); }
    else { if (map.hasLayer(gAir)) map.removeLayer(gAir); if (map.hasLayer(gAirT)) map.removeLayer(gAirT); }
    if (S.sea) { if (!map.hasLayer(gSeaT)) gSeaT.addTo(map); if (!map.hasLayer(gSea)) gSea.addTo(map); seaLoad(); }
    else { if (map.hasLayer(gSea)) map.removeLayer(gSea); if (map.hasLayer(gSeaT)) map.removeLayer(gSeaT); }
    if (S.air) liveLoad();
    // every 15 s: live positions for the area on screen; every fourth tick the sweep index and the ships
    if (any && !timer) timer = setInterval(function () {
      if (D.hidden) return;
      tick++;
      if (S.air) liveLoad();
      if (tick % (EVERY / LIVE_EVERY)) return;
      if (S.air) airLoad(); if (S.sea) seaLoad();
    }, LIVE_EVERY);
    if (!any && timer) { clearInterval(timer); timer = null; }
    if (SEL && !(SEL.kind === "air" ? S.air : S.sea)) pathHide();
    airDraw(); seaDraw();
  }
  function start(n) {
    map = W.__asapMap;
    if (!map || !W.L || !mount()) { if (n < 80) setTimeout(function () { start(n + 1); }, 250); return; }
    var css = D.createElement("style");
    css.textContent = "#ml-trair .trsub{padding-left:22px}#ml-sea .trkinds{display:grid;grid-template-columns:1fr 1fr;gap:2px 8px;margin:2px 0 4px 22px;font-size:12px}" +
      "#ml-sea .trkinds label{display:flex;gap:5px;align-items:center;cursor:pointer}#ml-sea .trsw{display:inline-block;width:10px;height:10px;border-radius:2px;flex:none}" +
      "@media (max-width:420px){#ml-sea .trkinds{grid-template-columns:1fr}}" +
      "#ml-trair .tremlist{list-style:none;margin:2px 0 6px;padding:0}#ml-trair .tremlist button{font:inherit;font-size:12px;background:none;border:0;padding:4px 0;min-height:32px;color:#d50000;text-decoration:underline;cursor:pointer;text-align:left}" +
      "@media (pointer:coarse){#ml-trair .tremlist button{min-height:44px}}" +
      ".trnow{font:inherit;font-size:11px;padding:1px 8px;margin-left:4px;border:1px solid var(--line,#bbb);border-radius:10px;background:var(--panel,#fff);color:inherit;cursor:pointer}";
    D.head.appendChild(css);
    ["trafseapane", "trafairpane", "trafselpane"].forEach(function (p, i) { if (!map.getPane(p)) { map.createPane(p); map.getPane(p).style.zIndex = 660 + i; } });
    map.getPane("trafselpane").style.pointerEvents = "none"; // the selected path (pathDraw) is never tapped: taps go through to the markers
    /* each kind draws on a canvas in its own pane, above the base map's shapes. One shared canvas without a pane went into
       Leaflet's overlay pane, level with the map's own canvas, so on a page with a tappable outline under the aircraft (a US
       state such as Texas) the map-click finder in index.html reached the outline first and a tap on an aircraft opened
       the state's card instead. The hit margin is left to the page's default: 14 px beyond the marker on touch screens
       (index.html, "on touch screens every canvas marker answers a tap"), 4 px with a mouse */
    var tol = W.matchMedia && matchMedia("(pointer: coarse)").matches ? 14 : 4;
    renAir = L.canvas({ pane: "trafairpane", padding: 0.2, tolerance: tol });
    renSea = L.canvas({ pane: "trafseapane", padding: 0.2, tolerance: tol });
    renSel = L.canvas({ pane: "trafselpane", padding: 0.2 });
    gAir = L.layerGroup(); gSea = L.layerGroup(); gSel = L.layerGroup(); gAirT = L.layerGroup(); gSeaT = L.layerGroup();
    D.addEventListener("change", function (e) {
      var t = e.target, k = t.dataset && t.dataset.trf, kk = t.dataset && t.dataset.trk;
      if (k) {
        S[k] = t.checked; lsSet();
        if (k === "trail") Array.prototype.forEach.call(D.querySelectorAll('[data-trf="trail"]'), function (x) { x.checked = S.trail; });
        run();
      }
      else if (kk) { S.k[kk] = t.checked; lsSet(); seaDraw(); }
    });
    map.on("moveend", function () {
      if (!(S.air || S.sea)) return;
      clearTimeout(mvT);
      mvT = setTimeout(function () { if (S.air) { airCells(); liveLoad(); } if (S.sea) seaLoad(); }, 500);
    });
    // the pop-up may have been copied into the Details panel (phones) by now: fill every copy still waiting
    map.on("popupopen", function () {
      Array.prototype.forEach.call(D.querySelectorAll(".trfp[data-fp]"), function (f) {
        var v = f.getAttribute("data-fp"); f.removeAttribute("data-fp");
        sha256(v).then(function (h) { f.textContent = h ? h.slice(0, 16) + "…" : "not available"; });
      });
    });
    D.addEventListener("visibilitychange", function () { if (D.hidden) return; if (S.air) { airLoad(); liveLoad(); } if (S.sea) seaLoad(); });
    D.addEventListener("click", function (e) {
      var b = e.target && e.target.closest && e.target.closest("[data-trgo]"); if (!b || !map) return;
      var p = b.getAttribute("data-trgo").split(",").map(Number); if (p.length === 2 && isFinite(p[0]) && isFinite(p[1])) map.setView(p, Math.max(map.getZoom(), 8));
    });
    D.addEventListener("click", function (e) {
      var t = e.target && e.target.closest && e.target.closest("[data-trf-now]"); if (t) { e.preventDefault(); refreshNow(); return; }
      var pa = e.target && e.target.closest && e.target.closest("[data-trpath-act]"); if (!pa || !SEL) return;
      e.preventDefault();
      if (pa.getAttribute("data-trpath-act") === "hide") pathHide();
      else if (SEL.kind === "sea") { SEL.days = 7; SEL.st = "loading"; pathFill(); pathLoad(SEL); }
    });
    if (S.air || S.sea) run(); else panel();
  }
  W.OSAP_TRAFFIC = { air: function () { return A; }, sea: function () { return V; }, layers: function () { return { air: gAir, sea: gSea, airTrails: gAirT, seaTrails: gSeaT, path: gSel }; }, kindOf: kindOf, boxes: function () { return map && seaBoxes(); },
    reload: function () { airLoad(); seaLoad(); }, refresh: refreshNow, live: function () { return liveFresh(); },
    // paths (assets/osap-traffic.js "paths"): the positions kept per aircraft/ship, and the selected one's whole path. Read-only
    // copies, so another layer (AIS gaps, for example) can read them without changing what is drawn
    trails: function (kind) { var o = {}, s = TR[kind === "sea" ? "sea" : "air"]; for (var k in s) o[k] = s[k].map(function (p) { return p.slice(); }); return o; },
    path: function () { return SEL ? { kind: SEL.kind, id: SEL.id, st: SEL.st, src: SEL.src, note: SEL.note, gaps: SEL.gaps, pts: SEL.pts.map(function (p) { return p.slice(); }) } : null; },
    pick: function (kind, id) { pathPick(kind === "sea" ? "sea" : "air", String(id)); }, hidePath: function () { pathHide(); } };
  start(0);
})();
