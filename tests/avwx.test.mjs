// Unit checks for tools/refresh_avwx.mjs (airfield METAR/TAF cell files), with made-up files in the AWC cache formats, no network.
// Checks: notes before the CSV header are skipped; the newest METAR per airfield is kept and old ones dropped; ceiling is the
// lowest broken or overcast layer; VRB wind is kept as VRB; TAF CDATA and XML escapes are undone; a TAF that has expired is
// dropped; -99.99 places and 9999 heights are treated as unknown and filled from the station list; names "UNK" are dropped;
// airfields are filed in the right 10-degree cell (including the antimeridian and southern hemisphere).
import assert from "node:assert/strict";
import { parseMetars, parseTafs, parseStations, build, cellKey, csvRows } from "../tools/refresh_avwx.mjs";

const now = Date.parse("2026-10-10T12:00:00Z");
const H = ["raw_text", "station_id", "observation_time", "latitude", "longitude", "temp_c", "dewpoint_c", "wind_dir_degrees", "wind_speed_kt", "wind_gust_kt",
  "visibility_statute_mi", "altim_in_hg", "sea_level_pressure_mb", "corrected", "auto", "auto_station", "maintenance_indicator_on", "no_signal", "lightning_sensor_off",
  "freezing_rain_sensor_off", "present_weather_sensor_off", "wx_string", "sky_cover", "cloud_base_ft_agl", "sky_cover", "cloud_base_ft_agl", "sky_cover", "cloud_base_ft_agl",
  "sky_cover", "cloud_base_ft_agl", "flight_category", "three_hr_pressure_tendency_mb", "maxT_c", "minT_c", "maxT24hr_c", "minT24hr_c", "precip_in", "pcp3hr_in", "pcp6hr_in",
  "pcp24hr_in", "snow_in", "vert_vis_ft", "metar_type", "elevation_m"];
