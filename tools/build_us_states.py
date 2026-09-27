#!/usr/bin/env python3
"""Build data/basemap/us-states/<code>.js: one file per US state (and DC), the outline the page uses when a state is
opened as a sub-area of the United States (like Okinawa within Japan). Only the open state's file is loaded.

Input: assets/regions/USA.json (tools/build_regions.py, Natural Earth admin-1, public domain).
Each file sets window.OSAP_SUBAREA = {cc, code, name, tz, b: [[s, w], [n, e]], p: [[[lon, lat], ...], ...]}.
The box leaves out parts east of 180 degrees (the far Aleutians) so Alaska's map view is not the whole globe;
the outline keeps them, so records there still count.

The same code, name and zone table is in index.html (window.OSAP_SUBS); keep them in step.

usage: python3 tools/build_us_states.py
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# code, Natural Earth name, main time zone (the state's largest-population zone)
STATES = [
    ("AL", "Alabama", "America/Chicago"), ("AK", "Alaska", "America/Anchorage"), ("AZ", "Arizona", "America/Phoenix"),
    ("AR", "Arkansas", "America/Chicago"), ("CA", "California", "America/Los_Angeles"), ("CO", "Colorado", "America/Denver"),
    ("CT", "Connecticut", "America/New_York"), ("DE", "Delaware", "America/New_York"), ("DC", "District of Columbia", "America/New_York"),
    ("FL", "Florida", "America/New_York"), ("GA", "Georgia", "America/New_York"), ("HI", "Hawaii", "Pacific/Honolulu"),
    ("ID", "Idaho", "America/Boise"), ("IL", "Illinois", "America/Chicago"), ("IN", "Indiana", "America/Indiana/Indianapolis"),
    ("IA", "Iowa", "America/Chicago"), ("KS", "Kansas", "America/Chicago"), ("KY", "Kentucky", "America/New_York"),
    ("LA", "Louisiana", "America/Chicago"), ("ME", "Maine", "America/New_York"), ("MD", "Maryland", "America/New_York"),
    ("MA", "Massachusetts", "America/New_York"), ("MI", "Michigan", "America/Detroit"), ("MN", "Minnesota", "America/Chicago"),
    ("MS", "Mississippi", "America/Chicago"), ("MO", "Missouri", "America/Chicago"), ("MT", "Montana", "America/Denver"),
    ("NE", "Nebraska", "America/Chicago"), ("NV", "Nevada", "America/Los_Angeles"), ("NH", "New Hampshire", "America/New_York"),
    ("NJ", "New Jersey", "America/New_York"), ("NM", "New Mexico", "America/Denver"), ("NY", "New York", "America/New_York"),
    ("NC", "North Carolina", "America/New_York"), ("ND", "North Dakota", "America/Chicago"), ("OH", "Ohio", "America/New_York"),
    ("OK", "Oklahoma", "America/Chicago"), ("OR", "Oregon", "America/Los_Angeles"), ("PA", "Pennsylvania", "America/New_York"),
    ("RI", "Rhode Island", "America/New_York"), ("SC", "South Carolina", "America/New_York"), ("SD", "South Dakota", "America/Chicago"),
    ("TN", "Tennessee", "America/Chicago"), ("TX", "Texas", "America/Chicago"), ("UT", "Utah", "America/Denver"),
    ("VT", "Vermont", "America/New_York"), ("VA", "Virginia", "America/New_York"), ("WA", "Washington", "America/Los_Angeles"),
    ("WV", "West Virginia", "America/New_York"), ("WI", "Wisconsin", "America/Chicago"), ("WY", "Wyoming", "America/Denver"),
]


def main():
    src = json.load(open(os.path.join(ROOT, "assets", "regions", "USA.json")))
    by = {}
    for r in src["r"]:
        name = "District of Columbia" if r[1] == "Federal District" else r[0]
        by[name] = r
    out = os.path.join(ROOT, "data", "basemap", "us-states")
    os.makedirs(out, exist_ok=True)
    for code, name, tz in STATES:
        r = by[name]
        rings = r[5]
        pts = [p for ring in rings for p in ring if p[0] < 0] or [p for ring in rings for p in ring]
        b = [[min(p[1] for p in pts), min(p[0] for p in pts)], [max(p[1] for p in pts), max(p[0] for p in pts)]]
        rec = {"cc": "us", "code": code, "name": "Washington, D.C." if code == "DC" else name, "tz": tz, "b": b, "p": rings,
               "src": "Natural Earth admin-1 (public domain), via assets/regions/USA.json"}
        with open(os.path.join(out, code.lower() + ".js"), "w") as f:
            f.write("/* written by tools/build_us_states.py; do not edit by hand */\nwindow.OSAP_SUBAREA = " +
                    json.dumps(rec, separators=(",", ":")) + ";\n")
    print(len(STATES), "files in", out)


if __name__ == "__main__":
    main()
