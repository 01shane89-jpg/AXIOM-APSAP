// OpenAIP airspace builder (tools/refresh_openaip.mjs): only the restricted kinds, compact, nc-tagged, no contributor ids
import { areasOf, limit, exportLinks, SOURCE, bboxOf } from "../tools/refresh_openaip.mjs";
let bad = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) bad++; };
const sq = [[21.1234, 52.1234], [21.2, 52.1234], [21.2, 52.2], [21.2, 52.2], [21.1234, 52.1234]];
const A = areasOf({ features: [
  { properties: { name: "EPR15 PIENIŃSKI PARK NARODOWY", type: 1, createdBy: "OPONcQnzWGOLiJSceNaf8pvx1fA2", lowerLimit: { value: 0, unit: 1, referenceDatum: 0 }, upperLimit: { value: 95, unit: 6, referenceDatum: 2 } }, geometry: { type: "Polygon", coordinates: [sq] } },
  { properties: { name: "CTR EPGD", type: 4 }, geometry: { type: "Polygon", coordinates: [sq] } },
  { properties: { name: "LL-P08", type: 3, byNotam: true, lowerLimit: { value: 1500, unit: 1, referenceDatum: 1 }, upperLimit: { value: 5000, unit: 1, referenceDatum: 1 } }, geometry: { type: "MultiPolygon", coordinates: [[sq], [[[1, 1], [2, 2]]]] } },
  { properties: { name: "Broken", type: 2 }, geometry: { type: "Point", coordinates: [1, 2] } },
] });
ok(A.length === 2, "restricted and prohibited kept; a control zone and a shapeless area left out (" + A.length + ")");
ok(A[0].lo === "GND" && A[0].hi === "FL95" && A[1].lo === "1,500 ft MSL" && A[1].notam === true, "limits read as pilots write them");
ok(JSON.stringify(A[0].g[0][0]) === "[21.123,52.123]" && A[0].g[0].length === 4 && A[1].g.length === 1, "outlines rounded, repeated points and degenerate rings dropped");
ok(!/createdBy|OPONc/.test(JSON.stringify(A)), "OpenAIP contributor ids are never copied");
ok(SOURCE.nc === true && /BY-NC/.test(SOURCE.lic), "every file is tagged non-commercial");
ok(limit({ value: 0, unit: 1, referenceDatum: 1 }) === "0 ft MSL" && limit(null) === "", "edge limits");
const L = exportLinks('<a href="https://s3.openaip.net/openaip-system-exports/pl_asp.geojson?X-Amz-Algorithm=AWS4&amp;X-Amz-Signature=ab">x</a> <a href="https://s3.openaip.net/openaip-system-exports/pl_apt.geojson?a=b">');
ok(Object.keys(L).join() === "pl" && L.pl === "https://s3.openaip.net/openaip-system-exports/pl_asp.geojson?X-Amz-Algorithm=AWS4&X-Amz-Signature=ab", "only airspace exports, links unescaped");
ok(JSON.stringify(bboxOf(A)) === "[[52.123,21.123],[52.2,21.2]]" && bboxOf([]) === null, "bounding box for loading only what is in view");
if (bad) { console.log(bad + " failed"); process.exit(1); }
console.log("all passed");
