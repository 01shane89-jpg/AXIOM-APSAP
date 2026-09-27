#!/usr/bin/env python3
"""Build assets/regions/<ISO3>.json: the provinces/states of each country for the weather region picker.

Source: Natural Earth 1:10m admin-1 states and provinces (public domain),
https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson

Each file is {"src": ..., "r": [[name, type, lat, lon, [s, w, n, e], rings], ...]} sorted by name, where
lat/lon is Natural Earth's label point and rings is a simplified outline as [[lon, lat], ...] rings (outer rings only).

usage: python3 tools/build_regions.py ne_10m_admin_1_states_provinces.geojson
needs: shapely
"""
import json, os, sys
from shapely.geometry import shape, Polygon, MultiPolygon

TOL = 0.02          # degrees, about 2 km
MIN_PART = 0.0004   # drop island parts smaller than this (deg^2) unless it is the only part
# Natural Earth codes that differ from the app's ISO3 codes
A3 = {"KOS": "XKX", "PSX": "PSE", "SDS": "SSD", "SAH": "ESH"}


def rings(geom):
    parts = list(geom.geoms) if isinstance(geom, MultiPolygon) else [geom]
    parts.sort(key=lambda p: -p.area)
    out = []
    for i, p in enumerate(parts):
        if i and p.area < MIN_PART:
            continue
        s = p.simplify(TOL, preserve_topology=True)
        if s.is_empty or not isinstance(s, Polygon):
            s = p
        pts = [[round(x, 2), round(y, 2)] for x, y in s.exterior.coords]
        ded = [pts[0]] + [q for a, q in zip(pts, pts[1:]) if q != a]
        if len(ded) >= 4:
            out.append(ded)
    return out


def main(src):
    d = json.load(open(src, encoding="utf-8"))
    by = {}
    for f in d["features"]:
        p = f["properties"]
        a3 = p.get("adm0_a3")
        a3 = A3.get(a3, a3)
        if not a3 or not f.get("geometry"):
            continue
        g = shape(f["geometry"])
        if g.is_empty:
            continue
        w, s, e, n = g.bounds
        name = p.get("name_en") or p.get("name") or p.get("woe_name")
        if not name:
            continue
        lat, lon = p.get("latitude"), p.get("longitude")
        if lat is None or lon is None:
            c = g.representative_point(); lat, lon = c.y, c.x
        by.setdefault(a3, []).append([name, p.get("type_en") or "Region", round(lat, 3), round(lon, 3),
                                      [round(s, 2), round(w, 2), round(n, 2), round(e, 2)], rings(g)])
    out = os.path.join(os.path.dirname(__file__), "..", "assets", "regions")
    os.makedirs(out, exist_ok=True)
    tot = 0
    for a3, rs in sorted(by.items()):
        rs.sort(key=lambda r: r[0].lower())
        body = json.dumps({"src": "Natural Earth admin-1 (public domain)", "r": rs}, ensure_ascii=False, separators=(",", ":"))
        open(os.path.join(out, a3 + ".json"), "w", encoding="utf-8").write(body)
        tot += len(body)
    print(len(by), "countries,", sum(len(v) for v in by.values()), "regions,", tot // 1024, "KB")


if __name__ == "__main__":
    main(sys.argv[1])
