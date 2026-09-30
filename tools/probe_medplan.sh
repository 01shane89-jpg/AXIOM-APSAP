#!/usr/bin/env bash
# Test only: checks the free, no-key hosts the Medical plan tool calls from the browser (Overpass for hospitals, clinics,
# helipads and airfields; OSRM table for drive times; Open-Meteo for evacuation weather). Prints status, CORS header and a
# short body to the log; writes nothing to the repo.
O="https://01shane89-jpg.github.io"
probe() {
  echo "=== $1"
  curl -sS -m 45 -H "Origin: $O" -D /tmp/h -o /tmp/b "$@" -w "time %{time_total}s size %{size_download}\n" || echo "FAILED"
  grep -i '^HTTP/\|^access-control-allow-origin\|^content-type\|^retry-after' /tmp/h
  head -c 700 /tmp/b | tr '\n' ' '; echo; echo
}
Q='[out:json][timeout:25];(nwr["amenity"~"^(hospital|clinic)$"](around:40000,6.87,101.25);nwr["healthcare"="hospital"](around:40000,6.87,101.25);nwr["aeroway"~"^(helipad|heliport|aerodrome)$"](around:60000,6.87,101.25););out center tags 400;'
for h in https://overpass-api.de/api/interpreter https://maps.mail.ru/osm/tools/overpass/api/interpreter; do
  probe "$h" -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36" -H "Accept: */*" --data-urlencode "data=$Q"
  python3 - <<'PY'
import json
try:
  j=json.load(open('/tmp/b')); E=j.get('elements',[])
  from collections import Counter
  print('elements',len(E), Counter((e.get('tags',{}).get('amenity') or e.get('tags',{}).get('aeroway') or e.get('tags',{}).get('healthcare')) for e in E))
  print('tag keys', Counter(k for e in E for k in e.get('tags',{})).most_common(40))
except Exception as x: print('not json', x)
PY
done
echo "=== preflight overpass POST"; curl -sS -m 20 -X OPTIONS -H "Origin: $O" -H "Access-Control-Request-Method: POST" -D - -o /dev/null https://overpass-api.de/api/interpreter | grep -i 'HTTP/\|access-control'
C="101.25,6.87;101.2519,6.8697;101.28,6.55;100.99,6.62"
probe "https://routing.openstreetmap.de/routed-car/table/v1/driving/$C?sources=0&annotations=duration,distance"
probe "https://router.project-osrm.org/table/v1/driving/$C?sources=0&annotations=duration,distance"
probe "https://routing.openstreetmap.de/routed-car/nearest/v1/driving/101.25,6.87?number=1"
probe "https://api.open-meteo.com/v1/forecast?latitude=6.87&longitude=101.25&hourly=visibility,wind_gusts_10m,cloud_cover_low,precipitation,is_day&daily=sunrise,sunset,precipitation_sum,wind_gusts_10m_max,temperature_2m_max,apparent_temperature_max&past_days=3&forecast_days=3&timezone=UTC"
