#!/usr/bin/env bash
# Test only: what Esri publishes about imagery capture dates (World Imagery metadata, Clarity, Wayback). Prints, stores nothing.
set -u
M=https://metadata.maptiles.arcgis.com/arcgis/rest/services
O="-H Origin:https://axiom-osap.netlify.app"
p() { echo; echo "=== $1"; curl -sS -m 25 -D /tmp/h -H "Origin: https://axiom-osap.netlify.app" "$1" | head -c "${2:-3000}"; echo; grep -i "access-control-allow-origin\|^HTTP" /tmp/h; }
p "$M?f=json" 4000
p "$M/World_Imagery_Metadata/MapServer?f=json" 6000
p "$M/World_Imagery_Metadata/MapServer/0?f=json" 3000
# Bangkok at zoom 16 and zoom 10 (identify over visible layers)
for z in 16 12 8; do
  r=$(python3 -c "print(156543.03*0.97/2**$z*400/111320/2)")
  p "$M/World_Imagery_Metadata/MapServer/identify?geometry=100.5018,13.7563&geometryType=esriGeometryPoint&sr=4326&layers=visible&tolerance=0&mapExtent=$(python3 -c "print(f'{100.5018-$r},{13.7563-$r},{100.5018+$r},{13.7563+$r}')")&imageDisplay=400,400,96&returnGeometry=false&f=json" 3000
done
p "$M/World_Imagery_Metadata/MapServer/identify?geometry=100.4,13.6,100.6,13.9&geometryType=esriGeometryEnvelope&sr=4326&layers=visible&tolerance=0&mapExtent=100.4,13.6,100.6,13.9&imageDisplay=800,800,96&returnGeometry=false&f=json" 5000
for s in World_Imagery_Clarity_Metadata World_Imagery_Clarity World_Imagery_Metadata_Clarity; do p "$M/$s/MapServer?f=json" 600; done
p "https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer?f=json" 3000
p "https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer?f=json" 2500
p "https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json" 800
p "https://static.arcgis.com/attribution/World_Imagery?f=json" 800
