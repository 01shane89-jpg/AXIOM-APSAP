#!/bin/sh
# Test only: checks the offline map's tile hosts answer with CORS (needed to save tiles on the device without the browser's
# large padding for opaque responses) and measures average tile sizes around Bangkok. Writes nothing to the repo.
o="Origin: https://01shane89-jpg.github.io"
S2="https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/g"
FE="https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Reference_Features_15m/default/default/GoogleMapsCompatible_Level13"
LB="https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Reference_Labels_15m/default/default/GoogleMapsCompatible_Level13"
for b in "$S2|jpg" "$FE|png" "$LB|png"; do
  u=${b%|*}; ext=${b#*|}
  curl -s -D - -o /dev/null -H "$o" "$u/10/472/797.$ext" | grep -i -E "^HTTP|access-control-allow-origin|^vary"
  for zxy in "8 118 199" "10 472 797" "12 1890 3191" "13 3780 6382"; do
    set -- $zxy; tot=0; n=0
    for dy in 0 1 2 3; do for dx in 0 1 2 3; do
      s=$(curl -s -o /dev/null -w "%{size_download}" "$u/$1/$(($2+dy))/$(($3+dx)).$ext"); tot=$((tot+s)); n=$((n+1))
    done; done
    echo "$u z$1: avg $((tot/n)) bytes over $n tiles"
  done
done
