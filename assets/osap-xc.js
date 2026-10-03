/* AXIOM OSAP: cross-country route on foot, over open ground rather than roads and paths.
   Loaded on demand by the Route tab (Evacuation route, walking). It works out the least-time line between two points in this
   browser from two open, keyless global data sets, the same ones the Ground mobility overlay uses:
     - elevation from the AWS Terrain Tiles (terrarium PNG, about 30 to 90 m), for slope;
     - water from JRC Global Surface Water (how often each 30 m spot was water, 1984 to 2021).
   The area round the two points is cut into a grid of up to about 260 x 260 cells (finer for short trips, coarser for long ones,
   never finer than the elevation data). Moving between neighbouring cells takes the time Tobler's hiking function gives for that
   slope, at his off-path rate (0.6 of the on-path speed, so about 3 km/h on the flat). Slopes steeper than 40 degrees (the
   Ground mobility no-go for people on foot) and the sea are not crossed. Permanent water (lakes, wide rivers) can be crossed only
   at a heavy time cost, so the line looks for the narrowest crossing, and every crossing is reported: it needs a bridge, a ford
   or a boat. Seasonal water is slowed. A* over the grid finds the quickest line.
   It does not see forest, crops, swamp, walls, fences, private or military land, mines, or streams narrower than a cell. It is a
   planning estimate, not a route survey.
   window.OSAP_XCOUNTRY.route([lat, lon], [lat, lon], { prog }) -> Promise of
     { coords, m, s, legs, steps: [], src, road: false, xc: true, kmh, cellM, climb, descent, water: [{ p, m, along }], notes }
   It rejects with Error("too far: ...") past MAX_M in a straight line, Error("elevation: ...") when the tiles do not load,
   and Error("no way over open ground ...") when the end cannot be reached. Nothing here changes a record. */