function row(o) { return H.map((h, i) => { if (h === "sky_cover" || h === "cloud_base_ft_agl") { const k = H.slice(0, i).filter((x) => x === h).length; return (o.sky[k] || [])[h === "sky_cover" ? 0 : 1] ?? ""; } return o[h] ?? ""; }).map((v) => (/[,"]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v)).join(","); }
const csv = ["No errors", "No warnings", "12 ms", "data source=metars", "3 results", H.join(","),
  row({ raw_text: "METAR VTBD 101130Z 09006KT 9999 FEW020 BKN030 OVC080 31/23 Q1008", station_id: "VTBD", observation_time: "2026-10-10T11:30:00Z", latitude: "13.913", longitude: "100.607",
    temp_c: "31", dewpoint_c: "23", wind_dir_degrees: "90", wind_speed_kt: "6", visibility_statute_mi: "6+", altim_in_hg: "29.77", flight_category: "VFR", elevation_m: "6",
    sky: [["FEW", 2000], ["BKN", 3000], ["OVC", 8000]] }),
  row({ raw_text: "METAR VTBD 101100Z 09005KT 9999 FEW020 31/23 Q1008", station_id: "VTBD", observation_time: "2026-10-10T11:00:00Z", latitude: "13.913", longitude: "100.607", sky: [["FEW", 2000]] }),
  row({ raw_text: "METAR NZCH 100100Z VRB02KT CAVOK 08/04 Q1020", station_id: "NZCH", observation_time: "2026-10-10T01:00:00Z", latitude: "-43.49", longitude: "172.53", wind_dir_degrees: "VRB", wind_speed_kt: "2", sky: [["CAVOK"]] }),
  row({ raw_text: "METAR NFFN 101100Z VRB03KT 9999 SCT018 28/22 Q1010", station_id: "NFFN", observation_time: "2026-10-10T11:00:00Z", latitude: "-17.755", longitude: "177.443", wind_dir_degrees: "VRB", wind_speed_kt: "3", flight_category: "VFR", sky: [["SCT", 1800]] }),
  row({ raw_text: "METAR PAFA 101053Z 00000KT 10SM OVC006 M02/M03 A2990", station_id: "PAFA", observation_time: "2026-10-10T10:53:00Z", latitude: "64.8", longitude: "-147.88", flight_category: "IFR", sky: [["OVC", 600]] }),
].join("\n") + "\n";
const xml = `<?xml version="1.0"?><response><data num_results="3">
<TAF><raw_text><![CDATA[TAF VTBD 101100Z 1012/1118 05008KT 9999 FEW020 TEMPO 1014/1018 VRB15KT 4000 TSRA FEW018CB]]></raw_text><station_id>VTBD</station_id><issue_time>2026-10-10T11:00:00Z</issue_time><valid_time_from>2026-10-10T12:00:00Z</valid_time_from><valid_time_to>2026-10-11T18:00:00Z</valid_time_to><latitude>13.913</latitude><longitude>100.607</longitude><elevation_m>6</elevation_m></TAF>
<TAF><raw_text>TAF OERS 101100Z 1012/1118 26012KT 9999 FEW040 &amp; more</raw_text><station_id>OERS</station_id><issue_time>2026-10-10T11:00:00Z</issue_time><valid_time_from>2026-10-10T12:00:00Z</valid_time_from><valid_time_to>2026-10-11T18:00:00Z</valid_time_to><latitude>-99.99</latitude><longitude>-99.99</longitude><elevation_m>9999</elevation_m></TAF>
<TAF><raw_text>TAF XXXX 090000Z 0900/1006 00000KT CAVOK</raw_text><station_id>XXXX</station_id><issue_time>2026-10-09T00:00:00Z</issue_time><valid_time_from>2026-10-09T00:00:00Z</valid_time_from><valid_time_to>2026-10-10T06:00:00Z</valid_time_to><latitude>10</latitude><longitude>10</longitude></TAF>
</data></response>`;
const stations = JSON.stringify([{ icaoId: "VTBD", site: "Bangkok Intl", country: "TH", lat: 13.913, lon: 100.607, elev: 6 }, { icaoId: "OERS", site: "Red Sea Intl", country: "SA", lat: 25.63, lon: 37.09, elev: 9 },
  { icaoId: "PAFA", site: "UNK", country: "US", lat: 64.8, lon: -147.88, elev: 132 }]);

const M = parseMetars(csv), T = parseTafs(xml), S = parseStations(stations);
assert.equal(M.length, 5, "every METAR row read past the notes");
const bd = M.find((m) => m.m.t === Date.parse("2026-10-10T11:30:00Z"));
assert.equal(bd.m.cig, 3000, "ceiling = lowest BKN/OVC layer, not FEW");
assert.equal(bd.m.sky, "FEW020 BKN030 OVC080");
assert.equal(bd.m.vis, 6); assert.equal(bd.m.visp, true, "6+ SM read as 6 and more");
assert.equal(M.find((m) => m.id === "NFFN").m.wd, "VRB", "variable wind kept as VRB");
assert.equal(T.length, 3);
assert.ok(/^TAF VTBD/.test(T[0].f.raw) && !/CDATA/.test(T[0].f.raw), "CDATA removed");
assert.ok(/FEW040 & more$/.test(T[1].f.raw), "XML escapes undone");
assert.equal(T[1].la, null, "-99.99 is no place"); assert.equal(T[1].el, null, "9999 is no height");
assert.equal(S.get("PAFA").n, null, "UNK name dropped");
const C = build(M, T, S, now);
const all = Object.values(C).flat(), by = Object.fromEntries(all.map((s) => [s.id, s]));
assert.equal(by.VTBD.m.t, Date.parse("2026-10-10T11:30:00Z"), "newest METAR kept");
assert.ok(by.VTBD.f && by.VTBD.n === "Bangkok Intl" && by.VTBD.c === "TH", "TAF and name joined");
assert.ok(!by.NZCH, "an 11-hour-old METAR with no TAF is dropped");
assert.ok(!by.XXXX, "an expired TAF is dropped");
assert.ok(by.OERS && by.OERS.la === 25.63 && by.OERS.el === 9, "unknown TAF place filled from the station list");
assert.ok(C["10_100"].some((s) => s.id === "VTBD"), "Bangkok in cell 10_100");
assert.ok(C["20_30"].some((s) => s.id === "OERS"), "Red Sea in cell 20_30");
assert.ok(C["-20_170"].some((s) => s.id === "NFFN"), "Fiji in cell -20_170");
assert.ok(C["60_-150"].some((s) => s.id === "PAFA"), "Fairbanks in cell 60_-150");
assert.equal(cellKey(0, 180), "0_170", "180 E folds into the last cell");
assert.deepEqual(csvRows('a,"b,""c"""\n1,2\n'), [["a", 'b,"c"'], ["1", "2"]], "quoted CSV fields");
console.log("avwx: all checks passed");
