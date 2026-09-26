import json, sys
# usage: build_layer.py <layer id> <events.json> <config.json>  -> prints a <script> tag
lid, evf, cfgf = sys.argv[1:4]
ev = json.load(open(evf)); cfg = json.load(open(cfgf))
for e in ev:
    for k in ("date", "title", "src", "srcname", "kind"):
        assert e.get(k), (k, e)
    assert e["src"].startswith("http"), e["src"]
ev.sort(key=lambda e: e["date"])
cfg["events"] = ev
cfg.setdefault("from", ev[0]["date"])
payload = json.dumps(cfg, ensure_ascii=True, separators=(",", ":")).replace("</", "<\\/")
print('<script>window.TSAP_DATA=window.TSAP_DATA||{};window.TSAP_DATA[' + json.dumps(lid) + ']=' + payload + ';</script>')
