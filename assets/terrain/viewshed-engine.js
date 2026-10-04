/* AXIOM OSAP terrain engine: viewshed and line of sight on an elevation grid. No network, no map, no page: it is given a
   grid of ground heights and answers what the terrain allows. Runs in the viewshed worker (assets/terrain/viewshed-worker.js),
   on the page when workers are not available, and in node for the tests (tests/terrain.test.mjs).

   The grid: n x n cells (n odd) in Web Mercator, the observer at the centre cell. E[j * n + i] is the ground height in metres
   above sea level at the centre of cell (i, j), NaN where the elevation data has no value. rowM[j] is the ground size of one
   cell in metres on row j (Mercator cells shrink on the ground away from the equator, so it changes slightly from row to row).

   The model (Shane 2026-10-03):
     observer altitude = ground height at the observer + observer height
     target altitude   = ground height at the target + target height
     with Earth curvature, every height at ground distance d is lowered by d^2 / (2 R) x (1 - k): R = 6,371 km, k the
     refraction coefficient (0 = curvature only, 0.13 = usual optical refraction, 0.25 = radio, "4/3 Earth").
   A target is visible when the straight line from the observer to it clears every piece of ground in between.

   Viewshed method: a ray from the observer to every cell on the edge of the grid (so every cell is passed by at least one ray),
   sampled once per cell along the main axis with the ground height read bilinearly at the exact point. Along each ray the
   steepest angle to the ground so far is kept; a point is visible when the angle to (ground + target height) is at least that.
   A cell takes the answer of the ray that passes closest to its centre.
   No data: once a ray has crossed ground with no elevation value, a point beyond is UNKNOWN unless the known ground already
   hides it (unknown ground can only hide more). A point with no value itself is UNKNOWN. Unknown is never "not visible".

   Classes: 0 outside the range, 1 visible, 2 terrain-masked, 3 unknown (no elevation data). */
