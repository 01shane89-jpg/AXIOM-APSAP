#!/bin/sh
# Test only: reads the probe screenshots with tesseract (English) and reports the real-looking English words each one shows
for src in $(ls probe-out/*.png | sed 's#probe-out/##; s#-[a-z]*-z[0-9]*\.png##' | sort -u); do
  line=""
  for f in probe-out/$src-*.png; do
    w=$(tesseract "$f" - -l eng 2>/dev/null | grep -oE '\b[A-Z][a-z]{3,}\b' | sort -u | head -12 | tr '\n' ' ')
    line="$line ## $(basename "$f" .png | sed "s/^$src-//"): $w"
  done
  echo "::notice title=ocr $src::$line"
done
