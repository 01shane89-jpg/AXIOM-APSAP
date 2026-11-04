// Dive plan table reading (assets/osap-dive.js) against the U.S. Navy Diving Manual Rev 7 air tables
// (data/dive/usn-rev7-air.json). The worked examples are the manual's own (Chapter 9); the rest are the manual's rules.
// OSAP reads table cells only: every expected value below is a cell or a worked answer printed in the manual.
// Run: node tests/dive.test.mjs
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const C = req("../assets/osap-dive.js");
const T = req("../data/dive/usn-rev7-air.json");
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const t = T.tables;

// the data file is the manual's: source pinned, table sizes as printed
ok(T.source.sha256 === "8c56b4ac660840b1cb921077d43cece3afef172c9abadf7160205d9f86022d9c", "tables carry the SHA-256 of the manual they were read from");
ok(Object.keys(t.t96).join("") === C.G && t.t96.A.length === 10, "Table 9-6: groups A to Z, 10 altitude columns");
ok(t.t97.length === 24 && t.t97[0].depth === 10 && t.t97[23].depth === 190, "Table 9-7: 24 depths, 10 to 190 fsw");
ok(Object.keys(t.rnt).length === 24 && Object.keys(t.si).length === 16, "Table 9-8: 24 depths, 16 surface interval rows");
ok(t.t99.length === 382 && t.t99[0].depth === 30 && t.t99[t.t99.length - 1].depth === 300, "Table 9-9: 382 schedules, 30 to 300 fsw");
// every AIR row adds up as printed: first stop + stops + 0:40 to the surface = total ascent
ok(t.t99.every(r => { const s = Object.values(r.air.stops).reduce((a, b) => a + b, 0); return r.air.total_ascent_s === r.first_stop_s + s * 60 + (s ? 40 : 0); }), "every Table 9-9 air row: time to first stop + stops + 0:40 = total ascent time");
ok(t.t97.every(r => r.no_stop_limit == null || Object.values(r.groups).slice(-1)[0] === r.no_stop_limit), "every Table 9-7 row ends at its no-stop limit");
ok(C.G.split("").every(g => t.si[g][0].min === 10 && t.si[g].every((x, i, a) => !i || x.min === a[i - 1].max + 1)), "Table 9-8 surface intervals start at 0:10 and run on without a gap");

// spot cells read off the printed tables
ok(t.t97.find(r => r.depth === 60).no_stop_limit === 63 && t.t97.find(r => r.depth === 100).no_stop_limit === 25, "no-stop limits: 60 fsw 63 min, 100 fsw 25 min");
ok(t.t96.K[7] === 935 && t.t96.Z[9] === 29 * 60 + 15 && t.t96.A[9] === 0, "Table 9-6: K at 8,000 ft 15:35, Z at 10,000 ft 29:15, A always 0:00");

// manual example (para 9-8.1): 78 fsw for 47 min -> 80 fsw / 50 min, 17 min on air at 20 fsw
let p = C.plan(T, 78, 47);
ok(p.kind === "deco" && p.depth === 80 && p.row.bt === 50 && p.row.air.stops["20"] === 17 && p.page === "9-72", "78 fsw / 47 min: 80/50 schedule, 17 min at 20 fsw (manual page 9-72)");
// no-decompression dive: exact or next longer time column
p = C.plan(T, 60, 40);
ok(p.kind === "nodeco" && p.group === "H" && p.cell === 45 && p.left === 23, "60 fsw / 40 min: no stops, group H (45-min column), 23 min left to the limit");
p = C.plan(T, 10, 1000);
ok(p.kind === "nodeco" && p.group === "F" && p.cell == null, "10 fsw for 1000 min: unlimited, highest group F (Table 9-7 *)");
// selection never rounds down
ok(C.plan(T, 61, 10).depth === 70 && C.plan(T, 59, 10).depth === 60, "61 fsw is read at 70 fsw, 59 at 60 fsw");
ok(C.toFsw(18, "m") === 60 && C.toFsw(18.3, "m") === 61 && C.toFsw(33, "fsw") === 33, "metres convert at 3.28084 and round up: 18 m = 60 fsw, 18.3 m = 61 fsw");

