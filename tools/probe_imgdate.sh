#!/usr/bin/env bash
# Test only: what Esri publishes about imagery capture dates (World Imagery metadata, Clarity, Wayback). Prints, stores nothing.
set -u
M=https://metadata.maptiles.arcgis.com/arcgis/rest/services
S=https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer
C=$M/World_Imagery_Clarity_Metadata/MapServer
p() { echo; echo "=== $1"; curl -sS -m 25 -o /tmp/b -D /tmp/h -H "Origin: https://axiom-osap.netlify.app" "$1"; head -c "${2:-3000}" /tmp/b; echo; grep -i "access-control-allow-origin\|^HTTP" /tmp/h; }
lay() { echo; echo "=== layers $1"; curl -sS -m 25 "$1?f=json" | python3 -c "import json,sys; d=json.load(sys.stdin); [print(l.get('id'),l.get('name'),l.get('minScale'),l.get('maxScale')) for l in d.get('layers',[])]"; }
lay $S; lay $C; lay $M/World_Imagery_Metadata_2026_r10/MapServer
for u in $S/0 $C/0; do curl -sS -m 25 "$u?f=json" | python3 -c "import json,sys; d=json.load(sys.stdin); print('FIELDS', d.get('name'), d.get('minScale'), d.get('maxScale'), [(f['name'],f['type']) for f in d.get('fields') or []])"; done
id() { # $1 service, $2 lon, $3 lat, $4 zoom
  r=$(python3 -c "print(156543.03/2**$4*400/111320/2)")
  p "$1/identify?geometry=$2,$3&geometryType=esriGeometryPoint&sr=4326&layers=visible&tolerance=0&mapExtent=$(python3 -c "print(f'{$2-$r},{$3-$r},{$2+$r},{$3+$r}')")&imageDisplay=400,400,96&returnGeometry=false&f=json" 2500
}
for z in 17 14 11 6; do id $S 100.5018 13.7563 $z; done
id $S -77.0365 38.8977 17
for z in 17 12; do id $C 100.5018 13.7563 $z; done
id $M/World_Imagery_Metadata_2026_r10/MapServer 100.5018 13.7563 17
p "$S/query?f=json" 400
