"""Fold Japan's MHLW-designated critical care centres (source/japan/ccc-2025.json) into source/sof/jp.json and
data/sof/jp.js as hospital records the medical plan reads.
   python3 tools/build_jp_ccc.py
Each centre becomes one hospital record (id sof:jp:ccc:<hash>), replacing those from an earlier run; the hand-researched
records stay. What each record says, and from where:
  trauma_level   the designation as MHLW lists it (critical care centre, advanced or regional) and its 2025 evaluation
                 grade; trauma_official true, since MHLW is the designating authority
  emergency_24h  true: the designation standard has every centre take all critical emergency patients 24 hours a day
  caps           only what the centre's own 2025 evaluation scores state (MHLW 資料2, criteria in the 2026-01-26 notice):
                 item 21 at 2 points  CT and MRI immediately available at all times
                 item 22 at 1+ points anaesthetist and theatre staff for emergency surgery at all times
                 item 12 at 1+ points general surgery, neurosurgery and orthopaedics see suspected trauma promptly
  caps_std       what the designation standard (救急医療対策事業実施要綱) requires of every centre: its own ICU and an
                 X-ray room, and for advanced centres extensive burns. The plan reads these as INFERRED, never as stated.
Nothing here says a blood bank; the plan keeps it unknown. Files keep the layout tools/apply_evac.py writes."""
import hashlib, json, os

SNAP, SRC, OUT = "source/japan/ccc-2025.json", "source/sof/jp.json", "data/sof/jp.js"
MT = "by OSAP's AI from MHLW's Japanese"
KIND = {"advanced": ("Advanced critical care centre", "高度救命救急センター"), "standard": ("Critical care centre", "救命救急センター"),
        "regional": ("Regional critical care centre", "地域救命救急センター")}


