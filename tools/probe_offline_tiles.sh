#!/bin/sh
# Test only: checks the offline map's tile hosts answer with CORS (needed to save tiles on the device without the browser's
# large padding for opaque responses) and prints tile sizes. Writes nothing to the repo.
o="Origin: https://01shane89-jpg.github.io"
for u in \
 "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/g/6/50/26.jpg" \
 "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/g/10/478/815.jpg" \
 "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/g/13/3827/6523.jpg" \
 "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Reference_Features_15m/default/default/GoogleMapsCompatible_Level13/10/478/815.png" \
 "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Reference_Labels_15m/default/default/GoogleMapsCompatible_Level13/10/478/815.png" \
 "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Reference_Labels_15m/default/default/GoogleMapsCompatible_Level13/13/3827/6523.png" \
 "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Reference_Features_15m/default/default/GoogleMapsCompatible_Level13/13/3827/6523.png" \
 "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/OSM_Land_Water_Map/default/default/GoogleMapsCompatible_Level13/10/478/815.png" \
 ; do
  echo "== $u"
  curl -s -D - -o /tmp/t -H "$o" "$u" | grep -i -E "^HTTP|access-control|^vary|content-type|cache-control" ; echo "bytes $(wc -c < /tmp/t)"
done
