/* AXIOM OSAP: Draw, planning graphics on the map (Shane 2026-11-07: "I need to be able to draw on the map ie add shapes and
   items for planning purposes").
   The Draw button on the map toolbar (also Plans > Map drawing) opens a palette of items the analyst places by tapping the map:
     Lines and arrows: line, arrow, phase line (PL, named at both ends), boundary, limit of advance (LOA), axis of advance (a wide
       arrow), direction of attack (a solid arrowhead)
     Areas: shape, objective (OBJ), assembly area (AA), engagement area (EA), battle position (BP), area to avoid, circle
     Ranges: range rings (one center, any distances), sector of fire (position, left limit, right limit, range)
     Labels: a text label
     Control measure points: checkpoint, rally point, contact point, start point, release point, linkup point, target reference
       point (TRP), observation post; these are ordinary saved points carrying their NATO 2525D symbol (Point tool, My places)
   Lines and areas: tap each corner, then Finish (or tap the last point again). Circles, rings, sectors and labels finish by
   themselves. Each item then opens its details: the name (after its fixed prefix, so "PL" + "RED" reads "PL RED"), one-tap colors,
   solid, dashed or dotted line, a note, ring distances or sector range, the grids of its points, Edit points (drag each corner, or
   the move handle to shift the whole item), Zoom to, Copy and Delete (with Undo). A tap on an item on the map opens it again.
   The graphics follow MIL-STD-2525D / APP-6 tactical graphics in their plain form (shape, line style and the label letters); they
   are the analyst's own planning marks kept in this browser: never reports, never evidence, never sent anywhere unless the
   analyst exports or copies them.
   Each item is one record in localStorage "osap-draw" (a Workspace store in assets/osap-ws.js, so Workspace export, KML and GeoJSON
   carry it; My places in assets/osap-places.js lists each as "Drawing" with an on/off box and folders):
     [{ id: "dw-...", t: type, name, cc, pts: [[lat, lon], ...], col: "#rrggbb", dash: ""|"dash"|"dot", w: 1-8, note,
        r: [meters, ...] (range rings), rng: meters (sector of fire), created, updated }]
   window.OSAP_DRAW = { all, get, add(t, pts, opt), update(id, patch), remove(id), open(id), close, start(t), palette(on?), point(k),
     edit(id), redraw, features(rec), text(rec), label(rec), TYPES, KEY }
   Other tools (the range card) can call OSAP_DRAW.add("fan", [center, left, right], { rng }) or OSAP_DRAW.start("rings"). */
