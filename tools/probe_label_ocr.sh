#!/bin/sh
# Test only: reads the probe screenshots with tesseract and reports how many Latin vs Thai/Japanese/Cyrillic letters each shows
for f in probe-out/*.png; do
  t=$(tesseract "$f" - -l eng+tha+jpn+rus 2>/dev/null | tr '\n' ' ')
  lat=$(printf '%s' "$t" | grep -o '[A-Za-z]' | wc -l)
  loc=$(printf '%s' "$t" | grep -oP '[\x{0E00}-\x{0E7F}\x{3040}-\x{30FF}\x{4E00}-\x{9FFF}\x{0400}-\x{04FF}]' | wc -l)
  echo "::notice title=$(basename "$f" .png)::latin=$lat local=$loc $(printf '%s' "$t" | tr -s ' ' | cut -c1-160)"
done
