#!/usr/bin/env bash
# Test only: checks the free, no-key air traffic (ADS-B) and ship (AIS) hosts from a GitHub runner: status, whether a browser
# on the live site may read them (CORS), size, item counts and how fast they start refusing. Writes nothing.
O="https://osap-app.github.io"
probe() {
  local u="$1" h
  h=$(curl -sS -m 40 -L -D - -o /tmp/p.bin -w 'time %{time_total}s\n' -H "Origin: $O" -H "Accept-Encoding: gzip" --compressed -A "AXIOM-OSAP/1.0 (+https://osap-app.github.io/)" "$u" 2>&1)
  echo "=== $u"
  echo "$h" | grep -iE "^HTTP/|access-control-allow-origin|content-type|ratelimit|retry-after|^time" | tr -d '\r'
  echo "bytes: $(wc -c < /tmp/p.bin 2>/dev/null)"
  python3 - <<'PY'
import json
try:
    j=json.load(open('/tmp/p.bin'))
except Exception as e:
    print('not json:', open('/tmp/p.bin','rb').read(300)); raise SystemExit
if isinstance(j,dict):
    print('keys', list(j.keys())[:12])
    for k in ('ac','aircraft','states','features'):
        if isinstance(j.get(k),list):
            print(k, len(j[k]));
            if j[k]: print('first', json.dumps(j[k][0])[:900])
    if 'attribution' in j: print('attribution', json.dumps(j['attribution'])[:600])
    for k in ('truncated','limit','note','message','msg'):
        if k in j: print(k, str(j[k])[:200])
elif isinstance(j,list):
    print('list', len(j)); print('first', json.dumps(j[0])[:600] if j else '')
PY
}
echo "##### ADS-B, one call each"
probe "https://opendata.adsb.fi/api/v3/lat/13.7/lon/100.7/dist/250"
probe "https://opendata.adsb.fi/api/v2/lat/13.7/lon/100.7/dist/250"
probe "https://api.adsb.lol/v2/point/13.7/100.7/250"
probe "https://api.airplanes.live/v2/point/13.7/100.7/250"
probe "https://api.adsb.one/v2/point/13.7/100.7/250"
probe "https://opensky-network.org/api/states/all?lamin=5&lomin=95&lamax=21&lomax=110"
sleep 3
probe "https://opensky-network.org/api/states/all"
echo "##### adsb.fi burst at 1.05 s"
for i in $(seq 1 30); do lat=$(( (i % 6) * 8 + 5 )); lon=$(( (i / 6) * 10 + 95 ));
  curl -sS -m 20 -o /tmp/b.bin -w "$i %{http_code} %{time_total}s %{size_download}B\n" -A "AXIOM-OSAP/1.0" "https://opendata.adsb.fi/api/v3/lat/$lat/lon/$lon/dist/250"; sleep 1.05; done
echo "##### adsb.lol burst at 1.5 s"
for i in $(seq 1 20); do lat=$(( (i % 6) * 8 + 5 )); lon=$(( (i / 6) * 10 - 10 ));
  curl -sS -m 20 -o /tmp/b.bin -w "$i %{http_code} %{time_total}s %{size_download}B\n" -A "AXIOM-OSAP/1.0" "https://api.adsb.lol/v2/point/$lat/$lon/250"; sleep 1.5; done
echo "##### AIS"
probe "https://ais.openwaters.io/v1/vessels?bbox=1,103,2,105"
probe "https://ais.openwaters.io/v1/vessels?bbox=5,100,15,110"
probe "https://ais.openwaters.io/v1/vessels?bbox=-10,95,10,125"
probe "https://ais.openwaters.io/v1/vessels/tiles.json"
probe "https://ais.openwaters.io/v1/stats"
probe "https://ais.openwaters.io/v1/stations"
probe "https://meri.digitraffic.fi/api/ais/v1/locations"
echo "##### openwaters 2x2 grid scan speed"
for i in $(seq 1 15); do lat=$(( (i % 5) * 10 - 10 )); lon=$(( (i / 5) * 10 + 95 ));
  curl -sS -m 30 --compressed -o /tmp/b.bin -w "$i %{http_code} %{time_total}s %{size_download}B " -A "AXIOM-OSAP/1.0" "https://ais.openwaters.io/v1/vessels?bbox=$lat,$lon,$((lat+10)),$((lon+10))"; python3 -c "import json;j=json.load(open('/tmp/b.bin'));print(len(j.get('features',[])), j.get('truncated',''))" 2>/dev/null || echo; sleep 0.6; done
