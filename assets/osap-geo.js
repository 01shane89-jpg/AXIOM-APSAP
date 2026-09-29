/* AXIOM OSAP: geodesy helpers for the Measure tool and the Route tab (window.OSAP_GEO). Pure maths, no network, no storage.
   - dist/inverse: WGS 84 ellipsoid distance and initial/final bearing (Vincenty; a sphere for the rare near-antipodal case).
   - dest: the point at a distance and bearing; path: points along the geodesic, for drawing long legs as they really run.
   - area: area of a polygon on the ellipsoid (authalic sphere, within about 0.5 percent for areas a country wide).
   - mgrs/fromMgrs, utm: MGRS grid references (1 m, truncated as MGRS requires; UPS polar areas are not covered).
   - parse: reads decimal degrees, degrees-minutes-seconds, degrees-decimal-minutes or an MGRS reference.
   - decl: magnetic declination from the World Magnetic Model 2025 (NOAA/NGA, public domain; valid 2025 to 2030).
   - sun: sunrise, sunset, civil and nautical twilight (BMNT/EENT) and moon illumination for a place and date (NOAA method).
   Nothing here is a record or evidence: every number is a computation for planning, with the method named where it is shown. */
(function (root) {
  "use strict";
  var D = Math.PI / 180, A = 6378137, F = 1 / 298.257223563, B = A * (1 - F), R = 6371008.8, RA = 6371007.2;
  function wrap(lon) { lon = ((lon + 180) % 360 + 360) % 360 - 180; return lon === -180 ? 180 : lon; }
  function norm360(b) { return ((b % 360) + 360) % 360; }

  /* ---------- distance and bearing ---------- */
  function sphInverse(la1, lo1, la2, lo2) {
    var p1 = la1 * D, p2 = la2 * D, dl = (lo2 - lo1) * D;
    var h = Math.sin((p2 - p1) / 2) * Math.sin((p2 - p1) / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    var s = 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    var b1 = Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / D;
    var b2 = Math.atan2(Math.sin(dl) * Math.cos(p1), -Math.cos(p2) * Math.sin(p1) + Math.sin(p2) * Math.cos(p1) * Math.cos(dl)) / D;
    return { m: s, b1: norm360(b1), b2: norm360(b2 + 180) };
  }
  function inverse(a, b) {
    var la1 = a[0], lo1 = a[1], la2 = b[0], lo2 = b[1];
    if (la1 === la2 && wrap(lo1) === wrap(lo2)) return { m: 0, b1: 0, b2: 0 };
    var L = wrap(lo2 - lo1) * D, U1 = Math.atan((1 - F) * Math.tan(la1 * D)), U2 = Math.atan((1 - F) * Math.tan(la2 * D));
    var sU1 = Math.sin(U1), cU1 = Math.cos(U1), sU2 = Math.sin(U2), cU2 = Math.cos(U2), lam = L, it = 0, lamP, sS, cS, sig, sA, c2A, c2Sm, C;
    do {
      var sl = Math.sin(lam), cl = Math.cos(lam);
      sS = Math.sqrt((cU2 * sl) * (cU2 * sl) + (cU1 * sU2 - sU1 * cU2 * cl) * (cU1 * sU2 - sU1 * cU2 * cl));
      if (sS === 0) return { m: 0, b1: 0, b2: 0 };
      cS = sU1 * sU2 + cU1 * cU2 * cl; sig = Math.atan2(sS, cS);
      sA = cU1 * cU2 * sl / sS; c2A = 1 - sA * sA;
      c2Sm = c2A !== 0 ? cS - 2 * sU1 * sU2 / c2A : 0;
      C = F / 16 * c2A * (4 + F * (4 - 3 * c2A));
      lamP = lam; lam = L + (1 - C) * F * sA * (sig + C * sS * (c2Sm + C * cS * (-1 + 2 * c2Sm * c2Sm)));
    } while (Math.abs(lam - lamP) > 1e-12 && ++it < 200);
    if (it >= 200) return sphInverse(la1, lo1, la2, lo2);
    var u2 = c2A * (A * A - B * B) / (B * B), AA = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2))), BB = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
    var dS = BB * sS * (c2Sm + BB / 4 * (cS * (-1 + 2 * c2Sm * c2Sm) - BB / 6 * c2Sm * (-3 + 4 * sS * sS) * (-3 + 4 * c2Sm * c2Sm)));
    var sl2 = Math.sin(lam), cl2 = Math.cos(lam);
    return { m: B * AA * (sig - dS), b1: norm360(Math.atan2(cU2 * sl2, cU1 * sU2 - sU1 * cU2 * cl2) / D), b2: norm360(Math.atan2(cU1 * sl2, -sU1 * cU2 + cU1 * sU2 * cl2) / D) };
  }
  function dist(a, b) { return inverse(a, b).m; }
  /* the point at distance m (metres) on true bearing brg from p, on a sphere (planning precision) */
  function dest(p, brg, m) {
    var d = m / R, t = brg * D, p1 = p[0] * D, l1 = p[1] * D;
    var p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
    var l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return [p2 / D, l2 / D];
  }
  /* points along the great circle a -> b, one every stepKm at most (longitudes kept continuous for drawing across the dateline) */
  function path(a, b, stepKm) {
    var m = dist(a, b), n = Math.min(256, Math.max(1, Math.ceil(m / 1000 / (stepKm || 50))));
    if (n === 1) return [a, b];
    var p1 = a[0] * D, l1 = a[1] * D, p2 = b[0] * D, l2 = b[1] * D, out = [a], d = m / R;
    var x1 = Math.cos(p1) * Math.cos(l1), y1 = Math.cos(p1) * Math.sin(l1), z1 = Math.sin(p1), x2 = Math.cos(p2) * Math.cos(l2), y2 = Math.cos(p2) * Math.sin(l2), z2 = Math.sin(p2);
    var sd = Math.sin(d), prev = a[1];
    for (var i = 1; i < n; i++) {
      var f = i / n, s1 = Math.sin((1 - f) * d) / sd, s2 = Math.sin(f * d) / sd;
      var x = s1 * x1 + s2 * x2, y = s1 * y1 + s2 * y2, z = s1 * z1 + s2 * z2;
      var lo = Math.atan2(y, x) / D; while (lo - prev > 180) lo -= 360; while (prev - lo > 180) lo += 360; prev = lo;
      out.push([Math.atan2(z, Math.sqrt(x * x + y * y)) / D, lo]);
    }
    var lb = b[1]; while (lb - prev > 180) lb -= 360; while (prev - lb > 180) lb += 360;
    out.push([b[0], lb]);
    return out;
  }
  /* polygon area in square metres: corners moved to authalic latitude (the equal-area sphere of WGS 84), then spherical excess.
     Corners in order, not closed; sides are taken as great circles, which is within 0.1 percent for any area a country wide */
  var E2 = F * (2 - F), EE = Math.sqrt(E2);
  function qf(phi) { var s = Math.sin(phi); return (1 - E2) * (s / (1 - E2 * s * s) - 1 / (2 * EE) * Math.log((1 - EE * s) / (1 + EE * s))); }
  var QP = qf(Math.PI / 2);
  function authalic(lat) { return Math.asin(Math.max(-1, Math.min(1, qf(lat * D) / QP))); }
  function area(P) {
    if (!P || P.length < 3) return 0;
    var s = 0;
    for (var i = 0; i < P.length; i++) {
      var p = P[i], q = P[(i + 1) % P.length], dl = wrap(q[1] - p[1]) * D, t1 = Math.tan(authalic(p[0]) / 2), t2 = Math.tan(authalic(q[0]) / 2);
      s += 2 * Math.atan2(Math.tan(dl / 2) * (t1 + t2), 1 + t1 * t2);
    }
    s = Math.abs(s); if (s > 2 * Math.PI) s = 4 * Math.PI - s;
    return s * RA * RA;
  }

  /* ---------- UTM and MGRS (Krüger series, 6th order) ---------- */
  var K0 = 0.9996, E = Math.sqrt(F * (2 - F)), N = F / (2 - F), N2 = N * N, N3 = N2 * N, N4 = N3 * N, N5 = N4 * N, N6 = N5 * N;
  var AK = A / (1 + N) * (1 + N2 / 4 + N4 / 64 + N6 / 256);
  var AL = [0, N / 2 - 2 / 3 * N2 + 5 / 16 * N3 + 41 / 180 * N4 - 127 / 288 * N5 + 7891 / 37800 * N6,
    13 / 48 * N2 - 3 / 5 * N3 + 557 / 1440 * N4 + 281 / 630 * N5 - 1983433 / 1935360 * N6,
    61 / 240 * N3 - 103 / 140 * N4 + 15061 / 26880 * N5 + 167603 / 181440 * N6,
    49561 / 161280 * N4 - 179 / 168 * N5 + 6601661 / 7257600 * N6,
    34729 / 80640 * N5 - 3418889 / 1995840 * N6, 212378941 / 319334400 * N6];
  var BE = [0, N / 2 - 2 / 3 * N2 + 37 / 96 * N3 - 1 / 360 * N4 - 81 / 512 * N5 + 96199 / 604800 * N6,
    1 / 48 * N2 + 1 / 15 * N3 - 437 / 1440 * N4 + 46 / 105 * N5 - 1118711 / 3870720 * N6,
    17 / 480 * N3 - 37 / 840 * N4 - 209 / 4480 * N5 + 5569 / 90720 * N6,
    4397 / 161280 * N4 - 11 / 504 * N5 - 830251 / 7257600 * N6,
    4583 / 161280 * N5 - 108847 / 3991680 * N6, 20648693 / 638668800 * N6];
  var BANDS = "CDEFGHJKLMNPQRSTUVWXX", COLS = ["ABCDEFGH", "JKLMNPQR", "STUVWXYZ"], ROWS = ["ABCDEFGHJKLMNPQRSTUV", "FGHJKLMNPQRSTUVABCDE"];
  function zoneOf(lat, lon) {
    var z = Math.floor((lon + 180) / 6) + 1; if (z > 60) z = 60;
    if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) z = 32;
    if (lat >= 72 && lat < 84 && lon >= 0 && lon < 42) z = lon < 9 ? 31 : lon < 21 ? 33 : lon < 33 ? 35 : 37;
    return z;
  }
  function toUtm(lat, lon, zone) {
    lon = wrap(lon);
    if (!(lat >= -80 && lat <= 84)) return null;
    var z = zone || zoneOf(lat, lon), l0 = ((z - 1) * 6 - 180 + 3) * D, phi = lat * D, lam = lon * D - l0;
    var tau = Math.tan(phi), sig = Math.sinh(E * Math.atanh(E * tau / Math.sqrt(1 + tau * tau)));
    var taup = tau * Math.sqrt(1 + sig * sig) - sig * Math.sqrt(1 + tau * tau);
    var xip = Math.atan2(taup, Math.cos(lam)), etap = Math.asinh(Math.sin(lam) / Math.sqrt(taup * taup + Math.cos(lam) * Math.cos(lam)));
    var xi = xip, eta = etap;
    for (var j = 1; j <= 6; j++) { xi += AL[j] * Math.sin(2 * j * xip) * Math.cosh(2 * j * etap); eta += AL[j] * Math.cos(2 * j * xip) * Math.sinh(2 * j * etap); }
    var e = K0 * AK * eta + 500000, n = K0 * AK * xi;
    if (lat < 0) n += 10000000;
    return { zone: z, south: lat < 0, e: e, n: n, band: BANDS.charAt(Math.min(20, Math.floor((lat + 80) / 8))) };
  }
  function fromUtm(zone, south, e, n) {
    var x = e - 500000, y = south ? n - 10000000 : n, eta = x / (K0 * AK), xi = y / (K0 * AK), xip = xi, etap = eta;
    for (var j = 1; j <= 6; j++) { xip -= BE[j] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta); etap -= BE[j] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta); }
    var sh = Math.sinh(etap), sx = Math.sin(xip), cx = Math.cos(xip), taup = sx / Math.sqrt(sh * sh + cx * cx), ti = taup, dt;
    var e2 = E * E, k = 0;
    do {
      var si = Math.sinh(E * Math.atanh(E * ti / Math.sqrt(1 + ti * ti))), tip = ti * Math.sqrt(1 + si * si) - si * Math.sqrt(1 + ti * ti);
      dt = (taup - tip) / Math.sqrt(1 + tip * tip) * (1 + (1 - e2) * ti * ti) / ((1 - e2) * Math.sqrt(1 + ti * ti));
      ti += dt;
    } while (Math.abs(dt) > 1e-12 && ++k < 20);
    return [Math.atan(ti) / D, wrap(Math.atan2(sh, cx) / D + (zone - 1) * 6 - 180 + 3)];
  }
  /* MGRS, e.g. "47P PR 62366 21280"; digits 1 to 5 per axis (5 = 1 m). null outside 80S to 84N */
  function mgrs(lat, lon, digits) {
    var u = toUtm(lat, lon); if (!u) return null;
    var dg = digits == null ? 5 : Math.max(1, Math.min(5, digits)), col = Math.floor(u.e / 100000), row = Math.floor(u.n / 100000) % 20;
    var sq = COLS[(u.zone - 1) % 3].charAt(col - 1) + ROWS[(u.zone - 1) % 2].charAt(row);
    var div = Math.pow(10, 5 - dg), ee = String(Math.floor((u.e % 100000) / div)), nn = String(Math.floor((u.n % 100000) / div));
    while (ee.length < dg) ee = "0" + ee; while (nn.length < dg) nn = "0" + nn;
    return (u.zone < 10 ? "0" : "") + u.zone + u.band + " " + sq + " " + ee + " " + nn;
  }
  /* an MGRS reference -> [lat, lon] of the south-west corner of the square it names, plus its size in metres; null if invalid */
  function fromMgrs(s) {
    var m = String(s || "").toUpperCase().replace(/\s+/g, "").match(/^(\d{1,2})([C-HJ-NP-X])([A-HJ-NP-Z])([A-HJ-NP-V])(\d*)$/);
    if (!m || m[5].length % 2 || m[5].length > 10) return null;
    var z = +m[1]; if (z < 1 || z > 60) return null;
    var band = m[2], col = COLS[(z - 1) % 3].indexOf(m[3]), row = ROWS[(z - 1) % 2].indexOf(m[4]);
    if (col < 0 || row < 0) return null;
    var h = m[5].length / 2, size = Math.pow(10, 5 - h), e = (col + 1) * 100000 + (h ? +m[5].slice(0, h) * size : 0), n = row * 100000 + (h ? +m[5].slice(h) * size : 0);
    var south = band < "N", bi = BANDS.indexOf(band), latB = -80 + bi * 8, lonC = (z - 1) * 6 - 180 + 3;
    var nb = toUtm(latB, lonC, z); if (!nb) return null;
    var base = Math.floor(nb.n / 100000) * 100000; if (south && latB < 0 && nb.n > 10000000) base = 0;
    while (n < base - 1) n += 2000000;
    var ll = fromUtm(z, south, e + size / 2, n + size / 2);
    return { lat: ll[0], lon: ll[1], size: size };
  }

  /* ---------- reading a typed position ---------- */
  function parse(s) {
    s = String(s || "").trim(); if (!s) return null;
    var g = fromMgrs(s); if (g) return { lat: g.lat, lon: g.lon, how: "MGRS" };
    var t = s.toUpperCase().replace(/[′’']/g, "'").replace(/[″”"]/g, '"').replace(/[º˚]/g, "°");
    /* split into the latitude and longitude halves at a comma, a slash, or the hemisphere letters */
    var parts = t.split(/\s*[,;\/]\s*/);
    if (parts.length !== 2) { var mm = t.match(/^([NS][^EW]*?)\s+([EW].*)$/) || t.match(/^([^NS]*[NS])\s*([^NS]*[EW])$/); if (mm) parts = [mm[1], mm[2]]; }
    if (parts.length !== 2) { var nums = t.match(/^\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*$/); if (nums) parts = [nums[1], nums[2]]; }
    if (parts.length !== 2) return null;
    function one(p, pos, neg) {
      var sign = 1; p = p.trim();
      if (p.indexOf(neg) >= 0) sign = -1; else if (p.indexOf(pos) < 0 && /^-/.test(p)) sign = -1;
      var n = p.replace(/[NSEW]/g, " ").match(/\d+(?:\.\d+)?/g); if (!n || n.length > 3) return NaN;
      var v = +n[0] + (n[1] ? +n[1] / 60 : 0) + (n[2] ? +n[2] / 3600 : 0);
      if (n.length > 1 && (+n[1] >= 60 || (n[2] && +n[2] >= 60))) return NaN;
      return sign * v;
    }
    var la = one(parts[0], "N", "S"), lo = one(parts[1], "E", "W");
    if (/[EW]/.test(parts[0]) && /[NS]/.test(parts[1])) { la = one(parts[1], "N", "S"); lo = one(parts[0], "E", "W"); }
    if (!isFinite(la) || !isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
    return { lat: la, lon: lo, how: "lat/lon" };
  }

  /* ---------- magnetic declination: World Magnetic Model 2025 ---------- */
  var WMM_EPOCH = 2025.0, WMM = [-29351.8,0,12,0,-1410.8,4545.4,9.7,-21.5,-2556.6,0,-11.6,0,2951.1,-3133.6,-5.2,-27.7,1649.3,-815.1,-8,-12.1,1361,0,-1.3,0,-2404.1,-56.6,-4.2,4,1243.8,237.5,0.4,-0.3,453.6,-549.5,-15.6,-4.1,895,0,-1.6,0,799.5,278.6,-2.4,-1.1,55.7,-133.9,-6,4.1,-281.1,212,5.6,1.6,12.1,-375.6,-7,-4.4,-233.2,0,0.6,0,368.9,45.4,1.4,-0.5,187.2,220.2,0,2.2,-138.7,-122.9,0.6,0.4,-142,43,2.2,1.7,20.9,106.1,0.9,1.9,64.4,0,-0.2,0,63.8,-18.4,-0.4,0.3,76.9,16.8,0.9,-1.6,-115.7,48.8,1.2,-0.4,-40.9,-59.8,-0.9,0.9,14.9,10.9,0.3,0.7,-60.7,72.7,0.9,0.9,79.5,0,-0,0,-77,-48.9,-0.1,0.6,-8.8,-14.4,-0.1,0.5,59.3,-1,0.5,-0.8,15.8,23.4,-0.1,0,2.5,-7.4,-0.8,-1,-11.1,-25.1,-0.8,0.6,14.2,-2.3,0.8,-0.2,23.2,0,-0.1,0,10.8,7.1,0.2,-0.2,-17.5,-12.6,0,0.5,2,11.4,0.5,-0.4,-21.7,-9.7,-0.1,0.4,16.9,12.7,0.3,-0.5,15,0.7,0.2,-0.6,-16.8,-5.2,-0,0.3,0.9,3.9,0.2,0.2,4.6,0,-0,0,7.8,-24.8,-0.1,-0.3,3,12.2,0.1,0.3,-0.2,8.3,0.3,-0.3,-2.5,-3.3,-0.3,0.3,-13.1,-5.2,0,0.2,2.4,7.2,0.3,-0.1,8.6,-0.6,-0.1,-0.2,-8.7,0.8,0.1,0.4,-12.9,10,-0.1,0.1,-1.3,0,0.1,0,-6.4,3.3,0,0,0.2,0,0.1,-0,2,2.4,0.1,-0.2,-1,5.3,-0,0.1,-0.6,-9.1,-0.3,-0.1,-0.9,0.4,0,0.1,1.5,-4.2,-0.1,0,0.9,-3.8,-0.1,-0.1,-2.7,0.9,-0,0.2,-3.9,-9.1,-0,-0,2.9,0,0,0,-1.5,0,-0,-0,-2.5,2.9,0,0.1,2.4,-0.6,0,-0,-0.6,0.2,0,0.1,-0.1,0.5,-0.1,-0,-0.6,-0.3,0,-0,-0.1,-1.2,-0,0.1,1.1,-1.7,-0.1,-0,-1,-2.9,-0.1,0,-0.2,-1.8,-0.1,0,2.6,-2.3,-0.1,0,-2,0,0,0,-0.2,-1.3,0,-0,0.3,0.7,-0,0,1.2,1,-0,-0.1,-1.3,-1.4,-0,0.1,0.6,-0,-0,-0,0.6,0.6,0.1,-0,0.5,-0.1,-0,-0,-0.1,0.8,0,0,-0.4,0.1,0,-0,-0.2,-1,-0.1,-0,-1.3,0.1,-0,0,-0.7,0.2,-0.1,-0.1], WM = null;
  function wmmInit() {
    var c = [], cd = [], k = [], sn = [], i, n, m, x = 0;
    for (i = 0; i <= 12; i++) { c.push(new Array(13).fill(0)); cd.push(new Array(13).fill(0)); k.push(new Array(13).fill(0)); sn.push(new Array(13).fill(0)); }
    for (n = 1; n <= 12; n++) for (m = 0; m <= n; m++) {
      var g = WMM[x++], h = WMM[x++], dg = WMM[x++], dh = WMM[x++];
      c[m][n] = g; cd[m][n] = dg; if (m !== 0) { c[n][m - 1] = h; cd[n][m - 1] = dh; }
    }
    sn[0][0] = 1;
    for (n = 1; n <= 12; n++) {
      sn[0][n] = sn[0][n - 1] * (2 * n - 1) / n;
      var j = 2;
      for (m = 0; m <= n; m++) {
        k[m][n] = ((n - 1) * (n - 1) - m * m) / ((2 * n - 1) * (2 * n - 3));
        if (m > 0) { var fl = (n - m + 1) * j / (n + m); sn[m][n] = sn[m - 1][n] * Math.sqrt(fl); j = 1; c[n][m - 1] *= sn[m][n]; cd[n][m - 1] *= sn[m][n]; }
        c[m][n] *= sn[m][n]; cd[m][n] *= sn[m][n];
      }
    }
    k[1][1] = 0;
    WM = { c: c, cd: cd, k: k };
  }
  /* declination in degrees (east positive) at lat, lon, height hKm, decimal year; magnetic = true - declination */
  function decl(lat, lon, year, hKm) {
    if (!WM) wmmInit();
    var c = WM.c, cd = WM.cd, k = WM.k, dt = (year == null ? decYear(new Date()) : year) - WMM_EPOCH, alt = hKm || 0;
    var a = 6378.137, b = 6356.7523142, re = 6371.2, a2 = a * a, b2 = b * b, c2 = a2 - b2, a4 = a2 * a2, b4 = b2 * b2, c4 = a4 - b4;
    var rl = wrap(lon) * D, rp = Math.max(-89.9999, Math.min(89.9999, lat)) * D, sl = Math.sin(rl), cl = Math.cos(rl), sp = Math.sin(rp), cp = Math.cos(rp), sp2 = sp * sp, cp2 = cp * cp;
    var q = Math.sqrt(a2 - c2 * sp2), q1 = alt * q, q2 = ((q1 + a2) / (q1 + b2)) * ((q1 + a2) / (q1 + b2));
    var ct = sp / Math.sqrt(q2 * cp2 + sp2), st = Math.sqrt(1 - ct * ct), r2 = alt * alt + 2 * q1 + (a4 - c4 * sp2) / (q * q), r = Math.sqrt(r2);
    var d = Math.sqrt(a2 * cp2 + b2 * sp2), ca = (alt + d) / r, sa = c2 * cp * sp / (r * d);
    var S = [0, sl], C = [1, cl], P = [], DP = [], i, n, m;
    for (i = 0; i <= 12; i++) { P.push(new Array(13).fill(0)); DP.push(new Array(13).fill(0)); }
    P[0][0] = 1;
    for (m = 2; m <= 12; m++) { S[m] = S[1] * C[m - 1] + C[1] * S[m - 1]; C[m] = C[1] * C[m - 1] - S[1] * S[m - 1]; }
    var aor = re / r, ar = aor * aor, br = 0, bt = 0, bp = 0;
    for (n = 1; n <= 12; n++) {
      ar *= aor;
      for (m = 0; m <= n; m++) {
        if (n === m) { P[m][n] = st * P[m - 1][n - 1]; DP[m][n] = st * DP[m - 1][n - 1] + ct * P[m - 1][n - 1]; }
        else if (n === 1 && m === 0) { P[m][n] = ct * P[m][n - 1]; DP[m][n] = ct * DP[m][n - 1] - st * P[m][n - 1]; }
        else if (n > 1 && n !== m) {
          if (m > n - 2) { P[m][n - 2] = 0; DP[m][n - 2] = 0; }
          P[m][n] = ct * P[m][n - 1] - k[m][n] * P[m][n - 2]; DP[m][n] = ct * DP[m][n - 1] - st * P[m][n - 1] - k[m][n] * DP[m][n - 2];
        }
        var tcmn = c[m][n] + dt * cd[m][n], tcnm = m !== 0 ? c[n][m - 1] + dt * cd[n][m - 1] : 0, par = ar * P[m][n], t1, t2;
        if (m === 0) { t1 = tcmn * C[m]; t2 = tcmn * S[m]; } else { t1 = tcmn * C[m] + tcnm * S[m]; t2 = tcmn * S[m] - tcnm * C[m]; }
        bt -= ar * t1 * DP[m][n]; bp += m * t2 * par; br += (n + 1) * t1 * par;
      }
    }
    bp /= st;
    var bx = -bt * ca - br * sa, by = bp;
    return Math.atan2(by, bx) / D;
  }
  function decYear(dt) { var y = dt.getUTCFullYear(), s = Date.UTC(y, 0, 1), e = Date.UTC(y + 1, 0, 1); return y + (dt.getTime() - s) / (e - s); }

  /* ---------- sun and moon (NOAA solar calculator equations) ---------- */
  function jd(ms) { return ms / 86400000 + 2440587.5; }
  function solar(ms) {
    var T = (jd(ms) - 2451545) / 36525, L0 = norm360(280.46646 + T * (36000.76983 + T * 0.0003032)), M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    var e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T), Mr = M * D;
    var Cc = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) + Math.sin(3 * Mr) * 0.000289;
    var om = 125.04 - 1934.136 * T, lam = L0 + Cc - 0.00569 - 0.00478 * Math.sin(om * D);
    var eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60, eps = eps0 + 0.00256 * Math.cos(om * D);
    var dec = Math.asin(Math.sin(eps * D) * Math.sin(lam * D)) / D, y = Math.tan(eps * D / 2) * Math.tan(eps * D / 2);
    var eqt = 4 / D * (y * Math.sin(2 * L0 * D) - 2 * e * Math.sin(Mr) + 4 * e * y * Math.sin(Mr) * Math.cos(2 * L0 * D) - 0.5 * y * y * Math.sin(4 * L0 * D) - 1.25 * e * e * Math.sin(2 * Mr));
    return { dec: dec, eqt: eqt };
  }
  /* UTC ms of the moment the sun's centre crosses altitude alt (degrees) on the local solar date that contains dayMs; rise=true for morning; null if it never does */
  function sunCross(dayMs, lat, lon, alt, rise) {
    var ld = new Date(dayMs + wrap(lon) * 240000), base = Date.UTC(ld.getUTCFullYear(), ld.getUTCMonth(), ld.getUTCDate()), t = base + (12 - wrap(lon) / 15) * 3600000;
    lon = wrap(lon);
    for (var i = 0; i < 3; i++) {
      var s = solar(t), cosH = (Math.sin(alt * D) - Math.sin(lat * D) * Math.sin(s.dec * D)) / (Math.cos(lat * D) * Math.cos(s.dec * D));
      if (cosH > 1 || cosH < -1) return null;
      var H = Math.acos(cosH) / D, noon = 720 - 4 * lon - s.eqt;
      t = base + (noon + (rise ? -4 : 4) * H) * 60000;
    }
    return t;
  }
  function sunAlt(ms, lat, lon) {
    var s = solar(ms), dt = new Date(ms), mins = dt.getUTCHours() * 60 + dt.getUTCMinutes() + dt.getUTCSeconds() / 60;
    var ha = (mins + s.eqt + 4 * lon) / 4 - 180;
    return Math.asin(Math.sin(lat * D) * Math.sin(s.dec * D) + Math.cos(lat * D) * Math.cos(s.dec * D) * Math.cos(ha * D)) / D;
  }
  /* moon: fraction lit (0 to 1) and whether waxing, from the mean synodic month (good to a few percent) */
  function moon(ms) {
    var syn = 29.530588853, ref = Date.UTC(2000, 0, 6, 18, 14), age = (((ms - ref) / 86400000) % syn + syn) % syn;
    return { lit: (1 - Math.cos(2 * Math.PI * age / syn)) / 2, waxing: age < syn / 2, age: age };
  }
  /* the sun for a place on the local date containing dayMs: BMNT (nautical dawn), civil dawn, sunrise, sunset, civil dusk, EENT */
  function sun(dayMs, lat, lon) {
    return { bmnt: sunCross(dayMs, lat, lon, -12, true), civilDawn: sunCross(dayMs, lat, lon, -6, true), rise: sunCross(dayMs, lat, lon, -0.833, true),
      set: sunCross(dayMs, lat, lon, -0.833, false), civilDusk: sunCross(dayMs, lat, lon, -6, false), eent: sunCross(dayMs, lat, lon, -12, false),
      moon: moon(dayMs) };
  }

  /* ---------- formatting ---------- */
  var UNITS = { km: { big: 1000, name: "km", small: 1, sname: "m" }, mi: { big: 1609.344, name: "mi", small: 0.3048, sname: "ft" }, nm: { big: 1852, name: "nm", small: 1, sname: "m" } };
  function fmtDist(m, u) {
    var U = UNITS[u] || UNITS.km, v = m / U.big;
    if (u !== "nm" && v < (u === "mi" ? 0.1 : 1)) { var s = m / U.small; return (s === 0 ? "0" : s < 10 ? s.toFixed(1) : Math.round(s).toLocaleString("en-GB")) + " " + U.sname; }
    return (v < 10 ? v.toFixed(2) : v < 1000 ? v.toFixed(1) : Math.round(v).toLocaleString("en-GB")) + " " + U.name;
  }
  function fmtArea(m2, u) {
    if (u === "mi") { var a = m2 / 2589988.11; return a < 0.1 ? Math.round(m2 / 4046.856).toLocaleString("en-GB") + " acres" : (a < 100 ? a.toFixed(2) : Math.round(a).toLocaleString("en-GB")) + " sq mi"; }
    if (u === "nm") { var b = m2 / 3429904; return (b < 100 ? b.toFixed(2) : Math.round(b).toLocaleString("en-GB")) + " sq nm"; }
    var k = m2 / 1e6; return k < 1 ? (m2 / 1e4).toFixed(2) + " ha" : (k < 100 ? k.toFixed(2) : Math.round(k).toLocaleString("en-GB")) + " km²";
  }
  function pad3(n) { var s = String(n); while (s.length < 3) s = "0" + s; return s; }
  function fmtBrg(deg, mils) { deg = norm360(deg); if (mils) { var m = Math.round(deg * 6400 / 360) % 6400; var s = String(m); while (s.length < 4) s = "0" + s; return s + " mils"; } return pad3(Math.round(deg) % 360) + "°"; }
  function fmtLL(lat, lon, dp) { dp = dp == null ? 5 : dp; return Math.abs(lat).toFixed(dp) + "°" + (lat < 0 ? "S" : "N") + " " + Math.abs(wrap(lon)).toFixed(dp) + "°" + (wrap(lon) < 0 ? "W" : "E"); }
  function fmtDms(lat, lon) {
    function f(v, p, n, w) { var a = Math.abs(v), d = Math.floor(a), mf = (a - d) * 60, m = Math.floor(mf), s = (mf - m) * 60; if (s >= 59.95) { s = 0; m++; } if (m >= 60) { m = 0; d++; } var ds = String(d); while (ds.length < w) ds = "0" + ds; return ds + "°" + (m < 10 ? "0" : "") + m + "′" + (s < 9.95 ? "0" : "") + s.toFixed(1) + "″" + (v < 0 ? n : p); }
    return f(lat, "N", "S", 2) + " " + f(wrap(lon), "E", "W", 3);
  }

  root.OSAP_GEO = { wrap: wrap, inverse: inverse, dist: dist, dest: dest, path: path, area: area, toUtm: toUtm, fromUtm: fromUtm, mgrs: mgrs, fromMgrs: fromMgrs,
    parse: parse, decl: decl, decYear: decYear, sun: sun, sunAlt: sunAlt, moon: moon, fmtDist: fmtDist, fmtArea: fmtArea, fmtBrg: fmtBrg, fmtLL: fmtLL, fmtDms: fmtDms,
    UNITS: UNITS, MODEL: "WMM2025" };
})(typeof window !== "undefined" ? window : globalThis);
