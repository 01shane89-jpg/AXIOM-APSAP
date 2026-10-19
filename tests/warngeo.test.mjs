// Airspace and sea warnings (tools/warngeo_lib.mjs): positions, shapes and times read from real NGA broadcast warnings, FAA TFR
// polygons and times, the EASA conflict zone bulletin table, telephone numbers removed, and the packed file layout.
// Samples: tests/warngeo-samples.json (fetched from the sources on 2026-10-19, telephone numbers replaced by zeros), plus the
// app's own current data/live/navwarnings.js (its texts have lost their line breaks, so the inline reading is checked too).
// Run from the repo root: node tests/warngeo.test.mjs
import fs from "node:fs";
import vm from "node:vm";
import { coordsIn, unwrap, shapesOf, timesOf, dtg, notamWindow, redactPhones, kindOf, ngaFeatures, tfrDetail, tfrFeature, czibRows, czibPartial,
  czibCountries, pack, unpack, skipNga, parseDailyMem, memFiles, MEM_BASE } from "../tools/warngeo_lib.mjs";
import { ccFromName, ccsInText } from "../tools/geo_cc.mjs";

let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const near = (a, b, d = 0.002) => Math.abs(a - b) <= d;
const S = JSON.parse(fs.readFileSync("tests/warngeo-samples.json", "utf8"));
const nga = (code, n) => S.nga.find((w) => w.code === code && w.msgNumber === n);
const feats = (code, n) => ngaFeatures(nga(code, n), code);

/* ---------- positions ---------- */
let c = coordsIn("IN AREA BOUND BY 37-57.00S 148-13.00E, 38-54.00S 148-13.00E");
ok(c.length === 2 && near(c[0].lat, -37.95) && near(c[0].lon, 148.2167) && near(c[1].lat, -38.9), "DD-MM.MMS DDD-MM.MME read, south negative");
c = coordsIn("17-22N 108-59E · 05-04.65S 081-05.08W · 36-43-12N 076-00-36W");
ok(c.length === 3 && near(c[0].lat, 17.3667) && near(c[1].lon, -81.0847) && near(c[2].lat, 36.72) && near(c[2].lon, -76.01), "whole minutes, west negative, and degrees-minutes-seconds");
c = coordsIn("13-47.5N 143.46.0E, 13-34.2N 144-27.3E");
ok(c.length === 2 && near(c[0].lon, 143.7667), "the HYDROPAC typo 143.46.0E still reads as 143°46'E");
ok(coordsIn("CHART 26240, 26260. DNC 05. 6.7 OCCURRED").length === 0 && coordsIn("12-75.00N 100-00.00E").length === 0, "chart numbers, magnitudes and impossible minutes are not positions");
const u = unwrap([[-19.98, -174.99], [-20.0, 179.5], [-20.1, -179.8]]);
ok(u[1][1] === -180.5 && u[2][1] === -179.8, "a shape across the date line keeps continuous longitudes");

