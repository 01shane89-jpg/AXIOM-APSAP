// Official air monitor readings (tools/dense_airmon.mjs): one summary per monitor from an agency's readings layer.
import { monitorSummary, RESPONSES } from "../tools/dense_airmon.mjs";
let bad = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) bad++; };
const f = RESPONSES[0].f, T = Date.UTC(2026, 10, 25, 13, 0);
// rows shaped like EPA Region 7's IAAAP_Xact_Data_Public_Viewer layer (26 Nov 2026)
const row = (st, min, v, lat = 40.77694, lon = -91.32317) => ({ [f.time]: T + min * 60e3, [f.value]: v, [f.units]: "µg/m3", [f.station]: st, [f.lat]: lat, [f.lon]: lon });
const rows = [row("AS01", 0, 0), row("AS01", 60, 0), row("AS04", 0, 0, 40.7, -91.6), row("AS04", 180, 0.010228, 40.7, -91.6), row("AS04", 240, 0.004, 40.7, -91.6),
  row("AS04", 300, 0.010228, 40.7, -91.6), { [f.time]: T, [f.value]: null, [f.station]: "AS02" }, { [f.time]: T, [f.value]: 0.2, [f.station]: "" }];
const S = monitorSummary(rows, f), a1 = S.find((m) => m.station === "AS01"), a4 = S.find((m) => m.station === "AS04");
ok(S.length === 2, "two monitors; rows without a value or station left out (" + S.map((m) => m.station) + ")");
ok(a1.n === 2 && a1.nonzero === 0 && a1.max.v === 0 && a1.latest.t === T + 60 * 60e3, "AS01: two zero readings, latest is the later one");
ok(a4.n === 4 && a4.nonzero === 3 && a4.max.v === 0.010228 && a4.max.t === T + 180 * 60e3, "AS04: highest reading and its first time");
ok(a4.latest.v === 0.010228 && a4.units === "µg/m³" && a4.lat === 40.7, "AS04: latest value, units and position");
ok(RESPONSES.every((r) => /^https:\/\/services\.arcgis\.com\//.test(r.readings) && r.ref && r.ref.value > 0), "every response reads a public ArcGIS layer and names its reference level");
console.log(bad ? bad + " FAILED" : "all passed");
process.exit(bad ? 1 : 0);
