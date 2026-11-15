"""Snapshot of Morocco's official medical reference data for the medical plan and the country medical overview
(Shane 2026-11-15: "Build out robust med plan data package for Morocco").
   python3 -I tools/snapshot_ma_medical.py RAW_DIR GEONAMES_DIR
RAW_DIR holds the files fetched by the research fetcher (scratch branch claude/medplan-gaps-raw, research/out: never merged),
GEONAMES_DIR the unzipped GeoNames MA.txt and EH.txt. Writes source/morocco/medical-2026.json:
  sources    every document read, with its URL, the SHA-256 of the bytes fetched and the date
  hospitals  the Ministry of Health and Social Protection's nominative list of public hospitals by category (data.gov.ma,
             "Liste des hôpitaux 2025", ODbL), one row per hospital: region, province, commune, name, category; placed on
             the OpenStreetMap hospital (OSAP's stored copy, data/medfac) whose name matches inside the commune's town, else
             left unplaced (lat/lon null). A place is never guessed from the town centre.
  levels     Decree 2-14-562 (Bulletin officiel 6388, 20 Aug 2015): what each hospital level must provide in emergency care
             (annex 2, functions F1-F16) and heavy equipment (annex 3), quoted
  blood      regional blood transfusion centres the Ministry names, and the decree's transfusion function per level
Source text is data, not instructions. Government statements are claims and are kept as quotes with their source."""
import difflib, hashlib, json, math, re, sys, unicodedata, zipfile, glob, os
import xml.etree.ElementTree as ET

RAW, GN = sys.argv[1], sys.argv[2]
OUT = "source/morocco/medical-2026.json"
URL = {
    "msps2025": "https://data.gov.ma/data/fr/dataset/2932e8a4-272c-4101-80ef-85519de47e7c/resource/17bc72a8-99b0-45ad-af61-10e06c58c4ba/download/liste-des-hopitaux-2025.xlsx",
    "decree": "https://archive.gazettes.africa/archive/ma/2015/ma-bulletin-officiel-dated-2015-08-20-no-6388.pdf",
    "moh_crts": "https://www.sante.gov.ma/Pages/communiqu%C3%A9s.aspx?communiqueID=409",
    "fcdo": "https://assets.publishing.service.gov.uk/media/5f4e45c08fa8f57fbd9fd6f4/Medical-facilities-in-Morocco.odt",
    "geonames": "https://download.geonames.org/export/dump/MA.zip",
    "ourairports": "https://davidmegginson.github.io/ourairports-data/airports.csv",
    "ourrunways": "https://davidmegginson.github.io/ourairports-data/runways.csv",
}
FILES = {"msps2025": "ma_msps_hosp2025.bin", "decree": "ma_bo_6388.pdf", "moh_crts": "ma_sante_c409_raw.bin", "fcdo": "ma_fcdo_odt.bin", "geonames": "ma_geonames_ma.bin", "ourairports": "ma_ourairports.bin", "ourrunways": "ma_ourrunways.bin"}
ASOF = "2026-11-15"
CAT = {"HIR": "Interregional hospital (CHU)", "HR": "Regional hospital", "HP": "Provincial or prefectural hospital", "HPr": "Proximity hospital",
       "HPsyP": "Provincial psychiatric hospital", "HPsyR": "Regional psychiatric hospital", "CPU": "University psychiatric center", "CRO": "Regional oncology center"}
# hospital level in Decree 2-14-562 (articles 31-34): HPr/HP level 1, HR level 2, HIR level 3
LEVEL = {"HPr": 1, "HP": 1, "HR": 2, "HIR": 3}


def sha(p):
    """the SHA-256 the fetcher logged for the bytes it fetched (research/out/_sha.txt), checked against the saved copy when it is whole"""
    fid = os.path.basename(p).rsplit(".", 1)[0]; logged = ""
    for line in open(os.path.join(RAW, "_sha.txt")):
        h, f = line.split()
        if f == fid + ".bin": logged = h
    for ext in (".bin", ".pdf", ".html"):
        q = os.path.join(RAW, fid + ext)
        if os.path.exists(q) and ext != ".html":
            h = hashlib.sha256(open(q, "rb").read()).hexdigest()
            if logged and h != logged: raise SystemExit("hash mismatch " + q)
            return h
    if not logged: raise SystemExit("no hash for " + fid)
    return logged


