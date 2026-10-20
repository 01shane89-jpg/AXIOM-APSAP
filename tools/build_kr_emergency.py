"""Fold South Korea's MOHW-designated regional trauma centres and regional emergency medical centres
(source/korea/emergency-2026.json, tools/snapshot_kr_emergency.py) into source/sof/kr.json and data/sof/kr.js.
   python3 tools/build_kr_emergency.py
One record per hospital (id sof:kr:em:<hash>), replacing those from an earlier run; a hospital that is both a trauma centre
and a regional emergency centre is one record. Hand-researched records from Wikipedia within 1 km of a placed record are
dropped: the official record replaces them. What each record says, and from where:
  trauma_level   only for the 17 regional trauma centres (권역외상센터), as MOHW lists them, with the date of the centre's
                 latest designation; trauma_official true, since MOHW is the designating authority (Emergency Medical Service
                 Act, Article 30-2). A regional emergency medical centre is not a trauma designation.
  emergency_24h  true for the regional emergency centres MOHW re-designated for 2026-2029: the type's operating standard
                 has emergency doctors in the emergency room 24 hours a day.
  caps_std       what MOHW's table of emergency institution types requires of every regional emergency centre (CT, general
                 X-ray, an emergency-only ICU and operating theatre). INFERRED from the designation by the plan, never
                 stated for the hospital. The trauma centre standard (the Enforcement Rule's annex 7-2) is not read yet:
                 law.go.kr serves it only through its page script.
                 The 12 newly selected centres get none: MOHW designates some of them on condition that facilities, staff
                 and equipment are completed by 2027-04-30, without naming which.
Files keep the layout tools/apply_evac.py writes."""
import hashlib, json, math

SNAP, SRC, OUT = "source/korea/emergency-2026.json", "source/sof/kr.json", "data/sof/kr.js"
MT = "by OSAP's AI from MOHW's Korean"
REC_STD = {"ed.basic": "kr_rec_ops", "ed.24_7": "kr_rec_ops", "dx.ct": "kr_rec_eq", "dx.xray": "kr_rec_eq", "cc.icu": "kr_rec_fac",
           "surg.or_emergency": "kr_rec_fac"}


def fp(item):
    o = {k: v for k, v in item.items() if k != "fp"}
    return hashlib.sha256(json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def refs(S):
    y = S["sources"]["types"]
    b = {"src": y["url"], "srcname": "MOHW, types of emergency medical institution (press reference 2025-01-03, attachment 1)", "asof": S["asof"],
         "sha256": y["sha256"], "quote_mt": MT}
    R = {"kr_rec_fac": dict(b, quote_basis="regional emergency medical centre, facility standard", quote="응급전용입원실, 응급전용중환자실, 응급전용수술실",
                            quote_en="an emergency-only ward, an emergency-only intensive care unit and an emergency-only operating theatre"),
         "kr_rec_eq": dict(b, quote_basis="regional emergency medical centre, equipment standard", quote="CT 촬영기, 일반 X선 촬영기, 구급차 2대",
                           quote_en="a CT scanner, a general X-ray unit and two ambulances"),
         "kr_rec_ops": dict(b, quote_basis="regional emergency medical centre, operating standard", quote="중환자 진료구역은 응급의학전문의 1명이상, 일반진료구역은 전담 의사 1인 이상 24시간 근무",
                            quote_en="at least one emergency medicine specialist in the critical care zone and one dedicated doctor in the general zone, 24 hours a day")}
    return R


def defaults(S):
    return {"trauma_official": True, "trauma_authority": "MOHW (Ministry of Health and Welfare)", "trauma_jurisdiction": "Republic of Korea",
            "trauma_src": S["sources"]["trauma"]["url"], "trauma_srcname": "MOHW list of designated regional trauma centres (2026-01-14)"}


def main():
    S = json.load(open(SNAP, encoding="utf-8"))
    J = json.load(open(SRC, encoding="utf-8"))
    term = S["sources"]["centres"]["term"]
    rows = {}
    for t in S["trauma_centres"]:
        rows.setdefault(t["osm"] or t["list_name"], {"t": None, "c": None, "x": t})["t"] = t
    for c in S["regional_centres"]:
        r = rows.setdefault(c["osm"] or c["list_name"], {"t": None, "c": None, "x": c})
        r["c"] = c
    new = []
    for key, r in rows.items():
        x, t, c = r["x"], r["t"], r["c"]
        names = [y["list_name"] for y in (t, c) if y]
        notes, std = [], {}
        rec = {"id": "sof:kr:em:" + hashlib.sha256(names[0].encode()).hexdigest()[:12], "g": "kem",
               "name": x["osm_name_en"] or x["osm_name"] or names[-1], "name_local": names[-1], "city": x["region"], "address": ""}
        if t:
            rec["trauma_level"] = "Regional trauma centre (권역외상센터), MOHW-designated"
            notes.append("MOHW regional trauma centre for %s, latest designation %s" % (t["region"], t["designated"]))
        if c:
            if c["new"]:
                notes.append("selected by MOHW as a regional emergency medical centre (권역응급의료센터) for %s to %s, newly; MOHW designates some new centres on condition that facilities, staff and equipment are completed by 2027-04-30" % tuple(term))
            else:
                notes.append("MOHW regional emergency medical centre (권역응급의료센터), re-designated for %s to %s" % tuple(term))
                rec["emergency_24h"] = True
                for k, ref in REC_STD.items():
                    std.setdefault(k, {"ref": ref})
        rec["src"] = S["sources"]["trauma" if t else "centres"]["url"]
        rec["srcname"] = "MOHW list of designated regional trauma centres (2026-01-14)" if t else "MOHW list of regional emergency medical centres 2026-2029 (2026-07-15)"
        rec.update({"notes": "; ".join(notes), "lat": x["lat"], "lon": x["lon"], "prec": "exact" if x["lat"] is not None else "approx",
                    "coord_basis": ("OpenStreetMap " + x["osm"]) if x["osm"] else "not placed: no OpenStreetMap hospital object found for it"})
        if std:
            rec["caps_std"] = std
        rec["fp"] = fp(rec)
        new.append(rec)
    placed = [r for r in new if r["lat"] is not None]

    def km(a, b):
        p = math.pi / 180
        return 6371 * math.hypot((b[1] - a[1]) * p * math.cos((a[0] + b[0]) * p / 2), (b[0] - a[0]) * p)
    keep = [h for h in J["hospitals"] if not h["id"].startswith("sof:kr:em:") and not (
        "wikipedia" in (h.get("src") or "") and h.get("lat") is not None and any(km((h["lat"], h["lon"]), (r["lat"], r["lon"])) < 1 for r in placed))]
    J["hospitals"] = keep + new
    J["kem_asof"] = S["asof"]
    J["cap_refs"] = dict(J.get("cap_refs") or {}, **refs(S))
    J["hosp_defaults"] = dict(J.get("hosp_defaults") or {}, kem=defaults(S))
    open(SRC, "w", encoding="utf-8").write(json.dumps(J, indent=1, ensure_ascii=False))
    body = json.dumps(J, separators=(",", ":")).replace("</", "<\\/")
    open(OUT, "w").write("window.ASAP_SOF=window.ASAP_SOF||{};window.ASAP_SOF[%s]=%s;" % (json.dumps("kr"), body))
    print("kr: %d hand-researched + %d designated hospitals (%d placed, %d trauma centres)" % (
        len(keep), len(new), len(placed), sum(1 for r in new if "trauma_level" in r)))


if __name__ == "__main__":
    main()
