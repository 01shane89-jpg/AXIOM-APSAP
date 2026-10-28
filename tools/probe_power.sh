#!/usr/bin/env bash
# Test only: asks each Overpass host the power grid's real queries (assets/osap-power.js) for Thailand and a few other places,
# with a browser's headers, and prints status, CORS header, element count, remark and time. Writes nothing to the repo.
UA="Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
HV='["voltage"~"^([2-9][0-9]{5}|[1-9][0-9]{6})"]'
HOSTS="https://overpass-api.de/api/interpreter https://maps.mail.ru/osm/tools/overpass/api/interpreter https://overpass.kumi.systems/api/interpreter https://overpass.private.coffee/api/interpreter https://overpass.osm.jp/api/interpreter"
# name|south,west,north,east|mode (h = 200 kV+, a = all)
BOXES="th-phone-z8-bangkok|11.4,99.5,15.9,101.7|h
th-desk-z8-bangkok|11.6,96.9,15.7,104.3|h
th-z11-bangkok|13.6,100.3,13.9,100.8|a
th-phone-z8-chiangmai|16.5,97.9,20.9,100.1|h
vn-phone-z8-hanoi|18.8,104.7,23.2,106.9|h
de-phone-z8-berlin|50.3,12.3,54.7,14.5|h"
for h in $HOSTS; do
  echo "################ $h"
  while IFS='|' read -r name bb mode; do
    q="[out:json][timeout:25][bbox:$bb];"
    if [ "$mode" = a ]; then q="$q(way[\"power\"=\"line\"];way[\"power\"=\"cable\"]$HV;)->.l;.l out geom($bb) 4000;(nwr[\"power\"=\"substation\"];)->.p;.p out center tags 1500;"
    else q="$q(way[\"power\"=\"line\"]$HV;)->.l;.l out geom($bb) 4000;(nwr[\"power\"=\"substation\"]$HV;)->.p;.p out center tags 1500;"; fi
    rm -f o.json h.txt
    w=$(curl -sS -m 40 -o o.json -D h.txt -w "%{http_code} %{size_download}B %{time_total}s" -A "$UA" -H "Origin: https://axiom-osap.netlify.app" -H "Referer: https://axiom-osap.netlify.app/" -H "Content-Type: application/x-www-form-urlencoded" --data-urlencode "data=$q" "$h" 2>&1)
    cors=$(grep -i "^access-control-allow-origin" h.txt 2>/dev/null | tr -d '\r')
    stats=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync("o.json","utf8"));const e=j.elements||[];console.log("lines="+e.filter(x=>x.type==="way"&&x.tags&&/line|cable/.test(x.tags.power)).length+" subs="+e.filter(x=>x.tags&&x.tags.power==="substation").length+" remark="+JSON.stringify(j.remark||""))}catch(x){console.log("not json: "+require("fs").readFileSync("o.json","utf8").slice(0,160).replace(/\s+/g," "))}' 2>/dev/null)
    echo "$name | $w | $cors | $stats"
  done <<< "$BOXES"
done
