/* AXIOM OSAP · LiDAR: where real LiDAR elevation exists, shading drawn from it, and LiDAR heights for Terrain analysis.
   Map overlays > Elevation and terrain analysis gets two rows (both off until switched on, kept on this device in
   localStorage "osap-lidar", and kept across data set changes like the other elevation shading):
   - "LiDAR hillshade": shading computed in this browser from Mapterhorn elevation tiles. Mapterhorn
     (https://mapterhorn.com) joins about 150 national and regional elevation models, most of them airborne LiDAR at 0.25 to
     5 m (US 3DEP, England, Scotland, Wales, the Netherlands, Germany, France, Spain, Portugal, Switzerland, Austria, the
     Nordic and Baltic states, Poland, Canada, New Zealand, Australia, Japan and more), with Copernicus GLO-30 (about 30 m,
     from satellite radar) everywhere else. Keyless, no account, CORS open.
   - "LiDAR coverage": the footprint of every one of those models (Mapterhorn's coverage file), coloured by how fine it is,
     so it is plain where the heights are LiDAR and where they are 30 m satellite data. With it on, the legend names the
     model at the map centre with its resolution, producer and licence.
   Licences are the producers' own and differ by country: most are CC BY 4.0 or an open government licence, US data is
   public domain; each is shown with the source. The Copernicus GLO-30 licence requires credit. Nothing is used for any
   decision: elevation is display and terrain-model input only.
   Not every fine model is LiDAR (a few 5 to 20 m national models come from photogrammetry or older surveys), so the classes
   are named by resolution and the tap card gives the model's own name.
   API: window.OSAP_LIDAR = { CLASSES, classOf(res), at(lat, lon) -> Promise<{ sources:[{id,name,res,licence,producer,website}],
   best }>, bestAt(lat, lon), cachedBest(lat, lon), describe(points) -> Promise<{ share_pct, best, centre }>,
   dem(z, x, y, signal, size) -> Promise<{ h: Float32Array(size^2) metres (NaN = none), z: zoom of the data used } | null>,
   decodeMvt(buf), set(kind, on), on(kind) }. */