(function () {
  "use strict";
  var W = window, D = document, L = W.L, map = W.__asapMap, G = W.OSAP_GEO;
  if (!L || !map || !G || W.OSAP_DRAW || /[?&]watchscan=1(&|$)/.test(location.search)) return;
  var KEY = "osap-draw", MAX = 500, MAX_PTS = 200;
  var SWATCH = [["#212529", "Black"], ["#1c7ed6", "Blue"], ["#e03131", "Red"], ["#37b24d", "Green"], ["#fab005", "Yellow"], ["#f76707", "Orange"], ["#ae3ec9", "Purple"], ["#15aabf", "Cyan"], ["#7048e8", "Violet"], ["#ffffff", "White"]];
  /* g: geometry kind; pre: the fixed letters before the name; min: fewest points; n: points that finish it by themselves */
  var TYPES = {
    line: { g: "line", lab: "Line", col: "#1c7ed6", min: 2, grp: "lines", tip: "Tap each point, then Finish" },
    arrow: { g: "line", lab: "Arrow", col: "#1c7ed6", min: 2, head: "open", grp: "lines", tip: "Tap from the tail to the point, then Finish" },
    pl: { g: "line", lab: "Phase line", pre: "PL", col: "#212529", min: 2, ends: true, grp: "lines", tip: "Tap along the line, then Finish" },
    bnd: { g: "line", lab: "Boundary", col: "#212529", min: 2, w: 4, grp: "lines", tip: "Tap along the boundary, then Finish" },
    loa: { g: "line", lab: "Limit of advance", pre: "LOA", col: "#212529", min: 2, ends: true, grp: "lines", tip: "Tap along the line, then Finish" },
    axis: { g: "line", lab: "Axis of advance", pre: "AXIS", col: "#1c7ed6", min: 2, head: "axis", grp: "lines", tip: "Tap from the start to the objective, then Finish" },
    doa: { g: "line", lab: "Direction of attack", col: "#1c7ed6", min: 2, head: "solid", w: 4, grp: "lines", tip: "Tap from the start to the objective, then Finish" },
    shape: { g: "area", lab: "Shape", col: "#1c7ed6", min: 3, grp: "areas", tip: "Tap each corner, then Finish" },
    obj: { g: "area", lab: "Objective", pre: "OBJ", col: "#212529", min: 3, grp: "areas", tip: "Tap each corner, then Finish" },
    aa: { g: "area", lab: "Assembly area", pre: "AA", col: "#212529", min: 3, grp: "areas", tip: "Tap each corner, then Finish" },
    ea: { g: "area", lab: "Engagement area", pre: "EA", col: "#e03131", min: 3, grp: "areas", tip: "Tap each corner, then Finish" },
    bp: { g: "area", lab: "Battle position", pre: "BP", col: "#212529", min: 3, grp: "areas", tip: "Tap each corner, then Finish" },
    avoid: { g: "area", lab: "Area to avoid", pre: "AVOID", col: "#e03131", dash: "dash", fill: 0.2, min: 3, grp: "areas", tip: "Tap each corner, then Finish" },
    circle: { g: "circle", lab: "Circle", col: "#1c7ed6", n: 2, grp: "areas", tip: "Tap the center, then the edge" },
    rings: { g: "rings", lab: "Range rings", col: "#e03131", n: 1, grp: "ranges", tip: "Tap the center" },
    fan: { g: "fan", lab: "Sector of fire", col: "#e03131", n: 3, grp: "ranges", tip: "Tap the position, then the left limit (sets the range), then the right limit" },
    text: { g: "text", lab: "Text label", col: "#212529", n: 1, grp: "labels", tip: "Tap where the label goes" }
  };
  var GROUPS = [["lines", "Lines and arrows"], ["areas", "Areas"], ["ranges", "Ranges"], ["labels", "Labels"]];
  /* control measure points: 2525D symbol set 25 (control measures), friend, as ordinary saved points */
  var CMPTS = [["cp", "Checkpoint", "130300"], ["rp", "Rally point", "131400"], ["ctp", "Contact point", "130500"], ["sp", "Start point", "131600"],
    ["rel", "Release point", "131500"], ["lu", "Linkup point", "131100"], ["trp", "Target reference point", "160300"], ["op", "Observation post", "160100"]];
  function sidcOf(code) { return "ms:1003250000" + code + "0000"; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function cc() { return (W.TSAP && W.TSAP.country) || ""; }
  function hex(v) { return /^#[0-9a-f]{6}$/i.test(v || "") ? String(v).toLowerCase() : ""; }
  function clean(s, n) { return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n); }
  function cleanNote(s) { return String(s == null ? "" : s).replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").slice(0, 1000); }
  function toast(t) { if (W.OSAP_ATAK && W.OSAP_ATAK.toast) W.OSAP_ATAK.toast(t); }
  function newId() { var b = new Uint8Array(6); crypto.getRandomValues(b); return "dw-" + Date.now().toString(36) + Array.prototype.map.call(b, function (x) { return (x % 36).toString(36); }).join(""); }
  function unit() { var p = W.OSAP_MEASURE && W.OSAP_MEASURE.prefs ? W.OSAP_MEASURE.prefs() : null; return p && G.UNITS[p.unit] ? p.unit : "km"; }
  function phone() { return W.matchMedia("(max-width: 700px)").matches; }

  /* ---------- the store: every record is checked on read, so a bad or hostile copy cannot break the page ---------- */
  function okPts(P, min) {
    if (!Array.isArray(P) || P.length < (min || 1)) return null;
    var o = [];
    for (var i = 0; i < P.length && o.length < MAX_PTS; i++) {
      var p = P[i]; if (!Array.isArray(p)) return null;
      var la = +p[0], lo = +p[1];
      if (!isFinite(la) || !isFinite(lo) || la < -90 || la > 90 || lo < -540 || lo > 540) return null;
      o.push([Math.round(la * 1e6) / 1e6, Math.round(lo * 1e6) / 1e6]);
    }
    return o;
  }
  function minPts(T) { return T.n || T.min || 1; }
  function okRadii(a) { return (Array.isArray(a) ? a : []).map(Number).filter(function (x) { return isFinite(x) && x > 0 && x <= 2e6; }).map(function (x) { return Math.round(x * 10) / 10; }).sort(function (a, b) { return a - b; }).slice(0, 12); }
  function okRec(r) {
    if (!r || typeof r !== "object" || typeof r.id !== "string" || !/^dw-[a-z0-9]{4,40}$/.test(r.id)) return null;
    var T = TYPES[r.t]; if (!T || !Object.prototype.hasOwnProperty.call(TYPES, r.t)) return null;
    var pts = okPts(r.pts, minPts(T)); if (!pts) return null;
    if (T.n) pts = pts.slice(0, T.n);
    var o = { id: r.id, t: r.t, name: clean(r.name, 60), cc: /^[a-z]{2,3}$/.test(r.cc || "") ? r.cc : "", pts: pts, col: hex(r.col) || T.col,
      dash: /^(dash|dot)$/.test(r.dash || "") ? r.dash : r.dash === "" ? "" : (T.dash || ""), w: Math.max(1, Math.min(8, +r.w || T.w || 3)),
      note: cleanNote(r.note), created: +r.created || Date.now(), updated: +r.updated || +r.created || Date.now() };
    if (!o.name && T.g === "text") return null;
    if (T.g === "rings") { o.r = okRadii(r.r); if (!o.r.length) o.r = [100, 200, 300]; }
    if (T.g === "fan") { var rg = +r.rng; o.rng = isFinite(rg) && rg > 0 && rg <= 2e6 ? Math.round(rg * 10) / 10 : Math.max(1, Math.round(G.dist(pts[0], pts[1]))); }
    return o;
  }
  function all() { var a; try { a = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { a = []; } return (Array.isArray(a) ? a : []).map(okRec).filter(Boolean).slice(0, MAX); }
  function put(list) { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); return true; } catch (e) { return false; } }
  function get(id) { return all().filter(function (r) { return r.id === id; })[0] || null; }
  function changed() { draw(); D.dispatchEvent(new Event("osap:draw")); }
  function upsert(r) {
    r = okRec(r); if (!r) return false;
    var list = all(), i = -1; list.forEach(function (x, j) { if (x.id === r.id) i = j; });
    if (i >= 0) list[i] = r; else { if (list.length >= MAX) { toast("Up to " + MAX + " drawings. Delete some first."); return false; } list.push(r); }
    if (!put(list)) { toast("Not saved: this browser's storage for OSAP is full."); return false; }
    changed(); return true;
  }
  /* the first free number for this type on this country's map: PL 1, PL 2; Shape 1, Shape 2 */
  function nextName(t, c) {
    var T = TYPES[t], used = {}, re = T.pre ? /^(\d+)$/ : new RegExp("^" + T.lab + " (\\d+)$");
    all().forEach(function (r) { var m = r.t === t && r.cc === c && re.exec(r.name); if (m) used[+m[1]] = 1; });
    for (var n = 1; ; n++) if (!used[n]) return T.pre ? String(n) : T.lab + " " + n;
  }
  function add(t, pts, opt) {
    var T = TYPES[t]; if (!T) return null; opt = opt || {};
    var c = cc(), r = { id: newId(), t: t, name: clean(opt.name, 60) || (T.g === "text" ? "Label" : nextName(t, c)), cc: c, pts: pts, col: hex(opt.col) || T.col,
      dash: opt.dash != null ? opt.dash : (T.dash || ""), w: opt.w || T.w || 3, note: opt.note || "", r: opt.r, rng: opt.rng, created: Date.now(), updated: Date.now() };
    if (T.g === "rings" && !okRadii(r.r).length) r.r = autoRadii();
    return upsert(r) ? r.id : null;
  }
  function update(id, patch) { var r = get(id); if (!r) return false; Object.keys(patch || {}).forEach(function (k) { if (k !== "id" && k !== "t" && k !== "created") r[k] = patch[k]; }); r.updated = Date.now(); return upsert(r); }
  function remove(id) {
    var r = get(id); if (!r) return;
    if (editing === id) editEnd();
    put(all().filter(function (x) { return x.id !== id; })); changed(); close();
    undoBar(label(r) + " deleted", function () { if (!get(r.id)) upsert(r); });
  }
  /* three rings that fit the view: about a sixth, a third and a half of the shorter side, rounded to 1, 2 or 5 */
  function nice(m) { var p = Math.pow(10, Math.floor(Math.log10(m))), f = m / p; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p; }
  function autoRadii() {
    var b = map.getBounds(), c = map.getCenter(), h = G.dist([b.getSouth(), c.lng], [b.getNorth(), c.lng]), w = G.dist([c.lat, b.getWest()], [c.lat, b.getEast()]);
    var s = nice(Math.max(10, Math.min(h, w) / 6)); return [s, 2 * s, 3 * s];
  }

  /* ---------- geometry ---------- */
  function label(r) { var T = TYPES[r.t]; return T.pre ? T.pre + " " + r.name : r.name; }
  function bearing(a, b) { return G.inverse(a, b).b1; }
  function endBearing(a, b) { var iv = G.inverse(a, b); return iv.m ? iv.b2 : 0; }
  /* follows the Earth between points over 25 km apart, so a long line is drawn where it really runs */
  function dense(P, closed) {
    var Q = closed ? P.concat([P[0]]) : P, out = [];
    for (var i = 0; i + 1 < Q.length; i++) { var seg = G.path(Q[i], Q[i + 1], 25); out = out.concat(i ? seg.slice(1) : seg); }
    return out.length ? out : P.slice();
  }
  function lenOf(P) { var s = 0; for (var i = 0; i + 1 < P.length; i++) s += G.dist(P[i], P[i + 1]); return s; }
  function circlePts(c, m, a0, a1) {
    var out = [], span = a1 - a0, n = Math.max(8, Math.ceil(Math.abs(span) / 5));
    for (var i = 0; i <= n; i++) out.push(G.dest(c, a0 + span * i / n, m));
    return out;
  }
  function centroid(P) { var la = 0, lo = 0; P.forEach(function (p) { la += p[0]; lo += p[1]; }); return [la / P.length, lo / P.length]; }
  function fanLim(r) { return { l: bearing(r.pts[0], r.pts[1]), rt: r.pts[2] ? bearing(r.pts[0], r.pts[2]) : bearing(r.pts[0], r.pts[1]) }; }
  function cw(l, rt) { var s = (rt - l + 360) % 360; return s === 0 ? 360 : s; }
  /* the arrowhead at the end of a line: its tip, its two wings and the point on the line where its base sits */
  function head(P, size) {
    var a = P[P.length - 2], b = P[P.length - 1], seg = G.dist(a, b), hl = Math.min(size, seg * 0.6), t = endBearing(a, b);
    return { tip: b, l: G.dest(b, t + 180 - 28, hl / Math.cos(28 * Math.PI / 180)), r: G.dest(b, t + 180 + 28, hl / Math.cos(28 * Math.PI / 180)), base: G.dest(b, t + 180, hl), t: t, hl: hl };
  }
  /* an axis of advance: the route as a wide band with an arrowhead, as an outline polygon */
  function axisPoly(P) {
    var tot = lenOf(P), wd = Math.max(5, tot * 0.07), hl = Math.min(wd * 1.6, G.dist(P[P.length - 2], P[P.length - 1]) * 0.7);
    var tEnd = endBearing(P[P.length - 2], P[P.length - 1]), base = G.dest(P[P.length - 1], tEnd + 180, hl), C = P.slice(0, -1).concat([base]), left = [], right = [];
    C.forEach(function (p, i) {
      var t;
      if (i === 0) t = bearing(C[0], C[1]);
      else if (i === C.length - 1) t = tEnd;
      else { var t1 = endBearing(C[i - 1], C[i]), t2 = bearing(C[i], C[i + 1]), d = ((t2 - t1 + 540) % 360) - 180; t = t1 + d / 2; }
      left.push(G.dest(p, t - 90, wd / 2)); right.push(G.dest(p, t + 90, wd / 2));
    });
    return left.concat([G.dest(base, tEnd - 90, wd), P[P.length - 1], G.dest(base, tEnd + 90, wd)]).concat(right.reverse());
  }
  /* each item as plain shapes: { lines: [[pts], ...], fills: [[pts], ...], solid: [[pts]], labels: [[at, text, cls]] } */
  function shapes(r) {
    var T = TYPES[r.t], P = r.pts, out = { lines: [], fills: [], solid: [], labels: [] }, u = unit(), nm = label(r);
    if (T.g === "line") {
      if (P.length < 2) return out;
      var ln = dense(P, false), tot = lenOf(P);
      if (T.head === "axis") { var ap = axisPoly(P); out.lines.push(ap.concat([ap[0]])); out.fills.push(ap); }
      else {
        out.lines.push(ln);
        if (T.head) { var h = head(P, Math.max(3, tot * 0.08)); if (T.head === "open") out.lines.push([h.l, h.tip, h.r]); else out.solid.push([h.l, h.tip, h.r]); }
      }
      if (T.ends) {
        var e0 = G.dest(P[0], bearing(P[1], P[0]), 0), e1 = P[P.length - 1];
        out.labels.push([e0, nm, "end"]); out.labels.push([e1, nm, "end"]);
      } else out.labels.push([ln[Math.floor(ln.length / 2)], nm, ""]);
    } else if (T.g === "area") {
      if (P.length < 2) return out;
      if (P.length === 2) { out.lines.push(P.slice()); return out; }
      out.lines.push(dense(P, true)); out.fills.push(dense(P, true));
      out.labels.push([centroid(P), nm, "area"]);
    } else if (T.g === "circle") {
      if (P.length < 2) return out;
      var m = G.dist(P[0], P[1]), cp = circlePts(P[0], m, 0, 360);
      out.lines.push(cp); out.fills.push(cp); out.labels.push([P[0], nm + " · " + G.fmtDist(m, u) + " radius", "area"]);
    } else if (T.g === "rings") {
      (r.r || []).forEach(function (m) { out.lines.push(circlePts(P[0], m, 0, 360)); out.labels.push([G.dest(P[0], 0, m), G.fmtDist(m, u), "ring"]); });
      out.solid.push(circlePts(P[0], Math.max(1, (r.r && r.r[0] || 100) * 0.03), 0, 360));
      out.labels.push([P[0], nm, "ctr"]);
    } else if (T.g === "fan") {
      if (P.length < 2) return out;
      var rg = P.length < 3 ? G.dist(P[0], P[1]) : r.rng || G.dist(P[0], P[1]), lim = fanLim(r), span = P.length < 3 ? 0 : cw(lim.l, lim.rt);
      var le = G.dest(P[0], lim.l, rg);
      if (P.length < 3) { out.lines.push([P[0], le]); return out; }
      var arc = circlePts(P[0], rg, lim.l, lim.l + span), poly = [P[0]].concat(arc, [P[0]]);
      out.lines.push(poly); out.fills.push(poly);
      out.labels.push([le, "L " + G.fmtBrg(lim.l, false) + " T", "lim"]); out.labels.push([arc[arc.length - 1], "R " + G.fmtBrg(lim.rt, false) + " T", "lim"]);
      out.labels.push([P[0], nm + " · " + G.fmtDist(rg, u), "ctr"]);
    } else if (T.g === "text") out.labels.push([P[0], nm, "text"]);
    return out;
  }
  function dashOf(k, w) { var A = W.TSAP && W.TSAP.areaApi; if (A && A.dashOf) return A.dashOf(k, w); return k === "dash" ? (w * 3) + " " + (w * 2) : k === "dot" ? "1 " + (w * 2.2) : null; }
  function zw(w) { var A = W.TSAP && W.TSAP.areaApi; return A && A.zoomW ? A.zoomW(w) : w; }

  /* ---------- on the map ---------- */
  /* above saved rulers (664) and the report dots, below the drawn area (668) and the Measure line (675) */
  if (!map.getPane("dwpane")) { map.createPane("dwpane"); map.getPane("dwpane").style.zIndex = 665; }
  var layer = L.layerGroup().addTo(map), tmp = L.layerGroup().addTo(map), svg = L.svg({ pane: "dwpane" });
  function shown(r) { return !(W.OSAP_PLACES && W.OSAP_PLACES.shown && !W.OSAP_PLACES.shown("dw:" + r.id)); }
  function render(r, into, live) {
    var T = TYPES[r.t], S = shapes(r), w = zw(r.w), white = r.col === "#ffffff", halo = white ? "#212529" : "#fff", ds = dashOf(r.dash, w);
    var hit = function (lyr) { if (live) return; lyr.on("click", function (e) { if (e.originalEvent) L.DomEvent.stop(e.originalEvent); if (!placing) open(r.id); }); };
    S.fills.forEach(function (f) { L.polygon(f, { pane: "dwpane", renderer: svg, stroke: false, fillColor: r.col, fillOpacity: T.fill || (T.g === "fan" ? 0.12 : T.head === "axis" ? 0.15 : 0.1), interactive: false }).addTo(into); });
    S.lines.forEach(function (ln) {
      L.polyline(ln, { pane: "dwpane", renderer: svg, color: halo, weight: w + 2.5, opacity: 0.8, interactive: false, lineJoin: "round" }).addTo(into);
      L.polyline(ln, { pane: "dwpane", renderer: svg, color: r.col, weight: w, opacity: 1, dashArray: ds, lineCap: r.dash === "dot" ? "round" : "butt", lineJoin: "round", interactive: false }).addTo(into);
      if (!live) hit(L.polyline(ln, { pane: "dwpane", renderer: svg, color: "#000", weight: 18, opacity: 0, className: "dwhit" }).addTo(into));
    });
    S.solid.forEach(function (f) { var s = L.polygon(f, { pane: "dwpane", renderer: svg, color: halo, weight: 1.5, fillColor: r.col, fillOpacity: 1, interactive: !live }).addTo(into); hit(s); });
    S.labels.forEach(function (lb) {
      var cls = "dwl" + (lb[2] ? " dwl-" + lb[2] : "");
      L.marker(lb[0], { pane: "dwpane", keyboard: false, interactive: !live, icon: L.divIcon({ className: "dwk", iconSize: [0, 0],
        html: '<span class="' + cls + '"' + (live ? "" : ' data-dw="' + esc(r.id) + '"') + ' style="--dwc:' + r.col + '">' + esc(lb[1]) + "</span>" }) }).addTo(into);
    });
  }
  function draw() {
    layer.clearLayers();
    var here = cc();
    all().forEach(function (r) { if ((r.cc && here && r.cc !== here) || !shown(r) || r.id === editing) return; try { render(r, layer, false); } catch (e) {} });
    if (editing) editPaint();
  }
  /* a tap on a label opens its details; caught on the window first so a report dot under it does not take the tap */
  W.addEventListener("click", function (e) {
    var t = e.target && e.target.closest && e.target.closest("[data-dw]"); if (!t || placing) return;
    var mc = map.getContainer().classList; if (mc.contains("measuring") || mc.contains("area-drawing")) return;
    e.preventDefault(); e.stopPropagation(); open(t.getAttribute("data-dw"));
  }, true);

  /* ---------- the Draw card: the palette, then placing ---------- */
  var IC = {
    line: '<path d="M3 17 10 9l5 5 6-8"/>', arrow: '<path d="M3 19 19 5M11 5h8v8"/>', pl: '<path d="M3 15c5-6 9 2 18-5"/><text x="2" y="9" font-size="7" stroke="none" fill="currentColor" font-weight="700">PL</text>',
    bnd: '<path d="M3 12h18" stroke-width="3"/><path d="M10 8v8M14 8v8"/>', loa: '<path d="M3 14h18"/><text x="3" y="10" font-size="7" stroke="none" fill="currentColor" font-weight="700">LOA</text>',
    axis: '<path d="M3 15h11V11l7 5-7 5v-4H3z" transform="translate(0 -4)"/>', doa: '<path d="M3 12h13"/><path d="M15 7l6 5-6 5z" fill="currentColor"/>',
    shape: '<path d="M4 8l7-4 9 5-3 10H6z"/>', obj: '<path d="M4 7l8-3 8 4-2 11H6z"/><text x="7" y="15" font-size="6.5" stroke="none" fill="currentColor" font-weight="700">OBJ</text>',
    aa: '<ellipse cx="12" cy="12" rx="9" ry="7"/><text x="7.5" y="14.5" font-size="7" stroke="none" fill="currentColor" font-weight="700">AA</text>',
    ea: '<path d="M4 6h16v12H4z"/><text x="7.5" y="14.5" font-size="7" stroke="none" fill="currentColor" font-weight="700">EA</text>',
    bp: '<path d="M4 18V7h16v11"/><text x="7.5" y="15" font-size="7" stroke="none" fill="currentColor" font-weight="700">BP</text>',
    avoid: '<path d="M4 5h16v14H4z" stroke-dasharray="3 2"/><path d="M8 9l8 6M16 9l-8 6"/>', circle: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
    rings: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="9.5"/>', fan: '<path d="M12 20 4 6a14 14 0 0 1 16 0z"/>',
    text: '<path d="M5 6h14M12 6v13"/>', pt: '<path d="M12 21s-6-5.6-6-10.5a6 6 0 0 1 12 0C18 15.4 12 21 12 21z"/><circle cx="12" cy="10.5" r="2"/>'
  };
  function ic(k) { return '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + (IC[k] || IC.shape) + "</svg>"; }
  var CardCtl = L.Control.extend({ options: { position: "topleft" }, onAdd: function () {
    var d = L.DomUtil.create("div", "leaflet-control dwcard"); d.id = "dw-card"; d.hidden = true; d.setAttribute("role", "region"); d.setAttribute("aria-label", "Draw on the map");
    L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d); return d; } });
  new CardCtl().addTo(map);
  var card = D.getElementById("dw-card"), placing = null, ptMode = "", downAt = null, editing = "";
  function place() {
    var ph = phone(), corner = map._controlCorners && map._controlCorners[ph ? "bottomleft" : "topleft"];
    if (corner && card.parentNode !== corner) { if (ph) corner.insertBefore(card, corner.firstChild); else corner.appendChild(card); }
    card.classList.toggle("dwdock", ph);
    /* on a phone the docked card stops short of the map toolbar on the right, so neither covers the other */
    card.style.width = "";
    var tb = ph && D.getElementById("atk-tools"), t = tb && !tb.classList.contains("folded") && tb.getBoundingClientRect();
    if (t && t.width && !card.hidden) { var c = card.getBoundingClientRect(); if (c.width && t.left < c.right && t.left > c.left + 160) card.style.width = Math.floor(t.left - c.left - 6) + "px"; }
  }
  function isOpen() { return !card.hidden; }
  function palette(on) {
    if (on === undefined) on = card.hidden || !!placing || !!editing;
    if (placing) stop(true); if (editing) editEnd();
    ptMode = "";
    if (!on) { card.hidden = true; card.innerHTML = ""; paintBtn(); return; }
    if (W.OSAP_MEASURE && W.OSAP_MEASURE.state && W.OSAP_MEASURE.state().on !== false && map.getContainer().classList.contains("measuring")) W.OSAP_MEASURE.on(false);
    place();
    var n = all().filter(function (r) { return !r.cc || !cc() || r.cc === cc(); }).length;
    card.innerHTML = '<div class="dwhd"><b>Draw</b><span class="dwsub">Pick an item, then tap the map</span><button type="button" class="dwx" data-dw-k="off" aria-label="Close Draw">&times;</button></div>' +
      '<div class="dwpal">' + GROUPS.map(function (g) {
        return '<h4>' + esc(g[1]) + '</h4><div class="dwgrid">' + Object.keys(TYPES).filter(function (k) { return TYPES[k].grp === g[0]; }).map(function (k) {
          return '<button type="button" data-dw-t="' + k + '" title="' + esc(TYPES[k].lab + ": " + TYPES[k].tip) + '">' + ic(k) + "<span>" + esc(TYPES[k].lab) + "</span></button>"; }).join("") + "</div>";
      }).join("") +
      (W.OSAP_ATAK && W.OSAP_ATAK.pts && W.OSAP_ATAK.pts.add ? '<h4>Control measure points (2525D)</h4><div class="dwgrid">' + CMPTS.map(function (c) {
        return '<button type="button" data-dw-p="' + c[0] + '" title="' + esc(c[1]) + ': tap the map to place it">' + ic("pt") + "<span>" + esc(c[1]) + "</span></button>"; }).join("") + "</div>" : "") +
      "</div>" +
      '<p class="dwnote">' + (n ? n + " drawing" + (n === 1 ? "" : "s") + " on this map. Tap one to change or delete it. " : "") + "Kept in this browser; in My work &gt; My places with an on/off box." +
      (W.OSAP_PLACES ? ' <button type="button" class="dwlink" data-dw-k="places">My places</button>' : "") + "</p>";
    card.hidden = false; place(); paintBtn();
  }
  function start(t) {
    var T = TYPES[t]; if (!T) return;
    if (editing) editEnd();
    ptMode = ""; placing = { t: t, pts: [] }; card.hidden = false; place();
    map.getContainer().classList.add("dw-drawing"); placeUi(); place(); paintBtn();
  }
  function startPt(k) {
    var c = CMPTS.filter(function (x) { return x[0] === k; })[0]; if (!c) return;
    if (placing) stop(true);
    ptMode = k; card.hidden = false; place(); map.getContainer().classList.add("dw-drawing");
    card.innerHTML = '<div class="dwhd"><b>' + esc(c[1]) + '</b><button type="button" class="dwx" data-dw-k="cancel" aria-label="Cancel">&times;</button></div><p class="dwtip">Tap the map where the ' + esc(c[1].toLowerCase()) + " goes.</p>" +
      '<div class="dwbtns"><button type="button" data-dw-k="back">Back</button><button type="button" data-dw-k="cancel">Cancel</button></div>';
    paintBtn();
  }
  function placeUi() {
    var T = TYPES[placing.t], n = placing.pts.length, need = minPts(T), canFinish = !T.n && n >= need;
    card.innerHTML = '<div class="dwhd"><b>' + esc(T.lab) + '</b><span class="dwsub">' + n + " point" + (n === 1 ? "" : "s") + '</span><button type="button" class="dwx" data-dw-k="cancel" aria-label="Cancel">&times;</button></div>' +
      '<p class="dwtip">' + esc(T.tip) + (T.n ? "" : " (" + need + " or more).") + "</p>" +
      '<div class="dwbtns"><button type="button" data-dw-k="undo"' + (n ? "" : " disabled") + '>Undo</button>' + (T.n ? "" : '<button type="button" class="pri" data-dw-k="finish"' + (canFinish ? "" : " disabled") + ">Finish</button>") +
      '<button type="button" data-dw-k="back">Back</button><button type="button" data-dw-k="cancel">Cancel</button></div>';
    preview();
  }
  function preview() {
    tmp.clearLayers(); if (!placing) return;
    var T = TYPES[placing.t], P = placing.pts;
    if (P.length >= 2) { var r = { id: "dw-preview", t: placing.t, name: "\u2026", pts: P, col: T.col, dash: T.dash || "", w: T.w || 3 }; try { render(r, tmp, true); } catch (e) {} }
    placing.pts.forEach(function (p, i) {
      L.circleMarker(p, { pane: "dwpane", renderer: svg, radius: i === 0 ? 6 : 5, color: "#fff", weight: 2, fillColor: i === 0 ? "#212529" : "#e8590c", fillOpacity: 1, interactive: false }).addTo(tmp);
    });
  }
  function stop(cancel) {
    var p = placing; placing = null; ptMode = ""; tmp.clearLayers(); map.getContainer().classList.remove("dw-drawing");
    if (cancel || !p) return null;
    return finish(p);
  }
  function finish(p) {
    var T = TYPES[p.t], o = {};
    if (T.g === "text") { var s = W.prompt("Label text", ""); s = clean(s, 60); if (!s) { palette(true); return null; } o.name = s; }
    if (T.g === "fan" && p.pts.length >= 2) o.rng = Math.round(G.dist(p.pts[0], p.pts[1]));
    var id = add(p.t, p.pts, o);
    if (id) { card.hidden = true; card.innerHTML = ""; paintBtn(); open(id); } else palette(true);
    return id;
  }
  card.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("button"); if (!b) return;
    var t = b.getAttribute("data-dw-t"), pk = b.getAttribute("data-dw-p"), k = b.getAttribute("data-dw-k");
    if (t) { start(t); return; }
    if (pk) { startPt(pk); return; }
    if (k === "off") palette(false);
    else if (k === "places") { palette(false); if (W.OSAP_PLACES && W.OSAP_PLACES.open) W.OSAP_PLACES.open(); }
    else if (k === "cancel") { stop(true); palette(false); }
    else if (k === "back") { stop(true); palette(true); }
    else if (k === "undo" && placing) { placing.pts.pop(); placeUi(); }
    else if (k === "finish" && placing && placing.pts.length >= minPts(TYPES[placing.t])) stop(false);
    else if (k === "done") editEnd();
  });

  /* taps on the map while placing: caught on the window before the page's own map handlers, so a tap on a report dot adds a point */
  var mapEl = map.getContainer();
  function mine(e) {
    if ((!placing && !ptMode) || !mapEl.contains(e.target)) return false;
    if (e.target.closest && e.target.closest(".leaflet-control,.leaflet-popup")) return false;
    if (mapEl.classList.contains("measuring") || D.querySelector("#area-ctl .areahint")) return false;
    return true;
  }
  W.addEventListener("pointerdown", function (e) { downAt = mine(e) ? [e.clientX, e.clientY] : null; }, true);
  W.addEventListener("click", function (e) {
    if (!mine(e)) return;
    e.preventDefault(); e.stopPropagation();
    var d = downAt; downAt = null;
    if (!d || Math.abs(d[0] - e.clientX) > 8 || Math.abs(d[1] - e.clientY) > 8) return;   /* a pan, not a tap */
    var ll = map.mouseEventToLatLng(e), p = [ll.lat, G.wrap(ll.lng)];
    if (ptMode) { var c = CMPTS.filter(function (x) { return x[0] === ptMode; })[0]; stop(true); palette(false); dropPoint(c, ll); return; }
    var P = placing.pts, T = TYPES[placing.t];
    if (P.length) { var a = P[P.length - 1]; while (p[1] - a[1] > 180) p[1] -= 360; while (a[1] - p[1] > 180) p[1] += 360; }
    /* a tap on the last point again finishes a line or an area */
    if (!T.n && P.length >= minPts(T)) { var lp = map.latLngToContainerPoint(P[P.length - 1]), cp = map.latLngToContainerPoint(p); if (lp.distanceTo(cp) < 14) { stop(false); return; } }
    if (P.length >= MAX_PTS) { toast("Up to " + MAX_PTS + " points in one drawing."); return; }
    P.push(p);
    if (T.n && P.length >= T.n) { stop(false); return; }
    placeUi();
  }, true);
  W.addEventListener("dblclick", function (e) { if (mine(e)) { e.preventDefault(); e.stopPropagation(); } }, true);
  D.addEventListener("keydown", function (e) {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "")) return;
    if (placing || ptMode) {
      if (e.key === "Escape") { e.stopPropagation(); stop(true); palette(true); }
      else if (e.key === "Enter" && placing && !TYPES[placing.t].n && placing.pts.length >= minPts(TYPES[placing.t])) { e.preventDefault(); stop(false); }
      else if ((e.key === "Backspace" || (e.key === "z" && (e.ctrlKey || e.metaKey))) && placing && placing.pts.length) { e.preventDefault(); placing.pts.pop(); placeUi(); }
    } else if (editing && e.key === "Escape") editEnd();
  });
  /* a control measure point: an ordinary saved point with its 2525D symbol, opened in the point editor */
  function dropPoint(c, ll) {
    var A = W.OSAP_ATAK; if (!c || !A || !A.pts || !A.pts.add) return null;
    var n = 1, re = new RegExp("^" + c[1] + " (\\d+)$");
    A.pts.all().forEach(function (p) { var m = p.cc === cc() && re.exec(p.n || ""); if (m) n = Math.max(n, +m[1] + 1); });
    var pt = A.pts.add(ll, c[1] + " " + n); if (!pt) return null;
    var list = A.pts.all(); list.forEach(function (p) { if (p.id === pt.id) p.sym = sidcOf(c[2]); });
    if (A.pts.save(list)) { A.pts.draw(); if (A.pts.paint) A.pts.paint(); if (W.OSAP_POINTS && W.OSAP_POINTS.edit) W.OSAP_POINTS.edit(pt.id); }
    D.dispatchEvent(new Event("osap:points"));
    return pt.id;
  }

  /* ---------- editing the points of a saved item: a handle on each point, and a move handle ---------- */
  var edLayer = L.layerGroup().addTo(map), edPts = null, edT = 0;
  function editStart(id) {
    var r = get(id); if (!r) return;
    if (placing) stop(true);
    close(); editing = id; edPts = r.pts.map(function (p) { return p.slice(); });
    card.hidden = false; place();
    card.innerHTML = '<div class="dwhd"><b>Edit ' + esc(label(r)) + '</b><button type="button" class="dwx" data-dw-k="done" aria-label="Done">&times;</button></div>' +
      '<p class="dwtip">Drag a point to move it, or the ✥ handle to move the whole item.</p><div class="dwbtns"><button type="button" class="pri" data-dw-k="done">Done</button></div>';
    draw(); paintBtn();
  }
  function editPaint() {
    var r = get(editing); if (!r) { editing = ""; edLayer.clearLayers(); return; }
    r.pts = edPts; tmp.clearLayers(); edLayer.clearLayers();
    try { render(r, tmp, true); } catch (e) {}
    edPts.forEach(function (p, i) {
      var m = L.marker(p, { pane: "dwpane", draggable: true, keyboard: false, icon: L.divIcon({ className: "dwh", iconSize: [26, 26], html: "<span>" + (i + 1) + "</span>" }) }).addTo(edLayer);
      m.on("drag", function () { var q = m.getLatLng(); edPts[i] = [q.lat, q.lng]; livePaint(); });
      m.on("dragend", function () { var q = m.getLatLng(); edPts[i] = [q.lat, q.lng]; commit(); });
    });
    var g = TYPES[r.t].g, mv = L.marker(g === "area" ? centroid(edPts) : edPts[0], { pane: "dwpane", draggable: true, keyboard: false, icon: L.divIcon({ className: "dwh dwmv", iconSize: [30, 30], html: "<span>✥</span>" }) }).addTo(edLayer);
    /* a line, a ring, a sector, a circle or a label: the move handle sits just below-left of its first point, clear of the point's own handle */
    if (g !== "area") mv.setLatLng(map.containerPointToLatLng(map.latLngToContainerPoint(edPts[0]).add([-34, 34])));
    var from = null, base = null;
    mv.on("dragstart", function () { from = mv.getLatLng(); base = edPts.map(function (p) { return p.slice(); }); });
    mv.on("drag", function () { var q = mv.getLatLng(), dla = q.lat - from.lat, dlo = q.lng - from.lng; edPts = base.map(function (p) { return [Math.max(-89.9, Math.min(89.9, p[0] + dla)), p[1] + dlo]; }); livePaint(true); });
    mv.on("dragend", function () { commit(); });
  }
  function livePaint(all) {
    if (edT) return;
    edT = requestAnimationFrame(function () {
      edT = 0; var r = get(editing); if (!r) return; r.pts = edPts; tmp.clearLayers(); try { render(r, tmp, true); } catch (e) {}
      if (all) { var ms = edLayer.getLayers(); edPts.forEach(function (p, i) { if (ms[i]) ms[i].setLatLng(p); }); }
    });
  }
  function commit() { var r = get(editing); if (!r) return; r.pts = edPts.map(function (p) { return [p[0], G.wrap(p[1])]; }); r.updated = Date.now(); upsert(r); }
  function editEnd() { if (!editing) return; var id = editing; editing = ""; edLayer.clearLayers(); tmp.clearLayers(); card.hidden = true; card.innerHTML = ""; draw(); paintBtn(); open(id); }

  /* ---------- the details sheet ---------- */
  var el = null, cur = "";
  function ensure() {
    if (el) return el;
    el = D.createElement("div"); el.id = "dwdlg"; el.hidden = true; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "dw-h");
    D.body.appendChild(el);
    el.addEventListener("click", onSheet);
    el.addEventListener("change", onChange);
    el.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } else if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); e.target.blur(); } });
    return el;
  }
  function grid(p) { return G.mgrs(p[0], G.wrap(p[1])) || G.fmtLL(p[0], p[1]); }
  function facts(r) {
    var T = TYPES[r.t], P = r.pts, u = unit(), out = [];
    if (T.g === "line") out.push(["Length", G.fmtDist(lenOf(P), u)], ["Start", grid(P[0])], ["End", grid(P[P.length - 1])]);
    else if (T.g === "area") out.push(["Area", G.fmtArea(G.area(P), u)], ["Perimeter", G.fmtDist(lenOf(P.concat([P[0]])), u)], ["Center", grid(centroid(P))]);
    else if (T.g === "circle") { var m = G.dist(P[0], P[1]); out.push(["Center", grid(P[0])], ["Radius", G.fmtDist(m, u)]); }
    else if (T.g === "rings") out.push(["Center", grid(P[0])], ["Rings", (r.r || []).map(function (m) { return G.fmtDist(m, u); }).join(", ")]);
    else if (T.g === "fan") {
      var lim = fanLim(r), dc = G.decl(P[0][0], P[0][1]);
      out.push(["Position", grid(P[0])], ["Range", G.fmtDist(r.rng, u)],
        ["Left limit", G.fmtBrg(lim.l, false) + " T · " + G.fmtBrg(lim.l - dc, false) + " M · " + G.fmtBrg(lim.l, true)],
        ["Right limit", G.fmtBrg(lim.rt, false) + " T · " + G.fmtBrg(lim.rt - dc, false) + " M · " + G.fmtBrg(lim.rt, true)],
        ["Sector", Math.round(cw(lim.l, lim.rt)) + "° wide"]);
    } else if (T.g === "text") out.push(["At", grid(P[0])]);
    return out;
  }
  function text(r) {
    var T = TYPES[r.t], lines = [label(r) + " (" + T.lab + ", AXIOM OSAP planning graphic, WGS 84)"];
    facts(r).forEach(function (f) { lines.push(f[0] + ": " + f[1]); });
    if (T.g === "line" || T.g === "area") r.pts.forEach(function (p, i) { lines.push((i + 1) + ". " + grid(p)); });
    if (r.note) lines.push("Note: " + r.note);
    return lines.join("\n");
  }
  function open(id) {
    var r = get(id); if (!r) { close(); return; }
    ensure(); cur = r.id;
    var T = TYPES[r.t], away = r.cc && cc() && r.cc !== cc(), u = unit();
    el.innerHTML = '<div class="cbox"><div class="chead"><h2 id="dw-h">' + esc(T.lab) + '</h2><button type="button" class="x" aria-label="Close" data-dx="close">&times;</button></div>' +
      '<div class="dwname"><label for="dw-name">' + (T.g === "text" ? "Text" : "Name") + "</label>" + (T.pre ? '<b class="dwpre">' + esc(T.pre) + "</b>" : "") +
      '<input id="dw-name" data-df="name" maxlength="60" value="' + esc(r.name) + '"><span class="dwcol" style="background:' + r.col + '"></span></div>' +
      '<div class="dwsw" role="group" aria-label="Color">' + SWATCH.map(function (c) { return '<button type="button" data-dsw="' + c[0] + '" style="background:' + c[0] + '" aria-label="' + c[1] + '" title="' + c[1] + '" aria-pressed="' + (r.col === c[0]) + '"></button>'; }).join("") + "</div>" +
      (T.g === "text" ? "" : '<div class="dwls" role="group" aria-label="Line style">' + [["", "Solid"], ["dash", "Dashed"], ["dot", "Dotted"]].map(function (x) {
        return '<button type="button" data-dls="' + x[0] + '" aria-pressed="' + (r.dash === x[0]) + '">' + x[1] + "</button>"; }).join("") +
        '<label class="dwwid">Width <input type="range" min="1" max="8" step="0.5" data-df="w" value="' + r.w + '"></label></div>') +
      (T.g === "rings" ? '<label class="dwfield">Ring distances in meters, separated by commas<input data-df="r" inputmode="decimal" value="' + esc((r.r || []).join(", ")) + '"></label>' : "") +
      (T.g === "fan" ? '<label class="dwfield">Range in meters<input data-df="rng" inputmode="decimal" value="' + esc(r.rng) + '"></label>' : "") +
      (T.g === "circle" ? '<label class="dwfield">Radius in meters<input data-df="rad" inputmode="decimal" value="' + Math.round(G.dist(r.pts[0], r.pts[1])) + '"></label>' : "") +
      '<div class="dwfacts">' + facts(r).map(function (f) { return "<div><span>" + esc(f[0]) + "</span><b>" + esc(f[1]) + "</b></div>"; }).join("") + "</div>" +
      '<label class="dwfield">Note<textarea data-df="note" rows="2" maxlength="1000">' + esc(r.note) + "</textarea></label>" +
      (away ? '<p class="obs">Saved on the ' + esc(String(r.cc).toUpperCase()) + " map; choose that country to see it.</p>" : "") +
      '<div class="dwact"><button type="button" class="pri" data-dx="edit">Edit points</button><button type="button" data-dx="zoom">Zoom to</button><button type="button" data-dx="copy">Copy</button><button type="button" class="del" data-dx="remove">Delete</button><button type="button" data-dx="close">Done</button></div>' +
      '<p class="obs">Your own planning graphic, kept in this browser: not a report. In My work &gt; My places with an on/off box; exported with KML and GeoJSON. Distances in ' + esc((G.UNITS[u] || {}).name || u) + ".</p></div>";
    el.hidden = false;
  }
  function close() { if (el) { el.hidden = true; el.innerHTML = ""; } cur = ""; }
  function onChange(e) {
    var f = e.target.getAttribute && e.target.getAttribute("data-df"), r = get(cur); if (!f || !r) return;
    var v = e.target.value;
    if (f === "name") { v = clean(v, 60); if (!v) { e.target.value = r.name; return; } r.name = v; }
    else if (f === "note") r.note = cleanNote(v);
    else if (f === "w") r.w = Math.max(1, Math.min(8, +v || 3));
    else if (f === "r") { var a = okRadii(String(v).split(/[,;\s]+/)); if (!a.length) { e.target.value = (r.r || []).join(", "); return; } r.r = a; }
    else if (f === "rng") { var m = +String(v).replace(/[^\d.]/g, ""); if (!(m > 0 && m <= 2e6)) { e.target.value = r.rng; return; } r.rng = m; }
    else if (f === "rad") { var rm = +String(v).replace(/[^\d.]/g, ""); if (!(rm > 0 && rm <= 2e6)) return; r.pts[1] = G.dest(r.pts[0], bearing(r.pts[0], r.pts[1]) || 90, rm); }
    else return;
    r.updated = Date.now(); upsert(r);
    /* drawn again after the event, so the field being left is not pulled out from under its own blur */
    if (f !== "note" && f !== "name") setTimeout(function () { if (cur === r.id) open(r.id); }, 0);
  }
  function copyText(t, b) {
    function ok() { if (b) { var o = b.textContent; b.textContent = "Copied"; setTimeout(function () { b.textContent = o; }, 1200); } }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, function () { W.prompt("Copy:", t); }); else W.prompt("Copy:", t);
  }
  function bounds(r) { var S = shapes(r), all = []; S.lines.concat(S.fills, S.solid).forEach(function (x) { all = all.concat(x); }); S.labels.forEach(function (x) { all.push(x[0]); }); return all.length ? L.latLngBounds(all) : L.latLngBounds(r.pts); }
  /* the south-west and north-east corners of everything drawn for it, for My places' Go to */
  function bbox(rec) { var r = okRec(rec); if (!r) return null; try { var b = bounds(r); return [[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]]; } catch (e) { return null; } }
  function onSheet(e) {
    if (e.target === el) { close(); return; }
    var b = e.target.closest && e.target.closest("button"); if (!b) return;
    var r = get(cur); if (!r) { close(); return; }
    var k = b.getAttribute("data-dx"), sw = b.getAttribute("data-dsw"), ls = b.getAttribute("data-dls");
    /* a typed name or note not yet committed is kept with the color change */
    var nm = el.querySelector("#dw-name"), nt = el.querySelector("[data-df=note]");
    if (nm && clean(nm.value, 60)) r.name = clean(nm.value, 60); if (nt) r.note = cleanNote(nt.value);
    if (sw && hex(sw)) { r.col = hex(sw); r.updated = Date.now(); upsert(r); open(r.id); return; }
    if (ls !== null && /^(|dash|dot)$/.test(ls)) { r.dash = ls; r.updated = Date.now(); upsert(r); open(r.id); return; }
    if (k === "close") { if (nm || nt) { r.updated = Date.now(); upsert(r); } close(); }
    else if (k === "copy") copyText(text(r), b);
    else if (k === "zoom") { close(); try { map.fitBounds(bounds(r), { padding: [50, 50], maxZoom: 17 }); } catch (x) {} }
    else if (k === "edit") { upsert(r); try { if (!map.getBounds().contains(bounds(r))) map.fitBounds(bounds(r), { padding: [60, 60], maxZoom: 17 }); } catch (x) {} editStart(r.id); }
    else if (k === "remove") remove(r.id);
  }
  var undoEl = null, undoT = 0;
  function undoBar(msg, undo) {
    if (!undoEl) {
      undoEl = D.createElement("div"); undoEl.className = "leaflet-control aoiundo dwundo"; undoEl.setAttribute("role", "status");
      map.getContainer().appendChild(undoEl); L.DomEvent.disableClickPropagation(undoEl);
    }
    undoEl.innerHTML = "<span>" + esc(msg) + '</span><button type="button">Undo</button>'; undoEl.hidden = false;
    undoEl.querySelector("button").onclick = function () { undoEl.hidden = true; clearTimeout(undoT); undo(); };
    clearTimeout(undoT); undoT = setTimeout(function () { undoEl.hidden = true; }, 8000);
  }
  /* the toolbar's Draw button is lit while the card is open (assets/osap-atak.js) */
  function paintBtn() { var b = D.querySelector('#atk-tools [data-atk="draw"]'); if (b) b.setAttribute("aria-pressed", String(!card.hidden)); }

  /* ---------- export: the shapes as KML / GeoJSON features (assets/osap-ws.js) ---------- */
  function features(rec) {
    var r = okRec(rec); if (!r) return [];
    var T = TYPES[r.t], S = shapes(r), base = { kind: "drawing", name: label(r), note: text(r), cc: r.cc, col: r.col === "#ffffff" ? "#f1f3f5" : r.col }, F = [];
    if (T.g === "text") return [Object.assign({ g: "Point", P: [r.pts[0]] }, base)];
    if (T.g === "area" || T.g === "circle" || T.g === "fan" || T.head === "axis") S.fills.forEach(function (f) { F.push(Object.assign({ g: "Polygon", P: f }, base)); });
    else S.lines.forEach(function (ln, i) { F.push(Object.assign({ g: "LineString", P: ln }, base, i ? { name: label(r) + (T.g === "rings" ? " " + G.fmtDist(r.r[i], "km") : " (head)") } : {})); });
    if (T.g === "rings") F[0] && (F[0].name = label(r) + " " + G.fmtDist(r.r[0], "km"));
    return F;
  }

  var st = D.createElement("style");
  st.textContent = ".dwcard{background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:6px;box-shadow:0 1px 6px rgba(0,0,0,.3);padding:8px 10px;width:330px;max-width:calc(100vw - 80px);max-height:62vh;overflow:auto;font-size:12.5px;line-height:1.35;clear:both}" +
    ".dwcard[hidden]{display:none}.dwcard .dwhd{display:flex;align-items:center;gap:8px;margin-bottom:4px}.dwcard .dwhd b{font-size:15px}.dwcard .dwsub{flex:1;color:var(--muted);font-size:11.5px}" +
    ".dwcard .dwx{font-size:22px;line-height:1;background:none;border:0;color:var(--ink);cursor:pointer;min-width:36px;min-height:36px}" +
    ".dwcard h4{margin:8px 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}" +
    ".dwcard .dwgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:4px}" +
    ".dwcard .dwgrid button{display:flex;flex-direction:column;align-items:center;gap:2px;font:inherit;font-size:11.5px;line-height:1.15;border:1px solid var(--line);background:var(--surface2,var(--surface));color:var(--ink);border-radius:5px;padding:6px 3px;min-height:58px;cursor:pointer;text-align:center}" +
    ".dwcard .dwgrid button:hover,.dwcard .dwgrid button:focus-visible{border-color:var(--accent);color:var(--accent)}" +
    ".dwcard .dwtip,.dwcard .dwnote{margin:4px 0;color:var(--muted);font-size:12px}.dwcard .dwtip{color:var(--ink)}.dwcard .dwlink{font:inherit;background:none;border:0;color:var(--accent);text-decoration:underline;cursor:pointer;padding:0}" +
    ".dwcard .dwbtns{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}.dwcard .dwbtns button{font:inherit;font-size:13px;font-weight:600;border:1px solid var(--line);background:var(--surface2,var(--surface));color:var(--ink);border-radius:5px;min-height:38px;padding:0 12px;cursor:pointer}" +
    ".dwcard .dwbtns button[disabled]{opacity:.45;cursor:default}.dwcard .dwbtns .pri{background:var(--accent);color:var(--on-accent,#fff);border-color:var(--accent)}" +
    "#map.dw-drawing,#map.dw-drawing .leaflet-interactive{cursor:crosshair}" +
    "@media (max-width:700px){.leaflet-control.dwcard.dwdock{width:calc(100vw - 20px);max-width:none;box-sizing:border-box;max-height:46vh;margin-bottom:6px}.dwcard .dwgrid{grid-template-columns:repeat(3,1fr)}.dwcard .dwgrid button{min-height:54px;font-size:10.5px}}" +
    ".dwk{background:none;border:0;pointer-events:none!important}.dwk .dwl{pointer-events:auto}" +
    ".dwl{position:absolute;transform:translate(-50%,-50%);white-space:nowrap;color:var(--dwc,#212529);font:800 12px/1 system-ui,sans-serif;letter-spacing:.02em;cursor:pointer;" +
    "text-shadow:0 0 2px #fff,0 0 2px #fff,0 0 3px #fff,0 0 4px #fff}.dwl-end{transform:translate(-50%,-150%)}.dwl-ring{font-size:10.5px;font-weight:700;transform:translate(-50%,-110%)}" +
    ".dwl-lim{font-size:11px;font-weight:700}.dwl-ctr{transform:translate(-50%,40%)}.dwl-text{font-size:15px}.dwl-area{font-size:13px}" +
    ".dwh{background:none;border:0}.dwh span{display:block;width:22px;height:22px;border-radius:50%;background:#e8590c;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5);color:#fff;font:700 11px/22px system-ui,sans-serif;text-align:center;cursor:grab}" +
    ".dwh.dwmv span{width:26px;height:26px;line-height:26px;background:#212529;font-size:16px}" +
    "#dwdlg{position:fixed;inset:0;z-index:100001;overflow:auto;background:rgba(0,0,0,.45);padding:16px}#dwdlg[hidden]{display:none}" +
    "#dwdlg .cbox{max-width:480px;margin:0 auto;background:var(--surface,#fff);color:var(--ink,#111);border-radius:8px;padding:12px 16px 16px;font-size:13px;line-height:1.4;box-shadow:0 6px 24px rgba(0,0,0,.3)}" +
    "#dwdlg .chead{display:flex;align-items:center;gap:8px}#dwdlg .chead h2{margin:0;font-size:18px;flex:1;text-align:center}#dwdlg .x{font-size:26px;min-width:44px;min-height:44px;background:none;border:0;color:inherit;cursor:pointer}" +
    "#dwdlg .dwname{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--line,#ddd)}#dwdlg .dwname label{font-size:15px}#dwdlg .dwpre{font:700 15px system-ui,sans-serif}" +
    "#dwdlg .dwname input{flex:1;min-width:0;font:inherit;font-size:16px;border:1px solid var(--line,#bbb);border-radius:4px;padding:5px 7px;background:none;color:inherit}" +
    "#dwdlg .dwcol{width:32px;height:32px;border-radius:4px;border:2px solid #fff;box-shadow:0 0 0 1px var(--line,#bbb);flex:none}" +
    "#dwdlg .dwsw{display:grid;grid-template-columns:repeat(10,1fr);gap:5px;margin:8px 0}#dwdlg .dwsw button{height:28px;padding:0;border:2px solid rgba(0,0,0,.2);border-radius:5px;cursor:pointer;min-width:0}#dwdlg .dwsw button[aria-pressed=true]{outline:2px solid var(--accent,#1c7ed6);outline-offset:1px}" +
    "#dwdlg .dwls{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin:4px 0 8px}#dwdlg .dwls button{font:inherit;font-weight:600;min-height:34px;padding:0 10px;border:1px solid var(--line,#bbb);border-radius:5px;background:var(--surface2,var(--surface,#fff));color:inherit;cursor:pointer}" +
    "#dwdlg .dwls button[aria-pressed=true]{background:var(--accent,#1c7ed6);color:var(--on-accent,#fff);border-color:var(--accent,#1c7ed6)}#dwdlg .dwwid{display:flex;align-items:center;gap:6px;margin-left:auto}#dwdlg .dwwid input{width:110px}" +
    "#dwdlg .dwfield{display:block;margin:6px 0;font-size:12px;color:var(--muted,#666)}#dwdlg .dwfield input,#dwdlg .dwfield textarea{display:block;width:100%;box-sizing:border-box;margin-top:3px;font:inherit;font-size:15px;color:var(--ink,#111);background:none;border:1px solid var(--line,#bbb);border-radius:4px;padding:5px 7px}" +
    "#dwdlg .dwfacts{display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;padding:8px 0;border-top:1px solid var(--line,#ddd);border-bottom:1px solid var(--line,#ddd);margin:6px 0}" +
    "#dwdlg .dwfacts span{display:block;font-size:11px;color:var(--muted,#666)}#dwdlg .dwfacts b{display:block;font:600 13px/1.25 'IBM Plex Mono',monospace;word-break:break-word}" +
    "#dwdlg .dwact{display:grid;grid-template-columns:repeat(auto-fit,minmax(84px,1fr));gap:6px;margin:10px 0 6px}#dwdlg .dwact button{font:inherit;font-weight:600;min-height:42px;border:1px solid var(--line,#bbb);border-radius:6px;background:var(--surface2,var(--surface,#fff));color:inherit;cursor:pointer}" +
    "#dwdlg .dwact .pri{color:var(--accent,#1c7ed6)}#dwdlg .dwact .del{color:#c92a2a}#dwdlg .obs{color:var(--muted,#666);font-size:11.5px;margin:4px 0 0}" +
    "@media (max-width:420px){#dwdlg .dwsw{grid-template-columns:repeat(5,1fr)}#dwdlg{padding:8px}#dwdlg .dwfacts{grid-template-columns:1fr}}";
  D.head.appendChild(st);

  W.matchMedia("(max-width: 700px)").addEventListener && W.matchMedia("(max-width: 700px)").addEventListener("change", function () { if (!card.hidden) place(); });
  D.addEventListener("osap:places", draw);
  D.addEventListener("osap:view", function () { setTimeout(draw, 0); });
  D.addEventListener("osap:country", function () { if (placing) stop(true); if (editing) { editing = ""; edLayer.clearLayers(); tmp.clearLayers(); card.hidden = true; } draw(); });
  W.addEventListener("osap-meas-unit", function () { draw(); if (cur && el && !el.hidden) open(cur); });
  W.addEventListener("storage", function (e) { if (e.key === KEY) draw(); });
  /* line widths follow the zoom (thinner when zoomed out), as the drawn area's do */
  map.on("zoomend", function () { draw(); if (placing) preview(); });
  map.on("resize", function () { if (!card.hidden) place(); });

  W.OSAP_DRAW = { all: all, get: get, add: add, update: update, remove: remove, open: open, close: close, start: start, palette: palette, point: startPt,
    edit: editStart, editEnd: editEnd, redraw: draw, features: features, text: text, label: label, bbox: bbox, isOpen: isOpen, placing: function () { return placing ? { t: placing.t, pts: placing.pts.slice() } : null; },
    TYPES: TYPES, POINTS: CMPTS.map(function (c) { return { id: c[0], name: c[1], sym: sidcOf(c[2]) }; }), KEY: KEY };
  draw();
})();
