#!/usr/bin/env bash
# Test only: checks what Route Preview's Drive mode (assets/osap-preview.js) needs from the keyless street picture hosts:
# how many pictures one corridor request can return (KartaView, Panoramax), 360 picture fields, picture sizes, and
# whether Mapillary answers without a token. Prints summaries to the log; writes nothing.
O="https://01shane89-jpg.github.io"
sum() { python3 -c '
import sys,json,collections
k=sys.argv[1]
try: d=json.load(open("/tmp/b"))
except Exception as e: print("not json", e); print(open("/tmp/b","rb").read(300)); sys.exit()
if k=="px":
  f=d.get("features",[]); print("features",len(f))
  print("fov",collections.Counter(str((x.get("properties") or {}).get("pers:interior_orientation",{}).get("field_of_view")) for x in f).most_common(5))
  print("collections",len(set(x.get("collection") for x in f)))
  if f: x=f[0]; print("assets",{a:(v.get("href"),v.get("type")) for a,v in (x.get("assets") or {}).items()}); print("links",[(l.get("rel"),l.get("href")) for l in x.get("links",[])][:12]); print("props",list((x.get("properties") or {}).keys()))
  print("top links",[(l.get("rel"),l.get("href")) for l in d.get("links",[])][:6])
elif k=="kv":
  it=d.get("currentPageItems",[]); print("items",len(it),"total",d.get("totalFilteredItems"))
  print("proj",collections.Counter(str(x.get("projection")) for x in it).most_common(5))
  print("seqs",len(set(x.get("sequence_id") for x in it)))
  if it: print({a:it[0].get(a) for a in ("name","lth_name","th_name","projection","heading","sequence_id","sequence_index","shot_date","field_of_view","projection_yaw")})
' "$1"; }
probe() { echo "=== $*"; curl -sS -m 40 -H "Origin: $O" -D /tmp/h -o /tmp/b "$@" -w "time %{time_total}s size %{size_download}\n" || echo FAILED; grep -i '^HTTP/\|^access-control-allow-origin\|^content-type\|^content-length' /tmp/h; }
# Mapillary without a token
probe "https://graph.mapillary.com/images?bbox=2.350,48.855,2.355,48.858&limit=2&fields=id,captured_at,thumb_1024_url"; head -c 400 /tmp/b; echo
probe "https://tiles.mapillary.com/maps/vtp/mly1_public/2/14/8297/5636"; head -c 300 /tmp/b; echo
# Panoramax: one corridor box, big limits; Paris and Lyon
for BB in "2.340,48.850,2.360,48.862" "4.830,45.755,4.850,45.765" "100.55,13.73,100.57,13.745"; do
  for L in 500 2000 10000; do probe "https://api.panoramax.xyz/api/search?bbox=$BB&limit=$L"; sum px; done
done
probe "https://api.panoramax.xyz/api/search?bbox=2.340,48.850,2.360,48.862&limit=100&sortby=-datetime"; sum px
# Panoramax corridor polygon via POST intersects
probe -X POST -H "Content-Type: application/json" --data '{"intersects":{"type":"Polygon","coordinates":[[[2.340,48.850],[2.360,48.850],[2.360,48.852],[2.340,48.852],[2.340,48.850]]]},"limit":500}' "https://api.panoramax.xyz/api/search"; sum px
# KartaView: wide radius, big pages; Bangkok, Paris, Manila
for P in "13.7380,100.5600" "48.8566,2.3522" "14.5547,121.0244"; do
  for R in "600 500" "1500 1000" "3000 2000"; do set -- $R
    probe -X POST --data "lat=${P%,*}&lng=${P#*,}&radius=$1&ipp=$2" "https://api.openstreetcam.org/1.0/list/nearby-photos/"; sum kv
  done
done
# picture sizes: a Panoramax 360 sd and a KartaView lth / full
U=$(curl -sS -m 30 "https://api.panoramax.xyz/api/search?bbox=2.30,48.84,2.40,48.88&limit=300" | python3 -c '
import sys,json
for f in json.load(sys.stdin)["features"]:
  if (f["properties"].get("pers:interior_orientation") or {}).get("field_of_view")==360: print(f["assets"]["sd"]["href"]); break')
echo "pano sd $U"; [ -n "$U" ] && probe -o /dev/null "$U" && python3 - "$U" <<'P'
import sys,urllib.request,struct
b=urllib.request.urlopen(sys.argv[1],timeout=30).read()
i=2
while i<len(b):
  m=b[i+1]; l=struct.unpack(">H",b[i+2:i+4])[0]
  if m in (0xC0,0xC2): print("jpeg size",struct.unpack(">HH",b[i+5:i+9])[::-1]); break
  i+=2+l
P
