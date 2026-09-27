#!/usr/bin/env bash
# Test only: checks that the free, no-key weather hosts the Weather tab uses answer from a GitHub runner, and whether a
# browser on the live site may read them (CORS). Prints status, CORS header, size and the first bytes. Writes nothing.
O="https://01shane89-jpg.github.io"
D=$(date -u -d yesterday +%F)
probe() {
  local u="$1"
  local h b
  h=$(curl -sS -m 30 -L -D - -o /tmp/p.bin -H "Origin: $O" -A "Mozilla/5.0 (OSAP probe)" "$u" 2>&1)
  echo "=== $u"
  echo "$h" | grep -iE "^HTTP/|access-control-allow-origin|content-type" | tr -d '\r'
  echo "bytes: $(wc -c < /tmp/p.bin 2>/dev/null)"
  head -c ${2:-400} /tmp/p.bin | tr '\n' ' '; echo
}
probe "https://api.open-meteo.com/v1/forecast?latitude=13.7,14.5&longitude=100.5,101&hourly=temperature_2m,apparent_temperature,dew_point_2m,precipitation,rain,showers,snowfall,weather_code,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cape,lifted_index,freezing_level_height,wind_speed_850hPa,wind_direction_850hPa,wind_speed_700hPa,wind_direction_700hPa,wind_speed_500hPa,wind_direction_500hPa,cloud_cover_1000hPa,cloud_cover_925hPa,cloud_cover_850hPa,cloud_cover_700hPa,geopotential_height_1000hPa,geopotential_height_925hPa,geopotential_height_850hPa,geopotential_height_700hPa&wind_speed_unit=kn&timezone=auto&forecast_days=7" 600
probe "https://api.open-meteo.com/v1/forecast?latitude=13.7&longitude=100.5&hourly=cloud_base,ceiling&forecast_days=1" 300
probe "https://marine-api.open-meteo.com/v1/marine?latitude=12.9&longitude=100.8&hourly=wave_height,wave_direction,wave_period,swell_wave_height,wind_wave_height,sea_surface_temperature&forecast_days=2" 300
probe "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=13.7,18.8&longitude=100.5,99&current=us_aqi,pm2_5,pm10&timezone=auto" 300
probe "https://api.rainviewer.com/public/weather-maps.json" 800
P=$(curl -sS -m 30 https://api.rainviewer.com/public/weather-maps.json | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['host']+d['radar']['past'][-1]['path'])" 2>/dev/null)
echo "rainviewer path: $P"
[ -n "$P" ] && probe "$P/256/5/25/14/2/1_1.png" 40 && probe "$P/256/8/200/115/2/1_1.png" 40 && probe "$P/512/7/100/57/2/1_1.png" 40
curl -sS -m 60 "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/wmts.cgi?SERVICE=WMTS&REQUEST=GetCapabilities" -o /tmp/caps.xml
echo "GIBS caps bytes $(wc -c </tmp/caps.xml)"
grep -oE "<ows:Identifier>[^<]*(IMERG|Himawari|GOES-(East|West)|Clean_Infrared|Air_Temperature|AOD|Aerosol|Cloud_Top|Precipitation|Wind|Surface_Air|MERRA2|Soil_Moisture|Snow_Cover|Sea_Surface)[^<]*</ows:Identifier>" /tmp/caps.xml | sed 's/<[^>]*>//g' | sort -u | head -150
for L in IMERG_Precipitation_Rate Himawari_AHI_Band13_Clean_Infrared GOES-East_ABI_Band13_Clean_Infrared GOES-West_ABI_Band13_Clean_Infrared VIIRS_NOAA20_CorrectedReflectance_TrueColor; do
  echo "--- $L dims"; python3 - "$L" <<'PY'
import re,sys
x=open('/tmp/caps.xml').read(); L=sys.argv[1]
i=x.find('<ows:Identifier>'+L+'</ows:Identifier>')
if i<0: print('missing'); sys.exit()
s=x.rfind('<Layer>',0,i); e=x.find('</Layer>',i); b=x[s:e]
print(re.findall(r'TileMatrixSet>([^<]+)<',b)[:3], re.findall(r'<Format>([^<]+)',b)[:2])
m=re.search(r'<Dimension>.*?</Dimension>',b,re.S); print(re.sub(r'\s+',' ',m.group(0))[:400] if m else 'no dim')
m=re.search(r'template="([^"]+)"',b); print(m.group(1) if m else '')
PY
done
probe "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/IMERG_Precipitation_Rate/default/default/GoogleMapsCompatible_Level6/3/3/6.png" 20
probe "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Himawari_AHI_Band13_Clean_Infrared/default/default/GoogleMapsCompatible_Level6/3/3/6.png" 20
probe "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/$D/GoogleMapsCompatible_Level9/3/3/6.jpg" 20
probe "https://api.weather.gov/alerts/active?status=actual&limit=2" 300
probe "https://severeweather.wmo.int/json/wmo_all.json" 400
probe "https://severeweather.wmo.int/v2/json/wmo_all.json" 400
probe "https://severeweather.wmo.int/json/tc_inforce.json" 400
probe "https://feeds.meteoalarm.org/api/v1/warnings/feeds-germany" 300
probe "https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventlist=TC" 300
probe "https://nomads.ncep.noaa.gov/" 100
probe "https://data.ecmwf.int/forecasts/" 300
probe "https://tile.openweathermap.org/map/precipitation_new/3/6/3.png" 100
probe "https://tilecache.rainviewer.com/v2/coverage/0/256/2/1/1/0/0_0.png" 40
