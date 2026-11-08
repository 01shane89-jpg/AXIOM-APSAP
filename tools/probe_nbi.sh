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
