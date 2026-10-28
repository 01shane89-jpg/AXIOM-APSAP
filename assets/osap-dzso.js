/* AXIOM OSAP: DZSO sheet (Shane 2026-10-27: "a tool that can provide information to the DZSO at the drop zone").
   One sheet for the Drop Zone Safety Officer of an airborne operation, for a drop zone (DZ) shared with the flight planner
   through window.OSAP_DZ (assets/osap-dz.js):
   - the DZ: point of impact (PI) as MGRS, elevation, rectangle or circle with its run-in axis (true and magnetic), drawn on
     the map, and a planning check of its length against the number of jumpers per pass. The DZ is edited on the map too
     (Shane 2026-10-27: "edit the dz shape and angle/ approach from the map"): drag the PI ring to move it, a corner to
     resize (the circle's edge handle for its diameter), the turn handle on the run-in line to set the approach; a saved DZ
     saves each change, so the flight planner follows it;
   - winds for the hours round the drop time (Open-Meteo model, keyless): surface wind and gusts, winds at 80, 120 and 180 m
     and at the 925 and 850 hPa levels, the mean wind from the ground to the drop altitude, the drift from the planning
     formula D = K x A x V (metres; K the load constant, A the drop altitude in hundreds of feet, V the mean wind in knots) and
     the release point that drift puts upwind of the PI; each hour checked against the limits the DZSO sets (surface wind and
     gusts, visibility, an estimated cloud base, thunderstorms);
   - the DZSO's own reading at the DZ (anemometer wind and gust) against the same limits: the reading decides, the model does not;
   - light: sunset, end of civil and nautical twilight (EECT, EENT), BMNT, BMCT, sunrise, the moon and percent illuminated for
     the night round the drop time (OSAP_ILLUM's own astronomy, no network), and whether the drop time is day, twilight or dark;
   - hazards in and round the DZ from OpenStreetMap (one Overpass request): power lines and cables, masts and towers, wind
     turbines, water, wetland, trees, roads, railways, fences and walls and buildings, each kind with how many are inside the DZ
     (plus a margin) and the nearest one's distance and direction from the PI, drawn on the map;
   - medical: the nearest hospitals from OSAP's stored copy of OpenStreetMap (data/medfac) with distance, direction and a flight
     time estimate, and one press to open the medical plan or the evacuation planner from the PI; Ground evacuation (Shane
     2026-10-27: "see ground evac for the med plan from the dz") adds the road distance and drive time to each hospital and draws
     the road route, with the medical plan's own routing (OSAP_MEDPLAN.road: OSRM, then Valhalla, else a labelled estimate);
   - comms, personnel and markings fields and a short DZSO checklist the DZSO fills in, kept with the DZ in this browser only;
   - Export PDF: the whole sheet with a north-up DZ diagram drawn to scale.
   Opened from long-press > Plans > "DZSO sheet here", a dropped point's "DZSO sheet" button and the Area menu ("Drop zone
   (DZSO)"); assets/osap-atak.js loads this file the first time any of them is used. No toolbar button.
   Every number is worked out by fixed rules from open data and model forecasts. It is a planning aid: not an official drop zone
   survey, not a release point from the aircrew's computed air release point, not analyst-approved and not AI. The default
   limits are placeholders the DZSO sets from the unit's own SOP and the governing publications.
   window.OSAP_DZSO = { open({ at, name, id }), close, isOpen, state, core } */
