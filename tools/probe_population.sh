#!/usr/bin/env bash
# Test only: looks for keyless, worldwide population-density tile/WMS services from a GitHub runner (layer names, CORS,
# tile colours). Prints to the log; writes nothing to the repo.
O="https://01shane89-jpg.github.io"
pip install -q pillow >/dev/null 2>&1
hit() { echo "=== $1"; curl -sS -m 40 -L -D /tmp/h -o /tmp/b -H "Origin: $O" "$1"; grep -iE "^HTTP/|access-control-allow-origin|content-type|content-length" /tmp/h | tr -d '\r'; }
px() { python3 - <<'PY'
from PIL import Image
from collections import Counter
try:
    im=Image.open('/tmp/b'); print('mode',im.mode,im.size)
    c=Counter(im.convert('RGBA').getdata()); n=sum(c.values())
    for k,v in c.most_common(16): print(k, round(100*v/n,2),'%')
except Exception as e: print('not image', open('/tmp/b','rb').read(300))
PY
}
echo "##### GIBS GPW tiles (z/y/x over Bangkok, Java, Europe)"
for L in GPW_Population_Density_2020; do
  for d in default 2020-01-01; do
    for t in "5/14/25" "7/57/99" "7/66/104" "4/5/8"; do
      hit "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/$L/default/$d/GoogleMapsCompatible_Level7/$t.png"; px
    done
  done
done
echo "##### GIBS GPW colormap legend"
curl -sS -m 30 "https://gibs.earthdata.nasa.gov/colormaps/v1.3/GPW_Population_Density_2020.xml" -o /tmp/c.xml
python3 - <<'PY'
import re
x=open('/tmp/c.xml').read()
for m in re.finditer(r'<ColorMapEntry rgb="([^"]*)"[^>]*value="([^"]*)"',x): print(m.group(1), m.group(2))
for m in re.finditer(r'<LegendEntry[^>]*>',x): print(m.group(0))
PY
grep -A12 "GPW_Population_Density_2020</ows:Identifier>" /tmp/g.xml 2>/dev/null | head -5
curl -sS -m 60 "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml" -o /tmp/g.xml
python3 - <<'PY'
import re
x=open('/tmp/g.xml',encoding='utf-8',errors='ignore').read()
i=x.find('GPW_Population_Density_2020</ows:Identifier>'); s=x.rfind('<Layer>',0,i); e=x.find('</Layer>',i); print(x[s:e][:3000])
PY
echo "##### GHSL POP WMS (jeodpp)"
G="https://jeodpp.jrc.ec.europa.eu/jeodpp/services/ows/wms/landcover/ghsl"
curl -sS -m 60 "$G?service=WMS&request=GetCapabilities" -o /tmp/gh.xml
python3 - <<'PY'
import re
x=open('/tmp/gh.xml',encoding='utf-8',errors='ignore').read()
print(re.findall(r'<CRS>[^<]*</CRS>|<SRS>[^<]*</SRS>',x)[:12])
for n in ['POP.GHS_POP_E2015_GLOBE_R2019A_54009_250_V1_0','LC.GHS_SMOD_POP2015_GLOBE_R2019A_54009_1K_V1_0']:
    i=x.find('<Name>'+n); s=x.rfind('<Layer',0,i); e=x.find('</Layer>',i); print(x[s:e][:2500])
PY
for B in "11163000,1447000,11241000,1525000" "10018754,0,12523442,2504688"; do
  hit "$G?service=WMS&request=GetMap&version=1.3.0&layers=POP.GHS_POP_E2015_GLOBE_R2019A_54009_250_V1_0&styles=&crs=EPSG:3857&bbox=$B&width=256&height=256&format=image/png&transparent=true"; px
done
hit "$G?service=WMS&request=GetLegendGraphic&version=1.3.0&format=image/png&layer=POP.GHS_POP_E2015_GLOBE_R2019A_54009_250_V1_0"; px
exit 0
