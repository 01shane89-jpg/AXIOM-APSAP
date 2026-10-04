/* AXIOM OSAP Terrain analysis (Shane 2026-10-03): what the ground lets an observer see. Three tools in one panel:
   - Viewshed: the ground an observer can see, with a line-of-sight card and terrain profile for any point inside it and the
     skyline (the highest ground angle in every direction).
   - Reverse viewshed: the ground from which a point can be seen. Line of sight is the same straight line both ways, so it is
     the viewshed from the point with the two heights swapped (the point gets the target height, every other cell the
     observer height).
   - Line of sight: A to B with the terrain profile, or the elevation profile along a path measured with Measure (its
     "Profile" button). Modules can add a section under the profile through window.OSAP_PROFILE_EXT
     ([{ id, label, render(container, profile) }], profile as returned by OSAP_TERRAIN_ANALYSIS.profile).
   - Where it lives (layout owner, 2026-10-03): long-press ring > Terrain (Viewshed from here, Reverse viewshed to here, Line of
     sight from here, Elevation here, plus tools other
     modules add through window.OSAP_TERRAIN_TOOLS), and Map overlays > Elevation and terrain analysis > Terrain analysis.
     No toolbar button. The panel uses the shared split view (W.OSAP_SPLIT.add(el, ".chead")).
   - Model: observer altitude = ground at the observer + observer height; target altitude = ground at the target + target
     height. Optional Earth curvature and atmospheric refraction. The ground comes from the terrain provider
     (assets/terrain/terrain-provider.js and the sources in assets/terrain/providers/), the sums from the terrain engine
     (assets/terrain/viewshed-engine.js) in a background worker, so the map never freezes. A quick rough pass draws first,
     then the chosen resolution.
   - Honest labels: it is a TERRAIN viewshed from an elevation model. Buildings, trees and walls are not modelled, and the
     result says so; SRTM (the AWS tiles over most of the world) is a radar surface that partly carries forest canopy and big
     city blocks, which the result also says (tools/terrain_live.mjs: from 1.7 m in central Bangkok almost nothing is visible). Ground with no elevation data is UNKNOWN (grey), never "not visible".
   - Saved viewsheds (store "osap-viewsheds", in the active workspace, its KML export and Move to another device): named, each
     with an on/off toggle here and in Map overlays, rename, recalculate and delete.
   - Nothing is sent anywhere: the elevation tiles are downloaded and everything is worked out on this device. The result is
     the analyst's own working aid, not a report, a finding or evidence.
   window.OSAP_TERRAIN_ANALYSIS = { version, open, close, isOpen, menu, viewshedAt, reverseAt, losFrom, line, elevationAt, profile,
     viewshed, losTo, state }
   (the API other modules use, agreed with the Communications planning thread: per-call heights, any refraction k).
   Not to be confused with window.OSAP_TERRAIN and localStorage "osap-terrain": the per-country terrain and flashpoint data
   layer in index.html (data/terrain/<cc>.js). */
