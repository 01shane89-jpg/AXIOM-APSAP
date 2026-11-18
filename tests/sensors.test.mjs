// Sensor check beside strike reports (tools/sensor_lib.mjs rules sensor-v1). Run from the repo root: node tests/sensors.test.mjs
import { parseFirms, eligible, pairReport, addHistory, keepNear, persistent, cell, RULES } from "../tools/sensor_lib.mjs";

let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const FP = "a".repeat(64), FP2 = "b".repeat(64);

const csv = "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight\n" +
  "26.1500,50.5500,330.1,0.4,0.4,2026-11-17,2230,N21,VIIRS,n,2.0NRT,290.1,12.3,N\n" +
  "26.1600,50.5600,310.1,0.4,0.4,2026-11-17,2231,N21,VIIRS,l,2.0NRT,290.1,3.0,N\n" +
  "bad,row\n" +
  "26.9000,50.9000,340.0,0.4,0.4,2026-11-17,0105,N21,VIIRS,h,2.0NRT,295.0,40.0,N\n";
const rows = parseFirms(csv, "NOAA-21");
ok(rows.length === 2 && rows[0][2] === "2026-11-17T22:30" && rows[0][3] === "NOAA-21" && rows[0][5] === "n" && rows[1][5] === "h", "FIRMS rows parsed; low confidence and bad rows dropped");
let threw = false; try { parseFirms("a,b\n1,2"); } catch (e) { threw = true; }
ok(threw, "a file that is not FIRMS is refused, not read as empty");

const rep = { kind: "drone", date: "2026-11-17T22:42", fp: FP, geo: { la: 26.16, lo: 50.55, p: "approx" } };
ok(eligible(rep), "a drone strike pinned at a town is checked");
ok(!eligible({ ...rep, kind: "talks" }) && !eligible({ ...rep, kind: "legal" }), "talks and court news are never checked");
ok(!eligible({ ...rep, geo: { la: 26, lo: 50, p: "country" } }) && !eligible({ ...rep, geo: { la: 26, lo: 50, p: "province" } }), "a country or province pin is never checked");
ok(!eligible({ ...rep, fp: "x" }), "a report without a fingerprint is not checked");
ok(!eligible({ ...rep, title: "Qatar condemns continued attacks on Bahrain" }) && !eligible({ ...rep, title: "Senator grills Navy secretary on cost of war" }) && eligible({ ...rep, title: "Drone strike hits radar site" }), "reaction headlines are not events");

let r = pairReport(rep, rows, {});
ok(r.pairs.length === 1 && r.pairs[0].km < 2 && r.pairs[0].h === -0.2 && r.pairs[0].sat === "NOAA-21", "heat 1 km away, 12 minutes before the report, pairs " + JSON.stringify(r.pairs));
ok(!r.pairs.some((p) => p.frp === 40), "heat 90 km away does not pair");
r = pairReport({ ...rep, date: "2026-11-19T12:00" }, rows, {});
ok(r.pairs.length === 0, "heat more than 36 hours before the report does not pair");
r = pairReport({ ...rep, date: "2026-11-17T08:00" }, rows, {});
ok(r.pairs.length === 0, "heat more than 12 hours after the report does not pair");
r = pairReport({ ...rep, geo: { la: 26.30, lo: 50.55, p: "site" } }, rows, {});
ok(r.pairs.length === 0, "a site pin only reaches 10 km (15 km away: no pair)");

// standing heat: the same 2 km cell on 3 days in 10 is left out
const now = Date.parse("2026-11-18T00:00:00Z"), hist = {};
addHistory(hist, [[26.15, 50.55, "2026-11-12T22:00"], [26.151, 50.551, "2026-11-14T22:00"], [26.15, 50.55, "2026-11-17T22:30"]], now);
ok(persistent(hist, 26.15, 50.55), "a cell seen on 3 different days is standing heat");
r = pairReport(rep, rows, hist);
ok(r.pairs.length === 0 && r.skipped === 1, "standing heat is left out and counted");
addHistory(hist, [], Date.parse("2026-11-25T00:00:00Z"));
ok(!persistent(hist, 26.15, 50.55) && (hist[cell(26.15, 50.55)] || []).length === 1, "history keeps 10 days only");

const kept = keepNear(rows.concat(rows), [rep], Date.parse("2026-11-18T00:00:00Z"));
ok(kept.length === 1, "only detections near a report are kept, once");
ok(keepNear(rows, [rep], Date.parse("2026-11-25T00:00:00Z")).length === 0, "detections older than 72 hours are dropped");

const many = [1, 2, 3, 4, 5].map((k) => [26.16 + k * 0.01, 50.55, "2026-11-17T22:0" + k, "N20", 5, "n"]);
r = pairReport({ ...rep, fp: FP2 }, many, {});
ok(r.pairs.length === 3 && r.pairs[0].km <= r.pairs[1].km, "at most three, closest first");
ok(RULES === "sensor-v1", "rules are versioned");

console.log(fails ? fails + " FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