/* ---------- shapes from real warnings ---------- */
let f = feats("P", 1571);
ok(f.length === 1 && f[0].properties.shape === "area" && f[0].geometry.type === "Polygon" && f[0].geometry.coordinates[0].length === 5, "HYDROPAC 1571/24 'IN AREA BOUND BY' four corners: a closed polygon");
ok(f[0].properties.part === "1" && f[0].properties.id === "HYDROPAC 1571/24" && f[0].properties.ufn === true, "numbered part, id and until further notice kept (the CANCEL part draws nothing)");
f = feats("P", 1344);
ok(f.length === 1 && f[0].properties.shape === "circle" && f[0].properties.radius_m === 5556 && near(f[0].geometry.coordinates[1], 15.3808), "'SANK WITHIN THREE MILES OF LY SON (15-22.85N 109-07.05E)': a 3 NM circle on the position");
f = feats("P", 3542);
ok(f.length === 1 && f[0].properties.shape === "circle" && f[0].properties.radius_m === 400, "'WITHIN 400 METERS OF': a 400 m circle");
f = feats("A", 2017);
ok(f[0].properties.shape === "circle" && f[0].properties.radius_m === 9260 && f[0].properties.kind === "hazard", "'MINES REPORTED IN AREA WITHIN FIVE MILES OF': 5 NM circle, a danger area");
f = feats("P", 1519);
ok(f.length === 1 && f[0].properties.shape === "track" && f[0].geometry.coordinates.length === 3, "'ALONG TRACKLINE JOINING': a track through every position");
f = feats("P", 894);
ok(f.length === 1 && f[0].properties.shape === "track" && f[0].geometry.coordinates.length === 20, "a trackline whose positions have no commas between them: 20-point track");
f = feats("A", 2452);
ok(f.length === 2 && f.every((x) => x.properties.shape === "area") && f.map((x) => x.properties.part).join() === "A,B", "'IN AREAS BOUND BY: A. … B. …': each lettered part its own area");
f = feats("A", 564);
ok(f.length === 5 && f.every((x) => x.properties.shape === "area"), "five mining areas off Ukraine (lettered A to E)");
f = feats("4", 12);
ok(f.length === 3 && f.every((x) => x.properties.shape === "area") && f[2].properties.part === "C", "NAVAREA IV 12/24: three lettered areas inherit 'IN AREAS BOUND BY'");
f = feats("4", 127);
ok(f.length === 2 && f.every((x) => x.properties.shape === "track"), "'ALONG TRACKLINES JOINING: A. … B. …': two tracks");
f = feats("A", 682);
const kinds = Object.fromEntries(f.map((x) => [x.properties.part, x.properties.shape + (x.properties.radius_m ? ":" + x.properties.radius_m : "")]));
ok(kinds["2A"] === "corridor:5556" && kinds["2B"] === "corridor:1852" && kinds["2E"] === "area" && kinds["2G"] === "corridor:200", "Ukrainian port routes: corridors 'WITHIN X OF TRACKLINE JOINING' and waiting areas, part by part");
f = feats("P", 630);
ok(f.length === 2 && f[0].properties.shape === "area" && f[0].properties.part === "1A" && f[1].properties.shape === "point" && f[1].properties.part === "1B", "a part with an area (A) and a position 'IN VICINITY' (B)");
f = feats("C", 254);
ok(f.length === 3 && f.every((x) => x.properties.shape === "point"), "three buoy positions listed A to C: three points");
f = feats("4", 517);
ok(f.length >= 20 && f.every((x) => x.properties.shape === "point"), "drilling unit positions (A. AGOSTO 12 …): one point each (" + f.length + ")");
f = feats("P", 2153);
const lons = f[0].geometry.coordinates[0].map((p) => p[0]);
ok(f[0].properties.shape === "area" && lons.every((x) => x < -174 && x > -176), "Tonga cable area west of the date line stays in one piece");
f = feats("P", 1549);
ok(f.length === 2 && f.every((x) => x.properties.shape === "point") && f[0].properties.kind === "sar", "a missing vessel's two positions are points, search and rescue");
ok(feats("A", 945).length === 0 && skipNga(nga("A", 945).text) && skipNga(nga("12", 249).text) && !skipNga(nga("A", 789).text), "the 'warnings in force' list and cancel-only messages are skipped; 'mines adrift' with no position is kept");

/* ---------- NGA Daily Memoranda (the warnings in force now; the old query API stops at May 2024) ---------- */
const pac = parseDailyMem(S.memPac, "P");
ok(pac.asof === "1161855Z OCT" && pac.warnings.map((w) => w.msgNumber).join() === "3014,3013,3012,3010,3009,3008,3007,3006" && pac.warnings.every((w) => w.msgYear === 2026),
  "HYDROPAC memorandum: the in-force list then seven warnings, all of 2026, in order (" + pac.warnings.length + ")");
ok(skipNga(pac.warnings[0].text) && !skipNga(pac.warnings[1].text), "the memorandum's own in-force list is skipped, the warnings are not");
const w3013 = pac.warnings.find((w) => w.msgNumber === 3013);
ok(w3013 && w3013.issueDate === "161621Z OCT 26" && /^GULF OF OMAN\.\nOMAN\.\n1\. M\/V CAPE DAO SANK/.test(w3013.text) && !/HYDROPAC 3012/.test(w3013.text) && !/161329Z/.test(w3013.text),
  "each warning gets its own date-time group and text, and stops before the next one's header");
let mf = ngaFeatures(pac.warnings.find((w) => w.msgNumber === 3007), "P");
ok(mf.length === 1 && mf[0].properties.id === "HYDROPAC 3007/26" && mf[0].properties.shape === "area" && mf[0].properties.issued === "2026-10-16T09:39Z" &&
  mf[0].properties.from === "2026-10-18T23:00Z" && mf[0].properties.to === "2026-10-30T08:00Z" && mf[0].properties.kind === "hazard", "HYDROPAC 3007/26 gunnery area off Russia: polygon, issue time, window 182300Z to 300700Z, end at CANCEL THIS MSG");
mf = ngaFeatures(pac.warnings.find((w) => w.msgNumber === 3006), "P");
ok(mf.length === 2 && mf.every((x) => x.properties.shape === "area") && mf[0].properties.kind === "launch" && mf[0].properties.from === "2026-10-21T05:00Z" &&
  mf[0].properties.to === "2026-11-03T09:45Z" && mf[0].properties.daily === "0500Z to 0845Z", "HYDROPAC 3006/26 rocket launch and space debris areas, daily 0500Z to 0845Z from 21 Oct, ending 030945Z NOV");
