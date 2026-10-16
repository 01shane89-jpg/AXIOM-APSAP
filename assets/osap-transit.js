/* AXIOM OSAP · Live public transport: buses, trams, metro, trains and ferries as a Map overlays switch on every tab.
   Vehicles come from the transit agencies' own GTFS-Realtime vehicle position feeds, only those published with no key or
   account (found in the Mobility Database catalog by tools/build_transit_feeds.mjs). Most agencies do not let another site
   read their feed, so .github/workflows/refresh-transit.yml asks them every few minutes (tools/refresh_transit.mjs) and
   publishes one file per 5° map cell on the live-transit branch, which this reads from raw.githubusercontent.com.
   Each item is a position the vehicle reported to its agency, passed on as published: not verified, and only where an
   agency publishes openly (many cities publish nothing, or only behind a key). Read-only: it never adds a record.
   Off by default; nothing is fetched until the switch is on, and nothing refreshes while the page is hidden. */
(function () {
  "use strict";
  var W = window, D = document;
  var BASE = "https://raw.githubusercontent.com/01shane89-jpg/AXIOM-APSAP/live-transit/";
  var EVERY = 90e3, STALE = 30 * 60e3, MAX_CELLS = 24, LSK = "osap-transit";
  var KINDS = [["b", "Buses", "#1565c0"], ["t", "Trams and light rail", "#2e7d32"], ["m", "Metro", "#6a1b9a"], ["r", "Trains", "#c62828"],
    ["f", "Ferries", "#00838f"], ["o", "Other or not stated", "#616161"]];
  var KC = {}, KN = {}; KINDS.forEach(function (k) { KC[k[0]] = k[2]; KN[k[0]] = k[1]; });
  var ONE = { b: "Bus", t: "Tram or light rail", m: "Metro train", r: "Train", f: "Ferry", o: "Public transport vehicle" };
  var STATUS = ["arriving at stop", "stopped at stop", "on the way to stop"];
  var S = lsGet() || {};
  S.on = !!S.on; S.k = S.k || {};
  KINDS.forEach(function (k) { if (S.k[k[0]] == null) S.k[k[0]] = true; });
  var map = null, ren = null, grp = null, timer = null, mvT = null;
  var T = { idx: null, cells: {}, err: "", busy: false, note: "", shown: 0 };

  function lsGet() { try { return JSON.parse(localStorage.getItem(LSK) || "null"); } catch (e) { return null; } }
  function lsSet() { try { localStorage.setItem(LSK, JSON.stringify(S)); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function zt(ms) { return W.OSAP_TIME && W.OSAP_TIME.dualT ? W.OSAP_TIME.dualT(ms, { date: true }) : new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z"; }
  function ago(ms) { var m = Math.max(0, Math.round((Date.now() - ms) / 60e3)); return m < 1 ? "under a minute ago" : m < 90 ? m + " min ago" : m < 2880 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " days ago"; }
  function mgrs(lat, lon) { try { return W.MGRS_OF ? W.MGRS_OF(lat, lon) : ""; } catch (e) { return ""; } }
  function where(lat, lon) { var g = mgrs(lat, lon); return esc(lat.toFixed(5) + ", " + lon.toFixed(5)) + (g ? " · MGRS " + esc(g) : ""); }
  var DN = null; try { DN = W.Intl && Intl.DisplayNames ? new Intl.DisplayNames(["en"], { type: "region" }) : null; } catch (e) { DN = null; }
  function country(cc) { if (!cc || !/^[A-Z]{2}$/.test(cc)) return ""; try { return (DN && DN.of(cc)) || cc; } catch (e) { return cc; } }
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

  /* a canvas marker: an arrow turned to the bearing, or a dot when the feed gives none */
  var Glyph = L.CircleMarker.extend({
    _updatePath: function () {
      var r = this._renderer, o = this.options;
      if (!r || !r._ctx || o.hdg == null) return L.CircleMarker.prototype._updatePath.call(this);
      if (!r._drawing || this._empty()) return;
      var c = r._ctx, p = this._point, s = this._radius, a = (o.hdg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
      c.beginPath();
      [[0, -1.5], [1, 0.9], [0, 0.4], [-1, 0.9]].forEach(function (q, i) { var x = p.x + (q[0] * ca - q[1] * sa) * s, y = p.y + (q[0] * sa + q[1] * ca) * s; if (i) c.lineTo(x, y); else c.moveTo(x, y); });
      c.closePath();
      r._fillStroke(c, this);
    }
  });

  function obj(x, f) { var o = {}; for (var i = 0; i < f.length; i++) o[f[i]] = x[i]; return o; }
  function src(v) { return (T.idx && T.idx.sources[v.s]) || {}; }
  function title(v) { return ONE[v.k] || ONE.o; }
  function pop(v) {
    var s = src(v), cat = safeUrl(s.catalog), lic = safeUrl(s.licence_url), at = v.ts ? v.ts * 1000 : 0;
    var line = v.rt ? "Route " + esc(v.rt) + (v.rn ? " · " + esc(v.rn) : "") : v.rn ? "Route " + esc(v.rn) : v.rid ? "Route ID " + esc(v.rid) + " (no name in the agency's timetable)" : "Route not given";
    return '<div class="pop trafpop"><b>' + esc(title(v)) + (v.rt ? " " + esc(v.rt) : "") + "</b>" +
      '<p class="obs" style="margin:4px 0">' + line + "<br>" +
        (v.id ? "Vehicle " + esc(v.id) + "<br>" : "") +
        (v.st != null && STATUS[v.st] ? "Status " + esc(STATUS[v.st]) + "<br>" : "") +
        (v.spd != null ? "Speed " + esc(v.spd) + " km/h" : "") + (v.brg != null ? (v.spd != null ? " · " : "") + "heading " + esc(("00" + v.brg).slice(-3)) + "°" : "") + (v.spd != null || v.brg != null ? "<br>" : "") +
        "Position " + where(v.lat, v.lon) + "<br>" +
        "Reported " + (at ? esc(zt(at)) + " (" + esc(ago(at)) + ")" : "time not given by the feed") + "</p>" +
      '<p class="obs" style="margin:4px 0">Source: ' + esc(s.name || "") + (s.place || s.cc ? " (" + esc([s.place, country(s.cc)].filter(Boolean).join(", ")) + ")" : "") +
        " · " + (lic ? '<a href="' + esc(lic) + '" target="_blank" rel="noopener noreferrer">' + esc(s.licence || "licence") + "</a>" : esc(s.licence || "")) + (s.nc ? ", non-commercial source" : "") +
        (cat ? ' · <a href="' + esc(cat) + '" target="_blank" rel="noopener noreferrer">feed record</a>' : "") + "</p>" +
      '<p class="obs" style="font-size:10.5px">A position the vehicle reported to its transit agency, published openly and collected by OSAP every few minutes. As reported, not verified. Record fingerprint <span class="trfp" data-fp="' +
        esc([s.id, v.id, v.rid, v.lat, v.lon, v.spd, v.brg, v.ts].join("␟")) + '">computing…</span></p></div>';
  }
  function tip(v) {
    return esc(title(v)) + (v.rt ? " " + esc(v.rt) : "") + (v.spd != null ? " · " + esc(v.spd) + " km/h" : "") + (v.ts ? " · " + esc(ago(v.ts * 1000)) : "");
  }
  function cellsInView() {
    var b = map.getBounds(), s = Math.max(-90, b.getSouth()), n = Math.min(90, b.getNorth()), w = b.getWest(), e = b.getEast(), out = [];
    if (e - w >= 360) { w = -180; e = 180; }
    for (var la = Math.floor(s / 5) * 5; la < n; la += 5)
      for (var lo = Math.floor(w / 5) * 5; lo < e; lo += 5) out.push(la + "_" + (((lo + 180) % 360 + 360) % 360 - 180));
    return out;
  }
  function load() {
    if (T.busy || !S.on) return;
    T.busy = true;
    getJson(BASE + "index.json").then(function (j) {
      if (!j || j.schema !== "osap-transit/1" || !j.cells || !Array.isArray(j.f) || !Array.isArray(j.sources)) throw new Error("unexpected file");
      T.idx = j; T.err = "";
    }).catch(function (e) { T.err = String(e && e.message || e); }).then(function () { T.busy = false; cells(); });
  }
  function cells() {
    if (!S.on || !T.idx || !map) { draw(); return; }
    var all = cellsInView(), want = all.filter(function (k) { return T.idx.cells[k]; });
    if (want.length > MAX_CELLS || all.length > 6 * MAX_CELLS) { T.note = "zoom"; draw(); return; }
    T.note = "";
    var need = want.filter(function (k) { return !T.cells[k] || T.cells[k].built !== T.idx.built; });
    if (!need.length) { draw(); return; }
    Promise.all(need.map(function (k) {
      return getJson(BASE + "v/" + k + ".json").then(function (j) {
        if (j && j.schema === "osap-transit-cell/1" && Array.isArray(j.v)) T.cells[k] = { built: j.built, v: j.v };
      }).catch(function (e) { T.err = String(e && e.message || e); });
    })).then(draw);
  }
  function draw() {
    if (!grp) return;
    grp.clearLayers(); T.shown = 0;
    if (S.on && T.idx && T.note !== "zoom") {
      var b = map.getBounds().pad(0.15), f = T.idx.f, now = Date.now();
      cellsInView().forEach(function (k) {
        var c = T.cells[k]; if (!c || !T.idx.cells[k]) return;
        c.v.forEach(function (x) {
          var v = obj(x, f), k2 = KC[v.k] ? v.k : "o";
          if (typeof v.lat !== "number" || typeof v.lon !== "number" || !S.k[k2] || !b.contains([v.lat, v.lon])) return;
          if (v.ts && now - v.ts * 1000 > STALE) return;
          var m = new Glyph([v.lat, v.lon], { renderer: ren, pane: "transitpane", radius: 5, hdg: v.brg != null && v.spd !== 0 ? v.brg : null,
            color: v.col && /^[0-9A-F]{6}$/.test(v.col) ? "#" + v.col : "#fff", weight: v.col ? 2 : 1, fillColor: KC[k2], fillOpacity: 0.95 });
          m.bindPopup(function () { return pop(v); }, { maxWidth: 330 });
          m.bindTooltip(function () { return tip(v); }, { direction: "top", offset: [0, -6] });
          grp.addLayer(m); T.shown++;
        });
      });
    }
    legend(); panel();
  }

  function legend() {
    if (!W.OSAP_LEGEND) return;
    W.OSAP_LEGEND.set("transit", S.on ? "<h3>Public transport (live)</h3>" +
      KINDS.filter(function (k) { return S.k[k[0]]; }).map(function (k) { return '<p class="mlkey" style="margin:2px 0"><span style="background:' + k[2] + '"></span>' + esc(k[1]) + "</p>"; }).join("") +
      '<p class="mlkey" style="margin:2px 0">Arrow points the way it is heading; ring in the route colour where the agency gives one.</p>' : "");
  }
  function status() {
    if (!S.on) return "Off. Switch on to load.";
    if (T.err && !T.idx) return "Could not load the live public transport files (" + esc(T.err) + ").";
    if (!T.idx) return "Loading…";
    var b = Date.parse(T.idx.built), old = Date.now() - b > STALE;
    return (old ? '<b style="color:#c62828">Stale:</b> ' : "") + "Updated " + esc(zt(b)) + " (" + esc(ago(b)) + "), " + (+T.idx.total || 0).toLocaleString() +
      " vehicles from " + (+T.idx.feeds_ok || 0) + " agency feeds. " +
      (T.note === "zoom" ? "<b>Zoom in to see them</b> (too much of the world on screen)." : T.shown.toLocaleString() + " on screen.") +
      (T.err ? " Last update failed (" + esc(T.err) + "); showing the previous one." : "");
  }
  // which places are covered: one line per country, agencies in a tooltip
  function coverage() {
    if (!T.idx) return "";
    var by = {};
    T.idx.sources.forEach(function (s) { var n = (T.idx.status && T.idx.status[s.id] && T.idx.status[s.id][0]) || 0; var c = s.cc || "--"; (by[c] = by[c] || { n: 0, a: [] }).n += n; by[c].a.push(s.name + (s.place ? " (" + s.place + ")" : "")); });
    return Object.keys(by).sort(function (a, b) { return country(a).localeCompare(country(b)); }).map(function (c) {
      return '<span title="' + esc(by[c].a.join("\n")) + '">' + esc(country(c) || "Unknown") + " " + by[c].n.toLocaleString() + "</span>";
    }).join(" · ");
  }
  function panel() {
    var e = D.getElementById("trn-st"), c = D.getElementById("trn-cov");
    if (e) e.innerHTML = status();
    if (c) { var h = coverage(); c.innerHTML = h ? "<b>Where:</b> " + h : ""; c.hidden = !S.on || !h; }
  }
  function mount() {
    var anchor = D.getElementById("ml-sea") || D.getElementById("ml-air");
    if (!anchor) return false;
    if (!D.getElementById("ml-transit")) {
      var s = D.createElement("div"); s.id = "ml-transit";
      s.innerHTML = '<div class="mlh">Public transport</div>' +
        '<label class="mlrow"><input type="checkbox" data-trn="on"' + (S.on ? " checked" : "") + '><span><b>Buses, trams, trains and ferries (live)</b><i>Vehicle positions transit agencies publish openly (GTFS-Realtime, no key). OSAP collects them every few minutes; each pop-up gives its age and agency</i></span></label>' +
        '<div class="trkinds">' + KINDS.map(function (k) {
          return '<label><input type="checkbox" data-trnk="' + k[0] + '"' + (S.k[k[0]] ? " checked" : "") + '><span class="trsw" style="background:' + k[2] + '"></span>' + esc(k[1]) + "</label>";
        }).join("") + "</div>" +
        '<p class="mlkey" id="trn-st"></p><p class="mlkey" id="trn-cov" hidden></p>' +
        '<p class="mlkey">Only cities whose agency publishes live positions openly appear; many publish nothing, or only behind a key. Private vehicles are never shown: their locations are not public.</p>';
      anchor.parentNode.insertBefore(s, anchor.nextSibling);
    }
    return true;
  }
  function run() {
    if (S.on) { if (!map.hasLayer(grp)) grp.addTo(map); if (!T.idx) load(); else cells(); }
    else if (map.hasLayer(grp)) map.removeLayer(grp);
    if (S.on && !timer) timer = setInterval(function () { if (!D.hidden) load(); }, EVERY);
    if (!S.on && timer) { clearInterval(timer); timer = null; }
    draw();
  }
  function start(n) {
    map = W.__asapMap;
    if (!map || !W.L || !mount()) { if (n < 80) setTimeout(function () { start(n + 1); }, 250); return; }
    var css = D.createElement("style");
    css.textContent = "#ml-transit .trkinds{display:grid;grid-template-columns:1fr 1fr;gap:2px 8px;margin:2px 0 4px 22px;font-size:12px}" +
      "#ml-transit .trkinds label{display:flex;gap:5px;align-items:center;cursor:pointer}#ml-transit .trsw{display:inline-block;width:10px;height:10px;border-radius:2px;flex:none}" +
      "#trn-cov span{white-space:nowrap}@media (max-width:420px){#ml-transit .trkinds{grid-template-columns:1fr}}";
    D.head.appendChild(css);
    if (!map.getPane("transitpane")) { map.createPane("transitpane"); map.getPane("transitpane").style.zIndex = 659; }
    ren = L.canvas({ padding: 0.2, tolerance: 4, pane: "transitpane" });
    grp = L.layerGroup();
    D.addEventListener("change", function (e) {
      var t = e.target, k = t.dataset && t.dataset.trn, kk = t.dataset && t.dataset.trnk;
      if (k) { S.on = t.checked; lsSet(); run(); }
      else if (kk) { S.k[kk] = t.checked; lsSet(); draw(); }
    });
    map.on("moveend", function () { if (!S.on) return; clearTimeout(mvT); mvT = setTimeout(cells, 500); });
    // the pop-up may have been copied into the Details panel (phones) by now: fill every copy still waiting
    map.on("popupopen", function () {
      Array.prototype.forEach.call(D.querySelectorAll(".trfp[data-fp]"), function (f) {
        var v = f.getAttribute("data-fp"); f.removeAttribute("data-fp");
        sha256(v).then(function (h) { f.textContent = h ? h.slice(0, 16) + "…" : "not available"; });
      });
    });
    D.addEventListener("visibilitychange", function () { if (!D.hidden && S.on) load(); });
    if (S.on) run(); else panel();
  }
  W.OSAP_TRANSIT = { state: function () { return T; }, layer: function () { return grp; }, reload: load, kinds: KINDS };
  start(0);
})();
