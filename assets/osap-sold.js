/* AXIOM OSAP: the sold version's switch for the app (cost review 2026-10-24; the data side is tools/nc_strip.mjs).
   false here and on GitHub Pages. The Netlify build (tools/netlify_build.mjs) writes true into its copy when the site's
   environment variable OSAP_COMMERCIAL is true; the app then leaves out the free services whose terms do not cover a paid
   product: OpenStreetMap's own tile server (tile.openstreetmap.org: the vector OpenFreeMap maps stay, raster backdrops in
   reports and share images fall back to outlines) and Esri's land cover in the landing-zone finder.
   window.OSAP_SOLD: true or false */
window.OSAP_SOLD = false;
