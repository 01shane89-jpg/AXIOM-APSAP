"""Snapshot Taiwan's emergency responsibility hospital list (MOHW 急救責任醫院分區名單) as source/taiwan/err-2026.json,
placing each hospital on the OpenStreetMap hospital the medical plan already holds (data/medfac).
   pip install pdfplumber
   python3 tools/snapshot_tw_err.py <the list PDF> <the grading criteria PDF text>
The list PDF is fetched from LIST_URL (mohw.gov.tw has no API; it was fetched from GitHub Actions); its SHA-256 is kept so the
snapshot names the exact file it was read from. Then python3 tools/build_tw_err.py folds the snapshot into source/sof/tw.json.

Reading the PDF: text in a cell is vertically centred on its row, so lines of one column closer than 18 pt form one cell,
and each cell belongs to the row number nearest its centre (two touching cells are split line by line). The parsed totals
are checked against the list's own (205 hospitals: 54 severe, 75 moderate, 76 general).

Placing: an OSM hospital whose name, with legal-entity prefixes and "(委託...經營)" removed, equals the list's (or one ends
with the other) in the same city or county; ambiguous or absent names stay unplaced (lat null) unless PLACE below names the
OSM object by hand, each checked against the hospital's name and city."""
import hashlib, json, re, sys

LIST_URL = "https://www.mohw.gov.tw/dl-97025-23d029a4-14c2-4ae9-a057-7a32d3885839.html"
STD_URL = "https://mohw.gov.tw/dl-88320-d82c4390-66a8-48aa-a1f0-3cb12dca53d5.html"
OUT = "source/taiwan/err-2026.json"
COLS = [("seq", 25, 52), ("region", 52, 107), ("county", 107, 163), ("name", 163, 333), ("level", 333, 433), ("valid", 433, 570)]
HEAD = ("序", "號", "區域別", "縣市別", "醫院全名", "緊急醫療", "能力分級", "效期")
LEVELS = ("重度級", "中度級", "一般級")
CHAPTERS = ["急診", "急性腦中風", "急性冠心症", "緊急外傷", "高危險妊娠及新生兒醫療", "加護病房"]
TOTALS = {"重度級": 54, "中度級": 75, "一般級": 76}
# by hand, after checking name and city: list name (normalised) -> OSM object, or None where the only candidate is another hospital
PLACE = {"衛生福利部桃園醫院": "w554210472", "光田綜合醫院大甲院區": "w953062133", "臺大醫院": "r4637783", "臺大醫院兒童醫院": "n9652612481",
         "聯新國際醫院": "w343211959", "郭綜合醫院": "w208033952", "臺南市立醫院": "w161308929", "枋寮醫院": "w593366020",
         "成大醫院斗六分院": "w242465369", "陽明醫院": "w817849311", "國軍臺中總醫院中清分院": "r9555409", "國軍左營總醫院岡山分院": "r11598484",
         "道周醫院": "w874820147", "仁和醫院": "n4649245510", "建佑醫院": "w895821895", "耕莘醫院安康院區": "w329147421", "潮州安泰醫院": None,
         "淡水馬偕紀念醫院": "w266072625", "新光吳火獅紀念醫院": "r9968359", "國泰綜合醫院": "r7769533", "徐元智先生醫藥基金會亞東紀念醫院": "w241424548",
         "臺北慈濟醫院": "r5257272", "怡仁綜合醫院": "w586988781", "新竹馬偕紀念醫院": "w254807476", "新竹市立馬偕兒童醫院": "w257026301",
         "大千綜合醫院": "w337350390", "童綜合醫院": "w259922124", "員林基督教醫院": "w265241171", "漢銘基督教醫院": "w751222504",
         "奇美醫院": "w159926467", "柳營奇美醫院": "w150332916", "衛生福利部臺南醫院": "w160088291", "國軍左營總醫院": "w120104992",
         "義大大昌醫院": "w1528033654", "門諾醫院": "w289462283", "臺北榮民總醫院鳳林分院": "r13294585",
         "臺北市立聯合醫院和平婦幼院區": "w197316116", "清泉醫院": "n3961911873", "澄清綜合醫院": "w262848548"}


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def parse(path):
    import pdfplumber
    recs = []
    for pg in pdfplumber.open(path).pages:
        byl = {}
        for c in pg.chars:
            byl.setdefault(round(c["top"]), []).append(c["text"])
        foot = min([t for t, v in byl.items() if "".join(v).startswith(("共", "全國")) or "家。（" in "".join(v)] + [9999])
        cols = {}
        for c in pg.chars:
            if not c["text"].strip() or c["top"] >= foot - 1:
                continue
            x = (c["x0"] + c["x1"]) / 2
            k = next((k for k, a, b in COLS if a <= x < b), None)
            if k:
                cols.setdefault(k, {}).setdefault(round(c["top"]), []).append(c)

        def lines(k):
            out = []
            for t in sorted(cols.get(k, {})):
                s = "".join(c["text"] for c in sorted(cols[k][t], key=lambda c: c["x0"]))
                if out and t - out[-1][1] <= 2:
                    out[-1] = (out[-1][0], t, out[-1][2] + s)
                else:
                    out.append((t, t, s))
            return [(a, s) for a, _, s in out if not s.startswith(("共", "全國", "更新", "（依", "急救責任", "救責任")) and s not in HEAD]
        nums = [(t + 5, int(s)) for t, s in lines("seq") if s.isdigit()]
        if not nums:
            continue
        seq = [(y, i) for i, (y, _) in enumerate(nums)]
        R = {i: {"n": n, "page": pg.page_number} for i, (_, n) in enumerate(nums)}
        for k, _, _ in COLS[1:]:
            blocks = []
            for t, s in lines(k):
                new = (k == "level" and s.startswith(LEVELS)) or (k == "valid" and len(s) >= 18)
                if blocks and t - blocks[-1][-1][0] <= 18 and not new:
                    blocks[-1].append((t, s))
                else:
                    blocks.append([(t, s)])
            for b in blocks:
                inside = [q for q in seq if b[0][0] - 3 <= q[0] - 5 <= b[-1][0] + 3]
                parts = []
                if len(inside) > 1:
                    for ln in b:
                        i = min(seq, key=lambda q: abs(q[0] - (ln[0] + 5)))[1]
                        if parts and parts[-1][0] == i:
                            parts[-1][1].append(ln)
                        else:
                            parts.append((i, [ln]))
                else:
                    mid = (b[0][0] + b[-1][0]) / 2 + 5
                    y, i = min(seq, key=lambda q: abs(q[0] - mid))
                    if abs(y - mid) <= 40:
                        parts.append((i, b))
                for i, ls in parts:
                    R[i][k] = R[i].get(k, "") + (" " if k == "valid" else "") + "".join(s for _, s in ls)
        for r in R.values():
            r["valid"] = re.findall(r"\d{2,3}/\d\d/\d\d", r.get("valid", ""))
            recs.append(r)
    return recs


