#!/usr/bin/env bash
# Test only: reads the public International SOS assistance-centre page and TRICARE Overseas contact pages, and prints the
# lines that carry phone numbers, so the Medical plan can quote them with their source. Writes nothing.
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
text() { curl -sL -m 40 -A "$UA" "$1" | sed -e 's/<script[^>]*>.*<\/script>//g' -e 's/<[^>]*>/\n/g' | sed -e 's/&nbsp;/ /g' -e 's/&amp;/\&/g' | tr -s ' \t' ' ' | grep -v '^\s*$'; }
for u in \
  "https://www.internationalsos.com/assistance-centres" \
  "https://tricare.mil/ContactUs/CallUs/OverseasResources" \
  "https://www.tricare-overseas.com/contact-us/asia-pacific/country?tricareregion=pac&country=thailand" \
  "https://www.tricare-overseas.com/beneficiaries/resources/provider-search"; do
  echo "################ $u"
  t=$(text "$u")
  echo "lines: $(echo "$t" | wc -l)"
  echo "$t" | grep -n -i -E '\+?[0-9][0-9 ()./-]{7,}[0-9]|assistance cent|call cent|bangkok|singapore|sydney|london|philadelphia|toll|collect|network|provider' | head -150
done
