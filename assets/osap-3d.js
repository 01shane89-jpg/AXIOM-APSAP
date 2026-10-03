/* AXIOM OSAP: 3D terrain view, a scale bar and a compass.
   - A "3D" button (in the map toolbar, or top left with the classic controls) opens the same place in a tilted, rotatable
     view over real terrain, like the hiking apps: the base map chosen in 2D is draped over the ground, with hill shading and
     a sky. Two-finger drag (or right-drag / Ctrl-drag with a mouse) tilts it, two-finger twist rotates it, the Tilt slider sets
     the view angle, the compass shows north and a tap on it turns the view back to north-up and flat. "2D" goes back to the
     flat map at the same place.
   - The 3D engine (MapLibre GL JS 5.24.0, BSD 3-Clause, assets/vendor/maplibre-gl-5.24.0.js, about 1 MB) is loaded only when
     3D is first opened, so the 2D app does not carry it.
   - Elevation: Terrain Tiles on AWS (Mapzen/Tilezen "terrarium" PNG, keyless public data set; SRTM, GMTED, ETOPO1, NED and
     others); inside Japan GSI's elevation tiles (5 m laser survey where it exists, 10 m elsewhere). The imagery, map tiles and
     overlays are the same keyless tiles the 2D map already shows (the 2D Elevation and LiDAR shading excepted: 3D shades from
     the elevation itself).
   - Points, lines and shapes on the 2D map (the ticked data sets, conflict lines, your own dropped marks) are copied into the
     3D view as they are when it opens. Tapping one shows its popup; "Show in 2D" goes back and opens it there. Display only:
     nothing here writes to records, and your marks stay in this browser.
   - The scale bar (bottom left, 2D and 3D) follows the Measure unit (km, mi or nm, remembered on this device as
     "osap-meas-unit"); tap it to change the unit. */
