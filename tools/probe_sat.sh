#!/usr/bin/env bash
# Test only: checks the keyless Sentinel-2 sources for Satellite before/after (Earth Search STAC, the COG bucket, NASA GIBS).
set -u
O="Origin: https://osap.netlify.app"
S="https://earth-search.aws.element84.com/v1"
echo "== STAC search (GET) headers"
curl -sS -m 30 -D - -o /tmp/s.json -H "$O" "$S/search?collections=sentinel-2-l2a&bbox=30.4,50.3,30.7,50.55&datetime=2026-08-01T00:00:00Z/2026-10-19T00:00:00Z&limit=5&sortby=-properties.datetime" | grep -i -E "^HTTP|access-control|content-type"
python3 - <<'PY'
import json
d=json.load(open('/tmp/s.json'))
print("keys", list(d.keys()), "n", len(d.get("features",[])), "ctx", d.get("context"), "numberMatched", d.get("numberMatched"))
for f in d.get("features",[])[:5]:
  p=f["properties"]
  print(f["id"], p.get("datetime"), p.get("eo:cloud_cover"), p.get("proj:epsg"), p.get("proj:code"), p.get("s2:processing_baseline"), p.get("platform"), p.get("grid:code"), p.get("mgrs:utm_zone"))
  print("  visual", f["assets"].get("visual",{}).get("href"), "| thumb", f["assets"].get("thumbnail",{}).get("href"))
  print("  links", [ (l["rel"], l["href"]) for l in f.get("links",[]) if l["rel"] in ("self","canonical")])
print("next", [l for l in d.get("links",[]) if l.get("rel")=="next"][:1])
PY
echo "== STAC fields filter"
curl -sS -m 30 -o /tmp/s2.json "$S/search?collections=sentinel-2-l2a&bbox=30.4,50.3,30.7,50.55&limit=3&fields=id,properties.datetime,properties.eo:cloud_cover,assets.visual.href" && head -c 800 /tmp/s2.json; echo
echo "== STAC preflight (POST)"
curl -sS -m 30 -X OPTIONS -D - -o /dev/null -H "$O" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type" "$S/search" | grep -i -E "^HTTP|access-control"
echo "== COG bucket"
V=$(python3 -c "import json;d=json.load(open('/tmp/s.json'));print(d['features'][0]['assets']['visual']['href'])")
curl -sS -m 30 -D - -o /dev/null -H "$O" -H "Range: bytes=0-16383" "$V" | grep -i -E "^HTTP|access-control|content-range|content-length"
echo "== GIBS"
for L in MODIS_Terra_CorrectedReflectance_TrueColor MODIS_Aqua_CorrectedReflectance_TrueColor VIIRS_SNPP_CorrectedReflectance_TrueColor VIIRS_NOAA20_CorrectedReflectance_TrueColor VIIRS_NOAA21_CorrectedReflectance_TrueColor; do
  curl -sS -m 30 -o /dev/null -D /tmp/h -w "$L %{http_code} %{content_type} %{size_download}\n" -H "$O" "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/$L/default/2026-10-10/GoogleMapsCompatible_Level9/6/21/37.jpg"; grep -i access-control-allow-origin /tmp/h
done