const lan = parseDailyMem(S.memLan, "A");
const l838 = lan.warnings.find((w) => w.msgNumber === 838);
ok(lan.warnings.length === 3 && lan.warnings[0].msgNumber === 2017 && lan.warnings[0].subregion === "55" && l838 && l838.msgYear === 2022 && l838.issueDate === "" &&
  !/MSGID|RMKS/.test(lan.warnings[0].text + l838.text), "carried-over warnings headed MSGID/GENADMIN and RMKS: read, with no date-time group, headers not in the text");
ok(memFiles(S.media).length === 5 && memFiles(S.media).every((m) => /DailyMem\w+\.txt$/.test(m.key) && m.modified) && memFiles(null).length === 5, "media list to the five memorandum files (the Google Earth file left out); fixed list when the list fails");
mf = ngaFeatures({ ...pac.warnings[1], source: MEM_BASE + "16694640/SFH00000/DailyMemPAC.txt" }, "P");
ok(mf.every((x) => /DailyMemPAC\.txt$/.test(x.properties.api)), "a memorandum warning links its memorandum file");

/* ---------- times ---------- */
ok(dtg("101515Z MAY 2024") === "2024-05-10T15:15Z" && dtg("280342Z APR 23") === "2023-04-28T03:42Z" && dtg("nonsense") === null, "date-time groups to UTC");
let t = timesOf(nga("A", 1757).text, "2023-08-08T23:23Z");
ok(t.to === "2023-08-21T00:01Z", "'CANCEL THIS MSG 210001Z AUG 23' is the end time");
t = timesOf(nga("P", 2153).text, "2023-07-01T16:39Z");
ok(t.from === "2023-07-04T17:00Z" && t.ufn && !t.to, "'041700Z JUL UNTIL FURTHER NOTICE': start time, no year written, open end");
t = timesOf("ROCKET LAUNCHING 150100Z TO 150400Z MAR, ALTERNATE 160100Z TO 160400Z MAR 25.", "2025-03-10T00:00Z");
ok(t.windows.length === 2 && t.from === "2025-03-15T01:00Z" && t.to === "2025-03-16T04:00Z", "two launch windows (month on the second group only)");
t = timesOf("HAZARDOUS OPERATIONS 302300Z DEC TO 020100Z JAN", "2025-12-28T00:00Z");
ok(t.from === "2025-12-30T23:00Z" && t.to === "2026-01-02T01:00Z", "a window over the new year takes the nearest year for each end");
const p1571 = feats("P", 1571)[0].properties;
ok(p1571.issued === "2024-05-10T15:15Z" && /AUSCOAST/.test(p1571.authority) && p1571.where === "BASS STRAIT · AUSTRALIA", "issued time, issuing authority and the sea and country lines");
ok(/msi\.nga\.mil/.test(p1571.link) && /msgNumber=1571/.test(p1571.api) && /IN AREA BOUND BY/.test(p1571.text), "link to NGA, the record query and the original text with its line breaks");

/* ---------- telephone numbers out ---------- */
const sar = feats("A", 979)[0].properties.text;
ok(!/\d{3} \d{3} \d{4}/.test(sar) && /PHONE \[number removed\]/.test(sar) && /D8COMMANDCENTER@USCG\.MIL/.test(sar), "NGA 'PHONE: 000 000 0000' removed, the service's e-mail kept");
const r = redactPhones("REPORTS TO JRCC, PHONE: 2189 1034 9739,\n2182 1444 9149, EMAIL: X@Y.LY. DSN: 547 5455, COMM: 800 362 6289 OR 571 557 5455. TEL 559-565-3195 OR FREQ 120.975. POSITION 36-43.70N 076-00.60W.");
ok(!/\d{4} \d{4} \d{4}|\d{3}-\d{3}-\d{4}|\d{3} \d{3} \d{4}|547 5455/.test(r) && /FREQ 120\.975/.test(r) && /36-43\.70N 076-00\.60W/.test(r), "several numbers after one word, DSN, COMM and US numbers removed; frequencies and positions kept");

/* ---------- kinds ---------- */
ok(kindOf("MISSILE FIRING OPERATIONS") === "hazard" && kindOf("ROCKET LAUNCHING. SPACE DEBRIS") === "launch" && kindOf("CABLE OPERATIONS IN PROGRESS") === "operations" &&
  kindOf("DANGEROUS WRECK IN") === "aid" && kindOf("MAN OVERBOARD FROM") === "sar", "kinds: firing, launch, work at sea, wreck, search and rescue");