def roc(d):
    y, m, dd = d.split("/")
    return "%04d-%s-%s" % (int(y) + 1911, m, dd)


def grade(level):
    """the main level and each chapter's level: 重度級 is every chapter at severe, 中度級 every chapter at moderate (中度級* without
    high-risk pregnancy and neonatal care, footnote 1), 一般級 none; "具備<chapters><level>級能力" raises the chapters it names"""
    main = next(l for l in LEVELS if level.startswith(l))
    star = level.startswith("中度級*")
    ch = {c: None for c in CHAPTERS}
    if main != "一般級":
        for c in CHAPTERS:
            ch[c] = None if (star and c == CHAPTERS[4]) else main[:2]
    for m in re.finditer(r"具備(.+?)(重度|中度)級能力", level):
        for c in CHAPTERS:
            if c in m.group(1) or (c == "加護病房" and "加護" in m.group(1)):
                if ch[c] != "重度":
                    ch[c] = m.group(2)
    return main + ("*" if star else ""), ch


def norm(s):
    s = (s or "").replace("台", "臺").replace("衛福部", "衛生福利部").replace("（", "(").replace("）", ")")
    s = re.sub(r"\([^)]*\)", "", s)
    s = re.sub(r"^.*?(醫療財團法人|醫療社團法人|財團法人|社團法人)", "", s)
    s = re.sub(r"[-(]?委託.*$", "", s)
    s = re.sub(r"附設民眾診療服務處$", "", s)
    return s.replace("榮總", "榮民總醫院").replace("國立臺灣大學醫學院附設醫院", "臺大醫院").replace("國立成功大學醫學院附設醫院", "成大醫院").strip()


