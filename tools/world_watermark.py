#!/usr/bin/env python3
"""Build assets/world-watermark.svg, the loading-screen background map.

Input: countries-50m.json from the world-atlas npm package (Natural Earth 1:50m,
public domain), e.g.
  curl -sL https://registry.npmjs.org/world-atlas/-/world-atlas-2.0.2.tgz | tar xz
  python3 tools/world_watermark.py package/countries-50m.json

Miller projection, cropped to 57S-83N (no Antarctica), simplified
(Douglas-Peucker) and rounded to 0.1 px so the file stays small but the
coastlines stay smooth at full-screen size.
"""
import json, math, sys

W = 2000                       # viewBox width; height follows from the projection
LAT_N, LAT_S = 83.0, -57.0
TOL = 0.8                      # simplification tolerance in viewBox px

def miller(lat):
    r = math.radians(max(min(lat, 89), -89))
    return 1.25 * math.log(math.tan(math.pi / 4 + 0.4 * r))

YN, YS = miller(LAT_N), miller(LAT_S)
K = W / (2 * math.pi)
H = round((YN - YS) * K)

def proj(lon, lat):
    return ((lon + 180) / 360 * W, (YN - miller(lat)) * K)

def dp(pts, tol):
    if len(pts) < 3: return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = pts[a], pts[b]
        dx, dy = bx - ax, by - ay; L = math.hypot(dx, dy)
        best, bi = -1, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            d = abs(dy * px - dx * py + bx * ay - by * ax) / L if L else math.hypot(px - ax, py - ay)
            if d > best: best, bi = d, i
        if best > tol:
            keep[bi] = True; stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]

def num(v):
    s = "%.1f" % v
    return s[:-2] if s.endswith(".0") else s

topo = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "package/countries-50m.json"))
(sx, sy), (tx, ty) = topo["transform"]["scale"], topo["transform"]["translate"]
arcs = []
for arc in topo["arcs"]:                       # delta-decode quantised arcs
    x = y = 0; out = []
    for dx, dy in arc:
        x += dx; y += dy; out.append((x * sx + tx, y * sy + ty))
    arcs.append(out)

def ring(ids):
    pts = []
    for i in ids:
        a = arcs[i] if i >= 0 else arcs[~i][::-1]
        pts.extend(a[1:] if pts else a)
    return pts

paths = []
for g in topo["objects"]["countries"]["geometries"]:
    if g.get("type") not in ("Polygon", "MultiPolygon"): continue
    polys = g["arcs"] if g["type"] == "MultiPolygon" else [g["arcs"]]
    d = []
    for poly in polys:
        for r in poly:
            ll = ring(r)
            if max(p[1] for p in ll) < LAT_S: continue           # Antarctica
            shifts = [0]
            if any(abs(a[0] - b[0]) > 180 for a, b in zip(ll, ll[1:])):
                # ring crosses the 180th meridian (Russia, Fiji, Alaska): unwrap
                # it eastwards and draw it a second time one world to the left
                ll = [(x + 360 if x < 0 else x, y) for x, y in ll]; shifts = [0, -W]
            pts = dp([proj(*p) for p in ll], TOL)
            if len(pts) < 4: continue
            xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
            if (max(xs) - min(xs)) * (max(ys) - min(ys)) < 4: continue  # specks
            for sh in shifts:
                d.append("M" + "L".join(num(x + sh) + "," + num(y) for x, y in pts) + "Z")
    if d: paths.append("".join(d))

svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">'
       '<g fill="#6fa8d6" stroke="#9fd0ff" stroke-width="1" stroke-linejoin="round">' % (W, H, W, H) +
       "".join('<path d="%s"/>' % p for p in paths) + "</g></svg>\n")
open("assets/world-watermark.svg", "w").write(svg)
print("viewBox", W, H, "countries", len(paths), "bytes", len(svg), file=sys.stderr)
