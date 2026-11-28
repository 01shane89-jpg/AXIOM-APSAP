/* AXIOM OSAP · Planes in satellite pictures, pure detector (rules "s2planes-v1"). No page code here: assets/osap-satplanes.js
   reads the bands and draws the results; tests/satplanes.test.mjs runs this file under node.

   Why it works: Sentinel-2's camera does not take its colour bands at the same instant. Along each detector strip the four
   10 m bands are recorded in a fixed order, blue (B02) first, then near-infrared (B08) 0.264 s later, green (B03) at 0.527 s
   and red (B04) at 1.005 s (ESA's published inter-band delays; Heiselberg 2019 table 1, Binet et al. 2022 table 2). Anything
   that does not move lands on the same pixel in all four. An aircraft moves between them, so it shows up four times along a
   straight line, spaced in the same proportions as those delays (0 : 0.263 : 0.524 : 1). That spacing is the test: a bright
   roof, a ship's wake or a cloud edge does not repeat itself four times in those proportions.

   What can be read from it, and what cannot:
   - The line of travel (to a few degrees) and the "apparent" speed: the blue-to-red distance divided by 1.005 s.
   - Which way along the line is NOT certain from the bands alone. The band order is reversed on every other detector strip
     of the camera (Binet et al. 2022 sec. 3.4.1), and the strip map is not in the files OSAP reads. Two cues settle it when
     they are there: a contrail (the plane is at its head, the trail is behind it), or one of the two readings giving a speed
     no aircraft flies. Otherwise both headings are given.
   - Height is unknown, and height shifts the bands too (parallax): seen from a satellite moving at about 7.44 km/s at 786 km,
     something at height h appears to move against the satellite's ground track by 7.44 * h / 786 km/s, about 9.5 m/s per km
     of height (CESBIO, Gascoin 2021). So the ground speed is given as a range over heights from 0 to 12 km, not one number.
   - It is a detection in a picture, not an identification: it never says which aircraft, and it is not checked against any
   flight-tracking feed. Birds, balloons and some fast cars on bright roads can pass the test; very slow or small aircraft and
   aircraft over bright cloud are missed.

   API (window.OSAP_PLANES_LIB, or module.exports under node):
     detect({ b02, b08, b03, b04, w, h, off }) -> { rules, found: [...], peaks }  bands: 16-bit DN arrays, row-major w x h;
       off: the L2A offset to take off (1000 from processing baseline 04.00, else 0); 0 = no data.
       Each found item: { x, y (red-band pixel, sub-pixel), d: [dx, dy] blue-to-red displacement in pixels, rms (pixels),
       peak (red reflectance above background), contrail: -1 | 0 | 1 (trail behind the red position along -d / none / along +d) }
     readOut(item, { px: 10, trackDeg, up: north-up angle }) -> speeds and headings in plain numbers (see the function).
   Rules are fixed and versioned so every flag can be explained; change RULES when any threshold changes. */