AR = [("مستشفى", " hopital "), ("مستشفي", " hopital "), ("المستشفى", " hopital "), ("المركز الاستشفائي", " centre hospitalier "), ("الإقليمي", " provincial "),
      ("الاقليمي", " provincial "), ("الجهوي", " regional "), ("الجامعي", " universitaire "), ("العسكري", " militaire "), ("محمد", " mohammed "), ("الخامس", " 5 "),
      ("السادس", " 6 "), ("الحسن", " hassan "), ("الحسني", " hassani "), ("الثاني", " 2 "), ("الأول", " 1 "), ("مولاي", " moulay "), ("ابن", " ibn "), ("سيدي", " sidi "),
      ("عبد الله", " abdellah "), ("يوسف", " youssef "), ("إسماعيل", " ismail "), ("اسماعيل", " ismail "), ("الأمير", " prince "), ("الأميرة", " princesse "),
      ("للا", " lalla "), ("رشد", " rochd "), ("سينا", " sina "), ("طفيل", " tofeil "), ("زهر", " zohr "), ("الإدريسي", " idrissi "), ("الادريسي", " idrissi "),
      ("الفارابي", " farabi "), ("الغساني", " ghassani "), ("الخطيب", " khatib "), ("البيطار", " baitar "), ("العياشي", " ayachi "), ("عائشة", " aisha "),
      ("الشريف", " cherif "), ("علي", " ali "), ("المهدي", " mehdi "), ("الرازي", " razi "), ("الأنطاكي", " antaki "), ("السلامة", " assalama ")]


