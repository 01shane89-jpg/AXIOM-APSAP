/* AXIOM OSAP Terrain analysis (Shane 2026-10-03): what the ground lets an observer see. Phase 1: the terrain viewshed, with
   a line-of-sight card for any point inside it and the terrain profile along that line.
   - Where it lives (layout owner, 2026-10-03): long-press ring > Terrain (Viewshed from here, Elevation here, plus tools other
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
   - Nothing is sent anywhere: the elevation tiles are downloaded and everything is worked out on this device. The result is
     the analyst's own working aid, not a report, a finding or evidence.
   window.OSAP_TERRAIN_ANALYSIS = { version, open, close, isOpen, menu, viewshedAt, elevationAt, profile, viewshed, losTo, state }
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
    curv: !!S0.curv, refr: !!S0.refr, hz: S0.hz !== false, prof: !!S0.prof
  };
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

  /* ---------- the engine: in a worker, on the page if workers fail ---------- */
  var wk = null, wkDead = false, RID = 0, PEND = {}, GID = 0, wkGid = 0, gridNow = null;
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
  function engineGrid(g) {
    if (worker() && wkGid !== g.gid) { wk.postMessage({ cmd: "grid", gid: g.gid, E: g.E, n: g.n, rowM: g.rowM }); wkGid = g.gid; }
  }
  function onPage() { return W.OSAP_VS ? Promise.resolve(W.OSAP_VS) : script(BASE + "viewshed-engine.js").then(function () { return W.OSAP_VS; }); }
  /* viewshed on grid g; onPass(pass) is called with the rough pass first (when asked), then the full one */
  function engineRun(g, o, coarse, onPass) {
    return new Promise(function (res, rej) {
      function page() {
        onPage().then(function (VS) {
          setTimeout(function () {
            try { var r = VS.viewshed(g, o); var m = { pass: "fine", f: 1, n: g.n, res: r }; onPass(m); res(m); } catch (e) { rej(e); }
          }, 0);
        }, rej);
      }
      if (!worker()) return page();
      engineGrid(g);
      var rid = ++RID, retried = false;
      PEND[rid] = function cb(m) {
        if (m.error === "worker") return page();
        if (m.error === "stale" && !retried) { retried = true; wkGid = 0; engineGrid(g); PEND[rid] = cb; wk.postMessage({ cmd: "run", gid: g.gid, rid: rid, o: o, coarse: coarse }); return; }
        if (m.error) return rej(new Error(m.error));
        onPass(m); if (m.pass === "fine") res(m);
      };
      wk.postMessage({ cmd: "run", gid: g.gid, rid: rid, o: o, coarse: coarse });
    });
  }
  function engineLos(g, a, b, o) {
    return new Promise(function (res, rej) {
      function page() { onPage().then(function (VS) { try { res(VS.los(g, a, b, o)); } catch (e) { rej(e); } }, rej); }
      if (!worker()) return page();
      engineGrid(g);
      var rid = ++RID;
      PEND[rid] = function (m) { if (m.error === "worker" || m.error === "stale") return page(); if (m.error) return rej(new Error(m.error)); res(m.los); };
      wk.postMessage({ cmd: "los", gid: g.gid, rid: rid, a: a, b: b, o: o });
    });
  }
  /* abandon a run that is no longer wanted: a busy worker is replaced, so a big sum never holds up the next */
  function engineCancel() {
    if (!Object.keys(PEND).length) return;
    PEND = {}; if (wk) { wk.terminate(); wk = null; wkGid = 0; }
  }

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
      if (!bl) return;
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
    lay.clearLayers(); losLay.clearLayers(); img = null; hzLine = null; obsMark = null; ring = null;
    if (imgUrl) { URL.revokeObjectURL(imgUrl); imgUrl = null; }
    map.closePopup();
  }

  /* ---------- the panel ---------- */
  var ST = { obs: null, busy: "", err: "", res: null, grid: null, pass: "", arm: false, at: 0, los: null, losTo: null, warn: "" };
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
  function render() {
    var c = ensure().firstElementChild, o = ST.obs, r = ST.res && ST.res.res, g = ST.grid;
    var h = '<div class="chead"><h2 id="terrain-h">Terrain viewshed <span class="tag" tabindex="0" title="Worked out on this device from open elevation data by fixed rules. Not AI, not a survey and not analyst-approved.">Terrain only</span></h2>' +
      (W.OSAP_SPLIT ? W.OSAP_SPLIT.btn() : "") + '<button type="button" class="x" data-ts="close" aria-label="Close terrain analysis">Close</button></div>';
    h += '<div class="tsg"><span>Observer</span><div class="tsr">' + (o ? '<span class="pt">' + esc(o[0].toFixed(5) + ", " + o[1].toFixed(5)) + "</span>" : "<i>not set</i>") +
      '<button type="button" data-ts="pick" aria-pressed="' + ST.arm + '">Pick on map</button><button type="button" data-ts="centre">Map centre</button></div>' +
      (o ? '<span></span><div class="pt" style="color:var(--muted,#555)">' + esc(gridRef(o[0], o[1])) + "</div>" : "") +
      '<span>Observer height</span><div class="tsr tsh"><input type="number" id="ts-oh" min="0" max="1000" step="0.1" value="' + S.obsH + '" aria-label="Observer height in metres above the ground"> m ' + presetSel("ts-op", S.obsP) + "</div>" +
      '<span>Target height</span><div class="tsr tsh"><input type="number" id="ts-th" min="0" max="1000" step="0.1" value="' + S.tgtH + '" aria-label="Target height in metres above the ground"> m ' + presetSel("ts-tp", S.tgtP) + "</div>" +
      '<span>Maximum range</span><div class="tsr"><select id="ts-km" aria-label="Maximum range">' + RANGES.map(function (k) { return '<option value="' + k + '"' + (k === S.km ? " selected" : "") + ">" + k + " km</option>"; }).join("") + "</select></div>" +
      '<span>Resolution</span><div class="seg" role="group" aria-label="Resolution">' + Object.keys(RES).map(function (k) { return '<button type="button" data-res="' + k + '" aria-pressed="' + (S.res === k) + '" title="' + esc(RES[k][2]) + '">' + esc(RES[k][1]) + "</button>"; }).join("") + "</div>" +
      '<span>Terrain source</span><div>OSAP DEM <span class="tag" title="Elevation tiles: Terrain Tiles on AWS (mostly SRTM, about 30 m) everywhere, GSI Japan 5 to 10 m in Japan">elevation model, not buildings</span></div></div>' +
      '<div class="chk"><label><input type="checkbox" id="ts-curv"' + (S.curv ? " checked" : "") + "> Account for Earth curvature</label>" +
      '<label><input type="checkbox" id="ts-refr"' + (S.refr ? " checked" : "") + "> Atmospheric refraction</label>" +
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
      h += '<div class="key"><b>Terrain visibility</b><label><span style="background:rgba(' + C_VIS.slice(0, 3) + ',.7)"></span>Visible terrain</label><label><span style="background:rgba(' + C_MASK.slice(0, 3) + ',.7)"></span>Terrain-masked</label>' +
        '<label><span style="background:repeating-linear-gradient(45deg,#464646 0 2px,#bbb 2px 6px)"></span>Unknown: no elevation data</label>' + (S.hz ? '<label><span style="background:#ffd600;border-color:#111"></span>Horizon</label>' : "") + "</div>";
      if (g.coverage_pct < 99.5) h += '<div class="warn"><b>VIEWSHED DATA WARNING</b><br>Terrain coverage: ' + Math.floor(g.coverage_pct) + "%. Areas without elevation data are shown as UNKNOWN, not as hidden." + (g.failedTiles ? " " + g.failedTiles + " of " + g.tiles + " elevation tiles did not load: press Calculate to try again." : "") + "</div>";
      h += '<p style="margin:4px 0">Tap any point inside the result for the line of sight to it.</p>';
      if (ST.los) h += losCard(ST.los, true);
      h += assumptions(r, g);
    } else if (!ST.busy && !ST.err) h += '<p class="msg">Pick the observer on the map, set the heights and range, then Calculate. The result shows which ground the terrain lets the observer see.</p>';
    c.innerHTML = h;
    el.hidden = false;
  }
  function assumptions(r, g) {
    var st = r.stats, src = (g.sources || []).map(function (s) { return s.label; }).join("; ") || "none loaded";
    var curv = ST.ran.curvature ? "on" + (ST.ran.k ? ", with atmospheric refraction (k = " + ST.ran.k + ")" : ", no refraction") : "off";
    return '<div class="asm"><p class="nm">TERRAIN VIEWSHED ' + (ST.pass === "coarse" ? '<span class="tag">rough first pass, refining…</span>' : "") + "</p>" +
      "<p><b>Visible terrain:</b> " + st.visible_pct.toFixed(0) + "% · <b>Terrain-masked:</b> " + (100 - st.visible_pct - st.unknown_pct).toFixed(0) + "% · <b>Unknown:</b> " + st.unknown_pct.toFixed(0) + "% of the ground within " + S.km + " km</p>" +
      "<p><b>Observer:</b> " + mm(r.Zg) + " ground + " + ST.ran.obsH + " m = " + Math.round(r.Z0 * 10) / 10 + " m · <b>Target height:</b> " + ST.ran.tgtH + " m above the ground</p>" +
      "<p><b>Urban/vegetation obstruction:</b> NOT MODELED. The elevation is a terrain model, not a model of buildings or trees: walls, single trees and most buildings are not in it, while SRTM (most of the world outside Japan and the US) partly carries dense forest canopy and big city blocks, so city and jungle results are rough.</p>" +
      "<p><b>Elevation:</b> " + esc(src) + ", tile zoom " + g.z + " · <b>Grid:</b> " + g.res + " m · <b>Coverage:</b> " + (g.coverage_pct >= 99.95 ? "complete" : g.coverage_pct.toFixed(1) + "%") + "</p>" +
      "<p><b>Earth curvature:</b> " + curv + " · Sea deeper than 40 m is read as sea level</p>" +
      "<p><b>Calculated locally</b> on this device " + esc(T().dualT(ST.when, { date: true })) + (navigator.onLine === false ? " · offline, from elevation already on this device" : "") + "</p></div>";
  }
  function losCard(x, inPanel) {
    var h = '<div class="' + (inPanel ? "losc " : "") + 'vslos"' + (inPanel ? "" : " data-keep-pop") + '><div class="h">LINE OF SIGHT</div><p>Observer → Selected point <span class="pt">' + esc(gridRef(x.to[0], x.to[1])) + "</span></p>" +
      "<p>Distance: <b>" + km(x.dist) + "</b></p><p>Observer elevation: <b>" + mm(x.zA) + "</b> + " + x.hA + " m</p><p>Target elevation: <b>" + mm(x.zB) + "</b> + " + x.hB + " m</p>" +
      "<p>Maximum intervening terrain: <b>" + mm(x.maxZ) + "</b>" + (x.maxD === x.maxD ? " at " + km(x.maxD) : "") + "</p>" +
      '<p>Terrain LOS: <span class="v ' + x.los + '">' + (x.los === "CLEAR" ? "VISIBLE" : x.los) + "</span></p>" +
      (x.los === "BLOCKED" ? "<p>Blocking terrain: <b>" + km(x.blockD) + "</b> from observer</p>" : "") +
      (x.los === "UNKNOWN" ? "<p>Part of the line has no elevation data.</p>" : "") +
      "<p>Urban/vegetation obstruction: NOT MODELED</p>";
    if (inPanel && S.prof) h += profileSvg(x);
    else if (!inPanel) h += '<button type="button" data-vsprof>' + (S.prof ? "Profile in the panel" : "Show profile") + "</button>";
    return h + "</div>";
  }
  /* the terrain profile under the line: terrain, the line of sight, observer, target, highest ground, where it is blocked */
  function profileSvg(x) {
    var s = x.samples, WD = 340, HT = 150, P = { l: 40, r: 8, t: 10, b: 24 }, D0 = x.dist || 1;
    var ys = s.filter(function (p) { return !p.nodata; }).map(function (p) { return p.z - x.drop(p.d); }).concat([x.ZA, x.ZBeff]);
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
    var blk = x.los === "BLOCKED" ? (function () { var zz = interpZ(s, x.blockD); return '<path d="M' + (X(x.blockD) - 4) + "," + (Y(zz - x.drop(x.blockD)) - 4) + "l8,8m0,-8l-8,8" + '" stroke="#c62828" stroke-width="2.2"/>'; })() : "";
    var mx = x.maxD === x.maxD ? '<path d="M' + X(x.maxD) + "," + (Y(x.maxZ - x.drop(x.maxD)) - 9) + 'l-4,-6h8z" fill="#5d4037"/><text x="' + X(x.maxD) + '" y="' + (Y(x.maxZ - x.drop(x.maxD)) - 17) + '" text-anchor="middle">' + Math.round(x.maxZ) + " m</text>" : "";
    return '<svg class="prof" viewBox="0 0 ' + WD + " " + HT + '" role="img" aria-label="Terrain profile from observer to the selected point" font-size="9" fill="currentColor">' +
      '<path d="' + area + '" fill="#a1887f" fill-opacity=".35" stroke="none"/><path d="' + path + '" fill="none" stroke="#5d4037" stroke-width="1.4"/>' +
      '<line x1="' + X(0) + '" y1="' + Y(x.ZA) + '" x2="' + X(D0) + '" y2="' + Y(x.ZBeff) + '" stroke="' + col + '" stroke-width="1.6" stroke-dasharray="5 3"/>' +
      '<circle cx="' + X(0) + '" cy="' + Y(x.ZA) + '" r="4" fill="#0b7285" stroke="#fff"/><circle cx="' + X(D0) + '" cy="' + Y(x.ZBeff) + '" r="4" fill="' + col + '" stroke="#fff"/>' + blk + mx +
      '<line x1="' + P.l + '" x2="' + (WD - P.r) + '" y1="' + (HT - P.b) + '" y2="' + (HT - P.b) + '" stroke="currentColor" stroke-opacity=".5"/>' + ticks + yt +
      '<text x="' + (WD - P.r) + '" y="' + (HT - 8) + '" text-anchor="end" dy="-10">km</text><text x="2" y="' + (P.t + 2) + '">m MSL</text></svg>' +
      '<p style="font-size:11.5px;color:var(--muted,#555);margin:2px 0">Brown: terrain' + (x.curv ? " (lowered for Earth curvature)" : "") + ". Dashed: line of sight. ▼ highest ground" + (x.los === "BLOCKED" ? "; ✕ first terrain above the line" : "") + ".</p>";
  }
  function niceStep(v) { var p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1e-6)))), f = v / p; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p; }
  function interpZ(s, d) { for (var i = 1; i < s.length; i++) if (s[i].d >= d) { var a = s[i - 1], b = s[i], t = (d - a.d) / ((b.d - a.d) || 1); return a.z + (b.z - a.z) * t; } return s[s.length - 1].z; }

  function setObs(lat, lon) { ST.obs = [lat, L.Util.wrapNum(lon, [-180, 180], true)]; ST.err = ""; ST.los = null; losLay.clearLayers(); drawObserver(); }
  function onClick(e) {
    var b = e.target.closest("[data-ts]"), rb = e.target.closest("[data-res]");
    if (rb) { S.res = rb.getAttribute("data-res"); keep(); render(); auto(true); return; }
    if (!b) return;
    var a = b.getAttribute("data-ts");
    if (a === "close") close();
    else if (a === "pick") { if (ST.arm) { pickEnd(); render(); } else pickStart(); }
    else if (a === "centre") { var c = map.getCenter(); pickEnd(); setObs(c.lat, c.lng); render(); calc(); }
    else if (a === "calc") calc();
    else if (a === "cancel") { RUN++; if (ac) ac.abort(); engineCancel(); ST.busy = ""; ST.err = "Stopped."; render(); }
    else if (a === "clear") { RUN++; if (ac) ac.abort(); engineCancel(); ST.res = null; ST.grid = null; ST.obs = null; ST.busy = ""; ST.err = ""; ST.los = null; clearMap(); render(); }
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
  function auto() { if (ST.res && ST.obs) calc(); }

  function pickStart() {
    ST.arm = true; map.getContainer().style.cursor = "crosshair";
    /* full window covers the map: step out of the way until the point is picked */
    if (!split() && el) el.hidden = true;
    hint("Tap the map where the observer stands.");
    setTimeout(function () { map.once("click", onPick); }, 0);
    if (el && !el.hidden) render();
  }
  function pickEnd() { ST.arm = false; map.getContainer().style.cursor = ""; map.off("click", onPick); hint(""); }
  function onPick(e) { pickEnd(); setObs(e.latlng.lat, e.latlng.lng); render(); calc(); }
  var hintEl = null;
  function hint(t) {
    if (!t) { if (hintEl) hintEl.hidden = true; return; }
    if (!hintEl) { hintEl = D.createElement("div"); hintEl.style.cssText = "position:absolute;left:50%;top:10px;transform:translateX(-50%);z-index:1000;background:#0b7285;color:#fff;padding:6px 12px;border-radius:16px;font-size:13px;box-shadow:0 1px 4px rgba(0,0,0,.4);pointer-events:none"; map.getContainer().appendChild(hintEl); }
    hintEl.textContent = t; hintEl.hidden = false;
  }

  /* ---------- calculate ---------- */
  function calc() {
    if (!ST.obs) return;
    var run = ++RUN; if (ac) ac.abort(); engineCancel();
    ac = W.AbortController ? new AbortController() : null;
    var R = S.km * 1000, res = effRes(R, RES[S.res][0]), o = opts({ observer_height_m: S.obsH, target_height_m: S.tgtH, radius_m: R, curvature: S.curv, refraction: S.refr });
    ST.busy = "Loading elevation…"; ST.err = ""; ST.at = 0; ST.los = null; losLay.clearLayers(); map.closePopup(); render();
    getGrid(ST.obs[0], ST.obs[1], R, res, { signal: ac && ac.signal, prog: function (d, n) { if (run !== RUN) return; ST.at = d / n * 0.6; ST.busy = "Loading elevation " + d + " of " + n + " tiles…"; render(); } }).then(function (g) {
      if (run !== RUN) return;
      if (!g.sources.length) throw new Error(navigator.onLine === false ? "No elevation for this place on this device, and no connection to download it." : "The elevation tiles did not load. Check the connection and try again.");
      ST.busy = "Calculating the viewshed…"; ST.at = 0.7; render();
      var f = res < 90 && g.n > 401 ? Math.round(90 / res) : 0;
      return engineRun(g, o, f, function (m) {
        if (run !== RUN) return;
        ST.res = m; ST.grid = g; ST.pass = m.pass; ST.when = Date.now(); ST.ran = o;
        paint(m.res, m.n, m.f, g); drawMarks(m.res, m.n, m.f, g); drawObserver();
        if (m.pass === "fine") { ST.busy = ""; ST.at = 1; } else { ST.busy = "Refining to " + res + " m…"; ST.at = 0.85; }
        render();
      });
    }).catch(function (e) {
      if (run !== RUN) return;
      ST.busy = ""; ST.err = e && e.name === "AbortError" ? "Stopped." : (e && e.message) || "The viewshed could not be calculated.";
      render();
    });
  }

  /* ---------- tap inside the result: line of sight to that point ---------- */
  function measuring() { var b = D.getElementById("meas-btn"); return !!(b && b.getAttribute("aria-pressed") === "true"); }
  map.on("click", function (e) {
    if (ST.arm || !ST.res || !ST.obs || !ST.grid || measuring()) return;
    var p = [e.latlng.lat, L.Util.wrapNum(e.latlng.lng, [-180, 180], true)];
    if (hav(ST.obs, p) > S.km * 1000) return;
    losTo(p).catch(function () {});
  });
  function losTo(p) {
    var g = ST.grid, SRC = W.OSAP_TERRAIN_SRC, half = (g.n - 1) / 2, b = SRC.toCell(g.spec, p[0], p[1]), o = ST.ran;
    return engineLos(g, [half, half], b, { hA: o.obsH, hB: o.tgtH, curvature: o.curvature, k: o.k }).then(function (x) {
      x = decorate(x, ST.obs, p, o.obsH, o.tgtH, o);
      ST.los = x; drawLos(x, true);
      if (el && !el.hidden) render();
      return x;
    });
  }
  function decorate(x, a, b, hA, hB, o) {
    x.from = a; x.to = b; x.hA = hA; x.hB = hB; x.curv = !!o.curvature;
    x.drop = function (d) { return o.curvature ? d * d / (2 * R_EARTH) * (1 - (o.k || 0)) : 0; };
    x.ZBeff = x.zB + hB - x.drop(x.dist);
    return x;
  }
  function drawLos(x, popup) {
    losLay.clearLayers();
    var col = x.los === "BLOCKED" ? "#c62828" : x.los === "CLEAR" ? "#2e7d32" : "#616161";
    losLay.addLayer(L.polyline([x.from, x.to], { pane: "vslines", color: "#fff", weight: 5, opacity: 0.8, interactive: false }));
    losLay.addLayer(L.polyline([x.from, x.to], { pane: "vslines", color: col, weight: 2.5, dashArray: x.los === "CLEAR" ? null : "6 4", interactive: false }));
    if (x.los === "BLOCKED" && x.dist) {
      var t = x.blockD / x.dist, bp = [x.from[0] + (x.to[0] - x.from[0]) * t, x.from[1] + (x.to[1] - x.from[1]) * t];
      losLay.addLayer(L.circleMarker(bp, { pane: "vslines", radius: 5, color: "#fff", weight: 2, fillColor: "#c62828", fillOpacity: 1, interactive: false }).bindTooltip("Blocking terrain " + km(x.blockD) + " from observer", { direction: "top" }));
    }
    if (popup) {
      var pad = split() && W.OSAP_SPLIT ? W.OSAP_SPLIT.clear() : { tl: [0, 0], br: [0, 0] };
      L.popup({ maxWidth: 290, autoPanPaddingTopLeft: L.point(pad.tl[0] + 8, pad.tl[1] + 8), autoPanPaddingBottomRight: L.point(pad.br[0] + 8, pad.br[1] + 8) }).setLatLng(x.to).setContent(losCard(x, false)).openOn(map);
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
    var h = '<div class="vsmenu" data-keep-pop><div class="h">Terrain</div><button type="button" data-vm="vs">Viewshed from here</button><button type="button" data-vm="el">Elevation here</button>' +
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
    else if (k === "el") {
      var out = box.querySelector(".el"); out.textContent = "Looking up…";
      elevationAt(P[0], P[1]).then(function (r) {
        out.innerHTML = r.nodata ? (r.failed ? "The elevation did not load. Check the connection." : "No elevation data here.") : "<b>" + Math.round(r.elev_m) + " m MSL</b> ground elevation<br><span style=\"font-size:11.5px\">" + esc(r.sources.map(function (s) { return s.label; }).join("; ")) + ", about " + Math.round(r.res_m) + " m pixels. Terrain model, not a survey.</span>";
      }, function (e2) { out.textContent = (e2 && e2.message) || "The elevation did not load."; });
    } else if (k.charAt(0) === "x") { map.closePopup(MENU.pop); var t = MENU.extra[+k.slice(1)]; try { t.run(L.latLng(P[0], P[1])); } catch (x) {} }
  });
  function ensureCss() { if (!D.getElementById("terrain-css")) { var st = D.createElement("style"); st.id = "terrain-css"; st.textContent = CSS; D.head.appendChild(st); } }

  /* ---------- open, close, API ---------- */
  function open() { ensure(); drawObserver(); render(); }
  function close() { pickEnd(); RUN++; if (ac) ac.abort(); engineCancel(); ST.busy = ""; if (el) el.hidden = true; }
  function isOpen() { return !!el && !el.hidden; }
  function viewshedAt(P) { open(); pickEnd(); setObs(P[0], P[1]); render(); calc(); }
  /* the ground height at one point: { elev_m, nodata, res_m, sources } */
  function elevationAt(lat, lon) { return need().then(function (SRC) { return SRC.elevationAt(lat, L.Util.wrapNum(lon, [-180, 180], true)); }); }
  /* the ground along a line: { total_m, samples: [{ dist_m, elev_m, nodata }], res_m, sources }. opt: { res_m } */
  function profile(a, b, opt) {
    opt = opt || {};
    var A = [+a[0], +a[1]], B = [+b[0], +b[1]], D0 = hav(A, B), res = Math.max(+opt.res_m || 30, Math.ceil(D0 / 4000));
    return need().then(function (SRC) {
      var s = SRC.box([Math.min(A[0], B[0]), Math.min(A[1], B[1]), Math.max(A[0], B[0]), Math.max(A[1], B[1])], res);
      return SRC.grid(s, { signal: opt.signal }).then(function (r) {
        var g = { E: r.E, n: s.w, rowM: r.rowM };
        if (s.w !== s.h) { /* the engine's grids are square: pad the short side with no data */
          var n = Math.max(s.w, s.h), E = new Float32Array(n * n), rowM = new Float32Array(n); E.fill(NaN);
          for (var j = 0; j < s.h; j++) { E.set(r.E.subarray(j * s.w, (j + 1) * s.w), j * n); rowM[j] = r.rowM[j]; }
          for (j = s.h; j < n; j++) rowM[j] = r.rowM[s.h - 1];
          g = { E: E, n: n, rowM: rowM };
        }
        return onPage().then(function (VS) {
          var x = VS.los(g, SRC.toCell(s, A[0], A[1]), SRC.toCell(s, B[0], B[1]), { hA: num(opt.hA, 0), hB: num(opt.hB, 0), curvature: !!opt.curvature, k: opt.k || 0 });
          return { total_m: x.dist, samples: x.samples.map(function (p) { return { dist_m: p.d, elev_m: p.nodata ? null : p.z, nodata: p.nodata }; }), los: x.los, block_m: x.los === "BLOCKED" ? x.blockD : null,
            max_elev_m: x.maxZ === x.maxZ ? x.maxZ : null, max_at_m: x.maxD === x.maxD ? x.maxD : null, res_m: res, coverage_pct: r.coverage_pct, sources: r.sources, version: VERSION };
        });
      });
    });
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
        return engineRun(g, q, 0, function () {}).then(function (m) {
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
    version: VERSION, open: open, close: close, isOpen: isOpen, menu: menu, viewshedAt: viewshedAt,
    elevationAt: elevationAt, profile: profile, viewshed: viewshed, losTo: function (p) { return ST.res ? losTo(p) : Promise.reject(new Error("no viewshed")); },
    state: function () { return { obs: ST.obs, busy: ST.busy, err: ST.err, pass: ST.pass, stats: ST.res && ST.res.res.stats, grid: ST.grid && { n: ST.grid.n, res: ST.grid.res, z: ST.grid.z, coverage_pct: ST.grid.coverage_pct, sources: ST.grid.sources }, los: ST.los, marks: lay.getLayers().length + losLay.getLayers().length, settings: Object.assign({}, S) }; }
  };
})();
