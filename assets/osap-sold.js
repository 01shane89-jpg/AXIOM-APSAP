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
   (routed-car/, routed-foot/, routed-bike/; OSAP_OSRM_URL); valhalla = a Valhalla server (OSAP_VALHALLA_URL). */
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
