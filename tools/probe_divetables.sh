#!/usr/bin/env bash
# Downloads USN Diving Manual Rev 7 and dumps text with layout for the air table pages.
set -u
OUT=${1:-divetables-out}; mkdir -p "$OUT"
UA="Mozilla/5.0 (X11; Linux x86_64) OSAP-divetables-probe"
for u in \
 "https://www.navsea.navy.mil/Portals/103/Documents/SUPSALV/Diving/US%20DIVING%20MANUAL_REV7.pdf" \
 "https://www.navsea.navy.mil/Portals/103/Documents/SUPSALV/Diving/US%20DIVING%20MANUAL_REV7.pdf?ver=2017-01-11-102354-393" \
 "https://web.archive.org/web/2024id_/https://www.navsea.navy.mil/Portals/103/Documents/SUPSALV/Diving/US%20DIVING%20MANUAL_REV7.pdf" \
 "https://web.archive.org/web/2020id_/https://www.navsea.navy.mil/Portals/103/Documents/SUPSALV/Diving/US%20DIVING%20MANUAL_REV7.pdf" ; do
  echo "try $u"
  curl -sSL --max-time 300 -A "$UA" -o "$OUT/rev7.pdf" -w "%{http_code} %{size_download}\n" "$u" || true
  if head -c 5 "$OUT/rev7.pdf" 2>/dev/null | grep -q '%PDF'; then echo "got PDF from $u" | tee "$OUT/source.txt"; break; fi
done
head -c 5 "$OUT/rev7.pdf" | grep -q '%PDF' || { echo "no PDF"; exit 1; }
sha256sum "$OUT/rev7.pdf" | tee -a "$OUT/source.txt"
pdfinfo "$OUT/rev7.pdf" | tee "$OUT/info.txt"
pdftotext -layout "$OUT/rev7.pdf" "$OUT/all.txt"
grep -n -E "Table 9-[0-9]+\." "$OUT/all.txt" | head -80 > "$OUT/table_index.txt"
cat "$OUT/table_index.txt"
# split per page so the tables are easy to find
awk -v o="$OUT/pages" 'BEGIN{p=1; system("mkdir -p " o)} {print > (o "/p" sprintf("%04d",p) ".txt")} /\f/{p++}' "$OUT/all.txt"
grep -l -E "Table 9-(6|7|8|9)\b" "$OUT"/pages/*.txt > "$OUT/table_pages.txt"; cat "$OUT/table_pages.txt"
rm -f "$OUT/rev7.pdf.keep"
# print the chapter 9 table pages to the log (artifacts are not reachable from every reader)
for n in $(seq 436 522); do f=$(printf "%s/pages/p%04d.txt" "$OUT" "$n"); [ -f "$f" ] && { echo "=== PAGE $n ==="; cat "$f"; }; done
