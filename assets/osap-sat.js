/* AXIOM OSAP · Satellite before/after: two Sentinel-2 true-colour passes of any place in the world, side by side or with a swipe
   slider on the map, plus a quick switch for NASA's daily true-colour picture (MODIS / VIIRS) of a chosen day.
   - Where it lives: the Area menu ("Satellite before/after", uses the drawn shape or asks for one) and Map overlays, section
     "Satellite imagery" (opens the same window for the drawn area or, with none, the map view; and the NASA daily switch).
     The window is a split-view window (W.OSAP_SPLIT) so the map stays usable beside it. No toolbar button.
   - Passes: Element 84 Earth Search STAC (https://earth-search.aws.element84.com/v1, collection sentinel-2-l2a, keyless, CORS "*";
     checked from a GitHub runner on 2026-10-19; the app read real COGs there for Kyiv, Bangkok, Sydney, Reykjavik and a UTM zone edge). Items over the area are grouped into passes (one
     satellite, one UTC day); when a tile was processed twice the newer processing is kept. Cloud % is the item's eo:cloud_cover,
     which is for the whole 110 km tile, not the drawn area: a "clear" pass can still be cloudy over the area, and the reverse.
   - Pictures: each item's "visual" asset, the true-colour (TCI) Cloud Optimised GeoTIFF in the sentinel-cogs bucket on AWS Open
     Data (CORS "*", byte ranges). It is read in the browser with geotiff.js (assets/vendor/geotiff-3.0.5.js, MIT, loaded the first
     time a picture is drawn): only the window over the area and only the overview level that matches the screen are fetched,
     then each pixel is moved from the tile's UTM grid onto the web map. Nothing is stored or sent anywhere else.
     Licence: Copernicus Sentinel data, free and open; every picture carries "Contains modified Copernicus Sentinel data <year>".
   - NASA daily: GIBS WMTS (gibs.earthdata.nasa.gov, keyless, CORS "*", public domain), Corrected Reflectance true colour from
     VIIRS (NOAA-20, Suomi NPP, NOAA-21) or MODIS (Terra, Aqua), about 250 m, one picture per day stitched from that day's passes.
   - Every scene shows its scene id(s), the pass time in Zulu and local time, the cloud % and a link to its STAC item.
   - Choices (view mode, cloud filter, NASA layer and date) are kept in this browser only (localStorage "osap-sat"); they are
     settings, not work, so they are not in workspaces.
   API: window.OSAP_SAT { open(), close(), isOpen(), state(), gibs(bool), setGibsDate(iso), setGibsLayer(id), pick(which, key),
        mode("side"|"swipe"), _t: pure helpers for tests }  */
