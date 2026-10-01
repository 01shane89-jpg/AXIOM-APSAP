#!/usr/bin/env bash
# Test only: prints the regional call-centre block of the archived TRICARE.mil overseas contacts page (the live page
# answers a bot check), so the hospital assessment can quote it with a source.
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
text() { curl -sL -m 60 -A "$UA" "$1" | sed -e 's/<script[^>]*>.*<\/script>//g' -e 's/<[^>]*>/\n/g' | sed -e 's/&nbsp;/ /g' -e 's/&amp;/\&/g' | tr -s ' \t' ' ' | grep -v '^\s*$'; }
for u in "https://web.archive.org/web/20260423013428id_/https://www.tricare.mil/ContactUs/CallUs/OverseasResources" \
         "https://web.archive.org/web/2025id_/https://tricare.mil/ContactUs/CallUs/OverseasResources"; do
  echo "################ $u"; t=$(text "$u"); echo "lines: $(echo "$t" | wc -l)"
  n=$(echo "$t" | grep -n "Regional Call Center" | head -1 | cut -d: -f1); [ -n "$n" ] && echo "$t" | sed -n "$((n-4)),$((n+50))p"
done