(function (root) {
  "use strict";
  var R = Math.PI / 180, FT = 0.3048, YD = 0.9144, KT = 0.514444;

  /* ---------- pure planning maths (also loaded by tests/dzso.test.mjs) ---------- */
  /* metres east and north of o (a local flat frame; good to well under 1 percent across a few kilometres) */
  function local(o, p) { var k = 111320; return [(p[1] - o[1]) * k * Math.cos(o[0] * R), (p[0] - o[0]) * 110574]; }
  function unlocal(o, xy) { var k = 111320; return [o[0] + xy[1] / 110574, o[1] + xy[0] / (k * Math.cos(o[0] * R))]; }
  /* a point in the DZ's own frame: u along the run-in axis from the leading edge, v to the right of the axis */
  function uv(dz, p) {
    var xy = local(dz.pi, p), a = (+dz.axis || 0) * R;
    return [xy[0] * Math.sin(a) + xy[1] * Math.cos(a) + (dz.shape === "circle" ? 0 : +dz.pi_lead_m || 0), xy[0] * Math.cos(a) - xy[1] * Math.sin(a)];
  }
  function fromUv(dz, u, v) {
    var a = (+dz.axis || 0) * R, al = u - (dz.shape === "circle" ? 0 : +dz.pi_lead_m || 0);
    return unlocal(dz.pi, [al * Math.sin(a) + v * Math.cos(a), al * Math.cos(a) - v * Math.sin(a)]);
  }
  function inside(dz, p, margin) {
    var m = margin || 0;
    if (dz.shape === "circle") { var xy = local(dz.pi, p); return Math.hypot(xy[0], xy[1]) <= dz.len_m / 2 + m; }
    var q = uv(dz, p); return q[0] >= -m && q[0] <= dz.len_m + m && Math.abs(q[1]) <= dz.wid_m / 2 + m;
  }
  function outline(dz) {
    var out = [];
    if (dz.shape === "circle") { for (var i = 0; i < 48; i++) { var t = i / 48 * 2 * Math.PI, r = dz.len_m / 2; out.push(unlocal(dz.pi, [r * Math.sin(t), r * Math.cos(t)])); } return out; }
    var w = dz.wid_m / 2;
    return [fromUv(dz, 0, -w), fromUv(dz, 0, w), fromUv(dz, dz.len_m, w), fromUv(dz, dz.len_m, -w)];
  }
  /* nearest distance (m) from o to a polyline (or a ring), with the nearest point */
  function nearest(o, line) {
    var best = { m: Infinity, p: null };
    for (var i = 0; i < line.length; i++) {
      var a = local(o, line[i]), b = i + 1 < line.length ? local(o, line[i + 1]) : a;
      var dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / L2)) : 0;
      var x = a[0] + t * dx, y = a[1] + t * dy, m = Math.hypot(x, y);
      if (m < best.m) best = { m: m, p: unlocal(o, [x, y]) };
    }
    return best;
  }
  function inRing(p, ring) {
    var c = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var a = ring[i], b = ring[j];
      if ((a[0] > p[0]) !== (b[0] > p[0]) && p[1] < (b[1] - a[1]) * (p[0] - a[0]) / (b[0] - a[0]) + a[1]) c = !c;
    }
    return c;
  }
  /* does a line (or the outline of an area) come within margin of the DZ: every 10 m along it */
  function touches(dz, line, closed) {
    for (var i = 0; i < line.length; i++) {
      var a = line[i], b = i + 1 < line.length ? line[i + 1] : closed ? line[0] : null;
      if (inside(dz, a, 0)) return true;
      if (!b) continue;
      var d = local(a, b), n = Math.min(400, Math.ceil(Math.hypot(d[0], d[1]) / 10));
      for (var k = 1; k < n; k++) if (inside(dz, [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n], 0)) return true;
    }
    return closed ? inRing(dz.pi, line) : false;
  }
  function bearing(a, b) { var xy = local(a, b); return ((Math.atan2(xy[0], xy[1]) / R) + 360) % 360; }
  function compass(d) { return ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(d / 22.5) % 16]; }
  /* the planning length of a personnel DZ: 600 yd for the first jumper plus perYd for each one after, per pass and door */
  function minLen(jumpers, perYd) { return (600 + Math.max(0, (+jumpers || 1) - 1) * (+perYd || 0)) * YD; }
  /* D = K x A x V: drift in metres, A in hundreds of feet, V the mean wind in knots */
  function drift(K, altFt, kt) { return +K > 0 && +altFt > 0 && +kt >= 0 ? K * (altFt / 100) * kt : null; }
  /* the mean wind from the ground to altM: levels [{ h (m above the DZ), kt, dir (from) }], a vector mean weighted by the depth
     each level stands for (straight lines between levels; the lowest level stands for the ground below it) */
  function meanWind(levels, altM) {
    var L = (levels || []).filter(function (l) { return l && isFinite(l.h) && l.h > 0 && isFinite(l.kt) && isFinite(l.dir); }).sort(function (a, b) { return a.h - b.h; });
    if (!L.length || !(altM > 0)) return null;
    function vec(l) { var t = l.dir * R; return [-l.kt * Math.sin(t), -l.kt * Math.cos(t)]; }   /* the way the air moves */
    var sx = 0, sy = 0, tot = 0, prev = { h: 0, v: vec(L[0]) };
    for (var i = 0; i < L.length && prev.h < altM; i++) {
      var v = vec(L[i]), top = Math.min(L[i].h, altM), f = L[i].h > prev.h ? (top - prev.h) / (L[i].h - prev.h) : 1;
      var vt = [prev.v[0] + (v[0] - prev.v[0]) * f, prev.v[1] + (v[1] - prev.v[1]) * f], dh = top - prev.h;
      sx += (prev.v[0] + vt[0]) / 2 * dh; sy += (prev.v[1] + vt[1]) / 2 * dh; tot += dh;
      prev = { h: top, v: vt };
    }
    if (prev.h < altM) { var dh2 = altM - prev.h; sx += prev.v[0] * dh2; sy += prev.v[1] * dh2; tot += dh2; }
    var x = sx / tot, y = sy / tot, kt = Math.hypot(x, y);
    return { kt: kt, dir: kt < 0.05 ? 0 : (Math.atan2(-x, -y) / R + 360) % 360, top: L[L.length - 1].h };
  }
  /* cloud base above the ground from the temperature and dew point spread: about 400 ft per degree C (an estimate) */
  function cloudBaseFt(t, td) { return isFinite(t) && isFinite(td) ? Math.max(0, (t - td) * 400) : null; }
  /* one hour against the limits: { state: "ok" | "check" | "out", why: [] } */
  function verdict(h, Lm) {
    var out = [], chk = [];
    function cmp(v, lim, what) { if (!isFinite(v) || !(lim > 0)) return; if (v > lim) out.push(what + " " + Math.round(v) + " kt over " + lim); else if (v > lim - 2) chk.push(what + " " + Math.round(v) + " kt near " + lim); }
    cmp(h.kt, Lm.wind, "Surface wind"); cmp(h.gust, Lm.gust, "Gusts");
    if (isFinite(h.vis) && Lm.vis > 0 && h.vis / 1000 < Lm.vis) out.push("Visibility " + (h.vis / 1000).toFixed(1) + " km under " + Lm.vis);
    if ([95, 96, 99].indexOf(h.code) >= 0) out.push("Thunderstorm in the model");
    if (isFinite(h.base) && isFinite(h.low) && h.low >= 50 && Lm.alt > 0 && h.base < Lm.alt + (Lm.pad || 0)) chk.push("Cloud base about " + Math.round(h.base / 100) * 100 + " ft (estimate) with " + Math.round(h.low) + "% low cloud");
    if (isFinite(h.pr) && h.pr >= 2) chk.push("Rain " + h.pr.toFixed(1) + " mm/h");
    return { state: out.length ? "out" : chk.length ? "check" : "ok", why: out.concat(chk) };
  }
  /* light at a moment: day, civil twilight, nautical twilight or dark, from the sun's height */
  function lightAt(alt) { return alt > -0.833 ? "Day" : alt > -6 ? "Civil twilight" : alt > -12 ? "Nautical twilight" : "Dark"; }
  var CORE = { local: local, unlocal: unlocal, uv: uv, fromUv: fromUv, inside: inside, outline: outline, nearest: nearest, inRing: inRing, touches: touches,
    bearing: bearing, compass: compass, minLen: minLen, drift: drift, meanWind: meanWind, cloudBaseFt: cloudBaseFt, verdict: verdict, lightAt: lightAt };
  if (typeof module === "object" && module.exports) { module.exports = CORE; return; }
  var W = root;
  if (!W.document || /[?&]watchscan=1(&|$)/.test(location.search)) { W.OSAP_DZSO = { core: CORE }; return; }

  /* ---------- the sheet ---------- */
  var D = document, map = W.__asapMap, L = W.L;
  if (!map || !L) { W.OSAP_DZSO = { core: CORE }; return; }
  var METEO = "https://api.open-meteo.com/v1/forecast";
  var OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
  var KEY = "osap-dzso", HOSP_R = 80000, HOSP_N = 6, HZ_MARGIN = 50;
  /* load profiles: limits and the drift constant are placeholders for the DZSO to set from the unit's SOP */
  var PROFILES = [
    { id: "sl", label: "Static line personnel", wind: 13, gust: 13, K: 3.0, alt: 1250, note: "13 kt is the static line training limit commonly applied under TC 3-21.220; K = 3.0 is the personnel drift constant used with D = KAV. Confirm both against your SOP." },
    { id: "mff", label: "Military free fall (ram-air)", wind: 18, gust: 18, K: 0, alt: 12500, note: "Placeholder limits: set them from your MFF SOP. D = KAV does not apply to ram-air canopies, so no drift is worked out." },
    { id: "cds", label: "Equipment (CDS / heavy drop)", wind: 17, gust: 17, K: 1.5, alt: 600, note: "Placeholder limits: set them from your SOP and the aircrew. K = 1.5 is the equipment drift constant used with D = KAV." },
    { id: "own", label: "Own limits", wind: 13, gust: 13, K: 3.0, alt: 1250, note: "Your own limits." }
  ];
  var KINDS = {
    power: { n: "Power lines and cables", c: "#d32f2f", w: 3, sev: 3 }, mast: { n: "Masts, towers and chimneys", c: "#b71c1c", sev: 3 }, wind: { n: "Wind turbines", c: "#b71c1c", sev: 3 },
    water: { n: "Open water", c: "#1565c0", sev: 3, area: true }, river: { n: "Rivers, canals and ditches", c: "#1e88e5", w: 3, sev: 3 }, wet: { n: "Wetland", c: "#26a69a", sev: 2, area: true },
    trees: { n: "Trees and forest", c: "#2e7d32", sev: 2, area: true }, rail: { n: "Railways", c: "#6d4c41", w: 3, sev: 2 }, road: { n: "Roads", c: "#f57c00", w: 2.5, sev: 2 },
    fence: { n: "Fences and walls", c: "#8d6e63", w: 2, sev: 1 }, bldg: { n: "Buildings", c: "#455a64", sev: 2, area: true }
  };
  var ORDER = ["power", "mast", "wind", "water", "river", "wet", "trees", "rail", "road", "fence", "bldg"];
  var FIELDS = [
    ["dzso", "DZSO"], ["adzso", "Assistant DZSO / DZ support"], ["medic", "Medic and ambulance location"], ["g2a", "Ground-to-air frequency (primary)"], ["g2a2", "Alternate frequency"],
    ["cs_dz", "DZ call sign"], ["cs_ac", "Aircraft call sign"], ["code", "Code letter / DZ marking"], ["smoke", "Smoke or signal for winds"], ["abort", "No-drop / abort signal"],
    ["assembly", "Assembly and recovery points"], ["notes", "Notes"]
  ];
  var CHECKS = [
    ["c_walk", "DZ walked: hazards and surface checked"], ["c_mark", "Markings and code letter in place"], ["c_wind", "Surface wind read at the PI and passed"], ["c_comms", "Comms check with the aircraft"],
    ["c_med", "Medic and vehicle in position, route to hospital known"], ["c_rec", "Recovery and assembly points set"]
  ];

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function G() { return W.OSAP_GEO; }
  function grid(p) { var g = G(), m = g && g.mgrs(p[0], p[1], 5); return m || p[0].toFixed(5) + ", " + p[1].toFixed(5); }
  function cc() { return (W.TSAP && W.TSAP.country) || ""; }
  function lsGet() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function lsSet(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }
  function fmtM(m) { return m < 1000 ? Math.round(m) + " m" : (m / 1000).toFixed(m < 10000 ? 1 : 0) + " km"; }
  function p2(n) { return ("0" + n).slice(-2); }
  function zc(ms) { var d = new Date(ms); return p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + "Z"; }
  function zd(ms) { var d = new Date(ms); return d.getUTCDate() + " " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]; }
  function lc(ms, off) { var d = new Date(ms + off * 1000); return p2(d.getUTCHours()) + ":" + p2(d.getUTCMinutes()); }
  function dir3(d) { return ("00" + Math.round(d) % 360).slice(-3); }

  var SV = lsGet();
  var LIM = { prof: PROFILES.some(function (p) { return p.id === SV.prof; }) ? SV.prof : "sl" };
  (function () { var p = prof(LIM.prof); ["wind", "gust", "K"].forEach(function (k) { LIM[k] = isFinite(+SV[k]) && SV[k] !== null && SV[k] !== "" ? +SV[k] : p[k]; }); LIM.vis = isFinite(+SV.vis) && +SV.vis > 0 ? +SV.vis : 5; LIM.pad = isFinite(+SV.pad) ? +SV.pad : 500; LIM.perYd = isFinite(+SV.perYd) && +SV.perYd > 0 ? +SV.perYd : 75; LIM.kn = isFinite(+SV.kn) && +SV.kn > 0 ? +SV.kn : 120; })();
  function prof(id) { return PROFILES.filter(function (p) { return p.id === id; })[0] || PROFILES[0]; }
  function keepLim() { lsSet({ prof: LIM.prof, wind: LIM.wind, gust: LIM.gust, K: LIM.K, vis: LIM.vis, pad: LIM.pad, perYd: LIM.perYd, kn: LIM.kn }); }

  var ST = { dz: null, saved: false, arm: false, edit: true, acOther: false, wx: null, wxErr: "", wxBusy: false, hz: null, hzErr: "", hzBusy: false, hosp: null, hospErr: "", hospBusy: false, meas: { kt: "", gust: "", dir: "" }, run: { wx: 0, hz: 0, hosp: 0, gnd: 0 }, gnd: { on: false, busy: false, err: "", host: "", sel: 0, rt: null, rtBusy: false, rtErr: "" }, hzT0: 0, hzTry: "" };
  function store() { return W.OSAP_DZ; }
  function newDz(at, name) {
    var c = store() ? store().clean : function (x) { return x; };
    return c({ name: name || "Drop zone", cc: cc(), pi: [+at[0], +at[1]], axis: 0, shape: "rect", len_m: 1000, wid_m: 550, pi_lead_m: 274, alt_ft: prof(LIM.prof).alt, acft: "", tot: "", fields: { jumpers: "20" } });
  }

  /* ---------- the map ---------- */
  if (!map.getPane("dzpane")) { map.createPane("dzpane"); map.getPane("dzpane").style.zIndex = 667; }
  var rend = L.svg({ pane: "dzpane" }), layer = L.layerGroup().addTo(map), hzLayer = L.layerGroup().addTo(map), gLayer = L.layerGroup().addTo(map);
  var hLayer = L.layerGroup().addTo(map), HS = {}, DRAG = null;
  function drawDz() {
    layer.clearLayers(); hLayer.clearLayers(); HS = {}; if (!ST.dz || !isOpen()) return;
    drawShape(); if (ST.edit) drawHandles();
  }
  /* where the DZ starts along the run-in axis in fromUv's frame: the leading edge for a rectangle, the near edge of a circle */
  function edge0(dz) { return dz.shape === "circle" ? -dz.len_m / 2 : 0; }
  function drawShape() {
    layer.clearLayers();
    var dz = ST.dz, o = { pane: "dzpane", renderer: rend, interactive: false }, e0 = edge0(dz);
    L.polygon(outline(dz), Object.assign({ color: "#ffeb3b", weight: 3, fillColor: "#ffeb3b", fillOpacity: 0.12 }, o)).addTo(layer);
    var a = fromUv(dz, e0 - 1500, 0), b = fromUv(dz, dz.shape === "circle" ? dz.len_m / 2 : dz.len_m, 0);
    L.polyline([a, b], Object.assign({ color: "#ffeb3b", weight: 2, dashArray: "8 6" }, o)).addTo(layer);
    var tip = fromUv(dz, e0 - 40, 0), l1 = fromUv(dz, e0 - 110, -35), l2 = fromUv(dz, e0 - 110, 35);
    L.polygon([tip, l1, l2], Object.assign({ color: "#ffeb3b", weight: 1, fillColor: "#ffeb3b", fillOpacity: 1 }, o)).addTo(layer);
    L.circleMarker(dz.pi, Object.assign({ radius: 6, color: "#fff", weight: 2, fillColor: "#d32f2f", fillOpacity: 1 }, o)).addTo(layer);
    L.marker(dz.pi, { pane: "dzpane", interactive: false, icon: L.divIcon({ className: "dzlbl", html: "<span>PI " + esc(dz.name) + "</span>", iconSize: [0, 0] }) }).addTo(layer);
    var h = DRAG ? null : totHour();
    if (h && h.rp) {
      L.polyline([dz.pi, h.rp], Object.assign({ color: "#e040fb", weight: 2, dashArray: "3 5" }, o)).addTo(layer);
      L.circleMarker(h.rp, Object.assign({ radius: 5, color: "#fff", weight: 2, fillColor: "#e040fb", fillOpacity: 1 }, o)).addTo(layer);
      L.marker(h.rp, { pane: "dzpane", interactive: false, icon: L.divIcon({ className: "dzlbl", html: "<span>Drift-only RP " + zc(h.t) + "</span>", iconSize: [0, 0] }) }).addTo(layer);
    }
  }

  /* ---------- editing the DZ on the map: drag handles, mouse or finger ---------- */
  function mpp() { return 40075016.686 * Math.cos(ST.dz.pi[0] * R) / Math.pow(2, map.getZoom() + 8); }
  function handles(dz) {
    var w = dz.wid_m / 2, out = [{ k: "mv", at: dz.pi, cls: "m", lbl: "Drag to move the drop zone" }];
    if (dz.shape === "circle") out.push({ k: "rad", at: fromUv(dz, 0, dz.len_m / 2), cls: "c", lbl: "Drag to change the diameter" });
    else [[0, -w], [0, w], [dz.len_m, w], [dz.len_m, -w]].forEach(function (c, i) { out.push({ k: "c" + i, at: fromUv(dz, c[0], c[1]), cls: "c", lbl: "Drag to resize the drop zone" }); });
    out.push({ k: "rot", at: fromUv(dz, edge0(dz) - 110 - 60 * mpp(), 0), cls: "r", txt: "\u21bb", lbl: "Drag to turn the run-in (approach)" });
    return out;
  }
  function drawHandles() {
    handles(ST.dz).forEach(function (h) {
      var m = L.marker(h.at, { pane: "dzpane", keyboard: false, interactive: true, zIndexOffset: 1000, bubblingMouseEvents: false,
        icon: L.divIcon({ className: "dzh dzh-" + h.cls, html: h.txt || "", iconSize: [30, 30], iconAnchor: [15, 15] }) }).addTo(hLayer);
      var el = m.getElement(); el.setAttribute("data-dzh", h.k); el.setAttribute("aria-label", h.lbl); el.title = h.lbl;
      HS[h.k] = m;
    });
    HS.tip = L.marker(ST.dz.pi, { pane: "dzpane", interactive: false, icon: L.divIcon({ className: "dzlbl dztip", html: "", iconSize: [0, 0] }) }).addTo(hLayer);
  }
  function moveHandles(tip, at) {
    handles(ST.dz).forEach(function (h) { if (HS[h.k]) HS[h.k].setLatLng(h.at); });
    if (HS.tip) { HS.tip.setLatLng(at); var e = HS.tip.getElement(); if (e) e.innerHTML = "<span>" + esc(tip) + "</span>"; }
  }
  function r10(m) { return Math.round(m / 10) * 10; }
  function sizeTxt(dz) { return dz.shape === "circle" ? dz.len_m + " m across" : dz.len_m + " x " + dz.wid_m + " m, PI " + dz.pi_lead_m + " m in"; }
  /* one drag step: the DZ as it was when the drag began (z0) and the point under the finger (p) give the new DZ */
  function dragTo(k, z0, p) {
    var dz = ST.dz, q = uv(z0, p);
    if (k === "mv") { dz.pi = [+p[0].toFixed(6), +p[1].toFixed(6)]; return grid(dz.pi); }
    if (k === "rot") { dz.axis = Math.round(bearing(p, z0.pi)) % 360; return "Run-in " + dir3(dz.axis) + "° true"; }
    if (k === "rad") { dz.len_m = Math.max(10, Math.min(20000, r10(2 * Math.hypot.apply(null, local(z0.pi, p))))); return sizeTxt(dz); }
    var i = +k.charAt(1), lead = i < 2;
    dz.wid_m = Math.max(10, Math.min(20000, r10(2 * Math.abs(q[1]))));
    if (lead) {
      /* the leading edge moves; the far edge and the PI stay where they are, so the PI can not fall outside the DZ */
      var u0 = Math.min(r10(q[0]), z0.pi_lead_m, z0.len_m - 10);
      dz.len_m = Math.min(20000, z0.len_m - u0); dz.pi_lead_m = Math.max(0, z0.pi_lead_m - u0);
    } else dz.len_m = Math.max(10, z0.pi_lead_m, Math.min(20000, r10(q[0])));
    return sizeTxt(dz);
  }
  function evPt(e) { var ll = map.mouseEventToLatLng(e); return [ll.lat, L.Util.wrapNum(ll.lng, [-180, 180], true)]; }
  /* caught on the window before the page's own map handlers (map drag, long-press menu, report pop-ups) see a handle press */
  function hDown(e) {
    var t = e.target.closest && e.target.closest("[data-dzh]"); if (!t || !ST.dz || !isOpen() || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault(); e.stopPropagation();
    try { t.setPointerCapture(e.pointerId); } catch (x) {}
    DRAG = { k: t.getAttribute("data-dzh"), id: e.pointerId, z0: JSON.parse(JSON.stringify(ST.dz)), moved: false };
    map.dragging.disable(); t.classList.add("on");
  }
  function hMove(e) {
    if (!DRAG || e.pointerId !== DRAG.id) return;
    e.preventDefault(); e.stopPropagation();
    var p = evPt(e), tip = dragTo(DRAG.k, DRAG.z0, p); DRAG.moved = true;
    drawShape(); moveHandles(tip, DRAG.k === "mv" ? fromUv(ST.dz, edge0(ST.dz), 0) : p);
  }
  function hUp(e) {
    if (!DRAG || e.pointerId !== DRAG.id) return;
    e.preventDefault(); e.stopPropagation();
    var d = DRAG; DRAG = null; map.dragging.enable(); hTapT = Date.now();
    if (!d.moved) { drawDz(); return; }
    if (d.k === "mv") ST.dz.elev_m = null;
    keep(); paint(); drawDz();
    if (d.k === "mv") refresh(); else if (ST.hz) drawHz();
  }
  var hTapT = 0;
  W.addEventListener("pointerdown", hDown, true);
  W.addEventListener("pointermove", hMove, true);
  W.addEventListener("pointerup", hUp, true);
  W.addEventListener("pointercancel", hUp, true);
  /* the tap or click that ends a handle drag must not open a report under it, and iOS must not start a text-select callout */
  W.addEventListener("click", function (e) { if ((e.target.closest && e.target.closest("[data-dzh]")) || Date.now() - hTapT < 400) { if (e.target.closest && e.target.closest("#dzso")) return; e.preventDefault(); e.stopPropagation(); } }, true);
  W.addEventListener("touchstart", function (e) { if (e.target.closest && e.target.closest("[data-dzh]")) { e.preventDefault(); e.stopPropagation(); } }, { capture: true, passive: false });
  W.addEventListener("contextmenu", function (e) { if (e.target.closest && e.target.closest("[data-dzh]")) { e.preventDefault(); e.stopPropagation(); } }, true);
  map.on("zoomend", function () { if (ST.dz && isOpen() && ST.edit && !DRAG) drawDz(); });
  function drawHz() {
    hzLayer.clearLayers(); if (!ST.hz || !isOpen()) return;
    ST.hz.items.forEach(function (it) {
      var k = KINDS[it.k], o = { pane: "dzpane", renderer: rend, interactive: true, color: k.c };
      var m = it.pt ? L.circleMarker(it.pt, Object.assign({ radius: it.k === "bldg" ? 3 : 5, weight: 1.5, fillOpacity: 0.85, fillColor: k.c, color: "#fff" }, o))
        : it.closed ? L.polygon(it.line, Object.assign({ weight: 1.5, fillOpacity: 0.25 }, o)) : L.polyline(it.line, Object.assign({ weight: k.w || 2.5, opacity: 0.9 }, o));
      m.bindTooltip(esc(k.n.replace(/s$/, "") + (it.name ? ": " + it.name : "") + (it.inDz ? " (in or within " + HZ_MARGIN + " m of the DZ)" : "")), { sticky: true });
      m.addTo(hzLayer);
    });
  }

  /* ---------- data ---------- */
  function getJSON(url, ms) {
    var ac = W.AbortController ? new AbortController() : null, t = setTimeout(function () { if (ac) ac.abort(); }, ms);
    /* the timer runs until the whole body is read: a server that sends its headers and then stalls must still time out */
    return fetch(url, { signal: ac ? ac.signal : undefined }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) { clearTimeout(t); return j; }, function (e) { clearTimeout(t); throw new Error(e && e.name === "AbortError" ? "no answer in " + Math.round(ms / 1000) + " s" : e && /^HTTP /.test(e.message) ? e.message : "network error"); });
  }
  var HV = ["temperature_2m", "dew_point_2m", "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "wind_speed_80m", "wind_direction_80m", "wind_speed_120m", "wind_direction_120m",
    "wind_speed_180m", "wind_direction_180m", "wind_speed_925hPa", "wind_direction_925hPa", "geopotential_height_925hPa", "wind_speed_850hPa", "wind_direction_850hPa", "geopotential_height_850hPa",
    "cloud_cover_low", "visibility", "precipitation", "weather_code", "pressure_msl"];
  function loadWx() {
    var dz = ST.dz, run = ++ST.run.wx; ST.wxBusy = true; ST.wxErr = ""; paint();
    var u = METEO + "?latitude=" + dz.pi[0].toFixed(4) + "&longitude=" + dz.pi[1].toFixed(4) + "&hourly=" + HV.join(",") + "&wind_speed_unit=kn&timeformat=unixtime&timezone=auto&forecast_days=10";
    getJSON(u, 25000).then(function (j) {
      if (run !== ST.run.wx) return;
      if (!j || !j.hourly || !Array.isArray(j.hourly.time)) throw new Error("no forecast in the answer");
      ST.wx = { j: j, at: Date.now(), elev: isFinite(j.elevation) ? j.elevation : null, off: +j.utc_offset_seconds || 0, tz: j.timezone || "" };
      if (ST.wx.elev !== null && ST.dz.elev_m == null) { ST.dz.elev_m = Math.round(ST.wx.elev); keep(); }
    }).catch(function (e) { if (run === ST.run.wx) { ST.wx = null; ST.wxErr = e.message || "failed"; } }).then(function () { if (run === ST.run.wx) { ST.wxBusy = false; paint(); drawDz(); } });
  }
  function levelsAt(j, i, elev) {
    var h = j.hourly, out = [[10, "10m"], [80, "80m"], [120, "120m"], [180, "180m"]].map(function (x) { return { h: x[0], kt: h["wind_speed_" + x[1]] && h["wind_speed_" + x[1]][i], dir: h["wind_direction_" + x[1]] && h["wind_direction_" + x[1]][i], lab: x[1] }; });
    ["925hPa", "850hPa"].forEach(function (p) {
      var z = h["geopotential_height_" + p] && h["geopotential_height_" + p][i];
      if (isFinite(z) && z !== null) out.push({ h: z - (elev || 0), kt: h["wind_speed_" + p][i], dir: h["wind_direction_" + p][i], lab: p.replace("hPa", " hPa") });
    });
    return out.filter(function (l) { return l.kt !== null && l.kt !== undefined && isFinite(l.kt) && l.h > 0; });
  }
  /* the hours shown: drop time -3 h to +3 h, or the next 12 hours with no drop time */
  function hours() {
    if (!ST.wx) return [];
    var j = ST.wx.j, h = j.hourly, t = h.time.map(function (s) { return s * 1000; }), dz = ST.dz, tot = dz.tot ? Date.parse(dz.tot) : NaN;
    var from = isFinite(tot) ? tot - 3 * 36e5 : Math.floor(Date.now() / 36e5) * 36e5, to = isFinite(tot) ? tot + 3 * 36e5 : from + 12 * 36e5;
    var altM = (+dz.alt_ft || 0) * FT, out = [];
    t.forEach(function (ms, i) {
      if (ms < from - 1 || ms > to + 1) return;
      var lv = levelsAt(j, i, ST.wx.elev), mw = meanWind(lv, altM), d = mw ? drift(LIM.K, dz.alt_ft, mw.kt) : null;
      var x = { t: ms, i: i, kt: h.wind_speed_10m[i], dir: h.wind_direction_10m[i], gust: h.wind_gusts_10m[i], lv: lv, mean: mw, drift: d,
        rp: d !== null && mw && G() ? G().dest(dz.pi, mw.dir, d) : null, vis: h.visibility[i], low: h.cloud_cover_low[i], pr: h.precipitation[i], code: h.weather_code[i],
        base: cloudBaseFt(h.temperature_2m[i], h.dew_point_2m[i]), qnh: h.pressure_msl[i], tot: isFinite(tot) && Math.abs(ms - Math.round(tot / 36e5) * 36e5) < 1 };
      x.v = verdict(x, { wind: LIM.wind, gust: LIM.gust, vis: LIM.vis, alt: +dz.alt_ft || 0, pad: LIM.pad });
      out.push(x);
    });
    return out;
  }
  function totHour() { var H = hours(); return H.filter(function (h) { return h.tot; })[0] || null; }

  function post(url, body, ms) {
    var ac = W.AbortController ? new AbortController() : null, t = setTimeout(function () { if (ac) ac.abort(); }, ms);
    return fetch(url, { method: "POST", body: body, headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: ac ? ac.signal : undefined }).then(function (r) {
      if (!r.ok) throw new Error(r.status === 429 ? "busy (HTTP 429)" : r.status === 504 ? "timed out (HTTP 504)" : "HTTP " + r.status); return r.json();
    }).then(function (j) { clearTimeout(t); return j; }, function (e) {
      clearTimeout(t); throw new Error(e && e.name === "AbortError" ? "no answer in " + Math.round(ms / 1000) + " s" : e && /^(HTTP|busy|timed)/.test(e.message) ? e.message : e && e.name === "SyntaxError" ? "not a JSON answer" : "network error");
    }).then(function (j) {
      if (j && j.remark && /error|timed out|runtime/i.test(j.remark)) throw new Error("Overpass: " + String(j.remark).slice(0, 120));
      return j;
    });
  }
  /* the servers one after another, each with its own time limit, and the whole lookup capped so it always ends in an answer
     or a failure the sheet shows; live() false stops it (the DZ moved, the sheet closed) */
  function overpass(q, live) {
    var body = "data=" + encodeURIComponent(q), tried = [], t0 = Date.now(), CAP = 100000;
    function go(i) {
      if (live && !live()) return Promise.reject(new Error("stopped"));
      if (i >= OVERPASS.length || Date.now() - t0 > CAP - 10000) return Promise.reject(new Error("no Overpass server answered (" + (tried.join("; ") || "none tried") + ")"));
      var host = OVERPASS[i].split("/")[2]; ST.hzTry = host + (i ? " (server " + (i + 1) + " of " + OVERPASS.length + ")" : ""); paintHz();
      return post(OVERPASS[i], body, Math.min(30000, CAP - (Date.now() - t0))).catch(function (e) { tried.push(host + ": " + e.message); return go(i + 1); });
    }
    return go(0);
  }
  function hzRadius(dz) { return Math.min(4000, Math.round(Math.max(dz.len_m, dz.wid_m) + 800)); }
  function hzQuery(dz) {
    var a = "(around:" + hzRadius(dz) + "," + dz.pi[0].toFixed(5) + "," + dz.pi[1].toFixed(5) + ")";
    return "[out:json][timeout:25];(" +
      'way["power"~"^(line|minor_line|cable)$"]' + a + ";" +
      'nwr["man_made"~"^(mast|tower|communications_tower|chimney|water_tower)$"]' + a + ";" +
      'node["power"="generator"]["generator:source"="wind"]' + a + ";" +
      'nwr["natural"="water"]' + a + ";" + 'nwr["landuse"~"^(reservoir|basin)$"]' + a + ";" +
      'way["waterway"~"^(river|canal|stream|drain|ditch)$"]' + a + ";" + 'nwr["natural"="wetland"]' + a + ";" +
      'nwr["natural"~"^(wood|tree_row)$"]' + a + ";" + 'nwr["landuse"="forest"]' + a + ";" +
      'way["railway"~"^(rail|light_rail|narrow_gauge)$"]' + a + ";" +
      'way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|track)$"]' + a + ";" +
      'way["barrier"~"^(fence|wall|city_wall)$"]' + a + ";" + 'way["building"]' + a + ";" +
      ");out geom 4000;";
  }
  function kindOf(t) {
    if (/^(line|minor_line|cable)$/.test(t.power || "")) return "power";
    if (t.power === "generator") return "wind";
    if (t.man_made) return "mast";
    if (t.natural === "water" || /^(reservoir|basin)$/.test(t.landuse || "")) return "water";
    if (t.waterway) return "river";
    if (t.natural === "wetland") return "wet";
    if (/^(wood|tree_row)$/.test(t.natural || "") || t.landuse === "forest") return "trees";
    if (t.railway) return "rail";
    if (t.highway) return "road";
    if (t.barrier) return "fence";
    if (t.building) return "bldg";
    return null;
  }
  function geomOf(e) {
    function pts(g) { return (g || []).filter(function (p) { return p && p.lat != null; }).map(function (p) { return [p.lat, p.lon]; }); }
    if (e.type === "node") return { pt: [e.lat, e.lon] };
    if (e.type === "way") { var g = pts(e.geometry); if (g.length < 2) return null; var cl = g.length > 3 && g[0][0] === g[g.length - 1][0] && g[0][1] === g[g.length - 1][1]; return { lines: [g], closed: cl }; }
    if (e.type === "relation") { var ls = (e.members || []).filter(function (m) { return m.type === "way" && m.geometry && m.role !== "inner"; }).map(function (m) { return pts(m.geometry); }).filter(function (g) { return g.length > 1; }); return ls.length ? { lines: ls, closed: true } : null; }
    return null;
  }
  function analyseHz(els, dz) {
    var items = [], sum = {};
    ORDER.forEach(function (k) { sum[k] = { n: 0, inDz: 0, near: null }; });
    (els || []).forEach(function (e) {
      var t = e.tags || {}, k = kindOf(t), g = k && geomOf(e); if (!g) return;
      var lines = g.pt ? null : g.lines, closed = !!g.closed && KINDS[k].area !== false && k !== "power" && k !== "road" && k !== "rail" && k !== "fence" && k !== "river";
      var nb = { m: Infinity, p: null }, inDz = false;
      if (g.pt) { nb = { m: Math.hypot.apply(null, local(dz.pi, g.pt)), p: g.pt }; inDz = inside(dz, g.pt, HZ_MARGIN); }
      else lines.forEach(function (ln) {
        var n = nearest(dz.pi, closed && (ln[0][0] !== ln[ln.length - 1][0] || ln[0][1] !== ln[ln.length - 1][1]) ? ln.concat([ln[0]]) : ln); if (n.m < nb.m) nb = n;
        if (closed && inRing(dz.pi, ln)) nb = { m: 0, p: dz.pi };
        if (!inDz) inDz = touches(Object.assign({}, dz, { len_m: dz.len_m + 2 * HZ_MARGIN, wid_m: dz.wid_m + 2 * HZ_MARGIN, pi_lead_m: (+dz.pi_lead_m || 0) + HZ_MARGIN }), ln, closed);
      });
      if (!isFinite(nb.m)) return;
      var s = sum[k]; s.n++; if (inDz) s.inDz++;
      var it = { k: k, name: String(t.name || t.ref || "").slice(0, 60), m: nb.m, brg: nb.m > 0.5 ? bearing(dz.pi, nb.p) : null, inDz: inDz, id: e.type + "/" + e.id, pt: g.pt || null, line: lines && lines[0], closed: closed,
        extra: k === "power" ? (t.voltage ? Math.round(+String(t.voltage).split(/[;,]/)[0] / 1000) + " kV" : "") : k === "mast" && t.height ? t.height + " m tall" : k === "road" ? t.highway : "" };
      if (!s.near || nb.m < s.near.m) s.near = it;
      items.push(it);
    });
    return { items: items, sum: sum };
  }
  function loadHz() {
    var dz = ST.dz, run = ++ST.run.hz; ST.hzBusy = true; ST.hzErr = ""; ST.hzT0 = Date.now(); ST.hzTry = ""; paint();
    overpass(hzQuery(dz), function () { return run === ST.run.hz; }).then(function (j) {
      if (run !== ST.run.hz) return;
      ST.hz = analyseHz(j.elements || [], dz); ST.hz.at = Date.now(); ST.hz.r = hzRadius(dz); ST.hz.dzKey = dzKey(dz);
    }).catch(function (e) { if (run === ST.run.hz) { ST.hz = null; ST.hzErr = e.message || "failed"; } }).then(function () { if (run === ST.run.hz) { ST.hzBusy = false; paint(); drawHz(); } });
  }
  function dzKey(dz) { return [dz.pi.join(","), dz.axis, dz.shape, dz.len_m, dz.wid_m, dz.pi_lead_m].join("|"); }
  function loadHosp() {
    var dz = ST.dz, run = ++ST.run.hosp, P = W.OSAP_HOSP && W.OSAP_HOSP.provider && W.OSAP_HOSP.provider("osm");
    if (!P || !P.stored) { ST.hospErr = "the hospital data layer is not loaded on this page"; paint(); return; }
    ST.hospBusy = true; ST.hospErr = ""; paint();
    P.stored(dz.pi, HOSP_R).then(function (st) {
      if (run !== ST.run.hosp) return;
      var H = (st.els || []).filter(function (e) { var t = e.tags || {}; return (t.amenity === "hospital" || t.healthcare === "hospital") && (t.name || t["name:en"]); }).map(function (e) {
        var p = [e.lat, e.lon], t = e.tags; return { name: t["name:en"] || t.name, local: t["name:en"] && t.name !== t["name:en"] ? t.name : "", p: p, m: Math.hypot.apply(null, local(dz.pi, p)), brg: bearing(dz.pi, p), er: t.emergency || "", heli: !!(t["emergency:helipad"] || t.helipad), url: "https://www.openstreetmap.org/" + (e.type || "node") + "/" + e.id };
      }).filter(function (h) { return h.m <= HOSP_R; }).sort(function (a, b) { return a.m - b.m; });
      ST.hosp = { list: H.slice(0, HOSP_N), n: H.length, at: st.at || "", missing: st.missing || [] };
    }).catch(function (e) { if (run === ST.run.hosp) { ST.hosp = null; ST.hospErr = (e && e.message) || "failed"; } }).then(function () { if (run === ST.run.hosp) { ST.hospBusy = false; paint(); if (ST.gnd.on) loadGnd(); } });
  }
  /* ---------- ground evacuation: road distance and drive time to each hospital, and the road route to one ---------- */
  function road() { return W.OSAP_MEDPLAN && W.OSAP_MEDPLAN.road; }
  function loadGnd() {
    var G0 = ST.gnd, H = ST.hosp && ST.hosp.list, R = road(); gLayer.clearLayers(); G0.rt = null; G0.rtErr = "";
    if (!H || !H.length) { paint(); return; }
    if (!R) { G0.err = "the medical plan's road routing is not loaded on this page"; paint(); return; }
    var run = ++ST.run.gnd, pi = ST.dz.pi.slice(), P = H.map(function (x) { return { lat: x.p[0], lon: x.p[1], m: x.m }; });
    G0.busy = true; G0.err = ""; G0.host = ""; paint();
    function take() { H.forEach(function (x, i) { var q = P[i]; x.road = q.s != null && isFinite(q.s) ? { s: q.s, m: q.rm, est: !!q.est } : null; }); }
    R.times(pi, P).then(function (host) { if (run !== ST.run.gnd) return; take(); G0.host = String(host || "").split("/")[2] || ""; },
      function (e) { if (run !== ST.run.gnd) return; take(); G0.err = (e && e.message) || "failed"; })
      .then(function () {
        if (run !== ST.run.gnd) return;
        G0.busy = false;
        /* the road route to the hospital nearest by road, or the one picked before */
        var by = H.map(function (x, i) { return [x.road && !x.road.est ? x.road.s : Infinity, i]; }).sort(function (a, b) { return a[0] - b[0]; });
        G0.sel = Math.min(G0.sel, H.length - 1); if (!(G0.picked && G0.sel >= 0)) G0.sel = by[0][0] < Infinity ? by[0][1] : 0;
        paint(); if (!G0.err) loadRoute(G0.sel);
      });
  }
  function loadRoute(i) {
    var G0 = ST.gnd, H = ST.hosp && ST.hosp.list, R = road(), x = H && H[i]; if (!x || !R) return;
    var run = ++ST.run.gnd; G0.sel = i; G0.rt = null; G0.rtErr = ""; G0.rtBusy = true; gLayer.clearLayers(); paint();
    R.route(ST.dz.pi.slice(), { lat: x.p[0], lon: x.p[1] }).then(function (r) { if (run !== ST.run.gnd) return; G0.rt = { i: i, r: r }; },
      function (e) { if (run === ST.run.gnd) G0.rtErr = (e && e.message) || "failed"; })
      .then(function () { if (run !== ST.run.gnd) return; G0.rtBusy = false; paint(); drawGnd(); });
  }
  function drawGnd() {
    gLayer.clearLayers(); var rt = ST.gnd.rt; if (!ST.gnd.on || !rt || !isOpen() || !rt.r.line || rt.r.line.length < 2) return;
    var o = { pane: "dzpane", renderer: rend, interactive: false };
    L.polyline(rt.r.line, Object.assign({ color: "#fff", weight: 7, opacity: 0.85 }, o)).addTo(gLayer);
    L.polyline(rt.r.line, Object.assign({ color: "#2e7d32", weight: 4 }, o)).addTo(gLayer);
    var x = ST.hosp.list[rt.i]; if (x) L.marker(x.p, { pane: "dzpane", interactive: false, icon: L.divIcon({ className: "dzlbl", html: "<span>" + esc(x.name) + ": " + fmtM(rt.r.m) + ", " + mins(rt.r.s) + " by road</span>", iconSize: [0, 0] }) }).addTo(gLayer);
  }
  function mins(s) { return s < 5940 ? Math.max(1, Math.round(s / 60)) + " min" : Math.floor(s / 3600) + " h " + p2(Math.round(s / 60) % 60); }
  function roadTxt(x) { var r = x.road; return !r ? "-" : (r.est ? "~" : "") + fmtM(r.m) + ", " + (r.est ? "~" : "") + mins(r.s) + (r.est ? " (estimate)" : ""); }
  /* each lookup has its own run number: a Refresh of one (winds) no longer orphans the others, which left the hazards on
     "Asking OpenStreetMap" for good (Shane 2026-10-27: "Hazards never populated") */
  function refresh(what) {
    if (!what || what.wx) { ST.wx = null; loadWx(); }
    if (!what || what.hz) { ST.hz = null; hzLayer.clearLayers(); loadHz(); }
    if (!what || what.hosp) { ST.hosp = null; ST.run.gnd++; ST.gnd.busy = ST.gnd.rtBusy = false; ST.gnd.rt = null; ST.gnd.picked = false; gLayer.clearLayers(); loadHosp(); }
  }

  /* ---------- light ---------- */
  function light() {
    var C = W.OSAP_ILLUM && W.OSAP_ILLUM.core, dz = ST.dz; if (!C) return null;
    var off = ST.wx ? ST.wx.off : Math.round(dz.pi[1] / 15) * 3600, tot = dz.tot ? Date.parse(dz.tot) : Date.now();
    /* the night round the drop: from local noon before it to local noon after it */
    var lt = tot + off * 1000, noon = Math.floor((lt - 12 * 36e5) / 864e5) * 864e5 + 12 * 36e5 - off * 1000;
    var n = C.night(dz.pi[0], dz.pi[1], noon, noon + 864e5), alt = C.sunAlt(tot, dz.pi[0], dz.pi[1]);
    return { n: n, off: off, at: lightAt(alt), alt: alt, tot: tot, phase: (n.il && n.il.name) || "" };
  }

  /* ---------- the window ---------- */
  var el = null;
  var CSS =
    "#dzso{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.45);overflow:auto;padding:16px}#dzso[hidden]{display:none}" +
    "#dzso .cbox{max-width:860px;margin:0 auto;background:var(--surface,#fff);color:var(--ink,#111);border-radius:8px;padding:10px 16px 16px;font-size:13px;line-height:1.45}" +
    "#dzso .chead{display:flex;align-items:center;gap:8px;position:sticky;top:-16px;background:var(--surface,#fff);padding:6px 0;z-index:1;flex-wrap:wrap}#dzso .chead h2{margin:0;font-size:16px;flex:1}" +
    "#dzso .chead .x{font-size:13px;min-height:32px;border:1px solid var(--line,#bbb);background:var(--surface,#fff);color:inherit;border-radius:5px;padding:3px 10px;cursor:pointer}" +
    "#dzso h3{font-size:13.5px;margin:14px 0 4px;padding-top:8px;border-top:1px solid var(--line,#ddd)}#dzso p{margin:4px 0}#dzso .obs{color:var(--muted,#555);font-size:12px}" +
    "#dzso .tag{font-size:10.5px;border:1px solid var(--line,#bbb);border-radius:3px;padding:0 4px;color:var(--muted,#555);font-weight:400}" +
    "#dzso .g{display:grid;grid-template-columns:auto 1fr;gap:5px 10px;align-items:center}#dzso .g>span{color:var(--muted,#555)}#dzso .r{display:flex;flex-wrap:wrap;gap:5px 8px;align-items:center}" +
    "#dzso button{font:inherit;font-size:12.5px;border:1px solid var(--line,#bbb);background:var(--surface,#fff);color:inherit;border-radius:5px;padding:3px 9px;min-height:30px;cursor:pointer}" +
    "#dzso button.pri{background:#0b7285;border-color:#0b7285;color:#fff;font-weight:700}#dzso button[aria-pressed=true]{background:var(--accent-soft,#e3f2f4);border-color:var(--accent,#0b7285)}" +
    "#dzso input,#dzso select{font:inherit;font-size:12.5px;max-width:100%}#dzso input[type=number]{width:5.5em}#dzso input.w{width:min(22em,100%)}" +
    "#dzso .pt{font-family:ui-monospace,Menlo,Consolas,monospace}#dzso .tw{overflow-x:auto}#dzso table{border-collapse:collapse;font-size:12px;width:100%}#dzso th,#dzso td{border-bottom:1px solid var(--line,#e2e2e2);padding:3px 5px;text-align:left;vertical-align:top}" +
    "#dzso th{font-weight:600;background:var(--surface2,#f4f6f8)}#dzso tr.tot td{background:rgba(255,235,59,.18)}" +
    "#dzso .v{font-weight:700;white-space:nowrap}#dzso .v.ok{color:#2e7d32}#dzso .v.check{color:#e65100}#dzso .v.out{color:#b71c1c}" +
    "#dzso .bad{color:#b71c1c;font-weight:600}#dzso .warn{border:1px solid #e65100;border-left-width:4px;padding:5px 8px;margin:8px 0;border-radius:4px}" +
    "#dzso .chk label{display:flex;gap:6px;align-items:flex-start;margin:3px 0}#dzso .fl{display:grid;grid-template-columns:minmax(10em,auto) 1fr;gap:4px 10px;align-items:center}#dzso .fl input{width:100%}" +
    "#dzso .meas{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;border:1px solid var(--line,#ddd);border-radius:6px;padding:6px 9px}#dzso .big{font-size:15px}" +
    ".dzh{border-radius:50%;background:#fff;border:2px solid #c49000;box-shadow:0 1px 4px rgba(0,0,0,.5);touch-action:none;cursor:grab;display:flex;align-items:center;justify-content:center;font:700 17px/1 system-ui,sans-serif;color:#7a5a00;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}" +
    ".dzh.dzh-c{border-radius:5px;width:18px!important;height:18px!important;margin:-9px 0 0 -9px!important;cursor:nwse-resize;background:#ffeb3b;border-color:#000}.dzh.dzh-m{background:transparent;border:2px dashed #fff;box-shadow:0 0 0 1px rgba(0,0,0,.6);cursor:move}" +
    ".dzh.dzh-c::after{content:'';position:absolute;inset:-12px}.dzh.on{outline:3px solid #0b7285}.dztip span{transform:translate(18px,-130%);color:#fff}.dztip span:empty{display:none}" +
    ".dzlbl span{display:inline-block;transform:translate(9px,-50%);white-space:nowrap;font:600 11px/1.2 system-ui,sans-serif;background:rgba(0,0,0,.72);color:#ffeb3b;border-radius:3px;padding:1px 4px}" +
    "@media (max-width:700px){#dzso{padding:6px}#dzso .g,#dzso .fl{grid-template-columns:1fr;gap:2px 0}#dzso .g>span{margin-top:6px;font-size:12px}}" +
    ".dzp h2{font-size:15px;margin:10px 0 4px}.dzp table{border-collapse:collapse;width:100%;font-size:10px}.dzp th,.dzp td{border:1px solid #bbb;padding:2px 4px;text-align:left;vertical-align:top}.dzp th{background:#eef1f4}" +
    ".dzp .kv{display:grid;grid-template-columns:auto 1fr;gap:1px 10px;font-size:10.5px}.dzp .kv span{color:#444}.dzp svg{width:100%;max-width:640px;height:auto;border:1px solid #bbb}.dzp p{margin:3px 0;font-size:10.5px}";
  function ensure() {
    if (el) return el;
    if (!D.getElementById("dzso-css")) { var st = D.createElement("style"); st.id = "dzso-css"; st.textContent = CSS; D.head.appendChild(st); }
    el = D.createElement("div"); el.id = "dzso"; el.hidden = true; el.setAttribute("role", "dialog"); el.setAttribute("aria-labelledby", "dzso-h");
    el.innerHTML = '<div class="cbox"></div>';
    D.body.appendChild(el);
    el.addEventListener("click", onClick); el.addEventListener("change", onChange); el.addEventListener("input", onInput);
    el.addEventListener("click", function (e) { if (e.target === el) close(); });
    el.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    if (W.OSAP_SPLIT) W.OSAP_SPLIT.add(el, ".chead");
    D.addEventListener("osap:split", function () { if (!el.hidden) paint(); });
    if (store()) store().on(function (id) { if (!isOpen() || !ST.dz || (id && id !== ST.dz.id)) return; var d = store().get(ST.dz.id); if (d && d.updated > ST.dz.updated) { ST.dz = d; paint(); drawDz(); } });
    return el;
  }
  function isOpen() { return !!el && !el.hidden; }
  function keep() { if (!ST.saved || !store()) return; var d = store().save(ST.dz); if (d) ST.dz = d; }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  function sel(name, list, cur) { return '<select data-f="' + name + '">' + list.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(cur) ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select>"; }
  function totInput(dz) { return dz.tot ? dz.tot.slice(0, 16) : ""; }
  function vtxt(v) { return v.state === "ok" ? "Within limits" : v.state === "check" ? "Check" : "Outside limits"; }

  function paint() {
    if (!el) return;
    var dz = ST.dz, box = el.querySelector(".cbox"), sc = box.scrollTop;
    var h = '<div class="chead"><h2 id="dzso-h">DZSO sheet: ' + esc(dz.name) + ' <span class="tag" tabindex="0" title="Worked out by fixed rules from open data and model forecasts. Not an official drop zone survey, not analyst-approved and not AI.">Planning aid</span></h2>' +
      '<button type="button" data-dz="pdf">Export PDF</button>' + (W.OSAP_SPLIT ? W.OSAP_SPLIT.btn() : "") + '<button type="button" class="x" data-dz="close">Close</button></div>';
    h += '<p class="obs">For the Drop Zone Safety Officer. Model winds and open map data only: the DZSO\'s own reading at the DZ and the aircrew decide. Not an official DZ survey.</p>';
    h += secDz(dz) + secDrop(dz) + secMeas() + secWx(dz) + secLight() + secHz(dz) + secMed(dz) + secFields(dz) + secMethod();
    box.innerHTML = h; box.scrollTop = sc;
  }
  function secDz(dz) {
    var list = store() ? store().list() : [], g = G(), decl = g && g.decl ? g.decl(dz.pi[0], dz.pi[1]) : null;
    var mag = isFinite(decl) ? (((dz.axis - decl) % 360) + 360) % 360 : null;
    var j = Math.max(1, +(dz.fields.jumpers || 1)), need = minLen(j, LIM.perYd), needW = 600 * YD;
    var h = "<h3>Drop zone</h3><div class=\"g\">" +
      "<span>Saved drop zones</span><div class=\"r\">" + (list.length ? sel("pick", [["", ST.saved ? "This one" : "Choose a saved DZ"]].concat(list.filter(function (d) { return d.id !== dz.id; }).map(function (d) { return [d.id, d.name + (d.cc ? " (" + d.cc.toUpperCase() + ")" : "")]; })), "") : '<i class="obs">none saved yet</i>') +
      '<button type="button" class="pri" data-dz="save">' + (ST.saved ? "Saved" : "Save drop zone") + "</button>" + (ST.saved ? '<button type="button" data-dz="del">Delete</button>' : "") + "</div>" +
      '<span>Name</span><div><input class="w" data-f="name" value="' + esc(dz.name) + '" maxlength="80"></div>' +
      '<span>Point of impact</span><div class="r"><b class="pt">' + esc(grid(dz.pi)) + "</b> <span class=\"obs pt\">" + dz.pi[0].toFixed(5) + ", " + dz.pi[1].toFixed(5) + "</span>" +
      '<button type="button" data-dz="pick" aria-pressed="' + ST.arm + '">Pick on map</button><button type="button" data-dz="centre">Map centre</button><button type="button" data-dz="show">Show on map</button>' +
      '<button type="button" data-dz="edit" aria-pressed="' + ST.edit + '">Edit on map</button></div>' +
      (ST.edit ? '<span></span><p class="obs">On the map: drag the dashed ring at the PI to move the DZ, ' + (dz.shape === "circle" ? "the square on the edge to change its size" : "a yellow corner to change its size") + ", and \u21bb on the run-in line to turn the approach." + (ST.saved ? " Each change is saved." : " Save the drop zone to keep the changes.") + "</p>" : "") +
      '<span>Type a grid</span><div class="r"><input class="w" data-f="grid" placeholder="MGRS or lat, lon" aria-label="Point of impact as MGRS or lat, lon"><button type="button" data-dz="grid">Set</button></div>' +
      "<span>Elevation</span><div>" + (dz.elev_m != null ? Math.round(dz.elev_m) + " m / " + Math.round(dz.elev_m / FT) + " ft MSL <span class=\"obs\">(model terrain, about 90 m detail)</span>" : ST.wxBusy ? "reading…" : "not known") + "</div>" +
      "<span>Shape</span><div class=\"r\">" + sel("shape", [["rect", "Rectangle"], ["circle", "Circle"]], dz.shape) + "</div>" +
      (dz.shape === "circle" ? '<span>Diameter</span><div class="r"><input type="number" min="10" max="20000" step="10" data-f="len_m" value="' + dz.len_m + '"> m (' + Math.round(dz.len_m / YD) + " yd)</div>"
        : '<span>Length x width</span><div class="r"><input type="number" min="10" max="20000" step="10" data-f="len_m" value="' + dz.len_m + '"> x <input type="number" min="10" max="20000" step="10" data-f="wid_m" value="' + dz.wid_m + '"> m (' + Math.round(dz.len_m / YD) + " x " + Math.round(dz.wid_m / YD) + " yd)</div>" +
          '<span>PI from leading edge</span><div class="r"><input type="number" min="0" max="20000" step="10" data-f="pi_lead_m" value="' + dz.pi_lead_m + '"> m (' + Math.round(dz.pi_lead_m / YD) + " yd)</div>") +
      '<span>Run-in axis</span><div class="r"><input type="number" min="0" max="359" step="1" data-f="axis" value="' + Math.round(dz.axis) + '">° true' + (mag !== null ? " = " + dir3(mag) + "° magnetic <span class=\"obs\">(declination " + Math.abs(decl).toFixed(1) + "° " + (decl >= 0 ? "E" : "W") + ", WMM2025)</span>" : "") + "</div>" +
      '<span>Jumpers per pass</span><div class="r"><input type="number" min="1" max="200" step="1" data-f="jumpers" value="' + esc(dz.fields.jumpers || "") + '"> per door, <input type="number" min="1" max="200" step="1" data-f="yd" value="' + LIM.perYd + '"> yd each after the first</div></div>';
    if (dz.shape !== "circle") {
      var shortL = dz.len_m < need - 1, shortW = dz.wid_m < needW - 1;
      h += '<p class="' + (shortL || shortW ? "bad" : "obs") + '">Size check (planning): ' + j + " jumper" + (j > 1 ? "s" : "") + " a pass need about " + Math.round(need / YD) + " yd (" + Math.round(need) + " m) long and 600 yd (" + Math.round(needW) + " m) wide" +
        (shortL || shortW ? ": this DZ is " + (shortL ? "short" : "") + (shortL && shortW ? " and " : "") + (shortW ? "narrow" : "") + " for it." : ": this DZ is big enough.") +
        ' <span class="obs">Rule of thumb for one aircraft with personnel (600 yd plus a length per extra jumper); check AFMAN 13-217 and your aircraft.</span></p>';
    }
    return h;
  }
  function secDrop(dz) {
    var p = prof(LIM.prof), fl = W.OSAP_FLIGHT && W.OSAP_FLIGHT.forDz && ST.saved ? W.OSAP_FLIGHT.forDz(dz.id) : null;
    var h = "<h3>Drop</h3><div class=\"g\">" +
      '<span>Aircraft</span><div class="r">' + acftSel(dz.acft) + "</div>" +
      '<span>Drop time (Zulu)</span><div class="r"><input type="datetime-local" data-f="tot" value="' + esc(totInput(dz)) + '"> ' + (dz.tot ? '<span class="obs">' + esc(zd(Date.parse(dz.tot)) + " " + zc(Date.parse(dz.tot))) + (ST.wx ? ", " + lc(Date.parse(dz.tot), ST.wx.off) + " local" : "") + "</span>" : '<span class="obs">not set: the next 12 hours are shown</span>') + "</div>" +
      '<span>Drop altitude</span><div class="r"><input type="number" min="100" max="40000" step="50" data-f="alt_ft" value="' + (dz.alt_ft || "") + '"> ft above the DZ' + (dz.alt_ft && dz.elev_m != null ? ' = <b>' + Math.round(dz.alt_ft + dz.elev_m / FT) + " ft MSL</b>" : "") + "</div>" +
      "<span>Load</span><div class=\"r\">" + sel("prof", PROFILES.map(function (x) { return [x.id, x.label]; }), LIM.prof) + "</div>" +
      '<span>Limits</span><div class="r">Surface wind <input type="number" min="1" max="60" step="1" data-f="lwind" value="' + LIM.wind + '"> kt, gusts <input type="number" min="1" max="60" step="1" data-f="lgust" value="' + LIM.gust + '"> kt, visibility <input type="number" min="0" max="50" step="0.5" data-f="lvis" value="' + LIM.vis + '"> km, cloud base <input type="number" min="0" max="5000" step="100" data-f="lpad" value="' + LIM.pad + '"> ft above the drop altitude</div>' +
      '<span>Drift constant K</span><div class="r"><input type="number" min="0" max="10" step="0.1" data-f="lk" value="' + LIM.K + '"> <span class="obs">0 = no drift worked out</span></div></div>' +
      '<p class="obs">' + esc(p.note) + "</p>";
    if (fl) h += '<p>From the flight plan: ' + esc([fl.acft, fl.alt_ft ? fl.alt_ft + " ft" : "", fl.tot ? zd(Date.parse(fl.tot)) + " " + zc(Date.parse(fl.tot)) : "", isFinite(fl.axis) ? "run-in " + dir3(fl.axis) + "°" : "", fl.ias_kt ? fl.ias_kt + " kt" : ""].filter(Boolean).join(", ")) + ' <button type="button" data-dz="fromflight">Use these</button></p>';
    return h;
  }
  /* the aircraft drop-down: the shared list (OSAP_DZ.aircraft, also the flight planner's), with a typed name kept as its own
     option and "Other" for typing one */
  function acftSel(cur) {
    var A = ((store() && store().aircraft) || []).filter(function (a) { return a.id !== "custom"; }), known = A.some(function (a) { return a.name === cur; });
    var typed = ST.acOther || (cur && !known), h = '<select data-f="acsel" aria-label="Aircraft"><option value=""' + (!cur && !ST.acOther ? " selected" : "") + ">Choose the aircraft</option>" +
      A.map(function (a) { return '<option value="' + esc(a.name) + '"' + (a.name === cur ? " selected" : "") + ">" + esc(a.name) + "</option>"; }).join("") +
      '<option value="__other"' + (typed ? " selected" : "") + ">Other (type it)</option></select>";
    return h + (typed ? '<input class="w" data-f="acft" value="' + esc(cur) + '" maxlength="40" placeholder="Type the aircraft" aria-label="Aircraft (typed)">' : "");
  }
  function measVerdict() {
    var m = ST.meas, kt = num(m.kt), g = num(m.gust); if (kt === null && g === null) return null;
    return verdict({ kt: kt === null ? NaN : kt, gust: g === null ? NaN : g }, { wind: LIM.wind, gust: LIM.gust });
  }
  function secMeas() {
    var v = measVerdict(), m = ST.meas;
    return "<h3>Reading at the DZ now</h3><div class=\"meas\">" +
      '<label>Wind <input type="number" min="0" max="80" step="1" data-m="kt" value="' + esc(m.kt) + '"> kt</label><label>Gust <input type="number" min="0" max="80" step="1" data-m="gust" value="' + esc(m.gust) + '"> kt</label>' +
      '<label>From <input type="number" min="0" max="360" step="5" data-m="dir" value="' + esc(m.dir) + '">°</label>' +
      '<span class="big" data-meas>' + (v ? '<span class="v ' + v.state + '">' + vtxt(v) + "</span> " + esc(v.why.join("; ")) : '<span class="obs">Type the anemometer reading to check it against the limits.</span>') + "</span></div>";
  }
  function secWx(dz) {
    var h = "<h3>Winds and weather</h3>";
    if (ST.wxBusy) return h + '<p class="obs">Asking Open-Meteo for the model forecast…</p>';
    if (ST.wxErr) return h + '<p class="bad">The forecast could not be read: ' + esc(ST.wxErr) + '. <button type="button" data-dz="wx">Try again</button></p>';
    if (!ST.wx) return h;
    var H = hours(), tot = dz.tot ? Date.parse(dz.tot) : NaN, last = ST.wx.j.hourly.time.slice(-1)[0] * 1000;
    if (!H.length) return h + '<p class="obs">' + (isFinite(tot) && tot > last ? "The drop time is past the end of the forecast (" + esc(zd(last) + " " + zc(last)) + "). The table fills in nearer the time." : "No forecast hours for that time.") + "</p>";
    var lvl = (H[0].lv || []).map(function (l) { return l.lab; }), off = ST.wx.off;
    h += '<div class="tw"><table><thead><tr><th>Time</th><th>Surface wind</th><th>Gust</th>' + lvl.map(function (l) { return "<th>" + esc(l) + "</th>"; }).join("") +
      "<th>Mean to " + (dz.alt_ft || "?") + " ft</th><th>Drift</th><th>Cloud, vis</th><th>Check</th></tr></thead><tbody>" +
      H.map(function (x) {
        var lv = {}; (x.lv || []).forEach(function (l) { lv[l.lab] = l; });
        return '<tr class="' + (x.tot ? "tot" : "") + '"><td><b>' + zc(x.t) + "</b><br>" + lc(x.t, off) + "</td><td>" + dir3(x.dir) + "° " + Math.round(x.kt) + " kt</td><td>" + (isFinite(x.gust) ? Math.round(x.gust) + " kt" : "-") + "</td>" +
          lvl.map(function (k) { var l = lv[k]; return "<td>" + (l ? dir3(l.dir) + "° " + Math.round(l.kt) + (/hPa/.test(k) ? '<br><span class="obs">' + Math.round(l.h / FT / 100) * 100 + " ft</span>" : "") : "-") + "</td>"; }).join("") +
          "<td>" + (x.mean ? dir3(x.mean.dir) + "° " + x.mean.kt.toFixed(1) + " kt" : "-") + "</td><td>" + (x.drift !== null ? Math.round(x.drift) + " m<br><span class=\"obs\">RP " + dir3(x.mean.dir) + "° from PI</span>" : "-") + "</td>" +
          "<td>" + (isFinite(x.low) ? Math.round(x.low) + "% low" : "") + (isFinite(x.base) ? "<br>base ~" + Math.round(x.base / 100) * 100 + " ft" : "") + (isFinite(x.vis) ? "<br>" + (x.vis / 1000).toFixed(x.vis < 10000 ? 1 : 0) + " km" : "") + (x.pr > 0 ? "<br>" + x.pr.toFixed(1) + " mm" : "") + "</td>" +
          '<td><span class="v ' + x.v.state + '">' + vtxt(x.v) + "</span>" + (x.v.why.length ? '<br><span class="obs">' + esc(x.v.why.join("; ")) + "</span>" : "") + "</td></tr>";
      }).join("") + "</tbody></table></div>";
    var th = totHour();
    h += '<p class="obs">Open-Meteo model forecast (' + esc(ST.wx.tz || "local") + "), read " + zc(ST.wx.at) + '; not an observation and not an official forecast. Winds are where they blow from, true. Drift D = K × A × V with K ' + LIM.K + ", A the drop altitude in hundreds of feet and V the mean wind from the ground to the drop altitude; the drift-only release point lies that far upwind of the PI" +
      (th && th.rp ? " (" + esc(grid(th.rp)) + " at " + zc(th.t) + ", drawn on the map)" : "") + ". It leaves out forward throw and is not the aircrew's computed air release point. QNH (model) " + (th && isFinite(th.qnh) ? Math.round(th.qnh) + " hPa" : H[0] && isFinite(H[0].qnh) ? Math.round(H[0].qnh) + " hPa" : "-") + '. <button type="button" data-dz="wx">Refresh</button></p>';
    return h;
  }
  function secLight() {
    var L0 = light(); if (!L0) return "<h3>Light</h3><p class=\"obs\">Night illumination is not loaded on this page.</p>";
    var n = L0.n, off = L0.off;
    function t(ms) { return ms == null ? "-" : "<b>" + zc(ms) + "</b> " + lc(ms, off); }
    var rows = [["Sunset", n.rise.down], ["EECT", n.civil.down], ["EENT", n.naut.down], ["BMNT", n.naut.up], ["BMCT", n.civil.up], ["Sunrise", n.rise.up]];
    return "<h3>Light</h3><p>At the drop time (" + zc(L0.tot) + "): <b>" + esc(L0.at) + "</b> <span class=\"obs\">(sun " + L0.alt.toFixed(1) + "°)</span>. Moon " + Math.round(n.il.frac * 100) + "% lit" + (L0.phase ? ", " + esc(L0.phase.toLowerCase()) : "") +
      (n.moonrise.length ? ", rises " + n.moonrise.map(zc).join(", ") : "") + (n.moonset.length ? ", sets " + n.moonset.map(zc).join(", ") : "") + (n.moonAlways ? ", " + (n.moonAlways === "up" ? "up all night" : "down all night") : "") + ".</p>" +
      '<div class="tw"><table><tr>' + rows.map(function (r) { return "<th>" + r[0] + "</th>"; }).join("") + "</tr><tr>" + rows.map(function (r) { return "<td>" + t(r[1]) + "</td>"; }).join("") + "</tr></table></div>" +
      '<p class="obs">Zulu then local. Computed on this device for a flat horizon at sea level (OSAP night illumination method); terrain moves real times.</p>';
  }
  function hzBusyTxt(dz) {
    return "Asking OpenStreetMap (Overpass" + (ST.hzTry ? ": " + esc(ST.hzTry) : "") + ") for power lines, water, trees, roads and buildings within " + fmtM(hzRadius(dz)) + "… " +
      Math.round((Date.now() - ST.hzT0) / 1000) + ' s <button type="button" data-dz="hz">Try again</button>';
  }
  /* the busy line only, so a long lookup shows it is still going without repainting the whole sheet under the finger */
  function paintHz() { var b = el && el.querySelector("[data-hzbusy]"); if (b && ST.hzBusy) b.innerHTML = hzBusyTxt(ST.dz); }
  setInterval(function () { if (ST.hzBusy && isOpen()) paintHz(); }, 1000);
  function secHz(dz) {
    var h = "<h3>Hazards in and round the DZ</h3>";
    if (ST.hzBusy) return h + '<p class="obs" data-hzbusy>' + hzBusyTxt(dz) + "</p>";
    if (ST.hzErr) return h + '<p class="bad">The hazard lookup failed: ' + esc(ST.hzErr) + '. That is a failure, not "no hazards". <button type="button" data-dz="hz">Try again</button></p>';
    if (!ST.hz) return h;
    var stale = ST.hz.dzKey !== dzKey(dz), S = ST.hz.sum, inn = ST.hz.items.filter(function (i) { return i.inDz; }).sort(function (a, b) { return KINDS[b.k].sev - KINDS[a.k].sev || a.m - b.m; });
    if (stale) h += '<p class="warn">The DZ has moved or changed size since this lookup. <button type="button" data-dz="hz">Look again</button></p>';
    var hot = inn.filter(function (i) { return KINDS[i.k].sev >= 3; });
    if (hot.length) h += '<p class="warn"><b>In or within ' + HZ_MARGIN + " m of the DZ:</b> " + esc(hot.slice(0, 8).map(function (i) { return KINDS[i.k].n.replace(/s$/, "").replace(/, .*$/, "") + (i.name ? " (" + i.name + ")" : "") + " " + fmtM(i.m) + " " + compass(i.brg || 0) + " of the PI"; }).join("; ")) + (hot.length > 8 ? " and " + (hot.length - 8) + " more" : "") + "</p>";
    h += '<div class="tw"><table><thead><tr><th>Hazard</th><th>Within ' + fmtM(ST.hz.r) + '</th><th>In DZ +' + HZ_MARGIN + ' m</th><th>Nearest to the PI</th></tr></thead><tbody>' +
      ORDER.map(function (k) {
        var s = S[k], n = s.near;
        return '<tr><td><span style="display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;background:' + KINDS[k].c + '"></span>' + KINDS[k].n + "</td><td>" + s.n + '</td><td class="' + (s.inDz && KINDS[k].sev >= 2 ? "bad" : "") + '">' + s.inDz + "</td><td>" +
          (n ? (n.m < 1 ? "at the PI" : fmtM(n.m) + " " + compass(n.brg) + " (" + dir3(n.brg) + "°)") + (n.name ? ", " + esc(n.name) : "") + (n.extra ? ", " + esc(n.extra) : "") : "none mapped") + "</td></tr>";
      }).join("") + "</tbody></table></div>" +
      '<p class="obs">OpenStreetMap through Overpass, read ' + zc(ST.hz.at) + ". Only what volunteers have mapped: wires, fences, ditches, single trees and poles are often missing. Walk the DZ. " + (inn.length ? inn.length + " mapped features touch the DZ or its " + HZ_MARGIN + " m margin." : "") + ' <button type="button" data-dz="hz">Refresh</button></p>';
    return h;
  }
  function secMed(dz) {
    var h = "<h3>Medical and evacuation</h3>";
    if (ST.hospBusy) h += '<p class="obs">Reading OSAP\'s stored hospital list…</p>';
    else if (ST.hospErr) h += '<p class="bad">The hospital list could not be read: ' + esc(ST.hospErr) + ".</p>";
    else if (ST.hosp && !ST.hosp.list.length) h += '<p class="obs">No named hospital in OSAP\'s stored copy within ' + fmtM(HOSP_R) + (ST.hosp.missing.length ? " (not yet stored: " + esc(ST.hosp.missing.join(", ")) + ")" : "") + ". Use the medical plan for a wider search.</p>";
    else if (ST.hosp) h += '<div class="tw"><table><thead><tr><th>Hospital</th><th>From the PI</th><th>Air at ' + LIM.kn + " kt</th>" + (ST.gnd.on ? "<th>By road</th>" : "") + "<th>Emergency dept.</th></tr></thead><tbody>" +
      ST.hosp.list.map(function (x, i) {
        return '<tr' + (ST.gnd.on && ST.gnd.sel === i && (ST.gnd.rt || ST.gnd.rtBusy) ? ' class="tot"' : "") + '><td><a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.name) + "</a>" + (x.local ? '<br><span class="obs">' + esc(x.local) + "</span>" : "") + "</td><td>" + fmtM(x.m) + " " + compass(x.brg) + " (" + dir3(x.brg) + "°)</td><td>" +
          Math.max(1, Math.round(x.m / (LIM.kn * KT) / 60)) + " min</td>" +
          (ST.gnd.on ? "<td>" + (ST.gnd.busy ? "…" : esc(roadTxt(x))) + (x.road && !ST.gnd.busy ? ' <button type="button" data-dz="groute" data-i="' + i + '" aria-pressed="' + (ST.gnd.sel === i && !!ST.gnd.rt) + '">Route</button>' : "") + "</td>" : "") +
          "<td>" + (x.er === "yes" ? "Mapped yes" : x.er === "no" ? "Mapped no" : "Not mapped") + (x.heli ? ", helipad" : "") + "</td></tr>";
      }).join("") + "</tbody></table></div>" + secGnd() +
      '<p class="obs">Straight-line distance; air time at <input type="number" min="40" max="400" step="10" data-f="kn" value="' + LIM.kn + '" aria-label="Cruise speed in knots"> kt with no start-up or loading time. From OSAP\'s stored copy of OpenStreetMap' + (ST.hosp.at ? " (" + esc(ST.hosp.at.slice(0, 10)) + ")" : "") + "; trauma level and capability are in the medical plan.</p>";
    h += '<p class="r"><button type="button" data-dz="gnd" aria-pressed="' + ST.gnd.on + '">Ground evacuation</button><button type="button" data-dz="medplan">Medical plan from the PI</button><button type="button" data-dz="evac">Evacuate from the PI</button></p>';
    return h;
  }
  function secGnd() {
    var G0 = ST.gnd; if (!G0.on) return "";
    if (G0.busy) return '<p class="obs">Asking the road router for drive times from the PI…</p>';
    var h = "";
    if (G0.err) h += '<p class="bad">No road router answered (' + esc(G0.err) + "): the road figures are straight-line estimates (distance x 1.4 at 50 km/h), not a route. <button type=\"button\" data-dz=\"gnd-retry\">Try again</button></p>";
    var rt = G0.rt, x = rt && ST.hosp.list[rt.i];
    if (G0.rtBusy) h += '<p class="obs">Working out the road route…</p>';
    else if (G0.rtErr) h += '<p class="bad">The road route could not be worked out: ' + esc(G0.rtErr) + '. <button type="button" data-dz="groute" data-i="' + G0.sel + '">Try again</button></p>';
    else if (x) h += "<p><b>Road route to " + esc(x.name) + ":</b> " + fmtM(rt.r.m) + ", " + mins(rt.r.s) + (rt.r.roads && rt.r.roads.length ? " via " + esc(rt.r.roads.slice(0, 4).map(function (r) { return r.n; }).join(", ")) : "") + ", drawn on the map in green.</p>";
    return h + '<p class="obs">Road drive time from the PI with no traffic, checkpoints, road damage, loading or start-up time' + (G0.host ? " (" + esc(G0.host) + ", OpenStreetMap roads)" : "") + ". The same routing as the medical plan; confirm the route on the ground.</p>";
  }
  function secFields(dz) {
    var f = dz.fields;
    return "<h3>Comms, personnel and markings</h3><div class=\"fl\">" + FIELDS.map(function (x) {
      return "<label for=\"dzf-" + x[0] + "\">" + esc(x[1]) + '</label><input id="dzf-' + x[0] + '" data-ff="' + x[0] + '" value="' + esc(f[x[0]] || "") + '" maxlength="600">';
    }).join("") + "</div>" +
      "<h3>DZSO checks</h3><div class=\"chk\">" + CHECKS.map(function (x) { return '<label><input type="checkbox" data-ff="' + x[0] + '"' + (f[x[0]] === true ? " checked" : "") + "> " + esc(x[1]) + "</label>"; }).join("") + "</div>" +
      '<p class="obs">' + (ST.saved ? "Kept with this drop zone in this browser only." : "Save the drop zone to keep these in this browser.") + " Do not type personal phone numbers here.</p>";
  }
  function secMethod() {
    return '<h3>Method and sources</h3><p class="obs">Winds and weather: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> model forecast. Hazards: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors (Overpass). Hospitals: OSAP\'s stored OpenStreetMap copy. Light: OSAP night illumination. Magnetic declination: WMM2025. ' +
      "Fixed rules, no AI. A planning aid for the DZSO: not an official drop zone survey, not analyst-approved; the limits are the DZSO's own settings.</p>";
  }

  /* ---------- printing: a sheet with no form fields and a north-up diagram ---------- */
  function diagram(dz) {
    var Wd = 640, Hd = 440, pad = 20, ol = outline(dz).map(function (p) { return local(dz.pi, p); });
    var ext = Math.max(dz.len_m, dz.wid_m) * 0.9 + 400, s = Math.min(Wd, Hd) / 2 / ext;
    function X(xy) { return (Wd / 2 + xy[0] * s).toFixed(1); }
    function Y(xy) { return (Hd / 2 - xy[1] * s).toFixed(1); }
    function pl(pts) { return pts.map(function (p) { var q = local(dz.pi, p); return X(q) + "," + Y(q); }).join(" "); }
    var g = '<svg viewBox="0 0 ' + Wd + " " + Hd + '" xmlns="http://www.w3.org/2000/svg" font-family="system-ui,sans-serif" font-size="11"><rect width="' + Wd + '" height="' + Hd + '" fill="#f7f8f6"/>' + imagery(dz, Wd, Hd, s);
    if (ST.hz) ST.hz.items.forEach(function (it) {
      var k = KINDS[it.k];
      if (it.pt) { var q = local(dz.pi, it.pt); if (Math.abs(q[0]) > ext || Math.abs(q[1]) > ext) return; g += '<circle cx="' + X(q) + '" cy="' + Y(q) + '" r="' + (it.k === "bldg" ? 1.6 : 3) + '" fill="' + k.c + '"/>'; }
      else if (it.line) g += (it.closed ? '<polygon fill="' + k.c + '" fill-opacity=".25"' : '<polyline fill="none"') + ' stroke="' + k.c + '" stroke-width="' + (it.closed ? 0.8 : (k.w || 2) * 0.8) + '" points="' + pl(it.line) + '"/>';
    });
    if (ST.gnd.on && ST.gnd.rt && ST.gnd.rt.r.line && ST.gnd.rt.r.line.length > 1) { var gl = pl(ST.gnd.rt.r.line); g += '<polyline fill="none" stroke="#fff" stroke-width="5" points="' + gl + '"/><polyline fill="none" stroke="#2e7d32" stroke-width="3" points="' + gl + '"/>'; }
    g += '<polygon points="' + ol.map(function (q) { return X(q) + "," + Y(q); }).join(" ") + '" fill="#ffeb3b" fill-opacity=".2" stroke="#ffeb3b" stroke-width="2.5"/>';
    var e0 = edge0(dz), a = local(dz.pi, fromUv(dz, e0 - Math.min(1500, ext), 0)), b = local(dz.pi, fromUv(dz, dz.shape === "circle" ? dz.len_m / 2 : dz.len_m, 0)), t = local(dz.pi, fromUv(dz, e0 - 30, 0)), l1 = local(dz.pi, fromUv(dz, e0 - 30 - 50 / s / 2, -18 / s / 2)), l2 = local(dz.pi, fromUv(dz, e0 - 30 - 50 / s / 2, 18 / s / 2));
    g += '<line x1="' + X(a) + '" y1="' + Y(a) + '" x2="' + X(b) + '" y2="' + Y(b) + '" stroke="#ffeb3b" stroke-width="1.8" stroke-dasharray="7 5"/><polygon points="' + [t, l1, l2].map(function (q) { return X(q) + "," + Y(q); }).join(" ") + '" fill="#ffeb3b" stroke="#000" stroke-width=".6"/>';
    var th = totHour();
    if (th && th.rp) { var r = local(dz.pi, th.rp); if (Math.abs(r[0]) < ext && Math.abs(r[1]) < ext) g += '<line x1="' + X([0, 0]) + '" y1="' + Y([0, 0]) + '" x2="' + X(r) + '" y2="' + Y(r) + '" stroke="#9c27b0" stroke-dasharray="3 4"/><circle cx="' + X(r) + '" cy="' + Y(r) + '" r="4" fill="#9c27b0"/><text x="' + (+X(r) + 6) + '" y="' + (+Y(r) - 4) + '" fill="#6a1b9a" stroke="#fff" stroke-width="3" paint-order="stroke">RP (drift only)</text>'; }
    g += '<circle cx="' + X([0, 0]) + '" cy="' + Y([0, 0]) + '" r="5" fill="#d32f2f" stroke="#fff" stroke-width="1.5"/><text x="' + (Wd / 2 + 8) + '" y="' + (Hd / 2 - 7) + '" font-weight="700" stroke="#fff" stroke-width="3" paint-order="stroke">PI</text>';
    /* north arrow and scale */
    g += '<rect x="' + (Wd - 34) + '" y="6" width="28" height="46" rx="3" fill="#fff" fill-opacity=".85"/><path d="M' + (Wd - 26) + " 46 L" + (Wd - 20) + " 26 L" + (Wd - 14) + ' 46 Z" fill="#333"/><text x="' + (Wd - 24) + '" y="20" font-weight="700">N</text>';
    var bar = [100, 200, 250, 500, 1000, 2000].filter(function (m) { return m * s <= Wd / 4; }).pop() || 100;
    g += '<rect x="' + (pad - 6) + '" y="' + (Hd - pad - 20) + '" width="' + (bar * s + 12).toFixed(1) + '" height="28" rx="3" fill="#fff" fill-opacity=".85"/><line x1="' + pad + '" y1="' + (Hd - pad) + '" x2="' + (pad + bar * s).toFixed(1) + '" y2="' + (Hd - pad) + '" stroke="#333" stroke-width="3"/><text x="' + pad + '" y="' + (Hd - pad - 6) + '">' + fmtM(bar) + "</text>";
    return g + "</svg>";
  }
  /* satellite imagery under the PDF diagram (Shane 2026-10-27: the exported DZ map was blank): Esri World Imagery tiles where
     this version has them (assets/osap-sold.js OSAP_ESRI), placed in the diagram's own east-north metres; with none the
     diagram keeps its plain background */
  function imagery(dz, Wd, Hd, s) {
    var url = W.OSAP_ESRI ? W.OSAP_ESRI("World_Imagery") : ""; if (!url) return "";
    var c = Math.cos(dz.pi[0] * R), z = Math.max(3, Math.min(18, Math.ceil(Math.log(156543.03 * c * s * 2) / Math.LN2))), n = Math.pow(2, z);
    function tx(lon) { return (lon + 180) / 360 * n; }
    function ty(lat) { var t = Math.sin(lat * R); return (0.5 - Math.log((1 + t) / (1 - t)) / (4 * Math.PI)) * n; }
    function lon(x) { return x / n * 360 - 180; }
    function lat(y) { var k = Math.PI - 2 * Math.PI * y / n; return Math.atan(Math.sinh(k)) / R; }
    var nw = unlocal(dz.pi, [-Wd / 2 / s, Hd / 2 / s]), se = unlocal(dz.pi, [Wd / 2 / s, -Hd / 2 / s]), out = "";
    for (var y = Math.floor(ty(nw[0])); y <= Math.floor(ty(se[0])); y++) for (var x = Math.floor(tx(nw[1])); x <= Math.floor(tx(se[1])); x++) {
      if (y < 0 || y >= n) continue;
      var a = local(dz.pi, [lat(y), lon(x)]), b = local(dz.pi, [lat(y + 1), lon(x + 1)]);
      var u = url.replace("{z}", z).replace("{y}", y).replace("{x}", ((x % n) + n) % n);
      out += '<image href="' + esc(u) + '" x="' + (Wd / 2 + a[0] * s).toFixed(1) + '" y="' + (Hd / 2 - a[1] * s).toFixed(1) + '" width="' + ((b[0] - a[0]) * s + 0.6).toFixed(1) + '" height="' + ((a[1] - b[1]) * s + 0.6).toFixed(1) + '" preserveAspectRatio="none"/>';
    }
    return out + '<text x="' + (Wd - 6) + '" y="' + (Hd - 6) + '" text-anchor="end" font-size="8.5" fill="#fff" stroke="#000" stroke-width="2" paint-order="stroke">Imagery © Esri, Maxar, Earthstar Geographics and the GIS user community</text>';
  }
  /* the PDF waits (up to 12 s) for the imagery to load, so the print engine never draws the map before its tiles arrive */
  function imagesReady(root) {
    var hs = Array.prototype.map.call(root.querySelectorAll("image"), function (i) { return i.getAttribute("href"); }).filter(Boolean);
    return Promise.race([Promise.all(hs.map(function (h) { return new Promise(function (r) { var im = new Image(); im.onload = im.onerror = function () { r(); }; im.src = h; }); })),
      new Promise(function (r) { setTimeout(r, 12000); })]);
  }
  function printSheet() {
    var dz = ST.dz, d = D.createElement("div"); d.className = "dzp";
    var H = ST.wx ? hours() : [], L0 = light(), f = dz.fields, g = G(), decl = g && g.decl ? g.decl(dz.pi[0], dz.pi[1]) : null;
    function kv(rows) { return '<div class="kv">' + rows.filter(function (r) { return r[1] !== "" && r[1] != null; }).map(function (r) { return "<span>" + esc(r[0]) + "</span><b>" + esc(r[1]) + "</b>"; }).join("") + "</div>"; }
    var h = "<p>Planning aid from open data and model forecasts, for the DZSO. Not an official drop zone survey; the DZSO's reading at the DZ and the aircrew decide. Not analyst-approved, not AI.</p>";
    h += "<h2>Drop zone</h2>" + kv([["Name", dz.name], ["PI (MGRS)", grid(dz.pi)], ["PI (lat, lon)", dz.pi[0].toFixed(5) + ", " + dz.pi[1].toFixed(5)], ["Elevation", dz.elev_m != null ? Math.round(dz.elev_m) + " m / " + Math.round(dz.elev_m / FT) + " ft MSL (model)" : "not known"],
      ["Shape and size", dz.shape === "circle" ? "Circle, " + dz.len_m + " m (" + Math.round(dz.len_m / YD) + " yd) across" : "Rectangle " + dz.len_m + " x " + dz.wid_m + " m (" + Math.round(dz.len_m / YD) + " x " + Math.round(dz.wid_m / YD) + " yd), PI " + dz.pi_lead_m + " m from the leading edge"],
      ["Run-in axis", Math.round(dz.axis) + "° true" + (isFinite(decl) ? " / " + dir3((((dz.axis - decl) % 360) + 360) % 360) + "° magnetic" : "")], ["Aircraft", dz.acft], ["Drop altitude", dz.alt_ft ? dz.alt_ft + " ft AGL" + (dz.elev_m != null ? " / " + Math.round(dz.alt_ft + dz.elev_m / FT) + " ft MSL" : "") : ""],
      ["Drop time", dz.tot ? zd(Date.parse(dz.tot)) + " " + zc(Date.parse(dz.tot)) + (ST.wx ? " (" + lc(Date.parse(dz.tot), ST.wx.off) + " local)" : "") : "not set"], ["Load and limits", prof(LIM.prof).label + ": wind " + LIM.wind + " kt, gusts " + LIM.gust + " kt, visibility " + LIM.vis + " km, K " + LIM.K]]);
    h += "<h2>Diagram (north up)</h2>" + diagram(dz);
    if (H.length) {
      var th = totHour();
      h += "<h2>Winds and weather (model)</h2><table><thead><tr><th>Zulu</th><th>Local</th><th>Surface</th><th>Gust</th><th>Mean to drop alt.</th><th>Drift</th><th>Cloud / vis</th><th>Check</th></tr></thead><tbody>" + H.map(function (x) {
        return "<tr" + (x.tot ? ' style="background:#fff8c4"' : "") + "><td>" + zc(x.t) + "</td><td>" + lc(x.t, ST.wx.off) + "</td><td>" + dir3(x.dir) + "° " + Math.round(x.kt) + " kt</td><td>" + (isFinite(x.gust) ? Math.round(x.gust) + " kt" : "-") + "</td><td>" + (x.mean ? dir3(x.mean.dir) + "° " + x.mean.kt.toFixed(1) + " kt" : "-") + "</td><td>" + (x.drift !== null ? Math.round(x.drift) + " m" : "-") + "</td><td>" +
          (isFinite(x.low) ? Math.round(x.low) + "% low" : "") + (isFinite(x.base) ? ", base ~" + Math.round(x.base / 100) * 100 + " ft" : "") + (isFinite(x.vis) ? ", " + (x.vis / 1000).toFixed(1) + " km" : "") + "</td><td>" + vtxt(x.v) + (x.v.why.length ? ": " + esc(x.v.why.join("; ")) : "") + "</td></tr>";
      }).join("") + "</tbody></table><p>Open-Meteo model forecast (https://open-meteo.com/), read " + zd(ST.wx.at) + " " + zc(ST.wx.at) + ". D = K × A × V. " + (th && th.rp ? "Drift-only release point at the drop time: " + esc(grid(th.rp)) + "." : "") + "</p>";
    }
    if (L0) { var n = L0.n; h += "<h2>Light</h2>" + kv([["At the drop time", L0.at], ["Sunset / EECT / EENT", [n.rise.down, n.civil.down, n.naut.down].map(function (t) { return t == null ? "-" : zc(t); }).join(" / ")], ["BMNT / BMCT / Sunrise", [n.naut.up, n.civil.up, n.rise.up].map(function (t) { return t == null ? "-" : zc(t); }).join(" / ")], ["Moon", Math.round(n.il.frac * 100) + "% lit" + (n.moonrise.length ? ", rises " + n.moonrise.map(zc).join(", ") : "") + (n.moonset.length ? ", sets " + n.moonset.map(zc).join(", ") : "")]]); }
    if (ST.hz) h += "<h2>Hazards (OpenStreetMap)</h2><table><thead><tr><th>Hazard</th><th>Within " + fmtM(ST.hz.r) + "</th><th>In DZ +" + HZ_MARGIN + " m</th><th>Nearest to the PI</th></tr></thead><tbody>" + ORDER.map(function (k) {
      var s = ST.hz.sum[k], nn = s.near; return "<tr><td>" + KINDS[k].n + "</td><td>" + s.n + "</td><td>" + s.inDz + "</td><td>" + (nn ? (nn.m < 1 ? "at the PI" : fmtM(nn.m) + " " + compass(nn.brg)) + (nn.name ? ", " + esc(nn.name) : "") : "none mapped") + "</td></tr>";
    }).join("") + "</tbody></table><p>OpenStreetMap contributors (https://www.openstreetmap.org/copyright). Only mapped features; walk the DZ.</p>";
    var gd = ST.gnd.on && ST.hosp && ST.hosp.list.some(function (x) { return x.road; });
    if (ST.hosp && ST.hosp.list.length) h += "<h2>Nearest hospitals</h2><table><thead><tr><th>Hospital</th><th>From the PI</th><th>Air at " + LIM.kn + " kt</th>" + (gd ? "<th>By road</th>" : "") + "<th>Source</th></tr></thead><tbody>" + ST.hosp.list.map(function (x) {
      return "<tr><td>" + esc(x.name) + "</td><td>" + fmtM(x.m) + " " + compass(x.brg) + "</td><td>" + Math.max(1, Math.round(x.m / (LIM.kn * KT) / 60)) + " min</td>" + (gd ? "<td>" + esc(roadTxt(x)) + "</td>" : "") + "<td>" + esc(x.url) + "</td></tr>";
    }).join("") + "</tbody></table>" + (gd ? (function () { var rt = ST.gnd.rt, x = rt && ST.hosp.list[rt.i]; return "<p>" + (x ? "Road route to " + esc(x.name) + ": " + fmtM(rt.r.m) + ", " + mins(rt.r.s) + (rt.r.roads && rt.r.roads.length ? " via " + esc(rt.r.roads.slice(0, 4).map(function (r) { return r.n; }).join(", ")) : "") + " (on the diagram in green). " : "") +
      "Road drive times with no traffic, checkpoints, damage or loading time" + (ST.gnd.host ? ", " + esc(ST.gnd.host) : "") + (ST.gnd.err ? "; no router answered, so the road figures are straight-line estimates" : "") + ".</p>"; })() : "");
    h += "<h2>Comms, personnel and markings</h2>" + kv(FIELDS.map(function (x) { return [x[1], f[x[0]] || "________________"]; }));
    h += "<h2>DZSO checks</h2>" + kv(CHECKS.map(function (x) { return [f[x[0]] === true ? "[x]" : "[ ]", x[1]]; }));
    d.innerHTML = h;
    return d;
  }

  /* ---------- events ---------- */
  function setPi(p, how) {
    ST.dz.pi = [+(+p[0]).toFixed(6), +(+p[1]).toFixed(6)]; ST.dz.elev_m = null; keep();
    paint(); drawDz(); refresh();
  }
  var tapOn = false;
  function tapStart() { ST.arm = true; if (!tapOn) { map.on("click", onTap); tapOn = true; } map.getContainer().style.cursor = "crosshair"; paint(); }
  function tapEnd() { ST.arm = false; if (tapOn) { map.off("click", onTap); tapOn = false; } map.getContainer().style.cursor = ""; }
  function onTap(e) { tapEnd(); setPi([e.latlng.lat, L.Util.wrapNum(e.latlng.lng, [-180, 180], true)]); }
  function onClick(e) {
    var b = e.target.closest && e.target.closest("[data-dz]"); if (!b) return;
    var k = b.getAttribute("data-dz"), dz = ST.dz;
    if (k === "close") close();
    else if (k === "pick") { if (ST.arm) { tapEnd(); paint(); } else tapStart(); }
    else if (k === "centre") { var c = map.getCenter(); setPi([c.lat, L.Util.wrapNum(c.lng, [-180, 180], true)]); }
    else if (k === "edit") { ST.edit = !ST.edit; paint(); drawDz(); }
    else if (k === "show") { try { map.fitBounds(L.latLngBounds(outline(dz)).pad(0.6), { maxZoom: 16 }); } catch (x) {} if (W.OSAP_SPLIT && W.OSAP_SPLIT.on() && W.innerWidth <= 700 && W.OSAP_SPLIT.stop) try { W.OSAP_SPLIT.stop(el, "map"); } catch (x) {} }
    else if (k === "grid") { var i = el.querySelector('[data-f="grid"]'), g = G(), p = g && g.parse(i && i.value); if (p) setPi([p.lat, p.lon]); else if (i) { i.setCustomValidity("Not a grid OSAP can read"); i.reportValidity(); } }
    else if (k === "save") { if (!store()) return; var d = store().save(dz); if (d) { ST.dz = d; ST.saved = true; } paint(); }
    else if (k === "del") { if (store() && W.confirm("Delete the drop zone " + dz.name + " from this browser?")) { store().remove(dz.id); ST.saved = false; ST.dz = newDz(dz.pi, dz.name); paint(); } }
    else if (k === "wx") loadWx();
    else if (k === "hz") loadHz();
    else if (k === "gnd") { ST.gnd.on = !ST.gnd.on; ST.gnd.picked = false; if (ST.gnd.on) loadGnd(); else { ST.run.gnd++; ST.gnd.busy = ST.gnd.rtBusy = false; gLayer.clearLayers(); paint(); } }
    else if (k === "gnd-retry") loadGnd();
    else if (k === "groute") { ST.gnd.picked = true; loadRoute(+b.getAttribute("data-i") || 0); }
    else if (k === "medplan") { if (W.OSAP_MEDPLAN) W.OSAP_MEDPLAN.open({ at: dz.pi.slice() }); }
    else if (k === "evac") { if (W.OSAP_EPE_GO) W.OSAP_EPE_GO({ at: dz.pi.slice(), how: "DZSO sheet: " + dz.name }); }
    else if (k === "fromflight") {
      var fl = W.OSAP_FLIGHT && W.OSAP_FLIGHT.forDz(dz.id); if (!fl) return;
      if (fl.acft) dz.acft = String(fl.acft).slice(0, 40); if (+fl.alt_ft > 0) dz.alt_ft = +fl.alt_ft; if (fl.tot && isFinite(Date.parse(fl.tot))) dz.tot = new Date(Date.parse(fl.tot)).toISOString().slice(0, 16) + ":00Z";
      if (isFinite(fl.axis)) dz.axis = ((+fl.axis % 360) + 360) % 360; keep(); paint(); drawDz();
    }
    else if (k === "pdf") {
      if (!W.OSAP_PDF || b.disabled) return;
      var sh = printSheet(); b.disabled = true; b.textContent = "Loading the map…";
      imagesReady(sh).then(function () { b.disabled = false; b.textContent = "Export PDF"; return W.OSAP_PDF.panel(sh, { title: "DZSO sheet: " + dz.name }); });
    }
  }
  function onChange(e) {
    var t = e.target, f = t.getAttribute && t.getAttribute("data-f"); if (!f) return;
    var dz = ST.dz, v = t.value, n = num(v), geo = false;
    if (f === "pick") { var d = v && store() && store().get(v); if (d) { ST.dz = d; ST.saved = true; drawDz(); refresh(); } paint(); return; }
    if (f === "grid") return;
    if (f === "name") dz.name = String(v).trim().slice(0, 80) || "Drop zone";
    else if (f === "shape") { dz.shape = v === "circle" ? "circle" : "rect"; geo = true; }
    else if (/^(len_m|wid_m|pi_lead_m)$/.test(f) && n !== null) { dz[f] = Math.max(f === "pi_lead_m" ? 0 : 10, Math.min(20000, n)); geo = true; }
    else if (f === "axis" && n !== null) { dz.axis = ((n % 360) + 360) % 360; geo = true; }
    else if (f === "alt_ft") dz.alt_ft = n !== null ? Math.max(100, Math.min(40000, n)) : null;
    else if (f === "acft") dz.acft = String(v).trim().slice(0, 40);
    else if (f === "acsel") { if (v === "__other") { ST.acOther = true; keep(); paint(); var ti = el.querySelector('[data-f="acft"]'); if (ti) ti.focus(); return; } ST.acOther = false; dz.acft = String(v).slice(0, 40); }
    else if (f === "tot") { var ms = v ? Date.parse(v + ":00Z") : NaN; dz.tot = isFinite(ms) ? new Date(ms).toISOString().slice(0, 16) + ":00Z" : ""; }
    else if (f === "jumpers") dz.fields.jumpers = n !== null ? String(Math.max(1, Math.round(n))) : "";
    else if (f === "prof") { var p = prof(v); LIM.prof = p.id; LIM.wind = p.wind; LIM.gust = p.gust; LIM.K = p.K; if (!dz.alt_ft || PROFILES.some(function (x) { return x.alt === dz.alt_ft; })) dz.alt_ft = p.alt; keepLim(); }
    else if (/^(lwind|lgust|lvis|lpad|lk|yd|kn)$/.test(f) && n !== null) { LIM[{ lwind: "wind", lgust: "gust", lvis: "vis", lpad: "pad", lk: "K", yd: "perYd", kn: "kn" }[f]] = Math.max(0, n); keepLim(); }
    keep(); paint(); drawDz();
    if (geo && ST.hz) drawHz();
  }
  var ffT = null;
  function onInput(e) {
    var t = e.target, ff = t.getAttribute && t.getAttribute("data-ff"), m = t.getAttribute && t.getAttribute("data-m");
    if (ff) { ST.dz.fields[ff] = t.type === "checkbox" ? !!t.checked : String(t.value).slice(0, 600); clearTimeout(ffT); ffT = setTimeout(keep, 400); return; }
    if (m) {
      ST.meas[m] = t.value; var v = measVerdict(), s = el.querySelector("[data-meas]");
      if (s) s.innerHTML = v ? '<span class="v ' + v.state + '">' + vtxt(v) + "</span> " + esc(v.why.join("; ")) : '<span class="obs">Type the anemometer reading to check it against the limits.</span>';
    }
  }

  /* ---------- open and close ---------- */
  function open(o) {
    o = o || {}; ensure();
    var d = null, S = store();
    if (o.id && S) d = S.get(o.id);
    if (!d && o.at && S) d = S.list().filter(function (x) { return Math.hypot.apply(null, local(x.pi, o.at)) < 60; })[0] || null;
    if (d) { ST.dz = d; ST.saved = true; }
    else {
      var at = o.at;
      if (!at) { var A = W.TSAP && W.TSAP.areaApi, P = A && A.area && A.area(); if (P && P.length > 2) { var la = 0, lo = 0; P.forEach(function (p) { la += p[0]; lo += p[1]; }); at = [la / P.length, lo / P.length]; } }
      if (!at) { var c = map.getCenter(); at = [c.lat, L.Util.wrapNum(c.lng, [-180, 180], true)]; }
      ST.dz = newDz(at, o.name); ST.saved = false;
    }
    ST.meas = { kt: "", gust: "", dir: "" }; ST.acOther = false;
    el.hidden = false; paint(); drawDz(); refresh();
    /* bring the DZ into view when it is off the map (a saved DZ, the Area menu on another part of the country) */
    try { var bb = L.latLngBounds(outline(ST.dz)); if (!map.getBounds().contains(bb)) map.fitBounds(bb.pad(0.8), { maxZoom: 15 }); } catch (x) {}
    var f = el.querySelector('[data-dz="close"]'); if (f) f.focus({ preventScroll: true });
  }
  function close() { tapEnd(); ST.run.wx++; ST.run.hz++; ST.run.hosp++; ST.run.gnd++; ST.gnd.busy = ST.gnd.rtBusy = false; gLayer.clearLayers(); if (DRAG) { DRAG = null; map.dragging.enable(); } if (el) el.hidden = true; layer.clearLayers(); hLayer.clearLayers(); hzLayer.clearLayers(); }
  W.OSAP_DZSO = { open: open, close: close, isOpen: isOpen, core: CORE, _print: printSheet,
    state: function () { return { dz: ST.dz, saved: ST.saved, edit: ST.edit, handles: Object.keys(HS).filter(function (k) { return k !== "tip"; }), wx: !!ST.wx, wxErr: ST.wxErr, hz: ST.hz ? { n: ST.hz.items.length, sum: ST.hz.sum } : null, hzErr: ST.hzErr, hosp: ST.hosp, hospErr: ST.hospErr, hours: hours(), lim: LIM }; } };
})(typeof window !== "undefined" ? window : globalThis);
