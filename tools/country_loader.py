"""Rewrite the per-country data loader in index.html from the files in data/layers, data/sof and data/brief.

The page loads only the country it opens (changing country reloads the page), so instead of one <script> tag per file for
every country, index.html carries a small inline loader with the list of files per country and the record count of each
layer (the country picker shows those counts without loading the files). Run this after adding or changing any file in
those folders: python3 tools/country_loader.py
News and social posts are loaded the same way, from data/live/news/<cc>.js and data/live/social/<cc>.js.
"""
import json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
START, END = "<!-- country-data:start -->", "<!-- country-data:end -->"


def manifest():
    lay, sof, brief = {}, [], []
    base = os.path.join(ROOT, "data", "layers")
    for cc in sorted(os.listdir(base)):
        d = os.path.join(base, cc)
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if not f.endswith(".js"):
                continue
            body = open(os.path.join(d, f), encoding="utf-8").read()
            m = re.search(r'^window\.TSAP_DATA=window\.TSAP_DATA\|\|\{\};window\.TSAP_DATA\["[^"]+"\]=', body)
            data = json.loads(body[m.end():].strip().rstrip(";")) if m else {}
            lay.setdefault(cc, {})[f[:-3]] = len(data.get("events") or [])
    for name, out in (("sof", sof), ("brief", brief)):
        for f in sorted(os.listdir(os.path.join(ROOT, "data", name))):
            if re.fullmatch(r"[a-z]{2,3}\.js", f):
                out.append(f[:-3])
    return {"layers": lay, "sof": sof, "brief": brief}


def block(m):
    return (START + "\n<script>\n"
            "/* Per-country data. Only the country being opened is loaded (switching country reloads the page), which keeps\n"
            "   startup from fetching every country's layers. Written by tools/country_loader.py; do not edit by hand. */\n"
            "window.OSAP_COUNTRY_FILES = " + json.dumps(m, separators=(",", ":")) + ";\n"
            "(function () {\n"
            "  var M = window.OSAP_COUNTRY_FILES, h = (location.hash || \"\").replace(\"#\", \"\").split(\"/\");\n"
            "  var cc = h.length > 1 && /^[a-z]{2,3}$/.test(h[0]) ? h[0] : \"th\", src = [];\n"
            "  Object.keys(M.layers[cc] || {}).forEach(function (l) { src.push(\"data/layers/\" + cc + \"/\" + l + \".js\"); });\n"
            "  if (M.sof.indexOf(cc) >= 0) src.push(\"data/sof/\" + cc + \".js\");\n"
            "  if (M.brief.indexOf(cc) >= 0) src.push(\"data/brief/\" + cc + \".js\");\n"
            "  /* news and social posts: the refresh job writes one file per country (tools/split_country.mjs) */\n"
            "  src.push(\"data/live/news/\" + cc + \".js\", \"data/live/social/\" + cc + \".js\");\n"
            "  /* feeds that cover every country but are too big to load whole: sanctions lists and UCDP events (tools/refresh_more.mjs) */\n"
            "  src.push(\"data/live/sanctions/\" + cc + \".js\", \"data/live/ucdp/\" + cc + \".js\");\n"
            "  /* automatic layer reports from the news pool (tools/refresh_layerfeed.mjs) */\n"
            "  src.push(\"data/live/layerfeed/\" + cc + \".js\");\n"
            "  document.write(src.map(function (s) { return '<script src=\"' + s + '\"><\\/script>'; }).join(\"\"));\n"
            "})();\n"
            "</script>\n" + END)


def main():
    p = os.path.join(ROOT, "index.html")
    s = open(p, encoding="utf-8").read()
    m = manifest()
    if START in s:
        s = re.sub(re.escape(START) + ".*?" + re.escape(END), lambda _: block(m), s, count=1, flags=re.S)
    else:
        tags = re.compile(r'(?:<script src="data/(?:layers/[a-z]+/[a-z]+|sof/[a-z]{2,3}|brief/[a-z]{2,3})\.js"></script>\n)+')
        k = tags.search(s)
        if not k:
            raise SystemExit("no per-country script tags or loader markers found in index.html")
        s = s[:k.start()] + block(m) + "\n" + s[k.end():]
    open(p, "w", encoding="utf-8").write(s)
    print("countries:", len(m["layers"]), "layer files:", sum(len(v) for v in m["layers"].values()))


if __name__ == "__main__":
    main()
