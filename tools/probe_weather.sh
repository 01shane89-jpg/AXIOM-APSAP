#!/usr/bin/env bash
# Test only (probe branch): which Open-Meteo models answer for the map grid, CORS, and RainViewer frame list.
O="https://axiom-osap.netlify.app"
P="latitude=13.75,18.8,-33.9,51.5,40.7&longitude=100.5,99,151.2,-0.1,-74"
for m in best_match ecmwf_ifs025 ecmwf_aifs025_single gfs_seamless icon_seamless jma_seamless gem_seamless meteofrance_seamless ukmo_seamless cma_grapes_global bom_access_global kma_seamless; do
  u="https://api.open-meteo.com/v1/forecast?$P&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,precipitation&models=$m&forecast_days=7&timeformat=unixtime&timezone=GMT&wind_speed_unit=kn"
  curl -sS -m 40 -D /tmp/h.txt -o /tmp/m.json -H "Origin: $O" "$u"
  echo "=== $m $(grep -i '^HTTP/' /tmp/h.txt | tr -d '\r') $(grep -i 'access-control-allow-origin' /tmp/h.txt | tr -d '\r')"
  python3 - <<'PY'
import json
j=json.load(open('/tmp/m.json'))
if isinstance(j,dict) and j.get('error'): print('ERR',j); raise SystemExit
for p in (j if isinstance(j,list) else [j]):
    h=p['hourly']; ks=[k for k in h if k!='time']
    print(' ', p['latitude'],p['longitude'],'hours',len(h['time']),{k:sum(v is not None for v in h[k]) for k in ks})
PY
done
curl -sS -m 30 -H "Origin: $O" -D - -o /tmp/rv.json https://api.rainviewer.com/public/weather-maps.json | grep -iE "^HTTP|access-control" | tr -d '\r'
python3 -c "import json;j=json.load(open('/tmp/rv.json'));print({k:len(v) for k,v in j['radar'].items()}, j['radar']['past'][0], j.get('satellite') and {k:len(v) for k,v in j['satellite'].items()})"
# 120 points in one request (the wind-particle grid size)
LA=$(python3 -c "print(','.join(str(round(5+i*1.5,2)) for i in range(12) for j in range(10)))"); LO=$(python3 -c "print(','.join(str(round(95+j*1.5,2)) for i in range(12) for j in range(10)))")
curl -sS -m 60 -o /tmp/g.json -w "grid120 HTTP %{http_code} %{size_download} bytes %{time_total}s\n" "https://api.open-meteo.com/v1/forecast?latitude=$LA&longitude=$LO&hourly=wind_speed_10m,wind_direction_10m,precipitation,cloud_cover,temperature_2m,wind_gusts_10m&models=ecmwf_ifs025&forecast_days=4&timeformat=unixtime&timezone=GMT&wind_speed_unit=kn"
head -c 300 /tmp/g.json; echo
