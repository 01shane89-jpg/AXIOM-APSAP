#!/usr/bin/env bash
# Test only, prints to the log: (1) what the USN Diving Manual Rev 7 says about altitude when moving a diver or a
# decompression casualty by air and about diving at altitude; (2) the emergency numbers DAN publishes on its own pages.
set -u
T=${1:-divetables-out}/all.txt
echo "=== manual: altitude / aircraft lines ==="
grep -n -i -E "1,000 feet|1000 feet|cabin (altitude|pressure)|aeromedical|air evacuation|evacuated by air|transport(ed)? by air|altitude diving|above 300 feet|300 feet" "$T" | cut -c1-220 | head -80
for n in $(grep -n -i -E "cabin altitude|1,000 feet" "$T" | cut -d: -f1 | head -12); do echo "--- context line $n"; sed -n "$((n-6)),$((n+6))p" "$T"; done
echo "=== DAN pages ==="
UA="Mozilla/5.0 (X11; Linux x86_64) OSAP-dive-sources-check"
for u in https://dan.org/health-medicine/emergency-hotline/ https://dan.org/ https://www.daneurope.org/en/ https://www.danap.org/ https://www.danasiapacific.org/ https://www.dansa.org/ https://www.danjapan.gr.jp/ https://world.dan.org/ ; do
  echo "--- $u"
  curl -sSL --max-time 40 -A "$UA" "$u" -o /tmp/dan.html -w "%{http_code} %{url_effective}\n" || true
  sed -e 's/<[^>]*>/ /g' /tmp/dan.html 2>/dev/null | tr -s ' \t' ' ' | grep -i -E "(\+|00)[0-9][0-9 ()./-]{7,}|hotline|emergenc" | grep -E "[0-9]{3}" | cut -c1-200 | sort -u | head -15
done
