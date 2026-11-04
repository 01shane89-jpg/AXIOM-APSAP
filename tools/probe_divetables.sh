#!/usr/bin/env bash
# Re-checks data/dive/usn-rev7-air.json against the US Navy Diving Manual Rev 7 itself: downloads the public manual,
# confirms it is the same file (SHA-256), turns its pages to text and re-reads Tables 9-6 to 9-9 with
# tools/divetables_extract.py, then compares cell by cell. Exit 1 on any difference.
set -u
OUT=${1:-divetables-out}; mkdir -p "$OUT/pages"
DATA=data/dive/usn-rev7-air.json
WANT=$(python3 -c "import json;print(json.load(open('$DATA'))['source']['sha256'])")
UA="Mozilla/5.0 (X11; Linux x86_64) OSAP-divetables-check"
for u in \
 "https://www.navsea.navy.mil/Portals/103/Documents/SUPSALV/Diving/US%20DIVING%20MANUAL_REV7.pdf" \
 "https://web.archive.org/web/2024id_/https://www.navsea.navy.mil/Portals/103/Documents/SUPSALV/Diving/US%20DIVING%20MANUAL_REV7.pdf" ; do
  echo "try $u"
  curl -sSL --max-time 300 -A "$UA" -o "$OUT/rev7.pdf" -w "%{http_code} %{size_download}\n" "$u" || true
  GOT=$(sha256sum "$OUT/rev7.pdf" 2>/dev/null | cut -d' ' -f1)
  if [ "$GOT" = "$WANT" ]; then echo "same manual as the data file ($GOT) from $u"; break; fi
  echo "not the same file ($GOT)"
done
[ "${GOT:-}" = "$WANT" ] || { echo "Could not get the manual the tables were read from"; exit 1; }
pdftotext -layout "$OUT/rev7.pdf" "$OUT/all.txt"
awk -v o="$OUT/pages" 'BEGIN{p=1} {print > (o "/p" sprintf("%04d",p) ".txt")} /\f/{close(o "/p" sprintf("%04d",p) ".txt"); p++}' "$OUT/all.txt"
echo "=== front pages ==="; for n in 1 2 3; do cat "$OUT/pages/p000$n.txt" | head -60; done
python3 -I tools/divetables_extract.py "$OUT/pages" --check "$DATA"
