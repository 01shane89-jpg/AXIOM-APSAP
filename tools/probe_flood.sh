#!/usr/bin/env bash
# Test only: checks the two flood tile hosts (NASA GIBS MODIS flood, JRC Global Surface Water) from a GitHub runner:
# CORS header (can the browser re-colour the tiles) and the colours actually in central-Thailand tiles. Writes nothing.
O="https://01shane89-jpg.github.io"
D=$(date -u -d yesterday +%F)
pip install -q pillow >/dev/null 2>&1
echo "=== GIBS colormap"
curl -sS -m 30 "https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_Combined_Flood.xml" | head -c 3000; echo
for t in "7/57/99" "7/58/99" "9/234/398" "9/232/399"; do
  for u in "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Combined_Flood_3-Day/default/$D/GoogleMapsCompatible_Level9/$t.png" \
           "https://storage.googleapis.com/global-surface-water/tiles2021/occurrence/$(echo $t | awk -F/ '{print $1"/"$3"/"$2}').png"; do
    echo "=== $u"
    curl -sS -m 30 -D - -o /tmp/t.png -H "Origin: $O" "$u" | grep -iE "^HTTP/|access-control-allow-origin|content-type" | tr -d '\r'
    python3 - <<'PY'
from PIL import Image
from collections import Counter
try:
    im=Image.open('/tmp/t.png'); print('mode',im.mode,im.size)
    if im.mode=='P': print('palette', im.getpalette()[:30], 'transparency', im.info.get('transparency') if not isinstance(im.info.get('transparency'),bytes) else list(im.info['transparency'][:12]))
    c=Counter(im.convert('RGBA').getdata()); n=sum(c.values())
    for k,v in c.most_common(24): print(k, round(100*v/n,2),'%')
except Exception as e: print('err',e)
PY
  done
done
