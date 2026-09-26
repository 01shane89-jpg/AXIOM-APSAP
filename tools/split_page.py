"""Split the single-file APSAP page (as published to claude.ai) into the repo layout.

Usage: python3 tools/split_page.py <published-index.html>
Writes index.html plus data/*.js. Every embedded data block becomes its own script
file, loaded in the same order, so the page behaves exactly like the published one.
"""
import re, sys, os, json

src = open(sys.argv[1], encoding="utf-8").read()
FIXED = {"POWER": "data/thailand/power.js", "LIVE": "data/thailand/flood-live-snapshot.js",
         "EXPOSURE": "data/thailand/flood-exposure.js", "PROVINCES": "data/thailand/province-alerts.js",
         "BORDER": "data/thailand/border-geometry.js", "CONFLICT": "data/thailand/border-conflict.js",
         "COUNTRY_BASE": "data/basemap/country-outlines.js"}
written = []

def out(path, body):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "w", encoding="utf-8").write(body.strip() + "\n")
    written.append(path)
    return '<script src="%s"></script>' % path

def repl(m):
    body = m.group(1)
    g = re.match(r'\s*window\.([A-Z_]+)\s*=', body)
    if g and g.group(1) in FIXED:
        return out(FIXED[g.group(1)], body)
    k = re.match(r'\s*window\.TSAP_DATA=window\.TSAP_DATA\|\|\{\};window\.TSAP_DATA\["([a-z]+)(?:/([a-z]+))?"\]', body)
    if k:
        cc, lid = (k.group(1), k.group(2)) if k.group(2) else ("th", k.group(1))
        return out("data/layers/%s/%s.js" % (cc, lid), body)
    return m.group(0)

page = re.sub(r'<script>(.*?)</script>', repl, src, flags=re.S)
# the packaged tiles live under assets/ in the repo
page = page.replace('<script src="tiles-flood.js">', '<script src="assets/tiles-flood.js">')
page = page.replace('s.src = "tiles-flood25.js"', 's.src = "assets/tiles-flood25.js"')
page = page.replace('src: "tiles-base.js"', 'src: "assets/tiles-base.js"').replace('src: "tiles-base-dark.js"', 'src: "assets/tiles-base-dark.js"')
if not page.lstrip().lower().startswith("<!doctype"):
    page = ('<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1"></head><body>\n' + page + "\n</body></html>\n")
open("index.html", "w", encoding="utf-8").write(page)
print(len(written), "data files;", len(page), "bytes of page")
