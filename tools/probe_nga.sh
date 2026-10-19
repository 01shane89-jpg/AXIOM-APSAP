#!/usr/bin/env bash
# Test only: NGA's broadcast-warn database stops at 2024-05-10 (its own /latest-warning says so), while the Daily Memorandum
# text files listed by /api/media?type=Nav Warnings are updated daily. Fetch each memorandum and keep it for reading.
mkdir -p probe-out
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
curl -sS -m 60 -A "$UA" -o probe-out/media.json "https://msi.nga.mil/api/media?type=Nav%20Warnings"
cat probe-out/media.json; echo
for k in $(python3 -c "import json;[print(m['s3Key']) for m in json.load(open('probe-out/media.json'))]"); do
  f=$(basename "$k")
  for t in view download; do
    curl -sS -m 90 -L -A "$UA" -o "probe-out/$t-$f" -w "$t $f code %{http_code} size %{size_download} type %{content_type}\n" "https://msi.nga.mil/api/publications/download?key=$k&type=$t"
  done
  head -c 1500 "probe-out/view-$f"; echo; echo ...
  grep -oE "(HYDROPAC|HYDROLANT|HYDROARC|NAVAREA [IVX]+) [0-9]+/[0-9]{2}" "probe-out/view-$f" | awk -F/ '{print $2}' | sort | uniq -c
done
