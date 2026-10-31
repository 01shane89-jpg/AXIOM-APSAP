/* AXIOM OSAP: site survey for a drop zone (DZ), a helicopter landing zone (HLZ) or a landing zone / airfield (Shane 2026-10-31:
   "Do we have DZ, HLZ, Airfield survey tool?").
   One worksheet per site, kept as one record in this browser (localStorage "osap-surveys") and filed in My places like the
   other saved work. The worksheet's sections follow the fields of the standard survey worksheets (the US Air Force drop zone
   survey, AF Form 3823, and landing zone survey, AF Form 3822, and the usual HLZ survey): site and surveyor, location in MGRS,
   dimensions, surface, obstacles, approach and departure, the kind's own items (DZ type and markings; HLZ landing points and
   aircraft; runway, overruns, parking, lighting and navaids) and remarks, with photos. It is OSAP's own worksheet, not the
   official form, and nothing in it is approved by OSAP: the surveyor marks it complete.
   Two kinds of content, never mixed:
   - Surveyed: what the surveyor types or draws (the site's shape on the map is the surveyor's own; every field; their obstacle
     list; the photos they attach). Only the surveyor changes these.
   - From sources: what OSAP looks up for the shape, each with its source and time: elevation at the centre, the two ends and
     the sides (OSAP's terrain sources), the end-to-end and side-to-side gradient worked out from those, magnetic declination
     (WMM2025), mapped obstacles and aeroway features (OpenStreetMap through OSAP_OSM), and what the HLZ finder found when the
     survey was started from one of its candidates. They are shown beside the surveyed value, never copied into it.
   Reuses, never copies: a DZ survey's shape IS the drop zone in OSAP_DZ (assets/osap-dz.js), so the DZSO sheet and the flight
   planner see the same DZ; photos are the photo points from Point > Take a photo here (assets/osap-points.js), referenced by id;
   HLZ finder candidates and mapped strips (assets/osap-lz.js) open a survey with their place and size.
   Opened from long-press > Plans > "Site survey here", the Area menu ("Site survey (DZ, HLZ, airfield)"), the DZSO sheet's
   "Survey this DZ", an HLZ finder candidate or strip ("Survey this site") and My places; assets/osap-atak.js loads this file
   the first time. No toolbar button. Export PDF prints the worksheet with a north-up diagram through OSAP_PDF.
   window.OSAP_SURVEY = { open({ kind, at, id, dzId, name, size, axis, len, wid, finder }), close, isOpen, state, list, get, core } */
