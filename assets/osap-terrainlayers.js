/* AXIOM OSAP · Terrain layers: whole-map terrain analysis you switch on over any base map (Shane 2026-11-18: "I want all the
   terrain analysis layers available if possible"). Terrain analysis (assets/osap-terrain.js) answers one point or one area at a
   time; these draw the same kinds of answer across the whole map as it moves:
   - Slope: steepness in the five bands Terrain analysis and the landing zone finder use (0-3 clear, 3-7, 7-15, 15-30, over 30
     degrees). Where vehicles, helicopters and people on foot can and cannot go.
   - Aspect: which way the ground faces, in eight compass directions (flat ground clear). Sun, snow, wind and line of approach.
   - Contour lines: every 5 to 500 m depending on zoom, every fifth line bold and labeled in metres.
   - Elevation colors: height above sea level as a color ramp from lowland green to high white (sea level and below clear).
     "Fit to view" (on by default) spreads the ramp over the 2nd to 98th percentile of the heights in view, read from coarse
     elevation tiles after each move, so a city in a 1,800 m valley still shows its hills; off, fixed heights.
   - Ridges and valleys: ground higher (ridge lines, spurs, hilltops) or lower (valleys, draws, gullies) than the ground around
     it, about 8 cells either side at the zoom in view. A quick key terrain read.
   - Low ground: ground at or below a height you set (1 to 50 m above sea level), for flood, storm surge and sea level questions.
   Where it lives: Map overlays > Elevation and terrain analysis, block "Terrain layers" at the end of the section (after the hillshade rows),
   with one opacity slider for all of them. Choices are kept on this device (localStorage "osap-terrainlayers"), are device
   settings rather than work (not in workspaces), and stay on when another tab or data set opens, like the other
   elevation shading (index.html extrasOff skips input[data-tl]).
   Data: the elevation tiles LiDAR hillshade already uses (window.OSAP_LIDAR.dem, Mapterhorn: national LiDAR and fine models where
   published, Copernicus GLO-30 about 30 m elsewhere; keyless, CORS open, each model under its producer's licence, credit given).
   Each map tile is worked out on this device from its own elevation tile plus the eight around it, so slopes and lines carry
   across tile edges without seams. Nothing is sent anywhere.
   Honest labels: a terrain model, not a survey. Buildings, trees and walls are not modelled; the 30 m satellite elevation used
   where there is no LiDAR partly carries forest canopy and big city blocks. Every legend says which zoom's data it shows. These
   are display layers: nothing here is a record, a finding or evidence.
   API: window.OSAP_TERRAIN_LAYERS = { LIST, set(id, on), on(id), opacity(v), low(m), fit(bool), state(), _t: pure helpers for tests } */
