#!/usr/bin/env bash
# Test only: checks that the free, no-key weather hosts the Weather tab uses answer from a GitHub runner, and whether a
# browser on the live site may read them (CORS). Prints status, CORS header, size and the first bytes. Writes nothing.
O="https://01shane89-jpg.github.io"
probe() {
  local u="$1"
  local h
  h=$(curl -sS -m 30 -L -D - -o /tmp/p.bin -H "Origin: $O" -A "Mozilla/5.0 (OSAP probe)" "$u" 2>&1)
  echo "=== $u"
  echo "$h" | grep -iE "^HTTP/|access-control-allow-origin|content-type" | tr -d '\r'
  echo "bytes: $(wc -c < /tmp/p.bin 2>/dev/null)"
  head -c ${2:-400} /tmp/p.bin | tr '\n' ' '; echo
}
probe "https://aviationweather.gov/api/data/metar?bbox=12,99,15,102&format=json" 1200
probe "https://aviationweather.gov/api/data/taf?bbox=12,99,15,102&format=json" 600
probe "https://aviationweather.gov/api/data/metar?ids=VTBS&format=json&hours=2" 300
probe "https://api.rainviewer.com/public/weather-maps.json" 2000
curl -sS -m 60 "https://severeweather.wmo.int/v2/json/wmo_all.json" -o /tmp/w.json
python3 - <<'PY'
import json
d=json.load(open('/tmp/w.json')); it=d['items']
print('keys', sorted(it[0].keys()))
print(json.dumps(it[0])[:1500])
import collections
print(collections.Counter(k for x in it for k in x if x.get(k) not in (None,'',[])).most_common(40))
PY
curl -sS -m 60 "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/wmts.cgi?SERVICE=WMTS&REQUEST=GetCapabilities" -o /tmp/caps.xml
grep -oE "<ows:Identifier>[^<]*(Meteosat|MSG|SEVIRI|GK2A|Geo|Air_Mass|Dust)[^<]*</ows:Identifier>" /tmp/caps.xml | sed 's/<[^>]*>//g' | sort -u | head -60
for L in IMERG_Precipitation_Rate_30min Himawari_AHI_Air_Mass GOES-East_ABI_GeoColor; do
  echo "--- $L"; python3 - "$L" <<'PY'
import re,sys
x=open('/tmp/caps.xml').read(); L=sys.argv[1]
i=x.find('<ows:Identifier>'+L+'</ows:Identifier>')
if i<0: print('missing'); sys.exit()
s=x.rfind('<Layer>',0,i); e=x.find('</Layer>',i); b=x[s:e]
print(re.findall(r'TileMatrixSet>([^<]+)<',b)[:3], re.findall(r'<Format>([^<]+)',b)[:2])
m=re.search(r'<Default>([^<]+)',b); print('default', m.group(1) if m else None)
v=re.findall(r'<Value>([^<]+)',b); print('last values', v[-2:])
m=re.search(r'<ows:WGS84BoundingBox.*?</ows:WGS84BoundingBox>',b,re.S); print(re.sub(r'\s+',' ',m.group(0)) if m else '')
PY
done
probe "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/IMERG_Precipitation_Rate_30min/default/default/GoogleMapsCompatible_Level6/3/3/6.png" 20
probe "https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventtype=TC" 600
probe "https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype=TC&eventid=1001200&episodeid=1" 300
probe "https://api.weather.gov/alerts/active?status=actual&severity=Severe" 300
probe "https://www.weather.gov/source/crh/lightning.png" 50
probe "https://nowcoast.noaa.gov/geoserver/ows?service=WMS&request=GetCapabilities" 200
