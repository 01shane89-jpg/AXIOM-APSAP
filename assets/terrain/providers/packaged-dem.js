/* AXIOM OSAP terrain source: elevation tiles saved on this device by Offline maps and data (assets/osap-offline.js, "Terrain
   for viewshed and line of sight"). They are Terrain Tiles on AWS, kept in the browser cache "osap-terrain" under their own
   address, and listed in localStorage "osap-terrain-offline".
   - "saved-dem" (tried first): the tile asked for, when it was saved. No download is needed for it.
   - "saved-dem-coarse" (tried last, after the network sources): when the tile asked for is not saved and could not be
     downloaded (no signal), a saved tile up to four zoom levels coarser is cut out and enlarged. The result lists this source,
     so it says that the terrain was coarser than asked.
   Needs remote-dem.js loaded first (it shares the PNG decoding). */
(function () {
  "use strict";
  var W = window, CACHE = "osap-terrain", KEY = "osap-terrain-offline", UP = 4;
  function saved() { try { var r = JSON.parse(localStorage.getItem(KEY)); return !!(r && r.packs && Object.keys(r.packs).length); } catch (e) { return false; } }
  function url(z, x, y) { var C = W.OSAP_DEM_CODEC; return C.AWS.replace("{z}", z).replace("{x}", x).replace("{y}", y); }
  var cache = null;
  function open() { if (!cache) cache = W.caches ? W.caches.open(CACHE).catch(function () { return null; }) : Promise.resolve(null); return cache; }
  function read(c, z, x, y) {
    return c.match(url(z, x, y)).then(function (hit) { return hit ? hit.blob().then(W.OSAP_DEM_CODEC.decode).then(W.OSAP_DEM_CODEC.terrarium) : null; });
  }
  /* the zoom-z tile cut out of a saved ancestor k levels up, each pixel enlarged 2^k times */
  function cut(P, k, x, y) {
    var h = new Float32Array(65536), s = 1 << k, ox = (x % s) * (256 / s), oy = (y % s) * (256 / s);
    for (var j = 0; j < 256; j++) for (var i = 0; i < 256; i++) h[j * 256 + i] = P[(oy + (j >> k)) * 256 + ox + (i >> k)];
    return h;
  }
  var L = W.OSAP_TERRAIN_PROVIDERS = W.OSAP_TERRAIN_PROVIDERS || [];
  L.push({
    id: "saved-dem", label: "Terrain saved on this device (Terrain Tiles on AWS)", kind: "DEM", order: 5,
    attribution: '<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Terrain Tiles on AWS</a>, saved on this device',
    maxZoom: function () { return 0; },
    covers: function () { return saved() && !!W.OSAP_DEM_CODEC; },
    tile: function (z, x, y) { return open().then(function (c) { return c ? read(c, z, x, y) : null; }); }
  });
  L.push({
    id: "saved-dem-coarse", label: "Terrain saved on this device, coarser than asked (enlarged)", kind: "DEM", order: 30,
    attribution: '<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Terrain Tiles on AWS</a>, saved on this device',
    maxZoom: function () { return 0; },
    covers: function () { return saved() && !!W.OSAP_DEM_CODEC; },
    tile: function (z, x, y) {
      return open().then(function (c) {
        if (!c) return null;
        var k = 1;
        function next() {
          if (k > UP || z - k < 0) return null;
          var kk = k++;
          return read(c, z - kk, x >> kk, y >> kk).then(function (P) { return P ? cut(P, kk, x, y) : next(); });
        }
        return next();
      });
    }
  });
})();
