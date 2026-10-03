"""Fold what hospitals' own websites state (tools/read_hospital_sites.mjs output) into OSAP's sourced list.

  python3 tools/apply_hospital_sites.py hospital-sites-out/hospital-sites-th.json [--dry]

Each capability becomes a "caps" entry on the hospital's record in source/sof/<cc>.json (SCHEMA.txt): the page URL, the
hospital's name as publisher, the quoted text that states it, quote_basis "hospital website text (automatic match)" and the
date read. Quotes from news, procurement, job or event pages are dropped (a hospital buying a CT scanner or a patient sent
to another hospital's ICU does not document its own service). Hospitals OSAP's list lacks are added when their site states
at least one clinical capability, at the OpenStreetMap location of the entry that gave the website. Beds and an
international patient service are kept as quoted notes (beds_note, intl), not capabilities. Existing caps are kept; an entry
from an official page title is replaced only by a page-text quote for the same capability. data/sof/<cc>.js is rewritten the
way tools/apply_evac.py writes it.
"""
import hashlib, json, os, re, sys

SKIP_URL = re.compile(r"news|ข่าว|activit|event|blog|article|job|career|recruit|สมัครงาน|รับสมัคร|procure|purchase|จัดซื้อ|จัดจ้าง|ประกวดราคา|bid|tender|announce|ประกาศ|gallery|ภาพกิจกรรม|calendar", re.I)
SKIP_QUOTE = re.compile(r"จัดซื้อ|ประกวดราคา|ราคากลาง|purchase|procure|tender|bid|ส่งต่อ.*ไปยัง|refer(red)? to", re.I)
CLINICAL = {"ed.basic", "ed.24_7", "trauma.team", "surg.trauma", "surg.general", "surg.or_emergency", "blood.bank", "dx.ct", "dx.mri",
            "cc.icu", "cc.ventilator", "surg.neuro", "surg.ortho", "surg.vascular", "surg.thoracic", "surg.plastic", "spec.burn"}


def fp(item):
    o = {k: v for k, v in item.items() if k != "fp"}
    return hashlib.sha256(json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60] or "hospital"


def main(path, dry):
    R = json.load(open(path, encoding="utf-8"))
    cc, asof = R["cc"], R["at"][:10]
    src_path = os.path.join("source/sof", cc + ".json")
    S = json.load(open(src_path, encoding="utf-8"))
    H = S.setdefault("hospitals", [])
    by_id = {h["id"]: h for h in H}
    n = {"caps": 0, "hospitals": 0, "added": 0, "dropped": 0}
    for site in R["sites"]:
        name = site.get("name") or site.get("name_local") or ""
        good = {}
        for k, L in (site.get("hits") or {}).items():
            for x in L:
                if SKIP_URL.search(x["url"]) or SKIP_QUOTE.search(x["quote"]):
                    n["dropped"] += 1
                    continue
                good.setdefault(k, x)
        caps = {k: v for k, v in good.items() if not k.startswith("info.")}
        if not caps:
            continue
        pub = (name or "Hospital") + " website"
        rec = by_id.get(site["id"])
        if not rec:
            if not (CLINICAL & set(caps)) or site.get("lat") is None:
                continue
            rec = {"id": "sof:%s:hospital:%s" % (cc, slug(name or site.get("name_local", ""))), "name": name or site.get("name_local"),
                   "name_local": site.get("name_local") or None, "city": None, "address": None, "emergency_24h": None, "type": None, "trauma_level": None,
                   "notes": None, "lat": round(site["lat"], 6), "lon": round(site["lon"], 6), "prec": "exact",
                   "coord_basis": "OpenStreetMap location of the entry that lists this website" if site["id"].startswith("osm:") else "approximate published location; verify",
                   "src": site.get("web") or caps[next(iter(caps))]["url"], "srcname": pub}
            if rec["id"] in by_id:
                continue
            H.append(rec)
            by_id[rec["id"]] = rec
            n["added"] += 1
        C = rec.setdefault("caps", {})
        for k, x in caps.items():
            old = C.get(k)
            if old and old.get("quote_basis") != "official page title":
                continue
            C[k] = {"src": x["url"], "srcname": pub, "quote": x["quote"][:240], "quote_basis": "hospital website text (automatic match)", "asof": asof}
            n["caps"] += 1
        if "info.beds" in good:
            rec["beds_note"] = {"src": good["info.beds"]["url"], "quote": good["info.beds"]["quote"][:200], "asof": asof}
        if "info.international" in good:
            rec["intl"] = {"src": good["info.international"]["url"], "quote": good["info.international"]["quote"][:200], "asof": asof}
        rec["fp"] = fp(rec)
        n["hospitals"] += 1
    print(n)
    if dry:
        return
    S["hospital_sites_asof"] = asof
    open(src_path, "w", encoding="utf-8").write(json.dumps(S, indent=1, ensure_ascii=False))
    body = json.dumps(S, separators=(",", ":")).replace("</", "<\\/")
    open(os.path.join("data/sof", cc + ".js"), "w").write("window.ASAP_SOF=window.ASAP_SOF||{};window.ASAP_SOF[%s]=%s;" % (json.dumps(cc), body))


if __name__ == "__main__":
    main(sys.argv[1], "--dry" in sys.argv)
