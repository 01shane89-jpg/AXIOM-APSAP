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
F="https://api.open-meteo.com/v1/forecast?latitude=13.75&longitude=100.5&timeformat=unixtime&timezone=auto"
probe "$F&hourly=temperature_2m,precipitation_probability,uv_index,is_day&models=ecmwf_ifs025,gfs_seamless,icon_seamless&forecast_days=1" 1500
probe "$F&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,precipitation_sum,precipitation_hours,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,uv_index_max,sunshine_duration,shortwave_radiation_sum&wind_speed_unit=kn&forecast_days=16" 3000
probe "$F&daily=temperature_2m_max,precipitation_sum,wind_gusts_10m_max&models=ecmwf_ifs025,gfs_seamless,icon_seamless&forecast_days=7" 1500
probe "https://ensemble-api.open-meteo.com/v1/ensemble?latitude=13.75&longitude=100.5&hourly=temperature_2m&models=ecmwf_ifs025&forecast_days=1" 300
probe "https://marine-api.open-meteo.com/v1/marine?latitude=18.8&longitude=98.98&hourly=wave_height&forecast_days=1" 400
probe "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=13.75&longitude=100.5&hourly=pm10,pm2_5,us_aqi,uv_index,dust,ozone&forecast_days=1" 400
exit 0
curl -sS -m 60 "https://nowcoast.noaa.gov/geoserver/ows?service=WMS&request=GetCapabilities" -o /tmp/nc.xml
python3 - <<'PY'
import re
x=open('/tmp/nc.xml').read()
for m in re.finditer(r'<Layer[^>]*>\s*<Name>([^<]+)</Name>\s*<Title>([^<]*)</Title>',x):
    print(m.group(1),'|',m.group(2))
PY
probe "https://nowcoast.noaa.gov/geoserver/satellite/wms?service=WMS&version=1.3.0&request=GetMap&layers=global_longwave_imagery_mosaic&styles=&crs=EPSG:3857&bbox=0,0,5009377,5009377&width=256&height=256&format=image/png&transparent=true" 60
probe "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/$(date -u +%F)/GoogleMapsCompatible_Level9/3/3/6.jpg" 30
probe "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/$(date -u -d yesterday +%F)/GoogleMapsCompatible_Level9/3/3/6.jpg" 30
