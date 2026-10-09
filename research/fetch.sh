#!/bin/bash
# scratch research fetcher: never merge this branch
set -u
mkdir -p research/out
while read -r id url; do
  [ -z "$id" ] && continue
  [ -s "research/out/$id.txt" ] && continue
  ua="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
  code=$(curl -sSL -m 90 -A "$ua" -o "/tmp/$id.bin" -w "%{http_code}" "$url" 2>/tmp/$id.err)
  t=$(file -b --mime-type "/tmp/$id.bin" 2>/dev/null)
  sha256sum "/tmp/$id.bin" | sed "s#/tmp/##" >> research/out/_sha.txt
  echo "$id $code $t $(stat -c %s /tmp/$id.bin 2>/dev/null)" >> research/out/_log.txt
  if [ "$t" = "application/pdf" ]; then pdftotext -layout "/tmp/$id.bin" "research/out/$id.txt"; [ $(stat -c %s /tmp/$id.bin) -lt 20000000 ] && cp "/tmp/$id.bin" "research/out/$id.pdf"
  elif [ "$t" = "text/html" ]; then python3 research/h2t.py "/tmp/$id.bin" > "research/out/$id.txt"; grep -oiE 'href="[^"]+"[^>]*>[^<]{0,120}' "/tmp/$id.bin" > "research/out/$id.links" || true
  else python3 research/h2t.py "/tmp/$id.bin" > "research/out/$id.txt"; [ $(stat -c %s /tmp/$id.bin) -lt 20000000 ] && cp "/tmp/$id.bin" "research/out/$id.bin"; fi
  echo "SOURCE $url" | cat - "research/out/$id.txt" > /tmp/x && mv /tmp/x "research/out/$id.txt"
done < research/urls.txt