(function (root) {
  "use strict";
  var R_EARTH = 6371008.8;
  var OUT = 0, VIS = 1, MASK = 2, UNK = 3;

  function drop(d, o) { return o.curvature ? d * d / (2 * R_EARTH) * (1 - (o.k || 0)) : 0; }
  /* bilinear ground height at fractional cell (x, y); NaN when any corner has no value or the point is off the grid */
  function sample(E, n, x, y) {
    if (x < 0 || y < 0 || x > n - 1 || y > n - 1) return NaN;
    var ix = Math.floor(x), iy = Math.floor(y); if (ix >= n - 1) ix = n - 2; if (iy >= n - 1) iy = n - 2;
    var fx = x - ix, fy = y - iy, k = iy * n + ix;
    var a = E[k], b = E[k + 1], c = E[k + n], d = E[k + n + 1];
    if (fx === 0 && fy === 0) return a;
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  function rowScale(rowM, y) { var n = rowM.length, iy = Math.max(0, Math.min(n - 1, Math.round(y))); return rowM[iy]; }

  /* g: { E, n, rowM }; o: { obsH, tgtH, radius_m, curvature, k, rays (return per-ray samples) }
     returns { cls, blockD, obsMax, horizon, Z0, stats } */
  function viewshed(g, o) {
    var E = g.E, n = g.n, rowM = g.rowM, h = (n - 1) >> 1, c = h, N = n * n;
    var Zg = E[c * n + c];
    if (!(Zg === Zg)) throw new Error("No elevation at the observer point.");
    var Z0 = Zg + (+o.obsH || 0), tgtH = +o.tgtH || 0, R = +o.radius_m || Infinity;
    var cls = new Uint8Array(N), blockD = new Float32Array(N), obsMax = new Float32Array(N), off = new Uint8Array(N);
    blockD.fill(NaN); obsMax.fill(NaN); off.fill(255);
    var rays = o.rays ? [] : null, horizon = [];
    cls[c * n + c] = VIS; off[c * n + c] = 0;
    var mid = rowM[c];
    /* the edge cells, in azimuth order clockwise from north: top row left to right... */
    var edge = [];
    for (var i = 0; i < n; i++) edge.push([i, 0]);
    for (var j = 1; j < n; j++) edge.push([n - 1, j]);
    for (i = n - 2; i >= 0; i--) edge.push([i, n - 1]);
    for (j = n - 2; j >= 1; j--) edge.push([0, j]);
    /* start at north (the top row's middle) so the horizon runs N, E, S, W */
    edge = edge.slice(c).concat(edge.slice(0, c));
    for (var r = 0; r < edge.length; r++) {
      var ex = edge[r][0] - c, ey = edge[r][1] - c, steps = Math.max(Math.abs(ex), Math.abs(ey));
      var len = Math.sqrt(ex * ex + ey * ey) / steps;   /* cells travelled per step */
      var maxS = -Infinity, dMax = NaN, zMax = NaN, unk = false, lastVis = 0, lastVisXY = null, ray = rays ? [] : null;
      for (var s = 1; s <= steps; s++) {
        var fx = c + ex * s / steps, fy = c + ey * s / steps;
        var d = len * s * (mid + rowScale(rowM, fy)) / 2;
        if (d > R) break;
        var z = sample(E, n, fx, fy), rx = Math.round(fx), ry = Math.round(fy), k2 = ry * n + rx;
        var ox = fx - rx, oy = fy - ry, q = Math.min(254, Math.round(Math.sqrt(ox * ox + oy * oy) * 300)), mine = q < off[k2];
        if (mine) off[k2] = q;
        if (ray) ray.push(d, z);
        if (!(z === z)) { unk = true; if (mine) { cls[k2] = UNK; blockD[k2] = NaN; obsMax[k2] = zMax; } continue; }
        var dr = drop(d, o), st = (z + tgtH - dr - Z0) / d, cl;
        if (st >= maxS) cl = unk ? UNK : VIS; else cl = MASK;
        if (mine) { cls[k2] = cl; blockD[k2] = cl === MASK ? dMax : NaN; obsMax[k2] = zMax; }
        if (cl === VIS) { lastVis = d; lastVisXY = [fx, fy]; }
        var sg = (z - dr - Z0) / d;
        if (sg > maxS) { maxS = sg; dMax = d; zMax = z; }
      }
      horizon.push({ az: (Math.atan2(ex, -ey) * 180 / Math.PI + 360) % 360, d: lastVis, x: lastVisXY ? lastVisXY[0] : c, y: lastVisXY ? lastVisXY[1] : c, maxAngle: Math.atan(maxS) * 180 / Math.PI, dMax: dMax });
      if (rays) rays.push(ray);
    }
    var v = 0, m = 0, u = 0;
    for (var p = 0; p < N; p++) { var x = cls[p]; if (x === VIS) v++; else if (x === MASK) m++; else if (x === UNK) u++; }
    var inside = v + m + u;
    return {
      cls: cls, blockD: blockD, obsMax: obsMax, horizon: horizon, rays: rays, Z0: Z0, Zg: Zg,
      stats: { cells: inside, visible: v, masked: m, unknown: u, visible_pct: inside ? v / inside * 100 : 0, unknown_pct: inside ? u / inside * 100 : 0 }
    };
  }

  /* Line of sight between two points of the same grid (fractional cells). a, b: [x, y]; o: { hA, hB, curvature, k }.
     Samples the ground about every half cell, then judges it with losAlong, so the two always agree. */
  function los(g, a, b, o) {
    var E = g.E, n = g.n, rowM = g.rowM;
    var dx = b[0] - a[0], dy = b[1] - a[1], cellsLen = Math.sqrt(dx * dx + dy * dy);
    var steps = Math.max(2, Math.ceil(cellsLen * 2));
    var scale = (rowScale(rowM, a[1]) + rowScale(rowM, b[1])) / 2, D = cellsLen * scale, samples = [];
    for (var s = 0; s <= steps; s++) { var t = s / steps, z = sample(E, n, a[0] + dx * t, a[1] + dy * t); samples.push({ d: D * t, z: z, nodata: !(z === z) }); }
    return losAlong(samples, o);
  }
  /* Line of sight along a sampled line: samples [{ d (metres from A), z (ground, NaN = no value) }], the first at A and the
     last at B. o: { hA, hB, curvature, k }. Returns the profile and the verdict:
     { dist, zA, zB, ZA, ZB, maxZ, maxD, los: "CLEAR" | "BLOCKED" | "UNKNOWN", blockD (first ground above the line), samples } */
  function losAlong(samples, o) {
    var last = samples.length - 1, D = samples[last].d, zA = samples[0].z, zB = samples[last].z;
    var ZA = zA + (+o.hA || 0), ZB = zB + (+o.hB || 0) - drop(D, o);
    var out = { dist: D, zA: zA, zB: zB, ZA: ZA, ZB: ZB + drop(D, o), maxZ: NaN, maxD: NaN, los: "CLEAR", blockD: NaN, samples: samples };
    if (!(zA === zA) || !(zB === zB)) out.los = "UNKNOWN";
    var unk = false;
    for (var s = 1; s < last; s++) {
      var z = samples[s].z, d = samples[s].d;
      if (!(z === z)) { unk = true; continue; }
      if (!(z <= out.maxZ)) { out.maxZ = z; out.maxD = d; }
      var line = ZA + (ZB - ZA) * (D ? d / D : 0);
      if (z - drop(d, o) > line && out.los !== "BLOCKED") { out.los = "BLOCKED"; out.blockD = d; }
    }
    if (out.los === "CLEAR" && unk) out.los = "UNKNOWN";
    return out;
  }

  /* every other few cells: a quick first picture before the full grid (the progressive pass) */
  function coarsen(g, f) {
    var n = g.n, h = (n - 1) >> 1, hc = Math.floor(h / f), nc = hc * 2 + 1, E = new Float32Array(nc * nc), rowM = new Float32Array(nc);
    for (var j = 0; j < nc; j++) {
      var sj = h + (j - hc) * f; rowM[j] = g.rowM[sj] * f;
      for (var i = 0; i < nc; i++) E[j * nc + i] = g.E[sj * n + h + (i - hc) * f];
    }
    return { E: E, n: nc, rowM: rowM, f: f };
  }

  var API = { viewshed: viewshed, los: los, losAlong: losAlong, sample: sample, coarsen: coarsen, drop: drop, R_EARTH: R_EARTH, OUT: OUT, VIS: VIS, MASK: MASK, UNK: UNK, version: "osap-viewshed/1" };
  root.OSAP_VS = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof self !== "undefined" ? self : this);
