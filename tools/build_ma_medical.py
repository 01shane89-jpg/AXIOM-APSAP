"""Fold Morocco's official medical reference data (source/morocco/medical-2026.json, tools/snapshot_ma_medical.py) into
source/sof/ma.json and data/sof/ma.js, and the part in Western Sahara into source/sof/eh.json and data/sof/eh.js.
   python3 -I tools/build_ma_medical.py
Idempotent: records and blocks from an earlier run are replaced. What it writes, and from where:
  hospitals   one record per public hospital on the Ministry of Health and Social Protection's 2025 list (ids sof:ma:msps:*),
              psychiatric and oncology centres left out of the plan's list (they stay in the overview's counts). Placed on the
              matching OpenStreetMap hospital, else lat/lon null (the plan skips it; the overview counts it as unplaced).
              ma_category / ma_level: the list's category and the Decree 2-14-562 level. trauma_level stays empty: Morocco
              has no trauma-centre designation in the decree or the list.
  caps_std    what Decree 2-14-562 requires of every hospital of that category (emergency functions F1-F16, annex 3
              equipment), each quoted with the decree's URL and SHA-256. The plan reads them as INFERRED from the category,
              never as stated for the hospital. Mother-and-child, children's and maternity hospitals get none.
  airports    the large and medium airports OurAirports lists that the country's list lacks, added after it
  airfields   every open aerodrome and heliport OurAirports lists, for the country medical overview
  medical     the country medical overview block (schema osap-medical/1): hospital levels with counts, blood services, the
              trauma-system note, sources with SHA-256, gaps
Files keep the layout tools/apply_evac.py writes."""
import hashlib, json, re

SNAP = "source/morocco/medical-2026.json"
EH_REGIONS = {"Laayoune-Sakia El Hamra", "Eddakhla-Oued Eddahab"}
EH_NOTE = "Listed by Morocco's Ministry of Health and Social Protection; the territory's status is disputed and OSAP takes no position."
CAPS = {  # capability code -> decree texts that state it, per category
    "HPr": {"ed.basic": "f1", "ed.24_7": "f1", "cc.ventilator": "f8", "dx.ultrasound": "f9", "lab.basic": "f9", "blood.bank": "f10", "surg.or_emergency": "f12",
            "dx.xray": "a3_xray", "surg.general": "a1_surg"},
}
CAPS["HPr"].update({"spec.pediatrics": "a1_ped", "spec.obstetric": "a1_obs"})
CAPS["HP"] = dict(CAPS["HPr"], **{"dx.ct": "a3_ct", "cc.icu": "a1_rea", "surg.anaesthesia": "a1_anes", "surg.ophthalmology": "a1_ophth"})
CAPS["HR"] = dict(CAPS["HP"], **{"cc.icu": "f13", "dx.mri": "f14", "trans.ambulance": "f15", "surg.ortho": "a1_ortho", "surg.neuro": "a1_neuro"})
CAPS["HIR"] = dict(CAPS["HR"], **{"surg.maxfac": "a1_maxfac", "surg.plastic": "a1_plastic", "surg.thoracic": "a1_thor", "surg.trauma": "a1_traumas", "surg.vascular": "a1_vasc"})
NAME = {"HIR": "CHU (interregional) hospital", "HR": "Regional hospital", "HP": "Provincial hospital", "HPr": "Proximity hospital"}