(function () {
  "use strict";
  var W = window, D = document, map = W.__asapMap, L = W.L;
  if (!map || !L || /[?&]watchscan=1(&|$)/.test(location.search)) return;
  var VERSION = "osap-terrain-analysis/1", KEY = "osap-terrain-analysis", BASE = "assets/terrain/";
  var PRESETS = [["stand", "Standing person", 1.7], ["veh", "Vehicle", 2.5], ["bld", "Building / tower", null], ["ant", "Antenna", null]];
  var RANGES = [1, 2, 5, 10, 15, 25, 50, 75, 100];
  var RES = { fast: [90, "Fast", "about 90 m"], std: [30, "Standard", "about 30 m"], high: [10, "High detail", "finest the elevation data holds"] };
  var MAXN = 1601, K_REFR = 0.13, R_EARTH = 6371008.8;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function G() { return W.OSAP_GEO; }
  function gridRef(lat, lon) { var g = G(), m = g && g.mgrs && g.mgrs(lat, lon, 5); return m || lat.toFixed(5) + ", " + lon.toFixed(5); }
  function T() { return W.OSAP_TIME || { dualT: function (ms) { return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z"; } }; }
  function km(m) { return m >= 10000 ? (m / 1000).toFixed(1) + " km" : m >= 1000 ? (m / 1000).toFixed(2) + " km" : Math.round(m) + " m"; }
  function mm(v) { return v == null || !(v === v) ? "no data" : Math.round(v) + " m MSL"; }
  function num(v, d) { v = parseFloat(v); return v === v && isFinite(v) ? v : d; }
  function hav(a, b) { var r = Math.PI / 180, dl = (b[0] - a[0]) * r, dn = (b[1] - a[1]) * r, s = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) * Math.sin(dn / 2); return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(s))); }
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  var S0 = load();
  var S = {
    obsH: Math.min(1000, Math.max(0, num(S0.obsH, 1.7))), tgtH: Math.min(1000, Math.max(0, num(S0.tgtH, 1.7))),
    obsP: S0.obsP || "stand", tgtP: S0.tgtP || "stand", km: RANGES.indexOf(S0.km) >= 0 ? S0.km : 10, res: RES[S0.res] ? S0.res : "std",
    curv: !!S0.curv, refr: !!S0.refr, hz: S0.hz !== false, prof: !!S0.prof, mode: /^(vs|rev|los)$/.test(S0.mode) ? S0.mode : "vs"
  };
  var MODES = [["vs", "Viewshed"], ["rev", "Reverse viewshed"], ["los", "Line of sight"]];
  function keep() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

  /* ---------- loading the provider, the sources and the engine (first use only) ---------- */
  var loading = {};
  function script(src) {
    if (loading[src]) return loading[src];
    return (loading[src] = new Promise(function (res, rej) {
      var s = D.createElement("script"); s.src = src; s.async = false;
      s.onload = function () { res(); }; s.onerror = function () { delete loading[src]; s.remove(); rej(new Error("The terrain tools could not load. Check the connection.")); };
      D.head.appendChild(s);
    }));
  }
  /* already on the page (the single-file review copy carries them inline) or fetched now */
  function need() {
    if (W.OSAP_TERRAIN_SRC && (W.OSAP_TERRAIN_PROVIDERS || []).length) return Promise.resolve(W.OSAP_TERRAIN_SRC);
    return Promise.all([script(BASE + "terrain-provider.js"), script(BASE + "providers/remote-dem.js")]).then(function () { return W.OSAP_TERRAIN_SRC; }); }

  /* ---------- the engine: in a worker, on the page if workers fail ----------
     Two engines: the panel's, which a new calculation may stop (its worker is replaced, so a big sum never holds up the
     next), and one for other modules' calls (viewshed() in the API), which the panel never stops. */
  var GID = 0, gridNow = null;
  function onPage() { return W.OSAP_VS ? Promise.resolve(W.OSAP_VS) : script(BASE + "viewshed-engine.js").then(function () { return W.OSAP_VS; }); }
  function Engine() {
    var wk = null, wkDead = false, RID = 0, PEND = {}, wkGid = 0;
    function worker() {
      if (wk || wkDead) return wk;
      try {
        wk = new Worker(BASE + "viewshed-worker.js");
        wk.onmessage = function (e) { var m = e.data, p = PEND[m.rid]; if (!p) return; if (m.error || m.los || m.pass === "fine") delete PEND[m.rid]; p(m); };
        wk.onerror = function () { wkDead = true; wk = null; wkGid = 0; var P = PEND; PEND = {}; Object.keys(P).forEach(function (k) { P[k]({ error: "worker" }); }); };
      } catch (e) { wkDead = true; wk = null; }
      return wk;
    }
    /* a grid the engine works on: { gid, E, n, rowM } (kept on the page too, so a dead or reset worker can be given it again) */
    function grid(g) {
      if (worker() && wkGid !== g.gid) { wk.postMessage({ cmd: "grid", gid: g.gid, E: g.E, n: g.n, rowM: g.rowM }); wkGid = g.gid; }
    }
    /* viewshed on grid g; onPass(pass) is called with the rough pass first (when asked), then the full one */
    function run(g, o, coarse, onPass) {
      return new Promise(function (res, rej) {
        function page() {
          onPage().then(function (VS) {
            setTimeout(function () {
              try { var r = VS.viewshed(g, o); var m = { pass: "fine", f: 1, n: g.n, res: r }; onPass(m); res(m); } catch (e) { rej(e); }
            }, 0);
          }, rej);
        }
        if (!worker()) return page();
        grid(g);
        var rid = ++RID, retried = false;
        PEND[rid] = function cb(m) {
          if (m.error === "worker") return page();
          if (m.error === "cancelled") return rej(new DOMException("Stopped", "AbortError"));
          if (m.error === "stale" && !retried) { retried = true; wkGid = 0; grid(g); PEND[rid] = cb; wk.postMessage({ cmd: "run", gid: g.gid, rid: rid, o: o, coarse: coarse }); return; }
          if (m.error) return rej(new Error(m.error));
          onPass(m); if (m.pass === "fine") res(m);
        };
        wk.postMessage({ cmd: "run", gid: g.gid, rid: rid, o: o, coarse: coarse });
      });
    }
    function los(g, a, b, o) {
      return new Promise(function (res, rej) {
        function page() { onPage().then(function (VS) { try { res(VS.los(g, a, b, o)); } catch (e) { rej(e); } }, rej); }
        if (!worker()) return page();
        grid(g);
        var rid = ++RID;
        PEND[rid] = function (m) { if (m.error === "worker" || m.error === "stale") return page(); if (m.error === "cancelled") return rej(new DOMException("Stopped", "AbortError")); if (m.error) return rej(new Error(m.error)); res(m.los); };
        wk.postMessage({ cmd: "los", gid: g.gid, rid: rid, a: a, b: b, o: o });
      });
    }
    /* abandon what is running: the busy worker is replaced, and every waiting call is told (never left hanging) */
    function cancel() {
      var P = PEND, k = Object.keys(P); if (!k.length) return;
      PEND = {}; if (wk) { wk.terminate(); wk = null; wkGid = 0; }
      k.forEach(function (id) { P[id]({ error: "cancelled" }); });
    }
    return { run: run, los: los, cancel: cancel };
  }
  var PANEL = Engine(), APIE = Engine();
  function engineRun(g, o, coarse, onPass) { return PANEL.run(g, o, coarse, onPass); }
  function engineLos(g, a, b, o) { return PANEL.los(g, a, b, o); }
  function engineCancel() { PANEL.cancel(); }

  /* ---------- the elevation grid for a request ---------- */
  function effRes(radius, res) { return Math.max(res, Math.ceil(2 * radius / (MAXN - 1))); }
  /* { spec, E, rowM, coverage_pct, sources, z } for an observer, range and resolution; reused while they are the same */
  function getGrid(lat, lon, radius, res, opt) {
    return need().then(function (SRC) {
      var key = [lat.toFixed(6), lon.toFixed(6), radius, res].join("|");
      if (gridNow && gridNow.key === key && !gridNow.failedTiles) return gridNow;
      var spec = SRC.around(lat, lon, radius, res);
      return SRC.grid(spec, opt).then(function (r) {
        var g = { key: key, gid: ++GID, spec: spec, E: r.E, n: spec.n, rowM: r.rowM, coverage_pct: r.coverage_pct, failedTiles: r.failedTiles, tiles: r.tiles, sources: r.sources, z: r.z, res: res, radius: radius, lat: lat, lon: lon };
        gridNow = g; return g;
      });
    });
  }
  function opts(o) {
    var curv = !!(o.curvature || o.refraction || o.refraction_k);
    return { obsH: num(o.observer_height_m, 1.7), tgtH: num(o.target_height_m, 1.7), radius_m: o.radius_m, curvature: curv, k: curv ? (o.refraction_k != null ? +o.refraction_k : o.refraction ? K_REFR : 0) : 0, rays: !!o.returnRays };
  }

  /* ---------- map layers ---------- */
  if (!map.getPane("vspane")) { map.createPane("vspane"); map.getPane("vspane").style.zIndex = 420; map.getPane("vspane").style.pointerEvents = "none"; }
  if (!map.getPane("vslines")) { map.createPane("vslines"); map.getPane("vslines").style.zIndex = 640; }
  var lay = L.layerGroup().addTo(map), losLay = L.layerGroup().addTo(map), img = null, imgUrl = null;
  var C_VIS = [46, 160, 67, 120], C_MASK = [198, 40, 40, 105], C_UNK = [120, 120, 120];
  function paint(r, n, f, g) {
    var cv = D.createElement("canvas"); cv.width = cv.height = n;
    var cx = cv.getContext("2d"), im = cx.createImageData(n, n), d = im.data, cls = r.cls;
    for (var j = 0; j < n; j++) for (var i = 0; i < n; i++) {
      var p = j * n + i, k = p * 4, c = cls[p];
      if (c === 1) { d[k] = C_VIS[0]; d[k + 1] = C_VIS[1]; d[k + 2] = C_VIS[2]; d[k + 3] = C_VIS[3]; }
      else if (c === 2) { d[k] = C_MASK[0]; d[k + 1] = C_MASK[1]; d[k + 2] = C_MASK[2]; d[k + 3] = C_MASK[3]; }
      else if (c === 3) { var hatch = ((i + j) % 6) < 2; d[k] = d[k + 1] = d[k + 2] = hatch ? 70 : C_UNK[0]; d[k + 3] = hatch ? 170 : 70; }
    }
    cx.putImageData(im, 0, 0);
    var s = g.spec, half = (s.n - 1) / 2, cX = s.x0 + (half + 0.5) * s.cellPx, cY = s.y0 + (half + 0.5) * s.cellPx, he = n * f * s.cellPx / 2, SRC = W.OSAP_TERRAIN_SRC;
    var b = L.latLngBounds([SRC.latOf(cY + he, s.z), SRC.lonOf(cX - he, s.z)], [SRC.latOf(cY - he, s.z), SRC.lonOf(cX + he, s.z)]);
    cv.toBlob(function (bl) {
      /* cleared or replaced while the picture was being made: drop it */
      if (!bl || !ST.res || ST.res.res !== r) return;
      var u = URL.createObjectURL(bl);
      if (img) img.setUrl(u).setBounds(b); else { img = L.imageOverlay(u, b, { pane: "vspane", interactive: false, className: "vsimg" }); lay.addLayer(img); }
      if (imgUrl) URL.revokeObjectURL(imgUrl); imgUrl = u;
    });
  }
  /* the horizon line: the far edge of visible ground along every ray */
  function horizonLL(r, n, f, g) {
    var s = g.spec, half = (s.n - 1) / 2, hc = (n - 1) / 2, SRC = W.OSAP_TERRAIN_SRC, step = Math.max(1, Math.floor(r.horizon.length / 720));
    var out = [];
    for (var i = 0; i < r.horizon.length; i += step) { var h = r.horizon[i]; out.push(SRC.toLL(s, half + (h.x - hc) * f, half + (h.y - hc) * f)); }
    return out;
  }
  var hzLine = null, obsMark = null, ring = null;
  function drawMarks(r, n, f, g) {
    if (hzLine) { lay.removeLayer(hzLine); hzLine = null; }
    if (S.hz && r) {
      var ll = horizonLL(r, n, f, g); ll.push(ll[0]);
      hzLine = L.layerGroup([L.polyline(ll, { pane: "vslines", color: "#111", weight: 4, opacity: 0.55, interactive: false }), L.polyline(ll, { pane: "vslines", color: "#ffd600", weight: 2, dashArray: "6 4", interactive: false })]);
      lay.addLayer(hzLine);
    }
  }
  function drawObserver() {
    if (!ST.obs) { if (obsMark) { lay.removeLayer(obsMark); obsMark = null; } if (ring) { lay.removeLayer(ring); ring = null; } return; }
    var ll = [ST.obs[0], ST.obs[1]];
    if (!obsMark) { obsMark = L.circleMarker(ll, { pane: "vslines", radius: 7, color: "#fff", weight: 2.5, fillColor: "#0b7285", fillOpacity: 1, interactive: false }).bindTooltip("Observer", { permanent: false, direction: "top" }); lay.addLayer(obsMark); }
    obsMark.setLatLng(ll);
    if (!ring) { ring = L.circle(ll, { pane: "vslines", radius: S.km * 1000, fill: false, color: "#37474f", weight: 1.2, dashArray: "2 6", interactive: false }); lay.addLayer(ring); }
    ring.setLatLng(ll).setRadius(S.km * 1000);
  }
  function clearMap() {
    lay.clearLayers(); losLay.clearLayers(); if (typeof lnMarks !== "undefined") lnMarks.clearLayers(); img = null; hzLine = null; obsMark = null; ring = null;
    if (imgUrl) { URL.revokeObjectURL(imgUrl); imgUrl = null; }
    map.closePopup();
  }

  /* ---------- the panel ---------- */
  var ST = { obs: null, busy: "", err: "", res: null, grid: null, pass: "", arm: "", at: 0, los: null, losTo: null, warn: "", line: { pts: [], x: null, len: 0 } };
  var RUN = 0, ac = null, el = null;
  var CSS = "#terrain{position:fixed;inset:0;z-index:100000;overflow:auto;background:rgba(0,0,0,.45);padding:16px}" +
    "#terrain .cbox{max-width:560px;margin:0 auto;background:var(--surface,#fff);color:var(--ink,#111);border-radius:8px;padding:10px 16px 16px;font-size:13px;line-height:1.45;box-shadow:0 6px 24px rgba(0,0,0,.3)}" +
    "#terrain .chead{display:flex;align-items:center;gap:8px;position:sticky;top:-16px;background:var(--surface,#fff);padding:6px 0;z-index:1}#terrain .chead h2{margin:0;font-size:16px;flex:1}" +
    "#terrain .chead .x{font-size:13px;min-height:32px;border:1px solid var(--line,#bbb);background:var(--surface,#fff);color:inherit;border-radius:5px;padding:3px 10px;cursor:pointer}" +
    "#terrain .tsg{display:grid;grid-template-columns:auto 1fr;gap:6px 10px;align-items:center;margin:6px 0}#terrain .tsg>span{color:var(--muted,#555)}" +
    "#terrain .tsr{display:flex;flex-wrap:wrap;gap:5px 8px;align-items:center}" +
    "#terrain button{font:inherit;font-size:12.5px;border:1px solid var(--line,#bbb);background:var(--surface,#fff);color:inherit;border-radius:5px;padding:3px 9px;min-height:30px;cursor:pointer}" +
    "#terrain button.pri{background:#0b7285;border-color:#0b7285;color:#fff;font-weight:700;letter-spacing:.04em}#terrain button[aria-pressed=true]{background:#e3f2f4;border-color:#0b7285}" +
    "#terrain select,#terrain input[type=number]{font:inherit;font-size:12.5px;max-width:100%}#terrain input[type=number]{width:5.2em}" +
    "#terrain .pt{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px}#terrain .seg{display:inline-flex}#terrain .seg button{border-radius:0;margin-left:-1px}#terrain .seg button:first-child{border-radius:5px 0 0 5px}#terrain .seg button:last-child{border-radius:0 5px 5px 0}" +
    "#terrain .chk{display:grid;grid-template-columns:1fr 1fr;gap:2px 10px;margin:6px 0}#terrain .chk label{display:flex;gap:5px;align-items:center}" +
    "#terrain .msg{margin:6px 0;color:var(--muted,#555)}#terrain .msg.err{color:#b71c1c}#terrain .warn{border:1px solid #e65100;border-left-width:4px;padding:5px 8px;margin:8px 0;border-radius:4px}" +
    "#terrain .bar{height:4px;background:var(--line,#ddd);border-radius:2px;overflow:hidden;margin:4px 0}#terrain .bar i{display:block;height:100%;background:#0b7285;transition:width .2s}" +
    "#terrain .key{display:flex;flex-wrap:wrap;gap:4px 12px;margin:6px 0;font-size:12px}#terrain .key span{display:inline-block;width:14px;height:10px;margin-right:4px;vertical-align:-1px;border:1px solid rgba(0,0,0,.25)}" +
    "#terrain .asm{font-size:12px;border-top:1px solid var(--line,#ddd);margin-top:8px;padding-top:6px}#terrain .asm p{margin:2px 0}#terrain .asm b{font-weight:600}" +
    "#terrain .nm{font-weight:700;letter-spacing:.03em}#terrain .tag{font-size:10.5px;border:1px solid var(--line,#bbb);border-radius:3px;padding:0 4px;color:var(--muted,#555);font-weight:400}" +
    "#terrain .losc{border:1px solid var(--line,#ddd);border-radius:6px;padding:6px 9px;margin:8px 0}#terrain svg.prof{width:100%;height:auto;display:block;margin-top:6px}" +
    ".vslos p{margin:2px 0}.vslos .v{font-weight:700}.vslos .v.BLOCKED{color:#b71c1c}.vslos .v.CLEAR{color:#2e7d32}.vslos .v.UNKNOWN{color:#616161}.vslos .h{font-weight:700;letter-spacing:.04em;margin-bottom:3px}" +
    ".vslos button{font:inherit;font-size:12px;margin-top:5px;border:1px solid #bbb;border-radius:5px;background:#fff;padding:3px 8px;cursor:pointer}.vsimg{image-rendering:pixelated}" +
    "#terrain .tsm{display:flex;margin:2px 0 8px}#terrain .tsm button{flex:1;font-weight:600}#terrain .tsx{border-top:1px solid var(--line,#ddd);margin-top:8px;padding-top:6px}" +
    ".vsab{background:none;border:0}.vsab span{display:block;min-width:20px;height:20px;padding:0 3px;border-radius:10px;background:#0b7285;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);color:#fff;font:700 11px/20px system-ui,sans-serif;text-align:center;margin:0}" +
    "#terrain .tsave{margin:8px 0}#terrain .tsave input{font:inherit;font-size:13px;flex:1;min-width:8em;padding:4px 6px}#terrain .vssaved{border-top:1px solid var(--line,#ddd);margin-top:10px;padding-top:6px}" +
    "#terrain .vsrow{border:1px solid var(--line,#ddd);border-radius:6px;padding:5px 8px;margin:5px 0}#terrain .vsrow label{display:flex;gap:6px;align-items:center}#terrain .vsrow .sub{font-size:11.5px;color:var(--muted,#555);margin:2px 0 4px}#terrain .vsrow input[type=text]{font:inherit;flex:1}" +
    ".vsname{background:none;border:0}.vsname span{display:inline-block;transform:translate(8px,-50%);white-space:nowrap;font:600 11px/1.2 system-ui,sans-serif;background:rgba(255,255,255,.9);color:#1b5e20;border:1px solid #1b5e20;border-radius:3px;padding:1px 4px}" +
    ".vsmenu button{display:block;width:100%;text-align:left;font:inherit;font-size:13px;margin:3px 0;border:1px solid #bbb;border-radius:5px;background:#fff;padding:6px 9px;cursor:pointer}.vsmenu .h{font-weight:700;margin-bottom:4px}.vsmenu .el{margin-top:6px}" +
    /* phone: labels above their fields, so the fields get the full width */
    "@media (max-width:700px){#terrain{padding:6px}#terrain .chk{grid-template-columns:1fr}#terrain .tsg{grid-template-columns:1fr;gap:2px 0}#terrain .tsg>span{margin-top:6px;font-size:12px}#terrain .tsh{flex-wrap:nowrap}#terrain .tsh select{flex:1;min-width:0}}";
  function ensure() {
    if (el) return el;
    if (!D.getElementById("terrain-css")) { var st = D.createElement("style"); st.id = "terrain-css"; st.textContent = CSS; D.head.appendChild(st); }
    el = D.createElement("div"); el.id = "terrain"; el.hidden = true; el.setAttribute("role", "dialog"); el.setAttribute("aria-labelledby", "terrain-h");
    el.innerHTML = '<div class="cbox"></div>';
    D.body.appendChild(el);
    el.addEventListener("click", onClick); el.addEventListener("change", onChange); el.addEventListener("input", onInput);
    /* a tap on the dark backdrop (full window) closes it, as the other windows do */
    el.addEventListener("click", function (e) { if (e.target === el) close(); });
    if (W.OSAP_SPLIT) W.OSAP_SPLIT.add(el, ".chead");
    D.addEventListener("osap:split", function () { if (!el.hidden) render(); });
    return el;
  }
  function split() { return !!(W.OSAP_SPLIT && W.OSAP_SPLIT.on()); }
  function presetSel(id, cur) {
    return '<select id="' + id + '" aria-label="Height preset">' + PRESETS.map(function (p) { return '<option value="' + p[0] + '"' + (p[0] === cur ? " selected" : "") + ">" + esc(p[1]) + (p[2] != null ? " " + p[2] + " m" : ", custom") + "</option>"; }).join("") + "</select>";
  }
  function rev() { return S.mode === "rev"; }
  function lineN() { return ST.line.pts.length; }
  function title() { return S.mode === "rev" ? "Reverse viewshed" : S.mode === "los" ? (lineN() > 2 ? "Elevation profile" : "Line of sight") : "Terrain viewshed"; }
  function ptRow(label, p, pick, centre) {
    return "<span>" + label + '</span><div class="tsr">' + (p ? '<span class="pt">' + esc(p[0].toFixed(5) + ", " + p[1].toFixed(5)) + "</span>" : "<i>not set</i>") +
      '<button type="button" data-ts="' + pick + '" aria-pressed="' + (ST.arm === pick) + '">Pick on map</button>' + (centre ? '<button type="button" data-ts="' + centre + '">Map centre</button>' : "") + "</div>" +
      (p ? '<span></span><div class="pt" style="color:var(--muted,#555)">' + esc(gridRef(p[0], p[1])) + "</div>" : "");
  }
  function hRow(label, id, v, pre, tip) {
    return '<span title="' + esc(tip) + '">' + label + '</span><div class="tsr tsh"><input type="number" id="' + id + '" min="0" max="1000" step="0.1" value="' + v + '" aria-label="' + esc(label) + ' in metres above the ground"> m ' + presetSel(id === "ts-oh" ? "ts-op" : "ts-tp", pre) + "</div>";
  }
  function resRow() {
    return '<span>Resolution</span><div class="seg" role="group" aria-label="Resolution">' + Object.keys(RES).map(function (k) { return '<button type="button" data-res="' + k + '" aria-pressed="' + (S.res === k) + '" title="' + esc(RES[k][2]) + '">' + esc(RES[k][1]) + "</button>"; }).join("") + "</div>" +
      '<span>Terrain source</span><div>OSAP DEM <span class="tag" title="Elevation tiles: Terrain Tiles on AWS (mostly SRTM, about 30 m) everywhere, GSI Japan 5 to 10 m in Japan">elevation model, not buildings</span></div>';
  }
  function curvBoxes() {
    return '<label><input type="checkbox" id="ts-curv"' + (S.curv ? " checked" : "") + "> Account for Earth curvature</label>" +
      '<label><input type="checkbox" id="ts-refr"' + (S.refr ? " checked" : "") + "> Atmospheric refraction</label>";
  }
  function render() {
    var c = ensure().firstElementChild, o = ST.obs, r = ST.res && ST.res.res, g = ST.grid, R0 = rev();
    var h = '<div class="chead"><h2 id="terrain-h">' + title() + ' <span class="tag" tabindex="0" title="Worked out on this device from open elevation data by fixed rules. Not AI, not a survey and not analyst-approved.">Terrain only</span></h2>' +
      (W.OSAP_SPLIT ? W.OSAP_SPLIT.btn() : "") + '<button type="button" class="x" data-ts="close" aria-label="Close terrain analysis">Close</button></div>';
    h += '<div class="seg tsm" role="group" aria-label="Terrain tool">' + MODES.map(function (m) { return '<button type="button" data-mode="' + m[0] + '" aria-pressed="' + (S.mode === m[0]) + '">' + m[1] + "</button>"; }).join("") + "</div>";
    if (S.mode === "los") { c.innerHTML = h + renderLine(); el.hidden = false; extras(c); return; }
    var hO = hRow("Observer height", "ts-oh", S.obsH, S.obsP, R0 ? "Eye or antenna height of anyone who might be looking, above the ground everywhere" : "Eye or antenna height above the ground at the observer");
    var hT = hRow(R0 ? "Point height" : "Target height", "ts-th", S.tgtH, S.tgtP, R0 ? "Height above the ground of the person or thing to be seen" : "Height above the ground of what is to be seen, everywhere");
    h += '<div class="tsg">' + ptRow(R0 ? "Point" : "Observer", o, "pick", "centre") + (R0 ? hT + hO : hO + hT) +
      '<span>Maximum range</span><div class="tsr"><select id="ts-km" aria-label="Maximum range">' + RANGES.map(function (k) { return '<option value="' + k + '"' + (k === S.km ? " selected" : "") + ">" + k + " km</option>"; }).join("") + "</select></div>" +
      resRow() + "</div>" +
      '<div class="chk">' + curvBoxes() +
      '<label><input type="checkbox" id="ts-hz"' + (S.hz ? " checked" : "") + "> Show horizon</label>" +
      '<label><input type="checkbox" id="ts-prof"' + (S.prof ? " checked" : "") + "> Show terrain profile</label></div>";
    var eff = effRes(S.km * 1000, RES[S.res][0]);
    if (eff > RES[S.res][0]) h += '<p class="msg">For a ' + S.km + " km range the grid is " + eff + " m, so the sum stays quick on a phone.</p>";
    if (!S.curv && S.km >= 15) h += '<p class="msg">Over ' + S.km + " km the Earth's curve hides low ground: consider ticking Earth curvature.</p>";
    h += '<div class="tsr">' + (ST.busy ? '<button type="button" data-ts="cancel">Cancel</button>' : '<button type="button" class="pri" data-ts="calc"' + (o ? "" : " disabled") + ">CALCULATE</button>") +
      (r || o ? '<button type="button" data-ts="clear">Clear</button>' : "") + "</div>";
    if (ST.busy) h += '<p class="msg" aria-live="polite">' + esc(ST.busy) + '</p><div class="bar"><i style="width:' + Math.round(ST.at * 100) + '%"></i></div>';
    if (ST.err) h += '<p class="msg err" aria-live="polite">' + esc(ST.err) + "</p>";
    if (r && g) {
      h += '<div class="key"><b>Terrain visibility</b><label><span style="background:rgba(' + C_VIS.slice(0, 3) + ',.7)"></span>' + (R0 ? "Can see the point" : "Visible terrain") + '</label><label><span style="background:rgba(' + C_MASK.slice(0, 3) + ',.7)"></span>' + (R0 ? "Cannot see it: terrain in the way" : "Terrain-masked") + "</label>" +
        '<label><span style="background:repeating-linear-gradient(45deg,#464646 0 2px,#bbb 2px 6px)"></span>Unknown: no elevation data</label>' + (S.hz ? '<label><span style="background:#ffd600;border-color:#111"></span>Horizon</label>' : "") + "</div>";
      if (g.coverage_pct < 99.5) h += '<div class="warn"><b>VIEWSHED DATA WARNING</b><br>Terrain coverage: ' + Math.floor(g.coverage_pct) + "%. Areas without elevation data are shown as UNKNOWN, not as hidden." + (g.failedTiles ? " " + g.failedTiles + " of " + g.tiles + " elevation tiles did not load: press Calculate to try again." : "") + "</div>";
      h += '<p style="margin:4px 0">' + (R0 ? "Tap any point inside the result for the line of sight from there to the point." : "Tap any point inside the result for the line of sight to it.") + "</p>";
      if (ST.los) h += losCard(ST.los, true);
      if (S.hz) h += skylineSvg(r);
      if (ST.pass === "fine" && !ST.busy) h += saveRow();
      h += assumptions(r, g);
    } else if (!ST.busy && !ST.err) h += '<p class="msg">' + (R0 ? "Pick the point on the map, set its height and the height of whoever might be looking, then Calculate. The result shows the ground from which the terrain lets the point be seen." :
      "Pick the observer on the map, set the heights and range, then Calculate. The result shows which ground the terrain lets the observer see.") + "</p>";
    h += savedPanel();
    c.innerHTML = h;
    el.hidden = false;
  }
  /* Line of sight mode: A to B, or the elevation profile along a measured path */
  function renderLine() {
    var P = ST.line.pts, n = P.length, x = ST.line.x, h = '<div class="tsg">';
    if (n > 2) h += '<span>Path</span><div>' + n + " points from Measure · " + km(ST.line.len) + ' <button type="button" data-ts="lnclear">Start again with A and B</button></div>';
    else h += ptRow("Point A", P[0], "pickA", "centreA") + ptRow("Point B", P[1], "pickB", "") +
      hRow("Height at A", "ts-oh", S.obsH, S.obsP, "Eye or antenna height above the ground at A") + hRow("Height at B", "ts-th", S.tgtH, S.tgtP, "Height above the ground of what is at B");
    h += resRow() + "</div>";
    if (n <= 2) h += '<div class="chk">' + curvBoxes() + "</div>";
    if (n === 2 && !S.curv && ST.line.len >= 15000) h += '<p class="msg">Over ' + km(ST.line.len) + " the Earth's curve matters: consider ticking Earth curvature.</p>";
    h += '<div class="tsr">' + (ST.busy ? '<button type="button" data-ts="cancel">Cancel</button>' : '<button type="button" class="pri" data-ts="calc"' + (n >= 2 ? "" : " disabled") + ">CALCULATE</button>") +
      (n ? '<button type="button" data-ts="clear">Clear</button>' : "") + "</div>";
    if (ST.busy) h += '<p class="msg" aria-live="polite">' + esc(ST.busy) + '</p><div class="bar"><i style="width:' + Math.round(ST.at * 100) + '%"></i></div>';
    if (ST.err) h += '<p class="msg err" aria-live="polite">' + esc(ST.err) + "</p>";
    if (x) {
      var m = x.meta;
      if (m.coverage_pct < 99.5) h += '<div class="warn"><b>PROFILE DATA WARNING</b><br>Terrain coverage along the line: ' + Math.floor(m.coverage_pct) + "%. Gaps are shown as gaps, not as low ground." + (m.failedTiles ? " " + m.failedTiles + " of " + m.tiles + " elevation tiles did not load: press Calculate to try again." : "") + "</div>";
      h += x.path ? pathCard(x) : losCard(x, true);
      h += '<div class="tsext"></div>';
      var curv = x.path ? "not used for a path" : ST.line.o.curvature ? "on" + (ST.line.o.k ? ", with atmospheric refraction (k = " + ST.line.o.k + ")" : ", no refraction") : "off";
      h += '<div class="asm"><p class="nm">' + (x.path ? "TERRAIN ELEVATION PROFILE" : "TERRAIN LINE OF SIGHT") + "</p>" +
        "<p><b>Urban/vegetation obstruction:</b> NOT MODELED. The elevation is a terrain model: walls, single trees and most buildings are not in it, while SRTM (most of the world outside Japan and the US) partly carries dense forest canopy and big city blocks.</p>" +
        "<p><b>Elevation:</b> " + esc((m.sources || []).map(function (q) { return q.label; }).join("; ") || "none loaded") + ", tile zoom " + m.z + " · <b>Sampled every</b> " + Math.round(m.res_m / 2) + " m · <b>Coverage:</b> " + (m.coverage_pct >= 99.95 ? "complete" : m.coverage_pct.toFixed(1) + "%") + "</p>" +
        "<p><b>Earth curvature:</b> " + curv + " · Sea deeper than 40 m is read as sea level</p>" +
        "<p><b>Calculated locally</b> on this device " + esc(T().dualT(ST.line.when, { date: true })) + "</p></div>";
    } else if (!ST.busy && !ST.err) h += '<p class="msg">Pick A and B on the map (or use Line of sight from here on the long-press ring, or Profile on a line drawn with Measure), then Calculate. The result shows whether the terrain lets A see B, and the ground in between.</p>';
    return h;
  }
  /* sections other modules add under a profile (window.OSAP_PROFILE_EXT) */
  function extras(c) {
    var box = c.querySelector(".tsext"), list = (W.OSAP_PROFILE_EXT || []).filter(function (e) { return e && e.id && typeof e.render === "function"; });
    if (!box || !ST.line.x || !list.length) return;
    var pr = pub(ST.line.x);
    list.forEach(function (e) {
      var d = D.createElement("div"); d.className = "tsx"; d.setAttribute("data-ext", e.id);
      if (e.label) { var t = D.createElement("div"); t.className = "nm"; t.textContent = e.label; d.appendChild(t); }
      box.appendChild(d);
      try { e.render(d, pr); } catch (er) { d.appendChild(D.createTextNode("This section could not be shown.")); }
    });
  }
  /* a path's elevation profile: distance, ground at each end, lowest and highest, climb and descent, steepest stretch */
  function pathCard(x) {
    var s = x.samples.filter(function (p) { return !p.nodata; }), lo = Infinity, hi = -Infinity, up = 0, dn = 0, ref = null, steep = 0, steepAt = 0;
    s.forEach(function (p) { if (p.z < lo) lo = p.z; if (p.z > hi) hi = p.z;
      /* climb and descent count changes of 5 m or more, so the small ups and downs of the elevation data do not add up */
      if (ref == null) ref = p.z; else if (p.z - ref >= 5) { up += p.z - ref; ref = p.z; } else if (ref - p.z >= 5) { dn += ref - p.z; ref = p.z; } });
    var j = 0;
    for (var i = 0; i < s.length; i++) { while (j < s.length && s[j].d - s[i].d < 100) j++; if (j >= s.length) break; var gr = Math.abs(s[j].z - s[i].z) / (s[j].d - s[i].d); if (gr > steep) { steep = gr; steepAt = s[i].d; } }
    var h = '<div class="losc vslos"><div class="h">ELEVATION PROFILE</div><p>Distance along the path: <b>' + km(x.dist) + "</b> (" + (x.vertices.length - 1) + " legs)</p>" +
      "<p>Start: <b>" + mm(x.zA) + "</b> · End: <b>" + mm(x.zB) + "</b></p>" +
      (s.length ? "<p>Lowest: <b>" + mm(lo) + "</b> · Highest: <b>" + mm(hi) + "</b></p><p>Climb: <b>" + Math.round(up) + " m</b> · Descent: <b>" + Math.round(dn) + " m</b></p>" : "<p>No elevation data along the path.</p>") +
      (steep ? "<p>Steepest 100 m: <b>" + Math.round(steep * 100) + "%</b> at " + km(steepAt) + " from the start</p>" : "") +
      "<p>Urban/vegetation obstruction: NOT MODELED</p>";
    return h + profileSvg(x) + "</div>";
  }
  /* the skyline: the highest ground angle in every direction within the range, from the observer's eye */
  function skylineSvg(r) {
    var B = new Array(360), hz = r.horizon, WD = 340, HT = 120, P = { l: 30, r: 6, t: 8, b: 22 };
    hz.forEach(function (q) { if (!isFinite(q.maxAngle)) return; var k = Math.floor(q.az) % 360; if (B[k] == null || q.maxAngle > B[k].a) B[k] = { a: q.maxAngle, d: q.dMax }; });
    var vals = B.filter(Boolean).map(function (b) { return b.a; });
    if (!vals.length) return "";
    var lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max(0.5, Math.max.apply(null, vals)), pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
    function X(a) { return P.l + (WD - P.l - P.r) * a / 360; } function Y(v) { return P.t + (HT - P.t - P.b) * (1 - (v - lo) / (hi - lo)); }
    var path = "", area = "", top = { a: -Infinity, az: 0, d: 0 }, started = false;
    for (var k = 0; k <= 360; k++) { var b = B[k % 360]; if (!b) { started = false; continue; } path += (started ? "L" : "M") + X(k).toFixed(1) + "," + Y(b.a).toFixed(1); started = true; if (k < 360 && b.a > top.a) top = { a: b.a, az: k, d: b.d }; }
    var pts = []; for (k = 0; k <= 360; k++) { var q = B[k % 360]; if (q) pts.push(X(k).toFixed(1) + "," + Y(q.a).toFixed(1)); }
    area = "M" + X(0) + "," + Y(lo) + "L" + pts.join("L") + "L" + X(360) + "," + Y(lo) + "Z";
    var ax = [[0, "N"], [90, "E"], [180, "S"], [270, "W"], [360, "N"]].map(function (t) { return '<line x1="' + X(t[0]) + '" x2="' + X(t[0]) + '" y1="' + P.t + '" y2="' + (HT - P.b) + '" stroke="currentColor" stroke-opacity=".15"/><text x="' + X(t[0]) + '" y="' + (HT - 8) + '" text-anchor="middle">' + t[1] + "</text>"; }).join("");
    var st = niceStep((hi - lo) / 3), yt = "";
    for (var v = Math.ceil(lo / st) * st; v <= hi; v += st) yt += '<text x="' + (P.l - 3) + '" y="' + (Y(v) + 3) + '" text-anchor="end">' + (Math.round(v * 10) / 10) + "°</text>";
    return '<div class="losc"><div class="h nm">SKYLINE</div><svg class="prof sky" viewBox="0 0 ' + WD + " " + HT + '" role="img" aria-label="Skyline: the highest ground angle in every direction" font-size="9" fill="currentColor">' +
      '<path d="' + area + '" fill="#8d6e63" fill-opacity=".35"/><path d="' + path + '" fill="none" stroke="#5d4037" stroke-width="1.3"/>' +
      '<line x1="' + P.l + '" x2="' + (WD - P.r) + '" y1="' + Y(0) + '" y2="' + Y(0) + '" stroke="#0b7285" stroke-dasharray="4 3"/>' + ax + yt + "</svg>" +
      '<p style="font-size:11.5px;color:var(--muted,#555);margin:2px 0">The highest ground in each direction within ' + S.km + " km, in degrees above level from " + (rev() ? "the point" : "the observer's eye") + " (blue: level). Highest: " + (Math.round(top.a * 10) / 10) + "° towards " + top.az + "°" + (top.d === top.d ? ", " + km(top.d) + " away" : "") + ".</p></div>";
  }
  function assumptions(r, g) {
    var st = r.stats, src = (g.sources || []).map(function (s) { return s.label; }).join("; ") || "none loaded";
    var curv = ST.ran.curvature ? "on" + (ST.ran.k ? ", with atmospheric refraction (k = " + ST.ran.k + ")" : ", no refraction") : "off";
    return '<div class="asm"><p class="nm">' + (ST.ranRev ? "REVERSE TERRAIN VIEWSHED " : "TERRAIN VIEWSHED ") + (ST.pass === "coarse" ? '<span class="tag">rough first pass, refining…</span>' : "") + "</p>" +
      "<p><b>" + (ST.ranRev ? "Can see the point" : "Visible terrain") + ":</b> " + st.visible_pct.toFixed(0) + "% · <b>" + (ST.ranRev ? "Cannot" : "Terrain-masked") + ":</b> " + (100 - st.visible_pct - st.unknown_pct).toFixed(0) + "% · <b>Unknown:</b> " + st.unknown_pct.toFixed(0) + "% of the ground within " + S.km + " km</p>" +
      (ST.ranRev ? "<p><b>Point:</b> " + mm(r.Zg) + " ground + " + ST.ran.obsH + " m = " + Math.round(r.Z0 * 10) / 10 + " m · <b>Observer height:</b> " + ST.ran.tgtH + " m above the ground everywhere. Line of sight is the same both ways, so this is the viewshed from the point with the two heights swapped.</p>" :
      "<p><b>Observer:</b> " + mm(r.Zg) + " ground + " + ST.ran.obsH + " m = " + Math.round(r.Z0 * 10) / 10 + " m · <b>Target height:</b> " + ST.ran.tgtH + " m above the ground</p>") +
      "<p><b>Urban/vegetation obstruction:</b> NOT MODELED. The elevation is a terrain model, not a model of buildings or trees: walls, single trees and most buildings are not in it, while SRTM (most of the world outside Japan and the US) partly carries dense forest canopy and big city blocks, so city and jungle results are rough.</p>" +
      "<p><b>Elevation:</b> " + esc(src) + ", tile zoom " + g.z + " · <b>Grid:</b> " + g.res + " m · <b>Coverage:</b> " + (g.coverage_pct >= 99.95 ? "complete" : g.coverage_pct.toFixed(1) + "%") + "</p>" +
      "<p><b>Earth curvature:</b> " + curv + " · Sea deeper than 40 m is read as sea level</p>" +
      "<p><b>Calculated locally</b> on this device " + esc(T().dualT(ST.when, { date: true })) + (navigator.onLine === false ? " · offline, from elevation already on this device" : "") + "</p></div>";
  }
  function losCard(x, inPanel) {
    var h = '<div class="' + (inPanel ? "losc " : "") + 'vslos"' + (inPanel ? "" : " data-keep-pop") + '><div class="h">LINE OF SIGHT</div><p>' + esc(x.nA) + " → " + esc(x.nB) + ' <span class="pt">' + esc(gridRef(x.to[0], x.to[1])) + "</span></p>" +
      "<p>Distance: <b>" + km(x.dist) + "</b></p><p>" + esc(x.eA) + " elevation: <b>" + mm(x.zA) + "</b> + " + x.hA + " m</p><p>" + esc(x.eB) + " elevation: <b>" + mm(x.zB) + "</b> + " + x.hB + " m</p>" +
      "<p>Maximum intervening terrain: <b>" + mm(x.maxZ) + "</b>" + (x.maxD === x.maxD ? " at " + km(x.maxD) : "") + "</p>" +
      '<p>Terrain LOS: <span class="v ' + x.los + '">' + (x.los === "CLEAR" ? "VISIBLE" : x.los) + "</span></p>" +
      (x.los === "BLOCKED" ? "<p>Blocking terrain: <b>" + km(x.blockD) + "</b> from " + esc(x.fA) + "</p>" : "") +
      (x.los === "UNKNOWN" ? "<p>Part of the line has no elevation data.</p>" : "") +
      "<p>Urban/vegetation obstruction: NOT MODELED</p>";
    if (inPanel && (S.prof || S.mode === "los")) h += profileSvg(x);
    else if (!inPanel) h += '<button type="button" data-vsprof>' + (S.prof ? "Profile in the panel" : "Show profile") + "</button>";
    return h + "</div>";
  }
  /* the terrain profile under the line: terrain, the line of sight, observer, target, highest ground, where it is blocked */
  function profileSvg(x) {
    var s = x.samples, WD = 340, HT = 150, P = { l: 40, r: 8, t: 10, b: 24 }, D0 = x.dist || 1;
    if (!x.drop) x.drop = function () { return 0; };
    var ys = s.filter(function (p) { return !p.nodata; }).map(function (p) { return p.z - x.drop(p.d); }).concat(x.path ? [] : [x.ZA, x.ZBeff]);
    if (!ys.length) return "";
    var lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys), pad = Math.max(5, (hi - lo) * 0.1); lo -= pad; hi += pad;
    function X(d) { return P.l + (WD - P.l - P.r) * d / D0; } function Y(z) { return P.t + (HT - P.t - P.b) * (1 - (z - lo) / (hi - lo)); }
    var path = "", started = false, area = "";
    s.forEach(function (p) { if (p.nodata) { started = false; return; } var cmd = started ? "L" : "M"; path += cmd + X(p.d).toFixed(1) + "," + Y(p.z - x.drop(p.d)).toFixed(1); started = true; });
    var gs = s.filter(function (p) { return !p.nodata; });
    if (gs.length) area = "M" + X(gs[0].d).toFixed(1) + "," + Y(lo) + gs.map(function (p) { return "L" + X(p.d).toFixed(1) + "," + Y(p.z - x.drop(p.d)).toFixed(1); }).join("") + "L" + X(gs[gs.length - 1].d).toFixed(1) + "," + Y(lo) + "Z";
    var ticks = "", step = niceStep(D0 / 1000 / 4) * 1000;
    for (var t = 0; t <= D0 + 1; t += step) ticks += '<line x1="' + X(t) + '" x2="' + X(t) + '" y1="' + (HT - P.b) + '" y2="' + (HT - P.b + 3) + '" stroke="currentColor"/><text x="' + X(t) + '" y="' + (HT - 8) + '" text-anchor="middle">' + (t / 1000).toFixed(step < 1000 ? 1 : 0) + "</text>";
    var zs = niceStep((hi - lo) / 3), yt = "";
    for (var z = Math.ceil(lo / zs) * zs; z <= hi; z += zs) yt += '<text x="' + (P.l - 4) + '" y="' + (Y(z) + 3) + '" text-anchor="end">' + Math.round(z) + "</text>";
    var col = x.los === "BLOCKED" ? "#c62828" : x.los === "CLEAR" ? "#2e7d32" : "#757575";
    var legs = x.path ? x.vertices.slice(1, -1).map(function (k) { var d = s[k].d; return '<line x1="' + X(d) + '" x2="' + X(d) + '" y1="' + P.t + '" y2="' + (HT - P.b) + '" stroke="#e8590c" stroke-dasharray="2 3"/>'; }).join("") : "";
    var blk = x.los === "BLOCKED" && !x.path ? (function () { var zz = interpZ(s, x.blockD); return '<path d="M' + (X(x.blockD) - 4) + "," + (Y(zz - x.drop(x.blockD)) - 4) + "l8,8m0,-8l-8,8" + '" stroke="#c62828" stroke-width="2.2"/>'; })() : "";
    var mx = x.maxD === x.maxD && !x.path ? '<path d="M' + X(x.maxD) + "," + (Y(x.maxZ - x.drop(x.maxD)) - 9) + 'l-4,-6h8z" fill="#5d4037"/><text x="' + X(x.maxD) + '" y="' + (Y(x.maxZ - x.drop(x.maxD)) - 17) + '" text-anchor="middle">' + Math.round(x.maxZ) + " m</text>" : "";
    var ends = x.path ? "" : '<line x1="' + X(0) + '" y1="' + Y(x.ZA) + '" x2="' + X(D0) + '" y2="' + Y(x.ZBeff) + '" stroke="' + col + '" stroke-width="1.6" stroke-dasharray="5 3"/>' +
      '<circle cx="' + X(0) + '" cy="' + Y(x.ZA) + '" r="4" fill="#0b7285" stroke="#fff"/><circle cx="' + X(D0) + '" cy="' + Y(x.ZBeff) + '" r="4" fill="' + col + '" stroke="#fff"/>';
    return '<svg class="prof" viewBox="0 0 ' + WD + " " + HT + '" role="img" aria-label="' + (x.path ? "Elevation profile along the path" : "Terrain profile from " + esc(x.nA) + " to " + esc(x.nB)) + '" font-size="9" fill="currentColor">' +
      '<path d="' + area + '" fill="#a1887f" fill-opacity=".35" stroke="none"/><path d="' + path + '" fill="none" stroke="#5d4037" stroke-width="1.4"/>' + legs + ends + blk + mx +
      '<line x1="' + P.l + '" x2="' + (WD - P.r) + '" y1="' + (HT - P.b) + '" y2="' + (HT - P.b) + '" stroke="currentColor" stroke-opacity=".5"/>' + ticks + yt +
      '<text x="' + (WD - P.r) + '" y="' + (HT - 8) + '" text-anchor="end" dy="-10">km</text><text x="2" y="' + (P.t + 2) + '">m MSL</text></svg>' +
      '<p style="font-size:11.5px;color:var(--muted,#555);margin:2px 0">' + (x.path ? "Brown: terrain along the path. Orange dashes: the measured points." :
      "Brown: terrain" + (x.curv ? " (lowered for Earth curvature)" : "") + ". Dashed: line of sight. ▼ highest ground" + (x.los === "BLOCKED" ? "; ✕ first terrain above the line" : "") + ".") + "</p>";
  }
  function niceStep(v) { var p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1e-6)))), f = v / p; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p; }
  function interpZ(s, d) { for (var i = 1; i < s.length; i++) if (s[i].d >= d) { var a = s[i - 1], b = s[i], t = (d - a.d) / ((b.d - a.d) || 1); return a.z + (b.z - a.z) * t; } return s[s.length - 1].z; }

  function setObs(lat, lon) { ST.obs = [lat, L.Util.wrapNum(lon, [-180, 180], true)]; ST.err = ""; ST.los = null; losLay.clearLayers(); drawObserver(); }
  function onClick(e) {
    var b = e.target.closest("[data-ts]"), rb = e.target.closest("[data-res]"), mb = e.target.closest("[data-mode]");
    if (mb) { setMode(mb.getAttribute("data-mode")); return; }
    if (rb) { S.res = rb.getAttribute("data-res"); keep(); render(); auto(true); return; }
    if (!b) return;
    var a = b.getAttribute("data-ts");
    if (a === "close") close();
    else if (a === "pick" || a === "pickA" || a === "pickB") { if (ST.arm === a) { pickEnd(); render(); } else pickStart(a); }
    else if (a === "centre") { var c = map.getCenter(); pickEnd(); setObs(c.lat, c.lng); render(); calc(); }
    else if (a === "centreA") { var c2 = map.getCenter(); pickEnd(); setLinePt(0, [c2.lat, c2.lng]); if (lineN() < 2) pickStart("pickB"); else { render(); calc(); } }
    else if (a === "lnclear") { lineReset([]); render(); pickStart("pickA"); }
    else if (a === "calc") calc();
    else if (a === "save") { var nmI = el.querySelector("#ts-name"); saveVs("", nmI && nmI.value); }
    else if (a === "cancel") { RUN++; if (ac) ac.abort(); engineCancel(); ST.busy = ""; ST.err = "Stopped."; render(); }
    else if (a === "clear") { RUN++; if (ac) ac.abort(); engineCancel(); ST.res = null; ST.grid = null; ST.obs = null; ST.busy = ""; ST.err = ""; ST.los = null; ST.line = { pts: [], x: null, len: 0 }; clearMap(); render(); }
  }
  function heightOf(p) { var x = PRESETS.filter(function (q) { return q[0] === p; })[0]; return x && x[2]; }
  function onChange(e) {
    var t = e.target, id = t.id;
    if (id === "ts-op" || id === "ts-tp") {
      var v = heightOf(t.value), o = id === "ts-op";
      if (o) S.obsP = t.value; else S.tgtP = t.value;
      if (v != null) { if (o) S.obsH = v; else S.tgtH = v; }
      else { var inp = el.querySelector(o ? "#ts-oh" : "#ts-th"); if (inp) { inp.focus(); inp.select(); } }
      keep(); if (v != null) { render(); auto(); }
      return;
    }
    if (id === "ts-km") { S.km = +t.value; keep(); drawObserver(); render(); auto(true); return; }
    if (id === "ts-curv") { S.curv = t.checked; if (!t.checked) S.refr = false; }
    else if (id === "ts-refr") { S.refr = t.checked; if (t.checked) S.curv = true; }
    else if (id === "ts-hz") { S.hz = t.checked; keep(); if (ST.res) drawMarks(ST.res.res, ST.res.n, ST.res.f, ST.grid); render(); return; }
    else if (id === "ts-prof") { S.prof = t.checked; keep(); render(); return; }
    else if (id === "ts-oh" || id === "ts-th") { heightIn(t); return; }
    else return;
    keep(); render(); auto();
  }
  /* typing a height: a custom height, recalculated a moment after the typing stops */
  var tH = 0;
  function heightIn(t) {
    var v = parseFloat(t.value); if (!(v >= 0 && v <= 1000)) return;
    var o = t.id === "ts-oh"; if (o) { S.obsH = v; if (heightOf(S.obsP) !== v) S.obsP = PRESETS.filter(function (p) { return p[2] === v; }).map(function (p) { return p[0]; })[0] || "bld"; }
    else { S.tgtH = v; if (heightOf(S.tgtP) !== v) S.tgtP = PRESETS.filter(function (p) { return p[2] === v; }).map(function (p) { return p[0]; })[0] || "bld"; }
    keep();
    var sel = el.querySelector(o ? "#ts-op" : "#ts-tp"); if (sel) sel.value = o ? S.obsP : S.tgtP;
    clearTimeout(tH); tH = setTimeout(auto, 450);
  }
  function onInput(e) { if (e.target.id === "ts-oh" || e.target.id === "ts-th") heightIn(e.target); }
  /* once there is a result, every change recalculates straight away (heights reuse the loaded elevation, so it is quick) */
  function auto() { if (S.mode === "los" ? ST.line.x && lineN() >= 2 : ST.res && ST.obs) calc(); }

  /* which: "pick" (observer / point), "pickA", "pickB" */
  function pickStart(which) {
    pickEnd(); ST.arm = which || "pick"; map.getContainer().style.cursor = "crosshair";
    /* Measure takes map taps too: step it aside while a point is picked (its line stays drawn) */
    if (measuring() && W.OSAP_MEASURE) W.OSAP_MEASURE.on(false);
    /* full window covers the map: step out of the way until the point is picked */
    if (!split() && el) el.hidden = true;
    hint(ST.arm === "pickA" ? "Tap the map at point A (the observer)." : ST.arm === "pickB" ? "Tap the map at point B (the target)." : rev() ? "Tap the map at the point to be seen." : "Tap the map where the observer stands.");
    setTimeout(function () { map.once("click", onPick); }, 0);
    if (el && !el.hidden) render();
  }
  function pickEnd() { ST.arm = ""; map.getContainer().style.cursor = ""; map.off("click", onPick); hint(""); }
  function onPick(e) {
    var a = ST.arm, ll = [e.latlng.lat, e.latlng.lng]; pickEnd();
    if (a === "pickA" || a === "pickB") {
      setLinePt(a === "pickA" ? 0 : 1, ll);
      if (lineN() < 2) { pickStart("pickB"); return; }
      render(); calc(); return;
    }
    setObs(ll[0], ll[1]); render(); calc();
  }
  /* Line of sight mode's points: A, B (or a measured path) */
  function lineReset(pts) {
    RUN++; if (ac) ac.abort(); engineCancel();
    ST.line = { pts: pts.map(function (p) { return [+p[0], +p[1]]; }), x: null, len: 0 }; ST.err = ""; ST.busy = "";
    for (var i = 1; i < ST.line.pts.length; i++) ST.line.len += hav(ST.line.pts[i - 1], ST.line.pts[i]);
    losLay.clearLayers(); drawLinePts();
  }
  function setLinePt(i, ll) {
    var P = ST.line.pts.length > 2 ? [ST.line.pts[0], ST.line.pts[ST.line.pts.length - 1]] : ST.line.pts.slice();
    ll = [ll[0], L.Util.wrapNum(ll[1], [-180, 180], true)];
    if (i === 0) P[0] = ll; else { if (!P.length) P[0] = ll; else P[1] = ll; }
    lineReset(P.filter(Boolean));
  }
  var lnMarks = L.layerGroup().addTo(map);
  function drawLinePts() {
    lnMarks.clearLayers();
    if (S.mode !== "los") return;
    var P = ST.line.pts;
    if (P.length > 2) lnMarks.addLayer(L.polyline(P, { pane: "vslines", color: "#5d4037", weight: 2, opacity: 0.8, dashArray: "2 5", interactive: false }));
    [[P[0], "A"], [P.length > 1 ? P[P.length - 1] : null, P.length > 2 ? "End" : "B"]].forEach(function (q) {
      if (!q[0]) return;
      lnMarks.addLayer(L.marker(q[0], { pane: "vslines", interactive: false, keyboard: false, icon: L.divIcon({ className: "vsab", html: "<span>" + q[1] + "</span>", iconSize: [24, 24], iconAnchor: [12, 12] }) }));
    });
  }
  function setMode(m) {
    if (!/^(vs|rev|los)$/.test(m) || m === S.mode) return;
    var was = S.mode; S.mode = m; keep();
    pickEnd(); RUN++; if (ac) ac.abort(); engineCancel();
    ST.res = null; ST.grid = null; ST.los = null; ST.busy = ""; ST.err = "";
    lay.clearLayers(); losLay.clearLayers(); img = null; hzLine = null; obsMark = null; ring = null; if (imgUrl) { URL.revokeObjectURL(imgUrl); imgUrl = null; }
    map.closePopup();
    /* carry the point over: the observer becomes A, A becomes the observer */
    if (m === "los" && ST.obs && !lineN()) lineReset([ST.obs]);
    else if (m !== "los" && was === "los" && ST.line.pts[0]) ST.obs = ST.line.pts[0].slice();
    drawLinePts(); if (m !== "los") drawObserver();
    render();
    if (m === "los") { if (lineN() >= 2) calc(); }
    else if (ST.obs) calc();
  }
  var hintEl = null;
  function hint(t) {
    if (!t) { if (hintEl) hintEl.hidden = true; return; }
    if (!hintEl) { hintEl = D.createElement("div"); hintEl.style.cssText = "position:absolute;left:50%;top:10px;transform:translateX(-50%);z-index:1000;background:#0b7285;color:#fff;padding:6px 12px;border-radius:16px;font-size:13px;box-shadow:0 1px 4px rgba(0,0,0,.4);pointer-events:none"; map.getContainer().appendChild(hintEl); }
    hintEl.textContent = t; hintEl.hidden = false;
  }

  /* ---------- calculate ---------- */
  function calc() {
    if (S.mode === "los") return calcLine();
    if (!ST.obs) return;
    var run = ++RUN; if (ac) ac.abort(); engineCancel();
    ac = W.AbortController ? new AbortController() : null;
    /* reverse: the sweep runs from the point with its height (the target height), every other cell at the observer height */
    var R = S.km * 1000, res = effRes(R, RES[S.res][0]), R0 = rev(), o = opts({ observer_height_m: R0 ? S.tgtH : S.obsH, target_height_m: R0 ? S.obsH : S.tgtH, radius_m: R, curvature: S.curv, refraction: S.refr });
    ST.busy = "Loading elevation…"; ST.err = ""; ST.at = 0; ST.los = null; ST.saved = ""; losLay.clearLayers(); map.closePopup(); render();
    getGrid(ST.obs[0], ST.obs[1], R, res, { signal: ac && ac.signal, prog: function (d, n) { if (run !== RUN) return; ST.at = d / n * 0.6; ST.busy = "Loading elevation " + d + " of " + n + " tiles…"; render(); } }).then(function (g) {
      if (run !== RUN) return;
      if (!g.sources.length) throw new Error(navigator.onLine === false ? "No elevation for this place on this device, and no connection to download it." : "The elevation tiles did not load. Check the connection and try again.");
      ST.busy = R0 ? "Calculating the reverse viewshed…" : "Calculating the viewshed…"; ST.at = 0.7; render();
      var f = res < 90 && g.n > 401 ? Math.round(90 / res) : 0;
      return engineRun(g, o, f, function (m) {
        if (run !== RUN) return;
        ST.res = m; ST.grid = g; ST.pass = m.pass; ST.when = Date.now(); ST.ran = o; ST.ranRev = R0;
        paint(m.res, m.n, m.f, g); drawMarks(m.res, m.n, m.f, g); drawObserver();
        if (m.pass === "fine") { ST.busy = ""; ST.at = 1; if (ST.redo) { var id = ST.redo; ST.redo = ""; saveVs(id); } } else { ST.busy = "Refining to " + res + " m…"; ST.at = 0.85; }
        render();
      });
    }).catch(function (e) {
      if (run !== RUN) return;
      ST.busy = ""; ST.err = e && e.name === "AbortError" ? "Stopped." : (e && e.message) || "The viewshed could not be calculated.";
      render();
    });
  }

  function calcLine() {
    var P = ST.line.pts; if (P.length < 2) return;
    var run = ++RUN; if (ac) ac.abort(); engineCancel();
    ac = W.AbortController ? new AbortController() : null;
    var path = P.length > 2, o = opts({ observer_height_m: S.obsH, target_height_m: S.tgtH, curvature: !path && S.curv, refraction: !path && S.refr });
    ST.busy = "Loading elevation…"; ST.err = ""; ST.at = 0; ST.line.x = null; losLay.clearLayers(); render();
    lineRun(P, { res: RES[S.res][0], hA: path ? 0 : o.obsH, hB: path ? 0 : o.tgtH, curvature: o.curvature, k: o.k, signal: ac && ac.signal,
      prog: function (d, n) { if (run !== RUN) return; ST.at = d / n * 0.9; ST.busy = "Loading elevation " + d + " of " + n + " tiles…"; render(); } }).then(function (x) {
      if (run !== RUN) return;
      if (!x.meta.sources.length) throw new Error(navigator.onLine === false ? "No elevation for this line on this device, and no connection to download it." : "The elevation tiles did not load. Check the connection and try again.");
      x = decorate(x, P[0], P[P.length - 1], path ? 0 : o.obsH, path ? 0 : o.tgtH, o);
      x.nA = "Point A"; x.nB = "Point B"; x.eA = "A"; x.eB = "B"; x.fA = "A";
      ST.line.x = x; ST.line.o = o; ST.line.when = Date.now(); ST.busy = ""; ST.at = 1;
      if (!path) drawLos(x, false); else losLay.clearLayers();
      render();
    }).catch(function (e) {
      if (run !== RUN) return;
      ST.busy = ""; ST.err = e && e.name === "AbortError" ? "Stopped." : (e && e.message) || "The line of sight could not be calculated.";
      render();
    });
  }

  /* ---------- tap inside the result: line of sight to that point ---------- */
  function measuring() { var b = D.getElementById("meas-btn"); return !!(b && b.getAttribute("aria-pressed") === "true"); }
  map.on("click", function (e) {
    if (ST.arm || S.mode === "los" || !ST.res || !ST.obs || !ST.grid || measuring()) return;
    var p = [e.latlng.lat, L.Util.wrapNum(e.latlng.lng, [-180, 180], true)];
    if (hav(ST.obs, p) > S.km * 1000) return;
    losTo(p).catch(function () {});
  });
  function losTo(p) {
    var g = ST.grid, SRC = W.OSAP_TERRAIN_SRC, half = (g.n - 1) / 2, b = SRC.toCell(g.spec, p[0], p[1]), o = ST.ran, R0 = ST.ranRev;
    /* reverse: from an observer at the tapped point (observer height, which the sweep gave every cell) to the point */
    var A = R0 ? b : [half, half], B = R0 ? [half, half] : b, hA = R0 ? o.tgtH : o.obsH, hB = R0 ? o.obsH : o.tgtH;
    return engineLos(g, A, B, { hA: hA, hB: hB, curvature: o.curvature, k: o.k }).then(function (x) {
      x = decorate(x, R0 ? p : ST.obs, R0 ? ST.obs : p, hA, hB, o);
      if (R0) { x.nA = "Observer here"; x.nB = "The point"; x.eA = "Observer"; x.eB = "Point"; x.fA = "the observer"; }
      ST.los = x; drawLos(x, true, p);
      if (el && !el.hidden) render();
      return x;
    });
  }
  function decorate(x, a, b, hA, hB, o) {
    x.from = a; x.to = b; x.hA = hA; x.hB = hB; x.curv = !!o.curvature;
    x.nA = "Observer"; x.nB = "Selected point"; x.eA = "Observer"; x.eB = "Target"; x.fA = "observer";
    x.drop = function (d) { return o.curvature ? d * d / (2 * R_EARTH) * (1 - (o.k || 0)) : 0; };
    x.ZBeff = x.zB + hB - x.drop(x.dist);
    return x;
  }
  function drawLos(x, popup, at) {
    losLay.clearLayers();
    var col = x.los === "BLOCKED" ? "#c62828" : x.los === "CLEAR" ? "#2e7d32" : "#616161";
    losLay.addLayer(L.polyline([x.from, x.to], { pane: "vslines", color: "#fff", weight: 5, opacity: 0.8, interactive: false }));
    losLay.addLayer(L.polyline([x.from, x.to], { pane: "vslines", color: col, weight: 2.5, dashArray: x.los === "CLEAR" ? null : "6 4", interactive: false }));
    if (x.los === "BLOCKED" && x.dist) {
      var t = x.blockD / x.dist, bp = [x.from[0] + (x.to[0] - x.from[0]) * t, x.from[1] + (x.to[1] - x.from[1]) * t];
      /* a sampled line knows where each sample is */
      var hit = x.samples.filter(function (q) { return q.lat != null && q.d >= x.blockD; })[0]; if (hit) bp = [hit.lat, hit.lon];
      losLay.addLayer(L.circleMarker(bp, { pane: "vslines", radius: 5, color: "#fff", weight: 2, fillColor: "#c62828", fillOpacity: 1, interactive: false }).bindTooltip("Blocking terrain " + km(x.blockD) + " from " + x.fA, { direction: "top" }));
    }
    if (popup) {
      var pad = split() && W.OSAP_SPLIT ? W.OSAP_SPLIT.clear() : { tl: [0, 0], br: [0, 0] };
      L.popup({ maxWidth: 290, autoPanPaddingTopLeft: L.point(pad.tl[0] + 8, pad.tl[1] + 8), autoPanPaddingBottomRight: L.point(pad.br[0] + 8, pad.br[1] + 8) }).setLatLng(at || x.to).setContent(losCard(x, false)).openOn(map);
    }
  }
  D.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-vsprof]"); if (!b) return;
    S.prof = true; keep(); open(); render();
    var sv = el && el.querySelector("svg.prof"); if (sv && sv.scrollIntoView) sv.scrollIntoView({ block: "nearest" });
  });

  /* ---------- the long-press ring's Terrain list ---------- */
  function menu(P) {
    var extra = (W.OSAP_TERRAIN_TOOLS || []).filter(function (t) { return t && t.id && t.label && typeof t.run === "function"; });
    var h = '<div class="vsmenu" data-keep-pop><div class="h">Terrain</div><button type="button" data-vm="vs">Viewshed from here</button><button type="button" data-vm="rv">Reverse viewshed to here</button>' +
      '<button type="button" data-vm="lo">Line of sight from here</button><button type="button" data-vm="el">Elevation here</button>' +
      extra.map(function (t, i) { return '<button type="button" data-vm="x' + i + '">' + esc(t.label) + "</button>"; }).join("") + '<div class="el" aria-live="polite"></div></div>';
    ensureCss();
    MENU = { P: P, extra: extra, pop: L.popup({ maxWidth: 240, className: "vsmenu-pop" }).setLatLng(P).setContent(h).openOn(map) };
  }
  var MENU = null;
  /* the list's buttons (one listener for the page: the pop-up's own element is rebuilt by Leaflet) */
  D.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".vsmenu [data-vm]"); if (!b || !MENU) return;
    var k = b.getAttribute("data-vm"), P = MENU.P, box = b.closest(".vsmenu");
    if (k === "vs") { map.closePopup(MENU.pop); viewshedAt(P); }
    else if (k === "rv") { map.closePopup(MENU.pop); reverseAt(P); }
    else if (k === "lo") { map.closePopup(MENU.pop); losFrom(P); }
    else if (k === "el") {
      var out = box.querySelector(".el"); out.textContent = "Looking up…";
      elevationAt(P[0], P[1]).then(function (r) {
        out.innerHTML = r.nodata ? (r.failed ? "The elevation did not load. Check the connection." : "No elevation data here.") : "<b>" + Math.round(r.elev_m) + " m MSL</b> ground elevation<br><span style=\"font-size:11.5px\">" + esc(r.sources.map(function (s) { return s.label; }).join("; ")) + ", about " + Math.round(r.res_m) + " m pixels. Terrain model, not a survey.</span>";
      }, function (e2) { out.textContent = (e2 && e2.message) || "The elevation did not load."; });
    } else if (k.charAt(0) === "x") { map.closePopup(MENU.pop); var t = MENU.extra[+k.slice(1)]; try { t.run(L.latLng(P[0], P[1])); } catch (x) {} }
  });
  function ensureCss() { if (!D.getElementById("terrain-css")) { var st = D.createElement("style"); st.id = "terrain-css"; st.textContent = CSS; D.head.appendChild(st); } }

  /* ---------- saved viewsheds: named map objects in the active workspace (store "osap-viewsheds") ----------
     A saved viewshed keeps its settings (what is needed to work it out again) plus, so it shows at once and offline and goes
     into KML, the visible ground as polygons and the horizon as a line, made from the result when it was saved. Recalculate
     works it out again from the settings with the elevation available now. Device move copies the store with the rest. */
  var VKEY = "osap-viewsheds", MAX_SAVED = 50, MAX_VERT = 4000;
  function okVs(v) { return v && typeof v.id === "string" && /^vs[a-z0-9]{4,40}$/.test(v.id) && v.observer && isFinite(v.observer.lat) && isFinite(v.observer.lon); }
  function vsAll() { try { var a = JSON.parse(localStorage.getItem(VKEY)); return Array.isArray(a) ? a.filter(okVs) : []; } catch (e) { return []; } }
  function vsPut(a) { try { localStorage.setItem(VKEY, JSON.stringify(a)); return true; } catch (e) { return false; } }
  function vsGet(id) { return vsAll().filter(function (v) { return v.id === id; })[0] || null; }
  function vsId() { var b = new Uint8Array(6); W.crypto.getRandomValues(b); return "vs" + Date.now().toString(36) + Array.prototype.map.call(b, function (x) { return (x % 36).toString(36); }).join(""); }
  function nextName(R0) {
    var used = vsAll().map(function (v) { return v.name; }), base = R0 ? "Reverse viewshed " : "Viewshed ";
    for (var k = 1; k < 1000; k++) { var nm = base + (k < 10 ? "0" + k : k); if (used.indexOf(nm) < 0) return nm; }
    return base + Date.now();
  }
  function r5(v) { return Math.round(v * 1e5) / 1e5; }

  /* the visible cells as polygons (outer rings with holes), from a grid result: cells are thinned so the shape stays small */
  function polygons(cls, n, spec) {
    var SRC = W.OSAP_TERRAIN_SRC, k = Math.max(1, Math.ceil(n / 200)), out;
    for (;;) {
      var m = Math.floor(n / k), B = new Uint8Array(m * m), o = k >> 1;
      for (var j = 0; j < m; j++) for (var i = 0; i < m; i++) B[j * m + i] = cls[Math.min(n - 1, j * k + o) * n + Math.min(n - 1, i * k + o)] === 1 ? 1 : 0;
      var rings = trace(B, m).map(function (r) { return simplify(r, 0.8); }).filter(function (r) { return r.length >= 4 && Math.abs(area(r)) >= 3; });
      var verts = rings.reduce(function (a, r) { return a + r.length; }, 0);
      out = { rings: rings, k: k };
      if (verts <= MAX_VERT || m < 40) break;
      k = Math.ceil(k * 1.5);
    }
    var K = out.k, outer = [], holes = [];
    out.rings.forEach(function (r) { (area(r) > 0 ? outer : holes).push(r); });
    var P = outer.map(function (r) { return { r: r, a: area(r), h: [] }; });
    holes.forEach(function (h) {
      var best = null; P.forEach(function (q) { if (inRing(h[0], q.r) && (!best || q.a < best.a)) best = q; });
      if (best) best.h.push(h);
    });
    function geo(r) { return r.map(function (v) { var ll = SRC.toLL(spec, v[0] * K - 0.5, v[1] * K - 0.5); return [r5(ll[0]), r5(ll[1])]; }); }
    return P.map(function (q) { return { o: geo(q.r), h: q.h.map(geo) }; });
  }
  /* the edges between filled and empty cells, chained into closed rings (filled ground on the right going round: outer rings
     run clockwise on screen, holes the other way) */
  function trace(B, m) {
    var M = m + 1, out = {}, cnt = 0;
    function f(i, j) { return i >= 0 && j >= 0 && i < m && j < m && B[j * m + i] === 1; }
    function add(a, b) { (out[a] = out[a] || []).push(b); cnt++; }
    for (var j = 0; j < m; j++) for (var i = 0; i < m; i++) {
      if (!f(i, j)) continue;
      if (!f(i, j - 1)) add(j * M + i, j * M + i + 1);
      if (!f(i + 1, j)) add(j * M + i + 1, (j + 1) * M + i + 1);
      if (!f(i, j + 1)) add((j + 1) * M + i + 1, (j + 1) * M + i);
      if (!f(i - 1, j)) add((j + 1) * M + i, j * M + i);
    }
    var rings = [];
    Object.keys(out).forEach(function (s0) {
      while (out[s0] && out[s0].length) {
        var start = +s0, cur = start, ring = [];
        do { ring.push([cur % M, Math.floor(cur / M)]); var nx = out[cur].pop(); if (!out[cur].length) delete out[cur]; cur = nx; } while (cur !== start && out[cur]);
        if (ring.length >= 4) rings.push(ring);
      }
    });
    return rings;
  }
  function area(r) { var a = 0; for (var i = 0, n = r.length; i < n; i++) { var p = r[i], q = r[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
  function inRing(p, r) { var c = false; for (var i = 0, j = r.length - 1; i < r.length; j = i++) { var a = r[i], b = r[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
  /* Douglas-Peucker on a closed ring */
  function simplify(r, tol) {
    if (r.length < 5) return r;
    var far = 0, fd = -1; for (var i = 1; i < r.length; i++) { var d = (r[i][0] - r[0][0]) * (r[i][0] - r[0][0]) + (r[i][1] - r[0][1]) * (r[i][1] - r[0][1]); if (d > fd) { fd = d; far = i; } }
    function dp(a) {
      if (a.length < 3) return a;
      var A = a[0], Bp = a[a.length - 1], dx = Bp[0] - A[0], dy = Bp[1] - A[1], L2 = dx * dx + dy * dy, mx = 0, mi = 0;
      for (var i = 1; i < a.length - 1; i++) { var t = L2 ? ((a[i][0] - A[0]) * dx + (a[i][1] - A[1]) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t)); var ex = A[0] + t * dx - a[i][0], ey = A[1] + t * dy - a[i][1], d = ex * ex + ey * ey; if (d > mx) { mx = d; mi = i; } }
      if (mx <= tol * tol) return [A, Bp];
      return dp(a.slice(0, mi + 1)).slice(0, -1).concat(dp(a.slice(mi)));
    }
    var one = dp(r.slice(0, far + 1)), two = dp(r.slice(far).concat([r[0]]));
    return one.slice(0, -1).concat(two.slice(0, -1));
  }

  /* save the panel's current result: as a new viewshed, or over saved viewshed id (Recalculate) */
  function saveVs(id, name) {
    var m = ST.res, g = ST.grid, o = ST.ran; if (!m || !g || ST.pass !== "fine") return null;
    var r = m.res, all = vsAll(), old = id ? all.filter(function (v) { return v.id === id; })[0] : null;
    if (!old && all.length >= MAX_SAVED) { ST.err = "There are already " + MAX_SAVED + " saved viewsheds. Delete one first."; render(); return null; }
    var hz = horizonLL(r, m.n, m.f, g), step = Math.max(1, Math.ceil(hz.length / 360)), now = new Date().toISOString();
    var v = {
      id: old ? old.id : vsId(), type: "viewshed", mode: ST.ranRev ? "reverse" : "viewshed", name: clipName(name || (old && old.name) || nextName(ST.ranRev)),
      /* as the engine ran it: for a reverse viewshed the "observer" is the point and target_height_m the observers' height */
      observer: { lat: r5(ST.obs[0]), lon: r5(ST.obs[1]), height_m: o.obsH }, target_height_m: o.tgtH,
      radius_m: o.radius_m, terrain_resolution_m: g.res, curvature: !!o.curvature, refraction: !!o.k, refraction_k: o.k || K_REFR,
      dem_source: "OSAP DEM", dem_detail: { provider: (g.sources || []).map(function (q) { return q.id; }).join(","), zoom: g.z, coverage_pct: Math.round(g.coverage_pct * 10) / 10 },
      terrain_model: "DEM (terrain only)", urban_vegetation: "not modeled", engine: "osap-viewshed/1",
      result: { visible_pct: Math.round(r.stats.visible_pct * 10) / 10, unknown_pct: Math.round(r.stats.unknown_pct * 10) / 10, observer_ground_m: Math.round(r.Zg * 10) / 10 },
      created: old ? old.created : now, calculated: now, cc: (W.TSAP && W.TSAP.country) || "", on: old ? old.on !== false : true,
      panel: { obsH: S.obsH, tgtH: S.tgtH, obsP: S.obsP, tgtP: S.tgtP, km: S.km, res: S.res, curv: S.curv, refr: S.refr },
      horizon: hz.filter(function (_, i) { return i % step === 0; }).map(function (p) { return [r5(p[0]), r5(p[1])]; }),
      visible: polygons(r.cls, m.n, g.spec)
    };
    if (old) all = all.map(function (x) { return x.id === v.id ? v : x; }); else all.push(v);
    if (!vsPut(all)) { ST.err = "This device's storage is full, so the viewshed was not saved."; render(); return null; }
    ST.saved = v.id; ST.err = ""; drawSaved(); paintList(); render();
    return v;
  }
  function clipName(s) { return String(s || "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 60) || "Viewshed"; }
  function vsSub(v) { return (v.mode === "reverse" ? "Reverse" : "Viewshed") + " · " + Math.round(v.radius_m / 1000) + " km · " + v.result.visible_pct + "% " + (v.mode === "reverse" ? "can see it" : "visible") + " · " + v.observer.height_m + " / " + v.target_height_m + " m"; }
  function saveRow() {
    var v = ST.saved && vsGet(ST.saved);
    return '<div class="tsr tsave"><input type="text" id="ts-name" maxlength="60" aria-label="Name for the saved viewshed" value="' + esc(v ? v.name : nextName(ST.ranRev)) + '">' +
      '<button type="button" data-ts="save">' + (v ? "Save as new" : "Save viewshed") + "</button>" + (v ? '<span class="msg">Saved as <b>' + esc(v.name) + "</b></span>" : "") + "</div>";
  }
  function savedPanel() {
    var L0 = vsAll(); if (!L0.length) return "";
    return '<div class="vssaved"><div class="nm">SAVED VIEWSHEDS (' + L0.length + ')</div>' + L0.map(function (v) {
      var nm = ST.renaming === v.id ? '<input type="text" data-vsrenin="' + v.id + '" maxlength="60" value="' + esc(v.name) + '" aria-label="New name">' : "<b>" + esc(v.name) + "</b>";
      return '<div class="vsrow"><label><input type="checkbox" data-vson="' + v.id + '"' + (v.on !== false ? " checked" : "") + ' aria-label="Show ' + esc(v.name) + ' on the map"> ' + nm + "</label>" +
        '<div class="sub">' + esc(vsSub(v)) + "</div>" +
        '<div class="tsr"><button type="button" data-vsgo="' + v.id + '">Show</button><button type="button" data-vsopen="' + v.id + '" title="Work it out again with the elevation available now">Recalculate</button>' +
        '<button type="button" data-vsren="' + v.id + '">Rename</button><button type="button" data-vsdel="' + v.id + '">' + (ST.delAsk === v.id ? "Delete: sure?" : "Delete") + "</button></div></div>";
    }).join("") + '<p class="msg">Kept in the active workspace (My work, Workspaces), in its KML export and in Move to another device.</p></div>';
  }
  /* Map overlays > Elevation and terrain analysis: the saved viewsheds with their toggles */
  function paintList() {
    var box = D.getElementById("ml-viewsheds"); if (!box) return;
    var L0 = vsAll();
    box.innerHTML = L0.length ? L0.map(function (v) { return '<label class="mlrow"><input type="checkbox" data-vson="' + v.id + '"' + (v.on !== false ? " checked" : "") + '><span><b>' + esc(v.name) + "</b><i>" + esc(vsSub(v)) + "</i></span></label>"; }).join("") : "";
  }
  /* the saved viewsheds that are switched on, drawn from their stored shapes (no download, works offline) */
  var savedLay = L.layerGroup().addTo(map);
  function drawSaved() {
    savedLay.clearLayers();
    vsAll().forEach(function (v) {
      if (v.on === false) return;
      (v.visible || []).forEach(function (q) { savedLay.addLayer(L.polygon([q.o].concat(q.h || []), { pane: "vspane", stroke: true, color: "#1b5e20", weight: 1, opacity: 0.7, fillColor: "#43a047", fillOpacity: 0.28, interactive: false })); });
      if (v.horizon && v.horizon.length > 2) savedLay.addLayer(L.polyline(v.horizon.concat([v.horizon[0]]), { pane: "vslines", color: "#ffd600", weight: 1.6, dashArray: "4 4", opacity: 0.9, interactive: false }));
      savedLay.addLayer(L.marker([v.observer.lat, v.observer.lon], { pane: "vslines", interactive: false, keyboard: false, icon: L.divIcon({ className: "vsname", html: "<span>" + esc(v.name) + "</span>", iconSize: null, iconAnchor: [0, 0] }) }));
      savedLay.addLayer(L.circleMarker([v.observer.lat, v.observer.lon], { pane: "vslines", radius: 5, color: "#fff", weight: 2, fillColor: "#1b5e20", fillOpacity: 1, interactive: false }));
    });
  }
  function vsSet(id, fn) { var a = vsAll(); a.forEach(function (v) { if (v.id === id) fn(v); }); vsPut(a); }
  function vsBounds(v) {
    var pts = [[v.observer.lat, v.observer.lon]]; (v.visible || []).forEach(function (q) { pts = pts.concat(q.o); }); (v.horizon || []).forEach(function (p) { pts.push(p); });
    return L.latLngBounds(pts);
  }
  /* reopen a saved viewshed in the panel with its settings and work it out again; the fine pass replaces the saved one */
  function vsOpen(id) {
    var v = vsGet(id); if (!v) return;
    var p = v.panel || {};
    var md = v.mode === "reverse" ? "rev" : "vs"; if (S.mode !== md) setMode(md);
    ["obsH", "tgtH", "obsP", "tgtP", "res", "curv", "refr"].forEach(function (k) { if (p[k] != null) S[k] = p[k]; });
    S.km = RANGES.indexOf(p.km) >= 0 ? p.km : Math.max(1, Math.round(v.radius_m / 1000)); keep();
    open(); pickEnd(); setObs(v.observer.lat, v.observer.lon); ST.redo = v.id; render(); calc();
  }
  D.addEventListener("change", function (e) {
    var t = e.target;
    if (t.matches && t.matches("[data-vson]")) { var id = t.getAttribute("data-vson"), on = t.checked; vsSet(id, function (v) { v.on = on; }); drawSaved(); paintList(); if (isOpen()) render(); }
  });
  D.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-vsgo],[data-vsopen],[data-vsren],[data-vsdel]"); if (!b) return;
    var id;
    if ((id = b.getAttribute("data-vsgo"))) { var v = vsGet(id); if (v) { if (v.on === false) { vsSet(id, function (x) { x.on = true; }); drawSaved(); paintList(); } map.fitBounds(vsBounds(v), { padding: [30, 30], maxZoom: 14 }); if (isOpen()) render(); } }
    else if ((id = b.getAttribute("data-vsopen"))) vsOpen(id);
    else if ((id = b.getAttribute("data-vsren"))) { ST.renaming = id; render(); var inp = el.querySelector('[data-vsrenin="' + id + '"]'); if (inp) { inp.focus(); inp.select(); } }
    else if ((id = b.getAttribute("data-vsdel"))) {
      if (ST.delAsk !== id) { ST.delAsk = id; render(); return; }
      ST.delAsk = ""; vsPut(vsAll().filter(function (x) { return x.id !== id; })); if (ST.saved === id) ST.saved = ""; drawSaved(); paintList(); render();
    }
  });
  function renameDone(inp) { var id = inp.getAttribute("data-vsrenin"), nm = clipName(inp.value); ST.renaming = ""; vsSet(id, function (v) { v.name = nm; }); drawSaved(); paintList(); render(); }
  D.addEventListener("keydown", function (e) {
    var t = e.target; if (!t.matches) return;
    if (t.matches("[data-vsrenin]")) { if (e.key === "Enter") { e.preventDefault(); renameDone(t); } else if (e.key === "Escape") { ST.renaming = ""; render(); } }
    else if (t.id === "ts-name" && e.key === "Enter") { e.preventDefault(); saveVs("", t.value); }
  });
  D.addEventListener("focusout", function (e) { var t = e.target; if (t.matches && t.matches("[data-vsrenin]") && ST.renaming) renameDone(t); });
  drawSaved(); setTimeout(paintList, 0);

  /* ---------- open, close, API ---------- */
  function open() { ensure(); if (S.mode === "los") drawLinePts(); else drawObserver(); render(); }
  function close() { pickEnd(); RUN++; if (ac) ac.abort(); engineCancel(); ST.busy = ""; if (el) el.hidden = true; }
  function isOpen() { return !!el && !el.hidden; }
  function viewshedAt(P) { if (S.mode !== "vs") setMode("vs"); open(); pickEnd(); setObs(P[0], P[1]); render(); calc(); }
  function reverseAt(P) { if (S.mode !== "rev") setMode("rev"); open(); pickEnd(); setObs(P[0], P[1]); render(); calc(); }
  /* line of sight from P: A is set, B is picked next */
  function losFrom(P) { if (S.mode !== "los") setMode("los"); open(); lineReset([[P[0], P[1]]]); render(); pickStart("pickB"); }
  /* a line or path (Measure's Profile): two points give A to B, more give the elevation profile along the path */
  function line(pts) {
    pts = (pts || []).filter(function (p) { return p && p.length >= 2; });
    if (pts.length < 2) return;
    if (S.mode !== "los") setMode("los"); open(); pickEnd(); lineReset(pts); render(); calc();
  }
  /* the ground height at one point: { elev_m, nodata, res_m, sources } */
  function elevationAt(lat, lon) { return need().then(function (SRC) { return SRC.elevationAt(lat, L.Util.wrapNum(lon, [-180, 180], true)); }); }
  /* the ground along a line: { total_m, samples: [{ dist_m, elev_m, nodata }], los, block_m, max_elev_m, max_at_m, res_m,
     coverage_pct, sources }. opt: { res_m, hA, hB, curvature, k } (the heights at A and B in metres above the ground) */
  function profile(a, b, opt) {
    opt = opt || {};
    return lineRun([a, b], { res: +opt.res_m || 30, hA: num(opt.hA, 0), hB: num(opt.hB, 0), curvature: !!opt.curvature, k: opt.k || 0, signal: opt.signal }).then(pub);
  }
  /* the ground along points [[lat, lon], ...] and, for two points, the line of sight between them (engine losAlong) */
  function lineRun(pts, o) {
    return need().then(function (SRC) {
      return SRC.line(pts.map(function (p) { return [+p[0], +p[1]]; }), o.res, { signal: o.signal, prog: o.prog }).then(function (r) {
        return onPage().then(function (VS) {
          var x = VS.losAlong(r.samples, { hA: o.hA, hB: o.hB, curvature: !!o.curvature, k: o.k || 0 });
          x.meta = r; x.path = pts.length > 2; x.vertices = r.vertices;
          return x;
        });
      });
    });
  }
  /* the shape other modules get (OSAP_TERRAIN_ANALYSIS.profile, OSAP_PROFILE_EXT) */
  function pub(x) {
    var r = x.meta;
    return { total_m: x.dist, samples: x.samples.map(function (p) { return { dist_m: p.d, elev_m: p.nodata ? null : p.z, nodata: p.nodata, lat: p.lat, lon: p.lon }; }),
      los: x.path ? null : x.los, block_m: x.los === "BLOCKED" && !x.path ? x.blockD : null, max_elev_m: x.maxZ === x.maxZ ? x.maxZ : null, max_at_m: x.maxD === x.maxD ? x.maxD : null,
      vertices: x.vertices, res_m: r.res_m, coverage_pct: r.coverage_pct, sources: r.sources, version: VERSION };
  }
  /* a viewshed with no panel or marks (other modules): opts { lat, lon, observer_height_m, target_height_m, radius_m, res_m,
     curvature, refraction, refraction_k, returnRays }. Resolves with { cls, n, bounds, stats, blockD, obsMax, horizon, rays,
     coverage_pct, res_m, sources, version, assumptions } (cls: 0 outside, 1 visible, 2 masked, 3 unknown) */
  function viewshed(o) {
    o = o || {};
    var R = Math.min(100000, Math.max(100, +o.radius_m || 5000)), res = effRes(R, Math.max(10, +o.res_m || 30)), q = opts(Object.assign({}, o, { radius_m: R }));
    return need().then(function (SRC) {
      var s = SRC.around(+o.lat, +o.lon, R, res);
      return SRC.grid(s, { signal: o.signal }).then(function (r) {
        var g = { gid: ++GID, E: r.E, n: s.n, rowM: r.rowM };
        return APIE.run(g, q, 0, function () {}).then(function (m) {
          var half = (s.n - 1) / 2, sw = SRC.toLL(s, -0.5, s.n - 0.5), ne = SRC.toLL(s, s.n - 0.5, -0.5);
          return Object.assign({}, m.res, { n: s.n, bounds: [sw, ne], centre: SRC.toLL(s, half, half), coverage_pct: r.coverage_pct, res_m: res, sources: r.sources, version: VERSION,
            assumptions: { observer_height_m: q.obsH, target_height_m: q.tgtH, radius_m: R, curvature: q.curvature, refraction_k: q.k, terrain_model: "DEM (terrain only)", urban_vegetation: "not modeled" } });
        });
      });
    });
  }
  /* Map overlays > Elevation and terrain analysis > Terrain analysis (index.html) */
  D.addEventListener("click", function (e) { var b = e.target.closest && e.target.closest("[data-terrain-open]"); if (b) { e.preventDefault(); open(); } });
  W.OSAP_TERRAIN_TOOLS = W.OSAP_TERRAIN_TOOLS || [];
  W.OSAP_TERRAIN_ANALYSIS = {
    version: VERSION, open: open, close: close, isOpen: isOpen, menu: menu, viewshedAt: viewshedAt, reverseAt: reverseAt, losFrom: losFrom, line: line,
    saved: function () { return vsAll(); }, save: function (name) { return saveVs("", name); }, showSaved: function (id) { var v = vsGet(id); if (!v) return; if (v.on === false) { vsSet(id, function (x) { x.on = true; }); drawSaved(); paintList(); } map.fitBounds(vsBounds(v), { padding: [30, 30], maxZoom: 14 }); },
    elevationAt: elevationAt, profile: profile, viewshed: viewshed, losTo: function (p) { return ST.res ? losTo(p) : Promise.reject(new Error("no viewshed")); },
    state: function () { return { mode: S.mode, arm: ST.arm, line: { pts: ST.line.pts.slice(), result: ST.line.x ? pub(ST.line.x) : null }, obs: ST.obs, busy: ST.busy, err: ST.err, pass: ST.pass, stats: ST.res && ST.res.res.stats, grid: ST.grid && { n: ST.grid.n, res: ST.grid.res, z: ST.grid.z, coverage_pct: ST.grid.coverage_pct, sources: ST.grid.sources }, los: ST.los, marks: lay.getLayers().length + losLay.getLayers().length + lnMarks.getLayers().length, savedMarks: savedLay.getLayers().length, settings: Object.assign({}, S) }; }
  };
})();
