/* AXIOM OSAP · Skyline match (Shane 2026-11-20, "Do all of that"): where could this photo have been taken, from the shape of
   the hills on its horizon. Opened from Photo and video check ("Skyline match", for a photo or a video frame).
   - The analyst traces the skyline on the photo (taps along the ridge line, left to right in any order) and sets the camera's
     horizontal field of view (a phone's main camera is about 65 to 70 degrees) and the eye height.
   - OSAP searches the ground the map shows (a square up to 20 km across around its middle). For each spot on a grid it works out
     the terrain skyline all the way round (the highest ground angle in every direction, out to 25 km, with the earth's curve
     and normal refraction), slides the traced skyline round to the best facing direction, and scores the fit as the average
     difference in degrees after removing the camera's tilt. The best spots are searched again on a finer grid.
   - Results are PROPOSALS (rules "skyline-v1"): the best few spots at least 1.5 km apart, each with its grid, facing direction
     and fit, drawn on the map with the camera's view wedge, and the photo's skyline over the terrain's. A plain-words line says
     whether one spot fits clearly better than the rest of the area or several fit about as well, or that the traced skyline is
     too flat to match. Never a confirmation: terrain shape only, from a 30 m elevation model; buildings, trees and haze are not
     in it. Check a proposal against other evidence (Sun and shadow, landmarks, imagery).
   - Provenance: the result names the photo's SHA-256 (from Photo and video check), every input, the elevation source and zoom,
     the rules version and the time; "Copy the result" copies that record. Nothing is stored or sent; the photo stays in this
     browser. Elevation: Mapterhorn tiles through window.OSAP_LIDAR.dem (Copernicus GLO-30 and national models).
   API: window.OSAP_SKYLINE { open({ url, name, sha }), close(), isOpen(), setPoints([[x, y] 0..1]), run(), result(), _t: pure helpers } */
