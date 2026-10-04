/* AXIOM OSAP terrain source: public elevation tiles over the network, no key and no account. The same tiles the 3D view,
   the landing zone finder and ground mobility already use.
   - "gsi-japan": inside Japan and Okinawa, GSI Japan's elevation tiles: the 5 m model from its airborne laser survey at zoom
     15 where it exists, otherwise the 10 m national model (zoom 14 and below; at 15 the zoom 14 tile is enlarged).
   - "aws-terrarium": everywhere, Terrain Tiles on AWS (Mapzen/Tilezen terrarium PNG: SRTM about 30 m on land, 3DEP in the
     US, GMTED and ETOPO1 where nothing finer exists). Fills any pixel GSI has no value for.
   - "mapterhorn" (tried first): Mapterhorn elevation tiles through window.OSAP_LIDAR.dem (assets/osap-lidar.js): national
     LiDAR and fine elevation models (0.25 to 20 m) wherever they are published, Copernicus GLO-30 (about 30 m) elsewhere.
     Its finest zoom at a place follows the coverage lookup (OSAP_LIDAR.cachedBest); a missing zoom is enlarged from the next
     coarser tile, so it never leaves a hole. If it cannot be reached the next sources answer as before.
   All register in window.OSAP_TERRAIN_PROVIDERS (see terrain-provider.js). A pixel with no value is NaN, never 0. */
