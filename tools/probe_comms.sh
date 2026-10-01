#!/usr/bin/env bash
# Test only: asks the free Overpass servers for masts the way the Comms tab does, and prints status, element count and any remark.
set -u
SERVERS="https://overpass-api.de/api/interpreter https://maps.mail.ru/osm/tools/overpass/api/interpreter https://overpass.kumi.systems/api/interpreter https://overpass.private.coffee/api/interpreter"
old() { echo "[out:json][timeout:40];(nwr[\"man_made\"~\"^(mast|tower|communications_tower)\$\"][~\"^(tower:type|communication:.*)\$\"~\".\"]($1);nwr[\"man_made\"=\"communications_tower\"]($1););out center tags 6000;"; }
new() { echo "[out:json][timeout:25][bbox:$1];nwr[\"man_made\"~\"^(mast|tower|communications_tower)\$\"];out center tags 10000;"; }
run() {
  local name=$1 srv=$2 q=$3
  local t0=$(date +%s.%N)
  local code=$(curl -s -m 60 -o /tmp/op.json -w "%{http_code}" --data-urlencode "data=$q" "$srv")
  local t=$(echo "$(date +%s.%N) - $t0" | bc)
  local n=$(jq '.elements|length' /tmp/op.json 2>/dev/null || echo "-")
  local rem=$(jq -r '.remark // ""' /tmp/op.json 2>/dev/null | head -c 160)
  local kinds=$(jq -r '[.elements[]?|.tags|(if (."tower:type"//"")!="" or (to_entries|map(select(.key|startswith("communication:")))|length)>0 or .man_made=="communications_tower" then "comms" else "other" end)]|group_by(.)|map("\(.[0])=\(length)")|join(" ")' /tmp/op.json 2>/dev/null)
  printf "%-28s %-45s HTTP %s  %5.1fs  elements=%s  %s  remark=%s\n" "$name" "${srv#https://}" "$code" "$t" "$n" "$kinds" "$rem"
}
# one 0.25 deg box in Bangkok; a zoom-9 desktop view of Bangkok (the joint rectangle of ~112 boxes); a zoom-10 view
for area in "box:13.7500,100.5000,14.0000,100.7500" "z9:12.7500,99.0000,14.7500,102.5000" "z10:13.2500,99.7500,14.2500,101.5000" "berlin-z9:51.7500,11.7500,53.2500,15.0000"; do
  bb=${area#*:}; nm=${area%%:*}
  for s in $SERVERS; do run "$nm old" "$s" "$(old "$bb")"; run "$nm new" "$s" "$(new "$bb")"; sleep 2; done
done
