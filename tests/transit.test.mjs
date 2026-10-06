// Unit checks for the live public transport tools: the GTFS-Realtime reader (tools/gtfsrt.mjs) on a hand-built protobuf,
// route types, licence names, the route table reader and the vehicle rows (tools/refresh_transit.mjs).
// Run from the repo root: node tests/transit.test.mjs
import { vehicles } from "../tools/gtfsrt.mjs";
import { kindOf, licenceOf, isNc } from "../tools/transit_lib.mjs";
import { routesTable, csv } from "../tools/build_transit_feeds.mjs";
import { row, cellOf, FIELDS } from "../tools/refresh_transit.mjs";

let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

// --- a tiny protobuf writer, enough for the fixture ---
const varint = (n) => { const o = []; while (n >= 128) { o.push((n % 128) | 128); n = Math.floor(n / 128); } o.push(n); return o; };
const tag = (f, w) => varint(f * 8 + w);
const vf = (f, n) => [...tag(f, 0), ...varint(n)];
const sf = (f, s) => { const b = [...Buffer.from(s, "utf8")]; return [...tag(f, 2), ...varint(b.length), ...b]; };
const mf = (f, bytes) => [...tag(f, 2), ...varint(bytes.length), ...bytes];
const ff = (f, x) => { const b = Buffer.alloc(4); b.writeFloatLE(x); return [...tag(f, 5), ...b]; };
const df = (f, x) => { const b = Buffer.alloc(8); b.writeDoubleLE(x); return [...tag(f, 1), ...b]; };

const now = Math.floor(Date.now() / 1000);
const veh = (o) => mf(4, [
  ...(o.trip ? mf(1, [...sf(1, o.trip), ...sf(5, o.route || ""), ...vf(6, 1)]) : []),
  ...(o.pos === false ? [] : mf(2, o.double ? [...df(1, o.lat), ...df(2, o.lon)] : [...ff(1, o.lat), ...ff(2, o.lon), ...ff(3, 90), ...ff(5, 10), ...df(4, 12345)])),
  ...vf(4, 2), ...vf(5, o.ts || now), ...sf(7, "STOP9"),
  ...mf(8, [...sf(1, o.vid || "V1"), ...sf(2, o.lab || ""), ...sf(3, "ABC123")]),
  ...vf(9, 3), ...sf(99, "unknown field skipped")]);
const ent = (id, o, del) => mf(2, [...sf(1, id), ...(del ? vf(2, 1) : []), ...veh(o)]);
const msg = Uint8Array.from([
  ...mf(1, [...sf(1, "2.0"), ...vf(2, 0), ...vf(3, now)]),
  ...ent("e1", { trip: "T1", route: "R1", lat: 13.75, lon: 100.5, lab: "Bus 12" }),
  ...ent("e2", { trip: "T2", lat: 59.91, lon: 10.75, double: true, vid: "NOR-7" }),
  ...ent("e3", { lat: 1, lon: 2 }, true), // deleted
  ...ent("e4", { pos: false, lat: 0, lon: 0 }), // no position
  ...ent("e5", { lat: 0, lon: 0 }), // null island
  ...mf(2, [...sf(1, "alert"), ...mf(5, sf(1, "x"))]), // an alert entity, not a vehicle
]);

const r = vehicles(msg);
ok(r.ts === now, "header timestamp read");
ok(r.list.length === 2, "two usable vehicles (deleted, no position, 0,0 and alert dropped): " + r.list.length);
const a = r.list[0], b = r.list[1];
ok(Math.abs(a.lat - 13.75) < 1e-4 && Math.abs(a.lon - 100.5) < 1e-4, "float lat/lon");
ok(a.route === "R1" && a.trip === "T1" && a.dir === 1, "trip descriptor route, trip, direction");
ok(Math.abs(a.brg - 90) < 1e-6 && Math.abs(a.spd - 10) < 1e-6, "bearing and speed");
ok(a.lab === "Bus 12" && a.id === "V1" && a.stop === "STOP9" && a.st === 2 && a.occ === 3, "label, id, stop, status, occupancy");
ok(!("plate" in a) && !JSON.stringify(a).includes("ABC123"), "licence plate not kept");
ok(Math.abs(b.lat - 59.91) < 1e-9 && b.id === "NOR-7", "double lat/lon accepted");

let threw = false;
try { vehicles(msg.subarray(0, msg.length - 7)); } catch { threw = true; }
ok(threw, "truncated message throws instead of reading past the end");
threw = false;
try { vehicles(Uint8Array.from([0x12, 0xff, 0xff, 0xff, 0xff, 0x0f])); } catch { threw = true; }
ok(threw, "huge declared length throws");
ok(vehicles(new Uint8Array(0)).list.length === 0, "empty feed = no vehicles");

ok(kindOf(3) === "b" && kindOf(700) === "b" && kindOf(11) === "b", "bus types");
ok(kindOf(0) === "t" && kindOf(900) === "t" && kindOf(5) === "t", "tram types");
ok(kindOf(1) === "m" && kindOf(401) === "m", "metro types");
ok(kindOf(2) === "r" && kindOf(109) === "r", "rail types");
ok(kindOf(4) === "f" && kindOf(1200) === "f", "ferry types");
ok(kindOf(NaN) === "o" && kindOf(1500) === "o", "other");

ok(licenceOf("https://creativecommons.org/licenses/by/4.0/") === "CC BY 4.0", "CC BY name");
ok(isNc(licenceOf("https://creativecommons.org/licenses/by-nc/4.0/")), "NC licence flagged");
ok(/not stated/.test(licenceOf("")), "missing licence said plainly");

const rows = csv('id,"name, with comma",x\r\n1,"say ""hi""",\n2,b,c\n');
ok(rows.length === 2 && rows[0]["name, with comma"] === 'say "hi"' && rows[1].x === "c", "CSV quoting");
const t = routesTable('﻿route_id,route_short_name,route_long_name,route_type,route_color\nR1,12,Central - Airport,3,ff0000\nR2,,Ferry line,4,zzz\n');
ok(t.R1[0] === "12" && t.R1[1] === "b" && t.R1[2] === "FF0000" && t.R1[3] === "Central - Airport", "route table row");
ok(t.R2[1] === "f" && t.R2[2] === "", "bad colour dropped");

const rr = row(a, 3, t, null, now);
ok(rr.length === FIELDS.length && rr[0] === 3 && rr[8] === "12" && rr[10] === "b" && rr[11] === "FF0000" && rr[5] === 36 && rr[4] === 90, "row with route table");
const r2 = row(b, 1, null, "f", now);
ok(r2[10] === "f" && r2[8] === null && r2[1] === "NOR-7", "row uses the feed's only kind when the route is unknown");
ok(cellOf(13.75, 100.5) === "10_100" && cellOf(-33.9, 151.2) === "-35_150" && cellOf(59.9, -0.1) === "55_-5", "5° cells");

console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
