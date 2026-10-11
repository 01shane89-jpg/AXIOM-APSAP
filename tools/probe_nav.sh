#!/usr/bin/env bash
# Test only (branch claude/nav-probe, never in a PR): what turn, lane and speed-limit data the keyless routers return.
set -u
O="https://routing.openstreetmap.de/routed-car/route/v1/driving"
for q in "100.5018,13.7563;100.5600,13.7400" "100.6070,13.9140;100.6900,14.0350" "139.7000,35.6900;139.7700,35.6800"; do
  for a in "" "&annotations=maxspeed" "&annotations=speed,duration,distance"; do
    echo "=== OSRM $q $a"
    curl -s -m 30 "$O/$q?overview=full&geometries=geojson&steps=true$a" | python3 -c '
import json,sys
try: j=json.load(sys.stdin)
except Exception as e: print("not json", e); sys.exit()
print("code", j.get("code"), j.get("message"))
if j.get("code")!="Ok": sys.exit()
r=j["routes"][0]; L=r["legs"][0]; a=L.get("annotation") or {}
print("annotation keys", list(a.keys()))
if "maxspeed" in a: print("maxspeed sample", a["maxspeed"][:12])
n=0; nl=0
for s in L["steps"]:
  ln=[i.get("lanes") for i in s.get("intersections",[]) if i.get("lanes")]
  if ln: nl+=1
  if n<8: print(json.dumps({"m":s["maneuver"],"name":s.get("name"),"ref":s.get("ref"),"dest":s.get("destinations"),"exits":s.get("exits"),"rotary":s.get("rotary_name"),"lanes":ln[:1]})[:400]); n+=1
print("steps", len(L["steps"]), "with lanes", nl)
'
  done
done
V="https://valhalla1.openstreetmap.de"
echo "=== Valhalla route lanes/speed"
curl -s -m 30 "$V/route?json=$(python3 -c 'import json,urllib.parse;print(urllib.parse.quote(json.dumps({"locations":[{"lat":13.914,"lon":100.607},{"lat":14.035,"lon":100.69}],"costing":"auto","directions_options":{"units":"kilometers"}})))')" | python3 -c '
import json,sys
j=json.load(sys.stdin); t=j.get("trip",{})
for m in t.get("legs",[{}])[0].get("maneuvers",[])[:6]: print(json.dumps({k:m.get(k) for k in ["type","instruction","street_names","begin_street_names","sign","roundabout_exit_count","verbal_pre_transition_instruction","lanes"]})[:400])
'
echo "=== Valhalla trace_attributes speed_limit"
curl -s -m 30 -X POST "$V/trace_attributes" -H "Content-Type: application/json" -d '{"shape":[{"lat":13.914,"lon":100.607},{"lat":13.95,"lon":100.62},{"lat":14.035,"lon":100.69}],"costing":"auto","shape_match":"map_snap","filters":{"attributes":["edge.speed_limit","edge.speed","edge.names","edge.length"],"action":"include"}}' | head -c 1500; echo
