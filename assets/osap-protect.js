/* AXIOM OSAP: protected mode (Shane 2026-10-20, for users who must stay digitally secure: "Do all of it").
   Off by default; Settings > Protected mode turns it on for this device (localStorage "osap-protect" = "1") and reloads.
   On, the page itself contacts no outside service:
   - a Content-Security-Policy, written before anything else loads, lets the page fetch, load images, media, fonts and
     workers only from OSAP's own site (plus data: and blob:), so a request to anyone else is refused by the browser;
   - the map tiles, weather, place search, routing and hazard feeds the app needs go through OSAP's relay instead
     (/px?u=<address>, netlify/edge-functions/osap-px.js), which fetches them without the user's address, cookies or
     referrer: the service sees OSAP's server. Only the hosts in RELAY (the same list as tools/px.mjs) are relayed;
   - everything else that would go out by itself stops: traffic cameras, device sync relays, push to phone, the on-device AI
     model download. Opening a source link still goes to that site, because the user chose to open it.
   Off the Netlify site (GitHub Pages copy, a file, tests without the relay) the relay is not there, so the map stays blank:
   that is the protected behaviour, not a fault.
   Loaded first in <head> (index.html) so the policy is in place before any request.
   window.OSAP_PROTECT {on, set(bool), wrap(url), relayed(url), hosts} */
(function () {
  "use strict";
  var W = window, D = document, KEY = "osap-protect";
  var RELAY = [
    "tile.openstreetmap.org", "tiles.openfreemap.org", "server.arcgisonline.com", "services.arcgisonline.com",
    "clarity.maptiles.arcgis.com", "ibasemaps-api.arcgis.com", "basemaps-api.arcgis.com", "ic.imagery1.arcgis.com", ".tile.opentopomap.org", "tiles.maps.eox.at",
    "gibs.earthdata.nasa.gov", "cyberjapandata.gsi.go.jp", "s3.amazonaws.com", "storage.googleapis.com",
    "tiles.mapterhorn.com", "download.mapterhorn.com", "api.rainviewer.com", "tilecache.rainviewer.com", "nowcoast.noaa.gov",
    "api.open-meteo.com", "marine-api.open-meteo.com", "air-quality-api.open-meteo.com", "geocoding-api.open-meteo.com",
    "photon.komoot.io", "routing.openstreetmap.de", "valhalla1.openstreetmap.de", "router.project-osrm.org",
    "postpass.geofabrik.de", "overpass-api.de", "maps.mail.ru", "overpass.kumi.systems", "overpass.private.coffee", "query.wikidata.org", "www.wikidata.org",
    "earthquake.usgs.gov", "www.gdacs.org", "eonet.gsfc.nasa.gov", "firms.modaps.eosdis.nasa.gov", "api-v3.thaiwater.net",
    "telemetry.dwr.go.th", "gistdaportal.gistda.or.th", "earth-search.aws.element84.com", "date.nager.at"
  ];
  var PATHS = { "s3.amazonaws.com": "/elevation-tiles-prod/", "storage.googleapis.com": "/global-surface-water/", "maps.mail.ru": "/osm/tools/overpass/" };
  var on = false;
  try { on = localStorage.getItem(KEY) === "1"; } catch (e) { /* storage blocked: off */ }

  function relayed(u) {
    var url; try { url = new URL(String(u), location.href); } catch (e) { return false; }
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
    var h = url.hostname.toLowerCase();
    var ok = RELAY.some(function (x) { return x.charAt(0) === "." ? h.length > x.length && h.slice(-x.length) === x : h === x; });
    return ok && (!PATHS[h] || url.pathname.indexOf(PATHS[h]) === 0);
  }
  /* an outside address on the relay list becomes OSAP's relay address; anything else is left for the policy to refuse */
  function wrap(u) {
    if (!on || u == null) return u;
    var s = String(u);
    if (!/^https?:\/\//i.test(s) || s.indexOf(location.origin + "/") === 0) return u;
    return relayed(s) ? location.origin + "/px?u=" + encodeURIComponent(s) : u;
  }
  function set(v) {
    try { if (v) localStorage.setItem(KEY, "1"); else localStorage.removeItem(KEY); } catch (e) { /* not kept */ }
    location.reload();
  }
  W.OSAP_PROTECT = { on: function () { return on; }, set: set, wrap: wrap, relayed: relayed, hosts: RELAY.slice(), paths: PATHS };
  if (!on) return;

  D.documentElement.classList.add("osap-protected");
  /* the policy: only OSAP's own site, before any other element of the page asks for anything */
  D.write('<meta http-equiv="Content-Security-Policy" content="connect-src \'self\' data: blob:; img-src \'self\' data: blob:; ' +
    'media-src \'self\' data: blob:; style-src \'self\' \'unsafe-inline\'; font-src \'self\' data:; frame-src \'self\'; worker-src \'self\' blob:; child-src \'self\' blob:">');

  /* the page's own requests to the relayed services */
  var f0 = W.fetch;
  if (f0) W.fetch = function (input, init) {
    if (typeof input === "string" || input instanceof URL) return f0.call(this, wrap(String(input)), init);
    if (input && input.url && wrap(input.url) !== input.url) return f0.call(this, new Request(wrap(input.url), input), init);
    return f0.call(this, input, init);
  };
  var xo = W.XMLHttpRequest && W.XMLHttpRequest.prototype.open;
  if (xo) W.XMLHttpRequest.prototype.open = function (m, u) { var a = Array.prototype.slice.call(arguments); a[1] = wrap(u); return xo.apply(this, a); };
  /* the MapLibre engine (English street map, 3D view, navigation, preview): its tile, style and glyph requests are made
     from its own workers, so each map it makes is given a transformRequest that turns them into relay addresses */
  var ml = W.maplibregl;
  function guard(lib) {
    if (!lib || !lib.Map || lib.Map.__osapProtect) return lib;
    var M = lib.Map;
    var P = function (o) {
      o = Object.assign({}, o); var t = o.transformRequest;
      o.transformRequest = function (url, kind) { var r = t ? t(url, kind) : null; return Object.assign({}, r || {}, { url: wrap((r && r.url) || url) }); };
      return Reflect.construct(M, [o], new.target || P);
    };
    P.prototype = M.prototype; Object.setPrototypeOf(P, M); P.__osapProtect = true;
    lib.Map = P;
    return lib;
  }
  try {
    Object.defineProperty(W, "maplibregl", { configurable: true, enumerable: true, get: function () { return ml; }, set: function (v) { ml = guard(v); } });
    if (ml) guard(ml);
  } catch (e) { /* defined already in a way that cannot be watched: the policy still refuses its requests */ }
  /* map tiles and other pictures (Leaflet sets img.src) */
  var d = Object.getOwnPropertyDescriptor(W.HTMLImageElement.prototype, "src");
  if (d && d.set) Object.defineProperty(W.HTMLImageElement.prototype, "src", { configurable: true, enumerable: d.enumerable, get: d.get, set: function (v) { d.set.call(this, wrap(v)); } });
  var sa = W.Element.prototype.setAttribute;
  W.Element.prototype.setAttribute = function (n, v) {
    if (this instanceof W.HTMLImageElement && String(n).toLowerCase() === "src") v = wrap(v);
    return sa.call(this, n, v);
  };
})();
