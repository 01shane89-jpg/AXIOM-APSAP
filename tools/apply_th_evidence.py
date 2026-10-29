"""Merge hand-read hospital website evidence (source/hospitals/th/*.json, schema osap-hospital-evidence/1) into OSAP's
sourced list for Thailand (source/sof/th.json) and rebuild data/sof/th.js, which the medical plan reads.

Each capability keeps its page URL, the page's SHA-256 as fetched, the verbatim quote and the date read; the record's
fingerprint (fp) is recomputed. A new record ("new") is added once by id. Run from the repo root:
    python3 tools/apply_th_evidence.py
"""
import glob, hashlib, json

SRC, OUT = "source/sof/th.json", "data/sof/th.js"


def fp(item):
    o = {k: v for k, v in item.items() if k != "fp"}
    return hashlib.sha256(json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def main():
    J = json.load(open(SRC, encoding="utf-8"))
    by = {h["id"]: h for h in J["hospitals"]}
    n = 0
    for f in sorted(glob.glob("source/hospitals/th/*.json")):
        E = json.load(open(f, encoding="utf-8"))
        if E.get("schema") != "osap-hospital-evidence/1":
            continue
        for e in E["hospitals"]:
            if "new" in e:
                r = by.get(e["new"]["id"])
                if r is None:
                    r = dict({"emergency_24h": None, "trauma_level": None}, **e["new"])
                    first = next(iter(e["caps"].values()))
                    r["src"], r["srcname"] = first["src"], e["srcname"]
                    J["hospitals"].append(r)
                    by[r["id"]] = r
            else:
                r = by[e["sof"]]
            caps = r.setdefault("caps", {})
            for k, c in e["caps"].items():
                caps[k] = dict(c, srcname=e["srcname"], asof=E["read_at"], evidence_file=f)
                n += 1
            if e.get("accreditation"):
                r["accreditation"] = dict(e["accreditation"], srcname=e["srcname"], asof=E["read_at"])
            r["fp"] = fp(r)
    open(SRC, "w", encoding="utf-8").write(json.dumps(J, indent=1, ensure_ascii=False))
    body = json.dumps(J, separators=(",", ":")).replace("</", "<\\/")
    open(OUT, "w").write("window.ASAP_SOF=window.ASAP_SOF||{};window.ASAP_SOF[%s]=%s;" % (json.dumps("th"), body))
    print("th: %d capability entries applied, %d hospitals" % (n, len(J["hospitals"])))


if __name__ == "__main__":
    main()