// manual example (para 9-9.2): 60/40, 30 min surface, 56/20 -> group H, RNT 46, ESDT 66; RNT exception gives 60/60 no-stop
let s = C.series(T, [{ d: 60, bt: 40 }, { d: 56, bt: 20, si: 30 }]), x = s.dives[1];
ok(x.gNew === "H" && x.rnt.t === 46 && x.esdt === 66 && x.std.row.bt === 70 && x.std.row.air.stops["20"] === 7, "repetitive 56/20 after 60/40: group H, RNT 46, ESDT 66, 60/70 = 7 min at 20 fsw");
ok(x.altUsed && x.p.kind === "nodeco" && x.p.depth === 60 && x.altBt === 60, "RNT exception rule: 60 fsw / 60 min (no stops) is used");
// manual example (para 9-9.2): 100/25, 30 min, 60/20 -> 60/70 kept, the 100/45 alternative needs more
s = C.series(T, [{ d: 100, bt: 25 }, { d: 60, bt: 20, si: 30 }]); x = s.dives[1];
ok(!x.altUsed && x.p.row.bt === 70 && x.alt.row.depth === 100 && x.alt.row.air.stops["20"] === 36, "100/25 then 60/20: 60/70 kept; 100/45 needs 36 min at 20 fsw");
// manual example (para 9-9.1): 101/48 -> 110/50 group Z; 6:26 surface -> I; RNT 30 at 100 fsw; ESDT 45 -> 100/45
s = C.series(T, [{ d: 101, bt: 48 }, { d: 98, bt: 15, si: 386 }]);
ok(s.dives[0].p.depth === 110 && s.dives[0].p.row.bt === 50 && s.dives[0].groupOut === "Z", "101 fsw / 48 min: 110/50 schedule, group Z");
ok(s.dives[1].gNew === "I" && s.dives[1].rnt.t === 30 && s.dives[1].esdt === 45 && s.dives[1].p.depth === 100 && s.dives[1].p.row.bt === 45, "after 6:26 on the surface: group I, RNT 30, ESDT 45, 100/45 schedule");
// manual example (para 9-9.4): 100/20, 30 min, 60/20 -> G, RNT 40, ESDT 60, no decompression
s = C.series(T, [{ d: 100, bt: 20 }, { d: 60, bt: 20, si: 30 }]);
ok(s.dives[0].groupOut === "G" && s.dives[1].rnt.t === 40 && s.dives[1].esdt === 60 && s.dives[1].p.kind === "nodeco", "100/20 then 60/20: group G, RNT 40, ESDT 60, no decompression");
// manual example (para 9-14): 60/60 (K), 6:10, 30/20 -> F; commercial flight with K: 15:35
s = C.series(T, [{ d: 60, bt: 60 }, { d: 30, bt: 20, si: 370 }]);
ok(s.dives[0].groupOut === "K" && s.dives[1].groupOut === "F" && s.highest === "K" && C.altWait(T, s.highest, 8000).min === 935, "60/60 (K), 6:10, 30/20 (F): wait 15:35 before a commercial flight");
// manual example: group G going up 3,500 ft (read at 4,000 ft) needs no wait
ok(C.altWait(T, "G", 3500).min === 0 && C.altWait(T, "G", 3500).col === 4000, "group G, 3,500 ft read at 4,000 ft: no wait");

// rules the manual sets, negative cases included
s = C.series(T, [{ d: 60, bt: 40 }, { d: 50, bt: 10, si: 5 }]);
ok(s.dives[1].combined && s.dives[1].useD === 60 && s.dives[1].useBt === 50, "surface interval under 10 min: bottom times added at the deeper depth");
s = C.series(T, [{ d: 60, bt: 20 }, { d: 50, bt: 10, si: 24 * 60 }]);
ok(s.dives[1].esdt == null && s.dives[1].p.bt === 10 && !s.dives[1].gNew, "surface interval past the end of its row: not a repetitive dive");
s = C.series(T, [{ d: 140, bt: 30 }, { d: 20, bt: 300, si: 15 }]);
ok(s.dives[0].groupOut === "N" && s.dives[1].rnt.star && s.dives[1].p.kind === "nodeco" && s.dives[1].groupOut === "N", "Table 9-8 ** at 20 fsw: unlimited time, the group stays as it was");
s = C.series(T, [{ d: 110, bt: 50 }, { d: 25, bt: 10, si: 15 }]);
ok(s.dives[0].groupOut === "Z" && s.dives[1].rnt.dagger && s.dives[1].p.depth === 30, "Table 9-8 † at 25 fsw: the 30 fsw residual time and table are used");
// a schedule with no repetitive group: no repetitive dive deeper than 20 fsw for 18 hours
const nog = t.t99.find(r => !r.group && r.zone === "o2_recommended");
s = C.series(T, [{ d: nog.depth, bt: nog.bt }, { d: 40, bt: 10, si: 120 }]);
ok(s.dives[0].groupOut === null && s.dives[1].block && /18 hours/.test(s.dives[1].err), "after a schedule with no group, a 40 fsw dive 2 h later is refused (18 hours)");
s = C.series(T, [{ d: nog.depth, bt: nog.bt }, { d: 40, bt: 10, si: 19 * 60 }]);
ok(!s.dives[1].err && s.dives[1].p.bt === 10, "after 19 hours the next dive is planned as a first dive");
// exceptional exposure follows the decompression mode the zone names
const ex = t.t99.find(r => r.zone === "exceptional_air_o2_required");
ok(C.exceptional(T, ex, "air") && !C.exceptional(T, ex, "air_o2") && !C.exceptional(T, ex, "surdo2"), "an 'air exceptional, air/O2 or SurDO2 required' row is exceptional on air only");
s = C.series(T, [{ d: ex.depth, bt: ex.bt, mode: "air" }]);
ok(s.exceptional && C.altWait(T, s.highest, 1000, s.exceptional).min === 48 * 60, "exceptional exposure: 48 hours before going up");
s = C.series(T, [{ d: 60, bt: 20 }, { d: ex.depth, bt: Math.max(1, ex.bt - 20), si: 30, mode: "air" }]);
ok(s.dives[1].exc && s.dives[1].warn.some(w => /Do not perform repetitive dives/.test(w)), "a repetitive dive that lands on an exceptional schedule is flagged as not allowed");
// outside the tables: never extrapolated
ok(C.plan(T, 310, 10).kind === "beyond", "310 fsw: outside the tables, no schedule");
ok(C.plan(T, 30, 721).kind === "beyond", "30 fsw for 721 min: longer than the longest schedule, no schedule");
s = C.series(T, [{ d: 60, bt: 20 }, { d: 200, bt: 5, si: 60 }]);
ok(s.dives[1].block && /190 fsw/.test(s.dives[1].err), "a repetitive dive deeper than 190 fsw has no residual nitrogen time: refused");
ok(C.plan(T, 0, 10).err && C.plan(T, 60, 0).err, "no depth or no bottom time: nothing read");
ok(C.altWait(T, "Z", 11000).over, "above 10,000 ft: not covered by Table 9-6");

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
