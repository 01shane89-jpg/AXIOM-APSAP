"""Snapshot South Korea's MOHW-designated regional trauma centres (권역외상센터) and regional emergency medical centres
(권역응급의료센터) as source/korea/emergency-2026.json, placed on the OpenStreetMap hospitals the medical plan holds.
   python3 tools/snapshot_kr_emergency.py <trauma PDF> <regional centres PDF> <institution types PDF>
All three are MOHW press attachments (mohw.go.kr has no API; fetched from GitHub Actions), each kept by SHA-256:
  trauma   2026-01-15 press release on preventable trauma deaths, attachment 1 "권역외상센터 지정 현황" (17 centres, date of
           each centre's latest designation)
  centres  2026-07-15 press reference "최종치료 역량 갖춘 권역응급의료센터 53개소 선정", attachment 2: the 53 hospitals that hold
           the regional emergency medical centre role from 2026-11-01 to 2029-10-31; "신규" marks the 12 newly selected
  types    2025-01-03 press reference "2024년 응급의료기관 평가결과", attachment 1: MOHW's table of what each type of emergency
           medical institution must have (facilities, equipment, staff, operation)
Placing is by hand (PLACE): Korean OSM names vary and several share a name in other cities (경상대학교병원 is the Jinju
hospital, not the Changwon one), so each OSM object was checked against the hospital's name and city. Hospitals with no
OSM hospital object stay unplaced (lat null)."""
import hashlib, json, re, sys

OUT = "source/korea/emergency-2026.json"
URLS = {"trauma": "https://www.mohw.go.kr/boardDownload.es?bid=0027&list_no=1488615&seq=2",
        "trauma_page": "https://mohw.go.kr/board.es?act=view&bid=0027&cg_code=&list_no=1488615&mid=a10503010100&tag=",
        "centres": "https://www.mohw.go.kr/boardDownload.es?bid=0027&list_no=1491285&seq=2",
        "centres_page": "https://www.mohw.go.kr/board.es?act=view&bid=0027&list_no=1491285&mid=a10503010100",
        "types": "https://www.mohw.go.kr/boardDownload.es?bid=0027&list_no=1484207&seq=2",
        "types_page": "https://www.mohw.go.kr/board.es?mid=a10503000000&bid=0027&list_no=1484207&act=view"}
# list name -> OSM object (checked by hand), or None where OSM has no hospital object for it
PLACE = {
    "목포한국병원": "w976021263", "가천대길병원": "r17320024", "의료법인 길의료재단 길병원": "r17320024", "단국대병원": "w368095491",
    "단국대학교의과대학부속병원": "w368095491", "연세대원주기독병원": "w469952644", "연세대학교원주세브란스기독병원": "w469952644",
    "울산대학교병원": "w472296333", "학교법인울산공업학원울산대학교병원": "w472296333", "전남대학교병원": "w483685292",
    "부산대학교병원": "w471349526", "을지대학교병원": "w504118791", "아주대학교병원": "w297874790", "충북대학교병원": "w151686683",
    "의정부성모병원": "w705402115", "가톨릭대학교의정부성모병원": "w705402115", "경북대학교병원": "w826104634",
    "의료법인안동병원": "w547375590", "원광대학교병원": "w552025577", "제주한라병원": "w371635505", "국립중앙의료원": "w358284971",
    "경상대학교병원": "w1305665482", "경상국립대학교병원": "w1305665482",
    "연세대학교의과대학세브란스병원": "w369559505", "서울대학교병원": "w223434840", "학교법인고려중앙학원고려대학교의과대학부속병원(안암병원)": None,
    "서울특별시서울의료원": "w369788217", "고려대학교의과대학부속구로병원": "w250489344", "이화여자대학교의과대학부속서울병원": "w465480953",
    "재단법인아산사회복지재단서울아산병원": "w503505209", "한양대학교병원": "w187354410", "동아대학교병원": "w1158957078",
    "양산부산대학교병원": "w659640114", "인제대학교부산백병원": None, "인제대학교 해운대백병원": "w499049732", "대구가톨릭대학교병원": "w814263745",
    "계명대학교동산병원": None, "인하대학교의과대학부속병원": "w410767647", "순천향대학교부속부천병원": "w468658111",
    "가톨릭대학교 인천성모병원": None, "조선대학교병원": "w485036232", "충남대학교병원": "r19053009", "학교법인건양교육재단건양대학교병원": None,
    "국민건강보험공단일산병원": "w603098580", "인제대학교일산백병원": "w613609579", "의료법인명지의료재단명지병원": "w468979015",
    "한림대학교성심병원": "w249856060", "고려대학교의과대학부속안산병원": "w474206577", "차의과학대학교분당차병원": "w428082081",
    "분당서울대학교병원": "w232198027", "강릉아산병원": "n368812716", "강원대학교병원": "w471766140", "한림대학교춘천성심병원": "w478630456",
    "학교법인동은학원순천향대학교부속천안병원": None, "전북대학교병원": "w981579168", "재단법인예수병원유지재단예수병원": "w36811018",
    "성가롤로병원": "w482363189", "차의과학대학교부속구미차병원": "n368831951", "포항성모병원": "w662012260", "창원한마음병원": "w1060897531",
    "학교법인성균관대학삼성창원병원": "w1060056945", "제주대학교병원": "w369681533"}


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def text(p):
    import subprocess
    return subprocess.run(["pdftotext", "-layout", p, "-"], capture_output=True, text=True, check=True).stdout


