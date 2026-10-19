#!/usr/bin/env bash
# Test only: which NGA MSI request returns the navigational warnings in force now. Prints count, newest year and issue date.
mkdir -p probe-out
UA="AXIOM-OSAP/1.0 (+https://01shane89-jpg.github.io/AXIOM-APSAP/)"
sum() {
  python3 - "$1" <<'PY'
import json,sys,re
try: j=json.load(open(sys.argv[1]))
except Exception as e: print("  not json:", open(sys.argv[1],'rb').read(300)); raise SystemExit
L=None
if isinstance(j,dict):
    print("  keys", list(j.keys())[:10])
    for k,v in j.items():
        if isinstance(v,list): L=v; break
elif isinstance(j,list): L=j
if L is None: print("  ", json.dumps(j)[:400]); raise SystemExit
ys=[x.get('msgYear') or x.get('year') for x in L if isinstance(x,dict)]
ys=[y for y in ys if y]
print("  n",len(L),"years",sorted(set(ys))[-4:] if ys else None)
if L: print("  first", json.dumps(L[0])[:300])
PY
}
p() {
  local name="$1" u="$2"
  echo "=== $name $u"
  curl -sS -m 60 -L -o probe-out/$name.bin -w '  code %{http_code} size %{size_download} type %{content_type}\n' -A "$UA" -H "Accept: application/json" --compressed "$u" 2>&1
  sum probe-out/$name.bin
}
B="https://msi.nga.mil/api/publications/broadcast-warn"
p a-statusA "$B?navArea=P&status=A&output=json"
p a-nostatus "$B?navArea=P&output=json"
p a-active "$B?navArea=P&status=active&output=json"
p a-all-areas "$B?status=A&output=json"
p a-2026 "$B?navArea=P&msgYear=2026&output=json"
p a-2025 "$B?navArea=P&msgYear=2025&output=json"
p a-sort "$B?navArea=P&status=A&output=json&sort=issueDate&order=desc"
p a-includeAll "$B?navArea=P&status=A&output=json&includeArchived=false&limit=5000"
p b-navwarn "https://msi.nga.mil/api/publications/navwarnings?navArea=P&output=json"
p b-broadcast "https://msi.nga.mil/api/publications/broadcast-warnings?navArea=P&output=json"
p c-query "https://msi.nga.mil/api/publications/query?type=broadcast-warn&navArea=P&output=json"
# what the site's own app calls
curl -sS -m 60 -L -A "$UA" -o probe-out/site.html https://msi.nga.mil/NavWarnings; echo "site $(wc -c < probe-out/site.html)"
grep -oE '(src|href)="[^"]+\.js"' probe-out/site.html | head -20
for js in $(grep -oE 'src="[^"]+\.js"' probe-out/site.html | sed 's/src="//; s/"$//' | head -12); do
  case "$js" in http*) u="$js";; /*) u="https://msi.nga.mil$js";; *) u="https://msi.nga.mil/$js";; esac
  curl -sS -m 60 -L -A "$UA" "$u" -o probe-out/app.js
  echo "--- $u $(wc -c < probe-out/app.js)"
  grep -oE '"[^"]{0,40}(api/publications|broadcast-warn|navwarn|NavWarn)[^"]{0,120}"' probe-out/app.js | sort -u | head -40
done
