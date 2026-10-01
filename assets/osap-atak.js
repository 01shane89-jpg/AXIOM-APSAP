/* AXIOM OSAP: ATAK-style map controls.
   - one slim icon toolbar down the right side of the map, folding away to a single button (remembered on this device);
     its buttons press the page's own controls (Layers, Measure, Draw area, Watch, My work with What's new, Layout (not on a phone),
     Full screen), which stay in the page but out of sight, so nothing about how they work changes;
   - long-press anywhere on the map (right-click with a mouse) for a radial menu at that point: Measure from here, Route from
     here, Drop a point, Save as NAI/TAI, Watch this area, Copy the grid;
   - a readout strip along the bottom of the map: the grid of the map centre (or the mouse), your own position when
     "Use my location" is on, and a lock-on-me button that keeps the map on you until you pan it away;
   - one Overlay Manager sheet holding the data sets, the page's own Layers panel, your marks and saved areas.
   The Today and news screens are untouched. "Classic controls" in the Overlay Manager puts the old buttons back.
   Dropped points are the analyst's own marks, kept in this browser only (localStorage "osap-atak-pts"), never records.
   assets/osap-points.js (when loaded) gives each point a name, a note and photos, and the Point tool adds one.
   The magnifying glass loads assets/osap-search.js (Search places) on its first press.
   Uses window.OSAP_GEO (grid maths), OSAP_MEASURE, OSAP_ROUTE_SEED, OSAP_LOC, OSAP_AOI, OSAP_WATCH and TSAP.areaApi. */
