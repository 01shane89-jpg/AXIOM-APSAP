/* AXIOM OSAP: embassies and evacuation points. Its own section in Map overlays, after Infrastructure (#ml-evac).
   Self-contained block loaded after the main page script. It is not a data set: it never filters reports.
   - On the map: U.S. embassies and consulates (published address, institutional phone and after-hours numbers, website),
     airports, seaports and official border crossings, for this country and its neighbours. Every item comes from the country's
     reference data (data/sof/<cc>.js, built by tools/build_evac.mjs from the researched list, OpenStreetMap and each post's own
     website), and its popup links to its source.
   - Nearest to a point: from the device's position (only when asked; never stored), the map centre, a tap on the map, or a typed
     grid (MGRS) or lat/lon, the closest posts, airports, seaports and crossings with straight-line distance and bearing, each
     with "Route" (opens the Route tab from the point to it).
   Reference data, not verified: posts move, numbers change, crossings close. Distances are straight lines, not travel distance.
   Nothing here changes a record. window.OSAP_EVAC { set, nearest, from, state }. */
(function () {
  "use strict";
  if (/[?&](watchscan|wopen)=/.test(location.search)) return;
  var D = document, W = window;
  var KINDS = [
    { k: "posts", sym: "govt", one: "U.S. post", name: "U.S. embassies and consulates", note: "Address, phone and after-hours numbers as published" },
    { k: "airports", sym: "airport", one: "Airport", name: "Airports", note: "Main airports with the longest runway (OurAirports)" },
    { k: "seaports", sym: "seaport", one: "Seaport", name: "Seaports", note: "Main commercial ports (UN/LOCODE)" },
    { k: "crossings", sym: "crossing", one: "Border crossing", name: "Border crossings", note: "Official crossings mapped in OpenStreetMap" }
  ];
  var NEAR_N = 3, NEIGH_PAD = 1.5;
  var S = { on: {}, from: null, fromHow: "", near: null, msg: "", tap: false, loaded: {} };
  var map = null, ptL = null, nearL = null, sec = null;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function tel(p) { return String(p || "").replace(/\(0\)/g, "").replace(/[^0-9+]/g, ""); }
  function cc() { return (W.TSAP && W.TSAP.country) || (location.hash.replace(/^#/, "").split("/")[0]) || ""; }
  function G() { return W.OSAP_GEO; }
  function anyOn() { return KINDS.some(function (x) { return S.on[x.k]; }); }

  /* ---------- reference data: this country and the neighbours whose box lies near it ---------- */
  function sofOf(c) { return (W.ASAP_SOF || {})[c] || null; }
  function loadSof(c) {
    if (sofOf(c)) return Promise.resolve(sofOf(c));
    if (S.loaded[c]) return S.loaded[c];
    var F = W.OSAP_COUNTRY_FILES; if (F && F.sof && F.sof.indexOf(c) < 0) return Promise.resolve(null);
    S.loaded[c] = new Promise(function (res) {
      var s = D.createElement("script"), t = setTimeout(function () { res(sofOf(c)); }, 12000);
      s.src = "data/sof/" + c + ".js"; s.async = true;
      s.onload = function () { clearTimeout(t); res(sofOf(c)); }; s.onerror = function () { clearTimeout(t); res(null); };
      D.head.appendChild(s);
    });
    return S.loaded[c];
  }
  function boundsOf(c) { var x = (W.OSAP_COUNTRIES || []).filter(function (y) { return y.id === c; })[0]; return x && x.bounds; }
  /* country ids whose bounding box comes within pad degrees of box b */
  function around(b, pad) {
    if (!b) return [];
    return (W.OSAP_COUNTRIES || []).filter(function (y) {
      var o = y.bounds; if (!o || !/^[a-z]{2,3}$/.test(y.id)) return false;
      return o[0][0] <= b[1][0] + pad && o[1][0] >= b[0][0] - pad && o[0][1] <= b[1][1] + pad && o[1][1] >= b[0][1] - pad;
    }).map(function (y) { return y.id; });
  }
  function ptBox(p, pad) { return [[p[0] - pad, p[1] - pad], [p[0] + pad, p[1] + pad]]; }
  function items(ccs) {
    var out = [];
    ccs.forEach(function (c) {
      var s = sofOf(c); if (!s) return;
      KINDS.forEach(function (K) {
        (s[K.k] || []).forEach(function (i) { if (i.lat != null && i.lon != null) out.push({ k: K.k, cc: c, i: i }); });
      });
    });
    var seen = {};
    return out.filter(function (x) { var id = x.i.id || x.k + x.i.lat + x.i.lon; if (seen[id]) return false; seen[id] = 1; return true; });
  }

  /* ---------- popups ---------- */
  function row(l, v) { return v == null || v === "" ? "" : "<dt>" + esc(l) + "</dt><dd>" + v + "</dd>"; }
  function phoneHtml(p) { return p ? '<a href="tel:' + esc(tel(p)) + '">' + esc(p) + "</a>" : ""; }
  function cname(c) { var x = (W.OSAP_COUNTRIES || []).filter(function (y) { return y.id === c; })[0]; return x ? x.name : c.toUpperCase(); }
  function facts(x) {
    var i = x.i, k = x.k;
    if (k === "posts") {
      return row("Type", esc((i.kind || "").replace(/_/g, " "))) + row("City", esc(i.city)) + row("Address", esc(i.address)) +
        row("Phone", phoneHtml(i.phone)) + row("After hours", phoneHtml(i.phone_after_hours)) +
        row("Website", safeUrl(i.web) ? '<a href="' + esc(i.web) + '" target="_blank" rel="noopener">' + esc(i.web.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")) + "</a>" : "") +
        row("Services", esc(i.services_note)) +
        (i.phone || i.phone_after_hours ? "" : row("Phone", '<span class="obs">Not published in the sources read; see the website</span>'));
    }
    if (k === "airports") {
      var rw = i.longest_runway || {};
      return row("ICAO / IATA", esc([i.icao, i.iata].filter(Boolean).join(" / "))) + row("Type", esc((i.type || "").replace(/_/g, " "))) +
        row("Longest runway", rw.ident ? esc(rw.ident + ", " + (rw.length_m || "?") + " m (" + (rw.length_ft || "?") + " ft)") : "") +
        row("Scheduled service", i.scheduled_service == null ? "" : i.scheduled_service ? "yes" : "no") + row("Town", esc(i.municipality));
    }
    if (k === "seaports") return row("UN/LOCODE", esc(i.unlocode)) + row("Note", esc(i.coord_flag));
    return row("Local name", esc(i.local_name)) + row("Open", esc(i.hours)) + row("For", esc((i.modes || []).join(", "))) + row("Access", esc(i.access_note)) + row("Run by", esc(i.operator));
  }
  function pop(x) {
    var i = x.i, K = KINDS.filter(function (y) { return y.k === x.k; })[0], g = G();
    var phoneNote = x.k === "posts" && i.phone_src ? '<br>Phone: <a href="' + esc(safeUrl(i.phone_src)) + '" target="_blank" rel="noopener">' + esc(i.phone_srcname || "source") + "</a>" + (i.phone_asof ? " (read " + esc(i.phone_asof) + ")" : "") : "";
    return '<div class="pop evpop"><div class="tier">' + esc(K.one) + " · " + esc(cname(x.cc)) + " · reference</div><h3>" + esc(i.name) + "</h3><dl>" + facts(x) + "</dl>" +
      '<p class="obs" style="margin-top:6px">Source: ' + (safeUrl(i.src) ? '<a href="' + esc(i.src) + '" target="_blank" rel="noopener">' + esc(i.srcname || i.src) + "</a>" : esc(i.srcname || "")) + phoneNote +
      "<br>" + esc(i.lat.toFixed(5) + ", " + i.lon.toFixed(5)) + (g ? " · MGRS " + esc(g.mgrs(i.lat, i.lon, 5)) : "") + (i.prec === "approx" ? " (approximate)" : "") +
      (i.fp ? '<br>Fingerprint <code class="fp">' + esc(i.fp.slice(0, 16)) + "…</code>" : "") + "</p>" +
      '<p class="evbtns"><button type="button" class="refresh" data-ev-from="' + esc(i.lat + "," + i.lon) + '">Nearest from here</button></p></div>';
  }
  function icon(k) {
    var K = KINDS.filter(function (y) { return y.k === k; })[0];
    var ic = W.OSAP_SYM && W.OSAP_SYM.d[K.sym] ? W.OSAP_SYM.icon(K.sym) : null;
    return ic || L.divIcon({ className: "sofpin", iconSize: [20, 20], iconAnchor: [10, 10], html: '<span style="background:#1c7ed6">' + K.one[0] + "</span>" });
  }

  /* ---------- map layer ---------- */
  var drawTok = 0;
  function draw() {
    if (!map || !ptL) return;
    var tok = ++drawTok;
    ptL.clearLayers();
    if (!anyOn()) return paint();
    var c = cc(), ids = [c].concat(around(boundsOf(c), NEIGH_PAD).filter(function (x) { return x !== c; }));
    Promise.all(ids.map(loadSof)).then(function () {
      if (tok !== drawTok) return;
      ptL.clearLayers();
      /* crossings run to thousands across a region: only those in and around the view, redrawn as the map moves */
      var vb = map.getBounds().pad(0.5);
      items(ids).forEach(function (x) {
        if (!S.on[x.k]) return;
        if (x.k === "crossings" && !vb.contains([x.i.lat, x.i.lon])) return;
        var m = L.marker([x.i.lat, x.i.lon], { icon: icon(x.k), keyboard: false, pane: "evpane", lgk: "ev:" + x.k, lgl: KINDS.filter(function (y) { return y.k === x.k; })[0].name });
        m.bindPopup(function () { return pop(x); }, { maxWidth: 330 }); m._ev = x.i.id;
        ptL.addLayer(m);
      });
      paint();
    });
  }
  function set(k, on) {
    if (!KINDS.some(function (y) { return y.k === k; })) return;
    S.on[k] = !!on;
    var cb = sec && sec.querySelector('input[data-evac="' + k + '"]'); if (cb) cb.checked = !!on;
    draw();
  }

  /* ---------- nearest to a point ---------- */
  function setFrom(p, how) {
    if (!p || !isFinite(p[0]) || !isFinite(p[1])) { S.msg = "That position could not be read. Type a grid (MGRS) or lat, lon."; paint(); return Promise.resolve(null); }
    S.from = [+p[0], +p[1]]; S.fromHow = how || ""; S.msg = "Finding the nearest points…"; S.near = null; paint();
    return nearest(S.from).then(function (r) { S.near = r; S.msg = ""; drawNear(); paint(); return r; });
  }
  /* the closest NEAR_N of each kind among this country, the countries near the point and their neighbours */
  function nearest(p) {
    var c = cc(), ids = [c].concat(around(ptBox(p, 0.1), 0).filter(function (x) { return x !== c; }));
    ids = ids.concat(around(ptBox(p, 0.1), 3).filter(function (x) { return ids.indexOf(x) < 0; })).slice(0, 14);
    return Promise.all(ids.map(loadSof)).then(function () {
      var g = G(), all = items(ids), out = {};
      KINDS.forEach(function (K) {
        out[K.k] = all.filter(function (x) { return x.k === K.k; }).map(function (x) {
          var inv = g ? g.inverse(p, [x.i.lat, x.i.lon]) : null;
          return { x: x, m: inv && isFinite(inv.m) ? inv.m : dist(p, [x.i.lat, x.i.lon]), brg: inv && isFinite(inv.b1) ? inv.b1 : null };
        }).sort(function (a, b) { return a.m - b.m; }).slice(0, NEAR_N);
      });
      return out;
    });
  }
  function dist(a, b) {
    var p1 = a[0] * Math.PI / 180, p2 = b[0] * Math.PI / 180, dp = p2 - p1, dl = (b[1] - a[1]) * Math.PI / 180;
    var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function drawNear() {
    if (!nearL) return;
    nearL.clearLayers();
    if (!S.from) return;
    L.circleMarker(S.from, { pane: "evpane", radius: 7, color: "#fff", weight: 2, fillColor: "#d6336c", fillOpacity: 1 }).bindTooltip("From here").addTo(nearL);
    if (!S.near) return;
    KINDS.forEach(function (K) {
      var r = S.near[K.k] && S.near[K.k][0]; if (!r) return;
      L.polyline([S.from, [r.x.i.lat, r.x.i.lon]], { pane: "evpane", color: "#d6336c", weight: 1.6, dashArray: "5 6", opacity: 0.85, interactive: false }).addTo(nearL);
      L.marker([r.x.i.lat, r.x.i.lon], { icon: icon(K.k), pane: "evpane", keyboard: false }).bindPopup(function () { return pop(r.x); }, { maxWidth: 330 }).addTo(nearL);
    });
  }
  function fmtM(m) { var g = G(); return g ? g.fmtDist(m, "km") : (m / 1000).toFixed(1) + " km"; }
  function nearHtml() {
    if (!S.near) return "";
    var g = G();
    return KINDS.map(function (K) {
      var l = S.near[K.k] || [];
      return '<div class="evk"><b>' + esc(K.name) + "</b>" + (l.length ? '<ol class="evl">' + l.map(function (r, n) {
        var i = r.x.i;
        return "<li><span class=\"evn\">" + esc(i.name) + (r.x.cc !== cc() ? ' <span class="obs">(' + esc(cname(r.x.cc)) + ")</span>" : "") + "</span>" +
          '<span class="obs">' + esc(fmtM(r.m)) + (r.brg != null && g ? " · " + esc(g.fmtBrg(r.brg)) + " true" : "") +
          (K.k === "posts" && i.phone ? ' · <a href="tel:' + esc(tel(i.phone)) + '">' + esc(i.phone) + "</a>" : "") + "</span>" +
          '<span class="evbtns"><button type="button" class="refresh" data-ev-show="' + esc(K.k + ":" + n) + '">Show</button>' +
          (W.OSAP_ROUTE_SEED ? '<button type="button" class="refresh" data-ev-route="' + esc(K.k + ":" + n) + '">Route</button>' : "") + "</span></li>";
      }).join("") + "</ol>" : '<p class="obs">None in the reference data near this point.</p>') + "</div>";
    }).join("") + '<p class="obs">Straight-line distance and true bearing from ' + esc(S.fromHow || "the point") + " (" + esc(g ? g.mgrs(S.from[0], S.from[1], 5) : S.from.join(", ")) + "). Reference data, not verified: check the post's own site and the crossing's status before moving.</p>";
  }

  /* ---------- the Map overlays section ---------- */
  function secHtml() {
    return '<div class="mlh">Embassies and evacuation</div>' +
      KINDS.map(function (K) {
        return '<label class="mlrow"><input type="checkbox" data-evac="' + K.k + '"' + (S.on[K.k] ? " checked" : "") + '><span><b>' + esc(K.name) + "</b><i>" + esc(K.note) + "</i></span></label>";
      }).join("") +
      '<div class="evnear"><div class="evt">Nearest to a point</div>' +
      '<div class="evrow"><button type="button" class="refresh" data-ev="me">My location</button><button type="button" class="refresh" data-ev="centre">Map centre</button>' +
      '<button type="button" class="refresh" data-ev="tap" aria-pressed="false">Tap the map</button></div>' +
      '<form class="evrow" data-ev-form><input type="text" data-ev-grid placeholder="Grid (MGRS) or lat, lon" aria-label="Grid or lat, lon" autocomplete="off" spellcheck="false"><button type="submit" class="refresh">Go</button></form>' +
      '<p class="evm obs" data-ev-msg hidden></p><div data-ev-near></div>' +
      (S.from ? '<p class="evrow"><button type="button" class="refresh" data-ev="clear">Clear point</button></p>' : "") + "</div>";
  }
  function paint() {
    if (!sec) return;
    var m = sec.querySelector("[data-ev-msg]"); if (m) { m.textContent = S.msg; m.hidden = !S.msg; }
    var n = sec.querySelector("[data-ev-near]"); if (n) n.innerHTML = nearHtml();
    var t = sec.querySelector('[data-ev="tap"]'); if (t) { t.setAttribute("aria-pressed", String(S.tap)); t.textContent = S.tap ? "Tap a point on the map…" : "Tap the map"; }
    var cl = sec.querySelector('[data-ev="clear"]');
    if (S.from && !cl) { var p = D.createElement("p"); p.className = "evrow"; p.innerHTML = '<button type="button" class="refresh" data-ev="clear">Clear point</button>'; sec.querySelector(".evnear").appendChild(p); }
    if (!S.from && cl) cl.parentNode.remove();
  }
  function pick(kn) { var a = kn.split(":"), l = S.near && S.near[a[0]]; return l && l[+a[1]]; }
  function onClick(e) {
    var b = e.target.closest && e.target.closest("button"); if (!b) return;
    var a = b.getAttribute("data-ev"), sh = b.getAttribute("data-ev-show"), rt = b.getAttribute("data-ev-route");
    if (a === "me") {
      var h = W.OSAP_LOC && W.OSAP_LOC.here();
      if (h) { setFrom([h.lat, h.lon], "your location"); return; }
      if (!navigator.geolocation) { S.msg = "This browser cannot give a position. Type a grid instead."; paint(); return; }
      S.msg = "Asking the device for its position…"; paint();
      navigator.geolocation.getCurrentPosition(function (p) { setFrom([p.coords.latitude, p.coords.longitude], "your location"); },
        function (er) { S.msg = "No position: " + (er && er.code === 1 ? "permission refused." : "the device did not answer.") + " Type a grid instead."; paint(); },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
    } else if (a === "centre") { var c = map.getCenter(); setFrom([c.lat, c.lng], "the map centre"); }
    else if (a === "tap") { S.tap = !S.tap; map.getContainer().style.cursor = S.tap ? "crosshair" : ""; paint(); }
    else if (a === "clear") { S.from = null; S.near = null; S.msg = ""; drawNear(); paint(); }
    else if (sh) { var r = pick(sh); if (r) { map.setView([r.x.i.lat, r.x.i.lon], Math.max(map.getZoom(), 12)); L.popup({ maxWidth: 330 }).setLatLng([r.x.i.lat, r.x.i.lon]).setContent(pop(r.x)).openOn(map); } }
    else if (rt) { var q = pick(rt); if (q && W.OSAP_ROUTE_SEED) W.OSAP_ROUTE_SEED([S.from.slice(), [q.x.i.lat, q.x.i.lon]]); }
  }
  function onSubmit(e) {
    e.preventDefault();
    var v = sec.querySelector("[data-ev-grid]").value, g = G(), p = g && g.parse(v);
    if (!p) { S.msg = "That position could not be read. Type a grid (MGRS, e.g. 47P PR 66 01) or lat, lon."; paint(); return; }
    setFrom([p.lat, p.lon], p.how === "MGRS" ? "the grid" : "the typed position");
  }
  var css = D.createElement("style");
  css.textContent =
    "#ml-evac{margin:2px 0 6px}#ml-evac .evnear{margin:6px 0 2px;padding-top:4px;border-top:1px solid var(--line-soft,rgba(128,128,128,.2))}" +
    "#ml-evac .evt{font-weight:600;font-size:13px;margin:4px 0}#ml-evac .evrow{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0}" +
    "#ml-evac input[data-ev-grid]{flex:1;min-width:0;font:inherit;font-size:13px;padding:5px 7px;border:1px solid var(--line,#999);border-radius:6px;background:var(--bg,#fff);color:inherit}" +
    "#ml-evac .evm[hidden]{display:none}#ml-evac .evk{margin:6px 0}#ml-evac .evl{margin:2px 0;padding-left:18px}" +
    "#ml-evac .evl li{margin:3px 0;font-size:12.5px}#ml-evac .evn{display:block}#ml-evac .evl .obs{display:block;font-size:11.5px}" +
    ".evbtns{display:flex;gap:6px;margin-top:3px}.evpop dl{margin:4px 0}";
  D.head.appendChild(css);

  /* the home is its own block after Map overlays > Infrastructure (layout owner, 2026-10-01); older pages have only #ml-extra */
  function mount() {
    var infra = D.getElementById("ml-infra"), extra = D.getElementById("ml-extra");
    if (!infra && !extra) return false;
    if (!sec) {
      sec = D.createElement("div"); sec.id = "ml-evac"; sec.innerHTML = secHtml();
      sec.addEventListener("change", function (e) { var k = e.target && e.target.getAttribute("data-evac"); if (k) set(k, e.target.checked); });
      sec.addEventListener("click", onClick);
      sec.querySelector("[data-ev-form]").addEventListener("submit", onSubmit);
    }
    if (infra) { if (sec.previousElementSibling !== infra || sec.parentNode !== infra.parentNode) infra.parentNode.insertBefore(sec, infra.nextSibling); }
    else if (sec.parentNode !== extra) extra.appendChild(sec);
    paint();
    return true;
  }
  function init() {
    map = W.__asapMap;
    if (!map || !W.L || !mount()) return false;
    if (!map.getPane("evpane")) { var p = map.createPane("evpane"); p.style.zIndex = 640; }
    ptL = L.layerGroup().addTo(map); nearL = L.layerGroup().addTo(map);
    map.on("moveend", function () { if (S.on.crossings) draw(); });
    map.on("click", function (e) { if (!S.tap) return; S.tap = false; map.getContainer().style.cursor = ""; setFrom([e.latlng.lat, e.latlng.lng], "the tapped point"); });
    map.on("popupopen", function (e) {
      var el = e.popup.getElement(), b = el && el.querySelector("[data-ev-from]"); if (!b) return;
      b.addEventListener("click", function () { var a = b.getAttribute("data-ev-from").split(","); map.closePopup(); setFrom([+a[0], +a[1]], "the chosen point"); });
    });
    D.addEventListener("osap:dsopen", function () { setTimeout(mount, 0); });
    return true;
  }
  W.OSAP_EVAC = {
    set: set, nearest: nearest, from: setFrom, items: items,
    state: function () {
      return { on: Object.assign({}, S.on), from: S.from, msg: S.msg, drawn: ptL ? ptL.getLayers().length : 0,
        near: S.near ? Object.keys(S.near).reduce(function (o, k) { o[k] = S.near[k].map(function (r) { return { id: r.x.i.id, m: Math.round(r.m) }; }); return o; }, {}) : null };
    }
  };
  (function wait(n) { if (!init() && n < 80) setTimeout(function () { wait(n + 1); }, 250); })(0);
})();