(function () {
  "use strict";
  var W = window, D = document;
  var MT = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp", COV = "https://download.mapterhorn.com/coverage.pmtiles",
    ATT = "https://download.mapterhorn.com/attribution.json", PMLIB = "assets/vendor/pmtiles-4.5.0.js", KEY = "osap-lidar";
  var ATTR = 'Elevation: <a href="https://mapterhorn.com/attribution/" target="_blank" rel="noopener">Mapterhorn</a> (national LiDAR and elevation models, each under its producer\'s licence; Copernicus GLO-30 &copy; DLR e.V., Airbus, ESA)';
  /* resolution classes, finest first; "max" is the coarsest resolution (m) in the class */
  var CLASSES = [
    { id: "l1", max: 1, name: "LiDAR 1 m or finer", col: "#1b5e20" },
    { id: "l2", max: 2.5, name: "LiDAR 2 to 2.5 m", col: "#43a047" },
    { id: "m5", max: 5, name: "5 m model (mostly LiDAR)", col: "#c0ca33" },
    { id: "m20", max: 20, name: "10 to 20 m national model", col: "#fb8c00" }
  ];
  var SAT = "Satellite only, about 30 m (Copernicus GLO-30)";
  function classOf(res) { for (var i = 0; i < CLASSES.length; i++) if (res <= CLASSES[i].max + 1e-9) return CLASSES[i]; return null; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function fmtRes(r) { return (r < 1 ? r.toFixed(2).replace(/0$/, "") : String(+r.toFixed(1))) + " m"; }
  function gx(lon, z) { return (lon + 180) / 360 * Math.pow(2, z); }
  function gy(lat, z) { var s = Math.sin(Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * Math.pow(2, z); }
  function mpp(z, lat) { return 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z); }

  /* ---------- source list (resolution, producer, licence) ---------- */
  var attP = null;
  function sources() {
    if (attP) return attP;
    attP = fetch(ATT, { mode: "cors" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(function (a) {
      var m = {};
      (a || []).forEach(function (s) { if (s && s.source) m[s.source] = { id: s.source, name: s.name || s.source, res: +s.resolution || 30, licence: s.license || "", producer: s.producer || "", website: s.website || "" }; });
      return m;
    });
    attP.catch(function () { attP = null; });
    return attP;
  }
  /* sources that are not regional models: the worldwide 30 m base and Mapterhorn's test sources */
  function skip(id) { return id === "glo30" || /^debug/.test(id); }

  /* ---------- Mapbox vector tiles: polygons and their "source" attribute (enough for the coverage file) ---------- */
  function decodeMvt(buf) {
    var b = new Uint8Array(buf), out = [];
    function varint(st) { var v = 0, s = 1, c; do { c = b[st.p++]; v += (c & 127) * s; s *= 128; } while (c & 128); return v; }
    function skipF(st, t) { if (t === 0) varint(st); else if (t === 1) st.p += 8; else if (t === 2) { var l = varint(st); st.p += l; } else if (t === 5) st.p += 4; }
    /* the end of a length-delimited field: its length is read first, then the position after the length */
    function endOf(st) { var l = varint(st); return st.p + l; }
    function str(st, l) { var s = new TextDecoder().decode(b.subarray(st.p, st.p + l)); st.p += l; return s; }
    var st = { p: 0 };
    while (st.p < b.length) {
      var tag = varint(st), f = Math.floor(tag / 8), t = tag & 7;
      if (f !== 3 || t !== 2) { skipF(st, t); continue; }
      var end = endOf(st), keys = [], vals = [], feats = [], ext = 4096, name = "";
      while (st.p < end) {
        var tg = varint(st), lf = Math.floor(tg / 8), lt = tg & 7;
        if (lf === 1 && lt === 2) name = str(st, varint(st));
        else if (lf === 3 && lt === 2) keys.push(str(st, varint(st)));
        else if (lf === 4 && lt === 2) {
          var ve = endOf(st), v = null;
          while (st.p < ve) { var vt = varint(st), vf = Math.floor(vt / 8); if (vf === 1) v = str(st, varint(st)); else skipF(st, vt & 7); }
          vals.push(v);
        } else if (lf === 5 && lt === 0) ext = varint(st);
        else if (lf === 2 && lt === 2) {
          var fe = endOf(st), ft = { tags: [], type: 0, geom: [] };
          while (st.p < fe) {
            var g = varint(st), gf = Math.floor(g / 8);
            if ((gf === 2 || gf === 4) && (g & 7) === 2) { var pe = endOf(st), arr = gf === 2 ? ft.tags : ft.geom; while (st.p < pe) arr.push(varint(st)); }
            else if (gf === 3) ft.type = varint(st);
            else skipF(st, g & 7);
          }
          feats.push(ft);
        } else skipF(st, lt);
      }
      feats.forEach(function (ft) {
        if (ft.type !== 3) return;
        var props = {};
        for (var i = 0; i + 1 < ft.tags.length; i += 2) props[keys[ft.tags[i]]] = vals[ft.tags[i + 1]];
        /* geometry commands: MoveTo 1, LineTo 2, ClosePath 7; parameters zigzag-encoded and relative */
        var rings = [], ring = null, x = 0, y = 0, k = 0, G = ft.geom;
        while (k < G.length) {
          var cmd = G[k] & 7, cnt = G[k] >> 3; k++;
          if (cmd === 7) { if (ring && ring.length > 2) rings.push(ring); ring = null; continue; }
          for (var c = 0; c < cnt; c++) {
            var dx = G[k++], dy = G[k++]; x += (dx >>> 1) ^ -(dx & 1); y += (dy >>> 1) ^ -(dy & 1);
            if (cmd === 1) ring = [[x, y]]; else if (ring) ring.push([x, y]);
          }
        }
        out.push({ layer: name, extent: ext, props: props, rings: rings });
      });
      st.p = end;
    }
    return out;
  }
  /* even-odd point in polygon over all rings of a feature */
  function inside(rings, px, py) {
    var c = false;
    rings.forEach(function (r) {
      for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
        var a = r[i], b = r[j];
        if ((a[1] > py) !== (b[1] > py) && px < (b[0] - a[0]) * (py - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
      }
    });
    return c;
  }

  /* ---------- the coverage file (PMTiles of polygons, one per model, attribute "source") ---------- */
  var pmP = null, covMax = 12, QZ = 11;
  function pm() {
    if (pmP) return pmP;
    pmP = new Promise(function (ok, bad) {
      function go() { try { var p = new W.pmtiles.PMTiles(COV); p.getHeader().then(function (h) { covMax = h.maxZoom || covMax; ok(p); }, bad); } catch (e) { bad(e); } }
      if (W.pmtiles) return go();
      var s = D.createElement("script"); s.src = PMLIB; s.onload = go; s.onerror = function () { bad(new Error("no reader")); }; D.head.appendChild(s);
    });
    pmP.catch(function () { pmP = null; });
    return pmP;
  }
  var CT = new Map(), CT_N = 160;
  function covTile(z, x, y) {
    var k = z + "/" + x + "/" + y, v = CT.get(k);
    if (v) { CT.delete(k); CT.set(k, v); return v; }
    v = pm().then(function (p) { return p.getZxy(z, x, y); }).then(function (r) { return r && r.data ? decodeMvt(r.data) : []; });
    v.catch(function () { CT.delete(k); });
    CT.set(k, v); while (CT.size > CT_N) CT.delete(CT.keys().next().value);
    return v;
  }
  /* models covering one point, finest first */
  var BEST = new Map();
  function at(lat, lon) {
    return Promise.all([pm(), sources()]).then(function (r) {
      var z = Math.min(QZ, covMax), X = gx(lon, z), Y = gy(lat, z), tx = Math.floor(X), ty = Math.floor(Y);
      return covTile(z, tx, ty).then(function (fs) {
        var seen = {}, list = [];
        fs.forEach(function (f) {
          var id = f.props.source; if (!id || skip(id) || seen[id]) return;
          if (inside(f.rings, (X - tx) * f.extent, (Y - ty) * f.extent)) { seen[id] = 1; list.push(r[1][id] || { id: id, name: id, res: 30, licence: "", producer: "", website: "" }); }
        });
        list.sort(function (a, b) { return a.res - b.res; });
        var best = list[0] || null;
        BEST.set(Math.round(lat * 100) + "," + Math.round(lon * 100), best ? best.res : 0);
        if (BEST.size > 400) BEST.delete(BEST.keys().next().value);
        return { sources: list, best: best };
      });
    });
  }
  function bestAt(lat, lon) { return at(lat, lon).then(function (r) { return r.best ? r.best.res : null; }, function () { return null; }); }
  /* the finest model already looked up near this point (about 1 km), without waiting; null when unknown or none */
  function cachedBest(lat, lon) { var v = BEST.get(Math.round(lat * 100) + "," + Math.round(lon * 100)); return v ? v : null; }
  /* over a set of points: the share inside a LiDAR-class model (2.5 m or finer), the finest model seen, the model at the first */
  function describe(pts) {
    var n = 0, hit = 0, best = null, centre = null;
    return Promise.all(pts.map(function (p, i) {
      return at(p[0], p[1]).then(function (r) {
        n++; if (r.best && r.best.res <= 2.5) hit++;
        if (r.best && (!best || r.best.res < best.res)) best = r.best;
        if (i === 0) centre = r.best;
      }, function () {});
    })).then(function () { return n ? { share_pct: hit / n * 100, best: best, centre: centre, checked: n } : null; });
  }

  /* ---------- elevation from Mapterhorn tiles (512 px terrarium WebP) ----------
     A 256 px tile (z, x, y) is a quarter of the 512 px tile (z-1, x>>1, y>>1). Where the finest zoom is missing (404) the
     nearest coarser tile is enlarged; zoom 12 (512 px) exists everywhere. Missing tiles are remembered so a neighbour skips
     them, and so are their children (Mapterhorn's tiles form a pyramid). */
  var MISS = new Set(), MT_C = new Map(), MT_N = 48, TIMEOUT = 20000;
  function missing(Z, X, Y) { for (var z = Z; z >= 12; z--, X >>= 1, Y >>= 1) if (MISS.has(z + "/" + X + "/" + Y)) return true; return false; }
  function decode(blob) {
    return createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" }).then(function (img) {
      var w = img.width, c = D.createElement("canvas"); c.width = c.height = w;
      var g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
      var d = g.getImageData(0, 0, w, w).data, h = new Float32Array(w * w);
      for (var i = 0, k = 0; k < h.length; i += 4, k++) h[k] = d[i + 3] === 0 ? NaN : d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768;
      return { h: h, w: w };
    });
  }
  function mtTile(Z, X, Y, signal) {
    var k = Z + "/" + X + "/" + Y, v = MT_C.get(k);
    if (v) { MT_C.delete(k); MT_C.set(k, v); return v; }
    var ac = W.AbortController ? new AbortController() : null, t = setTimeout(function () { if (ac) ac.abort(); }, TIMEOUT);
    if (signal && ac) { if (signal.aborted) ac.abort(); else signal.addEventListener("abort", function () { ac.abort(); }); }
    v = fetch(MT.replace("{z}", Z).replace("{x}", X).replace("{y}", Y), { mode: "cors", signal: ac ? ac.signal : undefined }).then(function (r) {
      clearTimeout(t);
      if (r.status === 404) { MISS.add(k); return null; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.blob().then(decode);
    }, function (e) { clearTimeout(t); throw e; });
    v.catch(function () { MT_C.delete(k); });
    MT_C.set(k, v); while (MT_C.size > MT_N) MT_C.delete(MT_C.keys().next().value);
    return v;
  }
  /* metres over the 256 px tile (z, x, y) on a size x size grid (256, or 512 for twice the detail on a sharp screen),
     bilinear from the finest Mapterhorn tile there; { h, z (256 px zoom matching the data used) } */
  function dem(z, x, y, signal, size) {
    size = size === 512 ? 512 : 256;
    var Z0 = size === 512 ? z : z - 1;
    if (Z0 < 0) return Promise.resolve(null);
    function tryAt(Z) {
      var d = z - Z, X = x >> d, Y = y >> d;
      if (Z > 12 && missing(Z, X, Y)) return tryAt(Z - 1);
      return mtTile(Z, X, Y, signal).then(function (t) {
        if (!t) return Z > 0 ? tryAt(Z - 1) : null;
        /* the target's pixels inside this tile: offset and scale (the tile may be served at another size than 512) */
        var w = t.w, span = w / Math.pow(2, d), ox = (x - (X << d)) * span, oy = (y - (Y << d)) * span, f = span / size;
        var N = size, h = new Float32Array(N * N), H = t.h;
        for (var j = 0; j < N; j++) {
          var sy = oy + (j + 0.5) * f - 0.5, iy = Math.max(0, Math.min(w - 2, Math.floor(sy))), fy = Math.max(0, Math.min(1, sy - iy));
          for (var i = 0; i < N; i++) {
            var sx = ox + (i + 0.5) * f - 0.5, ix = Math.max(0, Math.min(w - 2, Math.floor(sx))), fx = Math.max(0, Math.min(1, sx - ix));
            var p = iy * w + ix;
            h[j * N + i] = (H[p] * (1 - fx) + H[p + 1] * fx) * (1 - fy) + (H[p + w] * (1 - fx) + H[p + w + 1] * fx) * fy;
          }
        }
        return { h: h, z: Z + 1, size: N };
      });
    }
    return tryAt(Math.min(Z0, 17));
  }

  /* ---------- on the map ---------- */
  var map = W.__asapMap, Lf = W.L;
  W.OSAP_LIDAR = { CLASSES: CLASSES, SAT: SAT, ATTR: ATTR, classOf: classOf, at: at, bestAt: bestAt, cachedBest: cachedBest, describe: describe, dem: dem, decodeMvt: decodeMvt, fmtRes: fmtRes,
    set: function () {}, on: function () { return false; } };
  if (!map || !Lf || /[?&](watchscan|wopen)=/.test(location.search)) return;
  var ST = { hs: false, cov: false }, cTok = 0;
  try { var s0 = JSON.parse(localStorage.getItem(KEY) || "{}"); ST.hs = !!s0.hs; ST.cov = !!s0.cov; } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(ST)); } catch (e) {} }
  function shadeOp() { var r = D.getElementById("ml-hsop"); return r ? +r.value : 0.55; }

  /* hillshade: Horn's method, sun from the north-west at 45 degrees, flat ground white so it multiplies cleanly into the base map */
  var HS = Lf.GridLayer.extend({
    createTile: function (c, done) {
      /* drawn at 512 px into the 256 px tile: twice the detail on a sharp screen, and one zoom deeper into the LiDAR */
      var N = 512, cv = D.createElement("canvas"); cv.width = cv.height = N;
      dem(c.z, c.x, c.y, null, N).then(function (r) {
        if (!r) return done(null, cv);
        var h = r.h, g = cv.getContext("2d"), im = g.createImageData(N, N), d = im.data, M = N - 1;
        var lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (c.y + 0.5) / Math.pow(2, c.z)))) * 180 / Math.PI, cs = mpp(c.z, lat) * 256 / N * 8;
        var az = 135 * Math.PI / 180, alt = 45 * Math.PI / 180, sa = Math.sin(alt), ca = Math.cos(alt);   /* sun at 315 degrees (north-west), as a maths angle */
        function e(i, j) { i = i < 0 ? 0 : i > M ? M : i; j = j < 0 ? 0 : j > M ? M : j; var v = h[j * N + i]; return v === v ? v : 0; }
        for (var j = 0; j < N; j++) for (var i = 0; i < N; i++) {
          var k = (j * N + i) * 4, v = h[j * N + i];
          if (!(v === v)) { d[k + 3] = 0; continue; }
          var dzdx = ((e(i + 1, j - 1) + 2 * e(i + 1, j) + e(i + 1, j + 1)) - (e(i - 1, j - 1) + 2 * e(i - 1, j) + e(i - 1, j + 1))) / cs;
          var dzdy = ((e(i - 1, j + 1) + 2 * e(i, j + 1) + e(i + 1, j + 1)) - (e(i - 1, j - 1) + 2 * e(i, j - 1) + e(i + 1, j - 1))) / cs;
          var slope = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)), aspect = Math.atan2(dzdy, -dzdx);
          var sh = sa * Math.cos(slope) + ca * Math.sin(slope) * Math.cos(az - aspect);
          var o = Math.max(0, Math.min(255, Math.round(255 * sh / sa)));
          d[k] = d[k + 1] = d[k + 2] = o; d[k + 3] = 255;
        }
        g.putImageData(im, 0, 0); done(null, cv);
      }, function (er) { done(er, cv); });
      return cv;
    }
  });
  /* coverage: each model's footprint filled in its class colour, coarse first so finer models sit on top */
  var COVL = Lf.GridLayer.extend({
    createTile: function (c, done) {
      var cv = D.createElement("canvas"); cv.width = cv.height = 256;
      var cz = Math.min(c.z, covMax), k = c.z - cz, X = c.x >> k, Y = c.y >> k, sub = Math.pow(2, k);
      Promise.all([covTile(cz, X, Y), sources()]).then(function (r) {
        var g = cv.getContext("2d"), m = r[1];
        var fs = r[0].filter(function (f) { return f.props.source && !skip(f.props.source); }).map(function (f) { var s = m[f.props.source]; return { f: f, res: s ? s.res : 30 }; });
        fs.sort(function (a, b) { return b.res - a.res; });
        fs.forEach(function (q) {
          var cl = classOf(q.res); if (!cl) return;
          var f = q.f, sc = 256 * sub / f.extent, ox = (c.x - X * sub) * 256, oy = (c.y - Y * sub) * 256;
          g.beginPath();
          f.rings.forEach(function (ring) { ring.forEach(function (p, i) { var px = p[0] * sc - ox, py = p[1] * sc - oy; if (i) g.lineTo(px, py); else g.moveTo(px, py); }); g.closePath(); });
          g.fillStyle = cl.col; g.globalAlpha = 0.5; g.fill("evenodd");
          g.globalAlpha = 0.9; g.lineWidth = 1; g.strokeStyle = cl.col; g.stroke();
        });
        done(null, cv);
      }, function (er) { done(er, cv); });
      return cv;
    }
  });
  var L_HS = null, L_COV = null;
  function set(kind, on) {
    ST[kind] = !!on; save();
    if (kind === "hs") {
      if (on && !L_HS) L_HS = new HS({ zIndex: 6, className: "osap-hs", opacity: shadeOp(), maxZoom: 20, maxNativeZoom: 18, attribution: ATTR }).addTo(map);
      if (!on && L_HS) { map.removeLayer(L_HS); L_HS = null; }
    } else {
      if (on && !L_COV) {
        L_COV = new COVL({ zIndex: 7, opacity: 0.85, maxZoom: 20, maxNativeZoom: 16, attribution: 'LiDAR coverage: <a href="https://mapterhorn.com/coverage/" target="_blank" rel="noopener">Mapterhorn</a>' }).addTo(map);
        L_COV.on("tileerror", note);
      }
      if (!on && L_COV) { map.removeLayer(L_COV); L_COV = null; }
    }
    var i = D.querySelector('input[data-lidar="' + kind + '"]'); if (i && i.checked !== !!on) i.checked = !!on;
    var k = D.getElementById("ml-lidarkey"); if (k) k.hidden = !ST.cov;
    if (kind === "cov" && on) centre();
  }
  function note() { var n = D.getElementById("ml-lidarnote"); if (n) n.textContent = "The coverage file did not load. Check the connection; the map tries again as you move."; }
  function legend() {
    return '<div class="mlkey" id="ml-lidarkey"' + (ST.cov ? "" : " hidden") + ">" + CLASSES.map(function (c) { return '<span style="background:' + c.col + ';border-radius:2px"></span>' + esc(c.name); }).join(" ") +
      ' <span style="background:transparent;border:1px solid #999;border-radius:2px"></span>No colour: ' + esc(SAT) + "." +
      '<i id="ml-lidarnote" style="display:block"></i></div>';
  }
  function rows() {
    var box = D.getElementById("ml-elev");
    if (!box || box.querySelector("[data-lidar]")) return !!box;
    var at0 = box.querySelector("input[data-hs]"), ref = at0 ? at0.closest("label") : box.querySelector(".mlop");
    var w = D.createElement("div"); w.id = "ml-lidar";
    w.innerHTML = '<label class="mlrow"><input type="checkbox" data-lidar="hs"' + (ST.hs ? " checked" : "") + "><span><b>LiDAR hillshade</b><i>Shading from national LiDAR wherever it is published (US, Canada, most of Europe, Australia, New Zealand, Japan and more), about 30 m satellite elevation elsewhere. Drawn on this device from Mapterhorn tiles; sharpest zoomed in on a Satellite base map, which goes closest.</i></span></label>" +
      '<label class="mlrow"><input type="checkbox" data-lidar="cov"' + (ST.cov ? " checked" : "") + "><span><b>LiDAR coverage</b><i>Colours the areas that have real LiDAR or a fine national elevation model, by resolution. Uncoloured land has satellite elevation only.</i></span></label>" + legend();
    if (ref) box.insertBefore(w, ref); else box.appendChild(w);
    w.addEventListener("change", function (e) { var t = e.target; if (t.dataset && t.dataset.lidar) set(t.dataset.lidar, t.checked); });
    return true;
  }
  (function wait(n) { if (!rows() && n < 40) setTimeout(function () { wait(n + 1); }, 250); })(0);
  D.addEventListener("input", function (e) { if (e.target && e.target.id === "ml-hsop" && L_HS) L_HS.setOpacity(+e.target.value); });
  if (ST.hs) set("hs", true);
  if (ST.cov) set("cov", true);

  /* with coverage on, the legend names the model at the map centre (no tap handler, so it never gets in the way of other tools) */

  function centre() {
    var n = D.getElementById("ml-lidarnote"); if (!ST.cov || !n) return;
    var c = map.getCenter(), t = ++cTok;
    at(c.lat, Lf.Util.wrapNum(c.lng, [-180, 180], true)).then(function (r) {
      if (t !== cTok) return;
      var s = r.best, cl = s && classOf(s.res);
      n.innerHTML = "<b>At the map centre:</b> " + (s ? esc(cl ? cl.name : "Elevation model") + ". " + esc(s.name) + ", " + esc(fmtRes(s.res)) + (s.producer ? ", " + esc(s.producer) : "") +
        (s.licence ? ". Licence: " + esc(s.licence) : "") + (/^https?:\/\//.test(s.website) ? '. <a href="' + esc(s.website) + '" target="_blank" rel="noopener">Source</a>' : "") +
        (r.sources.length > 1 ? " (" + (r.sources.length - 1) + " more model" + (r.sources.length > 2 ? "s" : "") + " here)" : "") : "no LiDAR. " + esc(SAT)) + ".";
    }, function () { if (t === cTok) note(); });
  }
  map.on("moveend", centre);
  W.OSAP_LIDAR.set = set;
  W.OSAP_LIDAR.on = function (kind) { return !!ST[kind]; };
})();
