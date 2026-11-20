// Ships gone quiet near chokepoints and AIS position jumps (tools/darkships_lib.mjs, rules dark-v1).
// Run from the repo root: node tests/darkships.test.mjs
import { RULES, BOXES, SOURCE, boxArea, toFix, emptyState, sweepBox, keepEvents, deadReckon, km, coverage, CELL, TRACK, addPoint, TRK_MAX, AFTER_H } from "../tools/darkships_lib.mjs";
import { parseSdnVessels, sanctionsMatcher, SANC_SOURCE } from "../tools/vessel_sanctions.mjs";

let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const MIN = 60e3, H = 36e5, T0 = Date.parse("2026-11-18T00:00:00Z");
const iso = (t) => new Date(t).toISOString();
const feat = (mmsi, la, lo, t, p = {}) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lo, la] },
  properties: Object.assign({ kind: "vessel", mmsi, seen: iso(t), sog: 12, cog: 90, nav_status: 0, type: 70, name: "SHIP " + mmsi, flag: "PA", source: "aishub" }, p) });
const BOX = ["test", "Test strait", 10, 50, 12, 54];
// eight steady neighbours heard in every sweep around (11.0, 50.5 .. 53.5): coverage along the whole strait
const crowd = (t) => { const a = []; for (let i = 0; i < 12; i++) for (let k = 0; k < 3; k++) a.push(feat(String(200000000 + i * 10 + k), 11.01 + k * 0.01, 50.3 + i * 0.25, t, { sog: 0.2, nav_status: 1 })); return a; };

ok(RULES === "dark-v1" && SOURCE.nc === true, "rules dark-v1; Open Waters tagged non-commercial (personal use only)");
ok(BOXES.every((b) => boxArea(b) <= 100 && b[2] < b[4] && b[3] < b[5]), "every chokepoint box is valid and at most 100 square degrees (anonymous cap)");
ok(new Set(BOXES.map((b) => b[0])).size === BOXES.length, "box ids are unique");

// fixes
ok(toFix(feat("311002381", 11, 51, T0)).mmsi === "311002381", "a ship's 9-digit MMSI is kept");
ok(toFix(feat("992351000", 11, 51, T0)) === null && toFix(feat("111232500", 11, 51, T0)) === null && toFix(feat("12345", 11, 51, T0)) === null, "aids to navigation, SAR aircraft and malformed MMSIs are left out");
ok(toFix(feat("311002381", 11, 51, T0, { type: 37 })) === null && toFix(feat("311002381", 11, 51, T0, { type: 36 })) === null, "sailing and pleasure craft are never kept");
ok(toFix(feat("311002381", 11, 51, T0, { kind: "gear" })) === null && toFix(feat("311002381", 11, 51, T0, { seen: "" })) === null, "gear and a report without a time are left out");
const dr = deadReckon(0, 0, 90, 10, 1);
ok(Math.abs(km(0, 0, dr[0], dr[1]) - 18.52) < 0.2 && Math.abs(dr[0]) < 1e-9, "dead reckoning: 10 kn east for 1 h is 18.5 km east");
ok(coverage([toFix(feat("311000001", 11.01, 51.01, T0)), toFix(feat("311000002", 11.02, 51.02, T0)), toFix(feat("311000003", 11.03, 51.03, T0))], T0).length === 1 &&
  coverage([toFix(feat("311000001", 11.01, 51.01, T0 - 40 * MIN)), toFix(feat("311000002", 11.02, 51.02, T0)), toFix(feat("311000003", 11.03, 51.03, T0))], T0).length === 0,
  "a cell is covered with 3 ships heard in the last 30 min, not with an old one counted");

