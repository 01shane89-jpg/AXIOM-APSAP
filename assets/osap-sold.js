/* AXIOM OSAP: the sold version's switch for the app (cost review 2026-10-24; the data side is tools/nc_strip.mjs).
   false here and on GitHub Pages. The Netlify build (tools/netlify_build.mjs) writes true into its copy when the site's
   environment variable OSAP_COMMERCIAL is true; the app then leaves out the free services whose terms do not cover a paid
   product: OpenStreetMap's own tile server (tile.openstreetmap.org: the vector OpenFreeMap maps stay, raster backdrops in
   reports and share images fall back to outlines), Esri's land cover in the landing-zone finder, EOX's hosted Sentinel-2
   tiles (commercial viewing is a paid EOX subscription), OpenTopoMap's volunteer tile server and the free OSRM / FOSSGIS
   road routers (sell blockers, 2026-10-25).
   window.OSAP_SOLD: true or false */
window.OSAP_SOLD = false;
/* the sold version's own hosts for those services, which the Netlify build writes here from the site's environment
   (empty until they exist): sat = a satellite tile address with {z} {x} {y} (OSAP_SAT_TILES: a licensed EOX link or a
   self-hosted copy of Sentinel-2 cloudless 2016, which is CC BY 4.0); osrm = an OSRM server laid out like FOSSGIS's
   (routed-car/, routed-foot/, routed-bike/; OSAP_OSRM_URL); valhalla = a Valhalla server (OSAP_VALHALLA_URL); esriKey = an
   ArcGIS Location Platform API key (OSAP_ESRI_KEY), which licenses Esri's imagery, labels and hillshade for a paid product. */
window.OSAP_SOLD_HOSTS = {};
/* window.OSAP_HOST(k): the address the app uses for service k. The free version uses the free hosts below; the sold
   version uses only its own host, or "" when it has none, and the feature that needs it is left out. */
(function () {
  var FREE = {
    sat: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg",
    topo: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    osrm: "https://routing.openstreetmap.de/",
    osrmDemo: "https://router.project-osrm.org/",
    valhalla: "https://valhalla1.openstreetmap.de/"
  };
  window.OSAP_HOST = function (k) {
    if (!window.OSAP_SOLD) return FREE[k] || "";
    var v = (window.OSAP_SOLD_HOSTS || {})[k];
    return typeof v === "string" && /^https:\/\/[^\s"'<>]+$/.test(v) ? v : "";
  };
})();
/* window.OSAP_ESRI(svc): the tile address of Esri basemap service svc (World_Imagery, Elevation/World_Hillshade,
   Reference/World_Transportation, Reference/World_Boundaries_and_Places), {z}/{y}/{x}. The free version uses Esri's public
   servers; the sold version uses the ArcGIS Location Platform with its own key (pay as you go, 2 million tiles a month
   free, then about US$0.15 per 1,000 as of Sept 2026), or "" when it has no key, and the Esri maps are left out. */
window.OSAP_ESRI = function (svc) {
  var tile = "/MapServer/tile/{z}/{y}/{x}";
  if (!window.OSAP_SOLD) return "https://server.arcgisonline.com/ArcGIS/rest/services/" + svc + tile;
  var k = (window.OSAP_SOLD_HOSTS || {}).esriKey;
  if (typeof k !== "string" || !/^[A-Za-z0-9._-]{20,600}$/.test(k)) return "";
  /* imagery and hillshade come from the imagery basemap host, reference labels from the basemap host */
  var host = /^Reference\//.test(svc) ? "https://basemaps-api.arcgis.com" : "https://ibasemaps-api.arcgis.com";
  return host + "/arcgis/rest/services/" + svc + tile + "?token=" + encodeURIComponent(k);
};
/* window.OSAP_ESRI_STYLE(path): the address of an Esri vector basemap style from the ArcGIS Basemap Styles service (v2),
   path such as "arcgis/navigation" or "open/streets", labelled in English; window.OSAP_ESRI_STATIC(path): the same map as
   plain tiles (the Static Basemap Tiles service) for the 3D view and for a phone that cannot draw the vector map. Both use the
   site's ArcGIS Location Platform key (OSAP_ESRI_KEY), which the Netlify build writes for the free and the sold version alike;
   with no key (GitHub Pages, a local copy) both are "" and those maps are left out. The styles the key can use were read from
   Esri's styles/self service with the key on 2026-10-29 (Shane: "Add all the esri maps that are available in my API account"). */
(function () {
  function key() { var k = (window.OSAP_SOLD_HOSTS || {}).esriKey; return typeof k === "string" && /^[A-Za-z0-9._-]{20,600}$/.test(k) ? k : ""; }
  function okPath(p) { return /^(arcgis|open)\/[a-z-]+(\/[a-z-]+)?$/.test(String(p)); }
  window.OSAP_ESRI_STYLE = function (path) {
    var k = key(); if (!k || !okPath(path)) return "";
    return "https://basemapstyles-api.arcgis.com/arcgis/rest/services/styles/v2/styles/" + path + "?language=en&token=" + encodeURIComponent(k);
  };
  window.OSAP_ESRI_STATIC = function (path) {
    var k = key(); if (!k || !okPath(path)) return "";
    return "https://static-map-tiles-api.arcgis.com/arcgis/rest/services/static-basemap-tiles-service/v1/" + path + "/static/tile/{z}/{y}/{x}?language=en&token=" + encodeURIComponent(k);
  };
})();
