#!/usr/bin/env bash
# Test only: which NGA MSI request returns the navigational warnings in force now. Prints count, newest year and issue date.
# Endpoints taken from the msi.nga.mil web app (static/js/main.*.js): broadcast-warn/current-warnings, /latest-warning,
# /inforce, and the query page's status=all / issueDateStart forms.
mkdir -p probe-out
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
sum() {
  python3 - "$1" <<'PY'
import json,sys
try: j=json.load(open(sys.argv[1]))
except Exception as e: print("  not json:", open(sys.argv[1],'rb').read(400)); raise SystemExit
L=None
if isinstance(j,dict):
    print("  keys", list(j.keys())[:10])
    for k,v in j.items():
        if isinstance(v,list): L=v; break
elif isinstance(j,list): L=j
if L is None: print("  ", json.dumps(j)[:600]); raise SystemExit
ys=[(x.get('msgYear') or x.get('year')) for x in L if isinstance(x,dict)]
ys=[y for y in ys if y]
print("  n",len(L),"years",sorted(set(ys))[-4:] if ys else None)
if L: print("  first", json.dumps(L[0])[:500])
PY
}
p() {
  local name="$1" u="$2"
  echo "=== $name $u"
  curl -sS -m 60 -L -o probe-out/$name.bin -w '  code %{http_code} size %{size_download} type %{content_type}\n' -A "$UA" -H "Accept: application/json" --compressed "$u" 2>&1
  sum probe-out/$name.bin
}
B="https://msi.nga.mil/api/publications/broadcast-warn"
p latest "$B/latest-warning"
p current "$B/current-warnings"
p inforce "$B/inforce?navArea=P&output=json"
p inforce-all "$B/inforce?output=json"
p all2026 "$B?navArea=P&status=all&msgYear=2026&output=json"
p all2025 "$B?navArea=P&status=all&msgYear=2025&output=json"
p cancel2025 "$B?navArea=P&status=cancelled&msgYear=2025&output=json"
p bydate "$B?navArea=P&issueDateStart=01/01/2026&issueDateEnd=10/19/2026&output=json"
p bydate2 "$B?navArea=P&issueDateStart=2026-01-01&issueDateEnd=2026-10-19&output=json"
p active-all "$B?status=active&output=json"
p media "https://msi.nga.mil/api/media?type=Nav%20Warnings"
p appconfig "https://msi.nga.mil/api/application/config"
p swagger "https://msi.nga.mil/api/v3/api-docs"
p swagger2 "https://msi.nga.mil/api/v2/api-docs"
grep -oE '"/[a-zA-Z/{}-]*broadcast[a-zA-Z/{}-]*"' probe-out/swagger.bin probe-out/swagger2.bin 2>/dev/null | sort -u | head -30
