"""Test only: compares keyless high-resolution imagery tile services over SE Asia from GitHub's runners.
For each place and zoom it fetches one tile per service and prints HTTP status, bytes, a hash (to spot "no data"
placeholder tiles, which repeat) and a sharpness score (variance of the Laplacian; higher = more fine detail).
Google and Bing are fetched only as a yardstick: their terms do not allow keyless tile use, so OSAP cannot ship them.
Also asks Esri's World_Imagery_Metadata service for the image date, resolution and provider under each place.
Writes probe-out/ (tiles + imagery.json); nothing is written to the repo."""
import hashlib, io, json, math, os, sys, urllib.request, urllib.parse
from PIL import Image, ImageFilter, ImageStat

PLACES = {"Bangkok": (13.7466, 100.5393), "Yala": (6.5411, 101.2804), "Pattani": (6.8695, 101.2505),
          "Manila": (14.5836, 120.9790), "Hanoi": (21.0285, 105.8542), "Mandalay": (21.9588, 96.0891),
          "Dili": (-8.5569, 125.5603), "Port Moresby": (-9.4438, 147.1803), "Marawi": (7.9986, 124.2928),
          "Rural Isan": (15.2448, 104.8473)}
ZOOMS = [16, 17, 18, 19, 20, 21]

def wayback_release():
    try:
        cfg = json.load(urllib.request.urlopen("https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json", timeout=30))
        rel = max(cfg, key=lambda k: int(k))
        return rel, cfg[rel].get("itemTitle")
    except Exception as e:
        return None, str(e)

REL, REL_TITLE = wayback_release()
SERVICES = {
    "esri": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    "esri-clarity": "https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    "esri-wayback-latest": "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/" + str(REL) + "/{z}/{y}/{x}",
    "yardstick-google": "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
    "yardstick-bing": "https://ecn.t1.tiles.virtualearth.net/tiles/a{q}.jpeg?g=1",
}

def tile(lat, lon, z):
    n = 2 ** z
    return int((lon + 180) / 360 * n), int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)

def quadkey(x, y, z):
    q = ""
    for i in range(z, 0, -1):
        d, m = 0, 1 << (i - 1)
        if x & m: d += 1
        if y & m: d += 2
        q += str(d)
    return q

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "OSAP-imagery-probe/1 (github.com/01shane89-jpg/AXIOM-APSAP)"})
    try:
        r = urllib.request.urlopen(req, timeout=30)
        return r.status, r.headers.get("Content-Type", ""), r.read()
    except urllib.error.HTTPError as e:
        return e.code, "", b""
    except Exception as e:
        return 0, str(e)[:60], b""

def sharp(b):
    try:
        im = Image.open(io.BytesIO(b)).convert("L")
        return round(ImageStat.Stat(im.filter(ImageFilter.FIND_EDGES)).var[0], 1)
    except Exception:
        return None

def meta(lat, lon, z):
    ext = 0.01
    q = urllib.parse.urlencode({"geometry": f"{lon},{lat}", "geometryType": "esriGeometryPoint", "sr": 4326, "layers": "all",
        "tolerance": 0, "mapExtent": f"{lon-ext},{lat-ext},{lon+ext},{lat+ext}", "imageDisplay": "1000,1000,96",
        "returnGeometry": "false", "f": "json"})
    try:
        d = json.load(urllib.request.urlopen("https://metadata.maptiles.arcgis.com/arcgis/rest/services/World_Imagery_Metadata/MapServer/identify?" + q, timeout=30))
        return [{k: r["attributes"].get(k) for k in ("SRC_DATE", "SRC_DATE2", "SRC_RES", "SRC_ACC", "SRC_DESC", "NICE_NAME", "NICE_DESC")} | {"layer": r.get("layerName")} for r in d.get("results", [])][:3]
    except Exception as e:
        return str(e)[:80]

os.makedirs("probe-out", exist_ok=True)
print("Wayback latest release:", REL, REL_TITLE)
out = {"wayback": [REL, REL_TITLE], "rows": [], "meta": {}}
for p, (la, lo) in PLACES.items():
    out["meta"][p] = meta(la, lo, 18)
    print(f"\n== {p}  metadata: {json.dumps(out['meta'][p])[:400]}")
    for s, u in SERVICES.items():
        cells = []
        for z in ZOOMS:
            x, y = tile(la, lo, z)
            st, ct, b = fetch(u.format(z=z, x=x, y=y, q=quadkey(x, y, z)))
            h = hashlib.sha1(b).hexdigest()[:8] if b else "-"
            sc = sharp(b) if b else None
            if b: open(f"probe-out/{p.replace(' ', '_')}_{s}_z{z}.jpg", "wb").write(b)
            out["rows"].append({"place": p, "svc": s, "z": z, "status": st, "bytes": len(b), "sha1": h, "sharp": sc, "ctype": ct})
            cells.append(f"z{z}:{st}/{len(b)//1000}k/{h}/{sc}")
        print(f"{s:22s} " + "  ".join(cells))
json.dump(out, open("probe-out/imagery.json", "w"), indent=1)
