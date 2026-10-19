// Satellite before/after helpers (assets/osap-sat.js): the Earth Search query, Sentinel-2 items grouped into passes (newer
// processing of a tile kept), the default before/after pair, WGS84 -> UTM against PROJ (pyproj 3, EPSG 326xx/327xx) and the
// web-map grid. Run: node tests/sat.test.mjs
import { createRequire } from "node:module";
const T = createRequire(import.meta.url)("../assets/osap-sat.js");
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

// bbox and query
const bb = T.bboxOf([[50.3, 30.4], [50.55, 30.4], [50.55, 30.7], [50.3, 30.7]]);
ok(JSON.stringify(bb) === JSON.stringify([30.4, 50.3, 30.7, 50.55]), "bbox of a drawn area is [w,s,e,n]");
ok(T.bboxOf([]) === null && T.bboxOf([[NaN, 1]]) === null, "no bbox for an empty or broken area");
const u = T.searchUrl(bb, Date.parse("2026-07-21T00:00:00Z"), Date.parse("2026-10-19T07:00:00Z"), 100);
ok(u === "https://earth-search.aws.element84.com/v1/search?collections=sentinel-2-l2a&bbox=30.4,50.3,30.7,50.55&datetime=2026-07-21T00:00:00Z/2026-10-19T07:00:00Z&limit=100&sortby=-properties.datetime", "Earth Search GET query (no preflight): " + u);

// passes
const feat = (id, dt, cc, extra) => ({ id, properties: Object.assign({ datetime: dt, "eo:cloud_cover": cc, platform: id.startsWith("S2B") ? "sentinel-2b" : "sentinel-2a", "grid:code": "MGRS-" + id.split("_")[1] }, extra || {}),
  assets: { visual: { href: "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/x/" + id + "/TCI.tif" } },
  links: [{ rel: "self", href: "https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/" + id }] });
const F = [
  feat("S2A_36UUA_20261018_1_L2A", "2026-10-18T09:16:31Z", 99.9),
  feat("S2A_36UUB_20261018_1_L2A", "2026-10-18T09:16:17Z", 98.1),
  feat("S2B_36UUA_20261013_0_L2A", "2026-10-13T09:06:00Z", 4.2),
  feat("S2B_36UUA_20261013_1_L2A", "2026-10-13T09:06:00Z", 3.8),
  feat("S2A_36UUA_20260918_0_L2A", "2026-09-18T09:16:00Z", 12),
  feat("S2B_36UUA_20260913_0_L2A", "2026-09-13T09:06:00Z", 60),
  feat("S2A_36UUA_20260828_0_L2A", "2026-08-28T09:16:00Z", 1),
  { id: "bad", properties: { datetime: "2026-10-01T00:00:00Z" }, assets: { visual: { href: "javascript:alert(1)" } } },
  { id: "bad2", properties: { datetime: "nope" }, assets: { visual: { href: "https://x/TCI.tif" } } }
];
const P = T.groupPasses(F);
ok(P.length === 5, "5 passes (two tiles of one pass merged, broken items dropped): " + P.map((p) => p.key).join(" "));
ok(P[0].key === "S2A_2026-10-18" && P[0].items.length === 2 && Math.abs(P[0].cloud - 99) < 0.01, "newest pass first, two tiles, mean cloud");
const p13 = P.find((p) => p.date === "2026-10-13");
ok(p13.items.length === 1 && p13.items[0].id === "S2B_36UUA_20261013_1_L2A", "a tile processed twice keeps the newer processing");
ok(p13.items[0].stac === "https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/S2B_36UUA_20261013_1_L2A", "each scene keeps its STAC item link");
ok(P.every((p) => p.items.every((i) => /^https:\/\//.test(i.href))), "only https picture links kept");

// default pair
const d = T.pickDefault(P, 20, 30);
ok(d.after && d.after.date === "2026-10-13", "after = newest clear pass (cloudy 18 Oct skipped): " + (d.after && d.after.date));
ok(d.before && d.before.date === "2026-09-18", "before = clear pass nearest 30 days earlier: " + (d.before && d.before.date));
const d2 = T.pickDefault(P.filter((p) => p.cloud > 50), 20, 30);
ok(d2.after && d2.after.date === "2026-10-18" && d2.before && d2.before.date === "2026-09-13", "no clear pass: newest, and the nearest older one");
ok(T.pickDefault([], 20, 30).after === null, "no passes: nothing picked");

// UTM against PROJ
const REF = [[51.5074, -0.1278, 30, false, 699316.234, 5710163.758], [50.45, 30.52, 36, false, 323940.495, 5591604.544], [-33.87, 151.21, 56, true, 334435.706, 6250816.398],
  [13.75, 100.5, 47, false, 662176.290, 1520582.494], [64.1, -21.9, 27, false, 456137.554, 7108467.417], [50.45, 35.9, 36, false, 705871.577, 5592684.578]];
for (const [la, lo, z, s, E, N] of REF) { const m = T.utm(la, lo, z, s), e = Math.hypot(m[0] - E, m[1] - N); ok(e < 0.01, `UTM ${z}${s ? "S" : "N"} ${la},${lo} within 1 cm of PROJ (${(e * 100).toFixed(3)} cm)`); }
ok(JSON.stringify(T.utmOf(32636)) === '{"zone":36,"south":false}' && JSON.stringify(T.utmOf(32756)) === '{"zone":56,"south":true}' && T.utmOf(3857) === null, "EPSG code -> UTM zone");

// web-map grid
ok(Math.abs(T.latOfY(T.mercY(50.3)) - 50.3) < 1e-9, "mercator round trip");
const g = T.gridLL([30.4, 50.3, 30.7, 50.55], 100, 40, 16);
ok(g.nx === 8 && g.ny === 4 && g.ll.length === 32, "grid nodes every 16 px plus the far edge");
ok(Math.abs(g.ll[0][0] - 50.55) < 1e-9 && Math.abs(g.ll[0][1] - 30.4) < 1e-9 && Math.abs(g.ll[31][0] - 50.3) < 1e-9 && Math.abs(g.ll[31][1] - 30.7) < 1e-9, "grid corners on the bbox corners");
ok(T.cloudTxt(0.3) === "<1% cloud" && T.cloudTxt(12.6) === "13% cloud" && T.cloudTxt(null) === "cloud ?", "cloud text");
const k = T.sizeKm([30.4, 50.3, 30.7, 50.55]); ok(Math.abs(k[0] - 21.3) < 0.3 && Math.abs(k[1] - 27.6) < 0.3, "area size in km " + k.map((x) => x.toFixed(1)).join(" x "));
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
