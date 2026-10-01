#!/usr/bin/env bash
# Test only: reads archived copies of the public TRICARE Overseas contact pages (the live pages answer a bot check) and
# prints the lines with phone numbers, so the hospital assessment can quote the Asia-Pacific call centre with a source.
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
text() { curl -sL -m 60 -A "$UA" "$1" | sed -e 's/<script[^>]*>.*<\/script>//g' -e 's/<[^>]*>/\n/g' | sed -e 's/&nbsp;/ /g' -e 's/&amp;/\&/g' | tr -s ' \t' ' ' | grep -v '^\s*$'; }
for u in \
  "https://web.archive.org/web/2026id_/https://tricare.mil/ContactUs/CallUs/OverseasResources" \
  "https://web.archive.org/web/2025id_/https://tricare.mil/ContactUs/CallUs/OverseasResources" \
  "https://web.archive.org/web/2026id_/https://www.tricare-overseas.com/contact-us" \
  "https://web.archive.org/web/2025id_/https://www.tricare-overseas.com/beneficiaries/contact-us" \
  "https://archive.org/wayback/available?url=tricare.mil/ContactUs/CallUs/OverseasResources" \
  "https://archive.org/wayback/available?url=tricare-overseas.com/contact-us"; do
  echo "################ $u"; t=$(text "$u"); echo "lines: $(echo "$t" | wc -l)"
  echo "$t" | grep -n -i -E '\+?[0-9][0-9 ()./-]{7,}[0-9]|asia|pacific|singapore|sydney|call cent|toll|collect|timestamp' | head -60
done