(function (root) {
  "use strict";
  var R = Math.PI / 180, FT = 0.3048;

  /* ---------- pure geometry and checks (also loaded by tests/survey.test.mjs) ---------- */
  function local(o, p) { return [(p[1] - o[1]) * 111320 * Math.cos(o[0] * R), (p[0] - o[0]) * 110574]; }
  function unlocal(o, xy) { return [o[0] + xy[1] / 110574, o[1] + xy[0] / (111320 * Math.cos(o[0] * R))]; }
  /* a point in the site's own frame: u along the axis from the centre (positive towards the departure end), v to the right */
  function toLL(g, u, v) { var a = (+g.axis || 0) * R; return unlocal(g.c, [u * Math.sin(a) + v * Math.cos(a), u * Math.cos(a) - v * Math.sin(a)]); }
  function toUv(g, p) { var xy = local(g.c, p), a = (+g.axis || 0) * R; return [xy[0] * Math.sin(a) + xy[1] * Math.cos(a), xy[0] * Math.cos(a) - xy[1] * Math.sin(a)]; }
  function bearing(a, b) { var xy = local(a, b); return ((Math.atan2(xy[0], xy[1]) / R) + 360) % 360; }
  function dist(a, b) { return Math.hypot.apply(null, local(a, b)); }
  /* the approach end (A, where an aircraft arrives), the departure end (B) and the corners, approach end first */
  function ends(g) {
    var h = g.len_m / 2, w = g.wid_m / 2;
    if (g.shape === "circle") return { a: toLL(g, -h, 0), b: toLL(g, h, 0), corners: [] };
    return { a: toLL(g, -h, 0), b: toLL(g, h, 0), corners: [toLL(g, -h, -w), toLL(g, -h, w), toLL(g, h, w), toLL(g, h, -w)] };
  }
  function outline(g) {
    if (g.shape !== "circle") return ends(g).corners;
    var out = []; for (var i = 0; i < 48; i++) { var t = i / 48 * 2 * Math.PI, r = g.len_m / 2; out.push(unlocal(g.c, [r * Math.sin(t), r * Math.cos(t)])); }
    return out;
  }
  function inside(g, p, m) {
    m = m || 0; var q = toUv(g, p);
    if (g.shape === "circle") return Math.hypot(q[0], q[1]) <= g.len_m / 2 + m;
    return Math.abs(q[0]) <= g.len_m / 2 + m && Math.abs(q[1]) <= g.wid_m / 2 + m;
  }
  /* percent gradient over a run; null when either height is unknown */
  function grade(z1, z2, run) { return z1 == null || z2 == null || !(run > 0) ? null : (z2 - z1) / run * 100; }
  /* where a point sits for the approach and departure check: "approach" beyond the approach end, "departure" beyond the
     departure end, inside a corridor that starts at the site's width and splays out by spl (0.1 = 10 percent each side) */
  function zone(g, p, len, spl) {
    var q = toUv(g, p), h = g.len_m / 2, w = (g.shape === "circle" ? g.len_m : g.wid_m) / 2, d;
    if (q[0] < -h) { d = -h - q[0]; if (d <= len && Math.abs(q[1]) <= w + d * spl) return { z: "approach", d: d, off: q[1] }; }
    if (q[0] > h) { d = q[0] - h; if (d <= len && Math.abs(q[1]) <= w + d * spl) return { z: "departure", d: d, off: q[1] }; }
    return null;
  }
  /* an obstacle h metres tall d metres out from the end breaks an n:1 clearance plane when h > d / n */
  function penetrates(h, d, n) { return h != null && n > 0 && h > d / n; }
  /* the clean, checked geometry; null when it cannot be one */
  function cleanG(g) {
    if (!g || !Array.isArray(g.c)) return null;
    var la = +g.c[0], lo = +g.c[1]; if (!isFinite(la) || !isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
    function n(v, lo2, hi, d) { v = +v; return isFinite(v) && v >= lo2 && v <= hi ? v : d; }
    return { c: [+la.toFixed(6), +lo.toFixed(6)], axis: ((n(g.axis, -1e6, 1e6, 0) % 360) + 360) % 360, shape: g.shape === "circle" ? "circle" : "rect",
      len_m: Math.round(n(g.len_m, 5, 20000, 100)), wid_m: Math.round(n(g.wid_m, 5, 20000, 100)) };
  }
  var CORE = { local: local, unlocal: unlocal, toLL: toLL, toUv: toUv, bearing: bearing, dist: dist, ends: ends, outline: outline, inside: inside, grade: grade, zone: zone, penetrates: penetrates, cleanG: cleanG };
  if (typeof module === "object" && module.exports) { module.exports = CORE; return; }
  var W = root;
  if (!W.document || /[?&]watchscan=1(&|$)/.test(location.search)) { W.OSAP_SURVEY = { core: CORE }; return; }
  var D = document, map = W.__asapMap, L = W.L;
  if (!map || !L) { W.OSAP_SURVEY = { core: CORE }; return; }

  /* ---------- the worksheet ---------- */
  var KEY = "osap-surveys", MAX = 200;
  var KINDS = {
    dz: { n: "Drop zone (DZ)", s: "DZ", form: "drop zone survey (AF Form 3823 fields)", appr: 0, ratio: 0, shape: "rect", len: 1000, wid: 550 },
    hlz: { n: "Helicopter landing zone (HLZ)", s: "HLZ", form: "helicopter landing zone survey", appr: 500, ratio: 10, shape: "circle", len: 100, wid: 100 },
    lz: { n: "Landing zone / airfield", s: "LZ", form: "landing zone survey (AF Form 3822 fields)", appr: 1500, ratio: 20, shape: "rect", len: 1000, wid: 30 }
  };
  var SURF = ["", "Grass", "Dirt / soil", "Sand", "Gravel", "Laterite", "Coral", "Crop field", "Paddy", "Asphalt", "Concrete", "Pierced steel / matting", "Snow / ice", "Mixed", "Other"];
  var YN = ["", "Yes", "No", "Not checked"];
  /* [key, label, type, options]: type t text, a long text, s select, n number, d date */
  var SECS = {
    site: { h: "Site and surveyor", f: [["surveyor", "Surveyed by (name, unit)", "t"], ["sdate", "Survey date (Zulu)", "d"], ["method", "How surveyed", "s", ["", "On the ground (walked)", "From the air", "Imagery and maps only"]],
      ["purpose", "Purpose / supported unit", "t"], ["owner", "Landowner / controlling agency, permission", "t"], ["access", "Access routes, gates, vehicle access", "a"], ["review", "Next review due", "d"]] },
    loc: { h: "Location", f: [["grid_obs", "Grid surveyed on the ground (if different)", "t"], ["elev_obs", "Elevation surveyed (m MSL)", "n"], ["mapref", "Map sheet / series", "t"], ["nav", "Nearest town or reference, distance and direction", "t"]] },
    dim: { h: "Dimensions", f: [["len_obs", "Usable length measured (m)", "n"], ["wid_obs", "Usable width measured (m)", "n"], ["dimnote", "How measured, limits of the usable area", "a"]] },
    surf: { h: "Surface", f: [["surf", "Surface type", "s", SURF], ["cond", "Condition (ruts, holes, rocks, stumps, debris)", "a"], ["soil", "Soil strength (DCP / CBR readings, where)", "a"], ["drain", "Drainage, standing water, after rain", "t"],
      ["veg", "Vegetation and its height", "t"], ["grad_l", "Gradient along the axis measured (%)", "n"], ["grad_t", "Gradient across measured (%)", "n"], ["dust", "Dust / brownout or whiteout risk", "s", ["", "Low", "Medium", "High"]]] },
    appr: { h: "Approach and departure", f: [["app_obs", "Approach obstructions seen", "a"], ["dep_obs", "Departure obstructions seen", "a"], ["clear", "Clearance plane clear", "s", YN], ["goaround", "Go-around / missed approach", "t"], ["wind", "Prevailing wind, local effects", "t"]] },
    dz: { h: "Drop zone", f: [["dztype", "DZ type", "s", ["", "Personnel", "CDS / container", "Heavy equipment", "Free fall (MFF)", "Combination"]], ["pi_mark", "PI and markings (code letter, panels, lights)", "a"], ["recovery", "Assembly, recovery and rally points", "a"],
      ["med", "Medical support and evacuation route", "a"], ["restrict", "Restrictions (populated areas, water, power lines, airspace)", "a"]] },
    hlz: { h: "Landing points", f: [["n_pts", "Number of landing points", "n"], ["pt_size", "Landing point size (m) and spacing", "t"], ["max_acft", "Largest aircraft the site takes", "t"], ["layout", "Landing point layout (heavy / light, formation)", "a"],
      ["wires", "Wires and poles in or round the site", "a"], ["night", "Night use (NVG, lighting, marking)", "t"]] },
    lz: { h: "Runway and airfield", f: [["rwy", "Runway designation / ICAO or local identifier", "t"], ["overrun", "Overruns (length, surface)", "t"], ["shoulder", "Shoulders and wingtip clearance", "t"], ["park", "Taxiways, parking, aircraft on the ground at once (MOG)", "a"],
      ["light", "Lighting (runway, approach, NVG)", "t"], ["navaid", "Navaids and approaches", "t"], ["fuel", "Fuel and services", "t"], ["comms", "Tower / ATC or LZ control frequency, hours", "t"]] },
    rem: { h: "Remarks", f: [["remarks", "Remarks", "a"]] }
  };
  function secsFor(k) { return ["site", "loc", "dim", "surf", "appr", k, "rem"]; }
  /* assumed obstacle heights (m) when OpenStreetMap gives none, the same planning heights the HLZ finder uses */
  var OB = { power: { n: "Power line", h: 20, c: "#d32f2f" }, mast: { n: "Mast or tower", h: 50, c: "#b71c1c" }, wind: { n: "Wind turbine", h: 100, c: "#b71c1c" },
    bldg: { n: "Building", h: 8, c: "#455a64" }, trees: { n: "Trees", h: 15, c: "#2e7d32" } };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function G() { return W.OSAP_GEO; }
  function grid(p) { var g = G(), m = g && p && g.mgrs(p[0], p[1], 5); return m || (p ? (+p[0]).toFixed(5) + ", " + (+p[1]).toFixed(5) : ""); }
  function cc() { return (W.TSAP && W.TSAP.country) || ""; }
  function toast(t) { if (W.OSAP_ATAK && W.OSAP_ATAK.toast) W.OSAP_ATAK.toast(t); }
  function dir3(d) { return ("00" + (Math.round(d) % 360)).slice(-3); }
  function fmtM(m) { return m < 1000 ? Math.round(m) + " m" : (m / 1000).toFixed(m < 10000 ? 1 : 0) + " km"; }
  function zt(ms) { var d = new Date(ms); return d.toISOString().slice(0, 16).replace("T", " ") + "Z"; }
  function stamp(ms) { return W.OSAP_TIME && W.OSAP_TIME.dualT ? W.OSAP_TIME.dualT(ms, { date: true }) : zt(ms); }
  function str(v, n) { return typeof v === "string" ? v.slice(0, n) : v == null ? "" : String(v).slice(0, n); }

  /* ---------- the store ---------- */
  function readAll() { try { var a = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function cleanRec(r) {
    if (!r || !/^sv[a-z0-9]{4,24}$/.test(r.id || "") || !KINDS[r.kind]) return null;
    var g = cleanG(r.g); if (!g) return null;
    var obs = {}, o = r.obs && typeof r.obs === "object" ? r.obs : {};
    Object.keys(o).slice(0, 80).forEach(function (k) { if (/^[a-z0-9_]{1,24}$/.test(k)) obs[k] = str(o[k], 2000); });
    var obst = (Array.isArray(r.obst) ? r.obst : []).slice(0, 60).map(function (x) {
      x = x || {}; var at = Array.isArray(x.at) && isFinite(+x.at[0]) && isFinite(+x.at[1]) ? [+(+x.at[0]).toFixed(6), +(+x.at[1]).toFixed(6)] : null;
      return { d: str(x.d, 200), h: x.h === "" || x.h == null || !isFinite(+x.h) ? "" : String(+x.h), at: at, note: str(x.note, 300) };
    });
    return { id: r.id, kind: r.kind, name: str(r.name, 80).trim() || KINDS[r.kind].s + " survey", cc: /^[a-z]{2,3}$/.test(r.cc || "") ? r.cc : "",
      dz_id: r.kind === "dz" && /^dz[a-z0-9]{4,24}$/.test(r.dz_id || "") ? r.dz_id : "", g: g, obs: obs, obst: obst,
      photos: (Array.isArray(r.photos) ? r.photos : []).filter(function (p) { return typeof p === "string" && /^[\w-]{1,60}$/.test(p); }).slice(0, 40),
      auto: r.auto && typeof r.auto === "object" ? r.auto : {}, status: r.status === "complete" ? "complete" : "draft",
      created: +r.created || Date.now(), updated: +r.updated || Date.now() };
  }
  function list() { return readAll().map(cleanRec).filter(Boolean); }
  function get(id) { return list().filter(function (r) { return r.id === id; })[0] || null; }
  function saveRec(r) {
    var c = cleanRec(Object.assign({}, r, { updated: Date.now() })); if (!c) return null;
    var a = list().filter(function (x) { return x.id !== c.id; }); a.push(c); if (a.length > MAX) a = a.slice(a.length - MAX);
    try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) { toast("Not saved: this browser's storage for OSAP is full."); return null; }
    D.dispatchEvent(new Event("osap:places")); return c;
  }
  function removeRec(id) { var a = list(), b = a.filter(function (x) { return x.id !== id; }); if (b.length !== a.length) { try { localStorage.setItem(KEY, JSON.stringify(b)); } catch (e) {} D.dispatchEvent(new Event("osap:places")); } }
  function newId() { var b = new Uint8Array(4); crypto.getRandomValues(b); return "sv" + Date.now().toString(36) + Array.prototype.map.call(b, function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); }

  /* a DZ survey's shape is the drop zone in OSAP_DZ: its centre is half its length from the leading edge, the PI pi_lead_m in */
  function DZS() { return W.OSAP_DZ; }
  function gFromDz(d) {
    if (d.shape === "circle") return cleanG({ c: d.pi, axis: d.axis, shape: "circle", len_m: d.len_m, wid_m: d.len_m });
    return cleanG({ c: toLL({ c: d.pi, axis: d.axis }, d.len_m / 2 - d.pi_lead_m, 0), axis: d.axis, shape: "rect", len_m: d.len_m, wid_m: d.wid_m });
  }
  function dzFromG(d, g) {
    var o = Object.assign({}, d, { axis: g.axis, shape: g.shape, len_m: g.len_m, wid_m: g.shape === "circle" ? d.wid_m : g.wid_m });
    if (g.shape === "circle") o.pi = g.c.slice();
    else { o.pi_lead_m = Math.min(+d.pi_lead_m || 0, g.len_m); o.pi = toLL(g, o.pi_lead_m - g.len_m / 2, 0).map(function (v) { return +v.toFixed(6); }); }
    return o;
  }

  var ST = { r: null, saved: false, dz: null, edit: true, arm: "", busy: { el: false, osm: false }, err: { el: "", osm: "" }, run: { el: 0, osm: 0 } };
  function geoKey(g) { return [g.c.join(","), g.axis, g.shape, g.len_m, g.wid_m].join("|"); }
  function newRec(o) {
    var k = KINDS[o.kind] ? o.kind : "hlz", K = KINDS[k], at = o.at;
    var g = cleanG({ c: at, axis: isFinite(+o.axis) ? +o.axis : 0, shape: o.shape || K.shape, len_m: +o.len || +o.size || K.len, wid_m: +o.wid || +o.size || K.wid });
    return { id: newId(), kind: k, name: o.name || K.s + " survey", cc: cc(), dz_id: "", g: g, obs: { sdate: new Date().toISOString().slice(0, 10) }, obst: [], photos: [], auto: o.finder ? { finder: o.finder } : {}, status: "draft", created: Date.now(), updated: Date.now() };
  }
  function keep() {
    var r = ST.r; if (!r) return;
    /* the DZ is written to the shared store once the survey is saved, or when it was a saved DZ already (the DZSO sheet's) */
    if (r.kind === "dz" && ST.dz && DZS()) {
      var d = dzFromG(ST.dz, r.g); d.name = d.name || r.name;
      if (ST.saved || (ST.dz.id && DZS().get(ST.dz.id))) { ST.self = true; var s = DZS().save(d); ST.self = false; if (s) { ST.dz = s; r.dz_id = s.id; } } else ST.dz = d;
    }
    if (!ST.saved) return;
    var c = saveRec(r); if (c) ST.r = c;
  }

  /* ---------- the map: the site's shape, its ends and corners, mapped obstacles, and handles to edit it ---------- */
  if (!map.getPane("srvpane")) { map.createPane("srvpane"); map.getPane("srvpane").style.zIndex = 668; }
  var rend = L.svg({ pane: "srvpane" }), layer = L.layerGroup().addTo(map), oLayer = L.layerGroup().addTo(map), hLayer = L.layerGroup().addTo(map), HS = {}, DRAG = null;
  function lbl(at, t, cls) { return L.marker(at, { pane: "srvpane", interactive: false, keyboard: false, icon: L.divIcon({ className: "svlbl" + (cls ? " " + cls : ""), html: "<span>" + esc(t) + "</span>", iconSize: [0, 0] }) }); }
  function drawShape() {
    layer.clearLayers(); if (!ST.r || !isOpen()) return;
    var g = ST.r.g, e = ends(g), o = { pane: "srvpane", renderer: rend, interactive: false }, K = KINDS[ST.r.kind];
    L.polygon(outline(g), Object.assign({ color: "#00e5ff", weight: 3, fillColor: "#00e5ff", fillOpacity: 0.1 }, o)).addTo(layer);
    var a0 = toLL(g, -g.len_m / 2 - Math.max(150, K.appr / 3), 0), b0 = toLL(g, g.len_m / 2 + Math.max(150, K.appr / 3), 0);
    L.polyline([a0, b0], Object.assign({ color: "#00e5ff", weight: 1.5, dashArray: "8 6" }, o)).addTo(layer);
    if (K.appr) [-1, 1].forEach(function (s) {
      var h = g.len_m / 2, w = (g.shape === "circle" ? g.len_m : g.wid_m) / 2, d = K.appr;
      L.polygon([toLL(g, s * h, -w), toLL(g, s * (h + d), -(w + d * 0.1)), toLL(g, s * (h + d), w + d * 0.1), toLL(g, s * h, w)], Object.assign({ color: "#00e5ff", weight: 1, opacity: 0.6, dashArray: "3 5", fill: false }, o)).addTo(layer);
    });
    lbl(e.a, "A approach", "a").addTo(layer); lbl(e.b, "B departure", "b").addTo(layer);
    e.corners.forEach(function (p, i) { L.circleMarker(p, Object.assign({ radius: 3.5, color: "#000", weight: 1, fillColor: "#00e5ff", fillOpacity: 1 }, o)).addTo(layer); lbl(p, String(i + 1), "n").addTo(layer); });
    L.circleMarker(g.c, Object.assign({ radius: 5, color: "#fff", weight: 2, fillColor: "#006064", fillOpacity: 1 }, o)).addTo(layer);
    lbl(g.c, K.s + ": " + ST.r.name, "c").addTo(layer);
  }
  function drawObst() {
    oLayer.clearLayers(); if (!ST.r || !isOpen()) return;
    var A = ST.r.auto.osm; (A && A.items || []).forEach(function (it) {
      var k = OB[it.k] || OB.bldg, m = it.line ? L.polyline(it.line, { pane: "srvpane", renderer: rend, color: k.c, weight: 2.5, opacity: 0.9 }) : L.circleMarker(it.at, { pane: "srvpane", renderer: rend, radius: 4, color: "#fff", weight: 1, fillColor: k.c, fillOpacity: 0.9 });
      m.bindTooltip(esc(k.n + (it.name ? ": " + it.name : "") + ", " + it.h + " m" + (it.hAssumed ? " (assumed)" : "") + (it.where ? ", " + it.where : "") + " (OpenStreetMap)"), { sticky: true }); m.addTo(oLayer);
    });
    ST.r.obst.forEach(function (x, i) { if (x.at) { L.circleMarker(x.at, { pane: "srvpane", renderer: rend, radius: 5, color: "#000", weight: 1.5, fillColor: "#ffab00", fillOpacity: 1, interactive: false }).addTo(oLayer); lbl(x.at, "Obstacle " + (i + 1) + (x.d ? ": " + x.d : ""), "o").addTo(oLayer); } });
  }
  function mpp() { return 40075016.686 * Math.cos(ST.r.g.c[0] * R) / Math.pow(2, map.getZoom() + 8); }
  function handles(g) {
    var out = [{ k: "mv", at: g.c, cls: "m", lbl: "Drag to move the site" }];
    if (g.shape === "circle") {
      out.push({ k: "rad", at: toLL(g, 0, g.len_m / 2), cls: "c", lbl: "Drag to change the diameter" });
      out.push({ k: "rot", at: toLL(g, -g.len_m / 2 - 50 * mpp(), 0), cls: "r", txt: "↻", lbl: "Drag to set the approach direction" });
    } else {
      out.push({ k: "a", at: toLL(g, -g.len_m / 2, 0), cls: "e", txt: "A", lbl: "Drag the approach end" });
      out.push({ k: "b", at: toLL(g, g.len_m / 2, 0), cls: "e", txt: "B", lbl: "Drag the departure end" });
      out.push({ k: "w", at: toLL(g, 0, g.wid_m / 2), cls: "c", lbl: "Drag to change the width" });
    }
    return out;
  }
  function drawHandles() {
    hLayer.clearLayers(); HS = {}; if (!ST.r || !isOpen() || !ST.edit) return;
    handles(ST.r.g).forEach(function (h) {
      var m = L.marker(h.at, { pane: "srvpane", keyboard: false, interactive: true, zIndexOffset: 1000, bubblingMouseEvents: false, icon: L.divIcon({ className: "svh svh-" + h.cls, html: h.txt || "", iconSize: [30, 30], iconAnchor: [15, 15] }) }).addTo(hLayer);
      var e = m.getElement(); e.setAttribute("data-svh", h.k); e.setAttribute("aria-label", h.lbl); e.title = h.lbl; HS[h.k] = m;
    });
  }
  function draw() { drawShape(); drawObst(); drawHandles(); }
  function r5(m) { return Math.round(m / 5) * 5; }
  /* one drag step from the shape as it was when the drag began (g0) and the point under the finger (p) */
  function dragTo(k, g0, p) {
    var g = ST.r.g;
    if (k === "mv") { g.c = [+p[0].toFixed(6), +p[1].toFixed(6)]; return grid(g.c); }
    if (k === "rot") { g.axis = Math.round(bearing(p, g0.c)) % 360; return "Approach from " + dir3(g.axis) + "° true heading"; }
    if (k === "rad") { g.len_m = g.wid_m = Math.max(10, Math.min(5000, r5(2 * dist(g0.c, p)))); return g.len_m + " m across"; }
    if (k === "w") { g.wid_m = Math.max(5, Math.min(20000, r5(2 * Math.abs(toUv(g0, p)[1])))); return g.len_m + " x " + g.wid_m + " m"; }
    /* an end moves; the other end stays put, so the axis turns and the length follows */
    var e0 = ends(g0), fix = k === "a" ? e0.b : e0.a, a = k === "a" ? p : fix, b = k === "a" ? fix : p, L0 = Math.max(10, Math.min(20000, r5(dist(a, b))));
    g.axis = Math.round(bearing(a, b)) % 360; g.len_m = L0;
    var mid = unlocal(a, local(a, b).map(function (v) { return v / 2; })); g.c = [+mid[0].toFixed(6), +mid[1].toFixed(6)];
    return g.len_m + " m, " + dir3(g.axis) + "° true";
  }
  function evPt(e) { var ll = map.mouseEventToLatLng(e); return [ll.lat, L.Util.wrapNum(ll.lng, [-180, 180], true)]; }
  function hDown(e) {
    var t = e.target.closest && e.target.closest("[data-svh]"); if (!t || !ST.r || !isOpen() || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault(); e.stopPropagation(); try { t.setPointerCapture(e.pointerId); } catch (x) {}
    DRAG = { k: t.getAttribute("data-svh"), id: e.pointerId, g0: JSON.parse(JSON.stringify(ST.r.g)), moved: false }; map.dragging.disable(); t.classList.add("on");
  }
  function hMove(e) {
    if (!DRAG || e.pointerId !== DRAG.id) return; e.preventDefault(); e.stopPropagation();
    var tip = dragTo(DRAG.k, DRAG.g0, evPt(e)); DRAG.moved = true; drawShape();
    handles(ST.r.g).forEach(function (h) { if (HS[h.k]) HS[h.k].setLatLng(h.at); });
    if (HS[DRAG.k]) HS[DRAG.k].getElement().title = tip;
    var tp = el && el.querySelector("[data-svtip]"); if (tp) tp.textContent = tip;
  }
  var hTapT = 0;
  function hUp(e) {
    if (!DRAG || e.pointerId !== DRAG.id) return; e.preventDefault(); e.stopPropagation();
    var d = DRAG; DRAG = null; map.dragging.enable(); hTapT = Date.now();
    if (!d.moved) { draw(); return; }
    ST.r.g = cleanG(ST.r.g); keep(); paint(); draw(); fill();
  }
  W.addEventListener("pointerdown", hDown, true); W.addEventListener("pointermove", hMove, true);
  W.addEventListener("pointerup", hUp, true); W.addEventListener("pointercancel", hUp, true);
  W.addEventListener("click", function (e) { if ((e.target.closest && e.target.closest("[data-svh]")) || Date.now() - hTapT < 400) { if (e.target.closest && e.target.closest("#srv")) return; e.preventDefault(); e.stopPropagation(); } }, true);
  W.addEventListener("touchstart", function (e) { if (e.target.closest && e.target.closest("[data-svh]")) { e.preventDefault(); e.stopPropagation(); } }, { capture: true, passive: false });
  W.addEventListener("contextmenu", function (e) { if (e.target.closest && e.target.closest("[data-svh]")) { e.preventDefault(); e.stopPropagation(); } }, true);
  map.on("zoomend", function () { if (ST.r && isOpen() && !DRAG) drawHandles(); });

  /* ---------- from sources: elevation, gradients, declination, mapped obstacles and aeroways ---------- */
  function fill(what) {
    var r = ST.r; if (!r) return;
    var g = r.g, key = geoKey(g), dec = G() && G().decl ? G().decl(g.c[0], g.c[1]) : null;
    r.auto.decl = isFinite(dec) && dec !== null ? { v: +dec.toFixed(1), src: "World Magnetic Model 2025 (NOAA / NGA)", at: Date.now() } : null;
    if (!what || what === "el") loadElev(key);
    if (!what || what === "osm") loadOsm(key);
  }
  function loadElev(key) {
    var r = ST.r, g = r.g, T = W.OSAP_TERRAIN_ANALYSIS, run = ++ST.run.el;
    if (!T || !T.elevationAt) { ST.err.el = "terrain analysis is not loaded on this page"; paint(); return; }
    var e = ends(g), w = (g.shape === "circle" ? g.len_m : g.wid_m) / 2, P = { c: g.c, a: e.a, b: e.b, l: toLL(g, 0, -w), rt: toLL(g, 0, w) }, ks = Object.keys(P);
    ST.busy.el = true; ST.err.el = ""; paint();
    Promise.all(ks.map(function (k) { return T.elevationAt(P[k][0], P[k][1]).catch(function () { return null; }); })).then(function (res) {
      if (run !== ST.run.el || !ST.r) return;
      var z = {}, src = {}, rs = null; res.forEach(function (x, i) { z[ks[i]] = x && x.elev_m != null ? +x.elev_m.toFixed(1) : null; if (x) { (x.sources || []).forEach(function (s) { src[s.label || s.id] = 1; }); if (x.res_m) rs = Math.round(x.res_m); } });
      if (z.c == null && z.a == null) { ST.err.el = "no elevation came back for this place"; return; }
      ST.r.auto.elev = { z: z, gl: grade(z.a, z.b, g.len_m), gt: grade(z.l, z.rt, 2 * w), src: Object.keys(src).join(", ") || "OSAP terrain sources", res: rs, at: Date.now(), key: key };
      keep();
    }).then(function () { if (run === ST.run.el) { ST.busy.el = false; paint(); } });
  }
  /* one OpenStreetMap ask through OSAP_OSM: tall obstacles in and round the site and along the approach and departure
     corridors, buildings and trees round the site, and aeroway features (runways, helipads, airfields) within 2 km */
  function osmBox(g, m) {
    var e = outline(g).concat([toLL(g, -g.len_m / 2 - m, 0), toLL(g, g.len_m / 2 + m, 0)]), la = e.map(function (p) { return p[0]; }), lo = e.map(function (p) { return p[1]; });
    var pad = (m + 200) / 111000; return [Math.min.apply(null, la) - pad * 0.3, Math.min.apply(null, lo) - pad * 0.3 / Math.cos(g.c[0] * R), Math.max.apply(null, la) + pad * 0.3, Math.max.apply(null, lo) + pad * 0.3 / Math.cos(g.c[0] * R)];
  }
  function osmQuery(r) {
    var g = r.g, K = KINDS[r.kind], far = osmBox(g, K.appr + 200), near = osmBox(g, 150), aer = osmBox(g, 2000);
    function env(b) { return "ST_MakeEnvelope(" + [b[1], b[0], b[3], b[2]].map(function (v) { return v.toFixed(5); }).join(",") + ",4326)"; }
    function sel(b, where, n) { return "(SELECT osm_type, osm_id, tags, ST_Intersection(geom, " + env(b) + ") AS geom FROM postpass_pointlinepolygon WHERE (" + where + ") AND geom && " + env(b) + " LIMIT " + n + ")"; }
    var tall = "tags->>'power' IN ('line','minor_line','cable') OR tags->>'man_made' IN ('mast','tower','communications_tower','chimney','water_tower') OR (tags->>'power' = 'generator' AND tags->>'generator:source' = 'wind')";
    var low = "tags ? 'building' OR tags->>'natural' IN ('wood','tree_row') OR tags->>'landuse' = 'forest'";
    var aero = "tags->>'aeroway' IN ('runway','helipad','aerodrome','heliport','airstrip','taxiway','apron')";
    function bb(b) { return "(" + b.map(function (v) { return v.toFixed(5); }).join(",") + ")"; }
    var sql = sel(far, tall, 800) + " UNION ALL " + sel(near, "(" + low + ") AND NOT (" + tall + ")", 2000) + " UNION ALL " + sel(aer, aero, 200);
    var ql = "[out:json][timeout:25];(way[\"power\"~\"^(line|minor_line|cable)$\"]" + bb(far) + ";nwr[\"man_made\"~\"^(mast|tower|communications_tower|chimney|water_tower)$\"]" + bb(far) + ";node[\"power\"=\"generator\"][\"generator:source\"=\"wind\"]" + bb(far) +
      ";way[\"building\"]" + bb(near) + ";nwr[\"natural\"~\"^(wood|tree_row)$\"]" + bb(near) + ";nwr[\"landuse\"=\"forest\"]" + bb(near) + ";nwr[\"aeroway\"~\"^(runway|helipad|aerodrome|heliport|airstrip|taxiway|apron)$\"]" + bb(aer) + ";);out geom 3000;";
    return { sql: W.OSAP_OSM && W.OSAP_OSM.crossesDateLine && W.OSAP_OSM.crossesDateLine([[0, aer[1]], [0, aer[3]]]) ? "" : sql, ql: ql };
  }
  function kindOf(t) {
    if (/^(line|minor_line|cable)$/.test(t.power || "")) return "power";
    if (t.power === "generator") return "wind";
    if (t.man_made) return "mast";
    if (t.building) return "bldg";
    if (t.natural || t.landuse === "forest") return "trees";
    return "";
  }
  function heightOf(t, k) { var h = parseFloat(t.height || t["building:height"] || ""); if (isFinite(h) && h > 0) return { h: h, a: false }; var lv = parseFloat(t["building:levels"] || ""); if (k === "bldg" && isFinite(lv) && lv > 0) return { h: lv * 3 + 1, a: false }; return { h: OB[k].h, a: true }; }
  function pts(e) { return e.geometry ? e.geometry.map(function (q) { return [q.lat, q.lon]; }) : isFinite(e.lat) ? [[e.lat, e.lon]] : e.center ? [[e.center.lat, e.center.lon]] : []; }
  /* each mapped obstacle: where it is against the site (inside, round it, on the approach or departure) and, on a corridor,
     whether it breaks the clearance plane */
  function analyseOsm(els, r) {
    var g = r.g, K = KINDS[r.kind], items = [], aero = [], seen = {};
    (els || []).forEach(function (e) {
      var t = e.tags || {}, P = pts(e); if (!P.length) return;
      if (t.aeroway) {
        var id0 = (e.type || "way") + "/" + String(e.id).replace(/^\w+\//, ""); if (seen[id0]) return; seen[id0] = 1;
        var ln = P.length > 1 ? dist(P[0], P[P.length - 1]) : 0, md = Math.min.apply(null, P.map(function (p) { return dist(g.c, p); }));
        aero.push({ kind: t.aeroway, name: t["name:en"] || t.name || "", ref: t.ref || "", icao: t.icao || "", surface: t.surface || "", len: t.length ? +t.length : t.aeroway === "runway" || t.aeroway === "airstrip" ? Math.round(ln) : null,
          wid: t.width ? +t.width : null, hd: P.length > 1 ? Math.round(bearing(P[0], P[P.length - 1])) : null, m: Math.round(md), url: "https://www.openstreetmap.org/" + (e.type || "way") + "/" + String(e.id).replace(/^\w+\//, "") });
        return;
      }
      var k = kindOf(t); if (!k) return;
      var hh = heightOf(t, k), best = null;
      /* the worst point of the feature: inside the site beats a corridor, a corridor point that breaks the plane beats one that does not */
      var samp = P.length > 1 ? densify(P, 25) : P;
      samp.forEach(function (p) {
        var c;
        if (inside(g, p, 0)) c = { where: "inside the site", rank: 3, at: p };
        else {
          var zz = K.appr ? zone(g, p, K.appr, 0.1) : null;
          if (zz) { var bad = penetrates(hh.h, zz.d, K.ratio); c = { where: (zz.z === "approach" ? "on the approach, " : "on the departure, ") + Math.round(zz.d) + " m out" + (bad ? ", breaks " + K.ratio + ":1" : ""), rank: bad ? 2.5 : 1.5, at: p, zone: zz.z, d: zz.d, bad: bad }; }
          else if (inside(g, p, 50)) c = { where: "within 50 m of the edge", rank: 2, at: p };
          else c = { where: "", rank: 0, at: p, m: dist(g.c, p) };
        }
        if (!best || c.rank > best.rank || (c.rank === best.rank && c.rank === 0 && c.m < best.m)) best = c;
      });
      if (!best || (best.rank === 0 && k !== "power" && k !== "mast" && k !== "wind")) return;
      if (best.rank === 0 && best.m > Math.max(g.len_m, 300) + K.appr) return;
      var id = (e.type || "way") + "/" + String(e.id).replace(/^\w+\//, "");
      if (seen[id]) return; seen[id] = 1;
      items.push({ k: k, name: t["name:en"] || t.name || "", h: Math.round(hh.h), hAssumed: hh.a, where: best.where || fmtM(best.m) + " " + dir3(bearing(g.c, best.at)) + "° from the centre", rank: best.rank, bad: !!best.bad,
        at: [+best.at[0].toFixed(6), +best.at[1].toFixed(6)], line: P.length > 1 && k === "power" ? P.map(function (p) { return [+p[0].toFixed(6), +p[1].toFixed(6)]; }) : null, url: "https://www.openstreetmap.org/" + id });
    });
    items.sort(function (a, b) { return b.rank - a.rank || (b.h - a.h); });
    aero.sort(function (a, b) { return a.m - b.m; });
    return { items: items.slice(0, 80), n: items.length, aero: aero.slice(0, 12) };
  }
  function densify(P, step) {
    var out = [P[0]];
    for (var i = 1; i < P.length; i++) { var d = dist(P[i - 1], P[i]), n = Math.min(80, Math.ceil(d / step)); for (var j = 1; j <= n; j++) out.push([P[i - 1][0] + (P[i][0] - P[i - 1][0]) * j / n, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * j / n]); }
    return out.length > 1500 ? out.filter(function (_, k) { return k % Math.ceil(out.length / 1500) === 0; }) : out;
  }
  function loadOsm(key) {
    var O = W.OSAP_OSM, run = ++ST.run.osm; if (!O) { ST.err.osm = "the OpenStreetMap reader is not loaded on this page"; paint(); return; }
    var q = osmQuery(ST.r); ST.busy.osm = true; ST.err.osm = ""; paint();
    O.query({ sql: q.sql, ql: q.ql }).then(function (j) {
      if (run !== ST.run.osm || !ST.r) return;
      var a = analyseOsm(j.elements, ST.r); a.via = j.via; a.dataAt = j.at; a.at = Date.now(); a.key = key; ST.r.auto.osm = a; keep();
    }, function (e) { if (run === ST.run.osm) ST.err.osm = (e && e.message) === "busy" ? "the OpenStreetMap servers were busy" : "the OpenStreetMap lookup failed (" + ((e && e.message) || "no answer") + ")"; })
      .then(function () { if (run === ST.run.osm) { ST.busy.osm = false; paint(); drawObst(); } });
  }

  /* ---------- the window ---------- */
  var el = null;
  var CSS =
    "#srv{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.45);overflow:auto;padding:16px}#srv[hidden]{display:none}" +
    "#srv .cbox{max-width:900px;margin:0 auto;background:var(--surface,#fff);color:var(--ink,#111);border-radius:8px;padding:10px 16px 16px;font-size:13px;line-height:1.45}" +
    "#srv .chead{display:flex;align-items:center;gap:8px;position:sticky;top:-16px;background:var(--surface,#fff);padding:6px 0;z-index:1;flex-wrap:wrap}#srv .chead h2{margin:0;font-size:16px;flex:1;min-width:12em}" +
    "#srv h3{font-size:13.5px;margin:14px 0 4px;padding-top:8px;border-top:1px solid var(--line,#ddd)}#srv p{margin:4px 0}#srv .obs{color:var(--muted,#555);font-size:12px}" +
    "#srv .tag{font-size:10.5px;border:1px solid var(--line,#bbb);border-radius:3px;padding:0 4px;color:var(--muted,#555);font-weight:400}" +
    "#srv .src{display:inline-block;font-size:10.5px;border-radius:3px;padding:0 4px;background:#e3f2fd;color:#0d47a1;font-weight:600;margin-right:4px}#srv .you{display:inline-block;font-size:10.5px;border-radius:3px;padding:0 4px;background:#fff3e0;color:#8a4b00;font-weight:600;margin-right:4px}" +
    "#srv .g{display:grid;grid-template-columns:minmax(11em,auto) 1fr;gap:5px 10px;align-items:start}#srv .g>span{color:var(--muted,#555);padding-top:4px}#srv .r{display:flex;flex-wrap:wrap;gap:5px 8px;align-items:center}" +
    "#srv button{font:inherit;font-size:12.5px;border:1px solid var(--line,#bbb);background:var(--surface,#fff);color:inherit;border-radius:5px;padding:3px 9px;min-height:30px;cursor:pointer}" +
    "#srv button.pri{background:#0b7285;border-color:#0b7285;color:#fff;font-weight:700}#srv button[aria-pressed=true]{background:var(--accent-soft,#e3f2f4);border-color:var(--accent,#0b7285)}" +
    "#srv input,#srv select,#srv textarea{font:inherit;font-size:12.5px;max-width:100%;box-sizing:border-box}#srv input[type=number]{width:6em}#srv .w{width:min(26em,100%)}#srv textarea{width:100%;min-height:2.6em}" +
    "#srv .pt{font-family:ui-monospace,Menlo,Consolas,monospace}#srv .tw{overflow-x:auto}#srv table{border-collapse:collapse;font-size:12px;width:100%}#srv th,#srv td{border-bottom:1px solid var(--line,#e2e2e2);padding:3px 5px;text-align:left;vertical-align:top;white-space:normal}" +
    "#srv th{font-weight:600;background:var(--surface2,#f4f6f8)}#srv .bad{color:#b71c1c;font-weight:600}#srv .ok{color:#2e7d32;font-weight:600}#srv .seg{display:flex;flex-wrap:wrap;gap:4px}" +
    "#srv .fv{display:flex;flex-direction:column;gap:2px}#srv .fv .fs{font-size:11.5px;color:var(--muted,#555)}#srv .ph{display:flex;flex-wrap:wrap;gap:6px}#srv .ph img{max-height:72px;max-width:110px;border-radius:4px}#srv .pt-th button{padding:0;border:0;min-height:0}" +
    "#srv .phr{border:1px solid var(--line,#ddd);border-radius:6px;padding:5px 8px;margin:4px 0}#srv .tip{font-weight:600;color:#006064}" +
    ".svh{border-radius:50%;background:#fff;border:2px solid #006064;box-shadow:0 1px 4px rgba(0,0,0,.5);touch-action:none;cursor:grab;display:flex;align-items:center;justify-content:center;font:700 14px/1 system-ui,sans-serif;color:#006064;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}" +
    ".svh.svh-c{border-radius:5px;width:18px!important;height:18px!important;margin:-9px 0 0 -9px!important;background:#00e5ff;border-color:#000}.svh.svh-m{background:transparent;border:2px dashed #fff;box-shadow:0 0 0 1px rgba(0,0,0,.6);cursor:move}.svh.on{outline:3px solid #0b7285}" +
    ".svlbl span{display:inline-block;transform:translate(8px,-50%);white-space:nowrap;font:600 11px/1.2 system-ui,sans-serif;background:rgba(0,0,0,.72);color:#00e5ff;border-radius:3px;padding:1px 4px}.svlbl.o span{color:#ffab00}.svlbl.n span{transform:translate(5px,-110%);font-size:10px}" +
    "@media (max-width:700px){#srv{padding:6px}#srv .g{grid-template-columns:1fr;gap:2px 0}#srv .g>span{margin-top:6px;font-size:12px}}" +
    ".svp h2{font-size:14px;margin:10px 0 4px}.svp table{border-collapse:collapse;width:100%;font-size:9.5px;table-layout:fixed}.svp th,.svp td{border:1px solid #bbb;padding:2px 4px;text-align:left;vertical-align:top;white-space:normal;overflow-wrap:anywhere}.svp th{background:#eef1f4}" +
    ".svp p{margin:3px 0;font-size:10px}.svp svg{width:100%;max-width:640px;height:auto;border:1px solid #bbb}.svp .ph{display:flex;flex-wrap:wrap;gap:6px}.svp .ph img{max-height:150px;max-width:220px}";
  function ensure() {
    if (el) return el;
    if (!D.getElementById("srv-css")) { var st = D.createElement("style"); st.id = "srv-css"; st.textContent = CSS; D.head.appendChild(st); }
    el = D.createElement("div"); el.id = "srv"; el.hidden = true; el.setAttribute("role", "dialog"); el.setAttribute("aria-labelledby", "srv-h");
    el.innerHTML = '<div class="cbox"></div>'; D.body.appendChild(el);
    el.addEventListener("click", onClick); el.addEventListener("change", onChange); el.addEventListener("input", onInput);
    el.addEventListener("click", function (e) { if (e.target === el) close(); });
    el.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    if (W.OSAP_SPLIT) W.OSAP_SPLIT.add(el, ".chead");
    D.addEventListener("osap:split", function () { if (isOpen()) paint(); });
    if (DZS()) DZS().on(function (id) {
      /* the DZSO sheet moved or resized the same DZ: follow it */
      if (ST.self || !isOpen() || !ST.r || ST.r.kind !== "dz" || !ST.dz || !ST.dz.id || (id && id !== ST.dz.id) || DRAG) return;
      var d = DZS().get(ST.dz.id); if (d && d.updated > (ST.dz.updated || 0)) { ST.dz = d; var g = gFromDz(d); if (g && geoKey(g) !== geoKey(ST.r.g)) { ST.r.g = g; if (ST.saved) { var c = saveRec(ST.r); if (c) ST.r = c; } paint(); draw(); } }
    });
    return el;
  }
  function isOpen() { return !!el && !el.hidden; }
  function srcTag(t) { return '<span class="src" title="Looked up by OSAP from the source named, not surveyed">From sources</span>' + (t ? '<span class="obs">' + esc(t) + "</span>" : ""); }
  function youTag() { return '<span class="you" title="What the surveyor entered or drew">Surveyed</span>'; }
  function input(k, f, v) {
    var t = f[2], o = ' data-o="' + k + '" aria-label="' + esc(f[1]) + '"';
    if (t === "a") return "<textarea" + o + ' rows="2" maxlength="2000">' + esc(v) + "</textarea>";
    if (t === "s") return "<select" + o + ">" + f[3].map(function (x) { return '<option value="' + esc(x) + '"' + (x === v ? " selected" : "") + ">" + esc(x || "Not set") + "</option>"; }).join("") + "</select>";
    if (t === "n") return '<input type="number" step="any"' + o + ' value="' + esc(v) + '">';
    if (t === "d") return '<input type="date"' + o + ' value="' + esc(v) + '">';
    return '<input type="text" class="w"' + o + ' maxlength="300" value="' + esc(v) + '">';
  }
  /* what OSAP found from sources for a field, shown under the surveyor's own value */
  function autoFor(k) {
    var r = ST.r, A = r.auto, E = A.elev, F = A.finder, rw = A.osm && A.osm.aero && A.osm.aero.filter(function (x) { return /runway|airstrip/.test(x.kind); })[0];
    if (k === "elev_obs" && E && E.z.c != null) return Math.round(E.z.c) + " m (" + Math.round(E.z.c / FT) + " ft) MSL at the centre; " + E.src + (E.res ? ", about " + E.res + " m detail" : "");
    if (k === "grad_l" && E && E.gl != null) return E.gl.toFixed(1) + "% A to B (" + Math.round(E.z.a) + " to " + Math.round(E.z.b) + " m)";
    if (k === "grad_t" && E && E.gt != null) return E.gt.toFixed(1) + "% left to right";
    if (k === "surf") return [F && F.surface ? "HLZ finder: " + F.surface : "", F && F.cover ? "land cover: " + F.cover : "", rw && rw.surface ? "OpenStreetMap " + rw.kind + ": " + rw.surface : ""].filter(Boolean).join("; ");
    if (k === "len_obs" && rw && rw.len) return "OpenStreetMap " + rw.kind + (rw.ref ? " " + rw.ref : "") + ": " + rw.len + " m" + (rw.m > 50 ? " (" + fmtM(rw.m) + " from the centre)" : "");
    if (k === "wid_obs" && rw && rw.wid) return "OpenStreetMap " + rw.kind + ": " + rw.wid + " m";
    if (k === "rwy" && rw && (rw.ref || rw.name || rw.icao)) return "OpenStreetMap: " + [rw.ref, rw.name, rw.icao].filter(Boolean).join(", ");
    if (k === "max_acft" && F && F.craft) return "HLZ finder: " + F.craft;
    if (k === "clear" && F && F.appr) return "HLZ finder (10:1): " + F.appr;
    return "";
  }
  function fieldRows(sec) {
    var r = ST.r;
    return SECS[sec].f.map(function (f) { var a = autoFor(f[0]); return "<span>" + esc(f[1]) + '</span><div class="fv">' + input(f[0], f, r.obs[f[0]] || "") + (a ? '<div class="fs">' + srcTag() + esc(a) + "</div>" : "") + "</div>"; }).join("");
  }
  function paint() {
    if (!el || !ST.r) return;
    var r = ST.r, K = KINDS[r.kind], box = el.querySelector(".cbox"), sc = box.scrollTop, g = r.g, e = ends(g), A = r.auto;
    var dec = A.decl && A.decl.v, mag = function (t) { return dec != null ? dir3((((t - dec) % 360) + 360) % 360) + "° mag" : ""; };
    var h = '<div class="chead"><h2 id="srv-h">Site survey: ' + esc(r.name) + ' <span class="tag" tabindex="0" title="The surveyor\'s own record. OSAP\'s own worksheet modelled on the standard survey forms; not the official form, not analyst-approved and not AI.">' + (r.status === "complete" ? "Complete" : "Draft") + "</span></h2>" +
      '<button type="button" data-sv="pdf">Export PDF</button>' + (W.OSAP_SPLIT ? W.OSAP_SPLIT.btn() : "") + '<button type="button" class="x" data-sv="close">Close</button></div>';
    h += '<p class="obs">' + esc(K.n) + ": " + esc(K.form) + ". " + youTag() + " is what you enter or draw; " + srcTag() + " is what OSAP looked up for your shape, with its source. They are kept apart and only you change the survey.</p>";
    var saved = list();
    h += '<div class="g"><span>Site</span><div class="r"><input class="w" data-f="name" maxlength="80" value="' + esc(r.name) + '" aria-label="Site name">' +
      (ST.saved ? '<span class="ok">Saved in My places</span>' : '<button type="button" class="pri" data-sv="save">Save survey</button>') + "</div>" +
      '<span>Kind</span><div class="r"><select data-f="kind"' + (ST.saved ? ' disabled title="A saved survey keeps its kind"' : "") + ">" + Object.keys(KINDS).map(function (k) { return '<option value="' + k + '"' + (k === r.kind ? " selected" : "") + ">" + esc(KINDS[k].n) + "</option>"; }).join("") + "</select></div>" +
      (saved.length ? '<span>Open a saved survey</span><div><select data-f="pick"><option value="">Choose…</option>' + saved.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === r.id ? " selected" : "") + ">" + esc(KINDS[x.kind].s + ": " + x.name) + "</option>"; }).join("") + "</select></div>" : "") +
      "<span>Status</span><div class=\"r\"><select data-f=\"status\"><option value=\"draft\"" + (r.status === "draft" ? " selected" : "") + '>Draft</option><option value="complete"' + (r.status === "complete" ? " selected" : "") + ">Complete (surveyor's call)</option></select></div></div>";
    /* the shape */
    h += "<h3>" + youTag() + "Shape on the map</h3>" +
      '<div class="r"><button type="button" data-sv="edit" aria-pressed="' + ST.edit + '">Edit on map</button><button type="button" data-sv="tapc" aria-pressed="' + (ST.arm === "c") + '">' + (ST.arm === "c" ? "Tap the map…" : "Move centre: tap the map") + '</button><button type="button" data-sv="show">Show on map</button>' +
      '<input class="w" style="width:14em" data-f="grid" placeholder="Centre as MGRS or lat, lon" aria-label="Centre as MGRS or lat, lon"><button type="button" data-sv="grid">Set</button></div>' +
      '<p class="obs">Drag A and B to set the ends (the axis turns with them), the square to change the width' + (g.shape === "circle" ? ", the edge square for the diameter, the turn handle for the approach direction" : "") + ', the dashed ring to move it. <span data-svtip class="tip"></span></p>' +
      '<div class="g"><span>Shape</span><div class="r"><select data-f="shape"><option value="rect"' + (g.shape === "rect" ? " selected" : "") + '>Rectangle</option><option value="circle"' + (g.shape === "circle" ? " selected" : "") + ">Circle</option></select>" +
      (g.shape === "circle" ? '<label>Diameter <input type="number" min="10" max="5000" data-f="len_m" value="' + g.len_m + '"> m</label>' : '<label>Length <input type="number" min="10" max="20000" data-f="len_m" value="' + g.len_m + '"> m</label><label>Width <input type="number" min="5" max="20000" data-f="wid_m" value="' + g.wid_m + '"> m</label>') +
      '<span class="obs">' + Math.round(g.len_m / FT) + (g.shape === "circle" ? " ft across" : " x " + Math.round(g.wid_m / FT) + " ft") + "</span></div>" +
      "<span>" + (r.kind === "dz" ? "Run-in axis" : "Landing direction (A to B)") + '</span><div class="r"><input type="number" min="0" max="359" data-f="axis" value="' + Math.round(g.axis) + '">° true' + (mag(g.axis) ? " = " + mag(g.axis) : "") + " · reciprocal " + dir3(g.axis + 180) + "° true" + (mag(g.axis + 180) ? " / " + mag(g.axis + 180) : "") + "</div>" +
      (r.kind === "dz" && ST.dz && g.shape === "rect" ? '<span>PI from the leading edge</span><div class="r"><input type="number" min="0" max="20000" data-f="pi_lead" value="' + Math.round(ST.dz.pi_lead_m || 0) + '"> m · PI <span class="pt">' + esc(grid(dzFromG(ST.dz, g).pi)) + "</span>" + (ST.dz.id ? ' <button type="button" data-sv="dzso">Open the DZSO sheet</button>' : "") + "</div>" : "") +
      "</div>";
    /* grids: worked out from the shape */
    h += "<h3>Coordinates (worked out from your shape)</h3><div class=\"tw\"><table><thead><tr><th>Point</th><th>MGRS</th><th>Lat, lon</th><th>Elevation " + srcTag() + "</th></tr></thead><tbody>";
    var E = A.elev && A.elev.key === geoKey(g) ? A.elev : null;
    function row(n, p, z) { return "<tr><td>" + esc(n) + '</td><td class="pt">' + esc(grid(p)) + "</td><td>" + p[0].toFixed(5) + ", " + p[1].toFixed(5) + "</td><td>" + (z != null ? Math.round(z) + " m / " + Math.round(z / FT) + " ft" : "-") + "</td></tr>"; }
    h += row("Centre", g.c, E && E.z.c) + row("A, approach end", e.a, E && E.z.a) + row("B, departure end", e.b, E && E.z.b) + e.corners.map(function (p, i) { return row("Corner " + (i + 1), p, null); }).join("") + "</tbody></table></div>";
    h += '<p class="obs">' + (ST.busy.el ? "Reading elevation…" : ST.err.el ? '<span class="bad">Elevation: ' + esc(ST.err.el) + "</span>" : E ? "Elevation: " + esc(E.src) + (E.res ? ", about " + E.res + " m detail" : "") + ", read " + esc(stamp(E.at)) + ". Gradient worked out end to end " + (E.gl != null ? E.gl.toFixed(1) + "%" : "-") + ", side to side " + (E.gt != null ? E.gt.toFixed(1) + "%" : "-") + " (model terrain, not a measured grade)." : A.elev ? "The shape changed: press Refresh from sources." : "") +
      (A.decl ? " Declination " + Math.abs(A.decl.v).toFixed(1) + "° " + (A.decl.v >= 0 ? "E" : "W") + " (WMM2025)." : "") + ' <button type="button" data-sv="refresh">Refresh from sources</button></p>';
    if (A.finder) { var F = A.finder; h += '<p class="obs">' + srcTag("HLZ finder (computer search, " + esc(stamp(F.at || r.created)) + "):") + " " + esc([F.clearD ? "clear about " + F.clearD + " m across" : "", F.slope != null ? "slope " + F.slope + "° avg" + (F.smax != null ? ", " + F.smax + "° max" : "") : "", F.elev != null ? "elevation " + F.elev + " m" : "", F.appr ? "approach " + F.appr : "", F.near ? "nearest obstacle " + F.near : ""].filter(Boolean).join(" · ")) + "</p>"; }
    secsFor(r.kind).forEach(function (s) {
      h += "<h3>" + youTag() + esc(SECS[s].h) + '</h3><div class="g">' + fieldRows(s) + "</div>";
      if (s === "surf") h += secObst();
    });
    h += secPhotos();
    h += '<h3>Delete</h3><p>' + (ST.saved ? '<button type="button" data-sv="del">Delete this survey</button> <span class="obs">Removes the survey only' + (r.kind === "dz" ? "; the drop zone stays for the DZSO sheet and flight planner" : "") + ". Photos stay as map points.</span>" : '<span class="obs">Not saved yet.</span>') + "</p>";
    h += '<p class="obs">Sources: elevation from OSAP\'s terrain sources (AWS Terrain Tiles and others listed); obstacles and aeroways &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors (ODbL), only what is mapped; declination WMM2025. Heights marked assumed are planning heights by kind. Ground truth is what the surveyor records.</p>';
    box.innerHTML = h; box.scrollTop = sc;
    Array.prototype.forEach.call(box.querySelectorAll("[data-thumb]"), function (c) { if (W.OSAP_POINTS && W.OSAP_POINTS.thumbs) W.OSAP_POINTS.thumbs(c, c.getAttribute("data-thumb")); });
  }
  function secObst() {
    var r = ST.r, K = KINDS[r.kind], O = r.auto.osm, cur = O && O.key === geoKey(r.g);
    var h = "<h3>" + youTag() + 'Obstacles you recorded</h3><div class="tw"><table><thead><tr><th>#</th><th>What</th><th>Height (m)</th><th>Grid</th><th>Where</th><th></th></tr></thead><tbody>' +
      (r.obst.length ? r.obst.map(function (x, i) {
        var w = ""; if (x.at) { var zz = K.appr ? zone(r.g, x.at, K.appr, 0.1) : null; w = inside(r.g, x.at, 0) ? "inside the site" : zz ? zz.z + ", " + Math.round(zz.d) + " m out" + (penetrates(+x.h, zz.d, K.ratio) ? ' <b class="bad">breaks ' + K.ratio + ":1</b>" : "") : fmtM(dist(r.g.c, x.at)) + " " + dir3(bearing(r.g.c, x.at)) + "°"; }
        return "<tr><td>" + (i + 1) + '</td><td><input data-ob="d" data-i="' + i + '" value="' + esc(x.d) + '" maxlength="200" aria-label="Obstacle ' + (i + 1) + '"></td><td><input type="number" min="0" step="any" data-ob="h" data-i="' + i + '" value="' + esc(x.h) + '" aria-label="Height"></td>' +
          '<td><input data-ob="g" data-i="' + i + '" value="' + esc(x.at ? grid(x.at) : "") + '" placeholder="MGRS" aria-label="Grid" style="width:12em"> <button type="button" data-sv="obtap" data-i="' + i + '" aria-pressed="' + (ST.arm === "o" + i) + '">' + (ST.arm === "o" + i ? "Tap…" : "Tap map") + "</button></td><td>" + w + '</td><td><button type="button" data-sv="obdel" data-i="' + i + '" aria-label="Remove obstacle ' + (i + 1) + '">Remove</button></td></tr>';
      }).join("") : '<tr><td colspan="6" class="obs">None recorded yet.</td></tr>') + '</tbody></table></div><p><button type="button" data-sv="obadd">Add an obstacle</button></p>';
    h += "<h3>" + srcTag() + "Mapped obstacles (OpenStreetMap)</h3>";
    if (ST.busy.osm) h += '<p class="obs">Asking OpenStreetMap…</p>';
    else if (ST.err.osm) h += '<p class="bad">' + esc(ST.err.osm) + '. This is a failure, not "no obstacles".</p>';
    if (O) {
      h += '<p class="obs">' + (cur ? "" : "<b>For an earlier shape: press Refresh from sources.</b> ") + O.n + " mapped in and round the site" + (K.appr ? " and along " + K.appr + " m approach and departure corridors (" + K.ratio + ":1 check, heights above the site's ground)" : "") + "; " + esc(O.via || "") + ", " + esc(stamp(O.at)) + ".</p>";
      if (O.items.length) h += '<div class="tw"><table><thead><tr><th>Obstacle</th><th>Height</th><th>Where</th><th>Source</th></tr></thead><tbody>' + O.items.slice(0, 30).map(function (it) {
        return "<tr><td>" + esc((OB[it.k] || OB.bldg).n + (it.name ? ": " + it.name : "")) + "</td><td>" + it.h + " m" + (it.hAssumed ? " (assumed)" : "") + "</td><td" + (it.bad || it.rank >= 3 ? ' class="bad"' : "") + ">" + esc(it.where) + '</td><td><a href="' + esc(it.url) + '" target="_blank" rel="noopener">OSM</a></td></tr>';
      }).join("") + "</tbody></table></div>" + (O.items.length > 30 ? '<p class="obs">' + (O.items.length - 30) + " more on the map.</p>" : "");
      if (O.aero.length) h += '<p class="obs"><b>Mapped aeroways within 2 km:</b> ' + O.aero.map(function (a) { return esc(a.kind + (a.ref ? " " + a.ref : "") + (a.name ? " " + a.name : "") + (a.len ? ", " + a.len + " m" : "") + (a.wid ? " x " + a.wid + " m" : "") + (a.surface ? ", " + a.surface : "") + (a.hd != null ? ", " + dir3(a.hd) + "°" : "") + ", " + fmtM(a.m) + " away"); }).join("; ") + "</p>";
    }
    return h;
  }
  function photoPts() { var A = W.OSAP_ATAK; return A && A.pts && A.pts.all ? A.pts.all() : []; }
  function secPhotos() {
    var r = ST.r, all = photoPts(), at = r.photos.map(function (id) { return all.filter(function (p) { return p.id === id; })[0]; }).filter(Boolean);
    var near = all.filter(function (p) { return r.photos.indexOf(p.id) < 0 && (p.src === "photo" || p.ph > 0) && dist(r.g.c, [p.lat, p.lon]) <= Math.max(1000, r.g.len_m + 500); });
    var h = "<h3>" + youTag() + "Photos</h3>";
    h += at.length ? at.map(function (p) { return '<div class="phr"><b>' + esc(p.n || "Photo point") + '</b> <span class="pt">' + esc(grid([p.lat, p.lon])) + "</span>" + (isFinite(p.az) && p.az !== null ? " · facing " + dir3(p.az) + "°" + (p.azRef === "true" ? " true" : " mag") : "") + ' <button type="button" data-sv="phdel" data-id="' + esc(p.id) + '">Detach</button><div class="ph" data-thumb="' + esc(p.id) + '"></div></div>'; }).join("") : '<p class="obs">No photos attached.</p>';
    h += '<p class="r"><button type="button" data-sv="snap">Take a photo here</button><span class="obs">Photos are saved as map points with grid and heading (Point > Take a photo here), then attached here.</span></p>';
    if (near.length) h += '<p class="obs">Photo points near the site:</p>' + near.slice(0, 20).map(function (p) { return '<div class="r"><button type="button" data-sv="phadd" data-id="' + esc(p.id) + '">Attach</button>' + esc(p.n || "Photo point") + " · " + fmtM(dist(r.g.c, [p.lat, p.lon])) + " from the centre</div>"; }).join("");
    return h;
  }

  /* ---------- the PDF ---------- */
  function diagram() {
    var r = ST.r, g = r.g, K = KINDS[r.kind], Wd = 640, Hd = 420, pad = 18, ext = Math.max(g.len_m / 2 + Math.max(K.appr / 3, 100), g.wid_m), s = Math.min((Wd - 2 * pad) / (2 * ext), (Hd - 2 * pad) / (2 * ext));
    function X(xy) { return (Wd / 2 + xy[0] * s).toFixed(1); } function Y(xy) { return (Hd / 2 - xy[1] * s).toFixed(1); }
    function P(p) { var q = local(g.c, p); return [X(q), Y(q)]; }
    function pl(a) { return a.map(function (p) { return P(p).join(","); }).join(" "); }
    var e = ends(g), out = '<svg viewBox="0 0 ' + Wd + " " + Hd + '" xmlns="http://www.w3.org/2000/svg" font-family="system-ui,sans-serif" font-size="11"><rect width="' + Wd + '" height="' + Hd + '" fill="#f7f8f6"/>';
    if (K.appr) [-1, 1].forEach(function (sg) { var h = g.len_m / 2, w = (g.shape === "circle" ? g.len_m : g.wid_m) / 2, d = ext; out += '<polygon points="' + pl([toLL(g, sg * h, -w), toLL(g, sg * (h + d), -(w + d * 0.1)), toLL(g, sg * (h + d), w + d * 0.1), toLL(g, sg * h, w)]) + '" fill="none" stroke="#0097a7" stroke-dasharray="3 4"/>'; });
    var O = r.auto.osm; (O && O.items || []).forEach(function (it) { var k = OB[it.k] || OB.bldg, q = local(g.c, it.at); if (Math.abs(q[0]) > ext * 1.2 || Math.abs(q[1]) > ext * 1.2) return; var c = P(it.at); out += it.line ? '<polyline fill="none" stroke="' + k.c + '" stroke-width="2" points="' + pl(it.line.filter(function (p) { var z = local(g.c, p); return Math.abs(z[0]) < ext * 1.5 && Math.abs(z[1]) < ext * 1.5; })) + '"/>' : '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="2.6" fill="' + k.c + '"/>'; });
    out += '<polygon points="' + pl(outline(g)) + '" fill="#00bcd4" fill-opacity=".18" stroke="#00838f" stroke-width="2.2"/>';
    var a = P(e.a), b = P(e.b), c0 = P(g.c);
    out += '<line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '" stroke="#00838f" stroke-dasharray="6 4"/><text x="' + a[0] + '" y="' + (+a[1] - 6) + '" font-weight="700" stroke="#fff" stroke-width="3" paint-order="stroke">A</text><text x="' + b[0] + '" y="' + (+b[1] - 6) + '" font-weight="700" stroke="#fff" stroke-width="3" paint-order="stroke">B</text>';
    e.corners.forEach(function (p, i) { var q = P(p); out += '<text x="' + (+q[0] + 3) + '" y="' + (+q[1] - 3) + '" font-size="9" stroke="#fff" stroke-width="3" paint-order="stroke">' + (i + 1) + "</text>"; });
    r.obst.forEach(function (x, i) { if (!x.at) return; var q = P(x.at); out += '<circle cx="' + q[0] + '" cy="' + q[1] + '" r="4" fill="#ffab00" stroke="#000"/><text x="' + (+q[0] + 6) + '" y="' + (+q[1] + 4) + '" font-size="9" stroke="#fff" stroke-width="3" paint-order="stroke">O' + (i + 1) + "</text>"; });
    out += '<circle cx="' + c0[0] + '" cy="' + c0[1] + '" r="4" fill="#006064" stroke="#fff"/>';
    out += '<rect x="' + (Wd - 34) + '" y="6" width="28" height="46" rx="3" fill="#fff" fill-opacity=".85"/><path d="M' + (Wd - 26) + " 46 L" + (Wd - 20) + " 26 L" + (Wd - 14) + ' 46 Z" fill="#333"/><text x="' + (Wd - 24) + '" y="20" font-weight="700">N</text>';
    var bar = [50, 100, 200, 250, 500, 1000, 2000].filter(function (m) { return m * s <= Wd / 4; }).pop() || 50;
    out += '<line x1="' + pad + '" y1="' + (Hd - pad) + '" x2="' + (pad + bar * s).toFixed(1) + '" y2="' + (Hd - pad) + '" stroke="#333" stroke-width="3"/><text x="' + pad + '" y="' + (Hd - pad - 6) + '">' + fmtM(bar) + "</text>";
    return out + "</svg>";
  }
  function printSheet() {
    var r = ST.r, K = KINDS[r.kind], g = r.g, e = ends(g), A = r.auto, E = A.elev && A.elev.key === geoKey(g) ? A.elev : null, d = D.createElement("div"); d.className = "svp";
    var dec = A.decl && A.decl.v;
    function m(t) { return dec != null ? " / " + dir3((((t - dec) % 360) + 360) % 360) + "° mag" : ""; }
    function tr(a) { return "<tr>" + a.map(function (x) { return "<td>" + x + "</td>"; }).join("") + "</tr>"; }
    var h = "<p>" + esc(K.n) + " survey. OSAP's own worksheet with the fields of the " + esc(K.form) + "; not the official form. Status: <b>" + (r.status === "complete" ? "Complete (surveyor's call)" : "Draft") + "</b>. Surveyed values are the surveyor's own; values marked From sources were looked up by OSAP and are not surveyed. Not analyst-approved, not AI.</p>";
    h += "<h2>Site</h2><table><tbody>" + tr(["Name", esc(r.name)]) + tr(["Kind", esc(K.n)]) + tr(["Shape (surveyed)", g.shape === "circle" ? "Circle " + g.len_m + " m (" + Math.round(g.len_m / FT) + " ft) across" : g.len_m + " x " + g.wid_m + " m (" + Math.round(g.len_m / FT) + " x " + Math.round(g.wid_m / FT) + " ft)"]) +
      tr([r.kind === "dz" ? "Run-in axis" : "Landing direction A to B", Math.round(g.axis) + "° true" + m(g.axis) + "; reciprocal " + dir3(g.axis + 180) + "° true" + m(g.axis + 180)]) +
      (r.kind === "dz" && ST.dz && g.shape === "rect" ? tr(["PI", esc(grid(dzFromG(ST.dz, g).pi)) + ", " + Math.round(ST.dz.pi_lead_m) + " m from the leading edge"]) : "") +
      (A.decl ? tr(["Declination (From sources)", Math.abs(A.decl.v).toFixed(1) + "° " + (A.decl.v >= 0 ? "E" : "W") + ", WMM2025"]) : "") + "</tbody></table>";
    h += "<h2>Coordinates</h2><table><thead><tr><th>Point</th><th>MGRS</th><th>Lat, lon</th><th>Elevation (From sources)</th></tr></thead><tbody>";
    function row(n, p, z) { return tr([esc(n), esc(grid(p)), p[0].toFixed(5) + ", " + p[1].toFixed(5), z != null ? Math.round(z) + " m / " + Math.round(z / FT) + " ft" : "-"]); }
    h += row("Centre", g.c, E && E.z.c) + row("A, approach end", e.a, E && E.z.a) + row("B, departure end", e.b, E && E.z.b) + e.corners.map(function (p, i) { return row("Corner " + (i + 1), p, null); }).join("") + "</tbody></table>";
    if (E) h += "<p>Elevation " + esc(E.src) + (E.res ? ", about " + E.res + " m detail" : "") + ", read " + esc(stamp(E.at)) + ". Model gradient end to end " + (E.gl != null ? E.gl.toFixed(1) + "%" : "-") + ", side to side " + (E.gt != null ? E.gt.toFixed(1) + "%" : "-") + ".</p>";
    h += "<h2>Diagram (north up)</h2>" + diagram();
    if (A.finder) { var F = A.finder; h += "<p>HLZ finder (From sources, computer search): " + esc([F.clearD ? "clear about " + F.clearD + " m" : "", F.slope != null ? "slope " + F.slope + "° avg" : "", F.appr ? "approach " + F.appr : "", F.surface ? "surface " + F.surface : ""].filter(Boolean).join("; ")) + ".</p>"; }
    secsFor(r.kind).forEach(function (s) {
      h += "<h2>" + esc(SECS[s].h) + '</h2><table><colgroup><col style="width:32%"><col style="width:40%"><col style="width:28%"></colgroup><thead><tr><th>Item</th><th>Surveyed</th><th>From sources (not surveyed)</th></tr></thead><tbody>' +
        SECS[s].f.map(function (f) { return tr([esc(f[1]), esc(r.obs[f[0]] || "________________"), esc(autoFor(f[0]) || "")]); }).join("") + "</tbody></table>";
      if (s === "surf") {
        h += "<h2>Obstacles recorded by the surveyor</h2><table><thead><tr><th>#</th><th>What</th><th>Height</th><th>Grid</th></tr></thead><tbody>" + (r.obst.length ? r.obst.map(function (x, i) { return tr(["O" + (i + 1), esc(x.d), x.h ? esc(x.h) + " m" : "-", x.at ? esc(grid(x.at)) : "-"]); }).join("") : tr(["-", "None recorded", "", ""])) + "</tbody></table>";
        var O = A.osm; if (O && O.items.length) h += "<h2>Mapped obstacles (From sources: OpenStreetMap, " + esc(stamp(O.at)) + ")</h2><table><thead><tr><th>Obstacle</th><th>Height</th><th>Where</th><th>Source</th></tr></thead><tbody>" + O.items.slice(0, 30).map(function (it) { return tr([esc((OB[it.k] || OB.bldg).n + (it.name ? ": " + it.name : "")), it.h + " m" + (it.hAssumed ? " (assumed)" : ""), esc(it.where), esc(it.url)]); }).join("") + "</tbody></table>";
      }
    });
    var all = photoPts(), ph = r.photos.map(function (id) { return all.filter(function (p) { return p.id === id; })[0]; }).filter(Boolean);
    if (ph.length) h += "<h2>Photos</h2>" + ph.map(function (p) { return "<p><b>" + esc(p.n || "Photo point") + "</b> " + esc(grid([p.lat, p.lon])) + (isFinite(p.az) && p.az !== null ? ", facing " + dir3(p.az) + "°" : "") + '</p><div class="ph" data-thumb="' + esc(p.id) + '"></div>'; }).join("");
    h += "<p>Sources: elevation OSAP terrain sources; obstacles and aeroways OpenStreetMap contributors (https://www.openstreetmap.org/copyright), only mapped features; declination WMM2025. Printed " + esc(stamp(Date.now())) + ".</p>";
    d.innerHTML = h;
    return d;
  }
  function photosReady(root) {
    var P = W.OSAP_POINTS, cs = root.querySelectorAll("[data-thumb]"); if (!P || !P.thumbs || !cs.length) return Promise.resolve();
    return Promise.race([Promise.all(Array.prototype.map.call(cs, function (c) { return P.thumbs(c, c.getAttribute("data-thumb")).then(function () {
      /* the PDF copy drops buttons, and each thumbnail sits in one: keep the pictures */
      Array.prototype.forEach.call(c.querySelectorAll("button"), function (bt) { var im = bt.querySelector("img"); if (im) bt.parentNode.replaceChild(im, bt); else bt.remove(); });
      return Promise.all(Array.prototype.map.call(c.querySelectorAll("img"), function (im) { return im.complete ? 0 : new Promise(function (ok) { im.onload = im.onerror = ok; }); })); }); })),
      new Promise(function (ok) { setTimeout(ok, 8000); })]);
  }

  /* ---------- events ---------- */
  var tapOn = false;
  function tapStart(what) { ST.arm = what; if (!tapOn) { map.on("click", onTap); tapOn = true; } map.getContainer().style.cursor = "crosshair"; paint(); }
  function tapEnd() { ST.arm = ""; if (tapOn) { map.off("click", onTap); tapOn = false; } map.getContainer().style.cursor = ""; }
  function onTap(ev) {
    var what = ST.arm, p = [+ev.latlng.lat.toFixed(6), +L.Util.wrapNum(ev.latlng.lng, [-180, 180], true).toFixed(6)]; tapEnd();
    if (what === "c") setCentre(p);
    else if (/^o\d+$/.test(what)) { var x = ST.r.obst[+what.slice(1)]; if (x) { x.at = p; keep(); paint(); drawObst(); } }
  }
  function setCentre(p) { ST.r.g.c = [+(+p[0]).toFixed(6), +(+p[1]).toFixed(6)]; ST.r.g = cleanG(ST.r.g); keep(); paint(); draw(); fill(); }
  function onClick(ev) {
    var b = ev.target.closest && ev.target.closest("[data-sv]"); if (!b || !ST.r) return;
    var k = b.getAttribute("data-sv"), r = ST.r, i = +b.getAttribute("data-i");
    if (k === "close") close();
    else if (k === "save") {
      ST.saved = true;
      if (r.kind === "dz" && DZS()) { var d0 = dzFromG(ST.dz || newDzFor(r), r.g); d0.name = d0.name && d0.name !== "Drop zone" ? d0.name : r.name; ST.self = true; var sd = DZS().save(d0); ST.self = false; if (sd) { ST.dz = sd; r.dz_id = sd.id; } }
      var c = saveRec(r); if (c) { ST.r = c; toast("Survey saved in My places"); } else ST.saved = false; paint();
    }
    else if (k === "kind") setKind(b.getAttribute("data-k"));
    else if (k === "edit") { ST.edit = !ST.edit; paint(); drawHandles(); }
    else if (k === "tapc") { if (ST.arm === "c") { tapEnd(); paint(); } else tapStart("c"); }
    else if (k === "show") { try { map.fitBounds(L.latLngBounds(outline(r.g)).pad(0.8), { maxZoom: 17 }); } catch (x) {} if (W.OSAP_SPLIT && W.OSAP_SPLIT.on() && W.innerWidth <= 700 && W.OSAP_SPLIT.stop) try { W.OSAP_SPLIT.stop(el, "map"); } catch (x) {} }
    else if (k === "grid") { var inp = el.querySelector('[data-f="grid"]'), gp = G() && G().parse(inp && inp.value); if (gp) setCentre([gp.lat, gp.lon]); else if (inp) { inp.setCustomValidity("Not a grid OSAP can read"); inp.reportValidity(); } }
    else if (k === "refresh") fill();
    else if (k === "obadd") { if (r.obst.length >= 60) return; r.obst.push({ d: "", h: "", at: null, note: "" }); keep(); paint(); var ins = el.querySelectorAll('[data-ob="d"]'); if (ins.length) ins[ins.length - 1].focus(); }
    else if (k === "obdel") { r.obst.splice(i, 1); keep(); paint(); drawObst(); }
    else if (k === "obtap") { if (ST.arm === "o" + i) { tapEnd(); paint(); } else tapStart("o" + i); }
    else if (k === "phadd") { var id = b.getAttribute("data-id"); if (r.photos.indexOf(id) < 0) r.photos.push(id); keep(); paint(); }
    else if (k === "phdel") { r.photos = r.photos.filter(function (x) { return x !== b.getAttribute("data-id"); }); keep(); paint(); }
    else if (k === "snap") { if (W.OSAP_POINTS && W.OSAP_POINTS.snap) W.OSAP_POINTS.snap(); else toast("Photos are not available on this page."); }
    else if (k === "dzso") { if (W.OSAP_DZSO_GO && ST.dz && ST.dz.id) W.OSAP_DZSO_GO({ id: ST.dz.id }); }
    else if (k === "del") { if (!W.confirm("Delete the survey " + r.name + " from this browser?")) return; removeRec(r.id); ST.saved = false; r.id = newId(); paint(); }
    else if (k === "pdf") {
      if (!W.OSAP_PDF || b.disabled) return;
      var sh = printSheet(); b.disabled = true; b.textContent = "Preparing…";
      var hold = D.createElement("div"); hold.style.cssText = "position:absolute;left:-9999px;top:0;width:800px"; hold.appendChild(sh); D.body.appendChild(hold);
      photosReady(sh).then(function () { b.disabled = false; b.textContent = "Export PDF"; var p = W.OSAP_PDF.panel(sh, { title: KINDS[r.kind].s + " survey: " + r.name }); hold.remove(); return p; });
    }
  }
  function setKind(nk) { var r = ST.r; if (!KINDS[nk] || ST.saved || nk === r.kind) return; r.kind = nk; var K = KINDS[nk]; r.g.shape = K.shape; r.g.len_m = K.len; r.g.wid_m = K.wid; r.g = cleanG(r.g); if (nk === "dz") ST.dz = newDzFor(r); else ST.dz = null; if (/ survey$/.test(r.name)) r.name = K.s + " survey"; paint(); draw(); fillSoon(); }
  function newDzFor(r) {
    var C = DZS() ? DZS().clean : function (x) { return x; };
    var d = C({ _new: true, name: r.name, cc: r.cc || cc(), pi: r.g.c, axis: r.g.axis, shape: r.g.shape, len_m: r.g.len_m, wid_m: r.g.wid_m, pi_lead_m: Math.min(274, Math.round(r.g.len_m / 2)), fields: {} });
    if (d) delete d.id; return d;
  }
  function onChange(ev) {
    var t = ev.target, f = t.getAttribute && t.getAttribute("data-f"), r = ST.r; if (!r) return;
    var o = t.getAttribute && t.getAttribute("data-o"); if (o) { r.obs[o] = String(t.value).slice(0, 2000); keep(); return; }
    var ob = t.getAttribute && t.getAttribute("data-ob");
    if (ob === "g") { var x = r.obst[+t.getAttribute("data-i")], gp = G() && G().parse(t.value); if (x) { if (gp) x.at = [+gp.lat.toFixed(6), +gp.lon.toFixed(6)]; else if (!t.value.trim()) x.at = null; else { t.setCustomValidity("Not a grid OSAP can read"); t.reportValidity(); return; } keep(); paint(); drawObst(); } return; }
    if (ob) return;
    if (!f || f === "grid") return;
    var v = t.value, n = parseFloat(v), geo = false;
    /* a drop zone keeps its PI where it is when its size or run-in is typed, as the DZSO sheet does */
    var piWas = r.kind === "dz" && ST.dz && /^(len_m|wid_m|axis|shape)$/.test(f) ? dzFromG(ST.dz, r.g).pi : null;
    if (f === "pick") { if (v) openRec(get(v)); return; }
    if (f === "kind") { setKind(v); return; }
    if (f === "name") { r.name = String(v).trim().slice(0, 80) || KINDS[r.kind].s + " survey"; if (ST.dz) ST.dz.name = r.name; }
    else if (f === "status") r.status = v === "complete" ? "complete" : "draft";
    else if (f === "shape") { r.g.shape = v === "circle" ? "circle" : "rect"; if (r.g.shape === "circle") r.g.wid_m = r.g.len_m; geo = true; }
    else if ((f === "len_m" || f === "wid_m") && isFinite(n)) { r.g[f] = n; if (r.g.shape === "circle") r.g.wid_m = r.g.len_m = n; geo = true; }
    else if (f === "axis" && isFinite(n)) { r.g.axis = n; geo = true; }
    else if (f === "pi_lead" && isFinite(n) && ST.dz) { ST.dz.pi_lead_m = Math.max(0, Math.min(r.g.len_m, n)); }
    r.g = cleanG(r.g);
    if (piWas) { if (r.g.shape === "circle") r.g.c = piWas.slice(); else { var lead = Math.min(+ST.dz.pi_lead_m || 0, r.g.len_m); ST.dz.pi_lead_m = lead; r.g.c = toLL({ c: piWas, axis: r.g.axis }, r.g.len_m / 2 - lead, 0).map(function (x) { return +x.toFixed(6); }); } }
    keep(); paint(); draw(); if (geo) fillSoon();
  }
  /* typed sizes and turns are looked up once the typing stops, not once per field */
  var fillT = null;
  function fillSoon() { clearTimeout(fillT); fillT = setTimeout(function () { if (isOpen()) fill(); }, 600); }
  var obT = null;
  function onInput(ev) {
    var t = ev.target, r = ST.r; if (!r) return;
    var o = t.getAttribute && t.getAttribute("data-o"); if (o) { r.obs[o] = String(t.value).slice(0, 2000); clearTimeout(obT); obT = setTimeout(keep, 400); return; }
    var ob = t.getAttribute && t.getAttribute("data-ob"), x = r.obst[+t.getAttribute("data-i")];
    if (x && (ob === "d" || ob === "h")) { x[ob] = ob === "h" ? (t.value === "" || !isFinite(+t.value) ? "" : String(+t.value)) : String(t.value).slice(0, 200); clearTimeout(obT); obT = setTimeout(keep, 400); }
  }

  /* ---------- open and close ---------- */
  function openRec(rec) {
    if (!rec) return; ST.r = rec; ST.saved = true; ST.dz = null; ST.err = { el: "", osm: "" };
    if (rec.kind === "dz" && DZS()) { var d = rec.dz_id && DZS().get(rec.dz_id); if (d) { ST.dz = d; var g = gFromDz(d); if (g) ST.r.g = g; } else ST.dz = newDzFor(rec); }
    show();
  }
  function show() {
    el.hidden = false; paint(); draw();
    var A = ST.r.auto; if (!A.elev || A.elev.key !== geoKey(ST.r.g) || !A.osm || A.osm.key !== geoKey(ST.r.g)) fill(); else fill("none");
    try { var bb = L.latLngBounds(outline(ST.r.g)); if (!map.getBounds().contains(bb)) map.fitBounds(bb.pad(0.8), { maxZoom: 16 }); } catch (x) {}
    var f = el.querySelector('[data-sv="close"]'); if (f) f.focus({ preventScroll: true });
  }
  function open(o) {
    o = o || {}; ensure(); tapEnd(); ST.run.el++; ST.run.osm++; ST.busy = { el: false, osm: false };
    if (o.id) { var rec = get(o.id); if (rec) { openRec(rec); return; } }
    /* a DZ from the DZSO sheet: its survey when there is one, else a new survey on that DZ */
    var dz = o.dz || (o.dzId && DZS() ? DZS().get(o.dzId) : null);
    if (dz) {
      var ex = dz.id ? list().filter(function (x) { return x.kind === "dz" && x.dz_id === dz.id; })[0] : null;
      if (ex) { openRec(ex); return; }
      var g = gFromDz(dz); ST.r = newRec({ kind: "dz", at: g.c, name: dz.name && dz.name !== "Drop zone" ? dz.name : "DZ survey" }); ST.r.g = g; ST.r.dz_id = dz.id || ""; ST.dz = dz; ST.saved = false; ST.err = { el: "", osm: "" }; show(); return;
    }
    var at = o.at;
    if (!at) { var Ar = W.TSAP && W.TSAP.areaApi, P = Ar && Ar.area && Ar.area(); if (P && P.length > 2) { var la = 0, lo = 0; P.forEach(function (p) { la += p[0]; lo += p[1]; }); at = [la / P.length, lo / P.length]; } }
    if (!at) { var c = map.getCenter(); at = [c.lat, L.Util.wrapNum(c.lng, [-180, 180], true)]; }
    /* a saved survey within 30 m of the point opens instead of a second one */
    var near = list().filter(function (x) { return (!o.kind || x.kind === o.kind) && dist(x.g.c, at) < 30; })[0];
    if (near && !o.finder) { openRec(near); return; }
    ST.r = newRec(Object.assign({}, o, { at: at })); ST.saved = false; ST.err = { el: "", osm: "" };
    ST.dz = ST.r.kind === "dz" ? newDzFor(ST.r) : null;
    show();
  }
  function close() { tapEnd(); ST.run.el++; ST.run.osm++; ST.busy = { el: false, osm: false }; if (DRAG) { DRAG = null; map.dragging.enable(); } if (el) el.hidden = true; layer.clearLayers(); oLayer.clearLayers(); hLayer.clearLayers(); }
  W.OSAP_SURVEY = { open: open, close: close, isOpen: isOpen, list: list, get: get, remove: removeRec, core: CORE, KEY: KEY, KINDS: KINDS, _print: printSheet,
    state: function () { return { r: ST.r ? JSON.parse(JSON.stringify(ST.r)) : null, saved: ST.saved, dz: ST.dz ? JSON.parse(JSON.stringify(ST.dz)) : null, busy: Object.assign({}, ST.busy), err: Object.assign({}, ST.err) }; } };
})(typeof window !== "undefined" ? window : this);
