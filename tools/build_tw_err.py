"""Fold Taiwan's MOHW emergency responsibility hospitals (source/taiwan/err-2026.json, tools/snapshot_tw_err.py) into
source/sof/tw.json and data/sof/tw.js as hospital records the medical plan reads.
   python3 tools/build_tw_err.py
Each listed hospital becomes one record (id sof:tw:err:<hash>), replacing those from an earlier run. The hand-researched
records from Wikipedia that a listed hospital stands within 1 km of are dropped: the official record replaces them.
What each record says, and from where:
  trauma_level   only where the list grades the hospital's emergency trauma chapter (緊急外傷) at the severe level: every
                 severe-level hospital (重度級急救責任醫院), and moderate-level ones the list says hold severe-level emergency
                 trauma capability. trauma_official true: MOHW grades hospitals under Article 38 of the Emergency Medical
                 Services Act. Moderate trauma capability is a trauma team, not a trauma centre, so it is no designation.
  emergency_24h  true where the emergency chapter (急診) is graded: the criteria (1.1.2) staff the emergency room 24 hours.
  caps_std       what the 2024 grading criteria (113年度評定基準) require of every hospital graded at that level in that chapter,
                 quoted by item number. The plan reads them as INFERRED from the grading, never as stated for the hospital.
  notes          the grade as the list prints it, its validity, and the chapters at each level.
Files keep the layout tools/apply_evac.py writes."""
import hashlib, json, math

SNAP, SRC, OUT = "source/taiwan/err-2026.json", "source/sof/tw.json", "data/sof/tw.js"
MT = "by OSAP's AI from MOHW's Chinese"
LEVEL_EN = {"重度級": "Severe-level", "中度級": "Moderate-level", "中度級*": "Moderate-level", "一般級": "General-level"}
CH_EN = {"急診": "emergency care", "急性腦中風": "acute stroke", "急性冠心症": "acute coronary syndrome", "緊急外傷": "emergency trauma",
         "高危險妊娠及新生兒醫療": "high-risk pregnancy and neonatal care", "加護病房": "intensive care"}
# capability -> criteria item, per chapter and grade (重度 severe, 中度 moderate); the texts are in refs()
STD = {
    ("急診", "重度"): {"ed.basic": "ed24", "ed.24_7": "ed24", "dx.xray": "edrad_s", "surg.general": "edcons_s", "surg.ortho": "edcons_s",
                    "surg.anaesthesia": "edcons_s", "surg.neuro": "edcons_s", "spec.obstetric": "edcons_s"},
    ("急診", "中度"): {"ed.basic": "ed24", "ed.24_7": "ed24", "dx.xray": "edrad_m", "surg.general": "edcons_m", "surg.ortho": "edcons_m"},
    ("緊急外傷", "重度"): {"trauma.team": "tdept_s", "surg.trauma": "tdept_s", "surg.thoracic": "tcons_s", "surg.plastic": "tcons_s",
                      "surg.neuro": "tcons_s", "surg.ortho": "tcons_s", "surg.general": "tcons_s", "surg.anaesthesia": "tcons_s",
                      "surg.or_emergency": "tnight_s", "dx.ir": "tnight_s"},
    ("緊急外傷", "中度"): {"trauma.team": "tteam_m", "surg.ortho": "tcons_m", "surg.general": "tcons_m", "surg.anaesthesia": "tcons_m"},
    ("急性腦中風", "重度"): {"surg.neuro": "neuro_s", "spec.stroke": "stroke_s"},
    ("加護病房", "重度"): {"cc.icu": "icu_s"},
    ("加護病房", "中度"): {"cc.icu": "icu_m"}}


