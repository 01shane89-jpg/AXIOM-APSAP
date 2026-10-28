#!/usr/bin/env bash
# Test only: sends the power grid's own Postpass SQL (ppQuery and ppElements lifted from assets/osap-power.js) for Thailand and a few
# other views to Geofabrik's Postpass with a browser's headers, and prints status, CORS header, element counts and time.
# Writes nothing to the repo.
cat > /tmp/pp.mjs <<'JS'
import { readFileSync } from "node:fs";
const src = readFileSync("assets/osap-power.js", "utf8");
const body = src.slice(src.indexOf('  var HVRE'), src.indexOf('  var busy = null'));
const P = new Function("ALLZ", body + "; return { ppQuery, ppElements };")(11);
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const views = [["th-phone-z8-bangkok", [11.4, 99.5, 15.9, 101.7], 8], ["th-desk-z8-bangkok", [11.6, 96.9, 15.7, 104.3], 8], ["th-z11-bangkok", [13.6, 100.3, 13.9, 100.8], 11],
  ["th-z13-west", [12.5, 99.35, 12.65, 99.5], 13], ["th-phone-z8-chiangmai", [16.5, 97.9, 20.9, 100.1], 8], ["th-phone-z8-isan", [14.0, 101.9, 18.4, 104.1], 8],
  ["vn-phone-z8-hanoi", [18.8, 104.7, 23.2, 106.9], 8], ["de-phone-z8-berlin", [50.3, 12.3, 54.7, 14.5], 8], ["ng-phone-z8-lagos", [4.3, 2.3, 8.7, 4.5], 8], ["us-z11-dc", [38.8, -77.2, 39.0, -76.9], 11]];
for (const [name, [s, w, n, e], z] of views) {
  const b = { getSouth: () => s, getWest: () => w, getNorth: () => n, getEast: () => e };
  const t0 = Date.now();
  try {
    const r = await fetch("https://postpass.geofabrik.de/api/interpreter", { method: "POST", body: "data=" + encodeURIComponent(P.ppQuery(b, z, { lines: true, subs: true })),
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA, Origin: "https://axiom-osap.netlify.app" } });
    const txt = await r.text(); let st = "";
    try { const els = P.ppElements(JSON.parse(txt)).elements; st = "lines=" + els.filter((x) => x.geometry).length + " subs=" + els.filter((x) => x.center).length; } catch (x) { st = "not usable: " + txt.slice(0, 200).replace(/\s+/g, " "); }
    console.log(name, "|", r.status, txt.length + "B", (Date.now() - t0) + "ms", "|", "cors=" + r.headers.get("access-control-allow-origin"), "|", st);
  } catch (x) { console.log(name, "| failed", x.message, (Date.now() - t0) + "ms"); }
}
JS
cp /tmp/pp.mjs ./pp-probe.mjs && node ./pp-probe.mjs; rm -f ./pp-probe.mjs
