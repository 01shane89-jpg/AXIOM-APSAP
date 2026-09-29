/* AXIOM OSAP: the Measure tool, on every country and tab (a ruler button under the full-screen button, top left of the map).
   Tap the map to add points; drag a point to move it; tap the first point (three or more) to close the shape for its area.
   Shows each leg's distance, true and magnetic bearing (World Magnetic Model 2025), the total, the area and perimeter of a
   closed shape, and every point as an MGRS grid reference and latitude/longitude, with copy buttons. Units: km, mi or nm;
   bearings in degrees or NATO mils (6400).
   All maths runs in this browser (assets/osap-geo.js); nothing is sent anywhere and nothing is saved except the unit choice.
   A measurement is the analyst's own working, never a record. "Plan route" hands the points to the Route tab when it is loaded. */
(function () {
  "use strict";
  if (/[?&]watchscan=1(&|$)/.test(location.search)) return;
  var G = window.OSAP_GEO, map = window.__asapMap;
  if (!G || !map || !window.L) return;
  var UKEY = "osap-meas-unit", phoneMq = window.matchMedia("(max-width: 700px)"), S = { on: false, more: !phoneMq.matches, pts: [], closed: false, unit: "km", mils: false, fmt: "mgrs", hover: null, down: null, dragging: false };
  try { var u0 = JSON.parse(localStorage.getItem(UKEY) || "null"); if (u0) { if (G.UNITS[u0.unit]) S.unit = u0.unit; S.mils = !!u0.mils; if (/^(mgrs|dec|dms)$/.test(u0.fmt)) S.fmt = u0.fmt; } } catch (e) {}
  function keep() { try { localStorage.setItem(UKEY, JSON.stringify({ unit: S.unit, mils: S.mils, fmt: S.fmt })); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  if (!map.getPane("measpane")) { map.createPane("measpane"); map.getPane("measpane").style.zIndex = 675; }
  var svg = L.svg({ pane: "measpane" }), layer = L.layerGroup(), verts = [], lbls = L.layerGroup();

  /* ---------- the button and the card ---------- */
  var RULER = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" d="M3 16.5 16.5 3 21 7.5 7.5 21z"/><path stroke="currentColor" stroke-width="1.6" d="M7 12.5l1.8 1.8M9.5 10l1.2 1.2M12 7.5l1.8 1.8M14.5 5l1.2 1.2"/></svg>';
  var BtnCtl = L.Control.extend({ options: { position: "topleft" }, onAdd: function () {
    var d = L.DomUtil.create("div", "leaflet-bar leaflet-control measctl");
    d.innerHTML = '<a href="#" role="button" id="meas-btn" title="Measure distance, bearing and area" aria-label="Measure distance, bearing and area" aria-pressed="false">' + RULER + "</a>";
    L.DomEvent.disableClickPropagation(d); return d; } });
  var CardCtl = L.Control.extend({ options: { position: "topleft" }, onAdd: function () {
    var d = L.DomUtil.create("div", "leaflet-control meascard"); d.id = "meas-card"; d.hidden = true;
    d.setAttribute("role", "region"); d.setAttribute("aria-label", "Measure");
    L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d); return d; } });
  new BtnCtl().addTo(map); new CardCtl().addTo(map);
  var btn = document.getElementById("meas-btn"), card = document.getElementById("meas-card");

  /* ---------- sums ---------- */
  function legs() {
    var P = S.pts, out = [];
    var n = S.closed ? P.length : P.length - 1;
    for (var i = 0; i < n; i++) {
      var a = P[i], b = P[(i + 1) % P.length], inv = G.inverse(a, b), dc = G.decl(a[0], a[1]);
      out.push({ i: i, j: (i + 1) % P.length, m: inv.m, t: inv.b1, mag: inv.b1 - dc, back: (inv.b2 + 180) % 360, dc: dc });
    }
    return out;
  }
  function brg(t) { return G.fmtBrg(t, S.mils); }
  function pos(p) { return S.fmt === "dec" ? G.fmtLL(p[0], p[1]) : S.fmt === "dms" ? G.fmtDms(p[0], p[1]) : (G.mgrs(p[0], p[1]) || G.fmtLL(p[0], p[1]) + " (no MGRS here)"); }
  function declTxt(d) { return Math.abs(d).toFixed(1) + "° " + (d >= 0 ? "E" : "W"); }

  /* ---------- drawing ---------- */
  function draw() {
    layer.clearLayers(); lbls.clearLayers(); verts = [];
    if (!S.on) return;
    var P = S.pts, L0 = legs(), line = [];
    L0.forEach(function (g, k) {
      var seg = G.path(P[g.i], P[g.j], 25);
      /* keep longitudes continuous from the leg before, so a line across the dateline is not drawn the long way round */
      if (line.length) { var off = line[line.length - 1][1] - seg[0][1]; seg = seg.map(function (q) { return [q[0], q[1] + Math.round(off / 360) * 360]; }); }
      line = line.concat(k ? seg.slice(1) : seg);
      var mid = seg[Math.floor(seg.length / 2)];
      L.tooltip({ permanent: true, direction: "center", className: "measlbl", interactive: false }).setLatLng(mid)
        .setContent(esc(G.fmtDist(g.m, S.unit)) + " · " + esc(brg(g.t)) + (S.mils ? "" : "T")).addTo(lbls);
    });
    if (S.closed && P.length >= 3) L.polygon(line, { pane: "measpane", renderer: svg, stroke: false, fillColor: "#f59f00", fillOpacity: 0.15, interactive: false }).addTo(layer);
    if (line.length) {
      L.polyline(line, { pane: "measpane", renderer: svg, color: "#fff", weight: 6, opacity: 0.85, interactive: false }).addTo(layer);
      L.polyline(line, { pane: "measpane", renderer: svg, color: "#e8590c", weight: 3, dashArray: "8 6", interactive: false }).addTo(layer);
    }
    P.forEach(function (p, i) {
      var first = i === 0 && P.length >= 3 && !S.closed;
      var m = L.marker(p, { pane: "measpane", draggable: true, keyboard: false, title: first ? "Point 1: tap to close the shape" : "Point " + (i + 1) + ": drag to move",
        icon: L.divIcon({ className: "measv" + (i === 0 ? " first" : ""), html: "<span>" + (i + 1) + "</span>", iconSize: [22, 22], iconAnchor: [11, 11] }) });
      m.on("dragstart", function () { S.dragging = true; });
      m.on("drag", function (e) { var ll = e.target.getLatLng(); S.pts[i] = [ll.lat, ll.lng]; drawLines(); });
      m.on("dragend", function (e) { var ll = e.target.getLatLng(); S.pts[i] = [ll.lat, ll.lng]; S.dragging = false; setTimeout(function () { draw(); ui(); }, 0); });
      m.on("click", function (e) { if (e.originalEvent) L.DomEvent.stop(e.originalEvent); if (first) { S.closed = true; draw(); ui(); } });
      m.addTo(layer); verts.push(m);
    });
  }
  /* while a point is dragged only the lines move; labels and the card catch up when it is dropped */
  var dragT = 0;
  function drawLines() { if (dragT) return; dragT = requestAnimationFrame(function () { dragT = 0; var keepV = verts; layer.eachLayer(function (l) { if (keepV.indexOf(l) < 0) layer.removeLayer(l); }); var P = S.pts, L0 = legs(), line = [];
    L0.forEach(function (g, k) { var seg = G.path(P[g.i], P[g.j], 25); line = line.concat(k ? seg.slice(1) : seg); });
    if (line.length) L.polyline(line, { pane: "measpane", renderer: svg, color: "#e8590c", weight: 3, dashArray: "8 6", interactive: false }).addTo(layer);
    lbls.clearLayers(); }); }

  /* ---------- the card ---------- */
  function ui() {
    if (!S.on) { card.hidden = true; return; }
    card.hidden = false;
    var P = S.pts, L0 = legs(), tot = 0; L0.forEach(function (g) { tot += g.m; });
    var h = '<div class="mhd"><b>Measure</b><button type="button" class="mx" data-m="off" aria-label="Close measure">×</button></div>';
    h += '<div class="mrow" role="group" aria-label="Units">' + ["km", "mi", "nm"].map(function (u) { return '<button type="button" data-mu="' + u + '" aria-pressed="' + (S.unit === u) + '">' + u + "</button>"; }).join("") +
      '<button type="button" data-mm="1" aria-pressed="' + S.mils + '" title="Bearings in NATO mils (6400 to a circle)">mils</button></div>';
    if (!P.length) h += '<p class="mhint">Tap the map to add points. Drag a point to move it. Tap point 1 again to close a shape and get its area.</p>';
    else {
      h += '<div class="mtot"><div><span>' + (S.closed ? "Perimeter" : "Distance") + "</span><b>" + esc(G.fmtDist(tot, S.unit)) + "</b></div>" +
        (S.closed ? "<div><span>Area</span><b>" + esc(G.fmtArea(G.area(P), S.unit)) + "</b></div>" : "") +
        (L0.length === 1 ? "<div><span>Bearing</span><b>" + esc(brg(L0[0].t)) + (S.mils ? "" : "T") + "</b></div>" : "") + "</div>";
      h += '<button type="button" class="mmore" data-mo="1" aria-expanded="' + S.more + '">' + (S.more ? "Hide legs and points" : "Show legs and points (" + P.length + ")") + "</button>";
      if (S.more) {
      if (L0.length) h += '<table class="mlegs"><thead><tr><th>Leg</th><th>Distance</th><th>True</th><th>Mag</th><th>Back</th></tr></thead><tbody>' +
        L0.map(function (g) { return "<tr><td>" + (g.i + 1) + "–" + (g.j + 1) + "</td><td>" + esc(G.fmtDist(g.m, S.unit)) + "</td><td>" + esc(brg(g.t)) + "</td><td>" + esc(brg(g.mag)) + "</td><td>" + esc(brg(g.back)) + "</td></tr>"; }).join("") + "</tbody></table>";
      h += '<div class="mrow mfmt" role="group" aria-label="Position format">' + [["mgrs", "MGRS"], ["dec", "Lat/lon"], ["dms", "DMS"]].map(function (f) { return '<button type="button" data-mf="' + f[0] + '" aria-pressed="' + (S.fmt === f[0]) + '">' + f[1] + "</button>"; }).join("") + "</div>";
      h += '<ol class="mpts">' + P.map(function (p, i) { return '<li><span class="mn">' + (i + 1) + '</span><code>' + esc(pos(p)) + '</code><button type="button" data-mc="' + i + '" title="Copy">Copy</button><button type="button" data-md="' + i + '" aria-label="Remove point ' + (i + 1) + '">×</button></li>'; }).join("") + "</ol>";
      var d0 = G.decl(P[0][0], P[0][1]);
      h += '<p class="mnote">Ellipsoid distances (WGS 84). Magnetic from ' + G.MODEL + ": declination " + esc(declTxt(d0)) + " at point 1. Back = bearing to return along the leg.</p>";
      }
    }
    h += '<p class="mptr" aria-live="off"></p>';
    h += '<div class="mbtns">' +
      '<button type="button" data-m="undo"' + (P.length ? "" : " disabled") + ">Undo</button>" +
      '<button type="button" data-m="clear"' + (P.length ? "" : " disabled") + ">Clear</button>" +
      (P.length >= 3 ? '<button type="button" data-m="close">' + (S.closed ? "Open shape" : "Close shape") + "</button>" : "") +
      (P.length ? '<button type="button" data-m="copy">Copy all</button>' : "") +
      (P.length >= 2 && window.OSAP_ROUTE_SEED ? '<button type="button" data-m="route" class="pri">Plan route</button>' : "") + "</div>";
    card.innerHTML = h;
    fit();
    hoverUi();
  }
  /* the card stops above the map's Legend (bottom left) so neither covers the other */
  function fit() {
    var mr = map.getContainer().getBoundingClientRect(), cr = card.getBoundingClientRect(), lg = map.getContainer().querySelector(".leaflet-bottom.leaflet-left");
    var bottom = mr.bottom - 8; if (lg) { var lr = lg.getBoundingClientRect(); if (lr.height && lr.left < cr.right) bottom = Math.min(bottom, lr.top - 6); }
    card.style.maxHeight = Math.max(140, Math.floor(bottom - cr.top)) + "px";
  }
  map.on("resize", function () { if (S.on) fit(); });
  /* the pointer readout (mouse only): where the pointer is, and distance and bearing to it from the last point */
  var hvLine = L.polyline([], { pane: "measpane", renderer: svg, color: "#e8590c", weight: 2, opacity: 0.6, dashArray: "3 5", interactive: false });
  function hoverUi() {
    var el = card.querySelector(".mptr"), P = S.pts, show = S.on && S.hover;
    if (el) {
      var hv = "";
      if (show) {
        hv = "Pointer " + pos(S.hover);
        if (P.length && !S.closed) { var iv = G.inverse(P[P.length - 1], S.hover); hv += " · " + G.fmtDist(iv.m, S.unit) + " " + brg(iv.b1) + (S.mils ? "" : "T") + " from " + P.length; }
      }
      el.textContent = hv; el.hidden = !hv;
    }
    if (show && P.length && !S.closed) { hvLine.setLatLngs(G.path(P[P.length - 1], S.hover, 50)); if (!map.hasLayer(hvLine)) hvLine.addTo(map); }
    else if (map.hasLayer(hvLine)) map.removeLayer(hvLine);
  }
  function text() {
    var L0 = legs(), tot = 0, lines = ["AXIOM OSAP measurement (" + G.MODEL + " magnetic, WGS 84)"];
    S.pts.forEach(function (p, i) { lines.push((i + 1) + ". " + G.mgrs(p[0], p[1]) + "  " + G.fmtLL(p[0], p[1])); });
    L0.forEach(function (g) { tot += g.m; lines.push("Leg " + (g.i + 1) + "-" + (g.j + 1) + ": " + G.fmtDist(g.m, S.unit) + ", " + brg(g.t) + " true, " + brg(g.mag) + " magnetic"); });
    lines.push((S.closed ? "Perimeter " : "Total ") + G.fmtDist(tot, S.unit) + (S.closed ? ", area " + G.fmtArea(G.area(S.pts), S.unit) : ""));
    return lines.join("\n");
  }
  function copy(t, b) {
    function ok() { if (b) { var o = b.textContent; b.textContent = "Copied"; setTimeout(function () { b.textContent = o; }, 1200); } }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, function () { window.prompt("Copy:", t); });
    else window.prompt("Copy:", t);
  }
  card.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("button"); if (!b) return;
    var k = b.getAttribute("data-m");
    if (b.hasAttribute("data-mu")) { S.unit = b.getAttribute("data-mu"); keep(); }
    else if (b.hasAttribute("data-mm")) { S.mils = !S.mils; keep(); }
    else if (b.hasAttribute("data-mo")) S.more = !S.more;
    else if (b.hasAttribute("data-mf")) { S.fmt = b.getAttribute("data-mf"); keep(); }
    else if (b.hasAttribute("data-mc")) { var p = S.pts[+b.getAttribute("data-mc")]; if (p) copy(pos(p), b); return; }
    else if (b.hasAttribute("data-md")) { S.pts.splice(+b.getAttribute("data-md"), 1); if (S.pts.length < 3) S.closed = false; }
    else if (k === "off") return setOn(false);
    else if (k === "undo") { if (S.closed) S.closed = false; else S.pts.pop(); }
    else if (k === "clear") { S.pts = []; S.closed = false; }
    else if (k === "close") S.closed = !S.closed;
    else if (k === "copy") return copy(text(), b);
    else if (k === "route") { if (window.OSAP_ROUTE_SEED) window.OSAP_ROUTE_SEED(S.pts.slice()); return; }
    draw(); ui();
  });

  /* ---------- turning it on and taking taps ---------- */
  function setOn(on) {
    S.on = on; S.hover = null;
    btn.setAttribute("aria-pressed", String(on)); btn.classList.toggle("on", on);
    map.getContainer().classList.toggle("measuring", on);
    if (on) { layer.addTo(map); lbls.addTo(map); } else { map.removeLayer(layer); map.removeLayer(lbls); map.removeLayer(hvLine); }
    draw(); ui();
  }
  btn.addEventListener("click", function (e) { e.preventDefault(); setOn(!S.on); });
  /* taps are caught on the window before the page's own map-click handlers (report pop-ups, the canvas dispatcher), so a tap
     that lands on a report dot adds a point instead of opening the report. Drawing an area (Draw area) keeps its own taps. */
  var mapEl = map.getContainer();
  function mine(e) {
    if (!S.on || !mapEl.contains(e.target)) return false;
    if (e.target.closest && e.target.closest(".leaflet-control,.leaflet-popup,.measv")) return false;
    if (document.querySelector("#area-ctl .areahint")) return false;
    return true;
  }
  window.addEventListener("pointerdown", function (e) { S.down = mine(e) ? [e.clientX, e.clientY] : null; }, true);
  window.addEventListener("click", function (e) {
    if (!mine(e)) return;
    e.preventDefault(); e.stopPropagation();
    var d = S.down; S.down = null;
    if (!d || Math.abs(d[0] - e.clientX) > 6 || Math.abs(d[1] - e.clientY) > 6 || S.dragging) return;   /* a pan, not a tap */
    if (S.closed) { S.closed = false; S.pts = []; }
    var ll = map.mouseEventToLatLng(e);
    S.pts.push([ll.lat, G.wrap(ll.lng)]);
    /* keep the new point on the same side of the dateline as the one before, so the line and labels follow it */
    if (S.pts.length > 1) { var a = S.pts[S.pts.length - 2], b = S.pts[S.pts.length - 1]; while (b[1] - a[1] > 180) b[1] -= 360; while (a[1] - b[1] > 180) b[1] += 360; }
    draw(); ui();
  }, true);
  window.addEventListener("dblclick", function (e) { if (mine(e)) { e.preventDefault(); e.stopPropagation(); } }, true);
  var hovT = 0;
  mapEl.addEventListener("pointermove", function (e) {
    if (e.pointerType !== "mouse" || !S.on || S.dragging || (e.target.closest && e.target.closest(".leaflet-control"))) return;
    var ll = map.mouseEventToLatLng(e); S.hover = [ll.lat, ll.lng];
    if (!hovT) hovT = requestAnimationFrame(function () { hovT = 0; hoverUi(); });
  });
  mapEl.addEventListener("mouseleave", function () { if (S.on && S.hover) { S.hover = null; hoverUi(); } });
  document.addEventListener("keydown", function (e) {
    if (!S.on || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "")) return;
    if (e.key === "Escape") setOn(false);
    else if ((e.key === "Backspace" || (e.key === "z" && (e.ctrlKey || e.metaKey))) && S.pts.length) { e.preventDefault(); if (S.closed) S.closed = false; else S.pts.pop(); draw(); ui(); }
  });

  var st = document.createElement("style");
  st.textContent = ".measctl a{display:flex!important;align-items:center;justify-content:center;color:var(--ink);background:var(--surface)}.leaflet-bar.measctl a.on{background:var(--accent)!important;color:var(--on-accent,#fff)!important}" +
    "#map.measuring,#map.measuring .leaflet-interactive{cursor:crosshair}" +
    ".meascard{background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:6px;box-shadow:0 1px 6px rgba(0,0,0,.3);padding:8px 10px;width:300px;max-width:calc(100vw - 80px);max-height:52vh;overflow:auto;font-size:12.5px;line-height:1.4;clear:both}" +
    ".meascard[hidden]{display:none}.meascard .mhd{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}.meascard .mhd b{font-size:14px}" +
    ".meascard .mx{font-size:20px;line-height:1;background:none;border:0;color:var(--ink);cursor:pointer;min-width:32px;min-height:32px}" +
    ".meascard .mrow{display:flex;gap:4px;flex-wrap:wrap;margin:0 0 6px}.meascard .mrow button,.meascard .mbtns button{font:inherit;font-size:12px;font-weight:600;border:1px solid var(--line);background:var(--surface2,var(--surface));color:var(--ink);border-radius:4px;padding:4px 8px;min-height:30px;cursor:pointer}" +
    ".meascard .mrow button[aria-pressed=true]{background:var(--accent);color:var(--on-accent,#fff);border-color:var(--accent)}.meascard .mbtns{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}.meascard .mbtns button[disabled]{opacity:.45;cursor:default}" +
    ".meascard .mbtns .pri{background:var(--accent);color:var(--on-accent,#fff);border-color:var(--accent)}" +
    ".meascard .mmore{font:inherit;font-size:12px;background:none;border:0;color:var(--accent);padding:2px 0 6px;cursor:pointer;text-decoration:underline}" +
    ".meascard .mtot{display:flex;gap:10px;flex-wrap:wrap;margin:2px 0 6px}.meascard .mtot span{display:block;font-size:11px;color:var(--muted)}.meascard .mtot b{font:600 16px/1.2 'IBM Plex Mono',monospace}" +
    ".meascard table{width:100%;border-collapse:collapse;font:11.5px 'IBM Plex Mono',monospace;margin-bottom:6px}.meascard th{text-align:left;font:600 10.5px system-ui,sans-serif;color:var(--muted)}.meascard td,.meascard th{padding:2px 3px;border-top:1px solid var(--line-soft,var(--line))}" +
    ".meascard ol.mpts{list-style:none;margin:0;padding:0}.meascard ol.mpts li{display:flex;align-items:center;gap:4px;padding:2px 0;border-top:1px solid var(--line-soft,var(--line))}" +
    ".meascard .mn{display:inline-block;min-width:18px;height:18px;border-radius:9px;background:#e8590c;color:#fff;font-size:10.5px;font-weight:700;text-align:center;line-height:18px}" +
    ".meascard code{flex:1;font:11.5px 'IBM Plex Mono',monospace;word-break:break-word}.meascard ol.mpts button{font:inherit;font-size:11px;border:1px solid var(--line);background:none;color:var(--ink);border-radius:3px;padding:1px 5px;cursor:pointer;min-height:24px}" +
    ".meascard .mnote,.meascard .mhint,.meascard .mptr{font-size:11px;color:var(--muted);margin:4px 0 0}.meascard .mptr{font-family:'IBM Plex Mono',monospace;color:var(--ink)}" +
    ".measv{background:none;border:0}.measv span{display:block;width:20px;height:20px;border-radius:50%;background:#e8590c;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);color:#fff;font:700 10px/20px system-ui,sans-serif;text-align:center;box-sizing:content-box;margin:-1px;cursor:grab}" +
    ".measv.first span{background:#1f1f1f}.leaflet-tooltip.measlbl{font:600 11px/1.2 'IBM Plex Mono',monospace;padding:1px 5px;background:rgba(255,255,255,.92);color:#111;border:1px solid #e8590c;box-shadow:none}.leaflet-tooltip.measlbl::before{display:none}" +
    "@media (max-width:700px){.meascard{width:auto;max-width:calc(100vw - 132px)}}@media (pointer:coarse){.meascard input,.meascard select{font-size:16px}}";
  document.head.appendChild(st);

  window.OSAP_MEASURE = { on: function (v) { setOn(v !== false); }, state: function () { return { pts: S.pts.slice(), closed: S.closed, unit: S.unit }; },
    set: function (pts, closed) { S.pts = (pts || []).map(function (p) { return [+p[0], +p[1]]; }); S.closed = !!closed && S.pts.length >= 3; draw(); ui(); }, text: text };
})();
