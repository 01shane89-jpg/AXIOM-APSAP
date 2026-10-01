#!/usr/bin/env bash
# Test only: checks the free, no-key hosts the Medical plan tool calls from the browser (Overpass for hospitals, clinics,
# helipads, airfields, air rescue bases and embassies; OSRM for drive times and routes; Valhalla for drive-time areas;
# Wikidata for national emergency numbers; Open-Meteo for evacuation weather). Prints status, CORS header and a short body
# to the log; writes nothing to the repo.
O="https://01shane89-jpg.github.io"
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36"
probe() {
  echo "=== $1"
  curl -sS -m 60 -A "$UA" -H "Origin: $O" -D /tmp/h -o /tmp/b "$@" -w "time %{time_total}s size %{size_download}\n" || echo "FAILED"
  grep -i '^HTTP/\|^access-control-allow-origin\|^content-type\|^retry-after' /tmp/h
  head -c 600 /tmp/b | tr '\n' ' '; echo; echo
}
tags() { python3 - "$1" <<'PY'
import json,sys
from collections import Counter
try:
  j=json.load(open('/tmp/b')); E=j.get('elements',[])
  print('elements',len(E))
  print('tag keys', Counter(k for e in E for k in e.get('tags',{})).most_common(60))
  for k in ['emergency','healthcare:speciality','trauma','emergency:trauma','healthcare:trauma','operator:type','beds','phone','contact:phone','website','air_rescue_service','country','diplomatic']:
    v=Counter(e.get('tags',{}).get(k) for e in E if k in e.get('tags',{}))
    if v: print(' ',k, v.most_common(12))
except Exception as x: print('not json', x)
PY
}
OP=https://overpass-api.de/api/interpreter
# hospitals round Bangkok and Yala: which capability and contact tags exist
for c in "13.75,100.52" "6.54,101.28" "50.11,8.68"; do
  probe "$OP" -H "Accept: */*" --data-urlencode "data=[out:json][timeout:40];nwr[\"amenity\"=\"hospital\"](around:30000,$c);out center tags 400;"; tags
done
# trauma tags anywhere (sample)
probe "$OP" -H "Accept: */*" --data-urlencode 'data=[out:json][timeout:60];nwr["amenity"="hospital"]["healthcare:speciality"~"trauma"](around:300000,13.75,100.52);out center tags 50;'; tags
probe "$OP" -H "Accept: */*" --data-urlencode 'data=[out:json][timeout:60];nwr["emergency"="air_rescue_service"](around:400000,13.75,100.52);out center tags 50;'; tags
probe "$OP" -H "Accept: */*" --data-urlencode 'data=[out:json][timeout:60];nwr["emergency"="air_rescue_service"](around:200000,50.11,8.68);out center tags 50;'; tags
probe "$OP" -H "Accept: */*" --data-urlencode 'data=[out:json][timeout:60];nwr["office"="diplomatic"]["country"="US"](around:800000,13.75,100.52);out center tags 20;'; tags
probe "$OP" -H "Accept: */*" --data-urlencode 'data=[out:json][timeout:60];nwr["amenity"="embassy"]["country"="US"](around:800000,13.75,100.52);out center tags 20;'; tags
probe "$OP" -H "Accept: */*" --data-urlencode 'data=[out:json][timeout:60];nwr["aeroway"="aerodrome"]["aerodrome:type"="international"](around:400000,6.54,101.28);out center tags 20;'; tags
# Wikidata: emergency numbers (P2852) with their usage qualifier (P366) for Thailand Q869 and Germany Q183
Q='SELECT ?c ?num ?useLabel WHERE { VALUES ?c { wd:Q869 wd:Q183 wd:Q928 } ?c p:P2852 ?st . ?st ps:P2852 ?n . ?n rdfs:label ?num . FILTER(LANG(?num)="en") OPTIONAL { ?st pq:P366 ?use } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }'
probe "https://query.wikidata.org/sparql?format=json&query=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))' "$Q")"
Q2='SELECT ?c ?n ?nLabel ?useLabel WHERE { VALUES ?c { wd:Q869 wd:Q183 } ?c p:P2852 ?st . ?st ps:P2852 ?n . OPTIONAL { ?n wdt:P366 ?use } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }'
probe "https://query.wikidata.org/sparql?format=json&query=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))' "$Q2")"
# OSRM route with geometry; Valhalla isochrone
probe "https://routing.openstreetmap.de/routed-car/route/v1/driving/101.28,6.54;101.2519,6.8697?overview=simplified&geometries=geojson&steps=true"
J=$(python3 -c 'import urllib.parse,json;print(urllib.parse.quote(json.dumps({"locations":[{"lat":6.54,"lon":101.28}],"costing":"auto","contours":[{"time":30},{"time":60}],"polygons":True,"generalize":150})))')
probe "https://valhalla1.openstreetmap.de/isochrone?json=$J"
