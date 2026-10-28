#!/usr/bin/env bash
# Test only: asks Geofabrik's Postpass and the mail.ru Overpass host the power grid's queries for Thailand and a few other places,
# with a browser's headers, and prints status, CORS header, feature count and time. Writes nothing to the repo.
UA="Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
PP=https://postpass.geofabrik.de/api/interpreter
HVRE="^([2-9][0-9]{5}|[1-9][0-9]{6})"
BOXES="th-phone-z8-bangkok|11.4,99.5,15.9,101.7|h
th-desk-z8-bangkok|11.6,96.9,15.7,104.3|h
th-z11-bangkok|13.6,100.3,13.9,100.8|a
th-z13-tadia|12.5,99.35,12.65,99.5|a
th-phone-z8-chiangmai|16.5,97.9,20.9,100.1|h
vn-phone-z8-hanoi|18.8,104.7,23.2,106.9|h
de-phone-z8-berlin|50.3,12.3,54.7,14.5|h"
pp() { # name sql
  rm -f o.json h.txt
  w=$(curl -sS -m 60 -o o.json -D h.txt -w "%{http_code} %{size_download}B %{time_total}s" -A "$UA" -H "Origin: https://axiom-osap.netlify.app" --data-urlencode "data=$2" "$PP" 2>&1)
  cors=$(grep -i "^access-control-allow-origin" h.txt 2>/dev/null | tr -d '\r')
  stats=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync("o.json","utf8"));const f=j.features||[];const c={};f.forEach(x=>{const p=(x.properties&&x.properties.tags&&x.properties.tags.power)||(x.properties&&x.properties.power)||"?";c[p]=(c[p]||0)+1});console.log(JSON.stringify(c)+" sample="+JSON.stringify(f[0]||{}).slice(0,220))}catch(x){console.log("not json: "+require("fs").readFileSync("o.json","utf8").slice(0,200).replace(/\s+/g," "))}' 2>/dev/null)
  echo "$1 | $w | $cors | $stats"
}
while IFS='|' read -r name bb mode; do
  IFS=, read -r s w n e <<< "$bb"
  env="geom && ST_MakeEnvelope($w,$s,$e,$n,4326)"
  if [ "$mode" = a ]; then lw="(tags->>'power' = 'line' OR (tags->>'power' = 'cable' AND tags->>'voltage' ~ '$HVRE'))"; sw="tags->>'power' = 'substation'"
  else lw="tags->>'power' = 'line' AND tags->>'voltage' ~ '$HVRE'"; sw="tags->>'power' = 'substation' AND tags->>'voltage' ~ '$HVRE'"; fi
  pp "$name lines" "SELECT osm_type, osm_id, tags, geom FROM postpass_line WHERE $lw AND $env"
  pp "$name subs" "SELECT osm_type, osm_id, tags, ST_PointOnSurface(geom) AS geom FROM postpass_pointpolygon WHERE $sw AND $env"
  pp "$name minor" "SELECT osm_type, osm_id, tags, geom FROM postpass_line WHERE tags->>'power' = 'minor_line' AND $env"
done <<< "$BOXES"