def fp(item):
    o = {k: v for k, v in item.items() if k != "fp"}
    return hashlib.sha256(json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def item(S, c, n):
    return c["items"][S["items_order"].index(n)]


def refs(S):
    """the quoted texts once per country (cap_refs); each record's caps point at one by "ref" and add their own score"""
    ev, std = S["sources"]["items"], S["sources"]["standard"]
    e = {"src": ev["url"], "srcname": "MHLW 2025 critical care centre evaluation", "asof": S["asof"], "sha256": ev["sha256"], "quote_mt": MT}
    s = {"src": std["url"], "srcname": "MHLW critical care centre standard (救急医療対策事業実施要綱)", "asof": S["asof"], "sha256": std["sha256"], "quote_mt": MT}
    R = {"i21_2": dict(e, quote_basis="evaluation item 21 (CT and MRI), 2 of 2 points", quote="常時、初療室に隣接した検査室において、マルチスライスCTが直ちに撮影可能であり、かつ、常時、MRIが直ちに撮影可能である",
                     quote_en="multi-slice CT in a room next to the resuscitation room and MRI, both immediately available at all times")}
    for p, how, when in ((1, "のオンコール体制により", "within 60 minutes"), (2, "が院内で待機しており", "at once"), (3, "が院内で待機しており", "within 30 minutes, several patients at once")):
        R["i22_%d" % p] = dict(e, quote_basis="evaluation item 22 (operating theatre), %d of 3 points" % p, quote="麻酔科の医師及び手術室の看護師" + how + "、緊急手術が必要な患者が搬送された際に、直ちに手術が可能な体制が常時整っている" + ("（30分以内、複数の緊急患者）" if p == 3 else ""),
                               quote_en="anaesthetists and theatre nurses " + ("on call" if p == 1 else "on site") + ": a patient who needs emergency surgery is operated on " + when + ", at all times")
    for p, how, en in ((1, "において夜間・休日の院外オンコール体制が整備されている", "on call nights and holidays"), (2, "の全ての診療科の医師が院内に常時勤務している", "all with doctors in the hospital at all times")):
        R["i12_%d" % p] = dict(e, quote_basis="evaluation item 12 (trauma care), %d of 2 points" % p, quote="一般外科、脳神経外科及び整形外科" + how + "ことにより、外傷を疑う患者が搬送された時に、依頼された診療科が迅速に診療できる体制になっている",
                               quote_en="general surgery, neurosurgery and orthopaedics " + en + ", so a suspected trauma patient is seen promptly by the specialty asked")
    R["s_icu"] = dict(s, quote="救命救急センターの責任者が直接管理する専用病床及び専用の集中治療室（ＩＣＵ）を適当数有するものとする",
                      quote_en="every critical care centre has its own beds and its own ICU under the centre's director", quote_basis="standard 4 (4) ア (ｱ)")
    R["s_xray"] = dict(s, quote="救命救急センターとして必要な専用の診察室（救急蘇生室）、緊急検査室、放射線撮影室及び手術室等を設けるものとする",
                       quote_en="every critical care centre has its own resuscitation room, emergency laboratory, X-ray room and operating theatre", quote_basis="standard 4 (4) ア (ｲ)")
    R["s_burn"] = dict(s, quote="高度救命救急センターは、広範囲熱傷、指肢切断、急性中毒等の特殊疾病患者に対する救命医療を行うために必要な相当高度な診療機能を有する",
                       quote_en="an advanced critical care centre treats extensive burns, limb amputation and acute poisoning", quote_basis="section 4 (advanced centres), standard 4 (1)")
    return R


STD = {"cc.icu": {"ref": "s_icu"}, "dx.xray": {"ref": "s_xray"}}


def defaults(S):
    """fields every centre shares (hosp_defaults.ccc); a record with "g": "ccc" takes those it does not set itself"""
    return {"emergency_24h": True, "trauma_official": True, "trauma_authority": "MHLW",
            "trauma_jurisdiction": "Japan", "trauma_src": S["sources"]["list"]["url"], "trauma_srcname": "MHLW critical care centre list",
            "src": S["sources"]["grade"]["url"], "srcname": "MHLW 2025 critical care centre evaluation", "caps_std": STD}


def record(S, c):
    kind_en, kind_ja = KIND[c["kind"]]
    caps, std_caps = {}, {}
    p21, p22, p12 = item(S, c, "21"), item(S, c, "22"), item(S, c, "12")
    if p21 >= 2:
        for k in ("dx.ct", "dx.mri"): caps[k] = {"ref": "i21_2"}
    if p22 >= 1:
        for k in ("surg.or_emergency", "surg.anaesthesia"): caps[k] = {"ref": "i22_%d" % p22}
    if p12 >= 1:
        for k in ("surg.general", "surg.neuro", "surg.ortho"): caps[k] = {"ref": "i12_%d" % p12}
    if c["kind"] == "advanced":
        std_caps = dict(STD, **{"spec.burn": {"ref": "s_burn"}})
    n = c.get("nums") or {}
    notes = "MHLW 2025 evaluation grade %s (%d points)" % (c["grade"], c["points"])
    if n:
        notes += "; %d full-time emergency doctors, %d critical patients and %d ambulances received in 2025" % (n["ft_doctors"], n["critical_patients"], n["ambulances"])
    if c["dh"]:
        notes += "; doctor helicopter base"
    h = hashlib.sha256((c["pref"] + c["list_name"]).encode()).hexdigest()[:12]
    r = {"id": "sof:jp:ccc:" + h, "g": "ccc", "name": c["name_en"] or c["list_name"], "city": c["pref"], "address": c["pref"] + c["address"],
         "trauma_level": "%s (%s), MHLW-designated; 2025 evaluation grade %s" % (kind_en, kind_ja, c["grade"]),
         "notes": notes, "lat": c["lat"], "lon": c["lon"], "prec": c["prec"], "coord_basis": c["coord_basis"], "caps": caps}
    if std_caps:
        r["caps_std"] = std_caps
    if c["name_en"]:
        r["name_local"] = c["list_name"]
    r["fp"] = fp(r)
    return r


def main():
    S = json.load(open(SNAP, encoding="utf-8"))
    J = json.load(open(SRC, encoding="utf-8"))
    keep = [h for h in J["hospitals"] if not h["id"].startswith("sof:jp:ccc:")]
    new = [record(S, c) for c in S["centres"]]
    J["hospitals"] = keep + new
    J["ccc_asof"] = S["asof"]
    J["cap_refs"] = refs(S)
    J["hosp_defaults"] = dict(J.get("hosp_defaults") or {}, ccc=defaults(S))
    open(SRC, "w", encoding="utf-8").write(json.dumps(J, indent=1, ensure_ascii=False))
    body = json.dumps(J, separators=(",", ":")).replace("</", "<\\/")
    open(OUT, "w").write("window.ASAP_SOF=window.ASAP_SOF||{};window.ASAP_SOF[%s]=%s;" % (json.dumps("jp"), body))
    print("jp: %d hand-researched + %d critical care centres (%d placed)" % (len(keep), len(new), sum(1 for r in new if r["lat"] is not None)))


if __name__ == "__main__":
    main()
