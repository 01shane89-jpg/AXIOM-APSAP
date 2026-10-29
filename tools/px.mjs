// Protected mode's relay (netlify/edge-functions/osap-px.js, assets/osap-protect.js): the outside services OSAP's server may
// fetch for a page in protected mode, so that the service sees OSAP's server instead of the user. Only map tiles, weather,
// place search, routing and the public hazard feeds the app reads itself; never cameras, push, sync relays, the AI model
// download or any address a feed or a user could supply. assets/osap-protect.js keeps the same list (tests/protect_smoke.mjs
// checks they match). A host ending in a dot-less name matches only itself; a leading "." matches that domain's sub-hosts.
// PATHS narrows a shared host (a cloud bucket) to the one bucket the app reads.
export const PX_HOSTS = [
  // base maps and overlays
  "tile.openstreetmap.org", "tiles.openfreemap.org", "server.arcgisonline.com", "services.arcgisonline.com",
  "clarity.maptiles.arcgis.com", "ibasemaps-api.arcgis.com", "basemaps-api.arcgis.com", "ic.imagery1.arcgis.com", ".tile.opentopomap.org", "tiles.maps.eox.at",
  "gibs.earthdata.nasa.gov", "cyberjapandata.gsi.go.jp", "s3.amazonaws.com", "storage.googleapis.com",
  "tiles.mapterhorn.com", "download.mapterhorn.com", "api.rainviewer.com", "tilecache.rainviewer.com", "nowcoast.noaa.gov",
  // weather, search, routing, places
  "api.open-meteo.com", "marine-api.open-meteo.com", "air-quality-api.open-meteo.com", "geocoding-api.open-meteo.com",
  "photon.komoot.io", "routing.openstreetmap.de", "valhalla1.openstreetmap.de", "router.project-osrm.org",
  "postpass.geofabrik.de", "overpass-api.de", "maps.mail.ru", "overpass.kumi.systems", "overpass.private.coffee", "query.wikidata.org", "www.wikidata.org",
  // hazard and situation feeds the page reads live
  "earthquake.usgs.gov", "www.gdacs.org", "eonet.gsfc.nasa.gov", "firms.modaps.eosdis.nasa.gov", "api-v3.thaiwater.net",
  "telemetry.dwr.go.th", "gistdaportal.gistda.or.th", "earth-search.aws.element84.com", "date.nager.at",
];
export const PX_PATHS = { "s3.amazonaws.com": "/elevation-tiles-prod/", "storage.googleapis.com": "/global-surface-water/", "maps.mail.ru": "/osm/tools/overpass/" };

export function pxAllowed(u) {
  let url;
  try { url = new URL(u); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
  const h = url.hostname.toLowerCase();
  const ok = PX_HOSTS.some((x) => (x[0] === "." ? h.endsWith(x) && h.length > x.length : h === x));
  if (!ok) return false;
  const p = PX_PATHS[h];
  return !p || url.pathname.startsWith(p);
}