(function () {
  "use strict";
  var W = window, D = document;
  var KEY = "osap-terrainlayers", M = 16, T = 256, N = T + 2 * M;   /* tile, margin taken from the neighbours, working grid */

  /* ---------- pure helpers (tests/terrain_layers.test.mjs) ---------- */
  function mpp(z, lat) { return 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z); }
  function tileLat(y, z) { return Math.atan(Math.sinh(Math.PI * (1 - 2 * y / Math.pow(2, z)))) * 180 / Math.PI; }
  var SLOPE = [[3, "0–3°", null], [7, "3–7°", [156, 204, 101]], [15, "7–15°", [253, 216, 53]], [30, "15–30°", [251, 140, 0]], [Infinity, "over 30°", [198, 40, 40]]];
  var ASPECT = [["N", [230, 25, 25]], ["NE", [255, 152, 0]], ["E", [255, 235, 59]], ["SE", [102, 187, 106]], ["S", [0, 188, 212]], ["SW", [33, 150, 243]], ["W", [63, 81, 181]], ["NW", [216, 27, 96]]];
  /* many stops, closest at the heights most people live and fight at, so a valley at 1,800 m still shows its hills */
  var TINT = [[0, [34, 110, 60]], [50, [76, 145, 72]], [150, [130, 180, 90]], [300, [190, 210, 110]], [500, [235, 225, 130]], [750, [230, 190, 100]],
    [1000, [215, 150, 80]], [1400, [190, 110, 60]], [1800, [160, 80, 50]], [2300, [130, 70, 60]], [2900, [120, 100, 95]], [3600, [165, 155, 150]], [4500, [225, 222, 220]], [6000, [255, 255, 255]]];
  function contourStep(z) { return z <= 7 ? 500 : z <= 8 ? 250 : z <= 9 ? 200 : z <= 10 ? 100 : z <= 11 ? 50 : z <= 12 ? 25 : z <= 13 ? 20 : z <= 14 ? 10 : 5; }
  function slopeBand(deg) { for (var i = 0; i < SLOPE.length; i++) if (deg < SLOPE[i][0]) return i; return SLOPE.length - 1; }
  /* compass direction the ground faces (0 = north, clockwise), from the fall east (dx) and the fall south (dy) per metre */
  function aspectDeg(dzdx, dzdy) { var a = Math.atan2(-dzdx, dzdy) * 180 / Math.PI; return a < 0 ? a + 360 : a; }
  function aspectIdx(deg) { return Math.floor(((deg + 22.5) % 360) / 45); }
  /* rng [lo, hi]: the colors spread over the heights in view (Fit colors to the view) instead of fixed heights */
  function tint(v, rng) {
    if (!(v === v) || v <= 0) return null;
    if (rng && rng[1] - rng[0] >= 20) {
      var f = Math.max(0, Math.min(1, (v - rng[0]) / (rng[1] - rng[0]))) * (TINT.length - 1), k = Math.min(TINT.length - 2, Math.floor(f)), u = f - k, A = TINT[k][1], B = TINT[k + 1][1];
      return [Math.round(A[0] + (B[0] - A[0]) * u), Math.round(A[1] + (B[1] - A[1]) * u), Math.round(A[2] + (B[2] - A[2]) * u)];
    }
    for (var i = 1; i < TINT.length; i++) if (v <= TINT[i][0]) {
      var a = TINT[i - 1], b = TINT[i], f = (v - a[0]) / (b[0] - a[0]);
      return [Math.round(a[1][0] + (b[1][0] - a[1][0]) * f), Math.round(a[1][1] + (b[1][1] - a[1][1]) * f), Math.round(a[1][2] + (b[1][2] - a[1][2]) * f)];
    }
    return TINT[TINT.length - 1][1].slice();
  }
  /* Horn's gradient at cell (i, j) of an n-wide grid of cell size cs metres: [dz/dx east, dz/dy south], null without data */
  function grad(h, n, i, j, cs) {
    var a = h[(j - 1) * n + i - 1], b = h[(j - 1) * n + i], c = h[(j - 1) * n + i + 1], d = h[j * n + i - 1], f = h[j * n + i + 1],
      g = h[(j + 1) * n + i - 1], k = h[(j + 1) * n + i], l = h[(j + 1) * n + i + 1];
    if (!(a === a && b === b && c === c && d === d && f === f && g === g && k === k && l === l)) return null;
    return [((c + 2 * f + l) - (a + 2 * d + g)) / (8 * cs), ((g + 2 * k + l) - (a + 2 * b + c)) / (8 * cs)];
  }
  /* RGBA (T x T) for a colour layer from the working grid h (N x N, the tile in the middle); cs = metres per cell */
  function paint(kind, h, cs, opt) {
    var out = new Uint8ClampedArray(T * T * 4), r = 8, S = null;
    if (kind === "tpi") {   /* summed-area table of the heights (and of the cells with data) for the mean around each cell */
      S = new Float64Array((N + 1) * (N + 1)); var C = new Float64Array((N + 1) * (N + 1));
      for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
        var v0 = h[y * N + x], ok = v0 === v0, p = (y + 1) * (N + 1) + x + 1;
        S[p] = (ok ? v0 : 0) + S[p - 1] + S[p - N - 1] - S[p - N - 2];
        C[p] = (ok ? 1 : 0) + C[p - 1] + C[p - N - 1] - C[p - N - 2];
      }
    }
    for (var j = 0; j < T; j++) for (var i = 0; i < T; i++) {
      var I = i + M, J = j + M, v = h[J * N + I], o = (j * T + i) * 4, col = null, al = 0;
      if (!(v === v)) continue;
      if (kind === "tint") { col = tint(v, opt.rng); al = 255; }
      else if (kind === "low") {
        /* sea in the elevation data reads 0 (or about 0 along the coast, where the values are blended): left clear */
        if (v <= opt.low && v > -100 && Math.abs(v) > 0.5) { col = v < 0 ? [21, 101, 192] : [66, 165, 245]; al = 235; }
      } else if (kind === "tpi") {
        var x0 = I - r, x1 = I + r + 1, y0 = J - r, y1 = J + r + 1, q = function (yy, xx) { return yy * (N + 1) + xx; };
        var sum = S[q(y1, x1)] - S[q(y0, x1)] - S[q(y1, x0)] + S[q(y0, x0)], cnt = C[q(y1, x1)] - C[q(y0, x1)] - C[q(y1, x0)] + C[q(y0, x0)];
        if (cnt < 4) continue;
        var t = v - sum / cnt, th = Math.max(1.5, 0.05 * r * cs);   /* about 3 degrees of relief over the window's radius */
        if (Math.abs(t) > th) { col = t > 0 ? [183, 28, 28] : [21, 101, 192]; al = Math.round(Math.min(1, (Math.abs(t) - th) / (2 * th) + 0.35) * 230); }
      } else {
        var gr = grad(h, N, I, J, cs); if (!gr) continue;
        var deg = Math.atan(Math.sqrt(gr[0] * gr[0] + gr[1] * gr[1])) * 180 / Math.PI;
        if (kind === "slope") { col = SLOPE[slopeBand(deg)][2]; al = 220; }
        else if (kind === "aspect" && deg >= 3) { col = ASPECT[aspectIdx(aspectDeg(gr[0], gr[1]))][1]; al = 210; }
      }
      if (col) { out[o] = col[0]; out[o + 1] = col[1]; out[o + 2] = col[2]; out[o + 3] = al; }
    }
    return out;
  }
  /* contour segments (marching squares) over the tile's cells and one cell past its right and bottom edges, so lines meet
     the next tile's: [[x1, y1, x2, y2, level], ...] in tile pixels (0..T) */
  function contours(h, step) {
    var seg = [];
    function lerp(a, b, lv) { return a === b ? 0.5 : (lv - a) / (b - a); }
    for (var j = M - 1; j < M + T; j++) for (var i = M - 1; i < M + T; i++) {
      var a = h[j * N + i], b = h[j * N + i + 1], c = h[(j + 1) * N + i + 1], d = h[(j + 1) * N + i];
      if (!(a === a && b === b && c === c && d === d)) continue;
      var lo = Math.min(a, b, c, d), hi = Math.max(a, b, c, d);
      for (var lv = Math.ceil(lo / step) * step; lv <= hi; lv += step) {
        var e = [], X = i - M + 0.5, Y = j - M + 0.5;   /* cell centres */
        if ((a < lv) !== (b < lv)) e.push([X + lerp(a, b, lv), Y]);
        if ((b < lv) !== (c < lv)) e.push([X + 1, Y + lerp(b, c, lv)]);
        if ((d < lv) !== (c < lv)) e.push([X + lerp(d, c, lv), Y + 1]);
        if ((a < lv) !== (d < lv)) e.push([X, Y + lerp(a, d, lv)]);
        if (e.length === 2) seg.push([e[0][0], e[0][1], e[1][0], e[1][1], lv]);
        else if (e.length === 4) { seg.push([e[0][0], e[0][1], e[3][0], e[3][1], lv]); seg.push([e[1][0], e[1][1], e[2][0], e[2][1], lv]); }
      }
    }
    return seg;
  }
  var LIST = [
    { id: "slope", name: "Slope", minZ: 6, note: "Steepness of the ground in five bands, the same bands as Terrain analysis and the landing zone finder. Flat ground (under 3°) is left clear." },
    { id: "aspect", name: "Aspect", minZ: 6, note: "Which way the ground faces, in eight compass directions. Flat ground (under 3°) is left clear." },
    { id: "contour", name: "Contour lines", minZ: 8, note: "Lines of equal height, closer apart as you zoom in. Every fifth line is bold and labeled in meters." },
    { id: "tint", name: "Elevation colors", minZ: 4, note: "Height above sea level as color, green low to brown high to white peaks. Fit to view (on by default) spreads the colors over the heights in view, so a high valley still shows its hills. Sea level and below left clear." },
    { id: "tpi", name: "Ridges and valleys", minZ: 8, note: "Red: higher than the ground around it (ridge lines, spurs, hilltops). Blue: lower (valleys, draws, gullies). Compared over about 8 cells either side at the zoom in view." },
    { id: "low", name: "Low ground", minZ: 6, note: "Ground at or below the height you set above sea level, for flood, storm surge and sea level questions. Darker blue: below sea level. The sea itself is left clear." }
  ];
  var API = { LIST: LIST, set: function () {}, on: function () { return false; }, opacity: function () {}, low: function () {}, state: function () { return {}; },
    _t: { paint: paint, contours: contours, contourStep: contourStep, slopeBand: slopeBand, aspectDeg: aspectDeg, aspectIdx: aspectIdx, tint: tint, grad: grad, N: N, M: M, T: T, SLOPE: SLOPE, ASPECT: ASPECT } };
  W.OSAP_TERRAIN_LAYERS = API;

  /* ---------- on the map ---------- */
  var map = W.__asapMap, Lf = W.L;
  if (!map || !Lf || /[?&](watchscan|wopen)=/.test(location.search)) return;
  var ST = { on: {}, op: 0.6, low: 5, fit: true };
  try { var s0 = JSON.parse(localStorage.getItem(KEY) || "{}"); LIST.forEach(function (l) { ST.on[l.id] = !!(s0.on && s0.on[l.id]); });
    if (s0.op >= 0.2 && s0.op <= 1) ST.op = s0.op; if (s0.low >= 1 && s0.low <= 50) ST.low = Math.round(s0.low); if (s0.fit === false) ST.fit = false; } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(ST)); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  var ATTR = (W.OSAP_LIDAR && W.OSAP_LIDAR.ATTR) || 'Elevation: <a href="https://mapterhorn.com/attribution/" target="_blank" rel="noopener noreferrer">Mapterhorn</a>';

  /* the tile (z, x, y) and M cells of each neighbour around it, as one N x N grid (NaN where there is no data) */
  function grid(z, x, y) {
    var X = W.OSAP_LIDAR, n = Math.pow(2, z), jobs = [];
    for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
      var ty = y + dy, tx = ((x + dx) % n + n) % n;
      jobs.push(ty < 0 || ty >= n || !X || !X.dem ? Promise.resolve(null) : X.dem(z, tx, ty, null, 256).catch(function () { return null; }));
    }
    return Promise.all(jobs).then(function (r) {
      if (!r[4]) return null;
      var h = new Float32Array(N * N); h.fill(NaN);
      for (var k = 0; k < 9; k++) {
        var t = r[k]; if (!t) continue;
        var ox = (k % 3 - 1) * T + M, oy = (Math.floor(k / 3) - 1) * T + M, H = t.h;
        for (var j = Math.max(0, -oy); j < T && oy + j < N; j++) for (var i = Math.max(0, -ox); i < T && ox + i < N; i++) h[(oy + j) * N + ox + i] = H[j * T + i];
      }
      return { h: h, z: r[4].z };
    });
  }
  /* the heights in view for Fit to view: 2nd to 98th percentile of land above sea level, from coarse tiles (3 zooms out) */
  var RNG = null, rngP = null, rngTok = 0;
  function viewRange() {
    var b = map.getBounds(), z = Math.max(2, Math.min(14, Math.round(map.getZoom()) - 3)), n = Math.pow(2, z);
    var x0 = Math.floor((b.getWest() + 180) / 360 * n), x1 = Math.floor((b.getEast() + 180) / 360 * n);
    function ty(lat) { var s2 = Math.sin(Math.max(-85, Math.min(85, lat)) * Math.PI / 180); return Math.floor((0.5 - Math.log((1 + s2) / (1 - s2)) / (4 * Math.PI)) * n); }
    var y0 = Math.max(0, ty(b.getNorth())), y1 = Math.min(n - 1, ty(b.getSouth())), jobs = [];
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1 && jobs.length < 24; x++) jobs.push(W.OSAP_LIDAR.dem(z, ((x % n) + n) % n, y, null, 256).catch(function () { return null; }));
    return Promise.all(jobs).then(function (r) {
      var v = [];
      r.forEach(function (t) { if (t) for (var i = 0; i < t.h.length; i += 7) { var e = t.h[i]; if (e === e && e > 0.5) v.push(e); } });
      if (v.length < 50) return null;
      v.sort(function (a, c) { return a - c; });
      var lo = v[Math.floor(v.length * 0.02)], hi = v[Math.floor(v.length * 0.98)];
      if (hi - lo < 20) { var m = (hi + lo) / 2; lo = Math.max(0, m - 10); hi = m + 10; }
      return [Math.floor(lo), Math.ceil(hi)];
    });
  }
  function refit(first) {
    if (!(ON.tint || first) || !ST.fit) return;
    var t = ++rngTok;
    rngP = viewRange().then(function (r) {
      if (t !== rngTok) return RNG;
      var span = RNG ? RNG[1] - RNG[0] : 0, moved = !RNG || !r || Math.abs(r[0] - RNG[0]) > span * 0.12 || Math.abs(r[1] - RNG[1]) > span * 0.12;
      if (r && moved) { RNG = r; if (ON.tint) ON.tint.redraw(); }
      tintKey();
      return RNG;
    }, function () { return RNG; });
  }
  function tintKey() {
    var o = D.getElementById("tl-fitv"); if (!o) return;
    o.textContent = ST.fit ? (RNG ? "Colors spread over " + RNG[0].toLocaleString("en-US") + " to " + RNG[1].toLocaleString("en-US") + " m in view." : "") :
      "Fixed colors: " + TINT.filter(function (t, i) { return i % 3 === 0 || i === TINT.length - 1; }).map(function (t) { return t[0].toLocaleString("en-US") + " m"; }).join(" · ") + " (stops spaced evenly, not to scale).";
  }
  var Layer = Lf.GridLayer.extend({
    createTile: function (c, done) {
      var kind = this.options.kind, cv = D.createElement("canvas"), S2 = kind === "contour" ? 512 : T;
      cv.width = cv.height = S2;
      var wait = kind === "tint" && ST.fit ? (rngP || Promise.resolve(null)) : Promise.resolve(null);
      Promise.all([grid(c.z, c.x, c.y), wait]).then(function (gg) {
        var g = gg[0];
        if (!g) return done(null, cv);
        var cs = mpp(c.z, tileLat(c.y + 0.5, c.z)), cx = cv.getContext("2d");
        if (kind !== "contour") { var im = cx.createImageData(T, T); im.data.set(paint(kind, g.h, cs, { low: ST.low, rng: ST.fit ? RNG : null })); cx.putImageData(im, 0, 0); return done(null, cv); }
        var step = contourStep(c.z), sc = S2 / T, segs = contours(g.h, step), dark = (D.documentElement.getAttribute("data-map") || "light") !== "light";
        var line = dark ? "rgba(255,224,178,.85)" : "rgba(93,64,55,.9)";
        cx.lineCap = "round"; cx.strokeStyle = line;
        [false, true].forEach(function (idx) {
          cx.beginPath(); cx.lineWidth = idx ? 2.4 : 1.1;
          segs.forEach(function (s) { if ((Math.round(s[4] / step) % 5 === 0) !== idx) return; cx.moveTo(s[0] * sc, s[1] * sc); cx.lineTo(s[2] * sc, s[3] * sc); });
          cx.stroke();
        });
        /* labels on bold lines: a few per tile, kept apart and away from the edges */
        var put = [], font = "600 19px system-ui,sans-serif";
        cx.font = font; cx.textAlign = "center"; cx.textBaseline = "middle"; cx.lineJoin = "round";
        for (var q = 0; q < segs.length && put.length < 5; q += 7) {
          var s = segs[q]; if (Math.round(s[4] / step) % 5 !== 0) continue;
          var px = (s[0] + s[2]) / 2 * sc, py = (s[1] + s[3]) / 2 * sc;
          if (px < 40 || py < 20 || px > S2 - 40 || py > S2 - 20 || put.some(function (p) { return Math.abs(p[0] - px) < 140 && Math.abs(p[1] - py) < 60; })) continue;
          put.push([px, py]);
          var tx = String(s[4]), ang = Math.atan2(s[3] - s[1], s[2] - s[0]); if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
          cx.save(); cx.translate(px, py); cx.rotate(ang);
          cx.lineWidth = 5; cx.strokeStyle = dark ? "rgba(20,20,20,.9)" : "rgba(255,255,255,.92)"; cx.strokeText(tx, 0, 0);
          cx.fillStyle = dark ? "#ffe0b2" : "#4e342e"; cx.fillText(tx, 0, 0); cx.restore();
        }
        done(null, cv);
      }, function (er) { done(er, cv); });
      return cv;
    }
  });
  var ON = {};
  function zoomNote() {
    var z = map.getZoom(), n = D.getElementById("tl-note"); if (!n) return;
    var low = LIST.filter(function (l) { return ST.on[l.id] && z < l.minZ; }).map(function (l) { return l.name; });
    var parts = [];
    if (low.length) parts.push("Zoom in to see " + low.join(", ") + ".");
    if (ST.on.contour) parts.push("Contours every " + contourStep(Math.round(z)) + " m here, bold every " + contourStep(Math.round(z)) * 5 + " m.");
    n.textContent = parts.join(" ");
  }
  function set(id, on) {
    var l = LIST.filter(function (x) { return x.id === id; })[0]; if (!l) return;
    ST.on[id] = !!on; save();
    if (on && !ON[id] && id === "tint") refit(true);   /* the range first: the new layer's tiles wait for it */
    if (on && !ON[id]) ON[id] = new Layer({ kind: id, zIndex: id === "contour" ? 9 : 8, opacity: id === "contour" ? Math.min(1, ST.op + 0.3) : ST.op, minZoom: l.minZ, maxZoom: 20, maxNativeZoom: 17,
      className: "osap-tl osap-tl-" + id, attribution: ATTR + " · terrain layers worked out on this device" }).addTo(map);
    if (!on && ON[id]) { map.removeLayer(ON[id]); delete ON[id]; }
    var i = D.querySelector('input[data-tl="' + id + '"]'); if (i && i.checked !== !!on) i.checked = !!on;
    var k = D.getElementById("tl-key-" + id); if (k) k.hidden = !on;
    zoomNote();
  }
  function fit(on) { ST.fit = !!on; save(); RNG = null; rngP = null; if (ST.fit) refit(); else if (ON.tint) ON.tint.redraw(); tintKey(); var i = D.getElementById("tl-fit"); if (i && i.checked !== ST.fit) i.checked = ST.fit; }
  function opacity(v) { v = Math.max(0.2, Math.min(1, +v || 0.6)); ST.op = v; save(); Object.keys(ON).forEach(function (k) { ON[k].setOpacity(k === "contour" ? Math.min(1, v + 0.3) : v); }); }
  function low(m) { m = Math.max(1, Math.min(50, Math.round(+m) || 5)); ST.low = m; save(); if (ON.low) ON.low.redraw(); var o = D.getElementById("tl-lowv"); if (o) o.textContent = m + " m"; }
  function sw(c) { return '<span style="background:rgb(' + c.join(",") + ')"></span>'; }
  function keys(id) {
    var b = '<p class="mlkey" id="tl-key-' + id + '"' + (ST.on[id] ? "" : " hidden") + ">";
    if (id === "slope") return b + SLOPE.map(function (s) { return (s[2] ? sw(s[2]) : '<span style="background:transparent;border:1px solid #999"></span>') + esc(s[1]); }).join(" ") + ". 7° is a common helicopter landing limit.</p>";
    if (id === "aspect") return b + ASPECT.map(function (a) { return sw(a[1]) + a[0]; }).join(" ") + "</p>";
    if (id === "tint") return b + '<span style="display:block;width:100%;height:10px;border-radius:2px;background:linear-gradient(to right,' + TINT.map(function (t, i) { return "rgb(" + t[1].join(",") + ") " + Math.round(i / (TINT.length - 1) * 100) + "%"; }).join(",") + ')"></span>' +
      '<label style="display:inline-flex;gap:4px;align-items:center"><input type="checkbox" data-tl="" id="tl-fit"' + (ST.fit ? " checked" : "") + "> Fit to view</label> <i id=\"tl-fitv\"></i></p>";
    if (id === "tpi") return b + sw([183, 28, 28]) + "Higher than around it " + sw([21, 101, 192]) + "Lower than around it</p>";
    if (id === "low") return b + sw([66, 165, 245]) + "0 m up to the height " + sw([21, 101, 192]) + "Below sea level" +
      '<label class="mlop" style="display:flex">At or below <input type="range" min="1" max="50" step="1" value="' + ST.low + '" id="tl-low" aria-label="Low ground height in meters"><output id="tl-lowv">' + ST.low + " m</output></label></p>";
    return "";
  }
  function rows() {
    var box = D.getElementById("ml-elev");
    if (!box || box.querySelector("#ml-tl")) return !!box;
    var w = D.createElement("div"); w.id = "ml-tl";
    w.innerHTML = '<div class="mlh2">Terrain layers</div>' +
      LIST.map(function (l) { return '<label class="mlrow"><input type="checkbox" data-tl="' + l.id + '"' + (ST.on[l.id] ? " checked" : "") + "><span><b>" + esc(l.name) + "</b><i>" + esc(l.note) + "</i></span></label>" + keys(l.id); }).join("") +
      '<label class="mlop">Terrain layers <input type="range" min="0.2" max="1" step="0.05" value="' + ST.op + '" id="tl-op" aria-label="Terrain layers opacity"><output id="tl-opv">' + Math.round(ST.op * 100) + "%</output></label>" +
      '<p class="mlkey"><i id="tl-note"></i> Worked out on this device from LiDAR where published, about 30 m satellite elevation elsewhere. Terrain only: buildings and trees are not modelled.</p>';
    /* last in the section, after the shading rows and their slider: the shading is about how the map looks, these are analysis */
    box.appendChild(w);
    w.addEventListener("change", function (e) { var t = e.target; if (t.dataset && t.dataset.tl) set(t.dataset.tl, t.checked); });
    w.addEventListener("input", function (e) {
      var t = e.target;
      if (t.id === "tl-op") { opacity(t.value); var o = D.getElementById("tl-opv"); if (o) o.textContent = Math.round(t.value * 100) + "%"; }
      else if (t.id === "tl-low") { var v = D.getElementById("tl-lowv"); if (v) v.textContent = t.value + " m"; }
    });
    /* the low ground redraw waits for the slider to be let go: every step would redraw every tile */
    w.addEventListener("change", function (e) { if (e.target.id === "tl-low") low(e.target.value); else if (e.target.id === "tl-fit") fit(e.target.checked); });
    tintKey();
    zoomNote();
    return true;
  }
  (function wait(n) { if (!rows() && n < 40) setTimeout(function () { wait(n + 1); }, 250); })(0);
  map.on("zoomend", zoomNote);
  map.on("moveend", function () { clearTimeout(refit.t); refit.t = setTimeout(function () { refit(); }, 400); });
  /* contour colours follow the light or dark map */
  new MutationObserver(function () { if (ON.contour) ON.contour.redraw(); }).observe(D.documentElement, { attributes: true, attributeFilter: ["data-map"] });
  LIST.forEach(function (l) { if (ST.on[l.id]) set(l.id, true); });
  API.set = set; API.on = function (id) { return !!ST.on[id]; }; API.opacity = opacity; API.low = low; API.fit = fit;
  API.state = function () { return { on: Object.assign({}, ST.on), op: ST.op, low: ST.low, fit: ST.fit, range: RNG, layers: Object.keys(ON) }; };
})();