(function () {
  "use strict";
  var W = window, D = document, map = W.__asapMap, L = W.L;
  if (!map || !L || /[?&]watchscan=1/.test(location.search)) return;
  var G = function () { return W.OSAP_GEO; };
  var K_UI = "osap-ui", K_FOLD = "osap-atak-fold", K_FMT = "osap-atak-fmt", K_PTS = "osap-atak-pts", K_R = "osap-atak-r";
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function cc() { return (W.TSAP && W.TSAP.country) || ""; }
  var root = D.documentElement, mapEl = map.getContainer();
  function on() { return lsGet(K_UI) !== "classic"; }

  /* ---------- icons (24px grid, stroke) ---------- */
  function ic(d, extra) { return '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + d + (extra || "") + "</svg>"; }
  var I = {
    fold: ic('<path d="M9 6l6 6-6 6"/>'), unfold: ic('<path d="M15 6l-6 6 6 6"/>'),
    globe: ic('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.6 2.6 3.9 5.6 3.9 9s-1.3 6.4-3.9 9c-2.6-2.6-3.9-5.6-3.9-9S9.4 5.6 12 3z"/>'),
    data: ic('<ellipse cx="12" cy="5.5" rx="8" ry="2.8"/><path d="M4 5.5v6.5c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8V5.5"/><path d="M4 12v6.5c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8V12"/>'),
    home: ic('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/>'),
    cloud: ic('<path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4.25 4.25 0 0 1-.5 8.5z"/><path d="M9 21l1-2M13 21l1-2" opacity=".7"/>'),
    layers: ic('<path d="M12 3 2 8l10 5 10-5z"/><path d="M2 13l10 5 10-5"/><path d="M2 17.5l10 5 10-5" opacity=".55"/>'),
    ruler: ic('<path d="M3 16.5 16.5 3 21 7.5 7.5 21z"/><path d="M7 12.5l1.8 1.8M9.5 10l1.2 1.2M12 7.5l1.8 1.8M14.5 5l1.2 1.2"/>'),
    area: ic('<path d="M5 7l6-3 8 4-2 9-9 2-4-6z" stroke-dasharray="3 2.4"/><circle cx="5" cy="7" r="1.4" fill="currentColor"/><circle cx="19" cy="8" r="1.4" fill="currentColor"/><circle cx="8" cy="19" r="1.4" fill="currentColor"/>'),
    eye: ic('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    bell: ic('<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
    work: ic('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>'),
    layout: ic('<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M13 4v16"/><path d="M15.5 8h3M15.5 11h3M15.5 14h3"/>'),
    today: ic('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    full: ic('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
    route: ic('<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8 18h6a3.5 3.5 0 0 0 0-7h-4a3.5 3.5 0 0 1 0-7h6"/>'),
    pin: ic('<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.4"/>'),
    nai: ic('<rect x="3.5" y="5.5" width="17" height="13" rx="1" stroke-dasharray="3.2 2.2"/><path d="M8 15V9l4 6V9M15 9v6"/>'),
    copy: ic('<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>'),
    lock: ic('<circle cx="12" cy="12" r="3.2" fill="currentColor"/><circle cx="12" cy="12" r="7.5"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/>'),
    x: ic('<path d="M6 6l12 12M18 6 6 18"/>'),
    pen: ic('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
    search: ic('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/>')
  };

  /* ---------- the page's own controls, pressed on the analyst's behalf ---------- */
  function q(s) { return D.querySelector(s); }
  function press(s) { var b = typeof s === "string" ? q(s) : s; if (b) b.click(); return !!b; }
  var areaEl = q("#area-ctl");
  function areaPress(k) {
    if (!areaEl) return;
    var b = areaEl.querySelector('[data-area="' + k + '"]');
    if (!b && /^(lasso|poly|circle|rect|edit)$/.test(k)) { press(areaEl.querySelector('[data-area="open"]')); b = areaEl.querySelector('[data-area="' + k + '"]'); }
    if (b) b.click();
  }
  function areaOn() { var A = W.TSAP && W.TSAP.areaApi; return !!(A && A.area && A.area()); }

  /* ---------- the toolbar ---------- */
  /* the toolbar in groups, top to bottom, with a thin line between groups (Shane 2026-09-30: easy and intuitive to find):
       Home:   Today (the start screen; the header logo opens it too)
       Find:   Search
       Show:   Data sets (reporting topics), Weather, Overlays (map layers, your marks), Base map
       Map:    Grid, Crosshair (osap-grid.js) and 3D (osap-3d.js) are added here, before Measure
       Tools:  Measure, Route, Area (draw, summarise, NAI/TAI), Point, Watch
       Yours:  My work
       Screen: Layout, Full
     New map layers (power grid, communications towers) go in Overlays; area tools (a medical plan) go in the Area menu. */
  var TOOLS = [
    ["today", "Today", I.home, "Back to Today: weather, alerts and top stories"],
    ["search", "Search", I.search, "Search places, or go to an MGRS, UTM or lat/long"],
    ["datasets", "Data sets", I.data, "Data sets: the reporting topics the map and the list show"],
    ["weather", "Weather", I.cloud, "Weather: radar, cloud, wind, warnings, cyclones and forecasts"],
    ["overlays", "Overlays", I.layers, "Map overlays: flooding, terrain, roads, aircraft, your marks"],
    ["basemap", "Base map", I.globe, "Choose the base map: grey, streets, topographic, satellite and more"],
    ["measure", "Measure", I.ruler, "Measure distance, bearing and area"],
    ["route", "Route", I.route, "Plan a route on roads or in a straight line"],
    ["area", "Area", I.area, "Draw an area to filter the map, summarise it or save it as an NAI/TAI"],
    ["point", "Point", I.pin, "Add a point with a name, a note and photos"],
    ["watch", "Watch", I.eye, "Watch an area and get told about new reports inside it"],
    ["mine", "My work", I.work, "What's new since your last visit, and your saved work"],
    ["layout", "Layout", I.layout, "Map only, map with list, or list"],
    ["full", "Full", I.full, "Full-screen map"]
  ];
  var bar = D.createElement("div");
  bar.id = "atk-tools"; bar.className = "leaflet-control"; bar.setAttribute("role", "toolbar"); bar.setAttribute("aria-label", "Map tools"); bar.setAttribute("aria-orientation", "vertical");
  bar.innerHTML = '<button type="button" class="atk-fold" data-atk="fold" aria-expanded="true" title="Fold the toolbar away">' + I.fold + "</button>" +
    '<div class="atk-list">' + TOOLS.map(function (t) {
      return '<button type="button" data-atk="' + t[0] + '" title="' + esc(t[3]) + '" aria-label="' + esc(t[1]) + '">' + t[2] + '<span class="atk-l">' + esc(t[1]) + "</span></button>";
    }).join("") + "</div>";
  L.DomEvent.disableClickPropagation(bar); L.DomEvent.disableScrollPropagation(bar);
  /* every floating piece carries leaflet-control, so the page's map-click dispatcher leaves its taps alone */
  var pop = D.createElement("div"); pop.id = "atk-pop"; pop.className = "leaflet-control"; pop.hidden = true; pop.setAttribute("role", "menu");
  L.DomEvent.disableClickPropagation(pop); L.DomEvent.disableScrollPropagation(pop);

  function fold(v) {
    bar.classList.toggle("folded", v); lsSet(K_FOLD, v ? "1" : null);
    var b = bar.querySelector(".atk-fold"); b.innerHTML = v ? I.unfold : I.fold; b.setAttribute("aria-expanded", String(!v));
    b.title = v ? "Show the map tools" : "Fold the toolbar away"; popClose();
  }
  function popOpen(btn, items) {
    pop.innerHTML = items.map(function (it) {
      return it ? '<button type="button" role="menuitem" data-pk="' + it[0] + '"' + (it[2] ? ' class="on"' : "") + ">" + esc(it[1]) + "</button>" : '<hr>';
    }).join("");
    pop.hidden = false; pop._for = btn.getAttribute("data-atk");
    var r = btn.getBoundingClientRect(), mr = mapEl.getBoundingClientRect();
    pop.style.top = Math.max(4, Math.min(r.top - mr.top, mr.height - pop.offsetHeight - 34)) + "px";
    pop.style.right = (mr.right - r.left + 6) + "px";
  }
  function popClose() { pop.hidden = true; pop._for = null; }
  function paintTools() {
    var mb = q("#meas-btn"), m = bar.querySelector('[data-atk="measure"]');
    if (m) m.setAttribute("aria-pressed", mb && mb.getAttribute("aria-pressed") === "true" ? "true" : "false");
    var a = bar.querySelector('[data-atk="area"]'); if (a) a.classList.toggle("on", areaOn());
    /* My work carries What's new too: its badge counts the new reports (orange), else the saved items (grey) */
    var nb = q('[data-wk-btn="new"] .wkn'), mw = q('[data-wk-btn="mine"] .wkn'), mm = bar.querySelector('[data-atk="mine"]');
    if (mm) { var b2 = mm.querySelector(".atk-n"), src = nb || mw; if (src) { if (!b2) { b2 = D.createElement("span"); mm.appendChild(b2); } b2.className = "atk-n" + (nb ? "" : " n2"); b2.textContent = src.textContent; } else if (b2) b2.remove(); }
    var rt = bar.querySelector('[data-atk="route"]'); if (rt) { rt.hidden = !q('#view-seg button[data-view="route"]'); rt.setAttribute("aria-pressed", String(root.getAttribute("data-view") === "route" && !root.getAttribute("data-cf"))); }
    var fs = bar.querySelector('[data-atk="full"]'); if (fs) fs.setAttribute("aria-pressed", String(root.classList.contains("mapfull")));
    var lay = bar.querySelector('[data-atk="layout"]'), seg = q("#rv-seg");
    if (lay) lay.hidden = !seg || phone();   /* on a phone the list sheet is dragged up and down instead */
  }
  bar.addEventListener("click", function (e) {
    var b = e.target.closest("[data-atk]"); if (!b) return;
    var k = b.getAttribute("data-atk");
    if (k === "fold") { fold(!bar.classList.contains("folded")); return; }
    if (pop._for === k) { popClose(); return; }
    popClose();
    if (k === "today") { omClose(); if (W.OSAP_TODAY) W.OSAP_TODAY.show(); }
    else if (k === "search") search();
    else if (k === "datasets" || k === "overlays" || k === "weather") { if (!om.hidden && omMode === k) omClose(); else omOpen(k); }
    else if (k === "basemap") {
      var BM = W.OSAP_BASEMAP; if (!BM) return;
      var cur = BM.get();
      popOpen(b, BM.list().map(function (x) { return [x.id, x.name, x.id === cur]; }));
    }
    else if (k === "measure") { press("#meas-btn"); setTimeout(paintTools, 30); }
    else if (k === "route") {
      var onRoute = root.getAttribute("data-view") === "route" && !root.getAttribute("data-cf");
      if (!onRoute) { rtBack = root.getAttribute("data-cf") ? '#view-seg button[data-view="cf-' + root.getAttribute("data-cf") + '"]' : '#view-seg button[data-view="' + (root.getAttribute("data-view") || "timeline") + '"]'; press('#view-seg button[data-view="route"]'); }
      else press(q(rtBack || "") ? rtBack : '#view-seg button[data-view="timeline"]');
      if (phone() && !om.hidden) omClose(); setTimeout(paintTools, 60);
    }
    else if (k === "area") {
      var has = areaOn();
      popOpen(b, [["lasso", "Lasso"], ["poly", "Polygon"], ["circle", "Circle"], ["rect", "Square"]].concat(has ? [null, ["edit", "Edit shape"], ["sum", "Summarise area"]].concat((W.OSAP_AREA_TOOLS || []).map(function (x) { return [x.id, x.label]; }), [["save", "Save (NAI/TAI)"], ["clear", "Delete shape"]]) : []));
    }
    else if (k === "watch") press("#watch-btn");
    else if (k === "mine") {
      var nn = q('[data-wk-btn="new"] .wkn'), mn = q('[data-wk-btn="mine"] .wkn');
      if (!q('[data-wk-btn="new"]')) press('[data-wk-btn="mine"]');
      else popOpen(b, [["new", "What's new" + (nn ? " (" + nn.textContent + ")" : "")], ["mine", "Saved work" + (mn ? " (" + mn.textContent + ")" : "")]]);
    }
    else if (k === "layout") {
      var cur = q("#rv-seg [aria-pressed=true]") || q("#rv-seg .on"), mode = cur ? cur.getAttribute("data-rv-mode") : "";
      popOpen(b, [["map", "Map only", mode === "map"], ["split", "Map and list", mode === "split"], ["list", "List", mode === "list"]]);
    }
    else if (k === "point") {
      var hm = W.OSAP_LOC && W.OSAP_LOC.here && W.OSAP_LOC.here();
      popOpen(b, [["centre", "At the map centre"], ["tap", "Tap the map to place it"]].concat(hm ? [["me", "At my position"]] : []));
    }
    else if (k === "full") { press("#fs-btn"); setTimeout(paintTools, 80); }
  });
  pop.addEventListener("click", function (e) {
    var b = e.target.closest("[data-pk]"); if (!b) return;
    var k = b.getAttribute("data-pk"), f = pop._for; popClose();
    if (f === "basemap") { if (W.OSAP_BASEMAP) W.OSAP_BASEMAP.set(k); }
    else if (f === "area") {
      /* area tools from other modules (a medical plan for the drawn area): W.OSAP_AREA_TOOLS = [{ id, label, run }, ...] */
      var at = (W.OSAP_AREA_TOOLS || []).filter(function (x) { return x && x.id === k; })[0];
      if (at) { if (typeof at.run === "function") at.run(); }
      else if (k === "save") press("[data-aoi-save]"); else areaPress(k);
      setTimeout(paintTools, 30);
    }
    else if (f === "layout") press('#rv-seg [data-rv-mode="' + k + '"]');
    else if (f === "mine") press('[data-wk-btn="' + k + '"]');
    else if (f === "point") {
      var hm = W.OSAP_LOC && W.OSAP_LOC.here && W.OSAP_LOC.here();
      if (k === "centre") ptAdd(map.getCenter());
      else if (k === "me" && hm) ptAdd(L.latLng(hm.lat, hm.lon));
      else if (k === "tap") { armTap = Date.now(); toast("Tap the map where the point goes"); }
    }
  });
  /* Search places lives in assets/osap-search.js, fetched the first time the magnifying glass is pressed */
  var srchLoading = false;
  function search() {
    var S = W.OSAP_SEARCH;
    if (S) { if (S.isOpen()) S.close(); else S.open(); return; }
    if (srchLoading) return; srchLoading = true;
    var sc = D.createElement("script"); sc.src = "assets/osap-search.js";
    sc.onload = function () { srchLoading = false; if (W.OSAP_SEARCH) W.OSAP_SEARCH.open(); };
    sc.onerror = function () { srchLoading = false; sc.remove(); toast("Search could not load. Check the connection."); };
    D.head.appendChild(sc);
  }
  /* "Tap the map to place it": the next tap on the map (within 30 s) is the point, not a report under the finger */
  var armTap = 0;
  mapEl.addEventListener("click", function (e) {
    if (!armTap || Date.now() - armTap > 30000 || e.target.closest(".leaflet-control, .leaflet-popup")) return;
    armTap = 0; e.stopPropagation(); e.preventDefault();
    var r = mapEl.getBoundingClientRect(); ptAdd(map.containerPointToLatLng([e.clientX - r.left, e.clientY - r.top]));
  }, true);
  D.addEventListener("pointerdown", function (e) { if (!pop.hidden && !pop.contains(e.target) && !bar.contains(e.target)) popClose(); }, true);

  /* ---------- the readout strip ---------- */
  var strip = D.createElement("div"); strip.id = "atk-bar"; strip.className = "leaflet-control";
  strip.innerHTML = '<button type="button" class="atk-pos" data-sb="fmt" title="Tap to switch between MGRS, decimal degrees and degrees-minutes-seconds"><b class="atk-k">Centre</b> <span class="atk-v"></span></button>' +
    '<button type="button" class="atk-ic" data-sb="copy" title="Copy this grid" aria-label="Copy this grid">' + I.copy + "</button>" +
    '<span class="atk-me" hidden><b class="atk-k">Me</b> <span class="atk-mv"></span></span>' +
    '<button type="button" class="atk-ic atk-lock" data-sb="lock" aria-pressed="false" title="Lock the map on my position" aria-label="Lock the map on my position">' + I.lock + "</button>";
  L.DomEvent.disableClickPropagation(strip); L.DomEvent.disableScrollPropagation(strip);
  var cross = D.createElement("div"); cross.id = "atk-cross"; cross.setAttribute("aria-hidden", "true");
  var FMTS = ["mgrs", "dd", "dms"], fmt = FMTS.indexOf(lsGet(K_FMT)) >= 0 ? lsGet(K_FMT) : "mgrs", cursor = null, locked = false, toastT = 0;
  function fmtPt(lat, lon, f) {
    var g = G(); if (!g) return lat.toFixed(5) + ", " + lon.toFixed(5);
    f = f || fmt;
    if (f === "mgrs") return g.mgrs(lat, lon, 5) || g.fmtLL(lat, lon, 5) + " (no MGRS at the poles)";
    if (f === "dms") return g.fmtDms(lat, lon);
    return g.fmtLL(lat, lon, 5);
  }
  function readPt() { if (cursor) return [cursor.lat, cursor.lng]; var c = map.getCenter(); return [c.lat, L.Util.wrapNum(c.lng, [-180, 180], true)]; }
  function paintStrip() {
    if (!root.classList.contains("atak")) return;
    var p = readPt();
    strip.querySelector(".atk-k").textContent = cursor ? "Cursor" : "Centre";
    strip.querySelector(".atk-v").textContent = fmtPt(p[0], p[1]);
    var h = W.OSAP_LOC && W.OSAP_LOC.here && W.OSAP_LOC.here(), me = strip.querySelector(".atk-me");
    me.hidden = !h;
    if (h) strip.querySelector(".atk-mv").textContent = fmtPt(h.lat, h.lon) + (h.acc ? " ±" + (h.acc >= 1000 ? (h.acc / 1000).toFixed(1) + " km" : Math.round(h.acc) + " m") : "");
    var lk = strip.querySelector(".atk-lock"); lk.setAttribute("aria-pressed", String(locked)); lk.classList.toggle("on", locked);
  }
  var rafP = 0; function soon() { if (!rafP) rafP = requestAnimationFrame(function () { rafP = 0; paintStrip(); }); }
  map.on("move", soon);
  var fine = W.matchMedia && W.matchMedia("(hover:hover) and (pointer:fine)").matches;
  map.on("mousemove", function (e) { if (!fine) return; cursor = e.latlng; soon(); });
  map.on("mouseout", function () { cursor = null; soon(); });
  map.on("movestart", function () { cross.classList.add("show"); });
  map.on("moveend", function () { clearTimeout(cross._t); cross._t = setTimeout(function () { cross.classList.remove("show"); }, 1200); });
  map.on("dragstart", function () { if (locked) { locked = false; paintStrip(); toast("Unlocked from your position"); } });
  function toast(t) {
    var n = q("#atk-toast"); if (!n) { n = D.createElement("div"); n.id = "atk-toast"; n.setAttribute("role", "status"); mapEl.appendChild(n); }
    n.textContent = t; n.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(function () { n.classList.remove("show"); }, 1800);
  }
  function copy(t) {
    var done = function () { toast("Copied " + t); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, function () { toast(t); });
    else toast(t);
  }
  function lockTo() { var h = W.OSAP_LOC && W.OSAP_LOC.here && W.OSAP_LOC.here(); if (locked && h) map.setView([h.lat, h.lon], Math.max(map.getZoom(), 13), { animate: true }); }
  if (W.OSAP_LOC && W.OSAP_LOC.onChange) W.OSAP_LOC.onChange(function (h) { if (!h) locked = false; lockTo(); paintStrip(); });
  strip.addEventListener("click", function (e) {
    var b = e.target.closest("[data-sb]"); if (!b) return;
    var k = b.getAttribute("data-sb");
    if (k === "fmt") { fmt = FMTS[(FMTS.indexOf(fmt) + 1) % FMTS.length]; lsSet(K_FMT, fmt); paintStrip(); }
    else if (k === "copy") { var p = readPt(); copy(fmtPt(p[0], p[1])); }
    else if (k === "lock") {
      if (locked) { locked = false; paintStrip(); return; }
      locked = true;
      if (W.OSAP_LOC && (!W.OSAP_LOC.on() || !W.OSAP_LOC.here())) { toast("Finding you… (Use my location)"); W.OSAP_LOC.use(); }
      lockTo(); paintStrip();
    }
  });

  /* ---------- dropped points: the analyst's own marks, this browser only ---------- */
  if (!map.getPane("atakpane")) { map.createPane("atakpane"); map.getPane("atakpane").style.zIndex = 670; }
  var ptLayer = L.layerGroup().addTo(map);
  var CAM = ' <svg class="atk-cam" viewBox="0 0 24 24" width="11" height="11" aria-label="photos" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M3 8h4l2-3h6l2 3h4v11H3z"/><circle cx="12" cy="13" r="3.5"/></svg>';
  function ptsAll() { try { var a = JSON.parse(lsGet(K_PTS) || "[]"); return Array.isArray(a) ? a.filter(function (p) { return p && isFinite(p.lat) && isFinite(p.lon); }) : []; } catch (e) { return []; } }
  function ptsSave(a) { lsSet(K_PTS, JSON.stringify(a.slice(-500))); }
  function ptsHere() { var c = cc(); return ptsAll().filter(function (p) { return p.cc === c; }); }
  function ptDraw() {
    ptLayer.clearLayers();
    ptsHere().forEach(function (p) {
      /* the point's own icon (assets/osap-milsym.js: a military symbol, a shape or a pin); the teal diamond otherwise */
      var sy = p.sym && W.OSAP_MSYM ? W.OSAP_MSYM.draw(p.sym) : null;
      var m = L.marker([p.lat, p.lon], { pane: "atakpane", keyboard: false, title: p.n,
        icon: sy ? L.divIcon({ className: "atk-pt atk-sym", html: sy.html + '<span style="left:' + (sy.w + 2) + "px;top:" + Math.max(0, Math.round(sy.cy - 8)) + 'px">' + esc(p.n) + (p.ph ? CAM + p.ph : "") + "</span>", iconSize: [sy.w, sy.h], iconAnchor: [sy.ax, sy.ay] })
          : L.divIcon({ className: "atk-pt", html: "<i></i><span>" + esc(p.n) + (p.ph ? CAM + p.ph : "") + "</span>", iconSize: [18, 18], iconAnchor: [9, 9] }) });
      m.bindPopup(function () {
        var d = D.createElement("div"); d.setAttribute("data-keep-pop", ""); d.className = "atk-ptpop";
        var PX = W.OSAP_POINTS;
        d.innerHTML = "<b>" + esc(p.n) + "</b> <span class=\"obs\">your own mark</span>" + (p.sym && W.OSAP_MSYM && W.OSAP_MSYM.valid(p.sym) ? '<p class="obs atk-psym">' + esc(W.OSAP_MSYM.label(p.sym)) + "</p>" : "") + (p.note ? '<p class="atk-note">' + esc(p.note) + "</p>" : "") + (PX && p.ph ? '<div class="atk-pph"></div>' : "") + "<code>" + esc(fmtPt(p.lat, p.lon, "mgrs")) + "</code><code>" + esc(fmtPt(p.lat, p.lon, "dd")) + "</code>" +
          '<p class="obs">Dropped ' + esc(new Date(p.t).toISOString().slice(0, 16).replace("T", " ")) + "Z. Kept in this browser only; not a report.</p>" +
          '<div class="atk-pb">' + (PX ? '<button type="button" data-pp="edit">Edit, photos</button>' : "") + '<button type="button" data-pp="measure">Measure from</button><button type="button" data-pp="route">Route from</button><button type="button" data-pp="copy">Copy</button><button type="button" data-pp="del">Remove</button></div>';
        d.addEventListener("click", function (e) {
          var b = e.target.closest("[data-pp]"); if (!b) return; var k = b.getAttribute("data-pp");
          map.closePopup();
          if (k === "del") ptDel(p.id);
          else if (k === "edit") PX.edit(p.id);
          else act(k, L.latLng(p.lat, p.lon));
        });
        if (PX && p.ph) PX.thumbs(d.querySelector(".atk-pph"), p.id);
        return d;
      }, { maxWidth: 280 });
      m.addTo(ptLayer);
    });
  }
  function ptAdd(ll, name) {
    var a = ptsAll(), c = cc(), n = 1;
    a.forEach(function (p) { var m = /^P(\d+)$/.exec(p.n || ""); if (p.cc === c && m) n = Math.max(n, +m[1] + 1); });
    name = String(name || "").trim().slice(0, 80) || "P" + n;
    a.push({ id: "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), cc: c, lat: +ll.lat.toFixed(6), lon: +L.Util.wrapNum(ll.lng, [-180, 180], true).toFixed(6), n: name, t: Date.now() });
    var pt = a[a.length - 1];
    ptsSave(a); ptDraw(); omPaint(); toast("Dropped " + name);
    if (W.OSAP_POINTS) W.OSAP_POINTS.edit(pt.id);
    return pt;
  }
  /* removing a point also removes its photos from this device */
  function ptDel(id) { ptsSave(ptsAll().filter(function (x) { return x.id !== id; })); ptDraw(); omPaint(); if (W.OSAP_POINTS) W.OSAP_POINTS.forget(id); }

  /* ---------- the radial menu ---------- */
  var RAD = [
    ["measure", "Measure", I.ruler], ["route", "Route", I.route], ["pin", "Point", I.pin],
    ["nai", "NAI/TAI", I.nai], ["watch", "Watch", I.eye], ["copy", "Copy", I.copy]
  ];
  var RADII = [0.5, 1, 5, 10];
  function radius() { var r = +lsGet(K_R); return RADII.indexOf(r) >= 0 ? r : 1; }
  var ring = D.createElement("div"); ring.id = "atk-ring"; ring.className = "leaflet-control"; ring.hidden = true; ring.setAttribute("role", "menu"); ring.setAttribute("aria-label", "Actions at this point");
  L.DomEvent.disableClickPropagation(ring); L.DomEvent.disableScrollPropagation(ring);
  var ringLL = null, ringMark = null;
  function circle(ll, km) {
    var g = G(), P = [];
    for (var i = 0; i < 32; i++) { var d = g ? g.dest([ll.lat, ll.lng], i * 360 / 32, km * 1000) : [ll.lat + km / 111 * Math.cos(i / 32 * 2 * Math.PI), ll.lng + km / 111 / Math.cos(ll.lat * Math.PI / 180) * Math.sin(i / 32 * 2 * Math.PI)]; P.push([+d[0].toFixed(6), +d[1].toFixed(6)]); }
    return P;
  }
  function ringOpen(ll) {
    ringLL = ll; var p = map.latLngToContainerPoint(ll), sz = mapEl.getBoundingClientRect(), R = 118;
    var x = Math.max(R, Math.min(sz.width - R, p.x)), y = Math.max(R - 10, Math.min(sz.height - R - 30, p.y));
    var n = RAD.length, r = sz.width < 380 ? 70 : 76;
    ring.innerHTML = RAD.map(function (a, i) {
      var t = -Math.PI / 2 + i * 2 * Math.PI / n, bx = Math.round(Math.cos(t) * r), by = Math.round(Math.sin(t) * r);
      return '<button type="button" role="menuitem" data-rk="' + a[0] + '" style="transform:translate(' + bx + "px," + by + 'px)">' + a[2] + "<span>" + esc(a[1]) + "</span></button>";
    }).join("") +
      '<div class="atk-rc" title="Grid of this point"><span>' + esc(fmtPt(ll.lat, ll.lng, "mgrs")) + "</span></div>" +
      '<div class="atk-rr" role="group" aria-label="Area radius for NAI/TAI and Watch"><span>Radius</span>' + RADII.map(function (k) {
        return '<button type="button" data-rr="' + k + '"' + (k === radius() ? ' aria-pressed="true"' : "") + ">" + k + "</button>"; }).join("") + "<span>km</span></div>" +
      '<button type="button" class="atk-rx" data-rk="close" aria-label="Close">' + I.x + "</button>";
    ring.style.left = x + "px"; ring.style.top = y + "px"; ring.hidden = false;
    if (!ringMark) ringMark = L.circleMarker(ll, { pane: "atakpane", radius: 5, color: "#fff", weight: 2, fillColor: "#0b7285", fillOpacity: 1, interactive: false });
    ringMark.setLatLng(ll).addTo(map);
    if (navigator.vibrate) try { navigator.vibrate(12); } catch (e) {}
    var f = ring.querySelector("[data-rk]"); if (f) f.focus({ preventScroll: true });
  }
  function ringClose() { ring.hidden = true; ringLL = null; if (ringMark) map.removeLayer(ringMark); }
  function act(k, ll) {
    var P = [ll.lat, L.Util.wrapNum(ll.lng, [-180, 180], true)];
    if (k === "measure") { if (W.OSAP_MEASURE) { W.OSAP_MEASURE.on(true); W.OSAP_MEASURE.set([P], false); toast("Measuring from here: tap the next point"); setTimeout(paintTools, 30); } }
    else if (k === "route") { if (W.OSAP_ROUTE_SEED) W.OSAP_ROUTE_SEED([P]); }
    else if (k === "pin") ptAdd(ll);
    else if (k === "copy") copy(fmtPt(P[0], P[1]));
    else if (k === "nai" || k === "watch") {
      var A = W.TSAP && W.TSAP.areaApi; if (!A || !A.setArea) return;
      A.setArea(circle(ll, radius())); setTimeout(paintTools, 30);
      if (k === "nai") (function tryIt(n) {
        /* osap-aoi.js adds "Save as NAI/TAI" beside Draw area once the area is drawn */
        if (press("[data-aoi-save]")) return;
        if (n > 0) setTimeout(function () { tryIt(n - 1); }, 60); else toast("Saved areas are not available here");
      })(15);
      else if (W.OSAP_WATCH) setTimeout(function () { W.OSAP_WATCH.open(); var r = q('[name="w-area"][value="drawn"]'); if (r && !r.disabled) { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); } }, 60);
    }
  }
  ring.addEventListener("click", function (e) {
    var rr = e.target.closest("[data-rr]");
    if (rr) { lsSet(K_R, rr.getAttribute("data-rr")); Array.prototype.forEach.call(ring.querySelectorAll("[data-rr]"), function (b) { b.setAttribute("aria-pressed", String(b === rr)); }); return; }
    if (e.target.closest(".atk-rc")) { var l0 = ringLL; ringClose(); act("copy", l0); return; }
    var b = e.target.closest("[data-rk]"); if (!b) return;
    var k = b.getAttribute("data-rk"), ll = ringLL; ringClose();
    if (k !== "close" && ll) act(k, ll);
  });
  D.addEventListener("keydown", function (e) { if (e.key === "Escape") { if (!ring.hidden) ringClose(); popClose(); } });
  D.addEventListener("pointerdown", function (e) { if (!ring.hidden && !ring.contains(e.target)) ringClose(); }, true);
  map.on("zoomstart", function () { if (!ring.hidden) ringClose(); });

  /* long-press: our own timer for touch (iOS Safari sends no contextmenu), right-click for a mouse */
  function busy() { return !root.classList.contains("atak") || !!(areaEl && areaEl.querySelector(".areahint")) || (q("#meas-card") && !q("#meas-card").hidden); }
  var lp = null, swallow = false;
  mapEl.addEventListener("pointerdown", function (e) {
    if (e.pointerType === "mouse" || !e.isPrimary) { if (lp) { clearTimeout(lp.t); lp = null; } return; }
    if (e.target.closest(".leaflet-control, .leaflet-popup, #atk-ring, #atk-bar, #atk-tools, #atk-om, #atk-pop")) return;
    if (busy()) return;
    var x = e.clientX, y = e.clientY;
    lp = { x: x, y: y, t: setTimeout(function () {
      lp = null; var r = mapEl.getBoundingClientRect();
      swallow = true; setTimeout(function () { swallow = false; }, 700);
      ringOpen(map.containerPointToLatLng([x - r.left, y - r.top]));
    }, 550) };
  }, true);
  function lpCancel(e) { if (lp && (!e || e.type !== "pointermove" || Math.abs(e.clientX - lp.x) + Math.abs(e.clientY - lp.y) > 10)) { clearTimeout(lp.t); lp = null; } }
  ["pointermove", "pointerup", "pointercancel"].forEach(function (k) { mapEl.addEventListener(k, lpCancel, true); });
  map.on("movestart zoomstart", function () { lpCancel(); });
  /* the tap that ends a long-press must not also select a report under the finger */
  mapEl.addEventListener("click", function (e) { if (swallow && e.isTrusted && !e.target.closest("#atk-ring, #pt-ed")) { swallow = false; e.stopPropagation(); e.preventDefault(); } }, true);
  mapEl.addEventListener("contextmenu", function (e) {
    if (!root.classList.contains("atak")) return;
    if (e.target.closest(".leaflet-control, #atk-ring, #atk-bar, #atk-tools")) return;
    e.preventDefault();
    if (e.pointerType === "touch" || busy() || swallow) return;
    var r = mapEl.getBoundingClientRect(); ringOpen(map.containerPointToLatLng([e.clientX - r.left, e.clientY - r.top]));
  });

  /* ---------- Overlay Manager ---------- */
  var om = D.createElement("aside"); om.id = "atk-om"; om.className = "leaflet-control"; om.hidden = true; om.setAttribute("aria-label", "Overlay Manager");
  om.innerHTML = '<div class="atk-omh"><h2>Overlays</h2><button type="button" class="atk-ic" data-om="x" aria-label="Close">' + I.x + "</button></div>" +
    '<div class="atk-omb"><section class="atk-s-ds"><h3>Data sets</h3><div id="atk-ds"></div></section>' +
    '<section class="atk-s-ml"><div id="atk-ml"></div></section>' +
    '<section class="atk-s-ov"><h3>Your marks <span class="obs">(this browser only)</span></h3><div id="atk-marks"></div></section>' +
    '<section class="atk-s-ov"><h3>Controls</h3><label class="atk-sw"><input type="checkbox" id="atk-classic"> <span>Classic controls (the old buttons instead of this toolbar)</span></label></section></div>';
  L.DomEvent.disableClickPropagation(om); L.DomEvent.disableScrollPropagation(om);
  var mlHome = null, omMode = "datasets", rtBack = null;
  function omPaint() {
    if (om.hidden) return;
    /* data sets: once the page has its own on/off checklist (window.OSAP_DATASETS, #ml-ds inside the Layers panel that this
       sheet holds), that is the one list; until then the page's own tabs, pressed as before */
    var dsSec = om.querySelector("#atk-ds").parentNode; dsSec.hidden = !!(W.OSAP_DATASETS && q("#ml-ds"));
    if (dsSec.hidden && W.OSAP_DATASETS.refresh) W.OSAP_DATASETS.refresh();
    var ds = om.querySelector("#atk-ds"), btns = D.querySelectorAll("#view-seg button[data-view]");
    ds.innerHTML = Array.prototype.map.call(btns, function (b) {
      var v = b.getAttribute("data-view"), sel = b.getAttribute("aria-selected") === "true";
      return '<button type="button" class="atk-dsb' + (sel ? " on" : "") + (b.classList.contains("stub") ? " stub" : "") + '" data-ds="' + esc(v) + '" aria-pressed="' + sel + '">' + esc(b.textContent) + "</button>";
    }).join("") || '<p class="obs">No data sets on this tab.</p>';
    var mk = om.querySelector("#atk-marks"), P = ptsHere(), A = W.OSAP_AOI ? W.OSAP_AOI.list(cc()) : [];
    mk.innerHTML = (P.length || A.length ? "" : '<p class="obs">Use Point on the toolbar, or long-press the map, to add a point. Long-press to save an NAI/TAI.</p>') +
      P.map(function (p) { return '<div class="atk-mk"><button type="button" data-mk-go="' + esc(p.id) + '"><i class="atk-dot"></i>' + esc(p.n) + (p.ph ? " <span class=\"obs\">" + CAM + p.ph + "</span>" : "") + ' <code>' + esc(fmtPt(p.lat, p.lon, "mgrs")) + '</code></button>' + (W.OSAP_POINTS ? '<button type="button" class="atk-ic" data-mk-ed="' + esc(p.id) + '" aria-label="Edit ' + esc(p.n) + '" title="Name, note and photos">' + I.pen + "</button>" : "") + '<button type="button" class="atk-ic" data-mk-del="' + esc(p.id) + '" aria-label="Remove ' + esc(p.n) + '">' + I.x + "</button></div>"; }).join("") +
      A.map(function (a) { return '<div class="atk-mk"><button type="button" data-aoi-go="' + esc(a.id) + '"><span class="chip aoichip aoi-' + a.type.toLowerCase() + '">' + a.type + "</span> " + esc(a.name) + "</button></div>"; }).join("");
    om.querySelector("#atk-classic").checked = !on();
  }
  /* one sheet, three separate uses, each opened only by its own toolbar button (no tabs between them): "datasets" shows only the data set list;
     "overlays" shows the map layers, your marks and controls; "weather" shows only the weather layers */
  function omOpen(mode) {
    omMode = mode === "overlays" || mode === "weather" ? mode : "datasets";
    var ttl = { datasets: "Data sets", overlays: "Map overlays", weather: "Weather" }[omMode];
    om.setAttribute("data-mode", omMode); om.setAttribute("aria-label", ttl);
    om.querySelector("h2").textContent = ttl;
    ["datasets", "overlays", "weather"].forEach(function (k) { var b = bar.querySelector('[data-atk="' + k + '"]'); if (b) b.setAttribute("aria-pressed", String(k === omMode)); });
    var ml = q("#ml-panel");
    if (ml && ml.parentNode !== om.querySelector("#atk-ml")) { mlHome = ml.parentNode; om.querySelector("#atk-ml").appendChild(ml); }
    if (ml) ml.hidden = false;
    om.hidden = false; root.classList.add("atk-omopen"); omPaint();
    var x = om.querySelector("[data-om=x]"); if (x) x.focus({ preventScroll: true });
  }
  function omClose() {
    om.hidden = true; root.classList.remove("atk-omopen");
    ["datasets", "overlays", "weather"].forEach(function (k) { var b = bar.querySelector('[data-atk="' + k + '"]'); if (b) b.setAttribute("aria-pressed", "false"); });
    var ml = q("#ml-panel"); if (ml && mlHome && ml.parentNode !== mlHome) { mlHome.appendChild(ml); ml.hidden = true; var b = mlHome.querySelector(".mlbtn"); if (b) b.setAttribute("aria-expanded", "false"); }
  }
  om.addEventListener("click", function (e) {
    var t = e.target, b;
    if (t.closest("[data-om=x]")) { omClose(); return; }
    if ((b = t.closest(".atk-dsb[data-ds]"))) { press('#view-seg button[data-view="' + b.getAttribute("data-ds") + '"]'); setTimeout(omPaint, 60); return; }
    if ((b = t.closest("[data-mk-del]"))) { ptDel(b.getAttribute("data-mk-del")); return; }
    if ((b = t.closest("[data-mk-ed]"))) { if (phone()) omClose(); if (W.OSAP_POINTS) W.OSAP_POINTS.edit(b.getAttribute("data-mk-ed")); return; }
    if ((b = t.closest("[data-mk-go]"))) { var p = ptsAll().filter(function (x) { return x.id === b.getAttribute("data-mk-go"); })[0]; if (p) { if (phone()) omClose(); map.setView([p.lat, p.lon], Math.max(map.getZoom(), 12)); } return; }
    if ((b = t.closest("[data-aoi-go]"))) { if (W.OSAP_AOI) { omClose(); W.OSAP_AOI.open(b.getAttribute("data-aoi-go")); } return; }
  });
  /* Open on a data set or view in the list: on a phone the sheet closes and the list comes up half way, so the choice shows */
  D.addEventListener("osap:dsopen", function () {
    if (!phone() || om.hidden) return;
    omClose(); if (W.ASAP_PHONE && W.ASAP_PHONE.setSheet) setTimeout(function () { W.ASAP_PHONE.setSheet("half"); }, 80);
  });
  om.addEventListener("change", function (e) { if (e.target.id === "atk-classic") { setMode(!e.target.checked); if (!e.target.checked) omPaint(); } });
  function phone() { return root.classList.contains("phone") || W.innerWidth <= 700; }

  /* ---------- mode switch ---------- */
  function setMode(atak) {
    lsSet(K_UI, atak ? null : "classic");
    root.classList.toggle("atak", atak);
    if (!atak) { omClose(); ringClose(); popClose(); locked = false; toast("Classic controls. Turn the toolbar back on from Layers."); }
    paintTools(); paintStrip(); addClassicSwitch();
  }
  /* in classic mode, a way back: one line at the foot of the Layers panel */
  function addClassicSwitch() {
    var ex = q("#ml-extra"); if (!ex || q("#atk-back")) return;
    var d = D.createElement("label"); d.id = "atk-back"; d.className = "mlrow";
    d.innerHTML = '<input type="checkbox"> <span><b>Tactical toolbar</b><i>ATAK-style side toolbar, long-press menu and grid readout</i></span>';
    ex.parentNode.insertBefore(d, ex.nextSibling);
    d.querySelector("input").addEventListener("change", function (e) { if (e.target.checked) { setMode(true); } });
  }
  function syncBack() { var b = q("#atk-back input"); if (b && b.checked !== on()) b.checked = on(); var l = q("#atk-back"); if (l && l.hidden !== on()) l.hidden = on(); }

  /* ---------- styles ---------- */
  var st = D.createElement("style");
  st.textContent =
    /* the old controls stay in the page but out of sight; Draw area comes back while a shape is being drawn */
    "html.atak #map .leaflet-top.leaflet-right>.leaflet-control:not(#atk-tools):not(.meascard):not(.leaflet-control-attribution):not(:has(.areahint)),html.atak #map .fsctl,html.atak #map .measctl,html.atak #map .locctl{display:none!important}" +
    "html.atak #map .leaflet-top.leaflet-right>#area-ctl:has(.areahint){display:flex!important;position:absolute;right:52px;top:0;margin:8px 0 0!important;z-index:5}" +
    /* on a phone that corner is a zero-size scroll box, which clipped the drawing and editing panel out of sight */
    "html.atak #map .leaflet-top.leaflet-right:has(>#area-ctl .areahint){overflow:visible!important}" +
    /* the toolbar has its own Base map button, so Overlays does not repeat the list */
    "html.atak #ml-panel .mlbase{display:none}" +
    /* Data sets shows the list alone; Map overlays shows everything else in the Layers panel, plus your marks and controls */
    /* the sheet's header switches between the two, so on a phone (where the sheet covers the toolbar) neither needs closing first */
    "#atk-om h2{margin:0;font:700 17px system-ui,sans-serif}" +
    "#atk-om[data-mode=datasets] .atk-s-ov,#atk-om[data-mode=datasets] #ml-panel>:not(#ml-ds),#atk-om[data-mode=overlays] #ml-ds,#atk-om[data-mode=overlays] #ml-wx{display:none!important}" +
    /* Weather shows the weather section of the Layers panel alone */
    "#atk-om[data-mode=weather] .atk-s-ov,#atk-om[data-mode=weather] #ml-panel>:not(#ml-extra),#atk-om[data-mode=weather] #ml-extra>:not(#ml-wx),#atk-om[data-mode=weather] #ml-wx>.mlh:first-child{display:none!important}" +
    "html.atak #map #atk-tools,html.atak #map #atk-bar{display:flex}#atk-tools,#atk-bar,#atk-cross,#atk-ring[hidden],#atk-om[hidden],#atk-pop[hidden]{display:none}" +
    "@media (pointer:coarse){html.atak #map .leaflet-control-zoom{display:none}}" +
    "html.atak #map .leaflet-bottom{bottom:30px}html.atak #map{-webkit-touch-callout:none}" +
    /* toolbar */
    "#atk-tools{position:absolute;right:0;top:0;z-index:1000;flex-direction:column;align-items:stretch;top:8px;right:8px;margin:0!important;background:rgba(20,24,28,.86);border-radius:10px;padding:3px;box-shadow:0 2px 10px rgba(0,0,0,.35);max-height:calc(100% - 46px);box-sizing:border-box;pointer-events:auto}" +
    "#atk-tools .atk-list{display:flex;flex-direction:column;gap:2px;overflow-y:auto;scrollbar-width:none}#atk-tools .atk-list::-webkit-scrollbar{display:none}" +
    "#atk-tools button{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;width:48px;min-height:40px;padding:4px 2px;border:0;border-radius:7px;background:none;color:#e9eef2;cursor:pointer;font:600 9.5px/1.1 system-ui,-apple-system,sans-serif;letter-spacing:.01em}" +
    /* a thin line above the first button of each group */
    "#atk-tools .atk-list>[data-atk=search],#atk-tools .atk-list>[data-atk=datasets],#atk-tools .atk-list>[data-ogrid=lines],#atk-tools .atk-list>[data-atk=measure],#atk-tools .atk-list>[data-atk=mine],#atk-tools .atk-list>[data-atk=layout]{margin-top:5px}" +
    "#atk-tools .atk-list>[data-atk=search]::before,#atk-tools .atk-list>[data-atk=datasets]::before,#atk-tools .atk-list>[data-ogrid=lines]::before,#atk-tools .atk-list>[data-atk=measure]::before,#atk-tools .atk-list>[data-atk=mine]::before,#atk-tools .atk-list>[data-atk=layout]::before{content:'';position:absolute;left:8px;right:8px;top:-4px;border-top:1px solid rgba(255,255,255,.22)}" +
    "#atk-tools button:hover{background:rgba(255,255,255,.1)}#atk-tools button:focus-visible{outline:2px solid #4dabf7;outline-offset:-2px}" +
    "#atk-tools button[aria-pressed=true],#atk-tools button.on{background:#0b7285;color:#fff}#atk-tools button[hidden]{display:none}" +
    "#atk-tools .atk-fold{min-height:28px;color:#9fb3c1;border-bottom:1px solid rgba(255,255,255,.12);border-radius:7px 7px 0 0;margin-bottom:2px}" +
    "#atk-tools.folded{padding:2px}#atk-tools.folded .atk-list{display:none}#atk-tools.folded .atk-fold{border:0;min-height:40px;width:36px;border-radius:8px;margin:0}" +
    "#atk-tools .atk-n{position:absolute;top:2px;right:3px;min-width:16px;padding:0 4px;border-radius:8px;background:#e8590c;color:#fff;font:700 9.5px/16px system-ui,sans-serif}#atk-tools .atk-n.n2{background:#495057}" +
    "#atk-pop{position:absolute;z-index:1001;display:flex;flex-direction:column;min-width:170px;padding:4px;background:rgba(20,24,28,.94);border-radius:9px;box-shadow:0 4px 14px rgba(0,0,0,.4)}" +
    "#atk-pop button{text-align:left;padding:10px 12px;border:0;border-radius:6px;background:none;color:#e9eef2;font:500 14px/1.2 system-ui,-apple-system,sans-serif;cursor:pointer}#atk-pop button:hover,#atk-pop button.on{background:#0b7285;color:#fff}#atk-pop hr{border:0;border-top:1px solid rgba(255,255,255,.14);margin:3px 4px}" +
    /* readout strip */
    "#atk-bar{position:absolute;left:0;right:0;bottom:0;z-index:1000;margin:0!important;height:30px;align-items:center;gap:2px;padding:0 4px 0 6px;background:rgba(20,24,28,.86);color:#e9eef2;font:12px/1 'IBM Plex Mono',ui-monospace,monospace;box-sizing:border-box;white-space:nowrap;overflow:hidden}" +
    "#atk-bar button{border:0;background:none;color:inherit;font:inherit;cursor:pointer;height:30px;padding:0 6px;border-radius:5px}#atk-bar button:hover{background:rgba(255,255,255,.1)}" +
    "#atk-bar .atk-pos{flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;text-align:left}#atk-bar .atk-k{font:700 10px system-ui,sans-serif;text-transform:uppercase;letter-spacing:.06em;color:#8fd3e0;margin-right:2px}" +
    "#atk-bar .atk-me{flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;margin-left:auto;padding-left:8px;border-left:1px solid rgba(255,255,255,.18)}#atk-bar .atk-me .atk-k{color:#74c0fc}" +
    "#atk-bar .atk-ic{display:flex;align-items:center;justify-content:center;width:34px;padding:0}#atk-bar .atk-ic svg{width:17px;height:17px}#atk-bar .atk-lock{margin-left:auto}#atk-bar .atk-me:not([hidden])+.atk-lock{margin-left:0}" +
    "#atk-bar .atk-lock.on{background:#1a73e8;color:#fff}" +
    "html.atak #atk-cross{display:block;position:absolute;left:50%;top:50%;width:22px;height:22px;margin:-11px 0 0 -11px;z-index:640;pointer-events:none;opacity:0;transition:opacity .25s}#atk-cross.show{opacity:.85}" +
    "#atk-cross::before,#atk-cross::after{content:'';position:absolute;background:#0b7285;box-shadow:0 0 0 1px rgba(255,255,255,.8)}#atk-cross::before{left:10px;top:0;width:2px;height:22px}#atk-cross::after{top:10px;left:0;height:2px;width:22px}" +
    "#atk-toast{position:absolute;left:50%;top:10px;transform:translateX(-50%);z-index:1002;max-width:calc(100% - 24px);padding:7px 12px;border-radius:6px;background:rgba(20,24,28,.92);color:#fff;font:13px/1.3 system-ui,-apple-system,sans-serif;opacity:0;pointer-events:none;transition:opacity .2s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#atk-toast.show{opacity:1}" +
    /* radial menu */
    "#atk-ring{position:absolute;z-index:1003;width:0;height:0;margin:0!important}#atk-pop,#atk-om{margin:0!important}" +
    "#atk-ring [data-rk]{position:absolute;left:-26px;top:-26px;width:52px;height:52px;border-radius:50%;border:0;background:rgba(20,24,28,.92);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.4);font:600 9px/1 system-ui,-apple-system,sans-serif;animation:atkpop .14s ease-out both}" +
    "#atk-ring [data-rk]:hover,#atk-ring [data-rk]:focus-visible{background:#0b7285;outline:none}#atk-ring [data-rk] svg{width:19px;height:19px}#atk-ring [data-rk] span{max-width:48px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    "#atk-ring .atk-rx{width:30px;height:30px;left:-15px;top:-15px;background:rgba(255,255,255,.95);color:#222;animation:none}#atk-ring .atk-rx svg{width:15px;height:15px}#atk-ring .atk-rx:hover{background:#fff;color:#c92a2a}" +
    "#atk-ring .atk-rc{position:absolute;left:50%;top:112px;transform:translateX(-50%);white-space:nowrap;cursor:pointer;padding:4px 8px;border-radius:5px;background:rgba(20,24,28,.92);color:#8fd3e0;font:600 12px/1.2 'IBM Plex Mono',monospace;box-shadow:0 2px 8px rgba(0,0,0,.35)}" +
    "#atk-ring .atk-rr{position:absolute;left:50%;top:140px;transform:translateX(-50%);display:flex;align-items:center;gap:3px;padding:3px 6px;border-radius:6px;background:rgba(20,24,28,.92);color:#cfd8dc;font:11px system-ui,sans-serif;white-space:nowrap}" +
    "#atk-ring .atk-rr button{min-width:30px;height:26px;border:1px solid rgba(255,255,255,.25);border-radius:4px;background:none;color:#fff;font:600 11.5px system-ui,sans-serif;cursor:pointer}#atk-ring .atk-rr button[aria-pressed=true]{background:#0b7285;border-color:#0b7285}" +
    "@keyframes atkpop{from{opacity:0;scale:.4}to{opacity:1;scale:1}}@media (prefers-reduced-motion:reduce){#atk-ring [data-rk]{animation:none}}" +
    /* dropped points */
    ".atk-pt{background:none;border:0}.atk-pt i{position:absolute;left:3px;top:3px;width:12px;height:12px;background:#15aabf;border:2px solid #fff;transform:rotate(45deg);box-shadow:0 1px 3px rgba(0,0,0,.5);box-sizing:border-box}" +
    ".atk-pt span{position:absolute;left:19px;top:1px;padding:0 4px;border-radius:3px;background:rgba(20,24,28,.85);color:#fff;font:700 10.5px/15px 'IBM Plex Mono',monospace;white-space:nowrap}" +
    ".atk-ptpop .atk-note{white-space:pre-wrap;word-break:break-word;margin:4px 0}" +
    ".atk-ptpop code{display:block;font:12px/1.4 'IBM Plex Mono',monospace;margin:3px 0 0}.atk-ptpop .obs{color:var(--muted);font-size:11.5px}.atk-ptpop p{margin:6px 0}" +
    ".atk-pb{display:flex;flex-wrap:wrap;gap:4px}.atk-pb button{font:inherit;font-size:12px;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:4px;padding:4px 8px;min-height:30px;cursor:pointer}" +
    /* Overlay Manager: a side sheet on wide screens, a bottom sheet on phones */
    "#atk-om{position:absolute;top:0;right:0;bottom:30px;z-index:1004;width:min(360px,92%);display:flex;flex-direction:column;background:var(--surface,#fff);color:var(--ink,#222);box-shadow:-4px 0 18px rgba(0,0,0,.3);font-size:13px}" +
    "#atk-om .atk-omh{display:flex;align-items:center;justify-content:space-between;padding:8px 8px 8px 14px;border-bottom:1px solid var(--line)}#atk-om h2{font-size:15px;margin:0}" +
    "#atk-om .atk-ic{display:flex;align-items:center;justify-content:center;width:36px;height:36px;border:0;border-radius:6px;background:none;color:inherit;cursor:pointer}#atk-om .atk-ic:hover{background:var(--surface2)}" +
    "#atk-om .atk-omb{overflow:auto;padding:0 0 12px;flex:1}#atk-om section{padding:10px 14px;border-bottom:1px solid var(--line-soft,var(--line))}" +
    "#atk-om h3{font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:0 0 8px}#atk-om h3 .obs{text-transform:none;letter-spacing:0;font-weight:400}#atk-om .obs{color:var(--muted);font-size:12px}" +
    "#atk-ds{display:flex;flex-wrap:wrap;gap:5px}.atk-dsb{border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:999px;padding:6px 11px;font:500 12.5px system-ui,sans-serif;cursor:pointer;min-height:32px}.atk-dsb.on{background:#0b7285;border-color:#0b7285;color:#fff}.atk-dsb.stub{opacity:.6}" +
    "#atk-ml #ml-panel{display:block!important;position:static!important;max-height:none!important;box-shadow:none!important;border:0!important;padding:0!important;margin:0!important;width:auto!important;background:none!important}" +
    ".atk-mk{display:flex;align-items:center;gap:4px;border-top:1px solid var(--line-soft,var(--line))}.atk-mk:first-child{border-top:0}.atk-mk>button:first-child{flex:1;text-align:left;border:0;background:none;color:inherit;font:inherit;padding:8px 2px;cursor:pointer;display:flex;align-items:center;gap:6px}" +
    ".atk-mk code{font:11.5px 'IBM Plex Mono',monospace;color:var(--muted)}.atk-dot{display:inline-block;width:9px;height:9px;background:#15aabf;transform:rotate(45deg);border:1.5px solid #fff;box-shadow:0 0 0 1px #15aabf}" +
    ".atk-sw{display:flex;gap:8px;align-items:flex-start;cursor:pointer}.atk-sw input{margin-top:2px}" +
    "@media (max-width:700px){#atk-om{left:0;right:0;top:auto;width:auto;max-height:72%;border-radius:12px 12px 0 0;box-shadow:0 -4px 18px rgba(0,0,0,.3)}" +
    "#atk-tools{top:6px;right:6px}#atk-tools button{width:44px;min-height:44px}#atk-tools .atk-l{display:none}#atk-tools .atk-fold{min-height:26px}}" +
    "@media (max-width:700px) and (max-height:760px){#atk-tools button{min-height:40px}}";
  D.head.appendChild(st);

  /* ---------- mount ---------- */
  mapEl.appendChild(bar); mapEl.appendChild(pop); mapEl.appendChild(strip); mapEl.appendChild(cross); mapEl.appendChild(ring); mapEl.appendChild(om);
  root.classList.toggle("atak", on());
  if (lsGet(K_FOLD) === "1") fold(true);
  ptDraw(); paintTools(); paintStrip(); addClassicSwitch(); syncBack();
  /* the other scripts add their buttons and counts as they load; keep the toolbar's states in step */
  new MutationObserver(function (recs) {
    if (recs.every(function (r) { var t = r.target; return bar.contains(t) || (t.closest && t.closest("#atk-back")) || (r.addedNodes.length === 1 && r.addedNodes[0].id === "atk-back"); })) return;
    paintTools(); syncBack(); }).observe(mapEl.querySelector(".leaflet-control-container") || mapEl, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-pressed", "class", "hidden"] });
  W.addEventListener("hashchange", function () { setTimeout(function () { ptDraw(); omPaint(); }, 300); });
  D.addEventListener("osap:view", function () { setTimeout(omPaint, 60); setTimeout(paintTools, 60); });
  /* the page's "No data sets on the map: Choose" note opens the Layers menu, which this toolbar holds in the Overlay Manager */
  D.addEventListener("click", function (e) {
    if (root.classList.contains("atak") && e.target.closest && e.target.closest("[data-dspick]")) { e.stopPropagation(); e.preventDefault(); omOpen("datasets"); }
  }, true);
  if (W.OSAP_DATASETS && W.OSAP_DATASETS.onChange) W.OSAP_DATASETS.onChange(function () { omPaint(); });

  W.OSAP_ATAK = { on: on, mode: setMode, ring: function (lat, lon) { ringOpen(L.latLng(lat, lon)); }, close: ringClose, overlays: omOpen, points: ptsHere, fmt: fmtPt, toast: toast,
    /* the readout's position format ("mgrs", "dd" or "dms"): read with no argument, set from Settings with one */
    posFmt: function (f) { if (f && FMTS.indexOf(f) >= 0) { fmt = f; lsSet(K_FMT, f); paintStrip(); } return fmt; },
    pts: { all: ptsAll, save: ptsSave, draw: ptDraw, del: ptDel, paint: omPaint, add: ptAdd }, search: search };
})();