(function () {
  "use strict";
  var W = window, D = document, map = W.__asapMap, L = W.L;
  if (!map || !L || /[?&]watchscan=1/.test(location.search)) return;
  var LIB = "assets/vendor/maplibre-gl-5.24.0", K_UNIT = "osap-meas-unit", K_3D = "osap-3d";
  var DEM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
  /* 3D buildings: Overture Maps buildings (keyless PMTiles on a public bucket). Overture joins OpenStreetMap with Google's and
     Microsoft's footprints traced from satellite pictures, so towns OpenStreetMap barely covers (Yala, Pattani, Narathiwat)
     have their buildings too. Few buildings in the region have a recorded height: those without one are drawn at an
     estimate from their kind and floor count, in a cooler grey so they can be told apart. Shown from zoom 14, so zoomed-out
     views download none. Overture publishes a release every month and removes old ones, so the newest is looked up in the
     bucket's listing (kept for 3 days) with OVR as the fallback. */
  var OVB = "https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/", OVR = "2026-09-23.1", K_OVR = "osap-3d-ovr", BLD_Z = 14,
    PMLIB = "assets/vendor/pmtiles-4.5.0.js",
    BLD_ATTR = 'Buildings: <a href="https://docs.overturemaps.org/attribution/" target="_blank" rel="noopener">Overture Maps Foundation</a> (&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors, Google Open Buildings, Microsoft building footprints)';
  var DEM_ATTR = 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Terrain Tiles on AWS</a> (Mapzen/Tilezen; SRTM, GMTED, ETOPO1 and others)';
  /* Japan: GSI elevation tiles replace the AWS model inside Japan and Okinawa. At the closest zoom GSI's 5 m model from its
     airborne laser survey (LiDAR) is used where it exists, the 10 m national model elsewhere and at the other zooms. They are
     recoded to terrarium in this browser; any pixel GSI has no value for (sea, outside Japan, no survey) comes from the next
     source down, ending with the AWS tile. */
  var GSI5 = "https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/{z}/{x}/{y}.png", GSI10 = "https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png";
  var JP = [20, 122, 46, 154], JP_ATTR = 'Terrain in Japan: <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">GSI Japan</a> elevation tiles (5 m laser survey, 10 m)';
  function tileLon(x, z) { return x / Math.pow(2, z) * 360 - 180; }
  function tileLat(y, z) { return Math.atan(Math.sinh(Math.PI * (1 - 2 * y / Math.pow(2, z)))) * 180 / Math.PI; }
  function inJapan(z, x, y) { return z >= 6 && tileLon(x + 1, z) > JP[1] && tileLon(x, z) < JP[3] && tileLat(y, z) > JP[0] && tileLat(y + 1, z) < JP[2]; }
  function sub(u, z, x, y) { return u.replace("{z}", z).replace("{x}", x).replace("{y}", y); }
  /* a tile's pixels, or null when the host has no tile there (404) */
  function px(u, sig) {
    return fetch(u, { signal: sig, mode: "cors" }).then(function (r) {
      if (r.status === 404) return null;
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.blob().then(function (b) { return createImageBitmap(b, { colorSpaceConversion: "none", premultiplyAlpha: "none" }); }).then(function (bm) {
        var c = W.OffscreenCanvas ? new OffscreenCanvas(256, 256) : D.createElement("canvas"); c.width = c.height = 256;
        var x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(bm, 0, 0, 256, 256);
        return x.getImageData(0, 0, 256, 256).data;
      });
    });
  }
  /* GSI PNG elevation: 0.01 m steps in 24 bits, two's complement; 2^23 (and transparent) = no value */
  function gsiH(d) {
    if (!d) return null;
    var h = new Float32Array(65536);
    for (var i = 0, k = 0; k < 65536; i += 4, k++) {
      var v = d[i] * 65536 + d[i + 1] * 256 + d[i + 2];
      h[k] = d[i + 3] === 0 || v === 8388608 ? NaN : (v < 8388608 ? v : v - 16777216) * 0.01;
    }
    return h;
  }
  function demTile(params, abort) {
    var m = /(\d+)\/(\d+)\/(\d+)$/.exec(params.url), z = +m[1], x = +m[2], y = +m[3], sig = abort && abort.signal;
    var awsU = sub(DEM, z, x, y);
    var aws = function () { return fetch(awsU, { signal: sig, mode: "cors" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.arrayBuffer(); }).then(function (b) { return { data: b }; }); };
    if (!inJapan(z, x, y)) return aws();
    /* at z15 the laser model, then the 10 m model of the z14 tile above (each pixel covers 2 x 2) */
    var layers = z >= 15 ? [px(sub(GSI5, z, x, y), sig).then(gsiH), px(sub(GSI10, 14, x >> 1, y >> 1), sig).then(gsiH).then(function (P) {
      if (!P) return null;
      var h = new Float32Array(65536), ox = (x & 1) * 128, oy = (y & 1) * 128;
      for (var j = 0; j < 256; j++) for (var i = 0; i < 256; i++) h[j * 256 + i] = P[(oy + (j >> 1)) * 256 + ox + (i >> 1)];
      return h;
    })] : [px(sub(GSI10, z, x, y), sig).then(gsiH)];
    return Promise.all(layers).then(function (L2) {
      var h = new Float32Array(65536).fill(NaN), got = 0, miss = 0;
      L2.forEach(function (a) { if (a) for (var k = 0; k < 65536; k++) if (h[k] !== h[k] && a[k] === a[k]) { h[k] = a[k]; got++; } });
      if (!got) return aws();
      for (var k = 0; k < 65536; k++) if (h[k] !== h[k]) miss++;
      return (miss ? px(awsU, sig) : Promise.resolve(null)).then(function (a) {
        var c = W.OffscreenCanvas ? new OffscreenCanvas(256, 256) : D.createElement("canvas"); c.width = c.height = 256;
        var cx = c.getContext("2d"), im = cx.createImageData(256, 256), d = im.data;
        for (var k = 0, i = 0; k < 65536; k++, i += 4) {
          if (h[k] === h[k]) { var v = h[k] + 32768; d[i] = Math.floor(v / 256); d[i + 1] = Math.floor(v) % 256; d[i + 2] = Math.floor((v - Math.floor(v)) * 256); }
          else if (a) { d[i] = a[i]; d[i + 1] = a[i + 1]; d[i + 2] = a[i + 2]; }
          else { d[i] = 128; d[i + 1] = 0; d[i + 2] = 0; }   /* 0 m */
          d[i + 3] = 255;
        }
        cx.putImageData(im, 0, 0);
        return c.convertToBlob ? c.convertToBlob({ type: "image/png" }) : new Promise(function (ok) { c.toBlob(ok, "image/png"); });
      }).then(function (b) { return b.arrayBuffer(); }).then(function (b) { return { data: b }; });
    });
  }
  /* 3D map pictures go through here: a busy host (429, 5xx, dropped connection) is asked once or twice more after a pause,
     and on a base map a place with no picture at this zoom (404) or a host that keeps failing gets the closest wider
     picture (up to 6 levels up) enlarged to fit, as the flat map does, instead of a blurry hole and an error */
  var TPL = [];
  function pause(ms, sig) { return new Promise(function (ok, no) { var t = setTimeout(ok, ms); if (sig) sig.addEventListener("abort", function () { clearTimeout(t); no(new DOMException("aborted", "AbortError")); }); }); }
  function getTile(u, sig, tries) {
    return fetch(u, { signal: sig, mode: "cors" }).then(function (r) {
      if (r.status === 404) return null;
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.arrayBuffer();
    }).catch(function (e) {
      if (e.name === "AbortError" || tries <= 0) throw e;
      return pause(tries > 1 ? 800 : 2000, sig).then(function () { return getTile(u, sig, tries - 1); });
    });
  }
  function rasterTile(params, abort) {
    var m = /^osapr:\/\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/.exec(params.url), t = m && TPL[+m[1]], sig = abort && abort.signal;
    if (!t) return Promise.reject(new Error("map closed"));
    var z = +m[2], x = +m[3], y = +m[4];
    function up(k) {
      if (k > (t.base ? 6 : 0) || z - k < 0) return Promise.reject(new Error("no map picture here"));
      var X = x >> k, Y = y >> k, u = t.urls[(X + Y) % t.urls.length];
      return getTile(sub(u, z - k, X, Y), sig, k ? 1 : 2).then(function (b) {
        if (!b || !b.byteLength) return up(k + 1);
        if (!k) return { data: b };
        return createImageBitmap(new Blob([b])).then(function (bm) {
          var f = 1 << k, w = bm.width / f, h = bm.height / f;
          var c = W.OffscreenCanvas ? new OffscreenCanvas(256, 256) : D.createElement("canvas"); c.width = c.height = 256;
          var cx = c.getContext("2d"); cx.imageSmoothingQuality = "high";
          cx.drawImage(bm, (x - (X << k)) * w, (y - (Y << k)) * h, w, h, 0, 0, 256, 256);
          return c.transferToImageBitmap ? c.transferToImageBitmap() : createImageBitmap(c);
        }).then(function (bm) { return { data: bm }; });
      }, function (e) { if (e.name === "AbortError" || !t.base) throw e; return up(k + 1); });
    }
    return up(0);
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var mapEl = map.getContainer();

  /* ---------- scale bar ---------- */
  var UNITS = { km: [1000, "km", 1, "m"], mi: [1609.344, "mi", 0.3048, "ft"], nm: [1852, "nm", 0, ""] };
  function unitGet() { try { var u = JSON.parse(lsGet(K_UNIT) || "null"); if (u && UNITS[u.unit]) return u.unit; } catch (e) {} return "km"; }
  function unitNext() {
    var o = {}; try { o = JSON.parse(lsGet(K_UNIT) || "null") || {}; } catch (e) {}
    var ks = Object.keys(UNITS); o.unit = ks[(ks.indexOf(unitGet()) + 1) % ks.length];
    lsSet(K_UNIT, JSON.stringify(o)); return o.unit;
  }
  /* the longest bar that fits maxPx, in three equal steps of 1, 2, 2.5 or 5 x 10^n of the unit (or of m / ft when short) */
  function scaleFit(mpp, maxPx) {
    var U = UNITS[unitGet()], big = U[0], small = U[2], lab = U[1];
    var per = big, max = mpp * maxPx / 3;
    if (small && max < big * 0.5) { per = small; lab = U[3]; }
    var v = max / per, p = Math.pow(10, Math.floor(Math.log10(v))), step = p;
    /* no quarter steps below one unit: 0.25 / 0.5 / 0.75 do not fit side by side on a phone */
    [1, 2, 2.5, 5].forEach(function (f) { if (f * p <= v && !(f === 2.5 && p < 1)) step = f * p; });
    return { px: step * per / mpp, step: step, lab: lab };
  }
  function fmtN(n) { return String(+n.toFixed(2)).replace(/\.0+$/, ""); }
  function scaleHtml(mpp, maxPx) {
    if (!(mpp > 0) || !isFinite(mpp)) return "";
    var f = scaleFit(mpp, maxPx), w = Math.round(f.px * 3);
    var t = "";
    /* when the middle numbers would touch (short steps such as 0.2 nm), only the ends are labelled */
    var mid = fmtN(f.step * 2).length * 7 + 6 <= f.px;
    for (var i = 0; i <= 3; i++) if (mid || i === 0 || i === 3) t += '<span style="left:' + Math.round(f.px * i) + 'px">' + fmtN(f.step * i) + (i === 3 ? "<b>" + f.lab + "</b>" : "") + "</span>";
    return '<div class="o3s-t" style="width:' + w + 'px">' + t + '</div><div class="o3s-b" style="width:' + w + 'px"><i></i><i></i><i></i></div>';
  }
  function scaleMax() { return mapEl.clientWidth < 520 ? 130 : 190; }
  var ScaleCtl = L.Control.extend({
    options: { position: "bottomleft" },
    onAdd: function () {
      var d = L.DomUtil.create("div", "o3s leaflet-control");
      d.setAttribute("role", "button"); d.tabIndex = 0; d.title = "Map scale. Tap to change the unit (km, mi, nm)";
      L.DomEvent.disableClickPropagation(d);
      function go() { unitNext(); drawScale(); if (view3) view3.scale(); }
      d.addEventListener("click", go);
      d.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
      return d;
    }
  });
  var scale = new ScaleCtl().addTo(map), scaleEl = scale.getContainer();
  function drawScale() {
    var s = map.getSize(), y = s.y / 2, a = map.containerPointToLatLng([s.x / 2 - 50, y]), b = map.containerPointToLatLng([s.x / 2 + 50, y]);
    scaleEl.innerHTML = scaleHtml(map.distance(a, b) / 100, scaleMax());
  }
  map.on("zoomend moveend resize", drawScale); drawScale();

  /* ---------- the 3D button ---------- */
  var ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 19l6.5-10 4 6 3-4.5L22 19z"/><path d="M8.5 9l1.8 2.7M15.5 10.5l1.4 2.1" opacity=".6"/></svg>';
  function addToolbarBtn() {
    var list = D.querySelector("#atk-tools .atk-list");
    if (!list || list.querySelector("[data-o3d]")) return !!list;
    var b = D.createElement("button");
    b.type = "button"; b.setAttribute("data-o3d", ""); b.title = "3D terrain: tilt and turn the map over the ground"; b.setAttribute("aria-label", "3D");
    b.innerHTML = ICON + '<span class="atk-l">3D</span>';
    b.addEventListener("click", function (e) { e.stopPropagation(); open3d(); });
    /* with Grid and Crosshair, after Base map: the map group of the toolbar */
    list.insertBefore(b, list.querySelector('[data-atk="measure"]'));
    return true;
  }
  addToolbarBtn();
  var BtnCtl = L.Control.extend({
    options: { position: "topleft" },
    onAdd: function () {
      var d = L.DomUtil.create("div", "leaflet-bar o3dctl leaflet-control");
      d.innerHTML = '<a href="#" role="button" title="3D terrain: tilt and turn the map over the ground" aria-label="3D terrain">3D</a>';
      L.DomEvent.disableClickPropagation(d);
      d.firstChild.addEventListener("click", function (e) { e.preventDefault(); open3d(); });
      return d;
    }
  });
  new BtnCtl().addTo(map);

  /* ---------- what the 2D map shows, turned into 3D sources ---------- */
  function paneOf(l) { return map.getPane(l.options && l.options.pane || "overlayPane"); }
  function paneShown(p) { if (!p) return true; var s = getComputedStyle(p); return s.display !== "none" && s.visibility !== "hidden"; }
  function paneZ(p) { return p ? +getComputedStyle(p).zIndex || 0 : 0; }
  function tileUrls(l) {
    var u = l._url, o = l.options;
    if (!u || /^data:/.test(u)) return null;
    if (l instanceof L.TileLayer.WMS) {
      var p = L.extend({}, l.wmsParams, { width: 256, height: 256 });
      p[p.version >= "1.3" ? "crs" : "srs"] = "EPSG:3857";
      return [u + L.Util.getParamString(p, u) + "&bbox={bbox-epsg-3857}"];
    }
    u = u.replace("{r}", "").replace(/\{(?!z\}|x\}|y\}|s\})([^}]+)\}/g, function (m, k) { return o[k] != null && typeof o[k] !== "function" ? o[k] : m; });
    if (/\{(?!z\}|x\}|y\}|s\})[^}]+\}/.test(u)) return null;
    if (/\{s\}/.test(u)) { var sd = o.subdomains || "abc"; return (typeof sd === "string" ? sd.split("") : sd).map(function (s) { return u.replace("{s}", s); }); }
    return [u];
  }
  function rasters() {
    var out = [];
    map.eachLayer(function (l) {
      if (!(l instanceof L.TileLayer) || !map.hasLayer(l)) return;
      /* the Elevation and LiDAR shading is multiplied into the 2D base map; 3D has no multiply, so it shades from the elevation instead */
      if (/(^| )osap-hs( |$)/.test(l.options.className || "")) return;
      var p = paneOf(l); if (!paneShown(p)) return;
      var urls = tileUrls(l); if (!urls) return;
      var o = l.options, op = o.opacity == null ? 1 : o.opacity;
      if (!(op > 0)) return;
      out.push({ urls: urls, z: paneZ(p) * 1000 + (o.zIndex || 1), op: op, min: o.minNativeZoom || o.minZoom || 0,
        max: Math.min(o.maxNativeZoom || o.maxZoom || 18, 22), tms: !!o.tms, attr: o.attribution || "", base: (o.pane || "tilePane") === "tilePane" });
    });
    return out.sort(function (a, b) { return a.z - b.z; });
  }
  function popHtml(l) {
    var p = l.getPopup && l.getPopup(), c = p && p._content, t = l.getTooltip && l.getTooltip();
    if (typeof c === "function") { try { c = c(l); } catch (e) { c = null; } }
    if (c && c.nodeType) c = c.outerHTML;
    if (typeof c === "string" && c) return c;
    var tc = t && t._content; if (typeof tc === "function") { try { tc = tc(l); } catch (e) { tc = null; } }
    if (typeof tc === "string" && tc) return tc;
    var n = l.options && (l.options.title || l.options.lgl); return n ? "<b>" + esc(n) + "</b>" : "";
  }
  function ring(lls) { var r = lls.map(function (p) { return [p.lng, p.lat]; }); if (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) r.push(r[0]); return r; }
  function vectors() {
    var pts = [], lines = [], fills = [], marks = [], icons = [], L2 = [], nv = 0;
    map.eachLayer(function (l) {
      if (l instanceof L.LayerGroup || l instanceof L.TileLayer || l instanceof L.Renderer || !map.hasLayer(l)) return;
      var p = paneOf(l); if (!paneShown(p)) return;
      var o = l.options || {}, id = L2.length, col = o.fillColor || o.color || "#0b7285";
      if (l instanceof L.CircleMarker) {
        if (o.opacity === 0 && !(o.fillOpacity > 0)) return;
        if (pts.length > 20000) return;
        var ll = l.getLatLng(); L2.push(l);
        pts.push({ type: "Feature", id: id, properties: { c: col, s: o.stroke === false ? col : o.color || col, w: o.stroke === false ? 0 : Math.min(o.weight || 1, 3),
          r: Math.max(2.5, Math.min(l.getRadius ? (l instanceof L.Circle ? 6 : l.getRadius()) : 5, 14)), fo: o.fill === false ? 0 : o.fillOpacity == null ? 0.2 : o.fillOpacity, i: o.interactive !== false ? 1 : 0, z: paneZ(p) },
          geometry: { type: "Point", coordinates: [ll.lng, ll.lat] } });
      } else if (l instanceof L.Marker) {
        var m = l.getLatLng(); L2.push(l);
        if ((o.pane || "") === "atakpane") marks.push({ id: id, ll: m, n: o.title || "" });
        else if (l._icon && icons.length < 1500) icons.push({ id: id, ll: m, el: l._icon, z: paneZ(p) });
        else if (pts.length <= 20000) pts.push({ type: "Feature", id: id, properties: { c: "#0b7285", s: "#fff", w: 1.5, r: 6, fo: 1, i: 1, z: paneZ(p) }, geometry: { type: "Point", coordinates: [m.lng, m.lat] } });
      } else if (l instanceof L.Polyline) {
        var g = l.getLatLngs(); if (!g || !g.length) return;
        var poly = l instanceof L.Polygon, flat = !Array.isArray(g[0]), deep = !flat && Array.isArray(g[0][0]);
        var parts = flat ? [g] : deep ? [].concat.apply([], g) : g;
        parts.forEach(function (x) { nv += x.length; });
        if (nv > 300000) return;
        L2.push(l);
        var props = { c: o.color || "#3388ff", w: Math.min(o.weight == null ? 3 : o.weight, 8), op: o.opacity == null ? 1 : o.opacity, fc: o.fillColor || o.color || "#3388ff",
          fo: o.fill === false || (!poly && !o.fill) ? 0 : o.fillOpacity == null ? 0.2 : o.fillOpacity, d: o.dashArray ? 1 : 0, i: o.interactive !== false ? 1 : 0 };
        if (poly) {
          var polys = deep ? g.map(function (pp) { return pp.map(ring); }) : flat ? [[ring(g)]] : [g.map(ring)];
          var geom = { type: "MultiPolygon", coordinates: polys };
          if (props.fo > 0) fills.push({ type: "Feature", id: id, properties: props, geometry: geom });
          if (o.stroke !== false) lines.push({ type: "Feature", id: id, properties: props, geometry: { type: "MultiLineString", coordinates: [].concat.apply([], polys) } });
        } else if (o.stroke !== false) {
          lines.push({ type: "Feature", id: id, properties: props, geometry: { type: "MultiLineString", coordinates: parts.map(function (x) { return x.map(function (q) { return [q.lng, q.lat]; }); }) } });
        }
      }
    });
    pts.sort(function (a, b) { return a.properties.z - b.properties.z; });
    return { pts: pts, lines: lines, fills: fills, marks: marks, icons: icons, layers: L2 };
  }

  /* ---------- loading the engine once ---------- */
  var libP = null;
  function loadLib() {
    if (W.maplibregl) return Promise.resolve(W.maplibregl);
    if (libP) return libP;
    libP = new Promise(function (ok, bad) {
      var css = D.createElement("link"); css.rel = "stylesheet"; css.href = LIB + ".css"; D.head.appendChild(css);
      var s = D.createElement("script"); s.src = LIB + ".js";
      s.onload = function () { W.maplibregl ? ok(W.maplibregl) : bad(new Error("no engine")); };
      s.onerror = function () { libP = null; bad(new Error("The 3D engine did not download. Check the connection and try again.")); };
      D.head.appendChild(s);
    });
    return libP;
  }

  /* What the open building data records about one building, for its popup: only what is in the record, "not recorded" for the
     rest, and where each part came from. Every value is the data's own text, escaped; nothing is inferred except the footprint
     area, which is measured from the outline drawn. */
  function word(s) { s = String(s).replace(/_/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); }
  function jsonOf(s) { try { return typeof s === "string" ? JSON.parse(s) : s; } catch (e) { return null; } }
  function ringArea(r) {   /* square metres of a lon/lat ring, on a sphere */
    var a = 0, R = 6378137, k = Math.PI / 180;
    for (var i = 0, n = r.length; i < n; i++) { var p = r[i], q = r[(i + 1) % n]; a += (q[0] - p[0]) * k * (2 + Math.sin(p[1] * k) + Math.sin(q[1] * k)); }
    return Math.abs(a * R * R / 2);
  }
  function footArea(g) {
    if (!g) return 0;
    var polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    return polys.reduce(function (t, pg) { return t + pg.reduce(function (u, r, i) { return u + (i ? -1 : 1) * ringArea(r); }, 0); }, 0);
  }
  var SRC = { "OpenStreetMap": "OpenStreetMap (drawn by volunteers)", "Google Open Buildings": "Google Open Buildings (traced by a computer from satellite photos)",
    "Microsoft ML Buildings": "Microsoft building footprints (traced by a computer from satellite photos)" };
  function bldInfo(q, geom) {
    var rows = [], nm = jsonOf(q.names) || {}, prim = nm.primary || q["@name"] || "", en = nm.common && nm.common.en, said = 0;
    /* only what is recorded gets a line; "said" counts the details beyond the outline itself */
    function row(k, v, own) { rows.push("<tr><th>" + esc(k) + "</th><td>" + v + "</td></tr>"); if (own) said++; }
    var use = q["class"] ? word(q["class"]) + (q.subtype && q.subtype !== q["class"] ? " (" + esc(word(q.subtype)).toLowerCase() + ")" : "") : q.subtype ? word(q.subtype) : "";
    if (use) row("Use", esc(use), 1);
    if (q.height != null) row("Height", esc(Math.round(q.height * 10) / 10) + " m" + (q["@height_source"] ? " (" + esc(q["@height_source"]) + ")" : ""), 1);
    if (q.num_floors != null) row("Floors", esc(q.num_floors) + (q.num_floors_underground ? " + " + esc(q.num_floors_underground) + " below ground" : ""), 1);
    if (q.min_height != null || q.min_floor != null) row("Starts at", q.min_height != null ? esc(q.min_height) + " m up" : "floor " + esc(q.min_floor), 1);
    if (q.roof_shape || q.roof_material || q.roof_color) row("Roof", esc([q.roof_shape, q.roof_material, q.roof_color].filter(Boolean).map(word).join(", ")), 1);
    if (q.facade_material || q.facade_color) row("Walls", esc([q.facade_material, q.facade_color].filter(Boolean).map(word).join(", ")), 1);
    var a = footArea(geom); if (a > 1) row("Footprint", "about " + esc((a >= 1000 ? Math.round(a / 10) * 10 : Math.round(a)).toLocaleString("en-US")) + " m² (measured from the outline)");
    var src = (jsonOf(q.sources) || [])[0] || {}, gs = q["@geometry_source"] || src.dataset || "", from = SRC[gs] ? esc(SRC[gs]) : gs ? esc(gs) : "";
    if (src.confidence != null) from += "; the computer was " + esc(Math.round(src.confidence * 100)) + "% sure it is a building";
    var m = /^([nwr])(\d+)/.exec(src.record_id || "");
    if (gs === "OpenStreetMap" && m) from += ' · <a href="https://www.openstreetmap.org/' + { n: "node", w: "way", r: "relation" }[m[1]] + "/" + m[2] + '" target="_blank" rel="noopener">see it on OpenStreetMap</a>';
    if (from) row("Outline from", from);
    if (src.update_time) row(gs === "OpenStreetMap" ? "Last edited" : "Dated", esc(String(src.update_time).slice(0, 10)));
    var none = !prim && !said;
    return "<h3>" + (prim ? esc(prim) : "Building") + "</h3>" + (en && en !== prim ? "<p>" + esc(en) + "</p>" : "") +
      (none ? '<p class="o3-none">No name, use, height or floors are recorded for this building in the open building data.</p>' : "") +
      (q.height == null ? '<p class="o3-bn">Its height in 3D is an estimate.</p>' : "") +
      '<table class="o3-bt">' + rows.join("") + "</table>" +
      '<div class="o3-osm" aria-live="polite"></div>' +
      '<p class="o3-bn">Open data from Overture Maps, not an official survey: details can be missing, out of date or wrong.' + (q.id ? " ID " + esc(q.id) : "") + "</p>";
  }

  /* Many buildings whose outline was traced by a computer carry nothing, while OpenStreetMap volunteers have named the
     place or tagged its use at that spot. On a tap (never before), ask OpenStreetMap (Overpass, keyless) what building
     outlines contain the tapped point and which named places are within 25 m. Shown under its own heading with links,
     so it is never mixed up with the building data; only the tapped point is sent. */
  var OVP = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
  var osmMemo = {};
  function osmAsk(lat, lon) {
    var k = lat.toFixed(5) + "," + lon.toFixed(5);
    if (osmMemo[k]) return osmMemo[k];
    var q = "[out:json][timeout:15];is_in(" + lat + "," + lon + ")->.a;(way(pivot.a)[building];relation(pivot.a)[building];way(pivot.a)[amenity];relation(pivot.a)[amenity];);out tags 6;" +
      "node(around:25," + lat + "," + lon + ")[name];out tags center 8;";
    function go(i) {
      if (i >= OVP.length) return Promise.reject(new Error("OpenStreetMap could not be reached"));
      var ac = W.AbortController ? new AbortController() : null, t = setTimeout(function () { if (ac) ac.abort(); }, 15000);
      return fetch(OVP[i], { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: ac && ac.signal })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (j) { clearTimeout(t); return j; }, function () { clearTimeout(t); return go(i + 1); });
    }
    var p = osmMemo[k] = go(0).then(null, function (e) { delete osmMemo[k]; throw e; });
    return p;
  }
  function tidy(s, n) { return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n || 80); }
  var KIND = ["amenity", "shop", "office", "tourism", "healthcare", "leisure", "military", "government", "craft", "religion", "public_transport", "railway", "aeroway", "man_made", "historic", "building"];
  function osmKind(t) {
    for (var i = 0; i < KIND.length; i++) { var v = t[KIND[i]]; if (v && v !== "yes") return word(tidy(v, 40)); }
    return t.building ? "Building" : "";
  }
  function osmHtml(j, lat, lon) {
    var els = (j && j.elements) || [], bl = [], pl = [];
    els.forEach(function (e) {
      var t = e.tags || {}, url = "https://www.openstreetmap.org/" + e.type + "/" + e.id, link = ' <a href="' + url + '" target="_blank" rel="noopener">OSM</a>';
      if (e.type === "node") {
        var d = Math.round(L.latLng(lat, lon).distanceTo([e.lat, e.lon]));
        pl.push("<li>" + esc(tidy(t["name:en"] || t.name)) + (t["name:en"] && t.name && t.name !== t["name:en"] ? " (" + esc(tidy(t.name)) + ")" : "") +
          (osmKind(t) ? " · " + esc(osmKind(t)) : "") + " · " + d + " m" + link + "</li>");
      } else {
        var bits = [];
        if (t.name || t["name:en"]) bits.push("<b>" + esc(tidy(t["name:en"] || t.name)) + "</b>" + (t["name:en"] && t.name && t.name !== t["name:en"] ? " (" + esc(tidy(t.name)) + ")" : ""));
        if (osmKind(t)) bits.push(esc(osmKind(t)));
        if (t["building:levels"]) bits.push(esc(tidy(t["building:levels"], 6)) + " floors");
        if (t.height) bits.push(esc(tidy(t.height, 10)) + (/[a-z]/i.test(t.height) ? "" : " m") + " high");
        if (t.operator) bits.push("run by " + esc(tidy(t.operator)));
        if (t["addr:housenumber"] || t["addr:street"]) bits.push(esc(tidy([t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" "))));
        if (bits.length && !(bits.length === 1 && bits[0] === "Building")) bl.push("<li>" + bits.join(" · ") + link + "</li>");
      }
    });
    var h = '<h4>OpenStreetMap at this spot</h4>';
    if (!bl.length && !pl.length) return h + '<p class="o3-nr">Nothing more is recorded in OpenStreetMap here.</p>';
    return h + (bl.length ? '<ul class="o3-ol">' + bl.slice(0, 4).join("") + "</ul>" : "") +
      (pl.length ? "<p class=\"o3-bn\">Named places within 25 m:</p><ul class=\"o3-ol\">" + pl.slice(0, 6).join("") + "</ul>" : "") +
      '<p class="o3-bn">Mapped by OpenStreetMap volunteers, not checked by OSAP.</p>';
  }

  /* the PMTiles reader for the buildings, loaded the first time buildings are drawn; its protocol is added to the engine once */
  var pmP = null;
  function loadPm(ml) {
    if (pmP) return pmP;
    pmP = new Promise(function (ok, bad) {
      var s = D.createElement("script"); s.src = PMLIB;
      s.onload = function () { if (!W.pmtiles) return bad(new Error("no reader")); try { ml.addProtocol("pmtiles", new W.pmtiles.Protocol({ metadata: true }).tile); } catch (e) {} ok(); };
      s.onerror = function () { pmP = null; bad(new Error("no reader")); };
      D.head.appendChild(s);
    });
    return pmP;
  }
  /* the newest Overture release that has buildings tiles, from the bucket's own listing */
  function ovRelease() {
    var c = null; try { c = JSON.parse(lsGet(K_OVR) || "null"); } catch (e) {}
    if (c && /^\d{4}-\d\d-\d\d\.\d+$/.test(c.r) && Date.now() - c.t < 3 * 864e5) return Promise.resolve(c.r);
    var ac = W.AbortController ? new AbortController() : null, to = setTimeout(function () { if (ac) ac.abort(); }, 6000);
    return fetch(OVB + "?list-type=2&prefix=tiles/&delimiter=/", ac ? { signal: ac.signal } : {}).then(function (r) { return r.ok ? r.text() : ""; }).then(function (x) {
      clearTimeout(to);
      var m, all = [], re = /<Prefix>tiles\/(\d{4}-\d\d-\d\d\.\d+)\/<\/Prefix>/g;
      while ((m = re.exec(x))) all.push(m[1]);
      all.sort(function (a, b) { var p = a.split("."), q = b.split("."); return p[0] < q[0] ? -1 : p[0] > q[0] ? 1 : p[1] - q[1]; });
      var r = all.length ? all[all.length - 1] : OVR;
      if (all.length) lsSet(K_OVR, JSON.stringify({ r: r, t: Date.now() }));
      return r;
    }).catch(function () { clearTimeout(to); return OVR; });
  }
  /* A building's height in metres: the recorded height, else its floors at 3.2 m, else an estimate from its kind with a spread
     taken from the last hex digit of its id (0-15), so a block of houses is not one flat slab. Shared by buildings and their
     parts (OpenStreetMap's detailed models of a building's sections). */
  var V16 = ["/", ["index-of", ["slice", ["get", "id"], ["-", ["length", ["get", "id"]], 1]], "0123456789abcdef"], 15];
  var KNOWN = ["any", ["has", "height"], ["has", "num_floors"]];
  var HEIGHT = ["case", ["has", "height"], ["get", "height"], ["has", "num_floors"], ["max", 3, ["*", ["get", "num_floors"], 3.2]],
    ["match", ["get", "class"],
      ["roof", "carport", "parking", "shelter", "pavilion", "garage", "garages"], ["+", 3, ["*", V16, 1.5]],
      ["apartments", "hotel", "office", "hospital", "dormitory", "university", "college", "government"], ["+", 12, ["*", V16, 12]],
      ["commercial", "retail", "school", "civic", "train_station", "industrial", "warehouse", "temple", "church", "library", "post_office"], ["+", 6, ["*", V16, 6]],
      ["+", 3.5, ["*", V16, 5]]]];
  var MINH = ["case", ["has", "min_height"], ["get", "min_height"], ["has", "min_floor"], ["*", ["get", "min_floor"], 3.2], 0];
  function bldPaint() {
    return { /* warm sandstone where the height is recorded (taller is deeper), a cool pale grey where it is estimated */
      "fill-extrusion-color": ["case", KNOWN, ["interpolate", ["linear"], HEIGHT, 0, "#e9dfcc", 25, "#dccab0", 70, "#c6ac8a", 160, "#a98a68"], "#d5d9de"],
      "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], BLD_Z, 0, BLD_Z + 0.6, HEIGHT],
      "fill-extrusion-base": ["interpolate", ["linear"], ["zoom"], BLD_Z, 0, BLD_Z + 0.6, MINH],
      "fill-extrusion-opacity": 1, "fill-extrusion-vertical-gradient": true };
  }

  /* fetch the engine into this browser's cache while the app is idle, so the first press of 3D only has to start it
     (skipped when the phone asks to save data) */
  function preload() {
    var c = navigator.connection; if (W.maplibregl || libP || (c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || "")))) return;
    [LIB + ".js", LIB + ".css"].forEach(function (u) { try { fetch(u, { credentials: "same-origin", priority: "low" }).catch(function () {}); } catch (e) {} });
  }
  W.addEventListener("load", function () { setTimeout(function () { (W.requestIdleCallback || setTimeout)(preload, { timeout: 8000 }); }, 5000); });

  /* ---------- the 3D view ---------- */
  var view3 = null, demProto = false;
  var BLD_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">' +
    '<path d="M3 21h18M5 21V8l6-3v16M11 21V3l8 4v14"/><path d="M14 9h2M14 12h2M14 15h2M7.5 11h1M7.5 14h1M7.5 17h1" stroke-linecap="round"/></svg>';
  function prefs() { var p = {}; try { p = JSON.parse(lsGet(K_3D) || "{}") || {}; } catch (e) {} return { pitch: p.pitch >= 0 && p.pitch <= 85 ? p.pitch : 60, ex: [1, 1.5, 2, 3].indexOf(p.ex) >= 0 ? p.ex : 1.5, bld: p.bld !== false }; }
  function savePrefs(o) { var p = prefs(); for (var k in o) p[k] = o[k]; lsSet(K_3D, JSON.stringify(p)); }
  var POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  /* the engine's bearing (-180 to 180) as a heading 0 to 359 */
  function heading(b) { var h = Math.round(((b % 360) + 360) % 360); return h === 360 ? 0 : h; }
  var COMPASS = '<svg viewBox="0 0 40 40" width="38" height="38" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="rgba(20,24,28,.86)" stroke="rgba(255,255,255,.35)"/>' +
    '<g class="o3-needle"><path d="M20 5l5 15h-10z" fill="#e03131"/><path d="M20 35l-5-15h10z" fill="#dee2e6"/><text x="20" y="13.5" text-anchor="middle" font-size="7" font-weight="700" fill="#fff" font-family="system-ui,sans-serif">N</text></g></svg>';

  /* a thin bar over the 3D map while its tiles load, with how far along it is; when pictures keep failing it says so and
     offers Try again (the same tiles asked for once more) */
  function progress(gl, bar, gone) {
    var want = {}, got = {}, bad = {}, nW = 0, nG = 0, nB = 0, t = 0;
    function key(e) { return e.sourceId + "/" + (e.tile && e.tile.tileID ? e.tile.tileID.key : ""); }
    gl.on("dataloading", function (e) { if (e.tile && e.sourceId && !want[key(e)]) { want[key(e)] = 1; nW++; kick(); } });
    gl.on("data", function (e) { if (e.tile && e.sourceId && e.dataType === "source" && want[key(e)] && !got[key(e)]) { got[key(e)] = 1; nG++; kick(); } });
    gl.on("error", function (e) { if (e && e.sourceId && e.tile && !bad[key(e)]) { bad[key(e)] = 1; nB++; kick(); } });
    function kick() { if (!t) t = setTimeout(draw, 200); }
    function draw() {
      t = 0; if (gone()) return;
      var done = gl.areTilesLoaded(), pct = nW ? Math.min(100, Math.round((nG + nB) / nW * 100)) : 0;
      if (done && !nB) { bar.hidden = true; want = {}; got = {}; bad = {}; nW = nG = nB = 0; return; }
      bar.hidden = false; bar.classList.toggle("err", nB > 2 && done);
      bar.setAttribute("aria-valuenow", String(pct));
      bar.firstChild.style.width = (done ? 100 : pct) + "%";
      bar.lastChild.innerHTML = nB > 2 && done ? esc(nB + " map pictures did not load. ") + '<button type="button">Try again</button>' : esc("Loading 3D map " + pct + "%");
      if (!done) kick();
    }
    bar.addEventListener("click", function (e) {
      if (!e.target.closest("button")) return;
      want = {}; got = {}; bad = {}; nW = nG = nB = 0; bar.classList.remove("err");
      Object.keys(gl.getStyle().sources).forEach(function (id) { var s = gl.getSource(id); if (s && s.type !== "geojson" && gl.refreshTiles) try { gl.refreshTiles(id); } catch (x) {} });
      kick();
    });
  }

  function open3d() {
    if (view3) return;
    var box = D.createElement("div");
    box.id = "o3d"; box.className = "leaflet-control"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "3D terrain view");
    box.innerHTML = '<div class="o3-map"></div><div class="o3-msg" role="status">Loading 3D…</div>' +
      '<div class="o3-load" role="progressbar" aria-label="Loading the 3D map" aria-valuemin="0" aria-valuemax="100" hidden><i></i><span></span></div>' +
      '<div class="o3-side"><button type="button" class="o3-b o3-2d" title="Back to the flat map at this place" aria-label="Back to 2D">2D</button>' +
      '<button type="button" class="o3-b o3-cmp" title="North up and flat. Shows where north is" aria-label="Compass: north up and flat">' + COMPASS + '<span class="o3-deg" aria-hidden="true">000° N</span></button>' +
      '<button type="button" class="o3-b o3-zi" aria-label="Zoom in" title="Zoom in">+</button><button type="button" class="o3-b o3-zo" aria-label="Zoom out" title="Zoom out">−</button>' +
      '<button type="button" class="o3-b o3-ex" title="Relief: how strongly hills and valleys are raised"></button>' +
      '<button type="button" class="o3-b o3-bld" title="3D buildings (Overture Maps). They appear when you zoom in close; grey ones have no recorded height and are drawn at an estimate" aria-label="3D buildings">' + BLD_ICON + "</button></div>" +
      '<div class="o3-tilt"><label>Tilt <input type="range" min="0" max="85" step="1" aria-label="View angle (tilt)"></label><output></output></div>' +
      '<button type="button" class="o3-crb" aria-expanded="false" aria-label="Map credits" title="Map credits">i</button><div class="o3-cr" hidden></div>' +
      '<div class="o3s o3-scale" role="button" tabindex="0" title="Map scale. Tap to change the unit (km, mi, nm)"></div>';
    ["click", "dblclick", "mousedown", "pointerdown", "touchstart", "wheel", "contextmenu", "keydown"].forEach(function (t) { box.addEventListener(t, function (e) { e.stopPropagation(); }); });
    mapEl.appendChild(box);
    var msg = box.querySelector(".o3-msg"), P = prefs(), gl = null, dead = false, markers = [];
    function say(t) { msg.textContent = t || ""; msg.hidden = !t; }
    function close(then) {
      if (dead) return; dead = true;
      if (gl) {
        var c = gl.getCenter(), z = Math.round(gl.getZoom() + 1);
        z = Math.max(map.getMinZoom(), Math.min(z, map.getMaxZoom()));
        try { gl.remove(); } catch (e) {}
        map.setView([c.lat, c.lng], z, { animate: false });
      }
      box.remove(); view3 = null; D.removeEventListener("keydown", onKey);
      var b = D.querySelector("[data-o3d]"); if (b) b.focus();
      if (then) then();
    }
    function onKey(e) { if (e.key === "Escape") close(); }
    D.addEventListener("keydown", onKey);
    box.querySelector(".o3-2d").addEventListener("click", function () { close(); });
    view3 = { close: close, scale: function () {} };

    loadLib().then(function (ml) {
      if (dead) return;
      var c = map.getCenter(), R = rasters(), V = vectors(), attrs = [DEM_ATTR, BLD_ATTR], b2 = map.getBounds();
      if (!demProto) { try { ml.addProtocol("osapdem", demTile); ml.addProtocol("osapr", rasterTile); demProto = true; } catch (e) {} }
      if (b2.getEast() > JP[1] && b2.getWest() < JP[3] && b2.getNorth() > JP[0] && b2.getSouth() < JP[2]) attrs.push(JP_ATTR);
      var DEMU = demProto ? "osapdem://{z}/{x}/{y}" : DEM;
      var style = { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#d9d4c7" } }],
        /* a deep blue sky fading to a pale horizon, and a light haze over distant ground, as the eye sees it */
        sky: { "sky-color": "#3f7fc4", "horizon-color": "#cfe0f0", "fog-color": "#dfe8ef", "sky-horizon-blend": 0.5, "horizon-fog-blend": 0.8, "fog-ground-blend": 0.6, "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 10, 1, 12, 0] },
        /* late-morning sun from the south-east, high enough that walls facing away are shaded but not black */
        light: { anchor: "map", position: [1.4, 135, 40], color: "#fff8ec", intensity: 0.42 } };
      var hillAt = 0; TPL = [];
      R.forEach(function (r, i) {
        var viaUs = demProto && !/\{bbox/.test(r.urls[0]);
        if (viaUs) TPL[i] = { urls: r.urls, base: r.base };
        style.sources["r" + i] = { type: "raster", tiles: viaUs ? ["osapr://" + i + "/{z}/{x}/{y}"] : r.urls, tileSize: 256, minzoom: r.min, maxzoom: r.max, scheme: r.tms ? "tms" : "xyz" };
        style.layers.push({ id: "r" + i, type: "raster", source: "r" + i, paint: { "raster-opacity": r.op, "raster-fade-duration": 120, "raster-contrast": r.base ? 0.06 : 0, "raster-saturation": r.base ? 0.08 : 0 } });
        if (r.base) hillAt = style.layers.length;
        if (r.attr && attrs.indexOf(r.attr) < 0) attrs.push(r.attr);
      });
      /* terrain and hill shading share one elevation source (one download per tile); inside Japan the GSI survey is
         sharp enough to be worth one more zoom level */
      style.sources.dem = { type: "raster-dem", tiles: [DEMU], tileSize: 256, maxzoom: attrs.indexOf(JP_ATTR) >= 0 ? 15 : 14, encoding: "terrarium" };
      var photo = R.some(function (r) { return r.base && /imagery|sentinel|s2cloudless|gibs|clarity/i.test(r.urls[0]); });
      style.layers.splice(hillAt || 1, 0, { id: "hill", type: "hillshade", source: "dem", paint: { "hillshade-method": "multidirectional",
        "hillshade-exaggeration": photo ? 0.3 : 0.55, "hillshade-shadow-color": photo ? "rgba(20,16,10,.55)" : "#473b2c", "hillshade-highlight-color": photo ? "rgba(255,250,235,.25)" : "#fffdf3",
        "hillshade-accent-color": photo ? "rgba(0,0,0,0)" : "#5c4d3a" } });
      style.terrain = { source: "dem", exaggeration: P.ex };
      style.sources.vf = { type: "geojson", data: { type: "FeatureCollection", features: V.fills } };
      style.sources.vl = { type: "geojson", data: { type: "FeatureCollection", features: V.lines } };
      style.sources.vp = { type: "geojson", data: { type: "FeatureCollection", features: V.pts } };
      style.layers.push({ id: "vf", type: "fill", source: "vf", paint: { "fill-color": ["get", "fc"], "fill-opacity": ["get", "fo"] } });
      style.layers.push({ id: "vl", type: "line", source: "vl", filter: ["==", ["get", "d"], 0], layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": ["get", "c"], "line-width": ["get", "w"], "line-opacity": ["get", "op"] } });
      style.layers.push({ id: "vld", type: "line", source: "vl", filter: ["==", ["get", "d"], 1], paint: { "line-color": ["get", "c"], "line-width": ["get", "w"], "line-opacity": ["get", "op"], "line-dasharray": [2, 2] } });
      style.layers.push({ id: "vp", type: "circle", source: "vp", paint: { "circle-color": ["get", "c"], "circle-opacity": ["get", "fo"], "circle-radius": ["get", "r"],
        "circle-stroke-color": ["get", "s"], "circle-stroke-width": ["get", "w"], "circle-pitch-alignment": "viewport" } });
      try {
        gl = new ml.Map({ container: box.querySelector(".o3-map"), style: style, center: [c.lng, c.lat], zoom: Math.max(0, map.getZoom() - 1),
          pitch: 0, bearing: 0, maxPitch: 85, maxZoom: 19, attributionControl: false, canvasContextAttributes: { antialias: true },
          /* 2x is as sharp as a phone screen shows at arm's length; 3x screens would draw over twice the pixels for nothing */
          pixelRatio: Math.min(W.devicePixelRatio || 1, 2), fadeDuration: 150 });
      } catch (e) {
        say("3D needs WebGL, which this browser or device has turned off. The flat map still works."); gl = null; return;
      }
      /* phones: a vertical one-finger drag should pan, two fingers tilt (the default) */
      /* 3D buildings, under the map's own overlays; the tiles are asked for only while the switch is on and the view is close */
      var bldB = box.querySelector(".o3-bld"), hintT = 0, bldAsk = false;
      function bldOn(on) {
        bldB.setAttribute("aria-pressed", on ? "true" : "false"); bldB.classList.toggle("on", on);
        if (!styleUp) return;   /* added once the style has loaded (see "style.load" below) */
        if (on && !bldAsk) {
          bldAsk = true;
          Promise.all([loadPm(ml), ovRelease()]).then(function (v) {
            if (dead || gl.getSource("bld")) return;
            gl.addSource("bld", { type: "vector", url: "pmtiles://" + OVB + "tiles/" + v[1] + "/buildings.pmtiles" });
            var under = gl.getLayer("vf") ? "vf" : undefined;
            gl.addLayer({ id: "bld", type: "fill-extrusion", source: "bld", "source-layer": "building", minzoom: BLD_Z,
              filter: ["all", ["!=", ["get", "is_underground"], true], ["!=", ["get", "has_parts"], true]], paint: bldPaint() }, under);
            gl.addLayer({ id: "bldp", type: "fill-extrusion", source: "bld", "source-layer": "building_part", minzoom: BLD_Z,
              filter: ["!=", ["get", "is_underground"], true], paint: bldPaint() }, under);
            bldOn(P.bld);
          }, function () { bldAsk = false; say("3D buildings did not load. Check the connection and press the buildings button again."); });
        }
        ["bld", "bldp"].forEach(function (id) { if (gl.getLayer(id)) gl.setLayoutProperty(id, "visibility", on ? "visible" : "none"); });
      }
      var styleUp = false;
      bldOn(P.bld);
      if (gl.style && gl.style._loaded) { styleUp = true; bldOn(P.bld); }   /* an inline style can finish loading at once */
      else gl.once("style.load", function () { styleUp = true; if (!dead) bldOn(P.bld); });
      bldB.addEventListener("click", function () {
        P.bld = !P.bld; bldOn(P.bld); savePrefs({ bld: P.bld });
        clearTimeout(hintT);
        if (P.bld && gl.getZoom() < BLD_Z) { say("Buildings appear when you zoom in close."); hintT = setTimeout(function () { say(""); }, 2600); }
      });
      var cmp = box.querySelector(".o3-cmp"), deg = box.querySelector(".o3-deg"), needle = box.querySelector(".o3-needle"), tilt = box.querySelector(".o3-tilt input"), tOut = box.querySelector(".o3-tilt output"), ex = box.querySelector(".o3-ex"), sc = box.querySelector(".o3-scale");
      function paint() {
        var b = gl.getBearing(), p = gl.getPitch();
        needle.setAttribute("transform", "rotate(" + (-b).toFixed(1) + " 20 20)");
        needle.parentNode.style.transform = "rotateX(" + (p * 0.6).toFixed(0) + "deg)";
        tilt.value = Math.round(p); tOut.textContent = Math.round(p) + "°";
        /* the way the view faces, clockwise from true north, as on a hand compass */
        var h = heading(b), txt = ("00" + h).slice(-3) + "° " + POINTS[Math.round(h / 22.5) % 16];
        if (deg.textContent !== txt) { deg.textContent = txt; cmp.setAttribute("aria-label", "Compass: facing " + txt.replace("°", " degrees") + ". Press for north up and flat"); }
      }
      function drawSc() {
        var cc = gl.getCenter(), mpp = 40075016.686 * Math.cos(cc.lat * Math.PI / 180) / (512 * Math.pow(2, gl.getZoom()));
        sc.innerHTML = scaleHtml(mpp, scaleMax()) + (gl.getPitch() > 10 ? '<small>at the centre</small>' : "");
      }
      view3.scale = drawSc;
      function exPaint() { ex.textContent = "×" + P.ex; ex.setAttribute("aria-label", "Relief ×" + P.ex + ". Tap to change"); }
      exPaint();
      ex.addEventListener("click", function () {
        var o = [1, 1.5, 2, 3]; P.ex = o[(o.indexOf(P.ex) + 1) % o.length]; exPaint(); savePrefs({ ex: P.ex });
        gl.setTerrain({ source: "dem", exaggeration: P.ex });
      });
      tilt.addEventListener("input", function () { gl.setPitch(+tilt.value); });
      tilt.addEventListener("change", function () { savePrefs({ pitch: +tilt.value }); });
      box.querySelector(".o3-cmp").addEventListener("click", function () { gl.easeTo({ bearing: 0, pitch: 0, duration: 600 }); });
      box.querySelector(".o3-zi").addEventListener("click", function () { gl.zoomIn(); });
      box.querySelector(".o3-zo").addEventListener("click", function () { gl.zoomOut(); });
      function goSc() { unitNext(); drawSc(); drawScale(); }
      sc.addEventListener("click", goSc);
      sc.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goSc(); } });
      gl.on("rotate", paint); gl.on("pitch", paint); gl.on("move", drawSc);
      gl.on("pitchend", function () { savePrefs({ pitch: Math.round(gl.getPitch()) }); });
      var demErr = 0;
      gl.on("error", function (e) {
        if (e && e.sourceId && e.sourceId === "dem" && ++demErr === 4) say("Elevation tiles are not loading, so the ground may look flat.");
      });
      gl.once("style.load", function () { if (!demErr) say(""); });
      gl.on("load", function () { paint(); drawSc(); });
      /* it opens looking straight down, where the flat map's pictures are already in this browser, so something shows at
         once; then it tilts to your angle and the ground rises while the rest loads */
      var tilted = false;
      function tiltIn() { if (tilted || dead) return; tilted = true; if (P.pitch > 0 && gl.getPitch() < 1) gl.easeTo({ pitch: P.pitch, duration: 1000 }); }
      gl.once("load", function () { setTimeout(tiltIn, 250); }); setTimeout(tiltIn, 1500);
      progress(gl, box.querySelector(".o3-load"), function () { return dead; });
      /* credits sit behind an (i) button, so they never cover the scale bar and tilt slider */
      var cr = box.querySelector(".o3-cr"), crb = box.querySelector(".o3-crb");
      cr.innerHTML = attrs.join(" · ") + " · <a href=\"https://maplibre.org\" target=\"_blank\" rel=\"noopener\">MapLibre</a>";
      crb.addEventListener("click", function () { cr.hidden = !cr.hidden; crb.setAttribute("aria-expanded", String(!cr.hidden)); });
      paint(); drawSc();

      /* symbols drawn as their own element in 2D (military symbols, Red Cross posts and the like): the same picture, standing on the ground.
         They and your marks stay at full strength even where the engine thinks a hill or building is in front: its guess
         (20% when "covered") was often wrong while the elevation was still loading, and a saved point must never fade out. */
      /* only those around the view (an HTML element each is costly to move with the camera) */
      var near = map.getBounds().pad(1.5);
      V.icons.filter(function (m) { return near.contains(m.ll); }).slice(0, 150).sort(function (a, b) { return a.z - b.z; }).forEach(function (m) {
        var w = D.createElement("div"), k = m.el.cloneNode(true);
        w.className = "o3-ic"; k.style.transform = ""; k.style.left = "0"; k.style.top = "0"; k.style.position = "absolute"; k.removeAttribute("tabindex");
        w.appendChild(k);
        w.addEventListener("click", function (e) { e.stopPropagation(); pop(V.layers[m.id], [m.ll.lng, m.ll.lat]); });
        markers.push(new ml.Marker({ element: w, anchor: "center", opacityWhenCovered: "1" }).setLngLat([m.ll.lng, m.ll.lat]).addTo(gl));
      });
      /* your own dropped marks: labelled pins standing on the ground */
      V.marks.forEach(function (m) {
        var el = D.createElement("button"); el.type = "button"; el.className = "o3-mark";
        el.innerHTML = "<i></i><span>" + esc(m.n) + "</span>"; el.title = m.n;
        el.addEventListener("click", function (e) { e.stopPropagation(); pop(V.layers[m.id], [m.ll.lng, m.ll.lat]); });
        markers.push(new ml.Marker({ element: el, anchor: "left", offset: [-7, 0], opacityWhenCovered: "1" }).setLngLat([m.ll.lng, m.ll.lat]).addTo(gl));
      });
      /* tap a point or shape: its 2D popup, and a way back to it in 2D */
      var popup = null;
      function pop(l, at) {
        if (!l) return;
        if (popup) popup.remove();
        var d = D.createElement("div"); d.className = "o3-pop";
        d.innerHTML = '<div class="o3-pc">' + popHtml(l) + '</div><button type="button" class="o3-go">Show in 2D</button>';
        d.querySelector(".o3-go").addEventListener("click", function () {
          close(function () {
            var ll = l.getLatLng ? l.getLatLng() : l.getBounds().getCenter();
            map.setView(ll, Math.max(map.getZoom(), Math.min(10, map.getMaxZoom())), { animate: false });
            if (l.openPopup && l.getPopup && l.getPopup()) l.openPopup(ll); else l.fire("click", { latlng: ll, originalEvent: { target: mapEl } });
          });
        });
        popup = new ml.Popup({ maxWidth: "320px", className: "o3-popw" }).setLngLat(at).setDOMContent(d).addTo(gl);
      }
      /* tap a building: what the open data records about it */
      function bldPop(f, at) {
        if (popup) popup.remove();
        var d = D.createElement("div"); d.className = "o3-pop"; d.innerHTML = '<div class="o3-pc">' + bldInfo(f.properties || {}, f.geometry) + "</div>";
        popup = new ml.Popup({ maxWidth: "320px", className: "o3-popw" }).setLngLat(at).setDOMContent(d).addTo(gl);
        var box2 = d.querySelector(".o3-osm"), lat = at[1], lon = at[0];
        function ask() {
          box2.innerHTML = '<p class="o3-nr">Checking OpenStreetMap at this spot…</p>';
          osmAsk(lat, lon).then(function (j) { box2.innerHTML = osmHtml(j, lat, lon); }, function () {
            box2.innerHTML = '<p class="o3-nr">OpenStreetMap could not be reached. <button type="button" class="o3-again">Try again</button></p>';
            box2.querySelector(".o3-again").addEventListener("click", ask);
          });
        }
        ask();
      }
      gl.on("click", function (e) {
        var f = gl.queryRenderedFeatures([[e.point.x - 8, e.point.y - 8], [e.point.x + 8, e.point.y + 8]], { layers: ["vp", "vl", "vld", "vf"] })
          .filter(function (x) { return x.properties.i; });
        if (!f.length) {
          var b = gl.getLayer("bld") ? gl.queryRenderedFeatures(e.point, { layers: ["bldp", "bld"] }) : [];
          if (b.length) bldPop(b[0], [e.lngLat.lng, e.lngLat.lat]);
          return;
        }
        var hit = f[0], l = V.layers[hit.id];
        pop(l, hit.geometry.type === "Point" ? hit.geometry.coordinates : [e.lngLat.lng, e.lngLat.lat]);
      });
      ["vp", "vl", "vld", "vf", "bld", "bldp"].forEach(function (id) {
        gl.on("mouseenter", id, function () { gl.getCanvas().style.cursor = "pointer"; });
        gl.on("mouseleave", id, function () { gl.getCanvas().style.cursor = ""; });
      });
      W.OSAP_3D.gl = gl; W.OSAP_3D._markers = markers;
    }).catch(function (e) { say((e && e.message) || "3D could not start."); });
  }

  /* ---------- look ---------- */
  var st = D.createElement("style");
  st.textContent =
    ".o3s{background:rgba(255,255,255,.82);border-radius:6px;padding:3px 8px 5px 8px;cursor:pointer;user-select:none;-webkit-user-select:none;color:#212529;box-shadow:0 1px 4px rgba(0,0,0,.25)}" +
    ".o3s:empty{display:none}.o3s:focus-visible{outline:2px solid #4dabf7}" +
    /* the box grows past the bar end by room for half the last number and its unit, so "600 km" stays inside it */
    ".o3s-t{position:relative;height:15px;font:600 11.5px/15px system-ui,-apple-system,sans-serif;margin:0 0 2px 0;padding-right:3.4em}" +
    ".o3s-t span{position:absolute;top:0;transform:translateX(-50%);white-space:nowrap}.o3s-t span:first-child{transform:none}.o3s-t span b{position:absolute;left:100%;font-weight:inherit;padding-left:.3em}" +
    ".o3s-b{display:flex;height:7px;border:1.5px solid #343a40;border-radius:5px;overflow:hidden;box-sizing:content-box}" +
    ".o3s-b i{flex:1}.o3s-b i:nth-child(odd){background:#495057}.o3s-b i:nth-child(2){background:#f1f3f5}" +
    ".o3s small{display:block;font:10px/1.2 system-ui,sans-serif;color:#495057;margin-top:2px}" +
    "html[data-map=dark] .o3s,html[data-map=grey] .o3s{background:rgba(20,24,28,.8);color:#e9ecef}html[data-map=dark] .o3s-b,html[data-map=grey] .o3s-b{border-color:#ced4da}" +
    "html[data-map=dark] .o3s-b i:nth-child(2),html[data-map=grey] .o3s-b i:nth-child(2){background:#212529}html[data-map=dark] .o3s-b i:nth-child(odd),html[data-map=grey] .o3s-b i:nth-child(odd){background:#ced4da}" +
    ".o3dctl a{font:700 13px/30px system-ui,sans-serif!important;color:#212529}html.atak #map .o3dctl{display:none}" +
    "#o3d{position:absolute!important;inset:0;z-index:1200;margin:0!important;float:none;background:#1b1f24;cursor:auto}" +
    "#o3d .o3-map{position:absolute;inset:0}" +
    "#o3d .o3-load{position:absolute;left:0;right:0;top:0;z-index:3;height:22px;pointer-events:none}#o3d .o3-load[hidden]{display:none}" +
    "#o3d .o3-load i{display:block;height:3px;width:0;background:#15aabf;transition:width .25s}" +
    "#o3d .o3-load span{position:absolute;left:8px;top:6px;font:600 11.5px/1 system-ui,sans-serif;color:#fff;background:rgba(20,24,28,.78);padding:3px 7px;border-radius:9px;pointer-events:auto}" +
    "#o3d .o3-load.err i{background:#e8590c}#o3d .o3-load span button{font:inherit;color:#ffd8a8;background:none;border:0;padding:0 2px;text-decoration:underline;cursor:pointer}" +
    "#o3d .o3-msg{position:absolute;left:50%;top:40%;transform:translateX(-50%);max-width:80%;background:rgba(20,24,28,.9);color:#fff;padding:10px 14px;border-radius:8px;font:14px/1.35 system-ui,sans-serif;text-align:center;z-index:3}" +
    "#o3d .o3-msg[hidden]{display:none}" +
    "#o3d .o3-side{position:absolute;top:8px;right:8px;display:flex;flex-direction:column;gap:6px;z-index:2;align-items:center}" +
    "#o3d .o3-b{min-width:44px;min-height:44px;border:0;border-radius:10px;background:rgba(20,24,28,.86);color:#f1f3f5;font:700 14px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.35);padding:0 8px}" +
    "#o3d .o3-b:focus-visible{outline:2px solid #4dabf7;outline-offset:1px}#o3d .o3-2d{background:#0b7285;color:#fff}" +
    "#o3d .o3-cmp{padding:0;background:none;box-shadow:none;border-radius:50%;display:flex;flex-direction:column;align-items:center;gap:2px}" +
    "#o3d .o3-deg{background:rgba(20,24,28,.86);color:#fff;font:700 11px/1 system-ui,sans-serif;font-variant-numeric:tabular-nums;padding:3px 5px;border-radius:5px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.35)}" +
    "#o3d .o3-cmp svg{display:block;transition:transform .15s;filter:drop-shadow(0 2px 4px rgba(0,0,0,.4))}" +
    "#o3d .o3-zi,#o3d .o3-zo{font-size:22px;font-weight:500}#o3d .o3-ex{font-size:12.5px}" +
    "#o3d .o3-bld{display:flex;align-items:center;justify-content:center;color:#adb5bd}#o3d .o3-bld.on{color:#fff;background:#1c7ed6}" +
    "#o3d .o3-tilt{position:absolute;right:8px;bottom:34px;z-index:2;display:flex;align-items:center;gap:6px;background:rgba(20,24,28,.86);color:#f1f3f5;border-radius:10px;padding:6px 10px;font:600 12.5px/1 system-ui,sans-serif}" +
    "#o3d .o3-tilt label{display:flex;align-items:center;gap:8px}#o3d .o3-tilt input{width:130px;accent-color:#15aabf;margin:0;height:28px}#o3d .o3-tilt output{min-width:30px;text-align:right;font-variant-numeric:tabular-nums}" +
    "#o3d .o3-scale{position:absolute;left:8px;bottom:34px;z-index:2}" +
    "#o3d .o3-crb{position:absolute;right:8px;bottom:6px;z-index:2;width:22px;height:22px;border-radius:50%;border:0;background:rgba(255,255,255,.85);color:#212529;font:italic 700 13px/22px Georgia,serif;cursor:pointer;padding:0}" +
    "#o3d .o3-cr{position:absolute;left:8px;right:36px;bottom:4px;z-index:3;background:rgba(255,255,255,.95);color:#343a40;border-radius:6px;padding:5px 8px;font:11px/1.35 system-ui,sans-serif}#o3d .o3-cr[hidden]{display:none}" +
    "#o3d .o3-ic{width:0;height:0;cursor:pointer}#o3d .o3-ic>*{pointer-events:auto}" +
    "#o3d .o3-mark{display:flex;align-items:center;gap:4px;border:0;background:none;padding:0;cursor:pointer}" +
    "#o3d .o3-mark i{width:14px;height:14px;border-radius:50%;background:#e8590c;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5);box-sizing:border-box}" +
    "#o3d .o3-mark span{background:rgba(20,24,28,.85);color:#fff;font:600 11.5px/1 system-ui,sans-serif;padding:3px 5px;border-radius:4px;white-space:nowrap}#o3d .o3-mark span:empty{display:none}" +
    "#o3d .o3-popw .maplibregl-popup-content{padding:10px 12px;border-radius:10px;color:#212529;font:13px/1.35 system-ui,sans-serif;max-height:45vh;overflow:auto}" +
    /* the app's own table look (right-aligned, one line, capitals) is undone here: it pushed every value out of sight */
    "#o3d .o3-bt{border-collapse:collapse;margin:4px 0;width:100%;table-layout:fixed;font-size:13px}#o3d .o3-bt tr{cursor:auto}" +
    "#o3d .o3-bt th{width:34%;text-align:left;font:600 12px/1.35 system-ui,sans-serif;text-transform:none;letter-spacing:0;color:#495057;padding:3px 8px 3px 0;vertical-align:top;white-space:normal;border-bottom:1px solid #e9ecef}" +
    "#o3d .o3-bt td{text-align:left;white-space:normal;padding:3px 0;color:#212529;overflow-wrap:anywhere;vertical-align:top;border-bottom:1px solid #e9ecef}" +
    "#o3d .o3-none{color:#495057}#o3d .o3-pop h4{font-size:13px;margin:8px 0 2px}#o3d .o3-ol{margin:2px 0 4px;padding-left:18px}#o3d .o3-ol li{margin:2px 0;overflow-wrap:anywhere}" +
    "#o3d .o3-again{font:inherit;color:#0b7285;background:none;border:0;padding:0;text-decoration:underline;cursor:pointer}" +
    "#o3d .o3-nr{color:#868e96}#o3d .o3-bn{font-size:11.5px;color:#868e96;overflow-wrap:anywhere}" +
    "#o3d .o3-pop h3{font-size:14px;margin:4px 0}#o3d .o3-pop p{margin:6px 0}#o3d .o3-pop .o3-pc .atk-pb{display:none}" +
    "#o3d .o3-go{margin-top:6px;min-height:34px;padding:0 12px;border:0;border-radius:8px;background:#0b7285;color:#fff;font:600 13px/1 system-ui,sans-serif;cursor:pointer}" +
    "@media (max-width:700px){#o3d .o3-tilt{padding:6px 8px;gap:4px}#o3d .o3-tilt label{gap:6px}#o3d .o3-tilt input{width:84px}}";
  D.head.appendChild(st);

  W.OSAP_3D = { open: open3d, close: function () { if (view3) view3.close(); }, isOpen: function () { return !!view3; }, gl: null,
    _scaleFit: scaleFit, _bldInfo: bldInfo, _heading: heading, _rasters: rasters, _demTile: demTile, _vectors: vectors };
  /* the toolbar may be built after this file runs (or rebuilt): add the 3D button when it appears */
  if (!D.querySelector("[data-o3d]")) {
    var tries = 0, t = setInterval(function () { if (addToolbarBtn() || ++tries > 20) clearInterval(t); }, 500);
  }
})();
