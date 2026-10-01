#!/usr/bin/env bash
# Test only: reads public TRICARE Overseas contact pages and contact cards, and prints the lines that carry phone numbers,
# so the Medical plan can quote the Asia-Pacific call centre with its source. Writes nothing to the repo.
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
command -v pdftotext >/dev/null || sudo apt-get install -y -qq poppler-utils >/dev/null
pat='\+?[0-9][0-9 ()./-]{7,}[0-9]|asia|pacific|singapore|sydney|call cent|toll|collect'
text() { curl -sL -m 40 -A "$UA" "$1" | sed -e 's/<script[^>]*>.*<\/script>//g' -e 's/<[^>]*>/\n/g' | sed -e 's/&nbsp;/ /g' -e 's/&amp;/\&/g' | tr -s ' \t' ' ' | grep -v '^\s*$'; }
pdf() { curl -sL -m 40 -A "$UA" -o /tmp/p.pdf "$1"; file /tmp/p.pdf; pdftotext -layout /tmp/p.pdf - 2>&1; }
for u in \
  "https://www.tricare-overseas.com/contact-us/country?tricareRegion=pac&country=singapore" \
  "https://www.tricare-overseas.com/contact-us/country?tricareRegion=pac&country=thailand" \
  "https://www.tricare-overseas.com/beneficiaries/tco-media/documents/contact-us-by-collect-call-bene-info"; do
  echo "################ $u"; t=$(text "$u"); echo "lines: $(echo "$t" | wc -l)"; echo "$t" | grep -n -i -E "$pat" | head -80
done
for u in \
  "https://newsroom.tricare.mil/Portals/154/Contact_Card.pdf" \
  "https://tricare.mil/-/media/Files/TRICARE/Publications/Misc/TRICARE_Contact_Wallet_Card.pdf" \
  "https://tricare-overseas.com/cms/delivery/media/MCU7NKC7BEJVFBFJYH34NANECGBA" \
  "https://www.tricare-overseas.com/cms/delivery/media/MCDPJMYBXSBRCKBJLL3ZMVNFZQMM"; do
  echo "################ PDF $u"; t=$(pdf "$u"); echo "lines: $(echo "$t" | wc -l)"; echo "$t" | grep -n -i -E "$pat" | head -80
done
