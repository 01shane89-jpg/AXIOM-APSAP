#!/usr/bin/env python3
"""Measured mobile coverage for the Comms tab: where phones have actually run speed tests on a mobile network.

Source: Ookla Open Data, "Speedtest by Ookla Global Fixed and Mobile Network Performance Maps", mobile tiles
(s3://ookla-open-data, public HTTPS, no account or key). Licence CC BY-NC-SA 4.0: non-commercial (nc), credit Ookla.
Each source row is a zoom-16 web-mercator tile (about 600 m) with the average download speed of the tests run in it
during one quarter. This script folds the given quarters into zoom-14 cells (about 2.4 km at the equator) keeping the
best average download seen in any of the cell's tiles, and writes them in shards of one zoom-7 tile each:

  data/comms/cov/index.json     {"v":1, "periods":[...], "built":..., "z":14, "shard":7, "bands":[...], "n":{"<z7 quadkey>": cells}}
  data/comms/cov/<z7 quadkey>.json   {"q": "<z7 quadkey>", "d": [first code, difference to the next, ...]}
                                     code = ((dy * 128) + dx) * 4 + band, codes sorted, stored as differences (half the size)

dx, dy are the zoom-14 cell's column and row inside the zoom-7 tile (0..127). band: 0 under 2 Mbps, 1 2-10, 2 10-50, 3 over 50.
A cell with no tests says nothing: nobody ran Speedtest there, which is common in the countryside even where there is service.

Usage: python3 tools/build_comms_coverage.py OUT_DIR PERIOD=FILE.parquet [PERIOD=FILE.parquet ...]
       e.g. python3 tools/build_comms_coverage.py data/comms/cov 2026-Q1=q1.parquet 2026-Q2=q2.parquet
Needs pyarrow.
"""
import json
import os
import sys
from datetime import datetime, timezone

import pyarrow.parquet as pq

BANDS = [2000, 10000, 50000]  # kbps upper limits of bands 0, 1, 2


def band(kbps):
    for i, lim in enumerate(BANDS):
        if kbps < lim:
            return i
    return 3


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    out = sys.argv[1]
    periods, best = [], {}
    for arg in sys.argv[2:]:
        period, path = arg.split("=", 1)
        periods.append(period)
        pf = pq.ParquetFile(path)
        for rg in range(pf.num_row_groups):
            t = pf.read_row_group(rg, columns=["quadkey", "avg_d_kbps"])
            for qk, kbps in zip(t.column("quadkey").to_pylist(), t.column("avg_d_kbps").to_pylist()):
                if not qk or len(qk) < 14 or kbps is None:
                    continue
                k = qk[:14]
                b = band(kbps)
                if best.get(k, -1) < b:
                    best[k] = b
    shards = {}
    for k, b in best.items():
        dx = dy = 0
        for ch in k[7:]:
            d = ord(ch) - 48
            dx = dx * 2 + (d & 1)
            dy = dy * 2 + (d >> 1)
        shards.setdefault(k[:7], []).append((dy * 128 + dx) * 4 + b)
    os.makedirs(out, exist_ok=True)
    for f in os.listdir(out):
        if f.endswith(".json"):
            os.remove(os.path.join(out, f))
    for q, codes in shards.items():
        codes.sort()
        deltas = [codes[0]] + [codes[i] - codes[i - 1] for i in range(1, len(codes))]
        with open(os.path.join(out, q + ".json"), "w") as fh:
            json.dump({"q": q, "d": deltas}, fh, separators=(",", ":"))
    index = {
        "v": 1,
        "source": "Speedtest by Ookla Global Fixed and Mobile Network Performance Maps (mobile tiles)",
        "licence": "CC BY-NC-SA 4.0",
        "nc": True,
        "url": "https://github.com/teamookla/ookla-open-data",
        "periods": periods,
        "built": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "z": 14,
        "shard": 7,
        "bands": ["under 2 Mbps", "2 to 10 Mbps", "10 to 50 Mbps", "over 50 Mbps"],
        "n": {q: len(c) for q, c in sorted(shards.items())},
    }
    with open(os.path.join(out, "index.json"), "w") as fh:
        json.dump(index, fh, separators=(",", ":"))
    print(f"{len(best)} cells in {len(shards)} shards from {', '.join(periods)}")


if __name__ == "__main__":
    main()