/* ---------- FAA TFR ---------- */
const det = tfrDetail(S.tfr.xml);
ok(det.from === "2026-10-19T14:00Z" && det.to === "2026-10-20T02:00Z" && det.top === "8000 FT" && det.issued === "2026-10-19T03:10Z", "TFR window from the NOTAM's own UTC group, ceiling and issue time");
ok(/TEMPORARY FLIGHT RESTRICTIONS/.test(det.text) && !/\d{3}-\d{3}-\d{4}/.test(det.text) && /TEL \[number removed\]/.test(det.text), "TFR text kept, telephone numbers removed");
ok(notamWindow("… 2610191400-2610200200").from === "2026-10-19T14:00Z" && notamWindow("… 2610191400-2610200200EST").estimated && notamWindow("no window") === null, "NOTAM window parser");
const tf = tfrFeature(S.tfr.features[0], S.tfr.list[0], det);
ok(tf && tf.geometry.type === "Polygon" && tf.properties.id === "FDC 6/0198" && tf.properties.cat === "air" && tf.properties.kind === "hazards" &&
  tf.properties.link === "https://tfr.faa.gov/tfr3/?page=detail_6_0198", "TFR polygon, id, kind and link to the FAA page");
ok(tfrFeature({ properties: {}, geometry: { type: "Point", coordinates: [0, 0] } }) === null, "a TFR with no polygon is dropped");

/* ---------- EASA CZIB ---------- */
const rows = czibRows(S.czibHtml);
const saudi = rows.find((x) => /Saudi Arabia/.test(x.subject) && /Active/.test(x.status));
ok(saudi && saudi.number === "CZIB-2026-09-R1" && saudi.issued === "2026-09-30" && saudi.until === "2026-11-16" && /czib-2026-09-r1$/.test(saudi.link), "bulletin row: number, dates, status and page");
ok(rows.some((x) => /Withdrawn/.test(x.status)), "withdrawn bulletins are read with their status (the job keeps only active ones)");
ok(czibCountries("Airspace of Saudi Arabia", ccFromName, ccsInText).join() === "sa" && czibCountries("Airspace of the Russian Federation", ccFromName, ccsInText).join() === "ru",
  "a bulletin's country: Saudi Arabia, the Russian Federation");
ok(czibCountries("Airspace of the Persian Gulf and Gulf of Oman", ccFromName, ccsInText).length === 0, "the Persian Gulf and Gulf of Oman is a sea, not Oman: no outline");
ok(czibCountries("Airspace of Pakistan – Baluchistan and Khyber Pakhtunkhwa provinces", ccFromName, ccsInText).join() === "pk" && czibPartial("Airspace of Pakistan – Baluchistan and Khyber Pakhtunkhwa provinces") &&
  czibPartial("Airspace of Yemen – Sana’a Flight Information Region") && !czibPartial("Airspace of Iraq"), "part of a country is marked as such");

/* ---------- file layout ---------- */
const all = S.nga.flatMap((w) => ngaFeatures(w, w.code)).concat([tf]);
const P = pack(all);
ok(P.features.length === all.length && P.features.every((x) => P.warnings[x.properties.w]) && !P.features.some((x) => x.properties.text), "packed: one light feature per shape, each pointing at its warning");
ok(Object.keys(P.warnings).length < all.length && P.warnings["nga:NAVAREA IV 517/24"] && P.warnings["faa:FDC 6/0198"].text, "one record per warning (a warning with many positions carries its text once)");
const back = unpack({ ...P }, "faa");
ok(back.length === 1 && back[0].properties.text === tf.properties.text && back[0].properties.shape === "area", "a failed source's shapes come back from the previous file whole");

/* ---------- the app's current snapshot (texts without line breaks) ---------- */
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync("data/live/navwarnings.js", "utf8"), ctx);
const items = (ctx.window.ASAP_NAVW && ctx.window.ASAP_NAVW.items) || [];
let areas = 0, polys = 0, withPos = 0, drawn = 0;
for (const w of items) {
  const g = shapesOf(w.text);
  if ((w.pos || []).length) { withPos++; if (g.length) drawn++; }
  if (/AREAS? BOUND(?:ED)? BY/.test(w.text) && (w.pos || []).length >= 3) { areas++; if (g.some((x) => x.shape === "area")) polys++; }
}
ok(items.length > 0 && drawn === withPos, "every warning in data/live/navwarnings.js with a position gets a shape (" + drawn + " of " + withPos + ")");
ok(areas === 0 || polys / areas >= 0.9, "'AREA BOUND BY' warnings in the current snapshot become polygons (" + polys + " of " + areas + ")");

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
