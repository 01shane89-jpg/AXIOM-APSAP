# Reads a UCDP GED release zip (gedNNN-csv.zip) and writes one JSON array per event to stdout, only the columns the
# History of violence job needs (tools/refresh_conflict_history.mjs), so Node never holds the whole CSV. Standard library only.
# Usage: python3 tools/ged_extract.py <zip>
import csv, io, json, sys, zipfile

COLS = ["id", "date_start", "date_end", "latitude", "longitude", "type_of_violence", "best", "low", "high", "deaths_civilians",
        "side_a", "side_b", "conflict_name", "dyad_name", "where_description", "adm_1", "where_prec", "country"]
csv.field_size_limit(1 << 24)
with zipfile.ZipFile(sys.argv[1]) as z:
    names = [n for n in z.namelist() if n.lower().endswith(".csv")]
    if not names:
        sys.exit("no CSV in " + sys.argv[1] + ": " + ", ".join(z.namelist()[:10]))
    name = max(names, key=lambda n: z.getinfo(n).file_size)
    print("reading", name, z.getinfo(name).file_size, "bytes", file=sys.stderr)
    with z.open(name) as raw:
        r = csv.reader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline=""))
        head = [h.strip() for h in next(r)]
        miss = [c for c in COLS[:12] if c not in head]
        if miss:
            sys.exit("GED columns missing: " + ", ".join(miss) + " (have " + ", ".join(head[:50]) + ")")
        ix = [head.index(c) if c in head else -1 for c in COLS]
        out = sys.stdout
        out.write(json.dumps(COLS) + "\n")
        n = 0
        for row in r:
            if len(row) < len(head) - 2:
                continue
            out.write(json.dumps([row[i] if i >= 0 and i < len(row) else "" for i in ix], ensure_ascii=False) + "\n")
            n += 1
        print("rows", n, file=sys.stderr)