(function () {
  "use strict";
  var RULES = "s2planes-v1";
  var DT = [0, 0.264, 0.527, 1.005];               // B02, B08, B03, B04 seconds after B02 (ESA)
  var FR = [0, DT[1] / DT[3], DT[2] / DT[3], 1];  // where along the blue-to-red line each band should sit
  var K_PARALLAX = 7440 / 786;                     // m/s of apparent motion per km of height, against the ground track
  var T_PEAK = 0.035;        // reflectance above the local background for a band peak (water ~0.02-0.06, aircraft 0.15-0.5)
  var BG_R = 12;             // background = mean of a (2*BG_R+1)^2 box
  var D_MIN = 4, D_MAX = 48; // blue-to-red distance in pixels: 4 px = 40 m/s apparent; 48 px = 478 m/s (covers jets + parallax)
  var FIT_MAX = 0.6;         // largest rms distance (pixels) of the four band positions from the fitted line and spacing
  var BLOB_MAX = 30;         // pixels at more than half the peak height in the 9x9 box around a red peak (aircraft <= ~80 m)
  var SEP_MIN = 3, ALONE = 0.4; // see detect(): another band 3 px or more away must be under 40 % of this band's peak here
  var BRIGHT_RATIO = 3;      // brightest of the four images at most 3 times the faintest
  var GONE = 0.5;            // where the red band saw nothing yet: red at the blue position must be under this share of the red peak
  var T_CAP = 0.1;           // ... but never above this, so a plane over a city (red ~0.3-0.6 above the roofs) is still a peak
  var SIGMAS = 8;            // threshold floor in multiples of the picture's own spread (see threshold())
  var PEAK_SHARE = 0.02;     // per band, peaks per pixel; a picture with more is cloud or glare and is not searched further
  var V_MIN = 40, V_MAX = 330; // plausible ground speeds (m/s) for the "only one reading fits" cue

  function refl(a, off, n) {
    var r = new Float32Array(n), ok = new Uint8Array(n);
    for (var i = 0; i < n; i++) { var v = a[i]; if (v > 0) { r[i] = (v - off) / 10000; ok[i] = 1; } }
    return { r: r, ok: ok };
  }
  /* value minus the mean of the surrounding box (no-data pixels left out), via summed-area tables */
  function highpass(R, w, h) {
    var r = R.r, ok = R.ok, W1 = w + 1, S = new Float64Array(W1 * (h + 1)), C = new Uint32Array(W1 * (h + 1)), out = new Float32Array(w * h);
    for (var y = 0; y < h; y++) {
      var rs = 0, rc = 0;
      for (var x = 0; x < w; x++) { var i = y * w + x; if (ok[i]) { rs += r[i]; rc++; } S[(y + 1) * W1 + x + 1] = S[y * W1 + x + 1] + rs; C[(y + 1) * W1 + x + 1] = C[y * W1 + x + 1] + rc; }
    }
    for (y = 0; y < h; y++) {
      var y0 = Math.max(0, y - BG_R), y1 = Math.min(h, y + BG_R + 1);
      for (x = 0; x < w; x++) {
        i = y * w + x; if (!ok[i]) continue;
        var x0 = Math.max(0, x - BG_R), x1 = Math.min(w, x + BG_R + 1);
        var s = S[y1 * W1 + x1] - S[y0 * W1 + x1] - S[y1 * W1 + x0] + S[y0 * W1 + x0];
        var c = C[y1 * W1 + x1] - C[y0 * W1 + x1] - C[y1 * W1 + x0] + C[y0 * W1 + x0];
        out[i] = c ? r[i] - s / c : 0;
      }
    }
    return out;
  }
  /* local maxima above T_PEAK, with a 3x3 weighted centre */
  /* busy ground (cities, surf, broken cloud) has many small bright spots: the threshold rises to SIGMAS times the picture's
     own spread (median absolute deviation of the high-passed values, sampled) where that is higher than T_PEAK */
  function threshold(H) {
    var S = [], step = Math.max(1, Math.floor(H.length / 200000));
    for (var i = 0; i < H.length; i += step) if (H[i] !== 0) S.push(Math.abs(H[i]));
    if (!S.length) return T_PEAK;
    S.sort(function (a, b) { return a - b; });
    return Math.min(T_CAP, Math.max(T_PEAK, SIGMAS * 1.4826 * S[Math.floor(S.length / 2)]));
  }
  function peaks(H, w, h) {
    var out = [], max = Math.max(2000, Math.round(w * h * PEAK_SHARE)), T = threshold(H);
    for (var y = 1; y < h - 1; y++) for (var x = 1; x < w - 1; x++) {
      var i = y * w + x, v = H[i]; if (v < T) continue;
      var top = true, sw = 0, sx = 0, sy = 0;
      for (var dy = -1; dy <= 1 && top; dy++) for (var dx = -1; dx <= 1; dx++) {
        var u = H[i + dy * w + dx]; if ((dx || dy) && (u > v || (u === v && (dy < 0 || (dy === 0 && dx < 0))))) { top = false; break; }
        if (u > 0) { sw += u; sx += u * dx; sy += u * dy; }
      }
      if (!top) continue;
      out.push([x + sx / sw, y + sy / sw, v, i]);
      if (out.length > max) return null;
    }
    return out;
  }
  function grid(P, cell) {
    var G = {}; P.forEach(function (p, k) { var key = Math.floor(p[0] / cell) + "," + Math.floor(p[1] / cell); (G[key] = G[key] || []).push(k); });
    return G;
  }
  function near(P, G, cell, x, y, r) {
    var best = -1, bd = r * r, cx = Math.floor(x / cell), cy = Math.floor(y / cell), n = Math.ceil(r / cell);
    for (var a = cx - n; a <= cx + n; a++) for (var b = cy - n; b <= cy + n; b++) {
      var L = G[a + "," + b]; if (!L) continue;
      for (var j = 0; j < L.length; j++) { var p = P[L[j]], dd = (p[0] - x) * (p[0] - x) + (p[1] - y) * (p[1] - y); if (dd <= bd) { bd = dd; best = L[j]; } }
    }
    return best;
  }
  function blob(H, w, h, x, y, v) {
    var n = 0, X = Math.round(x), Y = Math.round(y);
    for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) { var a = X + dx, b = Y + dy; if (a >= 0 && b >= 0 && a < w && b < h && H[b * w + a] > v / 2) n++; }
    return n;
  }
  function at(H, w, h, x, y) { var X = Math.round(x), Y = Math.round(y); return X >= 0 && Y >= 0 && X < w && Y < h ? H[Y * w + X] : 0; }
  /* fit the four positions to p0 + f*D (f = FR) by least squares; returns D and the rms distance */
  function fit(pts) {
    var mf = 0, mx = 0, my = 0; for (var k = 0; k < 4; k++) { mf += FR[k] / 4; mx += pts[k][0] / 4; my += pts[k][1] / 4; }
    var sff = 0, sfx = 0, sfy = 0; for (k = 0; k < 4; k++) { var df = FR[k] - mf; sff += df * df; sfx += df * (pts[k][0] - mx); sfy += df * (pts[k][1] - my); }
    var dx = sfx / sff, dy = sfy / sff, x0 = mx - mf * dx, y0 = my - mf * dy, e = 0;
    for (k = 0; k < 4; k++) { var ex = x0 + FR[k] * dx - pts[k][0], ey = y0 + FR[k] * dy - pts[k][1]; e += ex * ex + ey * ey; }
    return { d: [dx, dy], p0: [x0, y0], rms: Math.sqrt(e / 4) };
  }
  /* contrail: mean red brightness along the line 8..60 px either side of the plane (only beyond its own four images) */
  function contrail(H, w, h, x, y, d) {
    var L = Math.hypot(d[0], d[1]), ux = d[0] / L, uy = d[1] / L, side = [0, 0];
    [1, -1].forEach(function (s, si) {
      var sum = 0, n = 0, start = s > 0 ? 8 : L + 8; // behind the blue position on the -d side, past the red one on the +d side
      for (var t = start; t < start + 52; t += 1) { sum += Math.max(0, at(H, w, h, x + s * ux * t, y + s * uy * t)); n++; }
      side[si] = sum / n;
    });
    if (Math.max(side[0], side[1]) < 0.012) return 0;
    if (side[0] > 2.5 * side[1]) return 1;
    if (side[1] > 2.5 * side[0]) return -1;
    return 0;
  }

  function detect(o) {
    var w = o.w, h = o.h, n = w * h, off = o.off || 0;
    var B = [o.b02, o.b08, o.b03, o.b04].map(function (a) { return highpass(refl(a, off, n), w, h); });
    var P = B.map(function (H) { return peaks(H, w, h); });
    var res = { rules: RULES, found: [], peaks: P.map(function (p) { return p ? p.length : -1; }) };
    if (P.some(function (p) { return !p; })) { res.tooBusy = true; return res; }
    var CELL = 8, G = P.map(function (p) { return grid(p, CELL); }), used = {};
    P[3].forEach(function (r) {            // each red peak = the plane's last image
      if (blob(B[3], w, h, r[0], r[1], r[2]) > BLOB_MAX) return;
      var cand = [], cx = Math.floor(r[0] / CELL), cy = Math.floor(r[1] / CELL), nn = Math.ceil(D_MAX / CELL);
      for (var a = cx - nn; a <= cx + nn; a++) for (var b = cy - nn; b <= cy + nn; b++) (G[0][a + "," + b] || []).forEach(function (k) { cand.push(k); });
      var best = null;
      cand.forEach(function (k) {
        var bl = P[0][k], dx = r[0] - bl[0], dy = r[1] - bl[1], D = Math.hypot(dx, dy);
        if (D < D_MIN || D > D_MAX) return;
        if (at(B[3], w, h, bl[0], bl[1]) > GONE * r[2]) return;           // red already bright at the blue spot: not moving
        if (at(B[0], w, h, r[0], r[1]) > GONE * bl[2]) return;            // blue still bright at the red spot: not moving
        var pts = [bl, null, null, r];
        for (var m = 1; m <= 2; m++) {
          var j = near(P[m], G[m], CELL, bl[0] + FR[m] * dx, bl[1] + FR[m] * dy, 1.8); if (j < 0) return; pts[m] = P[m][j];
        }
        // each image belongs to one band only: where band m saw the object, a band n that looked 3 px or more away sees
        // much less there (a roof or a wave is bright in every band at once)
        for (m = 0; m < 4; m++) for (var q = 0; q < 4; q++) {
          if (q === m || Math.abs(FR[m] - FR[q]) * D < SEP_MIN) continue;
          if (at(B[q], w, h, pts[m][0], pts[m][1]) > ALONE * pts[m][2]) return;
        }
        var lo = Math.min(pts[0][2], pts[1][2], pts[2][2], pts[3][2]), hi = Math.max(pts[0][2], pts[1][2], pts[2][2], pts[3][2]);
        if (hi > BRIGHT_RATIO * lo) return;                                            // four images of one object are of similar brightness
        var f = fit(pts); if (f.rms > FIT_MAX || Math.hypot(f.d[0], f.d[1]) < D_MIN) return;
        if (!best || f.rms < best.rms) best = { x: r[0], y: r[1], d: f.d, rms: f.rms, peak: r[2], bi: bl[3] };
      });
      if (!best || used[best.bi]) return;
      used[best.bi] = 1;
      best.contrail = contrail(B[3], w, h, r[0], r[1], best.d);
      res.found.push({ x: rd(best.x), y: rd(best.y), d: [rd(best.d[0]), rd(best.d[1])], rms: rd(best.rms), peak: Math.round(best.peak * 1000) / 1000, contrail: best.contrail });
    });
    return res;
  }
  function rd(v) { return Math.round(v * 100) / 100; }

  /* Plain numbers for one detection. px: metres per pixel (10). trackDeg: the satellite's ground track heading (compass
     degrees, ~190 for Sentinel-2's descending passes). Pixel y grows southwards, x eastwards, in a north-up UTM grid; conv:
     grid convergence in degrees (UTM north vs true north at the point), added to grid bearings.
     Returns { line: compass bearing of the blue-to-red displacement, app: apparent speed m/s, readings: [ { s, hdg, lo, hi,
     plausible }, ... ] for s = +1 (camera order blue first) and -1 (reversed), with the ground speed range over heights 0-12 km,
     and pick: index of the reading the contrail or speed cue supports, or -1 }. */
  function readOut(it, o) {
    o = o || {}; var px = o.px || 10, tr = (o.trackDeg == null ? 190 : o.trackDeg) * Math.PI / 180, conv = o.conv || 0;
    var ae = it.d[0] * px / DT[3], an = -it.d[1] * px / DT[3];             // apparent velocity, m/s east / north (grid)
    var c = conv * Math.PI / 180, e0 = ae * Math.cos(c) + an * Math.sin(c), n0 = -ae * Math.sin(c) + an * Math.cos(c);
    var ue = Math.sin(tr), un = Math.cos(tr);
    function brg(e, n) { return (Math.atan2(e, n) * 180 / Math.PI + 360) % 360; }
    var R = [1, -1].map(function (s) {
      var sp = [], hd = [];
      for (var km = 0; km <= 12; km += 1) { var ve = s * e0 + K_PARALLAX * km * ue, vn = s * n0 + K_PARALLAX * km * un; sp.push(Math.hypot(ve, vn)); hd.push(brg(ve, vn)); }
      var lo = Math.min.apply(null, sp), hi = Math.max.apply(null, sp);
      return { s: s, hdg: Math.round(brg(s * e0, s * n0)), hdg11: Math.round(hd[11]), lo: Math.round(lo), hi: Math.round(hi), plausible: hi >= V_MIN && lo <= V_MAX };
    });
    var pick = -1;
    if (it.contrail) pick = it.contrail > 0 ? 1 : 0;   // trail on the +d side: the plane moved along -d, the reversed reading
    else if (R[0].plausible !== R[1].plausible) pick = R[0].plausible ? 0 : 1;
    return { line: Math.round(brg(e0, n0)), app: Math.round(Math.hypot(ae, an)), readings: R, pick: pick, why: it.contrail ? "contrail" : pick >= 0 ? "speed" : "" };
  }

  /* UTM -> WGS84 (Krüger series, inverse of osap-sat.js utm(); well under a metre inside a zone) */
  function utmInv(E, N, zone, south) {
    var a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, n = f / (2 - f), n2 = n * n, n3 = n2 * n;
    var A = a / (1 + n) * (1 + n2 / 4 + n2 * n2 / 64), be = [n / 2 - 2 * n2 / 3 + 37 * n3 / 96, n2 / 48 + n3 / 15, 17 * n3 / 480];
    var de = [2 * n - 2 * n2 / 3 - 2 * n3, 7 * n2 / 3 - 8 * n3 / 5, 56 * n3 / 15];
    var xi = (N - (south ? 10000000 : 0)) / (k0 * A), eta = (E - 500000) / (k0 * A), x = xi, y = eta;
    for (var j = 1; j <= 3; j++) { x -= be[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta); y -= be[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta); }
    var chi = Math.asin(Math.sin(x) / Math.cosh(y)), phi = chi;
    for (j = 1; j <= 3; j++) phi += de[j - 1] * Math.sin(2 * j * chi);
    var lon = (zone * 6 - 183) + Math.atan2(Math.sinh(y), Math.cos(x)) * 180 / Math.PI;
    return [phi * 180 / Math.PI, lon];
  }
  /* compass heading of Sentinel-2's ground track on its daytime (descending) pass at a latitude: orbit inclination 98.62
     degrees, ~7.44 km/s, plus the Earth turning under it. About 192 at the equator, more westerly further north and south. */
  function trackAt(lat) {
    var c = Math.cos(lat * Math.PI / 180), a0 = Math.asin(Math.min(1, 0.14953 / Math.max(0.2, c)));
    var west = 7.44 * Math.sin(a0) + 0.4651 * c, south = 7.44 * Math.cos(a0);
    return 180 + Math.atan2(west, south) * 180 / Math.PI;
  }

  var API = { RULES: RULES, DT: DT, FR: FR, K_PARALLAX: K_PARALLAX, detect: detect, readOut: readOut, utmInv: utmInv, trackAt: trackAt, _fit: fit };
  if (typeof module === "object" && module.exports) module.exports = API;
  if (typeof self !== "undefined") self.OSAP_PLANES_LIB = API;   // the page (window) and the worker (assets/osap-planes-worker.js)
})();
