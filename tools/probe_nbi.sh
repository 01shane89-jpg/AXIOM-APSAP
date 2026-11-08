#!/usr/bin/env bash
# Test only: asks the public US federal bridge inventory (FHWA National Bridge Inventory, published by USDOT/BTS as NTAD) for
# its schema and a few bridges near Seattle, and prints the CORS header a browser would see. Writes nothing.
set -u
UA="AXIOM-OSAP-probe/1.0"
BB='{"xmin":-122.36,"ymin":47.58,"xmax":-122.30,"ymax":47.62,"spatialReference":{"wkid":4326}}'
for base in \
  "https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_National_Bridge_Inventory/FeatureServer/0" \
  "https://geo.dot.gov/server/rest/services/Hosted/National_Bridge_Inventory_DS/FeatureServer/0" \
  "https://geo.dot.gov/mapping/rest/services/NTAD/National_Bridge_Inventory/MapServer/0"; do
  for try in 1 2 3; do
    echo "===== $base (try $try)"
    code=$(curl -sS -m 40 -A "$UA" -o /tmp/meta.json -w '%{http_code}' "$base?f=json") || code=ERR
    echo "meta HTTP $code"; [ "$code" = 200 ] && break; sleep 5
  done
  [ "$code" = 200 ] || continue
  python3 - <<'PY'
import json
j=json.load(open('/tmp/meta.json'))
print("name:",j.get("name"),"maxRecordCount:",j.get("maxRecordCount"),"geom:",j.get("geometryType"),"caps:",j.get("capabilities"))
print("copyright:",(j.get("copyrightText") or "")[:200])
print("fields:",",".join(f["name"] for f in j.get("fields",[])))
PY
  curl -sS -m 40 -A "$UA" -D /tmp/h.txt -H "Origin: https://axiom-osap.netlify.app" -G "$base/query" \
    --data-urlencode "geometry=$BB" --data-urlencode "geometryType=esriGeometryEnvelope" --data-urlencode "inSR=4326" \
    --data-urlencode "spatialRel=esriSpatialRelIntersects" --data-urlencode "outFields=*" --data-urlencode "outSR=4326" \
    --data-urlencode "resultRecordCount=3" --data-urlencode "f=json" -o /tmp/q.json
  grep -i -E '^(HTTP|access-control-allow-origin|content-type)' /tmp/h.txt
  python3 -c "import json;j=json.load(open('/tmp/q.json'));fs=j.get('features',[]);print('features',len(fs),'err',j.get('error'));[print(json.dumps(f)[:2500]) for f in fs[:2]]"
done
# the app's own read (assets/osap-bridges.js nbiQuery): its field list, record filter, longest first, 2000 cap; a dense view (Houston)
F=$(node -e 'const s=require("fs").readFileSync("assets/osap-bridges.js","utf8");const m=/var NBI_F = (\[[\s\S]*?\]);/.exec(s);console.log(eval(m[1]).join(","))')
for box in "-95.40,29.74,-95.33,29.78" "-122.36,47.58,-122.30,47.62" "-66.12,18.42,-66.04,18.47"; do
  for try in 1 2 3; do
    echo "===== app query $box (try $try)"
    curl -sS -m 40 -A "$UA" -G "https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_National_Bridge_Inventory/FeatureServer/0/query" \
      --data-urlencode "where=RECORD_TYPE_005A='1'" --data-urlencode "geometry=$box" --data-urlencode "geometryType=esriGeometryEnvelope" --data-urlencode "inSR=4326" \
      --data-urlencode "spatialRel=esriSpatialRelIntersects" --data-urlencode "outFields=$F" --data-urlencode "returnGeometry=true" --data-urlencode "outSR=4326" \
      --data-urlencode "orderByFields=STRUCTURE_LEN_MT_049 DESC" --data-urlencode "resultRecordCount=2000" --data-urlencode "f=json" -o /tmp/a.json -w 'HTTP %{http_code} %{size_download} bytes %{time_total}s\n' && break
    sleep 5
  done
  python3 - <<'PY'
import json,collections
j=json.load(open('/tmp/a.json'))
fs=j.get('features',[]); print('features',len(fs),'exceeded',j.get('exceededTransferLimit'),'err',j.get('error'))
c=collections.Counter((f['attributes'].get('BRIDGE_CONDITION'),f['attributes'].get('OPEN_CLOSED_POSTED_041')) for f in fs); print('cond/status',c.most_common(8))
print('methods',collections.Counter((f['attributes'].get('OPR_RATING_METH_063'),) for f in fs).most_common(6))
print('dates',collections.Counter(str(f['attributes'].get('DATE')) for f in fs).most_common(3))
sn=collections.Counter((f['attributes'].get('STATE_CODE_001'),f['attributes'].get('STRUCTURE_NUMBER_008')) for f in fs); print('unique structures',len(sn),'of',len(fs),'dups',[k for k,v in sn.items() if v>1][:5])
by={}
[by.setdefault(f['attributes'].get('DATE'),[]).append(f['attributes'].get('DATE_OF_INSPECT_090')) for f in fs]
print('DATE vs inspection dates',{k:sorted(set(v))[:6] for k,v in by.items()})
for f in fs[:1]: print(json.dumps(f)[:1800])
PY
done
