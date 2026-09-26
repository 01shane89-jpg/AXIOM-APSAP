import json, sys
cc, path = sys.argv[1:3]
base = json.load(open(f"source/countries/{cc}.json")); new = json.load(open(path))
seen = {(e["src"], e["title"]) for e in base}; srcs = {e["src"] for e in base}
add = [e for e in new if e.get("src") not in srcs and (e.get("src"), e.get("title")) not in seen]
base += add; base.sort(key=lambda e: e["date"])
json.dump(base, open(f"source/countries/{cc}.json", "w"), ensure_ascii=False, indent=1)
print(cc, "added", len(add), "of", len(new), "->", len(base))
