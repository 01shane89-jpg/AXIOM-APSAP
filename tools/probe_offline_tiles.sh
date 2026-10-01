#!/bin/sh
# Test only: checks the offline map's tile hosts answer with CORS (needed to save tiles on the device without the browser's
# large padding for opaque responses) and measures tile sizes. Writes nothing to the repo.
G="https://gibs.earthdata.nasa.gov/wmts/epsg3857/best"
curl -s "$G/wmts.cgi?SERVICE=WMTS&REQUEST=GetCapabilities" -o /tmp/cap.xml; echo "caps $(wc -c < /tmp/cap.xml) bytes"
grep -o "<ows:Identifier>[A-Za-z_]*\(Reference\|Label\|Coast\|Road\|Border\|OSM\)[A-Za-z0-9_]*</ows:Identifier>" /tmp/cap.xml | sort -u
python3 - <<'P'
import re
s=open('/tmp/cap.xml').read()
for m in re.finditer(r'<Layer>(.*?)</Layer>', s, re.S):
    b=m.group(1); i=re.search(r'<ows:Identifier>(.*?)</ows:Identifier>', b).group(1)
    if re.search('Reference|Coast|OSM|Label', i):
        print(i, re.findall(r'<TileMatrixSet>(.*?)</TileMatrixSet>', b), re.findall(r'template="([^"]+)"', b)[:1], re.findall(r'<Format>(.*?)</Format>', b)[:2])
P
for zyx in "3 3 6" "5 14 24" "6 29 49" "8 118 199" "10 472 797"; do
  set -- $zyx
  for L in Reference_Labels_15m Reference_Features_15m Coastlines_15m; do
    echo "$L $1/$2/$3: $(curl -s -o /dev/null -w '%{http_code} %{size_download}' "$G/$L/default/default/GoogleMapsCompatible_Level13/$1/$2/$3.png")"
  done
done