(function () {
  "use strict";
  var W = window, D = document;
  if (W.OSAP_XCOUNTRY) return;
  var DEM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
  var GSW = "https://storage.googleapis.com/global-surface-water/tiles2021/occurrence/{z}/{x}/{y}.png";
  var MAX_M = 60000, CELLS = 260, MAX_TILES = 30, ZMAX = 13, ZMIN = 8;
  var STEEP = Math.tan(40 * Math.PI / 180), WATER_X = 15, SEASONAL_X = 1.6, OFFPATH = 0.6;
  var R = 6371008.8, WORLD = 40075016.686;

  function rad(d) { return d * Math.PI / 180; }
  function hav(a, b) {
    var p1 = rad(a[0]), p2 = rad(b[0]), dp = p2 - p1, dl = rad(b[1] - a[1]);
    var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  /* web mercator, in pixels at zoom z */
  function mx(lon, z) { return (lon + 180) / 360 * 256 * Math.pow(2, z); }
  function my(lat, z) { var s = Math.sin(rad(Math.max(-85, Math.min(85, lat)))); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * Math.pow(2, z); }
  function xlon(x, z) { return x / (256 * Math.pow(2, z)) * 360 - 180; }
  function ylat(y, z) { var n = Math.PI - 2 * Math.PI * y / (256 * Math.pow(2, z)); return 180 / Math.PI * Math.atan(Math.sinh(n)); }

  function loadImg(url) {
    return new Promise(function (res, rej) {
      var im = new Image(), t = setTimeout(function () { im.src = ""; rej(new Error("timeout")); }, 20000);
      im.crossOrigin = "anonymous"; im.decoding = "async";
      im.onload = function () { clearTimeout(t); res(im); }; im.onerror = function () { clearTimeout(t); rej(new Error("tile")); }; im.src = url;
    });
  }
  function pixels(im) {
    var c = D.createElement("canvas"); c.width = c.height = 256;
    var g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(im, 0, 0, 256, 256);
    return g.getImageData(0, 0, 256, 256).data;
  }

  /* a binary min-heap of cell indices keyed by f */
  function Heap(f) { this.a = []; this.f = f; }
  Heap.prototype.push = function (i) {
    var a = this.a, f = this.f, k = a.length; a.push(i);
    while (k > 0) { var p = (k - 1) >> 1; if (f[a[p]] <= f[i]) break; a[k] = a[p]; k = p; }
    a[k] = i;
  };
  Heap.prototype.pop = function () {
    var a = this.a, f = this.f, top = a[0], last = a.pop(), n = a.length, k = 0;
    if (!n) return top;
    while (true) {
      var l = 2 * k + 1, r = l + 1, m = k, fm = f[last];
      if (l < n && f[a[l]] < fm) { m = l; fm = f[a[l]]; }
      if (r < n && f[a[r]] < fm) m = r;
      if (m === k) break;
      a[k] = a[m]; k = m;
    }
    a[k] = last;
    return top;
  }

  /* the grid: zoom, origin and cell size in mercator pixels, metres per cell */
  function grid(a, b) {
    var d = hav(a, b), pad = Math.max(1500, d * 0.3);
    var lat0 = Math.min(a[0], b[0]), lat1 = Math.max(a[0], b[0]), lo0 = Math.min(a[1], b[1]), lo1 = Math.max(a[1], b[1]);
    var midLat = (lat0 + lat1) / 2, dLat = pad / 111320, dLon = pad / (111320 * Math.max(0.05, Math.cos(rad(midLat))));
    lat0 -= dLat; lat1 += dLat; lo0 -= dLon; lo1 += dLon;
    var extM = Math.max((lat1 - lat0) * 111320, (lo1 - lo0) * 111320 * Math.cos(rad(midLat)));
    var cellM = Math.max(30, extM / CELLS);
    function mpp(z) { return WORLD * Math.cos(rad(midLat)) / (256 * Math.pow(2, z)); }
    function tilesAt(z) { return (Math.floor(mx(lo1, z) / 256) - Math.floor(mx(lo0, z) / 256) + 1) * (Math.floor(my(lat0, z) / 256) - Math.floor(my(lat1, z) / 256) + 1); }
    /* the coarsest zoom whose pixels are no bigger than a cell, then coarser still while it needs too many tiles */
    var z = Math.max(ZMIN, Math.min(ZMAX, Math.ceil(Math.log(WORLD * Math.cos(rad(midLat)) / (256 * cellM)) / Math.LN2)));
    while (z > ZMIN && tilesAt(z) > MAX_TILES) z--;
    var mppZ = mpp(z);
    cellM = Math.max(cellM, mppZ);
    var cpx = cellM / mppZ, x0 = mx(lo0, z), y0 = my(lat1, z), x1 = mx(lo1, z), y1 = my(lat0, z);
    return { z: z, x0: x0, y0: y0, cpx: cpx, cellM: cellM, w: Math.max(2, Math.ceil((x1 - x0) / cpx)), h: Math.max(2, Math.ceil((y1 - y0) / cpx)), d: d };
  }

  /* elevation and water occurrence for every cell: { E: Float32Array (NaN where no tile), O: Uint8Array (0-100, 255 unknown) } */
  function rasters(g, prog) {
    var z = g.z, n = Math.pow(2, z);
    var tx0 = Math.floor(g.x0 / 256), ty0 = Math.max(0, Math.floor(g.y0 / 256));
    var tx1 = Math.floor((g.x0 + g.w * g.cpx) / 256), ty1 = Math.min(n - 1, Math.floor((g.y0 + g.h * g.cpx) / 256));
    var tw = tx1 - tx0 + 1, th = ty1 - ty0 + 1, total = tw * th * 2, done = 0, demFail = 0, watFail = 0, tiles = {};
    var jobs = [];
    for (var ty = ty0; ty <= ty1; ty++) for (var tx = tx0; tx <= tx1; tx++) (function (tx, ty) {
      var x = ((tx % n) + n) % n, key = tx + "/" + ty, u = function (s) { return s.replace("{z}", z).replace("{x}", x).replace("{y}", ty); };
      tiles[key] = {};
      jobs.push(loadImg(u(DEM)).then(function (im) { tiles[key].dem = pixels(im); }, function () { demFail++; }).then(function () { done++; if (prog) prog(done, total); }));
      jobs.push(loadImg(u(GSW)).then(function (im) { tiles[key].wat = pixels(im); }, function () { watFail++; }).then(function () { done++; if (prog) prog(done, total); }));
    })(tx, ty);
    return Promise.all(jobs).then(function () {
      var N = g.w * g.h, E = new Float32Array(N), O = new Uint8Array(N), k = Math.max(1, Math.min(3, Math.floor(g.cpx)));
      function at(px, py) {
        var tx = Math.floor(px / 256), ty = Math.floor(py / 256), t = tiles[tx + "/" + ty];
        if (!t) return null;
        return { t: t, i: (Math.min(255, Math.max(0, Math.floor(py - ty * 256))) * 256 + Math.min(255, Math.max(0, Math.floor(px - tx * 256)))) * 4 };
      }
      for (var cy = 0; cy < g.h; cy++) for (var cx = 0; cx < g.w; cx++) {
        var c = cy * g.w + cx, pcx = g.x0 + (cx + 0.5) * g.cpx, pcy = g.y0 + (cy + 0.5) * g.cpx;
        var q = at(pcx, pcy);
        E[c] = q && q.t.dem ? q.t.dem[q.i] * 256 + q.t.dem[q.i + 1] + q.t.dem[q.i + 2] / 256 - 32768 : NaN;
        /* water: the share of k x k samples in the cell that are water most years */
        var wet = 0, seas = 0, seen = 0;
        for (var j = 0; j < k; j++) for (var i = 0; i < k; i++) {
          var s = at(g.x0 + (cx + (i + 0.5) / k) * g.cpx, g.y0 + (cy + (j + 0.5) / k) * g.cpx);
          if (!s || !s.t.wat) continue;
          seen++;
          if (s.t.wat[s.i + 3] === 0) continue;
          /* JRC palette runs red (rarely water) to blue (always water); blue channel ~ occurrence (as in the mobility overlay) */
          var occ = s.t.wat[s.i + 2] / 2.54;
          if (occ >= 60) wet++; else if (occ >= 10) seas++;
        }
        O[c] = !seen ? 255 : wet * 2 >= seen ? 100 : (wet + seas) * 2 >= seen ? 30 : 0;
      }
      return { E: E, O: O, demFail: demFail, watFail: watFail, tiles: tw * th };
    });
  }

  /* Tobler's hiking function, off-path, in metres per second for a grade (rise over run) */
  function speed(gr) { return OFFPATH * 6 * Math.exp(-3.5 * Math.abs(gr + 0.05)) / 3.6; }
  var VMAX = speed(-0.05);

  function search(g, ras, ai, bi) {
    var Wd = g.w, H = g.h, N = Wd * H, E = ras.E, O = ras.O;
    var gs = new Float64Array(N), f = new Float64Array(N), from = new Int32Array(N), shut = new Uint8Array(N);
    gs.fill(Infinity); from.fill(-1);
    var bx = bi % Wd, by = (bi / Wd) | 0, cm = g.cellM;
    /* the sea (elevation at or below 0, as in the mobility overlay); a cell with no elevation is crossed as level, unknown ground */
    function blocked(c) { return c !== ai && c !== bi && E[c] <= 0; }
    function hcost(c) { var x = c % Wd, y = (c / Wd) | 0, dx = x - bx, dy = y - by; return Math.sqrt(dx * dx + dy * dy) * cm / VMAX; }
    var heap = new Heap(f), DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];
    gs[ai] = 0; f[ai] = hcost(ai); heap.push(ai);
    var pops = 0;
    while (heap.a.length) {
      var c = heap.pop();
      if (shut[c]) continue;
      shut[c] = 1; pops++;
      if (c === bi) break;
      var x = c % Wd, y = (c / Wd) | 0;
      for (var k = 0; k < 8; k++) {
        var nx = x + DX[k], ny = y + DY[k];
        if (nx < 0 || ny < 0 || nx >= Wd || ny >= H) continue;
        var nc = ny * Wd + nx;
        if (shut[nc] || blocked(nc)) continue;
        var run = (k < 4 ? 1 : Math.SQRT2) * cm, e0 = isFinite(E[c]) ? E[c] : E[nc], e1 = isFinite(E[nc]) ? E[nc] : e0, gr = (e1 - e0) / run;
        if (Math.abs(gr) > STEEP && nc !== bi && c !== ai) continue;
        var t = run / speed(gr);
        if (O[nc] === 100) t *= WATER_X; else if (O[nc] === 30) t *= SEASONAL_X;
        var ng = gs[c] + t;
        if (ng < gs[nc]) { gs[nc] = ng; from[nc] = c; f[nc] = ng + hcost(nc); heap.push(nc); }
      }
    }
    if (!isFinite(gs[bi])) return null;
    var path = [];
    for (var p = bi; p !== -1; p = from[p]) path.push(p);
    return { cells: path.reverse(), t: gs[bi], pops: pops };
  }

  function route(a, b, opt) {
    opt = opt || {};
    a = [+a[0], +a[1]]; b = [+b[0], +b[1]];
    /* the far end on the same side of the dateline as the start */
    while (b[1] - a[1] > 180) b[1] -= 360;
    while (b[1] - a[1] < -180) b[1] += 360;
    var g = grid(a, b);
    if (g.d > MAX_M) return Promise.reject(new Error("too far: cross-country lines are worked out up to " + MAX_M / 1000 + " km in a straight line, and this is " + Math.round(g.d / 1000) + " km"));
    return rasters(g, opt.prog).then(function (ras) {
      if (ras.demFail * 4 > ras.tiles) throw new Error("elevation: " + ras.demFail + " of " + ras.tiles + " elevation tiles did not load");
      var z = g.z;
      function cell(p) {
        var cx = Math.max(0, Math.min(g.w - 1, Math.floor((mx(p[1], z) - g.x0) / g.cpx))), cy = Math.max(0, Math.min(g.h - 1, Math.floor((my(p[0], z) - g.y0) / g.cpx)));
        return cy * g.w + cx;
      }
      function ll(c) { var cx = c % g.w, cy = (c / g.w) | 0; return [ylat(g.y0 + (cy + 0.5) * g.cpx, z), xlon(g.x0 + (cx + 0.5) * g.cpx, z)]; }
      var ai = cell(a), bi = cell(b), res = search(g, ras, ai, bi);
      if (!res) throw new Error("no way over open ground: the sea or cliffs steeper than 40 degrees cut the start off from the end");
      /* the line: cell centres, collinear runs dropped, the exact ends put back */
      /* the time is walked again without the routing penalty for water: a crossing is reported (WX), not timed as a swim */
      var cells = res.cells, pts = [a], climb = 0, descent = 0, m = 0, s = 0, water = [], inWater = null, along = 0;
      for (var i = 0; i < cells.length; i++) {
        var c = cells[i], p = i === 0 ? a : i === cells.length - 1 ? b : ll(c);
        if (i) {
          var q = i === 1 ? a : ll(cells[i - 1]), dm = hav(q, p);
          m += dm; along += dm;
          var de = ras.E[c] - ras.E[cells[i - 1]];
          if (isFinite(de)) { if (de > 0) climb += de; else descent -= de; }
          s += dm / speed(isFinite(de) && dm > 0 ? de / dm : 0) * (ras.O[c] === 30 ? SEASONAL_X : 1);
        }
        if (ras.O[c] === 100) { if (!inWater) inWater = { p: p, start: along }; }
        else if (inWater) { water.push({ p: inWater.p, m: Math.max(g.cellM, along - inWater.start), along: inWater.start }); inWater = null; }
        if (i && i < cells.length - 1) {
          var n0 = cells[i - 1], n1 = cells[i + 1];
          if (n1 - c === c - n0 && ras.O[c] === ras.O[n0]) continue;
          pts.push(p);
        }
      }
      if (inWater) water.push({ p: inWater.p, m: Math.max(g.cellM, along - inWater.start), along: inWater.start });
      pts.push(b);
      var notes = [];
      if (ras.watFail * 4 > ras.tiles) notes.push("The surface water tiles did not load, so lakes and rivers were not avoided on this line.");
      if (ras.demFail) notes.push(ras.demFail + " of " + ras.tiles + " elevation tiles did not load; those patches were treated as unknown ground.");
      return {
        coords: pts, m: m, s: s, legs: [{ m: m, s: s }], steps: [], road: false, xc: true, kmh: Math.round(m / Math.max(1, s) * 36) / 10,
        src: { name: "OSAP cross-country estimate", data: "AWS Terrain Tiles (Mapzen); JRC Global Surface Water" },
        cellM: Math.round(g.cellM), climb: Math.round(climb), descent: Math.round(descent), water: water, notes: notes
      };
    });
  }

  W.OSAP_XCOUNTRY = { route: route, MAX_M: MAX_M, _speed: speed };
})();