(function () {
  "use strict";
  var RAD = Math.PI / 180, RE = 6371008.8, K_REFR = 0.13;
  var RULES = "skyline-v1";

  /* ---------- pure helpers (tests/skyline.test.mjs) ---------- */
  /* the traced skyline as elevation angles, one a degree across the photo. pts: [[x, y]] with x, y from 0 to 1 (top left 0, 0);
     aspect: photo height / width; fov: horizontal field of view in degrees. Returns { n, vals } (vals[k] for the direction
     k degrees right of the photo's left edge) or null when fewer than 3 points or they span less than 5 degrees. */
  function photoProfile(pts, aspect, fov) {
    if (!Array.isArray(pts) || !(fov > 5 && fov < 179) || !(aspect > 0)) return null;
    var f = 0.5 / Math.tan(fov / 2 * RAD), P = [];
    pts.forEach(function (p) {
      if (!Array.isArray(p) || !isFinite(p[0]) || !isFinite(p[1])) return;
      var x = p[0] - 0.5, y = (0.5 - p[1]) * aspect;
      P.push([fov / 2 + Math.atan2(x, f) / RAD, Math.atan2(y, Math.sqrt(f * f + x * x)) / RAD]);
    });
    P.sort(function (a, b) { return a[0] - b[0]; });
    if (P.length < 3 || P[P.length - 1][0] - P[0][0] < 5) return null;
    var a0 = Math.ceil(P[0][0] - 1e-9), a1 = Math.floor(P[P.length - 1][0] + 1e-9), vals = [], j = 0;
    for (var a = a0; a <= a1; a++) {
      while (j < P.length - 2 && P[j + 1][0] < a) j++;
      var p = P[j], q = P[j + 1], t = q[0] === p[0] ? 0 : (a - p[0]) / (q[0] - p[0]);
      vals.push(p[1] + (q[1] - p[1]) * Math.max(0, Math.min(1, t)));
    }
    return { a0: a0, n: vals.length, vals: vals };
  }
  function spread(v) { var m = 0, s = 0; v.forEach(function (x) { m += x; }); m /= v.length; v.forEach(function (x) { s += (x - m) * (x - m); }); return Math.sqrt(s / v.length); }
  /* the terrain skyline from one spot: Float32Array(360), the highest angle (degrees) seen in each whole-degree direction.
     elev(lat, lon) -> metres or NaN; eye: metres above the ground; maxKm: how far to look */
  function horizon(elev, lat, lon, eye, maxKm) {
    var out = new Float32Array(360), g = elev(lat, lon); if (!isFinite(g)) return null;
    var h0 = g + (eye || 1.7), cl = Math.cos(lat * RAD), maxD = (maxKm || 25) * 1000, ds = [];
    for (var d = 60; d <= maxD; d *= 1.045) ds.push(d < 200 ? d : d);
    for (var a = 0; a < 360; a++) {
      var sa = Math.sin(a * RAD), ca = Math.cos(a * RAD), best = -90;
      for (var i = 0; i < ds.length; i++) {
        var D = ds[i], la = lat + (D * ca) / 111195, lo = lon + (D * sa) / (111195 * cl), z = elev(la, lo);
        if (!isFinite(z)) continue;
        var drop = (D * D) / (2 * RE) * (1 - K_REFR), ang = Math.atan2(z - drop - h0, D) / RAD;
        if (ang > best) best = ang;
      }
      out[a] = best;
    }
    return out;
  }
  /* the best facing direction for a traced skyline on a terrain skyline: the heading of the photo's centre, the fit (root mean
     square difference in degrees after the tilt, the mean difference, is removed) and the tilt */
  function match(prof, sky, fov) {
    var n = prof.n, v = prof.vals, best = { rms: Infinity, heading: 0, tilt: 0 };
    for (var h = 0; h < 360; h++) {
      var left = h - fov / 2 + prof.a0, s = 0, s2 = 0;
      for (var k = 0; k < n; k++) { var d = v[k] - sky[(((Math.round(left + k)) % 360) + 360) % 360]; s += d; s2 += d * d; }
      var mean = s / n, rms = Math.sqrt(Math.max(0, s2 / n - mean * mean));
      if (rms < best.rms) best = { rms: rms, heading: h, tilt: mean };
    }
    return best;
  }
  /* search spots: a square grid with `stepM` spacing over bb [w, s, e, n] */
  function grid(bb, stepM) {
    var out = [], la0 = bb[1], la1 = bb[3], dLa = stepM / 111195;
    for (var la = la0 + dLa / 2; la < la1; la += dLa) {
      var dLo = stepM / (111195 * Math.cos(la * RAD));
      for (var lo = bb[0] + dLo / 2; lo < bb[2]; lo += dLo) out.push([Math.round(la * 1e5) / 1e5, Math.round(lo * 1e5) / 1e5]);
    }
    return out;
  }
  function km(a, b) { var x = (b[1] - a[1]) * Math.cos((a[0] + b[0]) / 2 * RAD), y = b[0] - a[0]; return Math.sqrt(x * x + y * y) * 111.195; }
  /* the best results at least sepKm apart, best first */
  function distinct(res, sepKm, n) {
    var out = [];
    res.slice().sort(function (a, b) { return a.rms - b.rms; }).forEach(function (r) {
      if (out.length < n && out.every(function (o) { return km(o.ll, r.ll) >= sepKm; })) out.push(r);
    });
    return out;
  }
  /* the plain-words reading (rules skyline-v1) */
  function verdict(prof, top) {
    if (!prof || !top.length) return { k: "none", text: "No spot in the search area could be scored." };
    if (spread(prof.vals) < 0.4) return { k: "flat", text: "The traced skyline is too flat to match: it rises and falls by less than about half a degree. Trace a skyline with clear hills or peaks." };
    var b = top[0], c = top[1];
    /* "clear" needs a margin bigger than tracing and elevation error (about 0.3 degrees), not just a ratio */
    if (b.rms <= 0.6 && (!c || c.rms >= Math.max(b.rms * 1.5, b.rms + 0.3))) return { k: "clear", text: "One spot fits clearly better than anywhere else searched (" + b.rms.toFixed(2) + "° average difference" + (c ? ", next best " + c.rms.toFixed(2) + "°" : "") + "). Likely the area the photo was taken from, if it was taken inside the search area." };
    if (b.rms <= 1.2) return { k: "several", text: "Several spots fit about as well (" + top.map(function (r) { return r.rms.toFixed(2) + "°"; }).join(", ") + "). The terrain alone cannot tell them apart." };
    return { k: "poor", text: "No spot fits well (best " + b.rms.toFixed(2) + "° average difference). The photo may be from outside the search area, the field of view may be off, or buildings or trees hide the true skyline." };
  }
  function bboxAround(lat, lon, km0) {
    var h = km0 / 2, dLa = h / 111.195, dLo = h / (111.195 * Math.cos(lat * RAD));
    return [lon - dLo, lat - dLa, lon + dLo, lat + dLa];
  }
  var T = { photoProfile: photoProfile, horizon: horizon, match: match, grid: grid, distinct: distinct, verdict: verdict, spread: spread, km: km, bboxAround: bboxAround, RULES: RULES };
  if (typeof module === "object" && module.exports) module.exports = T;
  if (typeof window === "undefined") return;

  /* ---------- browser ---------- */
  var W = window, D = document, Lf = W.L, map = W.__asapMap;
  if (!Lf || !map || W.OSAP_SKYLINE || /[?&]watchscan=1(&|$)/.test(location.search)) return;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var KEY = "osap-skyline", Z = 11, TILE = 256, MAX_VIEW_KM = 25;
  var P = { fov: 66, eye: 1.7, area: 10 };
  try { var v0 = JSON.parse(localStorage.getItem(KEY) || "null"); if (v0) { if (v0.fov >= 10 && v0.fov <= 150) P.fov = +v0.fov; if (v0.eye >= 0 && v0.eye <= 500) P.eye = +v0.eye; if ([5, 10, 20].indexOf(v0.area) >= 0) P.area = v0.area; } } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) {} }
  var S = { photo: null, pts: [], aspect: 0.75, busy: false, prog: 0, res: null, sel: 0, err: "", run: 0 };
  var el = null, lay = Lf.layerGroup(), img = null;

  /* the elevation mosaic: Mapterhorn tiles at zoom Z over the box, sampled bilinearly */
  function mosaic(bb, sig) {
    var n = Math.pow(2, Z);
    function tx(lon) { return (lon + 180) / 360 * n; }
    function ty(lat) { var r = lat * RAD; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n; }
    var x0 = Math.floor(tx(bb[0])), x1 = Math.floor(tx(bb[2])), y0 = Math.floor(ty(bb[3])), y1 = Math.floor(ty(bb[1]));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64) return Promise.reject(new Error("search area too big"));
    var tiles = {}, jobs = [];
    for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) (function (x, y) {
      jobs.push(W.OSAP_LIDAR.dem(Z, x, y, sig, TILE).then(function (t) { if (t && t.h) tiles[x + "/" + y] = t.h; }));
    })(x, y);
    return Promise.all(jobs).then(function () {
      if (!Object.keys(tiles).length) throw new Error("no elevation data answered");
      return function (lat, lon) {
        var fx = tx(lon) * TILE - 0.5, fy = ty(lat) * TILE - 0.5, ix = Math.floor(fx), iy = Math.floor(fy), ax = fx - ix, ay = fy - iy;
        function at(px, py) { var t = tiles[Math.floor(px / TILE) + "/" + Math.floor(py / TILE)]; if (!t) return NaN; return t[(py % TILE) * TILE + (px % TILE)]; }
        var a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
        return (a * (1 - ax) + b * ax) * (1 - ay) + (c * (1 - ax) + d * ax) * ay;
      };
    });
  }

  function run() {
    var prof = photoProfile(S.pts, S.aspect, P.fov);
    if (!prof) { S.err = "Trace the skyline first: at least 3 taps along the ridge line, across at least 5 degrees of the photo."; paint(); return Promise.resolve(null); }
    if (!W.OSAP_LIDAR || !W.OSAP_LIDAR.dem) { S.err = "The elevation tools are not loaded."; paint(); return Promise.resolve(null); }
    var c = map.getCenter(), bb = bboxAround(c.lat, c.lng, P.area), mar = (MAX_VIEW_KM + 1) / 111.195;
    var big = [bb[0] - mar / Math.cos(c.lat * RAD), bb[1] - mar, bb[2] + mar / Math.cos(c.lat * RAD), bb[3] + mar];
    var run0 = ++S.run, ac = typeof AbortController === "function" ? new AbortController() : null;
    S.ac = ac; S.busy = true; S.err = ""; S.res = null; S.prog = 0; lay.clearLayers(); paint();
    var t0 = Date.now(), step1 = P.area <= 5 ? 250 : P.area <= 10 ? 400 : 700, inputs = { fov: P.fov, eye: P.eye, areaKm: P.area, centre: [+c.lat.toFixed(5), +c.lng.toFixed(5)], points: S.pts.length };
    return mosaic(big, ac && ac.signal).then(function (elev) {
      var spots = grid(bb, step1), out = [], i = 0;
      function score(ll) { var sky = horizon(elev, ll[0], ll[1], P.eye, MAX_VIEW_KM); if (!sky) return null; var m = match(prof, sky, P.fov); return { ll: ll, rms: m.rms, heading: m.heading, tilt: m.tilt, sky: sky }; }
      return new Promise(function (ok, no) {
        (function chunk() {
          if (run0 !== S.run) return no(new Error("stopped"));
          var until = Date.now() + 40;
          while (i < spots.length && Date.now() < until) { var r = score(spots[i++]); if (r) { r.sky = null; out.push(r); } }
          S.prog = i / spots.length * 0.8; paintProg();
          if (i < spots.length) return setTimeout(chunk, 0);
          /* finer passes: round the best 8 spots at a third of the step, then round the best 3 at a ninth */
          function around(list, st) { var o = []; list.forEach(function (b) { for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; o.push([b.ll[0] + dy * st / 111195, b.ll[1] + dx * st / (111195 * Math.cos(b.ll[0] * RAD))]); } }); return o; }
          var fine = around(distinct(out, step1 * 2 / 1000, 8), step1 / 3), j = 0, round2 = false;
          (function chunk2() {
            if (run0 !== S.run) return no(new Error("stopped"));
            var until2 = Date.now() + 40;
            while (j < fine.length && Date.now() < until2) { var r2 = score(fine[j++]); if (r2) { r2.sky = null; out.push(r2); } }
            S.prog = 0.8 + j / Math.max(1, fine.length) * 0.2; paintProg();
            if (j < fine.length) return setTimeout(chunk2, 0);
            if (!round2) { round2 = true; fine = around(distinct(out, step1 * 2 / 1000, 3), step1 / 9); j = 0; return setTimeout(chunk2, 0); }
            var top = distinct(out, 1.5, 5);
            top.forEach(function (t) { t.sky = horizon(elev, t.ll[0], t.ll[1], P.eye, MAX_VIEW_KM); t.mgrs = W.OSAP_GEO && W.OSAP_GEO.mgrs ? W.OSAP_GEO.mgrs(t.ll[0], t.ll[1], 4) : ""; });
            ok({ top: top, scored: out.length, prof: prof, verdict: verdict(prof, top), inputs: inputs, ms: Date.now() - t0, step: step1 });
          })();
        })();
      });
    }).then(function (r) {
      if (run0 !== S.run) return null;
      r.record = { rules: RULES, made: new Date().toISOString(), photo: { name: S.photo && S.photo.name || "", sha256: S.photo && S.photo.sha || "" }, inputs: r.inputs,
        elevation: "Mapterhorn tiles, zoom " + Z + " (about " + Math.round(156543 * Math.cos(r.inputs.centre[0] * RAD) / Math.pow(2, Z) * 10) / 10 + " m a pixel; Copernicus GLO-30 and national models)",
        searched: r.scored + " spots, " + r.step + " m grid, then " + Math.round(r.step / 3) + " m and " + Math.round(r.step / 9) + " m round the best", verdict: r.verdict.text,
        proposals: r.top.map(function (t) { return { lat: t.ll[0], lon: t.ll[1], mgrs: t.mgrs, facing_deg: t.heading, fit_deg: +t.rms.toFixed(3) }; }),
        status: "proposal, not verified" };
      S.res = r; S.sel = 0; S.busy = false; paint(); drawMap(); return r;
    }).catch(function (e) { if (run0 !== S.run) return null; S.busy = false; S.err = "Could not finish: " + (e && e.message || e); paint(); return null; });
  }

  function drawMap() {
    lay.clearLayers(); if (!map.hasLayer(lay)) lay.addTo(map);
    var r = S.res; if (!r) return;
    r.top.forEach(function (t, i) {
      var on = i === S.sel, col = on ? "#d9480f" : "#5c7cfa";
      if (W.OSAP_GEO && W.OSAP_GEO.dest) {
        var wedge = [t.ll];
        for (var q = -P.fov / 2; q <= P.fov / 2 + 0.01; q += P.fov / 8) wedge.push(W.OSAP_GEO.dest(t.ll, t.heading + q, 3000));
        if (wedge.every(function (w) { return w && isFinite(w[0]) && isFinite(w[1]); })) Lf.polygon(wedge, { color: col, weight: on ? 2 : 1, fillOpacity: on ? 0.18 : 0.06, dashArray: "4 4", interactive: false }).addTo(lay);
      }
      Lf.circleMarker(t.ll, { radius: on ? 9 : 7, color: "#fff", weight: 2, fillColor: col, fillOpacity: 0.95 })
        .bindTooltip("Proposal " + (i + 1) + ": skyline fit " + t.rms.toFixed(2) + "°, facing " + t.heading + "°", { direction: "top" })
        .on("click", function () { S.sel = i; paint(); drawMap(); }).addTo(lay);
    });
  }

  /* ---------- the window ---------- */
  var CSS = "#sky{position:fixed;inset:0;z-index:100000;overflow:auto;background:rgba(0,0,0,.45);padding:16px}" +
    "#sky .cbox{max-width:820px;margin:0 auto;background:var(--surface,#fff);color:var(--ink,#111);border-radius:8px;padding:10px 16px 16px;font-size:13px;line-height:1.45;box-shadow:0 6px 24px rgba(0,0,0,.3)}" +
    "#sky .chead{display:flex;align-items:center;gap:8px;position:sticky;top:-16px;background:var(--surface,#fff);padding:6px 0;z-index:1}#sky .chead h2{margin:0;font-size:16px;flex:1}" +
    "#sky button,#sky select,#sky input{font:inherit;font-size:13px;min-height:40px;border:1px solid var(--line,#bbb);background:var(--surface,#fff);color:inherit;border-radius:6px;padding:4px 10px}#sky button{cursor:pointer}" +
    "#sky button.pri{background:#0b7285;border-color:#0b7285;color:#fff;font-weight:700}#sky button[aria-pressed=true]{background:var(--accent-soft,#e3f2f4);border-color:var(--accent,#0b7285);font-weight:600}" +
    "#sky .row{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;margin:6px 0}#sky .mut{color:var(--muted,#555)}#sky .err{color:#b71c1c}#sky input[type=number]{width:5.5em}" +
    "#sky .pic{position:relative;max-width:100%;touch-action:manipulation;cursor:crosshair;user-select:none}#sky .pic img{display:block;max-width:100%;max-height:52vh}#sky .pic svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}" +
    "#sky .bar{height:8px;background:var(--line,#ddd);border-radius:4px;overflow:hidden}#sky .bar i{display:block;height:100%;background:#0b7285;width:0}" +
    "#sky table{width:100%;border-collapse:collapse;font-size:12.5px}#sky th,#sky td{text-align:left;padding:3px 4px;border-bottom:1px solid var(--line,#e3e3e3)}#sky tr.on td{background:var(--accent-soft,#e3f2f4)}" +
    "#sky .verd{border-left:4px solid #0b7285;padding:4px 8px;background:var(--surface2,#f4f7f8);margin:8px 0}#sky .tag{font-size:10.5px;border:1px solid var(--line,#bbb);border-radius:3px;padding:0 4px;white-space:nowrap}" +
    "#sky .note{font-size:11.5px;color:var(--muted,#555);border-top:1px solid var(--line,#ddd);margin-top:10px;padding-top:6px}#sky code{font-size:10.5px;word-break:break-all}" +
    "@media (max-width:700px){#sky{padding:6px}#sky button,#sky select,#sky input{font-size:16px}}";
  function ensure() {
    if (el) return el;
    if (!D.getElementById("sky-css")) { var st = D.createElement("style"); st.id = "sky-css"; st.textContent = CSS; D.head.appendChild(st); }
    el = D.createElement("div"); el.id = "sky"; el.hidden = true; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Skyline match");
    el.innerHTML = '<div class="cbox"></div>'; D.body.appendChild(el);
    el.addEventListener("click", function (e) {
      if (e.target === el) return close();
      var pic = e.target.closest && e.target.closest(".pic");
      if (pic && img) { var r = img.getBoundingClientRect(); if (r.width) { S.pts.push([Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))]); paintPts(); paintTrace(); } return; }
      var b = e.target.closest && e.target.closest("[data-sky]"); if (!b) return;
      var k = b.getAttribute("data-sky");
      if (k === "close") close(); else if (k === "undo") { S.pts.pop(); paintPts(); paintTrace(); } else if (k === "clear") { S.pts = []; paintPts(); paintTrace(); }
      else if (k === "run") run(); else if (k === "stop") { S.run++; if (S.ac) try { S.ac.abort(); } catch (x) {} S.busy = false; paint(); }
      else if (k === "copy") { var t = JSON.stringify(S.res && S.res.record, null, 2); try { navigator.clipboard.writeText(t).then(function () { b.textContent = "Copied"; }, function () {}); } catch (x) {} S.copied = t; }
      else if (/^sel:\d$/.test(k)) { S.sel = +k.slice(4); paint(); drawMap(); var t2 = S.res.top[S.sel]; if (t2) map.panTo(t2.ll); }
    });
    el.addEventListener("change", function (e) {
      var k = e.target.getAttribute("data-sky"), v = +e.target.value;
      if (k === "fov" && v >= 10 && v <= 150) P.fov = v; else if (k === "eye" && v >= 0 && v <= 500) P.eye = v; else if (k === "area" && [5, 10, 20].indexOf(v) >= 0) P.area = v; else return;
      save(); paintTrace();
    });
    if (W.OSAP_SPLIT) W.OSAP_SPLIT.add(el, ".chead");
    return el;
  }
  function open(o) {
    o = o || {}; ensure();
    if (o.url && (!S.photo || S.photo.url !== o.url)) { S.photo = { url: String(o.url), name: String(o.name || "photo").slice(0, 120), sha: /^[0-9a-f]{64}$/.test(o.sha || "") ? o.sha : "" }; S.pts = []; S.res = null; lay.clearLayers(); }
    el.hidden = false; paint(); return true;
  }
  function close() { if (!el) return; el.hidden = true; S.run++; if (S.ac) try { S.ac.abort(); } catch (e) {} S.busy = false; }
  function isOpen() { return !!(el && !el.hidden); }

  function paint() {
    if (!el) return;
    var r = S.res, h = '<div class="chead"><h2>Skyline match <span class="tag" title="Terrain shape only. Proposals, never a confirmation.">Proposals</span></h2>' + (W.OSAP_SPLIT ? W.OSAP_SPLIT.btn() : "") + '<button type="button" data-sky="close" aria-label="Close Skyline match">Close</button></div>';
    if (!S.photo) h += '<p class="mut">Open a photo in Photo and video check first, then choose Skyline match.</p>';
    else {
      h += '<p class="mut">1. Tap along the skyline in the photo (the line where the hills meet the sky), from one side to the other: 5 to 20 taps. 2. Set the field of view. 3. Move the map over the area to search and press Search.</p>' +
        '<div class="pic" role="img" aria-label="The photo: tap along the skyline"><img alt="' + esc(S.photo.name) + '" src="' + esc(S.photo.url) + '"><svg viewBox="0 0 1 1" preserveAspectRatio="none"></svg></div>' +
        '<div class="row"><span data-sky-n class="mut"></span><button type="button" data-sky="undo">Undo tap</button><button type="button" data-sky="clear">Clear</button></div>' +
        '<div class="row"><label>Field of view <input type="number" data-sky="fov" min="10" max="150" step="1" value="' + P.fov + '" aria-label="Horizontal field of view in degrees">°</label>' +
        '<label>Eye height <input type="number" data-sky="eye" min="0" max="500" step="0.1" value="' + P.eye + '" aria-label="Camera height above the ground in metres"> m</label>' +
        '<label>Search <select data-sky="area" aria-label="Search area">' + [5, 10, 20].map(function (v) { return '<option value="' + v + '"' + (v === P.area ? " selected" : "") + ">" + v + " × " + v + " km round the map's middle</option>"; }).join("") + "</select></label></div>" +
        '<p class="mut" style="font-size:12px">A phone\'s main camera sees about 65 to 70° across; 0.5× wide about 110°; 2× about 35°. A cropped or zoomed picture sees less.</p>' +
        '<div class="row">' + (S.busy ? '<button type="button" data-sky="stop">Stop</button><span class="mut">Searching…</span>' : '<button type="button" class="pri" data-sky="run">Search for this skyline</button>') + "</div>" +
        (S.busy ? '<div class="bar" role="progressbar" aria-label="Search progress"><i></i></div>' : "") + (S.err ? '<p class="err">' + esc(S.err) + "</p>" : "");
      if (r) {
        h += '<div class="verd" role="status"><b>' + esc(r.verdict.text) + "</b></div>";
        if (r.top.length) h += "<table><thead><tr><th>Proposal</th><th>Grid</th><th>Facing</th><th>Fit</th></tr></thead><tbody>" + r.top.map(function (t, i) {
          return "<tr" + (i === S.sel ? ' class="on"' : "") + '><td><button type="button" data-sky="sel:' + i + '" aria-pressed="' + (i === S.sel) + '">' + (i + 1) + "</button></td><td>" + esc(t.mgrs || t.ll.join(", ")) + '<br><span class="mut">' + t.ll[0].toFixed(5) + ", " + t.ll[1].toFixed(5) + "</span></td><td>" + t.heading + "° true</td><td>" + t.rms.toFixed(2) + "°</td></tr>";
        }).join("") + "</tbody></table>" + chart(r);
        h += '<div class="row"><button type="button" data-sky="copy">Copy the result</button><span class="mut">The record: photo SHA-256, inputs, elevation source, rules ' + RULES + ", time, proposals.</span></div>";
      }
      h += '<div class="note">Proposals from terrain shape only, never a confirmation. Elevation: Mapterhorn (Copernicus GLO-30 and national models) at about 30 to 75 m; buildings, trees, haze and the lens are not in it. ' +
        "The photo is assumed level (tilt is allowed for, roll is not). It searches only the area chosen; a photo from elsewhere gets a poor fit, not a wrong place. Check any proposal against other evidence: Sun and shadow, landmarks, imagery. " +
        "Photo " + esc(S.photo.name) + (S.photo.sha ? " · SHA-256 <code>" + esc(S.photo.sha) + "</code>" : "") + ". Nothing is stored or sent; the photo stays in this browser.</div>";
    }
    el.firstElementChild.innerHTML = h;
    img = el.querySelector(".pic img");
    if (img) { var fix = function () { if (img.naturalWidth) S.aspect = img.naturalHeight / img.naturalWidth; paintTrace(); }; if (img.complete) fix(); else img.addEventListener("load", fix); }
    paintPts(); paintProg();
  }
  function paintProg() { var i = el && el.querySelector(".bar i"); if (i) i.style.width = Math.round(S.prog * 100) + "%"; }
  function paintPts() { var n = el && el.querySelector("[data-sky-n]"); if (n) n.textContent = S.pts.length + " tap" + (S.pts.length === 1 ? "" : "s") + " on the skyline"; }
  function paintTrace() {
    var sv = el && el.querySelector(".pic svg"); if (!sv) return;
    var P2 = S.pts.slice().sort(function (a, b) { return a[0] - b[0]; });
    sv.innerHTML = (P2.length > 1 ? '<polyline points="' + P2.map(function (p) { return p[0] + "," + p[1]; }).join(" ") + '" fill="none" stroke="#ffd600" stroke-width="0.006" vector-effect="non-scaling-stroke" style="stroke-width:3px"/>' : "") +
      P2.map(function (p) { return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="0.008" fill="#d9480f" stroke="#fff" stroke-width="0.003"/>'; }).join("");
  }
  /* the photo's skyline over the chosen spot's terrain skyline, across the photo's width */
  function chart(r) {
    var t = r.top[S.sel]; if (!t || !t.sky) return "";
    var p = r.prof, WD = 520, HT = 120, left = t.heading - P.fov / 2 + p.a0, tv = [], pv = [];
    for (var k = 0; k < p.n; k++) { tv.push(t.sky[(((Math.round(left + k)) % 360) + 360) % 360]); pv.push(p.vals[k] - t.tilt); }
    var all = tv.concat(pv), lo = Math.min.apply(null, all) - 0.3, hi = Math.max.apply(null, all) + 0.3;
    function pt(v, k) { return (k / Math.max(1, p.n - 1) * (WD - 20) + 10).toFixed(1) + "," + (HT - 18 - (v - lo) / (hi - lo) * (HT - 30)).toFixed(1); }
    return '<svg viewBox="0 0 ' + WD + " " + HT + '" style="width:100%;max-width:' + WD + 'px;height:auto;margin-top:8px" role="img" aria-label="The photo skyline over the terrain skyline for proposal ' + (S.sel + 1) + '">' +
      '<rect width="' + WD + '" height="' + HT + '" fill="var(--surface2,#f4f7f8)"/><polyline fill="none" stroke="#5c7cfa" stroke-width="2.5" points="' + tv.map(pt).join(" ") + '"/>' +
      '<polyline fill="none" stroke="#d9480f" stroke-width="2" stroke-dasharray="5 3" points="' + pv.map(pt).join(" ") + '"/>' +
      '<text x="10" y="' + (HT - 4) + '" font-size="11" fill="#555">Blue: terrain skyline facing ' + t.heading + "°. Red dashed: the photo's skyline. Across " + p.n + "° of the photo.</text></svg>";
  }

  /* Photo and video check: a Skyline match button under a photo or frame */
  D.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-phc-sky]"); if (!b) return;
    var st = W.OSAP_PHOTOCHECK && W.OSAP_PHOTOCHECK._state; if (!st || !st.url) return;
    open({ url: st.url, name: st.file && st.file.name, sha: st.sha });
  });

  W.OSAP_SKYLINE = { open: open, close: close, isOpen: isOpen, run: run, setPoints: function (p) { S.pts = (p || []).filter(function (q) { return Array.isArray(q) && q[0] >= 0 && q[0] <= 1 && q[1] >= 0 && q[1] <= 1; }).map(function (q) { return [+q[0], +q[1]]; }); paintPts(); paintTrace(); },
    result: function () { return S.res ? S.res.record : null; }, state: function () { return { busy: S.busy, pts: S.pts.length, err: S.err, sel: S.sel, aspect: S.aspect, top: S.res ? S.res.top.length : 0 }; }, _t: T };
})();