(function () {
  "use strict";

  /* ---------- pure helpers (also used by tests/sat.test.mjs) ---------- */
  var STAC = "https://earth-search.aws.element84.com/v1";
  var DAY = 864e5;
  function bboxOf(poly) {
    var w = 180, s = 90, e = -180, n = -90;
    (poly || []).forEach(function (p) { var la = +p[0], lo = +p[1]; if (!isFinite(la) || !isFinite(lo)) return; if (lo < w) w = lo; if (lo > e) e = lo; if (la < s) s = la; if (la > n) n = la; });
    return w <= e && s <= n ? [w, s, e, n] : null;
  }
  function isoDay(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function searchUrl(bb, fromMs, toMs, limit) {
    var r = function (v) { return Math.round(v * 1e5) / 1e5; };
    return STAC + "/search?collections=sentinel-2-l2a&bbox=" + [r(bb[0]), r(bb[1]), r(bb[2]), r(bb[3])].join(",") +
      "&datetime=" + new Date(fromMs).toISOString().slice(0, 19) + "Z/" + new Date(toMs).toISOString().slice(0, 19) + "Z" +
      "&limit=" + (limit || 100) + "&sortby=-properties.datetime";
  }
  function safeUrl(u) { return /^https:\/\//i.test(String(u || "")) ? String(u) : ""; }
  /* STAC features -> passes, newest first: { key, t (ms), date, sat, cloud (mean %), items: [{ id, tile, href, stac, t, cloud }] } */
  function groupPasses(features) {
    var P = {};
    (features || []).forEach(function (f) {
      if (!f || !f.properties || !f.assets) return;
      var p = f.properties, t = Date.parse(p.datetime), href = safeUrl(f.assets.visual && f.assets.visual.href);
      if (!isFinite(t) || !href || !/\.tif{1,2}$/i.test(href.split("?")[0])) return;
      var id = String(f.id || ""), sat = String(p.platform || (id.match(/^S2[A-D]/i) || ["S2"])[0]).replace(/^sentinel-/i, "S").toUpperCase();
      var tile = String(p["grid:code"] || "").replace(/^MGRS-/, "") || (id.match(/_(\d{1,2}[A-Z]{3})_/) || [, ""])[1];
      var key = sat + "_" + isoDay(t), g = P[key] || (P[key] = { key: key, t: t, date: isoDay(t), sat: sat, items: [] });
      var self = ((f.links || []).filter(function (l) { return l && l.rel === "self"; })[0] || {}).href;
      var it = { id: id, tile: tile, href: href, stac: safeUrl(self) || STAC + "/collections/sentinel-2-l2a/items/" + encodeURIComponent(id), t: t,
        cloud: isFinite(+p["eo:cloud_cover"]) ? +p["eo:cloud_cover"] : null, run: +((id.match(/_(\d+)_L2A$/) || [, 0])[1]) };
      /* the same tile processed twice (…_0_L2A, …_1_L2A): keep the newer processing */
      var dup = g.items.filter(function (x) { return x.tile && x.tile === it.tile; })[0];
      if (dup) { if (it.run > dup.run) g.items[g.items.indexOf(dup)] = it; }
      else g.items.push(it);
      if (t < g.t) g.t = t;
    });
    return Object.keys(P).map(function (k) {
      var g = P[k], cs = g.items.map(function (x) { return x.cloud; }).filter(function (c) { return c != null; });
      g.cloud = cs.length ? cs.reduce(function (a, b) { return a + b; }, 0) / cs.length : null;
      g.items.sort(function (a, b) { return (a.cloud == null ? 101 : a.cloud) - (b.cloud == null ? 101 : b.cloud); });
      return g;
    }).sort(function (a, b) { return b.t - a.t; });
  }
  /* default pair: "after" = the newest pass at or under maxCloud (else the newest), "before" = the pass at or under maxCloud
     nearest to gapDays before it (else the least cloudy within 12 days of that, else the nearest older pass) */
  function pickDefault(passes, maxCloud, gapDays) {
    if (!passes || !passes.length) return { after: null, before: null };
    var mc = maxCloud == null ? 20 : maxCloud, gap = (gapDays == null ? 30 : gapDays) * DAY;
    var clear = function (p) { return p.cloud != null && p.cloud <= mc; };
    var after = passes.filter(clear)[0] || passes[0];
    var older = passes.filter(function (p) { return p.t < after.t - 0.5 * DAY; });
    var near = function (L) { return L.slice().sort(function (a, b) { return Math.abs(a.t - (after.t - gap)) - Math.abs(b.t - (after.t - gap)); })[0] || null; };
    /* none clear: the least cloudy within 12 days of the target, else the nearest */
    var win = older.filter(function (p) { return Math.abs(p.t - (after.t - gap)) <= 12 * DAY; }).sort(function (a, b) { return (a.cloud == null ? 101 : a.cloud) - (b.cloud == null ? 101 : b.cloud); })[0];
    return { after: after, before: near(older.filter(clear)) || win || near(older) };
  }
  /* WGS84 -> UTM (Krüger series, error well under a metre inside a zone and a few metres at its edge) */
  function utm(lat, lon, zone, south) {
    var a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, n = f / (2 - f), n2 = n * n, n3 = n2 * n;
    var A = a / (1 + n) * (1 + n2 / 4 + n2 * n2 / 64), al = [n / 2 - 2 * n2 / 3 + 5 * n3 / 16, 13 * n2 / 48 - 3 * n3 / 5, 61 * n3 / 240];
    var phi = lat * Math.PI / 180, dl = (lon - (zone * 6 - 183)) * Math.PI / 180, c = 2 * Math.sqrt(n) / (1 + n), sp = Math.sin(phi);
    var t = Math.sinh(atanh(sp) - c * atanh(c * sp)), xi = Math.atan2(t, Math.cos(dl)), eta = atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
    var E = eta, N = xi;
    for (var j = 1; j <= 3; j++) { E += al[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta); N += al[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta); }
    return [500000 + k0 * A * E, (south ? 10000000 : 0) + k0 * A * N];
  }
  function atanh(x) { return 0.5 * Math.log((1 + x) / (1 - x)); }
  /* EPSG 326zz (north) / 327zz (south) -> { zone, south } */
  function utmOf(epsg) { epsg = +epsg; if (epsg > 32600 && epsg <= 32660) return { zone: epsg - 32600, south: false }; if (epsg > 32700 && epsg <= 32760) return { zone: epsg - 32700, south: true }; return null; }
  function mercY(lat) { var s = Math.sin(Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180); return 0.5 * Math.log((1 + s) / (1 - s)); }
  function latOfY(y) { return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI; }
  /* a bbox [w,s,e,n] drawn W x H px on the web map: the lat/lon of each node of a grid every `step` px (for interpolation) */
  function gridLL(bb, Wd, Ht, step) {
    var y0 = mercY(bb[3]), y1 = mercY(bb[1]), nx = Math.ceil(Wd / step) + 1, ny = Math.ceil(Ht / step) + 1, out = [];
    for (var j = 0; j < ny; j++) { var py = Math.min(Ht, j * step), lat = latOfY(y0 + (y1 - y0) * py / Ht);
      for (var i = 0; i < nx; i++) { var px = Math.min(Wd, i * step); out.push([lat, bb[0] + (bb[2] - bb[0]) * px / Wd]); } }
    return { nx: nx, ny: ny, step: step, ll: out };
  }
  function cloudTxt(c) { return c == null ? "cloud ?" : (c < 1 ? "<1" : Math.round(c)) + "% cloud"; }
  function sizeKm(bb) {
    var mid = (bb[1] + bb[3]) / 2, kx = 111.32 * Math.cos(mid * Math.PI / 180);
    return [(bb[2] - bb[0]) * kx, (bb[3] - bb[1]) * 110.57];
  }
  var T = { bboxOf: bboxOf, searchUrl: searchUrl, groupPasses: groupPasses, pickDefault: pickDefault, utm: utm, utmOf: utmOf, mercY: mercY, latOfY: latOfY, gridLL: gridLL, cloudTxt: cloudTxt, sizeKm: sizeKm, isoDay: isoDay };
  if (typeof module === "object" && module.exports) module.exports = T;
  if (typeof window === "undefined") return;

  /* ---------- browser ---------- */
  var W = window, D = document;
  if (/[?&]watchscan=1(&|$)/.test(location.search)) return;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function Tm() { return W.OSAP_TIME || { dualT: function (ms) { return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z"; } }; }
  function dual(ms) { return Tm().dualT(ms, { date: true }); }
  function toast(m) { if (W.OSAP_ATAK && W.OSAP_ATAK.toast) W.OSAP_ATAK.toast(m); }
  var KEY = "osap-sat", LIB = "assets/vendor/geotiff-3.0.5.js", MAX_DEG = 2.5, MAX_TILES = 9;
  var GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/";
  var GLAYERS = [["VIIRS_NOAA20_CorrectedReflectance_TrueColor", "VIIRS NOAA-20"], ["VIIRS_SNPP_CorrectedReflectance_TrueColor", "VIIRS Suomi NPP"],
    ["VIIRS_NOAA21_CorrectedReflectance_TrueColor", "VIIRS NOAA-21"], ["MODIS_Terra_CorrectedReflectance_TrueColor", "MODIS Terra"], ["MODIS_Aqua_CorrectedReflectance_TrueColor", "MODIS Aqua"]];
  var CLOUDS = [[10, "10% or less"], [20, "20% or less"], [50, "50% or less"], [100, "Any cloud"]];
  var P = { mode: "side", maxc: 100, gl: GLAYERS[0][0], gd: "", gon: false };
  try { var v0 = JSON.parse(localStorage.getItem(KEY) || "null"); if (v0) { if (v0.mode === "swipe" || v0.mode === "side") P.mode = v0.mode; if ([10, 20, 50, 100].indexOf(v0.maxc) >= 0) P.maxc = v0.maxc;
    if (GLAYERS.some(function (g) { return g[0] === v0.gl; })) P.gl = v0.gl; if (/^\d{4}-\d{2}-\d{2}$/.test(v0.gd || "")) P.gd = v0.gd; P.gon = v0.gon === true; } } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) {} }

  var map = W.__asapMap, Lf = W.L;
  if (!map || !Lf) return;
  map.createPane("satpane"); map.getPane("satpane").style.zIndex = 260; map.getPane("satpane").style.pointerEvents = "none";
  map.createPane("gibspane"); map.getPane("gibspane").style.zIndex = 255; map.getPane("gibspane").style.pointerEvents = "none";

  /* ---------- geotiff.js, loaded once on first use ---------- */
  var libP = null;
  function lib() {
    if (W.GeoTIFF) return Promise.resolve(W.GeoTIFF);
    if (libP) return libP;
    libP = new Promise(function (res, rej) {
      var s = D.createElement("script"); s.src = LIB; s.async = true;
      s.onload = function () { if (W.GeoTIFF) res(W.GeoTIFF); else { libP = null; rej(new Error("GeoTIFF reader did not load")); } };
      s.onerror = function () { libP = null; rej(new Error("GeoTIFF reader could not be fetched (offline?)")); };
      D.head.appendChild(s);
    });
    return libP;
  }
  var TIFS = {}, TORDER = [];
  function tif(url) {
    if (TIFS[url]) return TIFS[url];
    TORDER.push(url); if (TORDER.length > 12) delete TIFS[TORDER.shift()];
    var p = TIFS[url] = lib().then(function (G) { return G.fromUrl(url, { allowFullFile: false }); }).then(function (t) {
      return t.getImage(0).then(function (im) {
        var gk = im.getGeoKeys ? im.getGeoKeys() : im.geoKeys, u = utmOf(gk && gk.ProjectedCSTypeGeoKey);
        if (!u) throw new Error("not a UTM picture (" + (gk && gk.ProjectedCSTypeGeoKey) + ")");
        return { t: t, bb: im.getBoundingBox(), u: u, res: im.getResolution()[0] };
      });
    });
    p.catch(function () { if (TIFS[url] === p) delete TIFS[url]; });
    return p;
  }
  /* one pass drawn onto a Wd x Ht canvas covering bb ([w,s,e,n], web-map projection). Resolves { canvas, filled (0..1) } */
  function render(pass, bb, Wd, Ht, signal) {
    var cv = D.createElement("canvas"); cv.width = Wd; cv.height = Ht;
    var g = cv.getContext("2d"), img = g.createImageData(Wd, Ht), px = img.data, grid = gridLL(bb, Wd, Ht, 16), filled = 0, errs = [];
    var items = pass.items.slice(0, MAX_TILES);
    return items.reduce(function (chain, it) {
      return chain.then(function () {
        if (signal && signal.aborted) throw new Error("aborted");
        /* every pixel already drawn from a clearer tile of the pass: the rest are not fetched */
        if (filled >= Wd * Ht) return;
        return tif(it.href).then(function (o) {
          /* the tile's grid at each node, and the part of the tile the canvas covers */
          var E = new Float64Array(grid.ll.length), N = new Float64Array(grid.ll.length), ub = [Infinity, Infinity, -Infinity, -Infinity];
          grid.ll.forEach(function (q, k) { var m = utm(q[0], q[1], o.u.zone, o.u.south); E[k] = m[0]; N[k] = m[1]; if (m[0] < ub[0]) ub[0] = m[0]; if (m[1] < ub[1]) ub[1] = m[1]; if (m[0] > ub[2]) ub[2] = m[0]; if (m[1] > ub[3]) ub[3] = m[1]; });
          var r = [Math.max(ub[0], o.bb[0]), Math.max(ub[1], o.bb[1]), Math.min(ub[2], o.bb[2]), Math.min(ub[3], o.bb[3])];
          if (r[2] - r[0] < o.res || r[3] - r[1] < o.res) return;
          /* ground size of one canvas pixel: read no finer than that (and never finer than 10 m) */
          var gm = Math.max(o.res, (ub[2] - ub[0]) / Wd, (ub[3] - ub[1]) / Ht);
          var rw = Math.max(1, Math.min(2400, Math.round((r[2] - r[0]) / gm))), rh = Math.max(1, Math.min(2400, Math.round((r[3] - r[1]) / gm)));
          return o.t.readRasters({ bbox: r, width: rw, height: rh, interleave: true, signal: signal }).then(function (ras) {
            var sx = rw / (r[2] - r[0]), sy = rh / (r[3] - r[1]), st = grid.step, nx = grid.nx;
            for (var y = 0; y < Ht; y++) {
              var gj = Math.min(grid.ny - 2, Math.floor(y / st)), fy = (y - gj * st) / Math.max(1e-9, Math.min(st, Ht - gj * st));
              for (var x = 0; x < Wd; x++) {
                var o4 = (y * Wd + x) * 4; if (px[o4 + 3]) continue;
                var gi = Math.min(nx - 2, Math.floor(x / st)), fx = (x - gi * st) / Math.max(1e-9, Math.min(st, Wd - gi * st));
                var k = gj * nx + gi, w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
                var e = E[k] * w00 + E[k + 1] * w10 + E[k + nx] * w01 + E[k + nx + 1] * w11, n = N[k] * w00 + N[k + 1] * w10 + N[k + nx] * w01 + N[k + nx + 1] * w11;
                var c = Math.floor((e - r[0]) * sx), rr = Math.floor((r[3] - n) * sy);
                if (c < 0 || rr < 0 || c >= rw || rr >= rh) continue;
                var s = (rr * rw + c) * 3, R = ras[s], G2 = ras[s + 1], B = ras[s + 2];
                if (!R && !G2 && !B) continue;
                px[o4] = R; px[o4 + 1] = G2; px[o4 + 2] = B; px[o4 + 3] = 255; filled++;
              }
            }
          });
        }).catch(function (e) { if (signal && signal.aborted) throw e; errs.push(it.id + ": " + (e && e.message || e)); });
      });
    }, Promise.resolve()).then(function () {
      g.putImageData(img, 0, 0);
      if (!filled && errs.length) throw new Error(errs.join("; "));
      return { canvas: cv, filled: filled / (Wd * Ht), errs: errs };
    });
  }

  /* ---------- state ---------- */
  var S = { area: null, src: "", passes: [], from: 0, busy: "", err: "", before: null, after: null, more: true, run: 0, ac: null, pics: {}, picErr: {} };
  function areaPoly() { var a = W.TSAP && W.TSAP.areaApi && W.TSAP.areaApi.area(); return a && a.length >= 3 ? a : null; }
  function viewBox() { var b = map.getBounds(); return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]; }
  function chooseArea() {
    var a = areaPoly();
    if (a) { S.area = bboxOf(a); S.src = "Drawn area"; } else { S.area = viewBox(); S.src = "Map view"; }
  }
  function tooBig(bb) { return bb[2] - bb[0] > MAX_DEG || bb[3] - bb[1] > MAX_DEG; }
  function find(key) { return S.passes.filter(function (p) { return p.key === key; })[0] || null; }
  function load(older) {
    var bb = S.area; if (!bb || tooBig(bb)) return;
    var run = ++S.run, to = older ? S.from : Date.now(), from = to - 90 * DAY;
    S.busy = "Looking for Sentinel-2 passes…"; S.err = ""; draw();
    var feats = [], pages = 0;
    function page(url) {
      return fetch(url).then(function (r) { if (!r.ok) throw new Error("Earth Search answered " + r.status); return r.json(); }).then(function (j) {
        if (run !== S.run) return;
        feats = feats.concat(j.features || []);
        var nx = (j.links || []).filter(function (l) { return l && l.rel === "next" && (!l.method || l.method === "GET"); })[0];
        if (nx && safeUrl(nx.href).indexOf(STAC + "/") === 0 && ++pages < 5) return page(nx.href);
      });
    }
    page(searchUrl(bb, from, to, 100)).then(function () {
      if (run !== S.run) return;
      var got = groupPasses(feats), have = {};
      S.passes.forEach(function (p) { have[p.key] = 1; });
      S.passes = S.passes.concat(got.filter(function (p) { return !have[p.key]; })).sort(function (a, b) { return b.t - a.t; });
      S.from = from; S.busy = ""; S.more = true;
      if (!S.after || !S.before) { var d = pickDefault(S.passes, P.maxc < 100 ? P.maxc : 20, 30); if (!S.after) S.after = d.after && d.after.key; if (!S.before) S.before = d.before && d.before.key; }
      draw(); paint();
    }).catch(function (e) { if (run !== S.run) return; S.busy = ""; S.err = "Could not list passes: " + (e && e.message || e) + ". Check the connection and try again."; draw(); });
  }

  /* ---------- the window ---------- */
  var el = null;
  var CSS = "#satba{position:fixed;inset:0;z-index:100000;overflow:auto;background:rgba(0,0,0,.45);padding:16px}" +
    "#satba .cbox{max-width:900px;margin:0 auto;background:var(--surface,#fff);color:var(--ink,#111);border-radius:8px;padding:10px 16px 16px;font-size:13px;line-height:1.45;box-shadow:0 6px 24px rgba(0,0,0,.3)}" +
    "#satba .chead{display:flex;align-items:center;gap:8px;position:sticky;top:-16px;background:var(--surface,#fff);padding:6px 0;z-index:1}#satba .chead h2{margin:0;font-size:16px;flex:1}" +
    "#satba button,#satba select,#satba input{font:inherit;font-size:13px;min-height:40px;border:1px solid var(--line,#bbb);background:var(--surface,#fff);color:inherit;border-radius:6px;padding:4px 10px}" +
    "#satba button{cursor:pointer}#satba button[aria-pressed=true]{background:var(--accent-soft,#e3f2f4);border-color:var(--accent,#0b7285);font-weight:600}" +
    "#satba .row{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;margin:6px 0}#satba .mut{color:var(--muted,#555)}#satba .err{color:#b71c1c}" +
    "#satba .seg{display:inline-flex}#satba .seg button{border-radius:0;margin-left:-1px}#satba .seg button:first-child{border-radius:6px 0 0 6px}#satba .seg button:last-child{border-radius:0 6px 6px 0}" +
    "#satba .pics{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin:8px 0}" +
    "#satba figure{margin:0;border:1px solid var(--line,#ddd);border-radius:6px;overflow:hidden;background:var(--surface2,#f4f4f4)}" +
    "#satba figure .ph{position:relative;background:#222;display:flex;align-items:center;justify-content:center;color:#ddd;font-size:12px}#satba figure canvas{display:block;width:100%;height:auto}" +
    "#satba figcaption{padding:6px 8px;font-size:12px}#satba figcaption b{font-size:13px}#satba .sid{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11.5px;word-break:break-all}" +
    "#satba table{width:100%;border-collapse:collapse;font-size:12.5px}#satba th,#satba td{text-align:left;padding:3px 4px;border-bottom:1px solid var(--line,#e3e3e3);vertical-align:middle}" +
    "#satba td button{min-height:40px;min-width:64px;font-size:12px;padding:2px 8px}#satba .cl{display:inline-block;min-width:3.4em}#satba .lst{max-height:300px;overflow:auto;border:1px solid var(--line,#e3e3e3);border-radius:6px}" +
    "#satba .attr{font-size:11.5px;color:var(--muted,#555);border-top:1px solid var(--line,#ddd);margin-top:10px;padding-top:6px}" +
    "#satba .tag{font-size:10.5px;border:1px solid var(--line,#bbb);border-radius:3px;padding:0 4px;color:var(--muted,#555);font-weight:400}" +
    "@media (max-width:700px){#satba{padding:6px}#satba button,#satba select,#satba input{font-size:16px}}" +
    ".satswipe{position:absolute;top:0;bottom:0;width:0;z-index:650;pointer-events:none}.satswipe i{position:absolute;top:0;bottom:0;left:-2px;width:4px;background:#fff;box-shadow:0 0 3px rgba(0,0,0,.6)}" +
    ".satswipe b{position:absolute;top:50%;left:-22px;width:44px;height:44px;margin-top:-22px;border-radius:50%;background:#fff;border:2px solid #0b7285;box-shadow:0 1px 4px rgba(0,0,0,.4);pointer-events:auto;cursor:ew-resize;touch-action:none;display:flex;align-items:center;justify-content:center;font:700 14px/1 system-ui,sans-serif;color:#0b7285}" +
    ".satswipe span{position:absolute;top:8px;white-space:nowrap;font:600 11.5px/1.2 system-ui,sans-serif;background:rgba(0,0,0,.65);color:#fff;padding:3px 6px;border-radius:4px}.satswipe .l{right:8px}.satswipe .r{left:8px}";
  function ensure() {
    if (el) return el;
    if (!D.getElementById("satba-css")) { var st = D.createElement("style"); st.id = "satba-css"; st.textContent = CSS; D.head.appendChild(st); }
    el = D.createElement("div"); el.id = "satba"; el.hidden = true; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Satellite before/after");
    el.innerHTML = '<div class="cbox"></div>';
    D.body.appendChild(el);
    el.addEventListener("click", onClick); el.addEventListener("change", onChange);
    el.addEventListener("click", function (e) { if (e.target === el) close(); });
    if (W.OSAP_SPLIT) W.OSAP_SPLIT.add(el, ".chead");
    D.addEventListener("osap:split", function () { if (!el.hidden) { draw(); paint(); } });
    return el;
  }
  function isOpen() { return !!(el && !el.hidden); }
  function open() {
    ensure(); chooseArea();
    S.passes = []; S.before = S.after = null; S.pics = {}; S.picErr = {}; S.err = ""; S.from = Date.now();
    el.hidden = false; draw();
    if (tooBig(S.area)) { S.err = (S.src === "Map view" ? "The map view" : "The drawn area") + " is too large for Sentinel-2 pictures here (up to about " + Math.round(MAX_DEG * 100) + " km across). " + (S.src === "Map view" ? "Zoom in or draw a smaller area." : "Draw a smaller area."); draw(); return true; }
    load(false);
    return true;
  }
  function close() { if (!el) return; S.run++; if (S.ac) S.ac.abort(); el.hidden = true; swipeOff(); }
  function scLine(p, which) {
    if (!p) return "<i>none picked</i>";
    return "<b>" + which + "</b> " + esc(dual(p.t)) + " · " + esc(p.sat) + " · " + esc(cloudTxt(p.cloud)) + " <span class=\"mut\">(whole tile)</span><br>" +
      p.items.slice(0, MAX_TILES).map(function (it) { return '<a class="sid" href="' + esc(it.stac) + '" target="_blank" rel="noopener noreferrer" title="STAC item: ' + esc(it.id) + '">' + esc(it.id) + "</a>"; }).join(" ") +
      (p.items.length > MAX_TILES ? ' <span class="mut">(' + (p.items.length - MAX_TILES) + " more tiles not drawn)</span>" : "");
  }
  function years() {
    var y = {}; [find(S.before), find(S.after)].forEach(function (p) { if (p) y[new Date(p.t).getUTCFullYear()] = 1; });
    var k = Object.keys(y); return k.length ? k.join(", ") : String(new Date().getUTCFullYear());
  }
  function attrHtml() {
    return "Contains modified Copernicus Sentinel data " + esc(years()) + '. Passes from <a href="https://earth-search.aws.element84.com/v1" target="_blank" rel="noopener noreferrer">Element 84 Earth Search</a> (STAC), pictures from the Sentinel-2 L2A true-colour COGs on <a href="https://registry.opendata.aws/sentinel-2-l2a-cogs/" target="_blank" rel="noopener noreferrer">AWS Open Data</a>, read in this browser.' +
      (P.gon ? ' Daily picture: NASA <a href="https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api" target="_blank" rel="noopener noreferrer">GIBS</a> / LANCE, public domain.' : "");
  }
  function draw() {
    if (!el || el.hidden) return;
    var c = el.firstElementChild, bb = S.area, km = bb ? sizeKm(bb) : [0, 0];
    var h = '<div class="chead"><h2 id="satba-h">Satellite before/after <span class="tag" title="Sentinel-2 pictures as taken, not interpreted. Not AI.">Sentinel-2</span></h2>' +
      (W.OSAP_SPLIT ? W.OSAP_SPLIT.btn() : "") + '<button type="button" class="x" data-sat="close" aria-label="Close Satellite before/after">Close</button></div>';
    h += '<div class="row"><span><b>' + esc(S.src) + "</b> " + (bb ? esc(km[0].toFixed(km[0] < 10 ? 1 : 0) + " × " + km[1].toFixed(km[1] < 10 ? 1 : 0) + " km") : "") + "</span>" +
      '<button type="button" data-sat="area" title="Use the drawn area if there is one, otherwise what the map shows now">' + (areaPoly() ? "Use drawn area" : "Use map view") + "</button>" +
      '<button type="button" data-sat="zoom">Zoom to area</button></div>';
    h += '<div class="row"><span class="mut">Show</span><span class="seg" role="group" aria-label="How to show the two pictures">' +
      '<button type="button" data-sat-mode="side" aria-pressed="' + (P.mode === "side") + '">Side by side</button><button type="button" data-sat-mode="swipe" aria-pressed="' + (P.mode === "swipe") + '">Swipe on map</button></span></div>';
    if (S.err) h += '<p class="err" role="alert">' + esc(S.err) + "</p>";
    if (S.busy) h += '<p class="mut" role="status">' + esc(S.busy) + "</p>";
    var b = find(S.before), a = find(S.after);
    if (P.mode === "side") {
      h += '<div class="pics">' + [["before", "Before", b], ["after", "After", a]].map(function (x) {
        var e = S.picErr[x[0]];
        return '<figure data-pic="' + x[0] + '"><div class="ph" style="aspect-ratio:' + aspect() + '">' + (x[2] ? (e ? '<span class="err" style="padding:8px">' + esc(e) + "</span>" : "<span>Loading picture…</span>") : "<span>Pick a pass below</span>") + "</div>" +
          "<figcaption>" + scLine(x[2], x[1]) + "</figcaption></figure>";
      }).join("") + "</div>";
    } else {
      h += '<p class="mut">Drag the round handle on the map: before on the left, after on the right. The pictures are redrawn for what the map shows.</p>' +
        '<p style="font-size:12px">' + scLine(b, "Before") + "</p><p style=\"font-size:12px\">" + scLine(a, "After") + "</p>" + (S.picErr.swipe ? '<p class="err">' + esc(S.picErr.swipe) + "</p>" : "");
    }
    /* the passes */
    var L = S.passes.filter(function (p) { return P.maxc >= 100 || (p.cloud != null && p.cloud <= P.maxc) || p.key === S.before || p.key === S.after; });
    h += '<div class="row"><b>Passes over the area</b><label class="mut">Cloud <select data-sat="maxc" aria-label="Show passes with cloud">' + CLOUDS.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === P.maxc ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label>" +
      '<span class="mut">' + S.passes.length + " since " + esc(S.from ? isoDay(S.from) : "") + "</span></div>";
    if (L.length) h += '<div class="lst"><table><thead><tr><th>Pass (Zulu / local)</th><th>Cloud</th><th>Tiles</th><th></th></tr></thead><tbody>' + L.map(function (p) {
      return "<tr><td>" + esc(dual(p.t)) + ' <span class="mut">' + esc(p.sat) + '</span></td><td><span class="cl">' + esc(p.cloud == null ? "?" : Math.round(p.cloud) + "%") + "</span></td><td>" + p.items.length + "</td>" +
        '<td style="white-space:nowrap"><button type="button" data-pick="before" data-key="' + esc(p.key) + '" aria-pressed="' + (p.key === S.before) + '">Before</button> <button type="button" data-pick="after" data-key="' + esc(p.key) + '" aria-pressed="' + (p.key === S.after) + '">After</button></td></tr>';
    }).join("") + "</tbody></table></div>";
    else if (!S.busy && !S.err) h += '<p class="mut">No passes' + (P.maxc < 100 ? " at this cloud level" : "") + " in this period.</p>";
    if (!S.busy && S.area && !tooBig(S.area)) h += '<div class="row"><button type="button" data-sat="older">Look 90 days further back</button></div>';
    /* NASA daily */
    h += '<div class="row" style="border-top:1px solid var(--line,#ddd);padding-top:8px;margin-top:10px"><label><input type="checkbox" data-satg="on"' + (P.gon ? " checked" : "") + ' style="min-height:0"> <b>NASA daily true colour</b> on the map</label>' +
      '<input type="date" data-satg="date" aria-label="Day of the NASA picture" value="' + esc(gDate()) + '" max="' + isoDay(Date.now()) + '" min="2012-01-19">' +
      '<select data-satg="layer" aria-label="NASA sensor">' + GLAYERS.map(function (g) { return '<option value="' + g[0] + '"' + (g[0] === P.gl ? " selected" : "") + ">" + esc(g[1]) + "</option>"; }).join("") + "</select>" +
      (a ? '<button type="button" data-sat="gafter">Day of the after pass</button>' : "") + "</div>" +
      '<p class="mut" style="font-size:12px;margin:2px 0">About 250 m, one picture per day stitched from that day\'s passes (good for big smoke, floods, burn scars and cloud; not for buildings).</p>';
    h += '<div class="attr">' + attrHtml() + "</div>";
    c.innerHTML = h;
  }
  function aspect() {
    var bb = S.area; if (!bb) return "1/1";
    var w = (bb[2] - bb[0]) * Math.PI / 180, hh = mercY(bb[3]) - mercY(bb[1]); if (!(w > 0 && hh > 0)) return "1/1";
    var r = Math.max(0.4, Math.min(2.5, w / hh)); return r.toFixed(3) + "/1";
  }
  /* the pictures: side by side in the window, or the swipe on the map */
  var paintT = null;
  function paint() {
    clearTimeout(paintT); paintT = setTimeout(paintNow, 30);
  }
  function paintNow() {
    if (!isOpen() || !S.area || tooBig(S.area)) { swipeOff(); return; }
    if (S.ac) S.ac.abort();
    var ac = S.ac = typeof AbortController === "function" ? new AbortController() : null, sig = ac ? ac.signal : null;
    var b = find(S.before), a = find(S.after);
    if (P.mode === "side") {
      swipeOff();
      [["before", b], ["after", a]].forEach(function (x) {
        var fig = el.querySelector('[data-pic="' + x[0] + '"] .ph'); if (!fig || !x[1]) return;
        var pw = Math.max(200, Math.min(900, Math.round((fig.clientWidth || 400) * Math.min(2, W.devicePixelRatio || 1))));
        var ar = aspect().split("/")[0], ph = Math.max(80, Math.min(1400, Math.round(pw / ar)));
        render(x[1], S.area, pw, ph, sig).then(function (r) {
          if (sig && sig.aborted) return;
          var f2 = el.querySelector('[data-pic="' + x[0] + '"] .ph'); if (!f2) return;
          f2.innerHTML = ""; r.canvas.setAttribute("role", "img"); r.canvas.setAttribute("aria-label", "Sentinel-2 true colour, " + x[0] + ", " + isoDay(x[1].t));
          f2.appendChild(r.canvas);
          if (r.filled < 0.02) { var s = D.createElement("span"); s.className = "err"; s.style.cssText = "position:absolute;padding:8px"; s.textContent = "This pass does not cover the area (outside the swath)."; f2.appendChild(s); }
        }).catch(function (e) {
          if (sig && sig.aborted) return;
          S.picErr[x[0]] = "Could not draw the picture: " + (e && e.message || e); var f2 = el.querySelector('[data-pic="' + x[0] + '"] .ph'); if (f2) { f2.innerHTML = ""; var s = D.createElement("span"); s.className = "err"; s.style.padding = "8px"; s.textContent = S.picErr[x[0]]; f2.appendChild(s); }
        });
      });
    } else swipeDraw(b, a, sig);
  }

  /* ---------- swipe on the map ---------- */
  var SW = { lb: null, la: null, bar: null, x: 0.5, urls: [] };
  function swipeOff() {
    if (SW.lb) map.removeLayer(SW.lb); if (SW.la) map.removeLayer(SW.la); SW.lb = SW.la = null;
    SW.urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} }); SW.urls = [];
    if (SW.bar) { SW.bar.remove(); SW.bar = null; }
  }
  function blobUrl(cv) {
    return new Promise(function (res) {
      if (cv.toBlob) cv.toBlob(function (b) { res(b ? URL.createObjectURL(b) : cv.toDataURL()); }, "image/png");
      else res(cv.toDataURL());
    });
  }
  function swipeDraw(b, a, sig) {
    if (!b && !a) { swipeOff(); return; }
    /* the area cut to what the map shows (with a margin), at screen resolution */
    var v = map.getBounds().pad(0.1), bb = [Math.max(S.area[0], v.getWest()), Math.max(S.area[1], v.getSouth()), Math.min(S.area[2], v.getEast()), Math.min(S.area[3], v.getNorth())];
    if (bb[2] <= bb[0] || bb[3] <= bb[1]) { swipeOff(); return; }
    var z = map.getZoom(), p0 = map.project([bb[3], bb[0]], z), p1 = map.project([bb[1], bb[2]], z), dpr = Math.min(2, W.devicePixelRatio || 1);
    var Wd = Math.max(16, Math.min(2048, Math.round((p1.x - p0.x) * dpr))), Ht = Math.max(16, Math.min(2048, Math.round((p1.y - p0.y) * dpr)));
    var bounds = Lf.latLngBounds([bb[1], bb[0]], [bb[3], bb[2]]), att = "Contains modified Copernicus Sentinel data " + esc(years());
    S.picErr.swipe = "";
    Promise.all([b ? render(b, bb, Wd, Ht, sig) : null, a ? render(a, bb, Wd, Ht, sig) : null]).then(function (r) {
      if (sig && sig.aborted) return;
      return Promise.all([r[0] ? blobUrl(r[0].canvas) : null, r[1] ? blobUrl(r[1].canvas) : null]).then(function (u) {
        if (sig && sig.aborted) return;
        var old = SW.urls; SW.urls = [u[0], u[1]].filter(function (x) { return x && /^blob:/.test(x); });
        if (SW.lb) map.removeLayer(SW.lb); if (SW.la) map.removeLayer(SW.la);
        SW.lb = u[0] ? Lf.imageOverlay(u[0], bounds, { pane: "satpane", className: "satimg satb", attribution: att }).addTo(map) : null;
        SW.la = u[1] ? Lf.imageOverlay(u[1], bounds, { pane: "satpane", className: "satimg sata", attribution: att }).addTo(map) : null;
        old.forEach(function (x) { try { URL.revokeObjectURL(x); } catch (e) {} });
        bar(); clip();
      });
    }).catch(function (e) { if (sig && sig.aborted) return; S.picErr.swipe = "Could not draw the pictures: " + (e && e.message || e); draw(); });
  }
  function bar() {
    if (SW.bar) { label(); return; }
    var c = map.getContainer(), d = D.createElement("div"); d.className = "satswipe noprint";
    d.innerHTML = '<i></i><span class="l"></span><span class="r"></span><b role="slider" tabindex="0" aria-label="Swipe between before and after" aria-valuemin="0" aria-valuemax="100">⇔</b>';
    c.appendChild(d); SW.bar = d; label();
    var k = d.querySelector("b"), drag = false;
    function at(ev) { var r = c.getBoundingClientRect(), x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left; SW.x = Math.max(0, Math.min(1, x / r.width)); clip(); }
    k.addEventListener("pointerdown", function (e) { drag = true; try { k.setPointerCapture(e.pointerId); } catch (x) {} e.preventDefault(); e.stopPropagation(); if (map.dragging) map.dragging.disable(); });
    k.addEventListener("pointermove", function (e) { if (drag) at(e); });
    var up = function () { if (!drag) return; drag = false; if (map.dragging) map.dragging.enable(); };
    k.addEventListener("pointerup", up); k.addEventListener("pointercancel", up);
    k.addEventListener("keydown", function (e) { var dx = e.key === "ArrowLeft" ? -0.05 : e.key === "ArrowRight" ? 0.05 : 0; if (!dx) return; e.preventDefault(); SW.x = Math.max(0, Math.min(1, SW.x + dx)); clip(); });
    ["mousedown", "touchstart", "dblclick", "click", "wheel"].forEach(function (t) { k.addEventListener(t, function (e) { e.stopPropagation(); }, { passive: true }); });
  }
  function label() {
    if (!SW.bar) return; var b = find(S.before), a = find(S.after);
    SW.bar.querySelector(".l").textContent = b ? "Before " + isoDay(b.t) : "";
    SW.bar.querySelector(".r").textContent = a ? "After " + isoDay(a.t) : "";
  }
  /* the after picture shows right of the handle only; the before picture is under it */
  function clip() {
    if (!SW.bar) return;
    var c = map.getContainer(), cw = c.clientWidth, x = Math.round(SW.x * cw);
    SW.bar.style.left = x + "px"; SW.bar.querySelector("b").setAttribute("aria-valuenow", Math.round(SW.x * 100));
    var im = SW.la && SW.la.getElement();
    if (im) { var r = im.getBoundingClientRect(), cr = c.getBoundingClientRect(), cut = Math.max(0, x - (r.left - cr.left)), sc = r.width / (im.offsetWidth || r.width || 1);
      im.style.clipPath = "inset(0 0 0 " + Math.max(0, cut / (sc || 1)) + "px)"; }
  }
  var mvT = null;
  map.on("move zoom", function () { if (SW.bar) clip(); });
  map.on("moveend", function () { if (!isOpen() || P.mode !== "swipe") return; clearTimeout(mvT); mvT = setTimeout(paintNow, 450); });
  map.on("zoomend", function () { if (SW.bar) setTimeout(clip, 0); });
  W.addEventListener("resize", function () { if (SW.bar) clip(); });

  /* ---------- NASA GIBS daily true colour ---------- */
  var gl = null;
  function gDate() { return P.gd || isoDay(Date.now() - DAY); }
  function gibsUrl() { return GIBS + P.gl + "/default/" + gDate() + "/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg"; }
  function gibsDraw() {
    if (gl) { map.removeLayer(gl); gl = null; }
    if (P.gon) gl = Lf.tileLayer(gibsUrl(), { pane: "gibspane", maxNativeZoom: 9, maxZoom: 20, className: "osap-gibs", crossOrigin: "anonymous",
      attribution: 'Daily true colour ' + esc(gDate()) + ': NASA <a href="https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api" target="_blank" rel="noopener noreferrer">GIBS</a> (' + esc((GLAYERS.filter(function (g) { return g[0] === P.gl; })[0] || [, ""])[1]) + ")" }).addTo(map);
    gsync(); if (isOpen()) { var a = el.querySelector(".attr"); if (a) a.innerHTML = attrHtml(); }
  }
  function gibs(on) { P.gon = !!on; save(); gibsDraw(); }
  function setGibsDate(d) { if (!/^\d{4}-\d{2}-\d{2}$/.test(d || "")) return; P.gd = d; save(); gibsDraw(); }
  function setGibsLayer(id) { if (!GLAYERS.some(function (g) { return g[0] === id; })) return; P.gl = id; save(); gibsDraw(); }
  function gsync() {
    D.querySelectorAll("[data-satg=on]").forEach(function (i) { if (i.checked !== P.gon) i.checked = P.gon; });
    D.querySelectorAll("[data-satg=date]").forEach(function (i) { if (i.value !== gDate()) i.value = gDate(); });
    D.querySelectorAll("[data-satg=layer]").forEach(function (i) { if (i.value !== P.gl) i.value = P.gl; });
  }

  /* ---------- events ---------- */
  function onClick(e) {
    var t = e.target.closest && e.target.closest("[data-sat],[data-sat-mode],[data-pick]"); if (!t || !el.contains(t)) return;
    var k = t.getAttribute("data-sat");
    if (k === "close") return close();
    if (k === "area") { open(); return; }
    if (k === "zoom") { if (S.area) map.fitBounds([[S.area[1], S.area[0]], [S.area[3], S.area[2]]], { padding: [20, 20] }); return; }
    if (k === "older") { load(true); return; }
    if (k === "gafter") { var a = find(S.after); if (a) { P.gon = true; setGibsDate(isoDay(a.t)); } return; }
    var m = t.getAttribute("data-sat-mode"); if (m) { mode(m); return; }
    var pk = t.getAttribute("data-pick"); if (pk) pick(pk, t.getAttribute("data-key"));
  }
  function onChange(e) {
    var t = e.target, k = t.getAttribute("data-sat");
    if (k === "maxc") { P.maxc = +t.value || 100; save(); draw(); paint(); return; }
    gChange(e);
  }
  function gChange(e) {
    var t = e.target, g = t.getAttribute && t.getAttribute("data-satg"); if (!g) return;
    if (g === "on") gibs(t.checked); else if (g === "date") setGibsDate(t.value); else if (g === "layer") setGibsLayer(t.value);
  }
  function pick(which, key) {
    if ((which !== "before" && which !== "after") || !find(key)) return;
    S[which] = key; S.picErr = {};
    var b = find(S.before), a = find(S.after);
    if (b && a && b.t > a.t) { var x = S.before; S.before = S.after; S.after = x; }
    draw(); paint();
  }
  function mode(m) { if (m !== "side" && m !== "swipe") return; P.mode = m; save(); draw(); paint(); }

  /* ---------- Map overlays > Satellite imagery ---------- */
  function build() {
    var ex = D.getElementById("ml-extra"); if (!ex) return false;
    if (D.getElementById("ml-sat")) return true;
    var d = D.createElement("div"); d.id = "ml-sat";
    d.innerHTML = '<div class="mlh">Satellite imagery</div>' +
      '<div class="mlrow" style="cursor:default"><span><b>Sentinel-2 before/after</b><i>Two 10 m true-colour passes of the drawn area (or the map view) side by side or with a swipe on the map; pick the dates from the passes with their cloud %. Copernicus Sentinel data via Element 84 Earth Search.</i>' +
      '<button type="button" data-sat-open="1" style="margin-top:4px;min-height:40px;font:inherit;font-size:13px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:inherit;padding:4px 10px;cursor:pointer">Open Satellite before/after</button></span></div>' +
      '<label class="mlrow"><input type="checkbox" data-satg="on"' + (P.gon ? " checked" : "") + '><span><b>NASA daily true colour</b><i>Whole-world picture for one day from VIIRS or MODIS, about 250 m (NASA GIBS, public domain). Good for big smoke, floods, burn scars and cloud.</i></span></label>' +
      '<label class="mlop">Day <input type="date" data-satg="date" value="' + esc(gDate()) + '" max="' + isoDay(Date.now()) + '" min="2012-01-19" aria-label="Day of the NASA picture"></label>' +
      '<label class="mlop">Sensor <select data-satg="layer" aria-label="NASA sensor">' + GLAYERS.map(function (g) { return '<option value="' + g[0] + '"' + (g[0] === P.gl ? " selected" : "") + ">" + esc(g[1]) + "</option>"; }).join("") + "</select></label>";
    ex.parentNode.insertBefore(d, ex);
    d.addEventListener("change", gChange);
    d.querySelector("[data-sat-open]").addEventListener("click", function () { open(); });
    return true;
  }
  if (!build()) { var tries = 0, bt = setInterval(function () { if (build() || ++tries > 40) clearInterval(bt); }, 250); }
  if (P.gon) gibsDraw();
  D.addEventListener("keydown", function (e) { if (e.key === "Escape" && isOpen() && !(W.OSAP_SPLIT && W.OSAP_SPLIT.on())) close(); });

  /* in the Area menu (assets/osap-atak.js asks for a shape first when none is drawn) */
  (W.OSAP_AREA_TOOLS = W.OSAP_AREA_TOOLS || []).push({ id: "satba", label: "Satellite before/after", run: function () { open(); } });
  W.OSAP_SAT = { open: open, close: close, isOpen: isOpen, gibs: gibs, setGibsDate: setGibsDate, setGibsLayer: setGibsLayer, pick: pick, mode: mode,
    state: function () { return { area: S.area, src: S.src, passes: S.passes.length, before: S.before, after: S.after, mode: P.mode, gibs: P.gon, gdate: gDate(), glayer: P.gl, err: S.err, busy: S.busy }; }, _t: T };
})();