def ymd(s):
    y, m, d = re.findall(r"\d+", s)
    return "20%s-%02d-%02d" % (y, int(m), int(d))


def osm():
    idx = json.load(open("data/medfac/index.json"))["countries"]["kr"]
    H = {}
    for t in idx["tiles"]:
        for r in json.load(open("data/medfac/t/%s.json" % t)):
            if r[3] == "kr":
                H[r[0]] = r
    return H, idx["at"]


def main():
    tp, cp, yp = sys.argv[1:4]
    tt, ct = text(tp), text(cp)
    trauma = [{"n": int(m.group(1)), "region": m.group(2), "list_name": m.group(3), "designated": ymd(m.group(4)), "city_note": (m.group(5) or "").strip()}
              for m in re.finditer(r"^\s*(\d{1,2})\s+(\S+)\s+(\S+)\s+(’\d\d\.\d{1,2}\.\d{1,2}\.)\s*(\S*)\s*$", tt[tt.find("권역외상센터 지정 현황", tt.find("붙임1")):], re.M)]
    assert len(trauma) == 17, len(trauma)
    seg = ct[ct.find("붙임2"):]
    seg = seg[seg.find("연번"):]
    centres = [{"n": int(m.group(1)), "region": m.group(2), "list_name": m.group(3).strip(), "new": bool(m.group(4))}
               for m in re.finditer(r"^\s*(\d{1,2})\s+(\S+)\s+(.+?)(?:\s{2,}(신규))?\s*$", seg, re.M)]
    assert len(centres) == 53 and sum(c["new"] for c in centres) == 12, (len(centres), sum(c["new"] for c in centres))
    H, at = osm()
    for x in trauma + centres:
        o = H.get(PLACE[x["list_name"]]) if PLACE[x["list_name"]] else None
        x.update({"osm": o[0] if o else None, "lat": o[1] if o else None, "lon": o[2] if o else None,
                  "osm_name": o[4].get("name") if o else None, "osm_name_en": o[4].get("name:en") if o else None})
    snap = {"schema": "osap-kr-emergency/1", "asof": "2026-10-20", "osm_at": at,
            "sources": {"trauma": {"url": URLS["trauma"], "page": URLS["trauma_page"], "sha256": sha(tp), "published": "2026-01-14",
                                   "title": "2015년 30.5%에서 2023년 9.1%로 예방 가능한 외상 사망률 꾸준한 감소 추세, 붙임1 권역외상센터 지정 현황"},
                        "centres": {"url": URLS["centres"], "page": URLS["centres_page"], "sha256": sha(cp), "published": "2026-07-15",
                                    "title": "최종치료 역량 갖춘 권역응급의료센터 53개소 선정, 붙임2 2026~2029년 권역응급의료센터 선정 기관", "term": ["2026-11-01", "2029-10-31"]},
                        "types": {"url": URLS["types"], "page": URLS["types_page"], "sha256": sha(yp), "published": "2025-01-03",
                                  "title": "2024년 응급의료기관 평가결과 발표, 붙임1 응급의료기관 종별 구분 개요"}},
            "trauma_centres": trauma, "regional_centres": centres}
    open(OUT, "w", encoding="utf-8").write(json.dumps(snap, indent=1, ensure_ascii=False))
    print("kr: %d trauma centres (%d placed), %d regional emergency centres (%d placed)" % (
        len(trauma), sum(1 for x in trauma if x["lat"] is not None), len(centres), sum(1 for x in centres if x["lat"] is not None)))


if __name__ == "__main__":
    main()