(function () {
  "use strict";
  var W = window, D = document;
  var AWS = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
  var GSI5 = "https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/{z}/{x}/{y}.png", GSI10 = "https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png";
  var JP = [20, 122, 46, 154], TIMEOUT = 20000;
  function sub(u, z, x, y) { return u.replace("{z}", z).replace("{x}", x).replace("{y}", y); }
  function tileLon(x, z) { return x / Math.pow(2, z) * 360 - 180; }
  function tileLat(y, z) { return Math.atan(Math.sinh(Math.PI * (1 - 2 * y / Math.pow(2, z)))) * 180 / Math.PI; }
  function inJapan(z, x, y) { return z >= 6 && tileLon(x + 1, z) > JP[1] && tileLon(x, z) < JP[3] && tileLat(y, z) > JP[0] && tileLat(y + 1, z) < JP[2]; }
  /* a tile's RGBA pixels, or null when the host has no tile there (404); an error for anything else */
  function pixels(url, signal) {
    var ac = W.AbortController ? new AbortController() : null, t = setTimeout(function () { if (ac) ac.abort(); }, TIMEOUT);
    if (signal && ac) { if (signal.aborted) ac.abort(); else signal.addEventListener("abort", function () { ac.abort(); }); }
    return fetch(url, { mode: "cors", signal: ac ? ac.signal : undefined }).then(function (r) {
      if (r.status === 404 || r.status === 403) return null;   /* S3 answers 403 for a tile that does not exist */
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.blob().then(decode);
    }).then(function (d) { clearTimeout(t); return d; }, function (e) { clearTimeout(t); throw e; });
  }
  function decode(blob) {
    function draw(img) {
      var c = D.createElement("canvas"); c.width = c.height = 256;
      var g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0, 256, 256);
      return g.getImageData(0, 0, 256, 256).data;
    }
    if (W.createImageBitmap) return createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" }).then(draw);
    return new Promise(function (res, rej) {
      var u = URL.createObjectURL(blob), im = new Image();
      im.onload = function () { URL.revokeObjectURL(u); res(draw(im)); }; im.onerror = function () { URL.revokeObjectURL(u); rej(new Error("decode")); }; im.src = u;
    });
  }
  /* terrarium: (R x 256 + G + B / 256) - 32768 metres. At sea the tiles hold the sea bed (ETOPO1), but a ship or a coast
     is seen across the water's surface, so anything deeper than SEA_FLOOR is read as sea level. Land that low (the Dead Sea,
     the Jordan valley, Turpan, Qattara, Danakil) is read as sea level too; that is said in the result's assumptions. */
  var SEA_FLOOR = -40;
  function terrarium(d) {
    if (!d) return null;
    var h = new Float32Array(65536);
    for (var i = 0, k = 0; k < 65536; i += 4, k++) { var v = d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768; h[k] = d[i + 3] === 0 ? NaN : v < SEA_FLOOR ? 0 : v; }
    return h;
  }
  /* GSI PNG: 0.01 m steps in 24 bits, two's complement; 2^23 (and transparent) = no value */
  function gsi(d) {
    if (!d) return null;
    var h = new Float32Array(65536);
    for (var i = 0, k = 0; k < 65536; i += 4, k++) {
      var v = d[i] * 65536 + d[i + 1] * 256 + d[i + 2];
      h[k] = d[i + 3] === 0 || v === 8388608 ? NaN : (v < 8388608 ? v : v - 16777216) * 0.01;
    }
    return h;
  }
  /* the zoom-z tile cut out of its parent at zoom z-1, each pixel doubled */
  function child(P, x, y) {
    if (!P) return null;
    var h = new Float32Array(65536), ox = (x & 1) * 128, oy = (y & 1) * 128;
    for (var j = 0; j < 256; j++) for (var i = 0; i < 256; i++) h[j * 256 + i] = P[(oy + (j >> 1)) * 256 + ox + (i >> 1)];
    return h;
  }
  /* shared with the saved-terrain source (providers/packaged-dem.js) */
  W.OSAP_DEM_CODEC = { decode: decode, terrarium: terrarium, child: child, AWS: AWS };
  var L = W.OSAP_TERRAIN_PROVIDERS = W.OSAP_TERRAIN_PROVIDERS || [];
  /* the 256 px zoom that holds the finest model at a place (0.25 to 0.6 m: 18, 1 m: 17, 2.5 m: 16, 5 m: 15, 10 m: 14) */
  function zoomForRes(r) { return r == null ? 14 : r <= 0.6 ? 18 : r <= 1.2 ? 17 : r <= 2.5 ? 16 : r <= 5 ? 15 : 14; }
  L.push({
    id: "mapterhorn", label: "Mapterhorn elevation (national LiDAR where published, Copernicus 30 m elsewhere)", kind: "DEM", order: 3,
    attribution: '<a href="https://mapterhorn.com/attribution/" target="_blank" rel="noopener">Mapterhorn</a> (national LiDAR and elevation models; Copernicus GLO-30)',
    maxZoom: function (lat, lon) { var X = W.OSAP_LIDAR; return X ? zoomForRes(X.cachedBest(lat, lon)) : 0; },
    covers: function () { return !!(W.OSAP_LIDAR && W.OSAP_LIDAR.dem) && navigator.onLine !== false; },
    /* sea read as sea level, as for the AWS tiles (SEA_FLOOR) */
    tile: function (z, x, y, signal) { return W.OSAP_LIDAR.dem(z, x, y, signal).then(function (r) { if (!r) return null; var h = r.h; for (var i = 0; i < h.length; i++) if (h[i] < SEA_FLOOR) h[i] = 0; return h; }); }
  });
  L.push({
    id: "gsi-japan", label: "GSI Japan elevation (5 m laser survey, 10 m)", kind: "DEM", order: 10,
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">GSI Japan</a> elevation tiles',
    maxZoom: function (lat, lon) { return lat > JP[0] && lat < JP[2] && lon > JP[1] && lon < JP[3] ? 15 : 0; },
    covers: inJapan,
    tile: function (z, x, y, signal) {
      if (z < 15) return pixels(sub(GSI10, z, x, y), signal).then(gsi);
      return pixels(sub(GSI5, z, x, y), signal).then(gsi).then(function (h) {
        return pixels(sub(GSI10, 14, x >> 1, y >> 1), signal).then(gsi).then(function (P) {
          var c = child(P, x, y); if (!h) return c; if (c) for (var i = 0; i < 65536; i++) if (!(h[i] === h[i])) h[i] = c[i];
          return h;
        }, function () { return h; });
      });
    }
  });
  L.push({
    id: "aws-terrarium", label: "Terrain Tiles on AWS (SRTM about 30 m; finer in the US)", kind: "DEM", order: 20,
    attribution: '<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Terrain Tiles on AWS</a> (Mapzen/Tilezen; SRTM, 3DEP, GMTED, ETOPO1)',
    maxZoom: function () { return 14; },
    covers: function () { return true; },
    tile: function (z, x, y, signal) {
      if (z <= 15) return pixels(sub(AWS, z, x, y), signal).then(terrarium);
      return Promise.resolve(null);
    }
  });
})();
