#!/usr/bin/env bash
# Test only: checks the keyless street-level and imagery-date hosts Route Preview (assets/osap-preview.js) calls from the
# browser: KartaView, Panoramax (federated meta-catalogue and the IGN instance), the Esri World Imagery metadata (capture
# date of the satellite picture) and export. Prints status, CORS header and a short body to the log; writes nothing.
O="https://01shane89-jpg.github.io"
probe() {
  echo "=== $*"
  curl -sS -m 30 -H "Origin: $O" -D /tmp/h -o /tmp/b "$@" -w "time %{time_total}s size %{size_download}\n" || echo "FAILED"
  grep -i '^HTTP/\|^access-control-allow-origin\|^content-type' /tmp/h
  head -c 1200 /tmp/b | tr '\n' ' '; echo; echo
}
pre() {
  echo "=== preflight $1"; curl -sS -m 20 -X OPTIONS -H "Origin: $O" -H "Access-Control-Request-Method: ${2:-GET}" -H "Access-Control-Request-Headers: content-type" -D - -o /dev/null "$1" | grep -i 'HTTP/\|access-control'
}
# Bangkok Sukhumvit, Paris, Lop Buri
for P in "13.7380,100.5600" "48.8566,2.3522" "14.7995,100.6534"; do
  LA=${P%,*}; LO=${P#*,}
  probe "https://api.openstreetcam.org/2.0/photo/?lat=$LA&lng=$LO&radius=150&itemsPerPage=3&orderBy=distance&orderDirection=asc"
  probe "https://api.openstreetcam.org/2.0/photo/?lat=$LA&lng=$LO&radius=150&itemsPerPage=3"
  probe -X POST --data "lat=$LA&lng=$LO&radius=150&ipp=3" "https://api.openstreetcam.org/1.0/list/nearby-photos/"
  T=$(python3 -c "print('%.4f,%.4f' % ($LA+0.002, $LO-0.002))"); B=$(python3 -c "print('%.4f,%.4f' % ($LA-0.002, $LO+0.002))")
  probe -X POST --data "bbTopLeft=$T&bbBottomRight=$B&ipp=3&page=1" "https://kartaview.org/1.0/list/nearby-photos/"
  probe "https://api.panoramax.xyz/api/search?place_position=$LO,$LA&place_distance=0-150&limit=3"
  probe "https://api.panoramax.xyz/api/search?bbox=$(python3 -c "print('%.4f,%.4f,%.4f,%.4f' % ($LO-0.0015,$LA-0.0015,$LO+0.0015,$LA+0.0015))")&limit=3"
  probe "https://panoramax.ign.fr/api/search?place_position=$LO,$LA&place_distance=0-150&limit=2"
  probe "https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/identify?geometry=$LO,$LA&geometryType=esriGeometryPoint&sr=4326&layers=all&tolerance=1&mapExtent=$LO,$LA,$(python3 -c "print($LO+0.01)"),$(python3 -c "print($LA+0.01)")&imageDisplay=400,400,96&returnGeometry=false&f=json"
  probe "https://metadata.maptiles.arcgis.com/arcgis/rest/services/World_Imagery_Metadata/MapServer/identify?geometry=$LO,$LA&geometryType=esriGeometryPoint&sr=4326&layers=all&tolerance=1&mapExtent=$(python3 -c "print('%f,%f,%f,%f' % ($LO-0.005,$LA-0.005,$LO+0.005,$LA+0.005))")&imageDisplay=400,400,96&returnGeometry=false&f=json"
done
probe "https://metadata.maptiles.arcgis.com/arcgis/rest/services/World_Imagery_Metadata/MapServer?f=json"
probe "https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export?bbox=100.55,13.73,100.57,13.745&bboxSR=4326&imageSR=3857&size=400,300&format=jpg&f=json"
pre "https://api.openstreetcam.org/2.0/photo/"
pre "https://api.openstreetcam.org/1.0/list/nearby-photos/" POST
pre "https://kartaview.org/1.0/list/nearby-photos/" POST
pre "https://api.panoramax.xyz/api/search"
# a KartaView and Panoramax picture itself (CORS on images matters only for canvas use; <img> works without it)
U=$(curl -sS -m 30 "https://api.panoramax.xyz/api/search?place_position=2.3522,48.8566&place_distance=0-300&limit=1" | python3 -c 'import sys,json;d=json.load(sys.stdin);f=d["features"][0];print(f["assets"].get("sd",f["assets"].get("thumb"))["href"])' 2>/dev/null)
[ -n "$U" ] && probe -o /dev/null "$U"
