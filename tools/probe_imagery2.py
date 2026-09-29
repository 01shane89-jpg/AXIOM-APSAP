"""Test only, round 2: blankTile=false behaviour, Esri imagery metadata (date / resolution / provider) and a
side-by-side picture (Esri World Imagery | Esri Clarity | Google as a yardstick only) for a few SE Asian places."""
import io, json, math, urllib.request, urllib.parse
from PIL import Image, ImageDraw

UA = {"User-Agent": "OSAP-imagery-probe/2 (github.com/01shane89-jpg/AXIOM-APSAP)"}
def get(url):
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30)
        return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers or {}), b""
def tile(lat, lon, z):
    n = 2 ** z
    return int((lon + 180) / 360 * n), int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)

E = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
print("== blankTile=false")
for p, (la, lo) in {"Bangkok": (13.7466, 100.5393), "Yala": (6.5411, 101.2804)}.items():
    for z in (18, 19, 20):
        x, y = tile(la, lo, z)
        s, h, b = get(E.format(z=z, x=x, y=y) + "?blankTile=false")
        print(p, z, s, len(b), "CORS:", h.get("Access-Control-Allow-Origin"), "cache:", h.get("Cache-Control"))

print("== metadata layers")
M = "https://metadata.maptiles.arcgis.com/arcgis/rest/services/World_Imagery_Metadata/MapServer"
s, h, b = get(M + "?f=json")
print(s, b[:300])
try:
    lay = json.loads(b).get("layers", [])
    print([(l["id"], l["name"], l.get("minScale"), l.get("maxScale")) for l in lay])
except Exception as e:
    lay = []; print(e)
for p, (la, lo) in {"Bangkok": (13.7466, 100.5393), "Yala": (6.5411, 101.2804), "Manila": (14.5836, 120.9790)}.items():
    for l in lay[:24]:
        q = urllib.parse.urlencode({"geometry": f"{lo},{la}", "geometryType": "esriGeometryPoint", "inSR": 4326, "spatialRel": "esriSpatialRelIntersects",
                                    "outFields": "SRC_DATE,SRC_DATE2,SRC_RES,SRC_ACC,SRC_DESC,NICE_NAME,NICE_DESC,MinMapLevel,MaxMapLevel", "returnGeometry": "false", "f": "json"})
        s, h, b = get(f"{M}/{l['id']}/query?{q}")
        try:
            f = json.loads(b).get("features", [])
            if f: print(p, l["id"], l["name"], json.dumps([x["attributes"] for x in f])[:300], "CORS:", h.get("Access-Control-Allow-Origin"))
        except Exception as e:
            print(p, l["id"], s, str(e)[:60])

print("== wayback newest releases")
s, h, b = get("https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json")
cfg = json.loads(b)
rel = sorted(cfg.items(), key=lambda kv: kv[1].get("itemTitle", ""))[-3:]
print([(k, v.get("itemTitle"), v.get("itemURL")) for k, v in rel])

SRC = [("Esri World Imagery", E), ("Esri Clarity", "https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"),
       ("Google (yardstick, not usable)", "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}")]
ROWS = [("Bangkok z19", 13.7466, 100.5393, 19), ("Yala z18", 6.5411, 101.2804, 18), ("Manila z18", 14.5836, 120.9790, 18),
        ("Dili z18", -8.5569, 125.5603, 18), ("Port Moresby z18", -9.4438, 147.1803, 18)]
T = 256; W = T * 2
img = Image.new("RGB", (W * 3, (W + 20) * len(ROWS) + 20), "white"); d = ImageDraw.Draw(img)
for i, (n, _) in enumerate(SRC): d.text((i * W + 6, 4), n, fill="black")
for r, (lbl, la, lo, z) in enumerate(ROWS):
    x0, y0 = tile(la, lo, z); top = 20 + r * (W + 20)
    d.text((6, top + 2), lbl, fill="black")
    for c, (_, u) in enumerate(SRC):
        for dx in (0, 1):
            for dy in (0, 1):
                s, h, b = get(u.format(z=z, x=x0 + dx, y=y0 + dy))
                if b:
                    try: img.paste(Image.open(io.BytesIO(b)).convert("RGB"), (c * W + dx * T, top + 18 + dy * T))
                    except Exception: pass
import os; os.makedirs("probe-out", exist_ok=True)
img.save("probe-out/compare.jpg", quality=85)
print("saved compare.jpg", img.size)
