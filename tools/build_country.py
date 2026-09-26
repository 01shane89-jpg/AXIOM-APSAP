import json, sys, collections
cc = sys.argv[1]; name = sys.argv[2]
ev = json.load(open(f"source/countries/{cc}.json"))
BASE = {l: json.load(open(f"source/thailand/{l}.cfg.json")) for l in ["insurgency","crime","scam","aml","weather","infra","transport","safety","health"]}
BASE["flood"] = {"color": "--rain", "kinds": {
  "flood_event": {"label": "Flood", "color": "--rain", "sev": 2, "counted": True},
  "flash_flood": {"label": "Flash flood", "color": "--sat-water", "sev": 2, "counted": True},
  "river_warning": {"label": "River or flood warning", "color": "--calm", "sev": 1, "counted": True, "claim": True},
  "dam_release": {"label": "Dam release", "color": "--care", "sev": 1, "counted": True, "claim": True},
  "landslide": {"label": "Landslide", "color": "--sat-recur", "sev": 2, "counted": True},
  "other": {"label": "Other", "color": "--muted", "sev": 1, "counted": True}}}
BASE["border"] = {"color": "--over", "kinds": {
  "border_incident": {"label": "Border incident", "color": "--over", "sev": 2, "counted": True},
  "closure_or_restriction": {"label": "Closure or restriction", "color": "--near", "sev": 2, "counted": True},
  "military_activity": {"label": "Military activity", "color": "--l3", "sev": 2, "counted": True},
  "missile_or_weapons_test": {"label": "Missile or weapons test", "color": "--power", "sev": 3, "counted": True},
  "maritime_incident": {"label": "Maritime incident", "color": "--sat-water", "sev": 2, "counted": True},
  "airspace_incursion": {"label": "Airspace incursion", "color": "--rain", "sev": 2, "counted": True},
  "diplomatic_statement": {"label": "Diplomatic statement", "color": "--calm", "sev": 1, "claim": True},
  "other": {"label": "Other", "color": "--muted", "sev": 1, "counted": True}}}
BASE["infra"]["kinds"]["telecom_outage"] = {"label": "Telecom or cable outage", "color": "--calm", "sev": 2, "counted": True}
BASE["weather"]["kinds"]["storm"]["label"] = "Storm or typhoon"
BASE["health"]["kinds"]["ddc_warning"]["label"] = "Health agency warning or measure"
COL = {"insurgency": "--l3", "crime": "--care", "scam": "--sat-flood", "aml": "--util"}
BOUNDS = {"ph": [[4.4,116.8],[21.2,127.0]], "tw": [[21.8,118.1],[25.4,122.1]], "kp": [[37.6,124.2],[43.1,130.8]],
          "kr": [[33.0,125.0],[38.7,130.0]], "mn": [[41.5,87.7],[52.2,119.9]], "oki": [[24.0,122.9],[27.9,128.4]]}
by = collections.defaultdict(list)
for e in ev:
  for k in ("date","title","src","srcname","kind","layer"): assert e.get(k), (k, e.get("title"))
  assert e["src"].startswith("http"), e["src"]
  assert e["layer"] in BASE, e["layer"]
  by[e["layer"]].append(e)
out = []
for lid, es in by.items():
  B = BASE[lid]; kinds = json.loads(json.dumps(B["kinds"]))
  if "other" not in kinds: kinds["other"] = {"label": "Other", "color": "--muted", "sev": 1, "counted": True}
  for k in kinds.values(): k.setdefault("counted", not k.get("violent"))
  es.sort(key=lambda e: e["date"])
  kc = collections.Counter(e["kind"] if e["kind"] in kinds else "other" for e in es)
  top = [k for k, _ in kc.most_common() if k != "other"][:3]
  srcs = collections.Counter(e["srcname"] for e in es)
  cfg = {"asof": "2026-09-26", "color": COL.get(lid, B.get("color", "--muted")),
    "srcline": "Sourced reporting · " + ", ".join(s for s, _ in srcs.most_common(3)),
    "bounds": BOUNDS[cc], "unit": "records", "unitShort": "Records",
    "chartTitle": "Records by month", "chartSub": "Records in this layer by month. Hover a bar for deaths.",
    "tableAll": True, "byProvince": True,
    "status": f"<b>A curated record, not a full count.</b> {len(es)} records for {name}, {es[0]['date'][:7]} to {es[-1]['date'][:7]}, from public reporting.",
    "kpis": [{"type": "all", "label": "Records", "hot": True}] + [{"type": "kind", "kind": k, "label": kinds[k]["label"]} for k in top],
    "kinds": kinds,
    "notes": [
      "<b>Every record is a report, not a finding.</b> Each links to the page it came from and keeps who made the claim. None has been confirmed by an analyst.",
      "<b>Warnings and official statements are claims.</b> They are shown as what the agency or government said, not as something that happened.",
      "<b>Counts are floors.</b> Only reporting that could be opened and read was used, so most events are missing.",
      "<b>Places are approximate.</b> Markers sit at a city, district or province centre unless marked exact. Nationwide items have no marker."],
    "events": es, "from": es[0]["date"]}
  if lid == "border" and cc in ("kp",):
    cfg["notes"].insert(1, "<b>State media is a party's claim.</b> KCNA reports are shown as the North Korean government's own statements.")
  payload = json.dumps(cfg, ensure_ascii=True, separators=(",", ":")).replace("</", "<\\/")
  out.append('<script>window.TSAP_DATA=window.TSAP_DATA||{};window.TSAP_DATA[' + json.dumps(cc + "/" + lid) + ']=' + payload + ';</script>')
print("\n".join(out))
print(cc, len(ev), dict(collections.Counter(e["layer"] for e in ev)), file=sys.stderr)
