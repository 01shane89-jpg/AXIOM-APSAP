# Reads a Wikipedia timeline page's wikitext (https://en.wikipedia.org/wiki/<page>?action=raw) and lists the reports it cites:
# one row per (day, citation): the day heading it sits under, the subheading (who struck whom), the citation's url, headline,
# outlet, date and language, and the sentence it supports (used only to place and sort the report, never stored or shown:
# Wikipedia's text is CC BY-SA). The reports themselves are the outlets' own headlines and links.
# Usage: python3 -I tools/conflict_extras/wp_timeline.py <wikitext file> <rows.json> [year] [--by-date]
import re, json, sys
src = open(sys.argv[1], encoding="utf8").read()
# a ref's text may run over several lines: fold it onto one so each item is one line
src = re.sub(r"<ref[^>]*?(?<!/)>.*?</ref>", lambda m: m.group(0).replace("\n", " "), src, flags=re.S | re.I)
year = int(sys.argv[3]) if len(sys.argv) > 3 else 2026
MON = {m: i + 1 for i, m in enumerate("January February March April May June July August September October November December".split())}

def cite_fields(c):
    f = {}
    body = c.strip()[2:-2]
    # split on top-level pipes
    depth = 0; part = ""; parts = []
    i = 0
    while i < len(body):
        ch = body[i]
        if body.startswith("{{", i) or body.startswith("[[", i): depth += 1; part += body[i:i+2]; i += 2; continue
        if body.startswith("}}", i) or body.startswith("]]", i): depth -= 1; part += body[i:i+2]; i += 2; continue
        if ch == "|" and depth == 0: parts.append(part); part = ""; i += 1; continue
        part += ch; i += 1
    parts.append(part)
    f["_type"] = parts[0].strip().lower()
    for p in parts[1:]:
        if "=" in p:
            k, v = p.split("=", 1); f[k.strip().lower()] = v.strip()
    return f

def clean(s):
    s = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", s)
    s = re.sub(r"\{\{[^{}]*\}\}", "", s)
    s = re.sub(r"'{2,}", "", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = re.sub(r"\[https?://\S+ ([^\]]*)\]", r"\1", s)
    return re.sub(r"\s+", " ", s).strip()

# every named ref's citation, wherever it is defined
REF_DEF = re.compile(r"<ref\s+name\s*=\s*\"?([^\">/]+?)\"?\s*>(.*?)</ref>", re.S | re.I)
named = {}
for m in REF_DEF.finditer(src):
    c = re.search(r"\{\{\s*(?:#invoke:\s*)?[Cc]ite[^{}]*(?:\{\{[^{}]*\}\}[^{}]*)*\}\}", m.group(2))
    if c: named.setdefault(m.group(1).strip(), cite_fields(c.group(0)))

REF_ANY = re.compile(r"<ref(?:\s+name\s*=\s*\"?([^\">/]+?)\"?)?\s*(?:/>|>(.*?)</ref>)", re.S | re.I)
rows = []; day = None; sub = ""; month = None
for line in src.split("\n"):
    h = re.match(r"^(=+)\s*(.*?)\s*\1\s*$", line)
    if h:
        lvl, t = len(h.group(1)), clean(h.group(2))
        if lvl == 2:
            month = MON.get(t); day = None
            if t in ("See also", "Notes", "References"): break
        elif lvl == 3:
            d = re.match(r"(\d{1,2})\s+([A-Z][a-z]+)", t)
            day = "%d-%02d-%02d" % (year, MON[d.group(2)], int(d.group(1))) if d and d.group(2) in MON else None; sub = ""
        elif lvl >= 4: sub = t
        continue
    if not day or not line.strip() or line.startswith("[[File:") or line.startswith("{{"): continue
    # walk refs: the text since the previous ref group is the claim they support
    pos = 0; pending = ""
    for m in REF_ANY.finditer(line):
        seg = line[pos:m.start()]; pos = m.end()
        if clean(seg): pending = seg
        c = None
        if m.group(2):
            cm = re.search(r"\{\{\s*(?:#invoke:\s*)?[Cc]ite[^{}]*(?:\{\{[^{}]*\}\}[^{}]*)*\}\}", m.group(2))
            c = cite_fields(cm.group(0)) if cm else None
        elif m.group(1): c = named.get(m.group(1).strip())
        if not c or not c.get("url") or not c.get("title"): continue
        rows.append({"day": day, "sub": sub, "text": clean(pending)[-400:], "url": c.get("url"), "title": clean(c.get("title")),
                     "work": clean(c.get("work") or c.get("website") or c.get("newspaper") or c.get("publisher") or c.get("agency") or ""),
                     "date": c.get("date", ""), "lang": c.get("language", ""), "trans": clean(c.get("trans-title", ""))})
# --by-date: an article that is not a day-by-day timeline (the war's main article): every citation, dated by its own date field
if len(sys.argv) > 4 and sys.argv[4] == "--by-date":
    import datetime
    rows = []
    for m in re.finditer(r"\{\{\s*(?:#invoke:\s*)?[Cc]ite[^{}]*(?:\{\{[^{}]*\}\}[^{}]*)*\}\}", src):
        c = cite_fields(m.group(0)); d = c.get("date", "")
        day = None
        for fmt in ("%d %B %Y", "%B %d, %Y", "%Y-%m-%d", "%d %b %Y", "%b %d, %Y"):
            try: day = datetime.datetime.strptime(d.strip(), fmt).date().isoformat(); break
            except Exception: pass
        if not day or not c.get("url") or not c.get("title"): continue
        rows.append({"day": day, "sub": "", "text": "", "url": c.get("url"), "title": clean(c.get("title")),
                     "work": clean(c.get("work") or c.get("website") or c.get("newspaper") or c.get("publisher") or c.get("agency") or ""),
                     "date": d, "lang": c.get("language", ""), "trans": clean(c.get("trans-title", "")), "dated_by": "publication"})
json.dump(rows, open(sys.argv[2], "w"), ensure_ascii=False, indent=0)
print(len(rows), "rows;", len({r["url"] for r in rows}), "urls;", len({r["day"] for r in rows}), "days")