def fp(item):
    o = {k: v for k, v in item.items() if k != "fp"}
    return hashlib.sha256(json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def slug(s):
    return hashlib.sha256(s.encode()).hexdigest()[:12]


def refs(S):
    d = S["sources"]["decree"]
    b = {"src": d["url"], "srcname": "Decree 2-14-562 (Bulletin officiel 6388, 20 August 2015)", "asof": "2015-08-20", "sha256": d["sha256"],
         "quote_mt": "by OSAP's builder from the decree's French"}
    R = {}
    for k, v in S["levels"].items():
        if not isinstance(v, dict): continue
        R["ma_" + k] = dict(b, quote_basis="Decree 2-14-562, standard for the hospital's category", quote=v["quote"], quote_en=v["quote_en"])
    return R


def display(h):
    n = re.sub(r"\s+", " ", h["name_list"]).strip()
    n = re.sub(r"^(H[ôo]pital|HPr)\s+", "", n, flags=re.I)
    return "%s (%s, %s)" % (n, NAME.get(h["category"], h["category_name"]), h["province"])


def records(S, cc):
    out = []
    src = S["sources"]["msps2025"]
    for h in S["hospitals"]:
        if h["category"] not in CAPS: continue
        if (h["region"] in EH_REGIONS) != (cc == "eh") and cc == "eh": continue
        r = {"id": "sof:%s:msps:%s" % (cc, slug(h["region"] + "|" + h["province"] + "|" + h["commune"] + "|" + h["name_list"])), "g": "msps",
             "name": display(h), "name_local": h["name_list"], "city": h["province"], "address": h["commune"], "type": "public",
             "ma_category": h["category"], "ma_category_name": h["category_name"], "ma_level": h["level"],
             "std_basis": "%s (%s) on the Ministry of Health's 2025 list; standard set by Decree 2-14-562%s" % (h["category_name"], h["category"],
                          ", for the CHU as a whole: one of its hospitals may hold only some of these services" if h["category"] == "HIR" else ""),
             "notes": "%s on the Ministry of Health and Social Protection's 2025 list (%s, %s)." % (h["category_name"], h["region"], h["province"]) +
                      (" " + EH_NOTE if h["region"] in EH_REGIONS else "") +
                      (" Specialized hospital (mother and child, children, maternity or a single specialty as mapped): the decree's emergency standard is not applied to it." if h["special"] else ""),
             "lat": h["lat"], "lon": h["lon"], "prec": "exact" if h["lat"] is not None else "approx",
             "coord_basis": ("OpenStreetMap %s (%s)" % (h["osm"].split("openstreetmap.org/")[1], h["match"])) if h["osm"] else "not placed: no OpenStreetMap hospital object matched its name in its town"}
        if not h["special"]:
            r["caps_std"] = {k: {"ref": "ma_" + v} for k, v in CAPS[h["category"]].items()}
        r["fp"] = fp(r)
        out.append(r)
    return out


def airports(S, cc):
    out = []
    for a in S["airfields"]:
        if a["cc"] != cc or a["type"] not in ("large_airport", "medium_airport"): continue
        r = {"id": "sof:%s:airport:%s" % (cc, a["ident"].lower()), "name": a["name"], "icao": a["icao"], "ident": a["ident"], "iata": a["iata"], "type": a["type"],
             "municipality": a["municipality"], "region": None, "scheduled_service": a["scheduled_service"], "lat": a["lat"], "lon": a["lon"], "prec": "exact",
             "elevation_ft": a["elevation_ft"], "longest_runway": a["longest_runway"], "runway_count": a["runway_count"], "src": a["src"],
             "srcname": "OurAirports open data", "coord_basis": "OurAirports airport reference point"}
        r["fp"] = fp(r)
        out.append(r)
    return out


def medical(S, cc, recs):
    src = S["sources"]
    H = [h for h in S["hospitals"] if (h["region"] in EH_REGIONS) == (cc == "eh") or cc == "ma"]
    lv = []
    for c in ["HIR", "HR", "HP", "HPr", "CRO", "CPU", "HPsyR", "HPsyP"]:
        L = [h for h in H if h["category"] == c]
        if not L: continue
        lv.append({"code": c, "name": L[0]["category_name"], "level": L[0]["level"], "count": len(L), "placed": sum(1 for h in L if h["lat"] is not None),
                   "emergency": {"HIR": "UMHC (complete) + UMHS (specialized): F1-F16, general ICU, CT and MRI, SMUR; trauma, vascular, thoracic, plastic and maxillofacial surgery (annex 1)", "HR": "UMHC (complete): F1-F16, general ICU, CT and MRI, SMUR; trauma orthopedics and neurosurgery (annex 1)",
                                 "HP": "UMHB (basic): 24-hour cover, resuscitation and ventilation, ultrasound, transfusion, operating theatre; general intensive care and anesthesia (annex 1); CT scanner (annex 3)",
                                 "HPr": "UMHB (basic): 24-hour cover, resuscitation and ventilation, ultrasound, transfusion, operating theatre"}.get(c, "not an emergency hospital in the decree")})
    d = src["decree"]; m = src["moh_crts"]
    return {
        "schema": "osap-medical/1", "asof": S["asof"],
        "summary": [
            {"text": "Public hospitals are organized in three levels (Decree 2-14-562, 2015): provincial and proximity hospitals (level 1), regional hospitals (level 2) and interregional university hospitals, the CHUs (level 3).",
             "src": d["url"], "sha256": d["sha256"], "quote": S["levels"]["art"]},
            {"text": "The decree sets the emergency care each level must give: basic (UMHB) at provincial hospitals, complete (UMHC, with general intensive care, CT/MRI and SMUR transfer) at regional and interregional hospitals, specialized (UMHS) only at the CHUs. A standard is not proof a given hospital meets it.",
             "src": d["url"], "sha256": d["sha256"], "quote": S["levels"]["umhc"]["quote"]},
            {"text": "No trauma-centre designation (levels I-IV or equivalent) was found in the decree or on the Ministry's hospital list, so OSAP shows no official trauma level for Morocco and the plan's Tertiary role stays a gap.",
             "src": src["msps2025"]["url"], "sha256": src["msps2025"]["sha256"], "quote": "Catégorie (column of the list), values: " + ", ".join(sorted({h["category"] for h in S["hospitals"]}))}],
        "levels": lv,
        "levels_src": {"url": src["msps2025"]["url"], "sha256": src["msps2025"]["sha256"], "name": src["msps2025"]["title"], "licence": "ODbL"},
        "blood": [dict(b, src=m["url"], srcname="Ministry of Health communiqué", sha256=m["sha256"], quote=S["blood_quote"], lat=None, lon=None) for b in S["blood"]] if cc == "ma" else [],
        "blood_std": {"text": "Every provincial, regional and interregional hospital must provide transfusion (function F10, Decree 2-14-562 annex 2). A national blood transfusion centre (CNTS) runs the regional centres.",
                      "src": d["url"], "sha256": d["sha256"], "quote": S["levels"]["f10"]["quote"]},
        "sources": [dict(id=k, title=v.get("title", k), url=v["url"], sha256=v["sha256"], retrieved=v["retrieved"], licence=v.get("licence", "")) for k, v in src.items()],
        "gaps": ["%d of %d public hospitals on the Ministry's list could not be placed on a mapped hospital and are not in the plan's list." % (sum(1 for h in H if h["lat"] is None), len(H)),
                 "Capabilities come from the national standard for each hospital category, not from each hospital: confirm emergency, CT, ICU, blood and surgery by phone before relying on them.",
                 "No official list of the regional blood transfusion centres with addresses was found; three are named by the Ministry, unplaced.",
                 "Private clinics (the larger trauma-capable ones in Casablanca, Rabat, Marrakech, Tangier) are not yet assessed.",
                 "No public air ambulance (helicopter SMUR) base list was found from an official source."],
    }


def main():
    S = json.load(open(SNAP, encoding="utf-8"))
    for cc in ("ma", "eh"):
        p = "source/sof/%s.json" % cc
        J = json.load(open(p, encoding="utf-8"))
        new = records(S, cc)
        J["hospitals"] = [h for h in J.get("hospitals", []) if ":msps:" not in h["id"]] + new
        A = airports(S, cc)
        # the airports already listed stay as they are; the large and medium ones they lack are added after them
        have = {a.get("ident") for a in J.get("airports", [])}
        J["airports"] = [a for a in J.get("airports", []) if a.get("ident")] + [a for a in A if a["ident"] not in have]
        J["airfields"] = [dict(a) for a in S["airfields"] if a["cc"] == cc]
        J["airfields_src"] = {"url": S["sources"]["ourairports"]["url"], "sha256": S["sources"]["ourairports"]["sha256"], "retrieved": S["sources"]["ourairports"]["retrieved"]}
        J["cap_refs"] = dict(J.get("cap_refs") or {}, **refs(S))
        J["hosp_defaults"] = dict(J.get("hosp_defaults") or {}, msps={"src": S["sources"]["msps2025"]["url"], "srcname": "Ministère de la Santé et de la Protection Sociale, Liste des hôpitaux 2025 (data.gov.ma, ODbL)",
                                                                       "src_sha256": S["sources"]["msps2025"]["sha256"]})
        J["medical"] = medical(S, cc, new)
        J["gaps"] = [g for g in J.get("gaps", []) if "hospitals not yet researched" not in g]
        J["msps_asof"] = S["asof"]
        open(p, "w", encoding="utf-8").write(json.dumps(J, indent=1, ensure_ascii=False))
        body = json.dumps(J, separators=(",", ":")).replace("</", "<\\/")
        open("data/sof/%s.js" % cc, "w").write("window.ASAP_SOF=window.ASAP_SOF||{};window.ASAP_SOF[%s]=%s;" % (json.dumps(cc), body))
        print("%s: %d ministry hospitals (%d placed), %d airports, %d airfields" % (cc, len(new), sum(1 for r in new if r["lat"] is not None), len(J["airports"]), len(J["airfields"])))


if __name__ == "__main__":
    main()