def fp(item):
    o = {k: v for k, v in item.items() if k != "fp"}
    return hashlib.sha256(json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def refs(S):
    """the criteria texts once per country (cap_refs); each record's caps_std points at one by "ref" """
    s = S["sources"]["standard"]
    b = {"src": s["url"], "srcname": "MOHW hospital emergency capability grading criteria, 2024 (113年度醫院緊急醫療能力分級評定基準)",
         "asof": S["asof"], "sha256": s["sha256"], "quote_mt": MT}
    T = {
        "ed24": ("1.1.2", "人力配置，急診部門應配置足夠之醫師及護理人員，24 小時在急診室值班",
                 "the emergency department has enough doctors and nurses on duty in the emergency room 24 hours a day"),
        "edrad_s": ("1.1.3, severe", "訂有合宜之急診醫事人員輪班制度：有藥師、醫事檢驗師、醫事放射師(士)、呼吸治療師(試)等醫事人員輪班",
                    "pharmacists, laboratory technologists, radiographers and respiratory therapists are rostered for the emergency department"),
        "edrad_m": ("1.1.3, moderate", "訂有合宜之急診醫事人員輪班制度：有藥師、醫事檢驗師、醫事放射師(士)等醫事人員輪班",
                    "pharmacists, laboratory technologists and radiographers are rostered for the emergency department"),
        "edcons_s": ("1.2.1, severe", "外科、內科、骨科、兒科、麻醉科、神經科、神經外科、婦產科需 24 小時有專科醫師於 30 分鐘內提供緊急照會服務",
                     "surgery, internal medicine, orthopaedics, paediatrics, anaesthesia, neurology, neurosurgery and obstetrics specialists answer emergency consults within 30 minutes, 24 hours a day"),
        "edcons_m": ("1.2.1, moderate", "需 24 小時有外科、內科、骨科專科醫師於 60 分鐘內提供緊急照會服務",
                     "surgery, internal medicine and orthopaedics specialists answer emergency consults within 60 minutes, 24 hours a day"),
        "tdept_s": ("4.1.1, severe", "設有獨立之外傷部門，且有 3 名以上之專責醫師編制。於緊急醫療資源不足地區之醫院，得以外傷小組代替。外傷部門之主管應為專責外傷科醫師",
                    "a separate trauma department with three or more dedicated doctors, headed by a dedicated trauma surgeon (in areas short of emergency resources, a trauma team instead)"),
        "tteam_m": ("4.1.1, moderate", "設有外傷小組。每日需有外科系醫師擔任外傷小組值班",
                    "a trauma team, with a surgical doctor on trauma team duty every day"),
        "tcons_s": ("4.2.3, severe", "應有心臟外科、胸腔外科、神經外科、骨科、整形外科、泌尿科、一般外科、婦產科、放射科、麻醉科等專科醫師之緊急會診機制",
                    "emergency consults from cardiac, thoracic, neuro, orthopaedic, plastic, urological and general surgeons, obstetrics, radiology and anaesthesia"),
        "tcons_m": ("4.2.3, moderate", "應有骨科、一般外科、麻醉科等專科醫師之緊急會診機制",
                    "emergency consults from orthopaedic and general surgeons and anaesthesia"),
        "tnight_s": ("4.2.4, severe", "可於假日及夜間提供緊急外傷手術及緊急血管攝影栓塞",
                     "emergency trauma surgery and emergency angiographic embolisation at nights and on holidays"),
        "neuro_s": ("2.2.3, severe", "應有全年(含假日)、24 小時(含夜間)之神經外科專科醫師緊急會診機制",
                    "neurosurgeons answer emergency consults all year, 24 hours a day, nights and holidays included"),
        "stroke_s": ("2.2.4, severe", "可於假日及夜間提供靜脈血栓溶解或動脈血栓移除治療",
                     "intravenous thrombolysis or thrombectomy at nights and on holidays"),
        "icu_s": ("6.1.2, severe", "24 小時有醫師(不含畢業後一般醫學訓練醫師)於加護病房值班，醫師於加護病房值班不得兼值其他病房、一般會診及手術",
                  "a doctor (not a postgraduate trainee) on duty in the intensive care unit 24 hours a day, covering nothing else"),
        "icu_m": ("6.1.2, moderate", "24 小時有醫師於加護病房值班，不得兼值其他病房及手術",
                  "a doctor on duty in the intensive care unit 24 hours a day, covering no other ward or surgery")}
    return {"tw_" + k: dict(b, quote_basis="criteria item " + v[0], quote=v[1], quote_en=v[2]) for k, v in T.items()}


def defaults(S):
    """fields every listed hospital shares (hosp_defaults.err); a record with "g": "err" takes those it does not set itself"""
    l = S["sources"]["list"]
    return {"trauma_official": True, "trauma_authority": "MOHW (Ministry of Health and Welfare)", "trauma_jurisdiction": "Taiwan",
            "trauma_src": l["url"], "trauma_srcname": "MOHW emergency responsibility hospital list (updated 2026-04-29)",
            "src": l["url"], "srcname": "MOHW emergency responsibility hospital list (updated 2026-04-29)"}


def record(h):
    ch, lvl = h["chapters"], h["level"]
    std = {}
    for c, g in ch.items():
        for k, ref in STD.get((c, g), {}).items():
            std.setdefault(k, {"ref": "tw_" + ref})
    kind = "%s emergency responsibility hospital (%s急救責任醫院)" % (LEVEL_EN[lvl], lvl.rstrip("*"))
    sev = [CH_EN[c] for c in ch if ch[c] == "重度"]
    mod = [CH_EN[c] for c in ch if ch[c] == "中度"]
    notes = "MOHW %s; list grade \"%s\"" % (kind, h["level_text"])
    if h["valid_to"]:
        notes += ", valid %s to %s" % (h["valid_from"], h["valid_to"])
    if lvl != "重度級" and sev:
        notes += "; severe-level capability in " + ", ".join(sev)
    if mod and lvl == "一般級":
        notes += "; moderate-level capability in " + ", ".join(mod)
    if lvl == "中度級*":
        notes += "; high-risk pregnancy and neonatal care not graded"
    r = {"id": "sof:tw:err:" + hashlib.sha256((h["county"] + h["list_name"]).encode()).hexdigest()[:12], "g": "err",
         "name": h["osm_name_en"] or h["osm_name"] or h["list_name"], "name_local": h["list_name"], "city": h["county"], "address": "",
         "notes": notes, "lat": h["lat"], "lon": h["lon"], "prec": "exact" if h["lat"] is not None else "approx",
         "coord_basis": ("OpenStreetMap " + h["osm"]) if h["osm"] else "not placed: no unique OpenStreetMap hospital of this name"}
    if ch["緊急外傷"] == "重度":
        r["trauma_level"] = kind + ", MOHW" if lvl == "重度級" else "Severe-level emergency trauma capability (緊急外傷重度級), MOHW moderate-level hospital"
    if ch["急診"]:
        r["emergency_24h"] = True
    if std:
        r["caps_std"] = std
    r["fp"] = fp(r)
    return r


def km(a, b):
    p = math.pi / 180
    x = (b[1] - a[1]) * p * math.cos((a[0] + b[0]) * p / 2)
    return 6371 * math.hypot(x, (b[0] - a[0]) * p)


def main():
    S = json.load(open(SNAP, encoding="utf-8"))
    J = json.load(open(SRC, encoding="utf-8"))
    new = [record(h) for h in S["hospitals"]]
    placed = [r for r in new if r["lat"] is not None]
    keep = [h for h in J["hospitals"] if not h["id"].startswith("sof:tw:err:") and not (
        "wikipedia" in (h.get("src") or "") and h.get("lat") is not None and any(km((h["lat"], h["lon"]), (r["lat"], r["lon"])) < 1 for r in placed))]
    J["hospitals"] = keep + new
    J["err_asof"] = S["asof"]
    J["cap_refs"] = dict(J.get("cap_refs") or {}, **refs(S))
    J["hosp_defaults"] = dict(J.get("hosp_defaults") or {}, err=defaults(S))
    open(SRC, "w", encoding="utf-8").write(json.dumps(J, indent=1, ensure_ascii=False))
    body = json.dumps(J, separators=(",", ":")).replace("</", "<\\/")
    open(OUT, "w").write("window.ASAP_SOF=window.ASAP_SOF||{};window.ASAP_SOF[%s]=%s;" % (json.dumps("tw"), body))
    print("tw: %d hand-researched + %d emergency responsibility hospitals (%d placed, %d with a trauma designation)" % (
        len(keep), len(new), len(placed), sum(1 for r in new if "trauma_level" in r)))


if __name__ == "__main__":
    main()
