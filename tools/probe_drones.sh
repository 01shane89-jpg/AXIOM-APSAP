#!/usr/bin/env bash
# Test only: checks free, keyless ADS-B aggregators for a live drone layer. Prints status, CORS, rate-limit headers,
# size, aircraft count and any drone-type rows. Writes nothing to the repo.
O="https://01shane89-jpg.github.io"
probe() {
  local u="$1"
  echo "=== $u"
  curl -sS -m 40 -L -D /tmp/h.txt -o /tmp/p.json -H "Origin: $O" -A "Mozilla/5.0 (OSAP probe)" "$u" 2>&1 | head -3
  grep -iE "^HTTP/|access-control|ratelimit|retry-after|content-type|cache-control|server:" /tmp/h.txt | tr -d '\r'
  echo "bytes: $(wc -c < /tmp/p.json 2>/dev/null)"
  python3 - <<'PY'
import json,re
try:
    d=json.load(open('/tmp/p.json'))
except Exception as e:
    print('not json:',open('/tmp/p.json','rb').read(300)); raise SystemExit
ac=d.get('ac') or d.get('aircraft') or d.get('states') or []
print('keys',list(d)[:12],'count',len(ac))
if ac and isinstance(ac[0],dict): print('fields',sorted(ac[0].keys()))
drone=re.compile(r'^(Q1|Q4|Q9|MQ|RQ|HRON|HERN|TB2|TB3|AKIN|H450|H900|HERM|WL1|WL2|GJ2|CH4|CH5|SHDW|SCAN|S100|PRED|GLHK|TRTN|R9|BAYR)',re.I)
cs=re.compile(r'^(FORTE|MQ9|REAPR|RQ4|TRTN|NCHO|HAWK|BLAC|JAKE|DUKE|PYTN|MAGMA)',re.I)
n=0
for a in ac:
    if not isinstance(a,dict): continue
    t=(a.get('t') or ''); c=(a.get('flight') or '').strip(); desc=a.get('desc') or ''
    if drone.match(t) or cs.match(c) or re.search(r'unmanned|UAV|drone|global hawk|reaper|triton|heron|bayraktar',desc,re.I) or str(a.get('category'))=='B6':
        n+=1
        if n<=25: print(' DRONE?',t,c,a.get('r'),a.get('desc'),a.get('category'),a.get('lat'),a.get('lon'),a.get('alt_baro'),a.get('seen_pos'))
print('drone-like',n)
from collections import Counter
print('top types',Counter((a.get('t') or '?') for a in ac if isinstance(a,dict)).most_common(40))
PY
}
for h in api.adsb.lol api.airplanes.live opendata.adsb.fi/api; do
  probe "https://$h/v2/mil"
  sleep 2
done
probe "https://api.adsb.lol/v2/type/Q9"
probe "https://api.airplanes.live/v2/type/Q4"
probe "https://api.adsb.lol/v2/type/HRON"
probe "https://api.adsb.lol/v2/point/36/43/250"
probe "https://api.adsb.lol/v2/ladd" 
probe "https://opensky-network.org/api/states/all?lamin=10&lomin=95&lamax=20&lomax=110"
# CORS preflight
for u in https://api.adsb.lol/v2/mil https://api.airplanes.live/v2/mil https://opendata.adsb.fi/api/v2/mil; do
  echo "=== OPTIONS $u"; curl -sS -m 20 -X OPTIONS -D - -o /dev/null -H "Origin: $O" -H "Access-Control-Request-Method: GET" "$u" | grep -iE "^HTTP/|access-control" | tr -d '\r'
done
# rate test: 6 quick calls
for i in 1 2 3 4 5 6; do curl -sS -m 20 -o /dev/null -w "adsb.lol %{http_code} %{time_total}\n" https://api.adsb.lol/v2/mil; curl -sS -m 20 -o /dev/null -w "airplanes.live %{http_code} %{time_total}\n" https://api.airplanes.live/v2/mil; done
