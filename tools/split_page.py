"""Split the single-file ASAP page (as published to claude.ai) into the repo layout.

Usage: python3 tools/split_page.py <published-index.html>
Writes index.html plus data/*.js. Every embedded data block becomes its own script
file, loaded in the same order, so the page behaves exactly like the published one.
"""
import re, sys, os, json

src = open(sys.argv[1], encoding="utf-8").read()
FIXED = {"POWER": "data/thailand/power.js", "LIVE": "data/thailand/flood-live-snapshot.js",
         "EXPOSURE": "data/thailand/flood-exposure.js", "PROVINCES": "data/thailand/province-alerts.js",
         "BORDER": "data/thailand/border-geometry.js", "CONFLICT": "data/thailand/border-conflict.js",
         "COUNTRY_BASE": "data/basemap/country-outlines.js", "ASAP_SOF_OUT": "data/sof/exercises-outside.js",
         "ASAP_QUAKES": "data/live/quakes.js", "ASAP_AQ": "data/live/air-quality.js"}
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
    s = re.match(r'\s*window\.ASAP_SOF=window\.ASAP_SOF\|\|\{\};window\.ASAP_SOF\["([a-z]+)"\]', body)
    if s:
        return out("data/sof/%s.js" % s.group(1), body)
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
# the app ships its own copy of Leaflet so it runs with no network at all
page = page.replace('<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"></script>', '<script src="assets/vendor/leaflet-1.9.4.js"></script>')
# installable app (PWA): manifest, icons and service worker live only in the repo build
PWA_HEAD = ('<link rel="manifest" href="manifest.webmanifest"><meta name="theme-color" content="#12324a">'
            '<link rel="apple-touch-icon" href="assets/icons/apple-touch-icon.png">'
            '<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">'
            '<meta name="apple-mobile-web-app-title" content="ASAP"><meta name="apple-mobile-web-app-status-bar-style" content="default">')
PWA_TAIL = ('<script>if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) '
            'window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });</script>')
if not page.lstrip().lower().startswith("<!doctype"):
    page = ('<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' + PWA_HEAD + '</head><body>\n' + page + "\n" + PWA_TAIL + "\n</body></html>\n")
open("index.html", "w", encoding="utf-8").write(page)

# service worker: precache the shell and every packaged file; the version changes whenever any of them does
import hashlib, glob
shell = ["./", "index.html", "manifest.webmanifest"] + written + sorted(glob.glob("assets/*.js") + glob.glob("assets/*.png") + glob.glob("assets/icons/*.png") + glob.glob("assets/vendor/*.js"))
h = hashlib.sha256()
for f in shell:
    if os.path.exists(f) and not f.endswith("/"): h.update(open(f, "rb").read())
sw = open("tools/sw.template.js", encoding="utf-8").read().replace("__VERSION__", h.hexdigest()[:12]).replace("__PRECACHE__", json.dumps(shell, indent=0))
open("sw.js", "w", encoding="utf-8").write(sw)
print(len(written), "data files;", len(page), "bytes of page")
