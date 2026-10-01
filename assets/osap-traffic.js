/* AXIOM OSAP · Live traffic: all aircraft (ADS-B) and ships (AIS) as Map overlays switches on every tab.
   Aircraft: the cells on screen from the live-air branch (tools/refresh_air.mjs, .github/workflows/refresh-air.yml), swept from
   the free, keyless aggregators adsb.fi and adsb.lol, plus OpenSky Network's anonymous world snapshot. None of them lets another site read it, so the page cannot ask them itself; positions
   are a few minutes old (each pop-up gives the age). Ships: asked straight from Open Waters AIS (ais.openwaters.io/v1/vessels,
   no key, CORS open), which re-serves AISHub, Kystverket, Fintraffic and volunteer receivers, each with its own credit.
   Every item is a position the aircraft or ship itself broadcast, passed on as reported: not verified, not an identification,
   and not everything out there (transponders can be off, and areas without receivers show nothing). Read-only: it never adds
   a record. Off by default; nothing is fetched until a switch is on, and nothing refreshes while the page is hidden. */
(function () {
  "use strict";
  var W = window, D = document;
  var AIR = "https://raw.githubusercontent.com/01shane89-jpg/AXIOM-APSAP/live-air/";
  var SEA = "https://ais.openwaters.io/v1/vessels";
  var EVERY = 60e3, AIR_STALE = 20 * 60e3, SEA_STALE = 6 * 3600e3, MAX_CELLS = 40, SEA_BOX = 10, MAX_BOXES = 8, LSK = "osap-traffic";
  var KINDS = [
    ["cargo", "Cargo", "#2e7d32"], ["tanker", "Tankers", "#c62828"], ["pass", "Passenger and ferries", "#1565c0"],
    ["gov", "Military and law enforcement", "#4a148c"], ["fish", "Fishing", "#ef6c00"], ["service", "Tugs, pilots, rescue, other service", "#00838f"],
    ["fast", "High-speed craft", "#f9a825"], ["leisure", "Sailing and pleasure craft", "#ad1457"], ["other", "Other or not stated", "#757575"]];
  var KC = {}; KINDS.forEach(function (k) { KC[k[0]] = k[2]; });
  var S = lsGet() || {};
  S.air = !!S.air; S.ground = !!S.ground; S.sea = !!S.sea; S.k = S.k || {};
  KINDS.forEach(function (k) { if (S.k[k[0]] == null) S.k[k[0]] = true; });
  var map = null, ren = null, gAir = null, gSea = null, timer = null, mvT = null;
  var A = { idx: null, cells: {}, err: "", busy: false, note: "", shown: 0 };
  var V = { list: {}, err: "", busy: false, note: "", shown: 0, trunc: false, attr: {}, at: 0 };

  function lsGet() { try { return JSON.parse(localStorage.getItem(LSK) || "null"); } catch (e) { return null; } }
  function lsSet() { try { localStorage.setItem(LSK, JSON.stringify(S)); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function zt(ms) { return W.OSAP_TIME && W.OSAP_TIME.dualT ? W.OSAP_TIME.dualT(ms, { date: true }) : new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z"; }
  function ago(ms) { var m = Math.max(0, Math.round((Date.now() - ms) / 60e3)); return m < 1 ? "under a minute ago" : m < 90 ? m + " min ago" : m < 2880 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " days ago"; }
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

  /* ---------- aircraft ---------- */
  var EMERG = { "7500": "7500 (unlawful interference)", "7600": "7600 (radio failure)", "7700": "7700 (emergency)" };
  function acObj(x, f) { var o = {}; for (var i = 0; i < f.length; i++) o[f[i]] = x[i]; return o; }
  function acColour(a) { return EMERG[a.sqk] ? "#d50000" : a.fl & 4 ? "#9e9e9e" : a.fl & 1 ? "#33691e" : "#0277bd"; }
  function acPop(a) {
    var s = (A.idx && A.idx.sources[a.src]) || {}, track = safeUrl(String(s.track || "").replace("{hex}", encodeURIComponent(a.hex)));
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
        " (" + esc(s.licence || "") + (s.nc ? ", non-commercial source" : "") + ")</p>" +
      '<p class="obs" style="font-size:10.5px">A position the aircraft broadcast, relayed by volunteer receivers and collected by OSAP every few minutes. Reported, not verified, and not an identification. Record fingerprint <span class="trfp" data-fp="' +
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
  function airDraw() {
    if (!gAir) return;
    gAir.clearLayers(); A.shown = 0;
    if (S.air && A.idx && A.note !== "zoom") {
      var b = map.getBounds().pad(0.15), f = A.idx.f, now = Date.now();
      cellsInView().forEach(function (k) {
        var c = A.cells[k]; if (!c || !A.idx.cells[k]) return;
        c.ac.forEach(function (x) {
          var a = acObj(x, f);
          if (a.lat == null || a.lon == null || !b.contains([a.lat, a.lon])) return;
          if ((a.fl & 4) && !S.ground) return;
          if (now - a.pos * 1000 > AIR_STALE) return;
          var col = acColour(a), m = new Glyph([a.lat, a.lon], { renderer: ren, pane: "trafairpane", radius: EMERG[a.sqk] ? 8 : 5.5, hdg: a.fl & 4 ? null : a.trk,
            shape: "air", color: "#fff", weight: 1, fillColor: col, fillOpacity: 0.95 });
          m.bindPopup(function () { return acPop(a); }, { maxWidth: 330 });
          m.bindTooltip(function () { return acTip(a); }, { direction: "top", offset: [0, -6] });
          gAir.addLayer(m); A.shown++;
        });
      });
    }
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
  var NAV = ["under way using engine", "at anchor", "not under command", "restricted manoeuvrability", "constrained by draught", "moored", "aground",
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
        (size ? "Size " + esc(size) + (p.draught ? " · draught " + esc(p.draught) + " m" : "") + "<br>" : "") +
        (nav ? "Status " + esc(nav) + "<br>" : "") +
        (p.sog != null ? "Speed " + esc(p.sog) + " kn" : "") + (p.cog != null ? " · course " + esc(Math.round(p.cog)) + "°" : "") + (p.heading != null && p.heading < 360 ? " · heading " + esc(p.heading) + "°" : "") + "<br>" +
        (!priv && p.destination ? "Destination (as entered by the crew) " + esc(p.destination) + (p.eta ? " · ETA " + esc(p.eta) : "") + "<br>" : "") +
        "Position " + where(v.lat, v.lon) + "<br>" +
        "Last heard " + (isFinite(seen) ? esc(zt(seen)) + " (" + esc(ago(seen)) + ")" : "time not given") + "</p>" +
      (priv ? '<p class="obs" style="margin:4px 0">Name and call sign of small private craft are not shown.</p>' : "") +
      '<p class="obs" style="margin:4px 0">Source: <a href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">Open Waters AIS vessel page</a> · ' + esc(attr) + "</p>" +
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
    gSea.clearLayers(); V.shown = 0;
    if (S.sea && V.note !== "zoom") {
      var b = map.getBounds().pad(0.15), now = Date.now();
      Object.keys(V.list).forEach(function (id) {
        var v = V.list[id], p = v.p, k = kindOf(p.type), seen = Date.parse(p.seen);
        if (!S.k[k] || !b.contains([v.lat, v.lon])) return;
        if (isFinite(seen) && now - seen > SEA_STALE) return;
        var moving = p.sog != null && p.sog >= 0.5, hdg = moving ? (p.heading != null && p.heading < 360 ? p.heading : p.cog) : null;
        var m = new Glyph([v.lat, v.lon], { renderer: ren, pane: "trafseapane", radius: moving ? 5 : 3.5, hdg: hdg, shape: "ship",
          color: "#fff", weight: 1, fillColor: KC[k], fillOpacity: 0.9 });
        m.bindPopup(function () { return shPop(v); }, { maxWidth: 330 });
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
      '<p class="mlkey" style="margin:2px 0">Pointed to the heading. ' + (A.idx ? "Swept " + esc(zt(Date.parse(A.idx.built))) : "Loading") + ".</p>" : "");
    W.OSAP_LEGEND.set("traffic-sea", S.sea ? "<h3>Ships (AIS)</h3>" +
      KINDS.filter(function (k) { return S.k[k[0]]; }).map(function (k) { return '<p class="mlkey" style="margin:2px 0"><span style="background:' + k[2] + '"></span>' + esc(k[1]) + "</p>"; }).join("") +
      '<p class="mlkey" style="margin:2px 0">Pointed to the heading when moving; small dot when stopped.</p>' : "");
  }
  function airStatus() {
    if (!S.air) return "Off. Switch on to load.";
    if (A.err && !A.idx) return "Could not load the live air traffic files (" + esc(A.err) + ").";
    if (!A.idx) return "Loading…";
    var b = Date.parse(A.idx.built), old = Date.now() - b > AIR_STALE;
    return (old ? '<b style="color:#c62828">Stale:</b> ' : "") + "Swept " + esc(zt(b)) + " (" + esc(ago(b)) + "), " + A.idx.total.toLocaleString() + " aircraft worldwide. " +
      (A.note === "zoom" ? "<b>Zoom in to see them</b> (too much of the world on screen)." : A.shown.toLocaleString() + " on screen" + (S.ground ? "" : " in the air") + ".") +
      (A.err ? " Last update failed (" + esc(A.err) + "); showing the previous one." : "");
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
  function panel() {
    var a = D.getElementById("tra-st"), s = D.getElementById("trs-st");
    if (a) a.innerHTML = airStatus();
    if (s) s.innerHTML = seaStatus();
  }
  function mount() {
    var air = D.getElementById("ml-air");
    if (!air) return false;
    if (!D.getElementById("ml-trair")) {
      var d = D.createElement("div"); d.id = "ml-trair";
      d.innerHTML = '<label class="mlrow"><input type="checkbox" data-trf="air"' + (S.air ? " checked" : "") + '><span><b>All air traffic</b><i>Every aircraft broadcasting ADS-B, from adsb.fi, adsb.lol and OpenSky. OSAP sweeps the world about every five minutes; positions are typically 5 to 15 minutes old, each pop-up gives its age</i></span></label>' +
        '<label class="mlrow trsub"><input type="checkbox" data-trf="ground"' + (S.ground ? " checked" : "") + '><span><b>Include aircraft on the ground</b></span></label>' +
        '<p class="mlkey" id="tra-st"></p>';
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
        '<p class="mlkey" id="trs-st"></p>' +
        '<p class="mlkey">Only ships with AIS switched on appear, and only where a receiver hears them: coastal coverage is good, open ocean thin (no satellite AIS in the free feed). Military ships often transmit nothing. Positions and names are as broadcast, not verified.</p>';
      air.parentNode.insertBefore(s, air.nextSibling);
    }
    return true;
  }
  function run() {
    var any = S.air || S.sea;
    if (S.air) { if (!map.hasLayer(gAir)) gAir.addTo(map); if (!A.idx) airLoad(); else airCells(); }
    else if (map.hasLayer(gAir)) map.removeLayer(gAir);
    if (S.sea) { if (!map.hasLayer(gSea)) gSea.addTo(map); seaLoad(); }
    else if (map.hasLayer(gSea)) map.removeLayer(gSea);
    if (any && !timer) timer = setInterval(function () { if (D.hidden) return; if (S.air) airLoad(); if (S.sea) seaLoad(); }, EVERY);
    if (!any && timer) { clearInterval(timer); timer = null; }
    airDraw(); seaDraw();
  }
  function start(n) {
    map = W.__asapMap;
    if (!map || !W.L || !mount()) { if (n < 80) setTimeout(function () { start(n + 1); }, 250); return; }
    var css = D.createElement("style");
    css.textContent = "#ml-trair .trsub{padding-left:22px}#ml-sea .trkinds{display:grid;grid-template-columns:1fr 1fr;gap:2px 8px;margin:2px 0 4px 22px;font-size:12px}" +
      "#ml-sea .trkinds label{display:flex;gap:5px;align-items:center;cursor:pointer}#ml-sea .trsw{display:inline-block;width:10px;height:10px;border-radius:2px;flex:none}" +
      "@media (max-width:420px){#ml-sea .trkinds{grid-template-columns:1fr}}";
    D.head.appendChild(css);
    ["trafseapane", "trafairpane"].forEach(function (p, i) { if (!map.getPane(p)) { map.createPane(p); map.getPane(p).style.zIndex = 660 + i; } });
    ren = L.canvas({ padding: 0.2, tolerance: 4 });
    gAir = L.layerGroup(); gSea = L.layerGroup();
    D.addEventListener("change", function (e) {
      var t = e.target, k = t.dataset && t.dataset.trf, kk = t.dataset && t.dataset.trk;
      if (k) { S[k] = t.checked; lsSet(); run(); }
      else if (kk) { S.k[kk] = t.checked; lsSet(); seaDraw(); }
    });
    map.on("moveend", function () {
      if (!(S.air || S.sea)) return;
      clearTimeout(mvT);
      mvT = setTimeout(function () { if (S.air) airCells(); if (S.sea) seaLoad(); }, 500);
    });
    // the pop-up may have been copied into the Details panel (phones) by now: fill every copy still waiting
    map.on("popupopen", function () {
      Array.prototype.forEach.call(D.querySelectorAll(".trfp[data-fp]"), function (f) {
        var v = f.getAttribute("data-fp"); f.removeAttribute("data-fp");
        sha256(v).then(function (h) { f.textContent = h ? h.slice(0, 16) + "…" : "not available"; });
      });
    });
    D.addEventListener("visibilitychange", function () { if (D.hidden) return; if (S.air) airLoad(); if (S.sea) seaLoad(); });
    if (S.air || S.sea) run(); else panel();
  }
  W.OSAP_TRAFFIC = { air: function () { return A; }, sea: function () { return V; }, layers: function () { return { air: gAir, sea: gSea }; }, kindOf: kindOf, boxes: function () { return map && seaBoxes(); },
    reload: function () { airLoad(); seaLoad(); } };
  start(0);
})();
