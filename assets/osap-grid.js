/* AXIOM OSAP: MGRS grid lines and a centre crosshair on the map, each switched on or off on its own.
   - Grid lines: grid zone lines (6° zones, 8° latitude bands, with the Norway and Svalbard exceptions) always, then the
     100 km squares and 10 km / 1 km / 100 m lines as you zoom in, so the lines stay about a finger apart. Lines carry their
     grid digits along the top and left of the map, and each 100 km square its letters ("47P PR").
   - Centre crosshair: a fixed reticle on the map centre (the point the Centre readout reports) with that point's grid,
     given to the precision the zoom supports.
   Both are reference drawing computed from window.OSAP_GEO, never records. Both start off; the choice is kept on this device
   (localStorage "osap-grid", "osap-xhair"). The switches are two buttons on the tactical toolbar (Grid,
   Crosshair); with classic controls they are two rows in the Layers panel instead. */
(function () {
  "use strict";
  var W = window, D = document, map = W.__asapMap, L = W.L;
  if (!map || !L || /[?&]watchscan=1/.test(location.search)) return;
  var K_GRID = "osap-grid", K_X = "osap-xhair", root = D.documentElement, mapEl = map.getContainer();
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v) localStorage.setItem(k, "1"); else localStorage.removeItem(k); } catch (e) {} }
  function G() { return W.OSAP_GEO; }
  var st = { grid: lsGet(K_GRID) === "1", cross: lsGet(K_X) === "1" };

  /* ---------- grid zones: 8° bands C..X (X is 12°), 6° zones, with the Norway (32V) and Svalbard (31X..37X) exceptions ---------- */
  var BANDS = "CDEFGHJKLMNPQRSTUVWX";
  function cells() {
    var out = [];
    for (var b = 0; b < 20; b++) {
      var la0 = -80 + b * 8, la1 = b === 19 ? 84 : la0 + 8, bn = BANDS.charAt(b);
      for (var z = 1; z <= 60; z++) {
        var lo0 = -180 + (z - 1) * 6, lo1 = lo0 + 6;
        if (bn === "V" && z === 31) lo1 = 3;
        if (bn === "V" && z === 32) lo0 = 3;
        if (bn === "X") {
          if (z === 32 || z === 34 || z === 36) continue;
          if (z === 31) lo1 = 9; if (z === 33) { lo0 = 9; lo1 = 21; } if (z === 35) { lo0 = 21; lo1 = 33; } if (z === 37) lo0 = 33;
        }
        out.push({ z: z, b: bn, la0: la0, la1: la1, lo0: lo0, lo1: lo1, s: la1 <= 0 });
      }
    }
    return out;
  }
  var CELLS = cells();

  /* clip the segment a-b ([lat, lon]) to the box r (Liang-Barsky); null when it misses */
  function clip(a, b, r) {
    var x0 = a[1], y0 = a[0], dx = b[1] - x0, dy = b[0] - y0, t0 = 0, t1 = 1;
    var p = [-dx, dx, -dy, dy], q = [x0 - r.lo0, r.lo1 - x0, y0 - r.la0, r.la1 - y0];
    for (var i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < 0) return null; continue; }
      var t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
    }
    return [[y0 + t0 * dy, x0 + t0 * dx], [y0 + t1 * dy, x0 + t1 * dx]];
  }
  /* a sampled line, clipped to the box, as runs of points */
  function clipLine(P, r) {
    var runs = [], cur = null;
    for (var i = 1; i < P.length; i++) {
      var s = clip(P[i - 1], P[i], r);
      if (!s) { cur = null; continue; }
      if (cur && Math.abs(cur[cur.length - 1][0] - s[0][0]) < 1e-9 && Math.abs(cur[cur.length - 1][1] - s[0][1]) < 1e-9) cur.push(s[1]);
      else { cur = [s[0], s[1]]; runs.push(cur); }
    }
    return runs;
  }
  /* where a line meets the edge of the screen box: its most northerly (or most westerly) point inside it */
  function edge(run, r, better) {
    var best = null;
    clipLine(run, r).forEach(function (q) { q.forEach(function (p) { if (!best || better(p, best)) best = p; }); });
    return best;
  }
  function shift(run, k) { return k ? run.map(function (p) { return [p[0], p[1] + k]; }) : run; }

  /* ---------- drawing ---------- */
  if (!map.getPane("gridpane")) { map.createPane("gridpane"); map.getPane("gridpane").style.zIndex = 445; map.getPane("gridpane").style.pointerEvents = "none"; }
  var rend = L.svg({ pane: "gridpane", padding: 0.3 }), layer = L.layerGroup(), SQ = 100000;
  var STEPS = [100, 1000, 10000, 100000];
  function mpp() { var c = map.getCenter(); return 40075016.686 * Math.cos(c.lat * Math.PI / 180) / (256 * Math.pow(2, map.getZoom())); }
  /* the finest spacing that stays at least ~48 px apart on screen; 0 = grid zones only */
  function spacing() { var m = mpp(); for (var i = 0; i < STEPS.length; i++) if (STEPS[i] / m >= 48) return STEPS[i]; return 0; }
  function digits(v, s) { var n = Math.round((((v % SQ) + SQ) % SQ) / s), w = 5 - Math.round(Math.log10(s)), t = String(n); while (t.length < w) t = "0" + t; return t; }
  function lbl(ll, txt, cls) {
    return L.marker(ll, { pane: "gridpane", interactive: false, keyboard: false,
      icon: L.divIcon({ className: "osap-gl " + (cls || ""), html: "<span>" + txt + "</span>", iconSize: null }) });
  }
  function draw() {
    layer.clearLayers();
    if (!st.grid) return;
    var g = G(); if (!g || !g.toUtm || !g.fromUtm) return;
    var vb = map.getBounds(), pb = vb.pad(0.25), s = spacing();
    var V = { la0: Math.max(-80, vb.getSouth()), la1: Math.min(84, vb.getNorth()), lo0: vb.getWest(), lo1: vb.getEast() };
    var R = { la0: Math.max(-80, pb.getSouth()), la1: Math.min(84, pb.getNorth()), lo0: pb.getWest(), lo1: pb.getEast() };
    if (R.la0 >= R.la1) return;
    var gzd = [], major = [], minor = [], labels = [], kMin = Math.floor((R.lo0 + 180) / 360), kMax = Math.floor((R.lo1 + 180) / 360);
    var zoneLbl = s === 0 || s === SQ, sqLbl = s && s < SQ || (s === SQ && SQ / mpp() >= 120);
    for (var k = kMin; k <= kMax; k++) {
      var off = k * 360;
      CELLS.forEach(function (c) {
        /* the part of this zone cell that is on (or near) the screen, in real longitudes */
        var r = { la0: Math.max(c.la0, R.la0), la1: Math.min(c.la1, R.la1), lo0: Math.max(c.lo0, R.lo0 - off), lo1: Math.min(c.lo1, R.lo1 - off) };
        if (r.la0 >= r.la1 || r.lo0 >= r.lo1) return;
        /* zone and band edges: the west and south edge of each cell, plus the north edge of the top band */
        [[[c.la0, c.lo0], [c.la1, c.lo0]], [[c.la0, c.lo0], [c.la0, c.lo1]]].concat(c.la1 === 84 ? [[[84, c.lo0], [84, c.lo1]]] : []).forEach(function (e) {
          var sg = clip(e[0], e[1], r); if (sg) gzd.push(shift(sg, off));
        });
        var vr = { la0: Math.max(c.la0, V.la0), la1: Math.min(c.la1, V.la1), lo0: Math.max(c.lo0, V.lo0 - off), lo1: Math.min(c.lo1, V.lo1 - off) };
        var inView = vr.la0 < vr.la1 && vr.lo0 < vr.lo1;
        if (zoneLbl && inView && (vr.la1 - vr.la0) / (V.la1 - V.la0) > 0.08 && (vr.lo1 - vr.lo0) / (V.lo1 - V.lo0) > 0.05)
          labels.push(lbl([(vr.la0 + vr.la1) / 2, (vr.lo0 + vr.lo1) / 2 + off], (c.z < 10 ? "0" : "") + c.z + c.b, "gzd"));
        if (!s) return;
        /* the easting and northing range of that part, from points round its edge */
        var e0 = Infinity, e1 = -Infinity, n0 = Infinity, n1 = -Infinity, N = 8;
        for (var i = 0; i <= N; i++) {
          [[r.la0 + (r.la1 - r.la0) * i / N, r.lo0], [r.la0 + (r.la1 - r.la0) * i / N, r.lo1], [r.la0, r.lo0 + (r.lo1 - r.lo0) * i / N], [r.la1, r.lo0 + (r.lo1 - r.lo0) * i / N]].forEach(function (p) {
            var la = c.s ? Math.min(p[0], -1e-9) : p[0], u = g.toUtm(la, p[1], c.z); if (!u) return;
            if (u.e < e0) e0 = u.e; if (u.e > e1) e1 = u.e; if (u.n < n0) n0 = u.n; if (u.n > n1) n1 = u.n;
          });
        }
        if (!isFinite(e0)) return;
        var nLines = (e1 - e0) / s + (n1 - n0) / s; if (nLines > 400) return;
        var M = 12, ll;
        for (var e = Math.ceil(e0 / s) * s; e <= e1; e += s) {
          var P = []; for (i = 0; i <= M; i++) P.push(g.fromUtm(c.z, c.s, e, n0 + (n1 - n0) * i / M));
          clipLine(P, r).forEach(function (run) {
            (e % SQ === 0 ? major : minor).push(shift(run, off));
            /* the line's digits at the top of the screen */
            if (s < SQ && inView) { var top = edge(run, vr, function (a, b) { return a[0] > b[0]; }); if (top) labels.push(lbl([top[0], top[1] + off], digits(e, s), "e")); }
          });
        }
        for (var n = Math.ceil(n0 / s) * s; n <= n1; n += s) {
          P = []; for (i = 0; i <= M; i++) P.push(g.fromUtm(c.z, c.s, e0 + (e1 - e0) * i / M, n));
          clipLine(P, r).forEach(function (run) {
            (n % SQ === 0 ? major : minor).push(shift(run, off));
            if (s < SQ && inView) { var lf = edge(run, vr, function (a, b) { return a[1] < b[1]; }); if (lf) labels.push(lbl([lf[0], lf[1] + off], digits(n, s), "n")); }
          });
        }
        /* each 100 km square's letters, at the middle of the part of it on screen */
        if (sqLbl && inView) {
          for (var se = Math.floor(e0 / SQ) * SQ; se < e1; se += SQ) for (var sn = Math.floor(n0 / SQ) * SQ; sn < n1; sn += SQ) {
            var ce = (Math.max(se, e0) + Math.min(se + SQ, e1)) / 2, cn = (Math.max(sn, n0) + Math.min(sn + SQ, n1)) / 2;
            ll = g.fromUtm(c.z, c.s, ce, cn);
            if (ll[0] < vr.la0 || ll[0] > vr.la1 || ll[1] < vr.lo0 || ll[1] > vr.lo1) continue;
            var m = g.mgrs(ll[0], ll[1], 1); if (!m) continue;
            labels.push(lbl([ll[0], ll[1] + off], m.split(" ").slice(0, 2).join(" "), "sq"));
          }
        }
      });
    }
    if (minor.length) L.polyline(minor, { renderer: rend, pane: "gridpane", interactive: false, className: "osap-g1", weight: 1, opacity: 1, smoothFactor: 0.5 }).addTo(layer);
    if (major.length) L.polyline(major, { renderer: rend, pane: "gridpane", interactive: false, className: "osap-g2", weight: 1.6, opacity: 1, smoothFactor: 0.5 }).addTo(layer);
    if (gzd.length) L.polyline(gzd, { renderer: rend, pane: "gridpane", interactive: false, className: "osap-g3", weight: 2.4, opacity: 1, smoothFactor: 0.5 }).addTo(layer);
    labels.slice(0, 300).forEach(function (m) { m.addTo(layer); });
  }
  var drawT = 0;
  function soonDraw() { clearTimeout(drawT); drawT = setTimeout(draw, 40); }
  map.on("moveend zoomend viewreset resize", function () { if (st.grid) soonDraw(); });

  /* ---------- the centre crosshair ---------- */
  var cross = D.createElement("div"); cross.id = "osap-xhair"; cross.setAttribute("aria-hidden", "true");
  cross.innerHTML = '<svg viewBox="0 0 44 44" width="44" height="44"><g class="h"><path d="M22 2v14M22 28v14M2 22h14M28 22h14"/><circle cx="22" cy="22" r="1.6"/></g><g class="c"><path d="M22 2v14M22 28v14M2 22h14M28 22h14"/><circle cx="22" cy="22" r="1.6"/></g></svg><span class="xl"></span>';
  /* grid precision the zoom supports: 10 km at country scale down to 1 m close in */
  function xDigits() { var m = mpp() * 20; return m > 5000 ? 1 : m > 500 ? 2 : m > 50 ? 3 : m > 5 ? 4 : 5; }
  function paintCross() {
    if (!st.cross) return;
    var g = G(), c = map.getCenter(), lat = c.lat, lon = L.Util.wrapNum(c.lng, [-180, 180], true);
    cross.querySelector(".xl").textContent = g ? (g.mgrs(lat, lon, xDigits()) || g.fmtLL(lat, lon, 4)) : lat.toFixed(4) + ", " + lon.toFixed(4);
  }
  var rafX = 0; map.on("move zoomend", function () { if (st.cross && !rafX) rafX = requestAnimationFrame(function () { rafX = 0; paintCross(); }); });

  /* ---------- switches ---------- */
  function imagery() { try { var b = (JSON.parse(localStorage.getItem("asap-map-layers")) || {}).base; return /^(sat|hybrid|s2|daily)$/.test(b || ""); } catch (e) { return false; } }
  function paintBase() { root.classList.toggle("osap-gimg", imagery()); }
  function setGrid(v) {
    st.grid = !!v; lsSet(K_GRID, st.grid);
    if (st.grid) { paintBase(); layer.addTo(map); draw(); } else { layer.clearLayers(); map.removeLayer(layer); }
    sync();
  }
  function setCross(v) {
    st.cross = !!v; lsSet(K_X, st.cross);
    root.classList.toggle("osap-xh", st.cross); paintBase(); paintCross(); sync();
  }
  function sync() {
    var a = D.querySelector('#osap-gridrows input[data-grid="lines"]'), b = D.querySelector('#osap-gridrows input[data-grid="cross"]');
    if (a && a.checked !== st.grid) a.checked = st.grid;
    if (b && b.checked !== st.cross) b.checked = st.cross;
    Array.prototype.forEach.call(D.querySelectorAll("#atk-tools [data-ogrid]"), function (t) {
      var v = String(t.getAttribute("data-ogrid") === "lines" ? st.grid : st.cross);
      if (t.getAttribute("aria-pressed") !== v) t.setAttribute("aria-pressed", v);
    });
  }
  /* two buttons on the tactical toolbar, after Base map: each one turns its drawing on or off */
  var TB = [
    ["lines", "Grid", "MGRS grid lines on or off", '<rect x="3" y="3" width="18" height="18" rx="1.5"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>'],
    ["cross", "Crosshair", "Centre crosshair with its grid reference on or off", '<circle cx="12" cy="12" r="6.5"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/><circle cx="12" cy="12" r="1" fill="currentColor"/>']
  ];
  function addToolbarBtns() {
    var list = D.querySelector("#atk-tools .atk-list");
    if (!list || list.querySelector("[data-ogrid]")) return !!list;
    var at = list.querySelector('[data-atk="measure"]');
    TB.forEach(function (t) {
      var b = D.createElement("button");
      b.type = "button"; b.setAttribute("data-ogrid", t[0]); b.title = t[2]; b.setAttribute("aria-label", t[1]); b.setAttribute("aria-pressed", "false");
      b.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + t[3] + '</svg><span class="atk-l">' + t[1] + "</span>";
      b.addEventListener("click", function (e) { e.stopPropagation(); if (t[0] === "lines") setGrid(!st.grid); else setCross(!st.cross); });
      list.insertBefore(b, at);
    });
    sync();
    return true;
  }
  /* with classic controls (no toolbar), the same two switches as rows in the Layers panel */
  function addRows() {
    if (D.getElementById("osap-gridrows")) return true;
    var ex = D.getElementById("ml-extra"); if (!ex) return false;
    var d = D.createElement("div"); d.id = "osap-gridrows";
    d.innerHTML = '<div class="mlh">Grid</div>' +
      '<label class="mlrow"><input type="checkbox" data-grid="lines"' + (st.grid ? " checked" : "") + '><span><b>MGRS grid lines</b><i>Grid zones, 100 km squares and 10 km, 1 km or 100 m lines as you zoom in, with their digits along the edges</i></span></label>' +
      '<label class="mlrow"><input type="checkbox" data-grid="cross"' + (st.cross ? " checked" : "") + '><span><b>Centre crosshair</b><i>Marks the map centre with its grid reference</i></span></label>';
    ex.parentNode.insertBefore(d, ex);
    d.addEventListener("change", function (e) {
      var k = e.target.getAttribute("data-grid");
      if (k === "lines") setGrid(e.target.checked); else if (k === "cross") setCross(e.target.checked);
    });
    return true;
  }
  (function wait(n) { if (!addRows() && n < 40) setTimeout(function () { wait(n + 1); }, 250); })(0);
  (function waitBar(n) { if (!addToolbarBtns() && n < 40) setTimeout(function () { waitBar(n + 1); }, 250); })(0);
  D.addEventListener("change", function (e) { if (e.target && e.target.name === "ml-base") setTimeout(paintBase, 0); }, true);

  /* ---------- styles ---------- */
  var css = D.createElement("style");
  css.textContent =
    /* lines: dark on the drawn maps, light on the dark themes and on imagery; a faint halo keeps them readable on anything */
    ".leaflet-gridpane-pane path{fill:none;stroke-linecap:butt}" +
    ".leaflet-gridpane-pane .osap-g1{stroke:rgba(20,24,28,.5)}.leaflet-gridpane-pane .osap-g2{stroke:rgba(20,24,28,.75)}.leaflet-gridpane-pane .osap-g3{stroke:rgba(11,78,92,.9)}" +
    ":root[data-map=grey] .leaflet-gridpane-pane .osap-g1,:root[data-map=dark] .leaflet-gridpane-pane .osap-g1,html.osap-gimg .leaflet-gridpane-pane .osap-g1{stroke:rgba(255,255,255,.55)}" +
    ":root[data-map=grey] .leaflet-gridpane-pane .osap-g2,:root[data-map=dark] .leaflet-gridpane-pane .osap-g2,html.osap-gimg .leaflet-gridpane-pane .osap-g2{stroke:rgba(255,255,255,.8)}" +
    ":root[data-map=grey] .leaflet-gridpane-pane .osap-g3,:root[data-map=dark] .leaflet-gridpane-pane .osap-g3,html.osap-gimg .leaflet-gridpane-pane .osap-g3{stroke:#ffd43b}" +
    ".osap-gl{background:none;border:0;pointer-events:none}.osap-gl span{position:absolute;transform:translate(-50%,-50%);white-space:nowrap;padding:0 3px;border-radius:3px;" +
    "font:600 10.5px/14px 'IBM Plex Mono',ui-monospace,monospace;color:#14181c;background:rgba(255,255,255,.72)}" +
    ".osap-gl.e span{transform:translate(-50%,5px)}.osap-gl.n span{transform:translate(3px,-50%)}" +
    ".osap-gl.sq span{font-size:12px;opacity:.9}.osap-gl.gzd span{font:700 13px/17px 'IBM Plex Mono',ui-monospace,monospace;color:#0b4e5c}" +
    ":root[data-map=grey] .osap-gl span,:root[data-map=dark] .osap-gl span,html.osap-gimg .osap-gl span{color:#fff;background:rgba(20,24,28,.7)}" +
    ":root[data-map=grey] .osap-gl.gzd span,:root[data-map=dark] .osap-gl.gzd span,html.osap-gimg .osap-gl.gzd span{color:#ffd43b}" +
    /* the crosshair sits on the container's middle, which is the map centre */
    "#osap-xhair{display:none;position:absolute;left:50%;top:50%;width:44px;height:44px;margin:-22px 0 0 -22px;z-index:645;pointer-events:none}html.osap-xh #osap-xhair{display:block}" +
    "#osap-xhair svg{display:block;overflow:visible}#osap-xhair g{fill:none;stroke-linecap:round}#osap-xhair .h{stroke:rgba(255,255,255,.9);stroke-width:4}#osap-xhair .h circle{fill:rgba(255,255,255,.9);stroke-width:2}" +
    "#osap-xhair .c{stroke:#d9480f;stroke-width:2}#osap-xhair .c circle{fill:#d9480f;stroke:none}" +
    "#osap-xhair .xl{position:absolute;left:50%;top:48px;transform:translateX(-50%);white-space:nowrap;padding:2px 6px;border-radius:4px;background:rgba(20,24,28,.82);color:#ffd8a8;font:600 11.5px/1.3 'IBM Plex Mono',ui-monospace,monospace}" +
    /* the tactical toolbar's brief move marker would sit on top of this one */
    "html.osap-xh #atk-cross{display:none!important}" +
    /* the toolbar carries the switches; the Layers rows are for classic controls only */
    "html.atak #osap-gridrows{display:none}";
  D.head.appendChild(css);

  mapEl.appendChild(cross);
  if (st.grid) setGrid(true);
  if (st.cross) setCross(true);
  W.OSAP_GRID = { grid: setGrid, cross: setCross, state: function () { return { grid: st.grid, cross: st.cross, spacing: st.grid ? spacing() : null }; }, redraw: draw };
})();
