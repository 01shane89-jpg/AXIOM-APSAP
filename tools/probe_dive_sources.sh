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
for u in https://dan.org/contact-us/ https://dan.org/about-us/contact-us/ https://dan.org/health-medicine/health-resources/emergency/ https://dan.org/dan-emergency-hotline/ \
  https://world.dan.org/ https://world.dan.org/contact/ https://world.dan.org/emergency/ https://danap.org/ https://www.danap.org/emergency \
  https://www.daneurope.org/en/emergency-hotline https://www.dansa.org/emergency https://www.dansa.org/contact-us https://www.danjapan.gr.jp/ ; do
  echo "--- $u"
  rm -f /tmp/dan.html
  curl -sSL --max-time 25 -A "$UA" "$u" -o /tmp/dan.html -w "%{http_code} %{url_effective}\n" || true
  [ -s /tmp/dan.html ] || continue
  sed -e 's/<[^>]*>/ /g' /tmp/dan.html | tr -s ' \t' ' ' | grep -o -i -E ".{0,90}(\+ ?[0-9]{1,3}[ (.-]{0,2}[0-9][0-9 ().-]{6,16}[0-9]|919[ .-]?684[ .-]?[0-9]{4}|0800[ -]?[0-9 ]{6,9}).{0,40}" | sort -u | head -20
done
