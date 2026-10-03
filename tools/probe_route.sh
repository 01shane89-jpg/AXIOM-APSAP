#!/usr/bin/env bash
# Test only: checks the free, no-key routing, elevation and forecast hosts the Route tab would call from the browser.
# Prints status, CORS header and a short body to the log; writes nothing to the repo.
O="https://osap-app.github.io"
A="100.5018,13.7563"; B="100.9925,12.9236"   # Bangkok -> Pattaya
V='{"locations":[{"lat":13.7563,"lon":100.5018},{"lat":12.9236,"lon":100.9925}],"costing":"COST","alternates":2,"units":"kilometers","directions_options":{"units":"kilometers"}}'
probe() {
  echo "=== $1"
  curl -sS -m 30 -H "Origin: $O" -D /tmp/h -o /tmp/b "$1" -w "time %{time_total}s size %{size_download}\n" || echo "FAILED"
  grep -i '^HTTP/\|^access-control-allow-origin\|^content-type\|^retry-after\|^x-ratelimit' /tmp/h
  head -c 400 /tmp/b | tr '\n' ' '; echo; echo
}
probe "https://router.project-osrm.org/route/v1/driving/$A;$B?overview=full&geometries=geojson&alternatives=true&steps=true"
probe "https://router.project-osrm.org/route/v1/foot/$A;$B?overview=false"
for p in car foot bike; do probe "https://routing.openstreetmap.de/routed-$p/route/v1/driving/$A;$B?overview=full&geometries=geojson&alternatives=true&steps=true"; done
for c in auto pedestrian bicycle truck motor_scooter; do
  J=$(printf '%s' "${V/COST/$c}" | python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.read()))')
  probe "https://valhalla1.openstreetmap.de/route?json=$J"
done
J=$(python3 -c 'import urllib.parse,json;print(urllib.parse.quote(json.dumps({"shape":[{"lat":13.7563,"lon":100.5018},{"lat":12.9236,"lon":100.9925}],"range":True})))')
probe "https://valhalla1.openstreetmap.de/height?json=$J"
probe "https://api.open-meteo.com/v1/elevation?latitude=13.7563,12.9236,18.79&longitude=100.5018,100.9925,98.98"
probe "https://api.open-meteo.com/v1/forecast?latitude=13.7563,12.9236&longitude=100.5018,100.9925&hourly=temperature_2m,precipitation,wind_speed_10m,visibility&forecast_days=2&timezone=UTC"
probe "https://geocoding-api.open-meteo.com/v1/search?name=Pattaya&count=3&format=json"
probe "https://photon.komoot.io/api/?q=Pattaya&limit=2"
probe "https://nominatim.openstreetmap.org/search?q=Pattaya&format=jsonv2&limit=1"
# CORS preflight for a POST to Valhalla
echo "=== preflight valhalla"; curl -sS -m 20 -X OPTIONS -H "Origin: $O" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type" -D - -o /dev/null https://valhalla1.openstreetmap.de/route | grep -i 'HTTP/\|access-control'
