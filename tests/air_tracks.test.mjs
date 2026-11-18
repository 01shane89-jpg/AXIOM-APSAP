// Unit test for each aircraft's current flight kept by the air traffic sweep (tools/air_tracks.mjs), no network.
// Usage: node tests/air_tracks.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { step, readTracks, writeTracks, loadAirfields, nearestAirfield, fileOf, KEEP_S, MAX_PTS } from "../tools/air_tracks.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "airtr-"));
fs.writeFileSync(path.join(dir, "airports.csv"),
  'id,ident,type,name,latitude_deg,longitude_deg,elevation_ft,continent,iso_country,iso_region,municipality,scheduled_service,icao_code,iata_code,gps_code,local_code,home_link,wikipedia_link,keywords\n' +
  '1,VTBS,large_airport,"Suvarnabhumi Airport",13.681,100.747,5,AS,TH,TH-10,Bangkok,yes,VTBS,BKK,VTBS,,,,\n' +
  '2,VTBD,large_airport,"Don Mueang International Airport",13.9126,100.607,9,AS,TH,TH-10,Bangkok,yes,VTBD,DMK,VTBD,,,,\n' +
  '3,TH-0001,heliport,"Hospital Helipad, ""Roof""",13.70,100.75,0,AS,TH,TH-10,Bangkok,no,,,,,,,\n' +
  '4,XX01,closed,"Old strip",13.6,100.6,0,AS,TH,TH-10,,no,,,,,,,\n');
const G = loadAirfields(path.join(dir, "airports.csv"));
assert.equal(G.count, 3, "closed airfields left out");
assert.deepEqual(nearestAirfield(G, 13.69, 100.75).slice(0, 2), ["VTBS", "Suvarnabhumi Airport"], "a real airport beats a closer helipad");
assert.equal(nearestAirfield(G, 15, 102), null, "nothing within 8 nm");
assert.equal(fileOf("880844"), "88");

// rows in air_rows.mjs format: [hex, cs, reg, t, desc, lat, lon, alt, gs, trk, pos, src, sqk, cat, fl]
const R = (hex, t, lat, lon, alt, fl = 0) => [hex, null, null, null, null, lat, lon, alt, 300, 10, t, 0, null, null, fl];
const T0 = 1800000000;
const EMPTY = { tr: new Map(), dep: new Map() };

// on the ground at Suvarnabhumi, then climbing out, then cruising: one flight from VTBS
let s = step(EMPTY, [R("880844", T0, 13.682, 100.748, null, 4)], T0 + 10, G);
s = step(s, [R("880844", T0 + 300, 13.80, 100.70, 9000)], T0 + 310, G);
s = step(s, [R("880844", T0 + 600, 14.20, 100.60, 25000)], T0 + 610, G);
assert.equal(s.tr.get("880844").length, 3, "ground point kept as where it left from");
assert.deepEqual(s.dep.get("880844").slice(0, 2), ["VTBS", "Suvarnabhumi Airport"]);
assert.equal(s.tr.get("880844")[0][4], 1); assert.equal(s.tr.get("880844")[0][3], null, "ground point has no altitude");

// first heard low and climbing near Don Mueang: departure; low and descending: an arrival, no departure
let c = step(EMPTY, [R("aaaaaa", T0, 13.93, 100.61, 2000), R("bbbbbb", T0, 13.93, 100.61, 3000)], T0 + 10, G);
c = step(c, [R("aaaaaa", T0 + 300, 14.2, 100.5, 11000), R("bbbbbb", T0 + 300, 13.92, 100.607, 800)], T0 + 310, G);
assert.equal(c.dep.get("aaaaaa")[0], "VTBD", "climbing out: departure");
assert.ok(!c.dep.has("bbbbbb"), "descending: not a departure");
// first heard at cruise: no departure known
let m = step(EMPTY, [R("cccccc", T0, 20, 100, 35000)], T0 + 10, G);
m = step(m, [R("cccccc", T0 + 300, 20.5, 100.1, 35000)], T0 + 310, G);
assert.ok(!m.dep.has("cccccc"));

// landed, parked, took off again: a new flight from the last ground point, the old one dropped
let n = s;
n = step(n, [R("880844", T0 + 3000, 18.77, 98.96, null, 4)], T0 + 3010, G);
n = step(n, [R("880844", T0 + 6000, 18.77, 98.96, null, 4)], T0 + 6010, G);
assert.equal(n.tr.get("880844").length, 1, "still on the ground: one point");
n = step(n, [R("880844", T0 + 6300, 18.9, 99.0, 8000)], T0 + 6310, G);
assert.equal(n.tr.get("880844").length, 2, "new flight: last ground point + airborne");
assert.equal(n.tr.get("880844")[0][1], 18.77);
assert.ok(!n.dep.has("880844"), "no airfield in the list near Chiang Mai here: no departure claimed");

// an hour not heard: a new flight with nothing kept
let g = step(s, [R("880844", T0 + 600 + 3700, 20, 101, 30000)], T0 + 4400, G);
assert.equal(g.tr.get("880844").length, 1); assert.ok(!g.dep.has("880844"));
// the same report again (carried on): not doubled
let d = step(s, [R("880844", T0 + 600, 14.20, 100.60, 25000)], T0 + 700, G);
assert.equal(d.tr.get("880844").length, 3);
// not in this sweep: dropped
assert.ok(!step(s, [], T0 + 700, G).tr.has("880844"));
// bad rows ignored
assert.equal(step(EMPTY, [null, [], R("dddddd", T0, "x", 1, 1)], T0, G).tr.size, 0);
// long flights capped
let L = EMPTY;
for (let i = 0; i < MAX_PTS + 20; i++) L = step(L, [R("eeeeee", T0 + i * 120, 10 + i * 0.01, 100, 30000)], T0 + i * 120 + 5, G);
assert.equal(L.tr.get("eeeeee").length, MAX_PTS);
assert.ok(KEEP_S >= 18 * 3600, "long-haul flights fit");

// written by hex prefix and read back
const out = path.join(dir, "out");
const w = writeTracks(out, s, "2027-01-15T08:00:00Z");
assert.deepEqual(w, { aircraft: 1, points: 3, dep: 1, files: 1 });
const j = JSON.parse(fs.readFileSync(path.join(out, "t", "88.json"), "utf8"));
assert.equal(j.schema, "osap-air-tracks/2"); assert.equal(j.tr["880844"].length, 3); assert.equal(j.dep["880844"][0], "VTBS");
const back = readTracks(out);
assert.deepEqual(back.tr.get("880844"), s.tr.get("880844")); assert.deepEqual(back.dep.get("880844"), s.dep.get("880844"));
writeTracks(out, EMPTY, "x"); assert.equal(fs.readdirSync(path.join(out, "t")).length, 0, "old files cleared");
// without an airfield list paths still build, with no departures
assert.equal(step(EMPTY, [R("ffffff", T0, 13.682, 100.748, null, 4)], T0, null).dep.size, 0);
assert.equal(loadAirfields(path.join(dir, "missing.csv")), null);
console.log("air_tracks: all checks passed");
