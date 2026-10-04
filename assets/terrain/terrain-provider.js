/* AXIOM OSAP terrain provider: turns "the ground round this point at this resolution" into an elevation grid for the terrain
   engine, from whichever elevation sources are registered. The engine never knows where heights come from, so sources can
   be added or swapped (tiles saved on the device, a finer national model, a surface model with buildings) without touching it.

   A source registers itself in window.OSAP_TERRAIN_PROVIDERS:
     { id, label, kind: "DEM" (bare ground) | "DSM" (ground + buildings and trees), order (lower is tried first),
       maxZoom(lat, lon), covers(z, x, y), tile(z, x, y, signal) -> Promise<Float32Array(65536) of metres, NaN = no value> or null,
       attribution (HTML) }
   Tiles are Web Mercator 256 px. For each tile the sources are tried in order; a pixel the first has no value for is taken
   from the next. Only "DEM" sources are used until a terrain + structures mode exists.

   window.OSAP_TERRAIN_SRC = { around, box, grid, elevationAt, mpp, zoomFor, providers }  */
(function () {
  "use strict";
  var W = window;
  var LIST = W.OSAP_TERRAIN_PROVIDERS = W.OSAP_TERRAIN_PROVIDERS || [];
  var MAX_TILES = 100, CACHE_N = 64, PAR = 6;
  function provs(kind) { return LIST.filter(function (p) { return (p.kind || "DEM") === (kind || "DEM"); }).sort(function (a, b) { return (a.order || 0) - (b.order || 0); }); }
  /* metres on the ground per pixel at zoom z and latitude lat */
  function mpp(z, lat) { return 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z); }
  function gx(lon, z) { return (lon + 180) / 360 * 256 * Math.pow(2, z); }
  function gy(lat, z) { var s = Math.sin(Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * Math.pow(2, z); }
  function lonOf(X, z) { return X / (256 * Math.pow(2, z)) * 360 - 180; }
  function latOf(Y, z) { var n = Math.PI - 2 * Math.PI * Y / (256 * Math.pow(2, z)); return Math.atan(Math.sinh(n)) * 180 / Math.PI; }
  function maxZoomAt(lat, lon) { var m = 0; provs().forEach(function (p) { m = Math.max(m, p.maxZoom ? p.maxZoom(lat, lon) : 14); }); return m || 14; }
  /* the coarsest zoom whose pixels are no bigger than the cells, so no detail the source has is thrown away */
  function zoomFor(res, lat, lon) { var zx = maxZoomAt(lat, lon), z = 6; while (z < zx && mpp(z, lat) > res) z++; return z; }

  /* a grid of n x n cells of res metres centred on (lat, lon), covering radius metres */
  function around(lat, lon, radius, res) {
    var z = zoomFor(res, lat, lon), half = Math.ceil(radius / res), n = half * 2 + 1, cellPx = res / mpp(z, lat);
    /* keep the download in bounds: drop a zoom while the area needs more than MAX_TILES tiles */
    while (z > 6 && Math.pow(Math.ceil(n * cellPx / 256) + 1, 2) > MAX_TILES) { z--; cellPx /= 2; }
    var X = gx(lon, z), Y = gy(lat, z);
    return { z: z, n: n, w: n, h: n, half: half, cellPx: cellPx, x0: X - (half + 0.5) * cellPx, y0: Y - (half + 0.5) * cellPx, res: res, lat: lat, lon: lon };
  }
  /* a grid covering a box [s, w, n, e] (a line of sight, a profile) */
  function box(b, res) {
    var lat = (b[0] + b[2]) / 2, lon = (b[1] + b[3]) / 2, z = zoomFor(res, lat, lon), cellPx = res / mpp(z, lat);
    var x0 = gx(b[1], z), x1 = gx(b[3], z), y0 = gy(b[2], z), y1 = gy(b[0], z);
    var w = Math.max(2, Math.ceil((x1 - x0) / cellPx) + 3), h = Math.max(2, Math.ceil((y1 - y0) / cellPx) + 3);
    while (z > 6 && (Math.ceil(w * cellPx / 256) + 1) * (Math.ceil(h * cellPx / 256) + 1) > MAX_TILES) { z--; cellPx /= 2; x0 /= 2; y0 /= 2; }
    return { z: z, n: Math.max(w, h), w: w, h: h, cellPx: cellPx, x0: x0 - cellPx, y0: y0 - cellPx, res: res, lat: lat, lon: lon };
  }
  /* cell (fractional) <-> lat, lon for a grid spec */
  function toLL(s, i, j) { return [latOf(s.y0 + (j + 0.5) * s.cellPx, s.z), lonOf(s.x0 + (i + 0.5) * s.cellPx, s.z)]; }
  function toCell(s, lat, lon) { var z = s.z, X = gx(lon, z), wrap = 256 * Math.pow(2, z); while (X - s.x0 > wrap / 2) X -= wrap; while (s.x0 - X > wrap / 2) X += wrap; return [(X - s.x0) / s.cellPx - 0.5, (gy(lat, z) - s.y0) / s.cellPx - 0.5]; }

  /* ---------- tiles, with a small memory cache ---------- */
  var CACHE = new Map();
  function cacheGet(k) { var v = CACHE.get(k); if (v) { CACHE.delete(k); CACHE.set(k, v); } return v; }
  function cachePut(k, v) { CACHE.set(k, v); while (CACHE.size > CACHE_N) CACHE.delete(CACHE.keys().next().value); }
  /* one tile from the sources in order, filling gaps from the next; { h: Float32Array, src: [ids], nodata: count } */
  function tileOf(z, x, y, signal) {
    var key = z + "/" + x + "/" + y, hit = cacheGet(key);
    if (hit) return Promise.resolve(hit);
    var list = provs().filter(function (p) { return !p.covers || p.covers(z, x, y); });
    var h = null, used = [], i = 0, errs = 0;
    function next() {
      if (i >= list.length || (h && !gaps(h))) return finish();
      var p = list[i++];
      return p.tile(z, x, y, signal).then(function (t) {
        if (t) { if (!h) { h = new Float32Array(t); used.push(p.id); } else if (fill(h, t)) used.push(p.id); }
        return next();
      }, function (e) { if (signal && signal.aborted) throw e; errs++; return next(); });
    }
    function finish() {
      var out = { h: h, src: used, failed: !h && errs > 0 };
      if (!h) { out.h = new Float32Array(65536); out.h.fill(NaN); }
      if (h) cachePut(key, out);   /* failures are not kept: the next try asks again */
      return out;
    }
    return Promise.resolve().then(next);
  }
  function gaps(h) { for (var i = 0; i < h.length; i++) if (!(h[i] === h[i])) return true; return false; }
  function fill(h, t) { var n = 0; for (var i = 0; i < h.length; i++) if (!(h[i] === h[i]) && t[i] === t[i]) { h[i] = t[i]; n++; } return n > 0; }

  /* the grid's heights: { E (Float32Array w*h), rowM, coverage_pct, failedTiles, tiles, sources: [{id, label, attribution}] } */
  function grid(s, opt) {
    opt = opt || {};
    var z = s.z, nT = Math.pow(2, z), tx0 = Math.floor(s.x0 / 256), ty0 = Math.max(0, Math.floor(s.y0 / 256));
    var tx1 = Math.floor((s.x0 + s.w * s.cellPx) / 256), ty1 = Math.min(nT - 1, Math.floor((s.y0 + s.h * s.cellPx) / 256));
    var tw = tx1 - tx0 + 1, th = ty1 - ty0 + 1, MW = tw * 256, MH = th * 256, M = new Float32Array(MW * MH);
    var jobs = [], done = 0, failed = 0, used = {};
    for (var ty = ty0; ty <= ty1; ty++) for (var tx = tx0; tx <= tx1; tx++) jobs.push([tx, ty]);
    var k = 0;
    function worker() {
      if (k >= jobs.length) return Promise.resolve();
      if (opt.signal && opt.signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
      var j = jobs[k++], tx = j[0], ty = j[1], x = ((tx % nT) + nT) % nT;
      return tileOf(z, x, ty, opt.signal).then(function (t) {
        if (t.failed) failed++;
        t.src.forEach(function (id) { used[id] = 1; });
        var ox = (tx - tx0) * 256, oy = (ty - ty0) * 256;
        for (var r = 0; r < 256; r++) M.set(t.h.subarray(r * 256, r * 256 + 256), (oy + r) * MW + ox);
        done++; if (opt.prog) opt.prog(done, jobs.length);
        return worker();
      });
    }
    var ws = []; for (var p = 0; p < Math.min(PAR, jobs.length); p++) ws.push(worker());
    return Promise.all(ws).then(function () {
      var E = new Float32Array(s.w * s.h), rowM = new Float32Array(s.h), nan = 0, cnt = 0, half = (s.n - 1) / 2, circ = s.half != null;
      for (var j = 0; j < s.h; j++) {
        var Y = s.y0 + (j + 0.5) * s.cellPx;
        rowM[j] = s.cellPx * mpp(z, latOf(Y, z));
        var my = Y - ty0 * 256 - 0.5, iy = Math.floor(my), fy = my - iy;
        if (iy < 0) { iy = 0; fy = 0; } if (iy >= MH - 1) { iy = MH - 2; fy = 1; }
        for (var i = 0; i < s.w; i++) {
          var mx = s.x0 + (i + 0.5) * s.cellPx - tx0 * 256 - 0.5, ix = Math.floor(mx), fx = mx - ix;
          if (ix < 0) { ix = 0; fx = 0; } if (ix >= MW - 1) { ix = MW - 2; fx = 1; }
          var a = M[iy * MW + ix], b = M[iy * MW + ix + 1], c = M[(iy + 1) * MW + ix], d = M[(iy + 1) * MW + ix + 1];
          var v = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
          E[j * s.w + i] = v;
          if (!circ || (i - half) * (i - half) + (j - half) * (j - half) <= half * half) { cnt++; if (!(v === v)) nan++; }
        }
      }
      var src = provs().filter(function (p) { return used[p.id]; }).map(function (p) { return { id: p.id, label: p.label, attribution: p.attribution || "" }; });
      return { E: E, rowM: rowM, coverage_pct: cnt ? (1 - nan / cnt) * 100 : 0, failedTiles: failed, tiles: jobs.length, sources: src, z: z };
    });
  }
  /* the ground height at one point, from the finest tile the sources have */
  function elevationAt(lat, lon, opt) {
    opt = opt || {};
    var z = Math.min(maxZoomAt(lat, lon), 15), X = gx(lon, z), Y = gy(lat, z), n = Math.pow(2, z);
    var tx = Math.floor(X / 256), ty = Math.floor(Y / 256), x = ((tx % n) + n) % n;
    return tileOf(z, x, ty, opt.signal).then(function (t) {
      var px = Math.min(254.999, Math.max(0, X - tx * 256 - 0.5)), py = Math.min(254.999, Math.max(0, Y - ty * 256 - 0.5));
      var ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy, H = t.h;
      var v = (H[iy * 256 + ix] * (1 - fx) + H[iy * 256 + ix + 1] * fx) * (1 - fy) + (H[(iy + 1) * 256 + ix] * (1 - fx) + H[(iy + 1) * 256 + ix + 1] * fx) * fy;
      var src = provs().filter(function (p) { return t.src.indexOf(p.id) >= 0; }).map(function (p) { return { id: p.id, label: p.label }; });
      return { elev_m: v === v ? v : null, nodata: !(v === v), failed: t.failed, res_m: mpp(z, lat), z: z, sources: src };
    });
  }
  W.OSAP_TERRAIN_SRC = { around: around, box: box, grid: grid, elevationAt: elevationAt, toLL: toLL, toCell: toCell, mpp: mpp, zoomFor: zoomFor, providers: function () { return provs().slice(); }, gx: gx, gy: gy, latOf: latOf, lonOf: lonOf };
})();