// a regular tanker transits east at 12 kn, heard every 10 min for 40 min, then goes silent mid-strait while the crowd stays heard
function run(opts = {}) {
  const st = emptyState(); let t = T0, last = null;
  for (let i = 0; i <= 4; i++, t += 10 * MIN) {
    const p = deadReckon(11.0, 50.6, 90, 12, (i * 10) / 60);
    const f = [...crowd(t), feat("636000001", p[0], p[1], t, opts.p || {})];
    last = sweepBox(st, BOX, f, t);
  }
  const tq = t;
  for (; t <= tq + (opts.hours || 4) * H; t += 15 * MIN) last = sweepBox(st, BOX, opts.noCrowd && t > tq + H ? [] : crowd(t), t);
  return { st, last, t };
}
let r = run();
ok(r.last.quiet.length === 1 && r.last.quiet[0].mmsi === "636000001", "a regular ship under way that falls silent inside steady coverage is flagged quiet");
ok(r.last.quiet[0].gap_h >= 3 && r.last.quiet[0].dr.length >= 3 && r.last.quiet[0].fixes === 5, "the flag keeps the gap, the dead-reckoned track and the fixes: " + JSON.stringify(r.last.quiet[0]).slice(0, 160));
r = run({ hours: 2 });
ok(r.last.quiet.length === 0, "under 3 hours silent is not flagged");
r = run({ noCrowd: true });
ok(r.last.quiet.length === 0, "when the receivers stop hearing anyone there it is a coverage gap, not a quiet ship");
r = run({ p: { sog: 1.5 } });
ok(r.last.quiet.length === 0, "a ship last reported under 3 kn is not flagged");
r = run({ p: { nav_status: 1 } });
ok(r.last.quiet.length === 0, "a ship last reported at anchor is not flagged");
r = run({ p: { cog: 0, sog: 20 } });
ok(r.last.quiet.length === 0, "a ship whose course takes it out of the box (or out of coverage) is not flagged");
{ // seen only twice: not a regular transmitter
  const st = emptyState(); let t = T0, last;
  for (let i = 0; i < 2; i++, t += 10 * MIN) last = sweepBox(st, BOX, [...crowd(t), feat("636000002", 11.0, 50.6 + i * 0.03, t)], t);
  for (const end = t + 4 * H; t <= end; t += 15 * MIN) last = sweepBox(st, BOX, crowd(t), t);
  ok(last.quiet.length === 0, "a ship heard only twice is not flagged");
}
{ // reappears: one event with the gap and the distance
  const r1 = run(), st = r1.st; let t = r1.t + 15 * MIN;
  const back = sweepBox(st, BOX, [...crowd(t), feat("636000001", 11.2, 52.7, t)], t);
  const ev = back.events.find((e) => e.k === "reappeared");
  ok(ev && ev.gap_h > 3 && ev.km > 100 && ev.to[0] === 11.2 && !back.quiet.length, "a quiet ship heard again gives one reappeared event and leaves the quiet list: " + JSON.stringify(ev));
  t += 10 * MIN;
  const again = sweepBox(st, BOX, [...crowd(t), feat("636000001", 11.2, 52.75, t)], t);
  ok(!again.events.length, "the next ordinary fix is no event");
}
{ // jump: 200 km in 10 minutes from one MMSI
  const st = emptyState(); let t = T0;
  sweepBox(st, BOX, [feat("636000003", 11.0, 50.6, t)], t); t += 10 * MIN;
  const j = sweepBox(st, BOX, [feat("636000003", 11.0, 52.43, t)], t);
  ok(j.events.length === 1 && j.events[0].k === "jump" && j.events[0].kn > 600, "two fixes 200 km apart 10 minutes apart are a position jump: " + JSON.stringify(j.events[0]));
  t += 10 * MIN;
  const n = sweepBox(st, BOX, [feat("636000003", 11.0, 52.47, t)], t);
  ok(!n.events.length, "an ordinary next fix is no jump");
  const same = sweepBox(st, BOX, [feat("636000003", 11.0, 52.47, t)], t);
  ok(!same.events.length, "the same report read again changes nothing (idempotent)");
}
{ // a vessel not heard for 3 days is forgotten
  const st = emptyState();
  sweepBox(st, BOX, [feat("636000004", 11.0, 50.6, T0)], T0);
  sweepBox(st, BOX, [], T0 + 73 * H);
  ok(!st.boxes.test.v["636000004"], "a vessel not heard for over 72 hours is forgotten");
}
// ---------- routes (track-v1) ----------
ok(TRACK === "track-v1", "routes are versioned track-v1, separate from the flag rules (dark-v1 unchanged)");
{
  const tr = [];
  for (let i = 0; i < 7; i++) addPoint(tr, { la: 11, lo: 50 + i * 0.01, t: T0 + i * 4 * MIN });
  ok(tr.length === 3 && tr[tr.length - 1][2] === Math.round((T0 + 24 * MIN) / 60e3) && tr.every((p, i) => !i || i === tr.length - 1 || p[2] - tr[i - 1][2] >= 10),
    "route: the newest fix always kept, earlier ones at least 10 min apart: " + JSON.stringify(tr));
  const n = tr.length; addPoint(tr, { la: 11, lo: 50, t: T0 }); ok(tr.length === n, "route: an older report changes nothing");
  const big = []; for (let i = 0; i < 100; i++) addPoint(big, { la: 11, lo: 50, t: T0 + i * 11 * MIN });
  ok(big.length === TRK_MAX, "route: capped at " + TRK_MAX + " points");
}
{ // the quiet ship carries the route it was heard on, ending at its last report
  const r1 = run(), q = r1.last.quiet[0];
  ok(Array.isArray(q.before) && q.before.length >= 3 && q.before.every((p) => p.length === 3 && /Z$/.test(p[2])), "quiet: route before the gap as [lat, lon, time]: " + JSON.stringify(q.before));
  const end = q.before[q.before.length - 1];
  ok(Math.abs(end[0] - q.la) < 0.001 && Math.abs(end[1] - q.lo) < 0.001 && end[2] === q.last.slice(0, 16) + "Z", "quiet: route ends at the last report");
  ok(q.before.every((p, i) => !i || p[1] > q.before[i - 1][1]), "quiet: route points in time order (eastbound here)");
  // reappears: event keeps the route before the gap and starts the route after; later sweeps add to it for AFTER_H hours
  const st = r1.st; let t = r1.t + 15 * MIN;
  const back = sweepBox(st, BOX, [...crowd(t), feat("636000001", 11.2, 52.7, t)], t);
  const ev = back.events.find((e) => e.k === "reappeared");
  ok(ev && ev.before.length >= 3 && ev.after.length === 1 && ev.after[0][0] === 11.2 && ev.before[ev.before.length - 1][2] === ev.from[2].slice(0, 16) + "Z",
    "reappeared: route before the gap ends at the last report, route after starts at the new one");
  st.events = keepEvents(st.events, back.events, t);
  for (let i = 1; i <= 4; i++) { t += 12 * MIN; sweepBox(st, BOX, [...crowd(t), feat("636000001", 11.2, 52.7 + i * 0.05, t)], t); }
  const held = st.events.find((e) => e.k === "reappeared");
  ok(held.after.length === 5 && held.after[4][1] === 52.9, "reappeared: later sweeps add the route after the gap: " + JSON.stringify(held.after));
  const same = JSON.stringify(held.after); sweepBox(st, BOX, [...crowd(t), feat("636000001", 11.2, 52.9, t)], t);
  ok(JSON.stringify(held.after) === same, "reappeared: the same report read twice adds nothing (idempotent)");
  t += AFTER_H * 36e5; sweepBox(st, BOX, [...crowd(t), feat("636000001", 11.3, 53.0, t)], t);
  ok(held.after.length === 5, "reappeared: no more points after " + AFTER_H + " h");
  ok(st.boxes.test.v["636000001"].trk.length >= 1 && !st.boxes.test.v["636000001"].ev, "reappeared: the ship's own route carries on");
}
{ // old state without routes (dark-v1 before track-v1) still works
  const st = emptyState(); let t = T0;
  sweepBox(st, BOX, [feat("636000005", 11.0, 50.6, t)], t); delete st.boxes.test.v["636000005"].trk; t += 10 * MIN;
  const j = sweepBox(st, BOX, [feat("636000005", 11.0, 52.43, t)], t);
  ok(j.events.length === 1 && j.events[0].before.length === 1 && j.events[0].after.length === 1, "old state without a route: jump still found, route from the last fix");
}
// ---------- sanctions (OFAC SDN) ----------
{
  const csv = [
    '4243,"EBANO","vessel","CUBA",-0- ,-0- ,"General Cargo","2595","1865","Panama","Some Owner S.A.","Vessel Registration Identification IMO 7406784; f.k.a. \'ANA I\'."',
    '15036,"ARTAVIL","vessel","IRAN",-0- ,"9HYI9","Crude Oil Tanker",-0- ,"156809","Malta","NITC","Vessel Registration Identification IMO 9187629; MMSI 572469210."',
    '306,"BANCO NACIONAL DE CUBA",-0- ,"CUBA",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"a.k.a. \'BNC\'."',
    '4238,"MAR AZUL","vessel","CUBA",-0- ,"CL2192","Tug",-0- ,"212","Cuba","Samir de Navegacion S.A.",-0- ',
  ].join("\n");
  const l = parseSdnVessels(csv);
  ok(l.length === 2 && l[0].imo === "7406784" && l[1].mmsi === "572469210" && l.every((v) => !("owner" in v)) && !JSON.stringify(l).includes("Owner"),
    "OFAC: vessels with an IMO or MMSI kept; non-vessels and owners never kept: " + JSON.stringify(l));
  ok(SANC_SOURCE.nc === false && /public domain/.test(SANC_SOURCE.lic), "OFAC list is public domain (usable in the sold version)");
  const m = sanctionsMatcher(l);
  ok(m("9187629", "").by === "imo" && m("9187629", "").name === "ARTAVIL", "OFAC: IMO match");
  const mm = m("9999999", "572469210");
  ok(mm.by === "mmsi" && mm.listed_imo === "9187629", "OFAC: MMSI-only match is marked weaker and gives the listed IMO to compare");
  ok(m("", "") === null && m("1234567", "311000001") === null, "OFAC: no number, no match");
  // in a sweep: the quiet ship whose IMO is listed is flagged as a match, the others are not
  const r = run({ p: { imo: 9187629 } });
  ok(r.last.quiet[0].imo === "9187629" && r.last.quiet[0].sanc === undefined, "without a list nothing is matched");
  const st = emptyState(); let t = T0, last;
  for (let i = 0; i <= 4; i++, t += 10 * MIN) { const p = deadReckon(11.0, 50.6, 90, 12, (i * 10) / 60); last = sweepBox(st, BOX, [...crowd(t), feat("636000001", p[0], p[1], t, { imo: 9187629 })], t, m); }
  for (const end = t + 4 * H; t <= end; t += 15 * MIN) last = sweepBox(st, BOX, crowd(t), t, m);
  ok(last.quiet.length === 1 && last.quiet[0].sanc && last.quiet[0].sanc.by === "imo" && last.quiet[0].sanc.list === "OFAC SDN", "a quiet ship whose IMO is on the OFAC list carries the match");
  ok(toFix(feat("311002381", 11, 51, T0, { imo: 123 })).imo === "" && toFix(feat("311002381", 11, 51, T0, { imo: 9187629 })).imo === "9187629", "only 7-digit IMO numbers are kept");
}
// events kept
const e1 = { k: "jump", mmsi: "1", to: [0, 0, iso(T0)] }, e2 = { k: "jump", mmsi: "2", to: [0, 0, iso(T0 - 80 * H)] };
const kept = keepEvents([e1, e2], [e1], T0);
ok(kept.length === 1 && kept[0].mmsi === "1", "events: repeats dropped, older than 72 h dropped");
ok(Number.isInteger(1 / CELL), "coverage cells divide a degree");

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
