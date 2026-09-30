# World country list and outlines

Builds `data/basemap/world-countries.js` (`window.ASAP_WORLD`) and `data/basemap/world-outlines.js` (`window.WORLD_BASE`),
which the page embeds before `tools/split_page.py` splits it.

Inputs (npm packages, unpacked next to the scripts; not committed):
- `world-atlas@2.0.2` countries-50m.json: Natural Earth 1:50m, public domain (outlines and bounds)
- `i18n-iso-countries@7.14.0` codes.json: ISO alpha-2, alpha-3 and numeric codes
- `countries-list@3.4.1` (MIT): continent of each country
- `topojson-client@3.1.0`

Coverage: the 193 UN members plus Taiwan, Kosovo, Palestine and Western Sahara. The 28 researched areas already in the page keep their own entries.

1. `node world-list.cjs` writes world-list.json (codes, names, continent, bounds). Bounds use the main polygons only;
   countries across the antimeridian shift western longitudes east. Tuvalu has no 1:50m outline, so its bounds are set by hand.
2. `node world-outlines.cjs` writes world-50m.json: every outline not already in country-outlines.js (their names go in
   old-base-names.json first), rounded to 0.01°.
3. Hand fixes applied when embedding: bounds clamped to ±180° (Leaflet), France fitted to the metropolitan area,
   Kiribati to the Gilbert Islands, Russia and Cyprus grouped under Europe, Afghanistan and Iran under South Asia,
   the rest of Asia under "Western and Central Asia".
4. `node tools/world/full-us-ru.cjs` (run from the repo root, `TOL=0.02 SMALL=0 MIN=0.001`) replaces the Pacific-edge
   slivers of the United States and Russia in country-outlines.js with their whole 1:50m outlines (Douglas-Peucker to 0.02°,
   Chukotka cut at the 180th meridian) and adds Tuvalu (1:10m) to world-outlines.js, so point feeds place them.
