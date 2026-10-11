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
echo "##### GIBS 3857 capabilities"
curl -sS -m 60 "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml" -o /tmp/g.xml; ls -la /tmp/g.xml
python3 - <<'PY'
import re
x=open('/tmp/g.xml',encoding='utf-8',errors='ignore').read()
for m in re.finditer(r'<Layer>(.*?)</Layer>', x, re.S):
    b=m.group(1); i=re.search(r'<ows:Identifier>([^<]*)',b).group(1)
    if re.search(r'pop|gpw|settle|urban|ghs', i, re.I):
        tms=re.findall(r'<TileMatrixSet>([^<]*)',b); fmt=re.findall(r'<Format>([^<]*)',b); dims=re.findall(r'<Value>([^<]*)',b)[:6]
        meta=re.findall(r'xlink:href="([^"]*)"',b)[:4]
        print(i, tms, fmt, dims, meta)
PY
for L in GPW_Population_Density_2020 GPW_Population_Density_2015 GPW_Population_Density_2000; do
  for t in "3/6/3" "5/26/14" "7/108/57"; do
    hit "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/$L/default/default/GoogleMapsCompatible_Level7/$t.png"; px
  done
done
for c in GPW_Population_Density GPW_Population_Density_2020; do hit "https://gibs.earthdata.nasa.gov/colormaps/v1.3/$c.xml"; head -c 4000 /tmp/b; echo; done
hit "https://gibs.earthdata.nasa.gov/legends/GPW_Population_Density_H.svg"; head -c 600 /tmp/b; echo
echo "##### SEDAC"
hit "https://sedac.ciesin.columbia.edu/geoserver/wms?service=WMS&request=GetCapabilities&version=1.3.0"; grep -o "<Name>[^<]*pop[^<]*</Name>" /tmp/b | head -20
echo "##### WorldPop"
hit "https://ogc.worldpop.org/geoserver/ows?service=WMS&request=GetCapabilities"; grep -o "<Name>[^<]*</Name>" /tmp/b | head -40
hit "https://ogc.worldpop.org/geoserver/wms?service=WMS&request=GetCapabilities"; grep -o "<Name>[^<]*</Name>" /tmp/b | head -40
echo "##### GHSL / JRC"
hit "https://ghsl.jrc.ec.europa.eu/ghsl_wms.php?service=WMS&request=GetCapabilities"; head -c 800 /tmp/b; echo
hit "https://jeodpp.jrc.ec.europa.eu/jeodpp/services/ows/wms/landcover/ghsl?service=WMS&request=GetCapabilities"; grep -o "<Name>[^<]*</Name>" /tmp/b | head -40
hit "https://jeodpp.jrc.ec.europa.eu/jeodpp/services/ows/wms/ghsl?service=WMS&request=GetCapabilities"; grep -o "<Name>[^<]*</Name>" /tmp/b | head -40
echo "##### Esri living atlas"
hit "https://landscape6.arcgis.com/arcgis/rest/services/World_Population_Density_Estimate_2016/ImageServer?f=json"; head -c 600 /tmp/b; echo
hit "https://tiles.arcgis.com/tiles/P3ePLMYs2RVChkJx/arcgis/rest/services/World_Population_Density_Estimate_2016/MapServer?f=json"; head -c 600 /tmp/b; echo
echo "##### Kontur"
hit "https://disaster.ninja/active/api/tiles/bivariate/v1/3/6/3.mvt"; head -c 200 /tmp/b | xxd | head -3
hit "https://apps.kontur.io/active/api/tiles/bivariate/v1/3/6/3.mvt"; head -c 200 /tmp/b | xxd | head -3