def split(name):
    """a row naming a hospital and its children's hospital, designated together"""
    i = name.find("醫院")
    if "兒童醫院" in name[i + 2:] and "兒童" not in name[:i] and name[i + 2:i + 4] not in ("分院", "院區"):
        return [name[:i + 2], name[i + 2:]]
    return [name]


def osm_hospitals():
    idx = json.load(open("data/medfac/index.json"))["countries"]["tw"]
    H = []
    for t in idx["tiles"]:
        for r in json.load(open("data/medfac/t/%s.json" % t)):
            if r[3] == "tw" and (r[4].get("amenity") == "hospital" or r[4].get("healthcare") == "hospital"):
                H.append(r)
    return H, idx["at"]


def place(H, n, county):
    cn = county.replace("台", "臺")
    out = []
    for r in H:
        t = r[4]
        names = [norm(t.get(k)) for k in ("name", "official_name", "name:zh", "alt_name") if t.get(k)]
        how = "exact" if n in names else "suffix" if any(len(x) >= 4 and len(n) >= 4 and (n.endswith(x) or x.endswith(n)) for x in names) else None
        city = (t.get("addr:city") or "").replace("台", "臺")
        if how and cn and city and cn[:2] not in city:
            how = None
        if how:
            out.append((how, r))
    ex = [r for h, r in out if h == "exact"]
    out = ex or [r for _, r in out]
    if len(out) > 1:
        same = [r for r in out if cn in (r[4].get("addr:city", "") + r[4].get("addr:full", "") + r[4].get("addr:province", "")).replace("台", "臺")]
        out = same or out
    if len(out) > 1:
        out = [r for r in out if norm(r[4].get("name")) == n] or out
    # a short common name (仁愛醫院) with no city on the OSM object could be another town's
    if len(out) == 1 and len(n) <= 5 and not out[0][4].get("addr:city"):
        return None
    return out[0] if len(out) == 1 else None


def main():
    pdf, std = sys.argv[1], sys.argv[2]
    rows = parse(pdf)
    got = {l: sum(1 for r in rows if r["level"].startswith(l)) for l in LEVELS}
    assert got == TOTALS, got
    H, osm_at = osm_hospitals()
    by = {r[0]: r for r in H}
    out = []
    for i, r in enumerate(rows):
        lvl, ch = grade(r["level"])
        for nm in split(r["name"]):
            n = norm(nm)
            o = (by.get(PLACE[n]) if PLACE[n] else None) if n in PLACE else place(H, n, r["county"])
            out.append({"row": i + 1, "n": r["n"], "page": r["page"], "region": r["region"], "county": r["county"], "list_name": nm, "level": lvl,
                        "level_text": r["level"], "chapters": ch, "valid_from": roc(r["valid"][0]) if r["valid"] else None,
                        "valid_to": roc(r["valid"][1]) if len(r["valid"]) > 1 else None,
                        "osm": o[0] if o else None, "lat": o[1] if o else None, "lon": o[2] if o else None,
                        "osm_name": o[4].get("name") if o else None, "osm_name_en": o[4].get("name:en") if o else None,
                        "placed_by": ("hand" if n in PLACE else "name") if o else None})
    snap = {"schema": "osap-tw-err/1", "asof": "2026-10-20", "list_updated": "2026-04-29", "osm_at": osm_at,
            "sources": {"list": {"url": LIST_URL, "sha256": sha(pdf), "title": "急救責任醫院分區名單 (依能力分級排序), 更新日期 115/4/29"},
                        "standard": {"url": STD_URL, "sha256": sha(std), "title": "113年度醫院緊急醫療能力分級評定基準及評分說明與評量方法 (113年4月11日衛部醫字第1131662354號公告)"}},
            "hospitals": out}
    open(OUT, "w", encoding="utf-8").write(json.dumps(snap, indent=1, ensure_ascii=False))
    print("tw: %d rows, %d hospitals, %d placed" % (len(rows), len(out), sum(1 for h in out if h["lat"] is not None)))


if __name__ == "__main__":
    main()