def norm(s):
    s = str(s or "")
    for a, b in AR: s = s.replace(a, b)
    s = re.sub(r"([a-zA-Z])(\d)", r"\1 \2", s)
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = s.replace("molay", "moulay").replace("mohammed vi", "mohammed 6")
    s = re.sub(r"\bmohamed\b|\bmed\b|\bmohamad\b", "mohammed", s); s = re.sub(r"\bmy\b|\bmly\b|\bm y\b", "moulay", s)
    s = re.sub(r"\bvi\b", "6", s); s = re.sub(r"\bv\b", "5", s); s = re.sub(r"\bii\b", "2", s); s = re.sub(r"\b1er\b|\bier\b", "1", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


GENERIC = set("hopital hospital hop c centre center hospitalier hospitaliere chu chr chp ch provincial prefectoral regional de d du des la le l el al and of "
              "general university universitaire specialites specialite proximite hpr hp hr s b ancien pr hopitale nouveau jdid".split())
WEAK = set("ibn ben moulay lalla prince princesse sidi hassan mohammed 5 6 2 1 militaire".split())


def toks(s, keep=()):
    o = []
    for t in norm(s).split():
        if t in keep: o.append(t); continue
        if len(t) > 5 and t[:2] in ("al", "el") and t not in ("alamal",): t = t[2:]
        if t not in GENERIC and (len(t) > 1 or t.isdigit()): o.append(t)
    return o


def same(a, b):
    """two words name the same thing: equal, or long words spelled a little differently (Azzamouri / Azemmouri)"""
    if a == b: return True
    if a.isdigit() or b.isdigit() or min(len(a), len(b)) < 6: return False
    return difflib.SequenceMatcher(None, a, b).ratio() >= 0.8


def inter(A, B):
    return set(a for a in A if any(same(a, b) for b in B))


def hav(a, b):
    r = math.pi / 180; dl = (b[0] - a[0]) * r; dn = (b[1] - a[1]) * r
    x = math.sin(dl / 2) ** 2 + math.cos(a[0] * r) * math.cos(b[0] * r) * math.sin(dn / 2) ** 2
    return 12742 * math.asin(math.sqrt(x))


def xlsx_rows(p):
    z = zipfile.ZipFile(p); ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    ss = [("".join(t.text or "" for t in si.iter("{%s}t" % ns["m"]))) for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", ns)]
    sh = ET.fromstring(z.read("xl/worksheets/sheet1.xml")); rows = []
    for r in sh.iter("{%s}row" % ns["m"]):
        o = []
        for c in r.findall("m:c", ns):
            v = c.find("m:v", ns); t = c.get("t")
            o.append(ss[int(v.text)] if v is not None and t == "s" else (v.text if v is not None else (c.find("m:is/m:t", ns).text if c.find("m:is/m:t", ns) is not None else "")))
        rows.append(o)
    return rows


def gazetteer():
    G = {}
    for f in ("MA.txt", "EH.txt"):
        for line in open(os.path.join(GN, f), encoding="utf-8"):
            c = line.rstrip("\n").split("\t")
            if c[6] != "P": continue
            pop = int(c[14] or 0)
            for n in [c[1], c[2]] + c[3].split(","):
                k = norm(n)
                if k and (k not in G or pop > G[k][2]): G[k] = (float(c[4]), float(c[5]), pop)
    return G


TOWN_FIX = {"casablanca anfa": "casablanca", "al fida mers sultan": "casablanca", "ain sebaa hay mohammadi": "casablanca", "hay hassani": "casablanca",
            "ain chok": "casablanca", "sidi bernoussi": "casablanca", "ben msick": "casablanca", "moulay rachid": "casablanca", "fes": "fes",
            "tanger assilah": "tanger", "oujda angad": "oujda", "agadir ida ou tanane": "agadir", "inezgane ait melloul": "inezgane", "oued ed dahab": "dakhla",
            "laayoune": "laayoune", "es semara": "smara", "skhirate temara": "temara", "mdiq fnideq": "mdiq", "taroudannt": "taroudant"}


def town(row, G):
    com = row[2]; prov = row[1]
    if "(Arrond.)" in com or com.strip() in ("Saada",):
        k = TOWN_FIX.get(norm(prov), norm(prov))
    else:
        k = norm(re.sub(r"\(.*?\)", "", com))
    for i, cand in enumerate((k, TOWN_FIX.get(k, k), norm(prov), TOWN_FIX.get(norm(prov), ""))):
        if cand in G: return cand, G[cand], i < 2
    return k, None, False


def osm_hospitals():
    idx = json.load(open("data/medfac/index.json")); H = []
    for cc in ("ma", "eh"):
        e = idx["countries"].get(cc)
        if not e: continue
        for t in e["tiles"]:
            for x in json.load(open("data/medfac/t/%s.json" % t)):
                if x[3] == cc and x[4].get("amenity") == "hospital": H.append(x)
    return H


def names(tags):
    return [v for k, v in tags.items() if k == "name" or k.startswith("name:") or k in ("alt_name", "official_name", "short_name", "old_name")]


NOTHOSP = re.compile(r"clinique|polyclinique|cnss|centre de sante|health cent|dispensaire|cabinet|pharmac|laborato|mutuelle|مصحة|المركز الصحي", re.I)
GENERICN = re.compile(r"\b(provincial|prefectoral|regional|proximite)\b")
SPECIAL = re.compile(r"oncolog|psychiatr|maternit|m.re.enfant|enfant|l.prolog|h.matolog", re.I)


# placements reviewed by hand where the name rule cannot decide (OSAP's builder read the OpenStreetMap names and places on
# 2026-11-15): (province, list name) -> OpenStreetMap id, or None to keep a row unplaced, with the reason
MANUAL = {
    ("Casablanca Anfa", "20 Aout 1953"): ("w250426643", "OpenStreetMap names it Hopital 20 Aout, 1.7 km from Casablanca centre"),
    ("Marrakech", "Arrazi"): ("w150782355", "CHU Mohammed VI campus, where the CHU's Arrazi hospital stands; OpenStreetMap names the campus only"),
    ("Agadir Ida Ou Tanane", "Hôpital des Spécialités"): ("w416680855", "OpenStreetMap: CHU Agadir (Souss Massa)"),
    ("Oujda Angad", "Hôpital des Spécialitéss"): ("w306127863", "OpenStreetMap: Centre Hospitalier Universitaire (CHU) Mohammed VI, Oujda"),
    ("Fes", "Hôpital des spécialités"): ("w150786744", "OpenStreetMap: University hospital Hassan II, Fès"),
    ("Fes", "Ibn Al Baitar"): ("w561184067", "OpenStreetMap's Arabic name is Ibn al-Baitar hospital, misspelt"),
    ("Rabat", "Moulay Youssef (Ancien hôpital de Rabat)"): ("n2569037645", "OpenStreetMap: Hopital Moulay Youssef, Rabat"),
    ("Salé", "My Youssef"): (None, "the only Moulay Youssef hospital OpenStreetMap has nearby is Rabat's; Salé's is not mapped under that name"),
}


def airfields():
    """every open aerodrome and heliport OurAirports lists in MA and EH, with its longest open runway"""
    import csv
    A = [x for x in csv.DictReader(open(os.path.join(RAW, FILES["ourairports"]), encoding="utf-8")) if x["iso_country"] in ("MA", "EH") and x["type"] != "closed"]
    R = {}
    for r in csv.DictReader(open(os.path.join(RAW, FILES["ourrunways"]), encoding="utf-8")):
        if r["airport_ident"] in {a["ident"] for a in A} and r["closed"] != "1":
            R.setdefault(r["airport_ident"], []).append(r)
    out = []
    for a in A:
        rw = sorted(R.get(a["ident"], []), key=lambda r: -int(r["length_ft"] or 0))
        L = rw[0] if rw else None
        out.append({"ident": a["ident"], "icao": a["icao_code"] or (a["ident"] if re.match(r"^[A-Z]{4}$", a["ident"]) else None), "iata": a["iata_code"] or None,
                    "name": a["name"], "type": a["type"], "cc": a["iso_country"].lower(), "municipality": a["municipality"], "lat": round(float(a["latitude_deg"]), 5),
                    "lon": round(float(a["longitude_deg"]), 5), "elevation_ft": int(a["elevation_ft"]) if a["elevation_ft"] else None, "scheduled_service": a["scheduled_service"] == "yes",
                    "runway_count": len(rw), "longest_runway": {"ident": "%s/%s" % (L["le_ident"], L["he_ident"]), "length_ft": int(L["length_ft"] or 0) or None,
                    "length_m": round(int(L["length_ft"]) * 0.3048) if L["length_ft"] else None, "width_ft": int(L["width_ft"]) if L["width_ft"] else None, "surface": L["surface"]} if L else None,
                    "src": "https://ourairports.com/airports/%s/" % a["ident"]})
    return sorted(out, key=lambda x: (x["type"] != "large_airport", x["type"] != "medium_airport", x["name"]))


# Decree 2-14-562, annexes 1-3, quoted (French as published; OSAP's English). What each hospital level must provide: a standard,
# so the plan reads it as INFERRED from the hospital's category, never as stated for the hospital.
LEVELS = {
    "umhb": {"levels": ["HPr", "HP"], "quote": "LES URGENCES MEDICO-HOSPITALIERES DE BASE (UMHB) Elles sont prodiguées au niveau des CHP. En plus des fonctions UMP précitées, on trouve 5 autres fonctions a ce niveau (F8 a F12).",
             "quote_en": "Basic hospital emergency care (UMHB), given at provincial hospitals: the proximity functions F1-F7 plus F8-F12."},
    "f1": {"quote": "Fi : Permanence 24/24 (Garde ou Astreinte)", "quote_en": "F1: 24-hour cover (on duty or on call)"},
    "f8": {"quote": "F8: Gestes de ressuscitation et de réanimation (F3 + Déchoquage cardio-vasculaire, sédation, intubation/ventilation, Sonde gastrique, monitorage)",
           "quote_en": "F8: resuscitation (cardiovascular shock care, sedation, intubation and ventilation, gastric tube, monitoring)"},
    "f9": {"quote": "F9: Examen complémentaire de Base : (F6 + Echographie, ionogramme, bactériologie, immunologie)", "quote_en": "F9: basic tests (ultrasound, electrolytes, bacteriology, immunology)"},
    "f10": {"quote": "F10 : Transfusion", "quote_en": "F10: transfusion"},
    "f12": {"quote": "F12 : Intervention chirurgicale (Bloc opératoire)", "quote_en": "F12: surgery (operating theatre)"},
    "umhc": {"levels": ["HR", "HIR"], "quote": "LES URGENCES MEDICO-HOSPITALIERES COMPLETES (UMHC) Elles sont prodiguées au niveau des Hôpitaux Régionaux et Centres Hospitaliers interrégionaux. En plus des fonctions des UMHB, on trouve les 4 autres fonctions suivantes a ce niveau",
             "quote_en": "Complete hospital emergency care (UMHC), given at regional and interregional hospitals: the UMHB functions plus F13-F16."},
    "f13": {"quote": "F13: Fonction de réanimation hospitalière polyvalente (prise en charge complète des défaillances viscérales aiguës mettant directement en jeu le pronostic vital)",
            "quote_en": "F13: general intensive care (full care of acute organ failure that threatens life)"},
    "f14": {"quote": "F14 : Examens complémentaires complets : (F11 + TDM/IRM, explorations fonctionnelles ou invasives, virologie, etc.)", "quote_en": "F14: full tests, including CT and MRI"},
    "f15": {"quote": "F15 : Transfert SMUR", "quote_en": "F15: SMUR (mobile emergency and resuscitation) transfer"},
    "a3_ct": {"levels": ["HP", "HR", "HIR"], "quote": "Annexe n° 3 Liste des équipements biomédicaux lourds ... Scanographe (provincial ou préfectoral, régional, interrégional)",
              "quote_en": "Annex 3, heavy equipment: CT scanner at provincial or prefectural, regional and interregional hospitals"},
    "a3_xray": {"levels": ["HPr", "HP", "HR", "HIR"], "quote": "Annexe n° 3 ... Installation radiologique pour examens standards (all four levels)", "quote_en": "Annex 3: standard X-ray at every hospital level"},
    "a1_surg": {"levels": ["HPr", "HP", "HR", "HIR"], "quote": "Annexe n° 1 Panier des prestations hospitalières par niveaux d'intervention ... Chirurgie générale/viscérale x x x x", "quote_en": "Annex 1: general surgery at every hospital level"},
    "a1_rea": {"quote": "Annexe n° 1 Panier des prestations hospitalières par niveaux d'intervention: Réanimation polyvalente (x: CHP, CHR, CHI)", "quote_en": "Annex 1, basket of hospital services: general intensive care at provincial, regional and interregional hospitals"},
    "a1_anes": {"quote": "Annexe n° 1 Panier des prestations hospitalières par niveaux d'intervention: Anesthésie réanimation (x: CHP, CHR, CHI)", "quote_en": "Annex 1, basket of hospital services: anesthesia at provincial, regional and interregional hospitals"},
    "a1_ped": {"quote": "Annexe n° 1 Panier des prestations hospitalières par niveaux d'intervention: Pédiatrie (x: HP, CHP, CHR, CHI)", "quote_en": "Annex 1, basket of hospital services: pediatrics at every hospital level"},
    "a1_obs": {"quote": "Annexe n° 1 Panier des prestations hospitalières par niveaux d'intervention: Gynécologie-obstétrique (HP: l'obstétrique seulement) (x: HP, CHP, CHR, CHI)", "quote_en": "Annex 1, basket of hospital services: obstetrics at every level (gynecology from provincial level up)"},
    "a1_ophth": {"quote": "Annexe n° 1 Panier des prestations hospitalières par niveaux d'intervention: Ophtalmologie (x: CHP, CHR, CHI)", "quote_en": "Annex 1, basket of hospital services: ophthalmology at provincial, regional and interregional hospitals"},
    "a1_ortho": {"quote": "Annexe n° 1 Panier des prestations hospitalières par niveaux d'intervention: Traumato-orthopédie (x: CHR, CHI)", "quote_en": "Annex 1, basket of hospital services: trauma orthopedics at regional and interregional hospitals"},
    "a1_neuro": {"quote": "Annexe n° 1 Panier des prestations hospitalières par niveaux d'intervention: Neurochirurgie (x: CHR, CHI)", "quote_en": "Annex 1, basket of hospital services: neurosurgery at regional and interregional hospitals"},
    "a1_maxfac": {"quote": "Annexe n° 1 Panier des prestations hospitalières par niveaux d'intervention: Chirurgie maxillo-faciale (x: CHI)", "quote_en": "Annex 1, basket of hospital services: maxillofacial surgery at interregional hospitals (CHU) only"},
    "a1_plastic": {"quote": "Annexe n° 1 Panier des prestations hospitalières par niveaux d'intervention: Chirurgie réparatrice et plastique (x: CHI)", "quote_en": "Annex 1, basket of hospital services: reconstructive and plastic surgery at interregional hospitals (CHU) only"},
    "a1_thor": {"quote": "Annexe n° 1 Panier des prestations hospitalières par niveaux d'intervention: Chirurgie cardio-vasculaire; Chirurgie thoracique (x: CHI)", "quote_en": "Annex 1, basket of hospital services: cardiovascular and thoracic surgery at interregional hospitals (CHU) only"},
    "a1_traumas": {"quote": "Annexe n° 1 Panier des prestations hospitalières par niveaux d'intervention: Chirurgie traumatologique (x: CHI)", "quote_en": "Annex 1, basket of hospital services: trauma surgery at interregional hospitals (CHU) only"},
    "a1_vasc": {"quote": "Annexe n° 1 Panier des prestations hospitalières par niveaux d'intervention: Chirurgie vasculaire (x: CHI)", "quote_en": "Annex 1, basket of hospital services: vascular surgery at interregional hospitals (CHU) only"},
    "umhs": {"levels": ["HIR"], "quote": "Annexe n° 1 ... UMHS : Urgences médico-hospitalières spécialisées (interregional only)", "quote_en": "Annex 1: specialized hospital emergency care (UMHS) only at interregional hospitals (CHU)"},
    "art": "Articles 31-34: provincial/prefectural hospitals give first-level hospital care, regional hospitals second level, interregional hospitals (the CHUs) third level.",
}
BLOOD = [
    {"name": "Centre Régional de Transfusion Sanguine de Rabat", "city": "Rabat", "kind": "regional_transfusion_centre", "note": "ISO 9001 recertified (2015, 2022) per the Ministry"},
    {"name": "Centre Régional de Transfusion Sanguine de Fès", "city": "Fès", "kind": "regional_transfusion_centre", "note": "ISO 9001 per the Ministry"},
    {"name": "Centre Régional de Transfusion Sanguine de Tétouan", "city": "Tétouan", "kind": "regional_transfusion_centre", "note": "ISO 9001 per the Ministry"},
]
BLOOD_QUOTE = ("Les centres de transfusion sanguine régionaux de Tétouan et de Fès ont obtenu le certification ISO 9001 (Système de Management de la Qualité). "
               "Ces deux centres rejoignent le centre régional de transfusion sanguine de Rabat qui a réussi son audit de recertification")


def main():
    rows = xlsx_rows(os.path.join(RAW, FILES["msps2025"]))
    head = rows[0]; rows = [r + [""] * (5 - len(r)) for r in rows[1:] if len(r) >= 5 and r[4]]
    G = gazetteer(); O = osm_hospitals(); used = {}
    out = []
    for r in rows:
        region, prov, com, name, cat = [str(x).strip() for x in r[:5]]
        tk, tc, own = town(r, G)
        rec = {"region": region, "province": prov, "commune": com, "name_list": name, "category": cat, "category_name": CAT.get(cat, cat),
               "level": LEVEL.get(cat), "special": bool(SPECIAL.search(name) or cat in ("CRO", "CPU", "HPsyP", "HPsyR")), "town": tk,
               "town_ll": [round(tc[0], 5), round(tc[1], 5)] if tc else None, "osm": None, "lat": None, "lon": None, "osm_name": "", "match": ""}
        nt = set(toks(name)) or set(t for t in norm(name).split() if t.startswith("specialit")); best = None
        if tc:
            for x in O:
                d = hav(tc, (x[1], x[2]))
                if d > 15: continue
                sc = 0
                for n in names(x[4]):
                    if NOTHOSP.search(n) and not NOTHOSP.search(name): continue
                    ot = set(toks(n, keep=nt)); com_t = inter(nt, ot)
                    if "militaire" in ot and "militaire" not in nt: continue
                    strong = [t for t in nt if t not in WEAK]
                    # every distinctive word must match; weak words (Ibn, Moulay, Hassan, numbers...) only count with them
                    if nt and com_t and all(any(same(t, o) for o in ot) for t in strong) and (strong or com_t == nt):
                        sc = max(sc, len(com_t) / len(nt) + 0.01 * len(com_t) / max(1, len(ot)))
                if sc >= 0.99 or (sc >= 0.6 and len(nt) >= 2):
                    sc = round(sc, 4)
                    k = (sc, -d)
                    if not best or k > best[0]: best = (k, x)
            # a name that is only the town ("Taounate", "Demnate") matches an OSM hospital in that town that names the town
        # a list name that is only its town ("Khémisset", "Tinghir"): the one OpenStreetMap hospital within 5 km of the town
        # whose name is the town or a provincial / regional / proximity hospital; none or several: unplaced
        if not best and tc and own and nt and nt <= set(toks(tk)) | set(toks(com)):
            C = [x for x in O if hav(tc, (x[1], x[2])) <= 5 and not NOTHOSP.search(" ".join(names(x[4])))
                 and any(inter(nt, set(toks(n))) or GENERICN.search(norm(n)) for n in names(x[4]))]
            if len(C) == 1: best = ((0.9, -hav(tc, (C[0][1], C[0][2]))), C[0])
        man = MANUAL.get((prov, name))
        if man:
            x = [y for y in O if y[0] == man[0]] if man[0] else []
            best = ((2.0, 0), x[0]) if x else None
            rec["match_note"] = man[1]
            if man[0] and not x: raise SystemExit("manual placement not in the stored copy: %s" % (man,))
        if best:
            x = best[1]; rec.update(osm="https://www.openstreetmap.org/" + {"n": "node", "w": "way", "r": "relation"}[x[0][0]] + "/" + x[0][1:],
                                    lat=x[1], lon=x[2], osm_name=x[4].get("name", ""), match=("reviewed by hand: " + rec["match_note"]) if man else "name %.2f, %.1f km from %s" % (best[0][0], -best[0][1], tk))
            if SPECIAL.search(" ".join(names(x[4]))): rec["special"] = True
            sp = x[4].get("healthcare:speciality", "")
            rec["osm_speciality"] = sp
            # mapped as a single-specialty hospital (e.g. rheumatology): not an emergency hospital, whatever its category
            if sp and not re.search(r"emergency|g[eé]n[eé]ral|surg|chirurg|trauma|intensive|^all$", sp, re.I): rec["special"] = True
            used.setdefault(x[0], []).append((best[0], rec))
        out.append(rec)
    # one OSM hospital claimed by two list rows: the row whose name it matches best keeps it; a tie places neither
    for k, L in used.items():
        if len(L) < 2: continue
        L.sort(key=lambda t: t[0], reverse=True)
        keep = L[0][1] if L[0][0][0] > L[1][0][0] else None
        for sc, rec in L:
            if rec is keep: continue
            rec.update(lat=None, lon=None, match="ambiguous: the OpenStreetMap hospital it matches is " + ("matched better by " + keep["name_list"] if keep else "matched as well by another row"), osm=None, osm_name="")
    src = {k: {"url": URL[k], "file": FILES[k], "sha256": sha(os.path.join(RAW, FILES[k])), "retrieved": ASOF} for k in FILES}
    src["msps2025"].update(title="Liste des hôpitaux 2025 (Ministère de la Santé et de la Protection Sociale, data.gov.ma)", licence="ODbL", columns=head)
    src["decree"].update(title="Décret n° 2-14-562 du 7 chaoual 1436 (24 juillet 2015) pris pour l'application de la loi-cadre n° 34-09 relative au système de santé et à l'offre de soins, Bulletin officiel n° 6388, 20 August 2015")
    src["moh_crts"].update(title="Ministry of Health communiqué: regional blood transfusion centres of Tétouan and Fès obtain ISO 9001 (Rabat recertified)")
    src["fcdo"].update(title="FCDO / British Embassy Rabat: List of medical providers in Morocco (OGL)", licence="OGL v3.0")
    src["geonames"].update(title="GeoNames Morocco gazetteer (town positions used only to bound the name match)", licence="CC BY 4.0")
    src["ourairports"].update(title="OurAirports open data: airports (public domain, crowd-maintained)", licence="Public domain")
    src["ourrunways"].update(title="OurAirports open data: runways (public domain, crowd-maintained)", licence="Public domain")
    J = {"schema": "osap-ma-medical/1", "asof": ASOF, "sources": src, "hospitals": out, "airfields": airfields(), "levels": LEVELS, "blood": BLOOD, "blood_quote": BLOOD_QUOTE}
    json.dump(J, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    n = len(out); p = sum(1 for x in out if x["lat"] is not None)
    print("%d hospitals, %d placed, %d unplaced" % (n, p, n - p))
    for x in out:
        if x["lat"] is None and not x["special"]: print("  unplaced", x["category"], x["name_list"], "|", x["commune"], x["town"], x["town_ll"] is not None, x["match"])


main()
