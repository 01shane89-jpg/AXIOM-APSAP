"""Fold the evacuation points patch from tools/build_evac.mjs into source/sof/<cc>.json and data/sof/<cc>.js.
   python3 tools/apply_evac.py evac-patch.json
Existing posts get only the contact fields the patch sets (web, phone, phone_after_hours, phone_src, phone_srcname, phone_asof);
new posts are appended; "crossings" is replaced whole. Changed and new items get a fresh fingerprint: SHA-256 of the item's
JSON with sorted keys, no spaces, fp removed (source/sof/SCHEMA.txt). Files keep the layout the research thread wrote:
source indent 1 and UTF-8, the page file compact and ASCII (tools/split_page.py)."""
import hashlib, json, os, sys

SRC, OUT = "source/sof", "data/sof"
CONTACT = ("web", "phone", "phone_after_hours", "phone_src", "phone_srcname", "phone_asof")


def fp(item):
    o = {k: v for k, v in item.items() if k != "fp"}
    return hashlib.sha256(json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def apply(patch, asof):
    n = {"set": 0, "add": 0, "xing": 0, "files": 0}
    for cc, P in sorted(patch.items()):
        path = os.path.join(SRC, cc + ".json")
        if not os.path.exists(path):
            continue
        S = json.load(open(path, encoding="utf-8"))
        strip = lambda d: json.dumps({k: v for k, v in d.items() if k not in ("evac_asof", "evac_sources")}, sort_keys=True)
        before = strip(S)
        posts = S.setdefault("posts", [])
        ids = {p.get("id"): p for p in posts}
        for pid, fields in P.get("set", {}).items():
            p = ids.get(pid)
            if not p:
                continue
            for k in CONTACT:
                if fields.get(k):
                    p[k] = fields[k]
            p["fp"] = fp(p)
            n["set"] += 1
        for p in P.get("add", []):
            if p.get("id") in ids:
                continue
            p["fp"] = fp(p)
            posts.append(p)
            ids[p["id"]] = p
            n["add"] += 1
        xs = []
        for x in P.get("crossings", []):
            x["fp"] = fp(x)
            xs.append(x)
        S["crossings"] = xs
        n["xing"] += len(xs)
        S["evac_sources"] = {
            "posts": "Researched list, filled from OpenStreetMap office=diplomatic country=US (ODbL); phone numbers as published on each post's own website, else as tagged in OpenStreetMap",
            "crossings": "OpenStreetMap barrier=border_control (ODbL), one point per crossing",
        }
        if strip(S) == before and "evac_asof" in S:
            continue
        S["evac_asof"] = asof
        open(path, "w", encoding="utf-8").write(json.dumps(S, indent=1, ensure_ascii=False))
        body = json.dumps(S, separators=(",", ":")).replace("</", "<\\/")
        open(os.path.join(OUT, cc + ".js"), "w").write("window.ASAP_SOF=window.ASAP_SOF||{};window.ASAP_SOF[%s]=%s;" % (json.dumps(cc), body))
        n["files"] += 1
    return n


if __name__ == "__main__":
    j = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "evac-patch.json", encoding="utf-8"))
    print(apply(j["patch"], j["asof"]))
